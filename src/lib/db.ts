import { open, type DB } from '@op-engineering/op-sqlite';

import { shiftMonth } from './months';

export type PaymentMethod = 'card' | 'cash';

export type Expense = {
  id: number;
  amount: number;
  currency: string;
  merchant: string;
  card: string | null;
  category: string;
  source: 'apple_pay' | 'manual' | 'statement';
  /** How it was paid: card (Apple Pay, bank statement, or entered by hand) or cash. */
  method: PaymentMethod;
  note: string | null;
  created_at: number; // unix ms
};

export type NewExpense = Omit<Expense, 'id' | 'created_at' | 'method'> & {
  created_at?: number;
  method?: PaymentMethod;
};

export type ExpenseUpdate = Pick<
  Expense,
  'amount' | 'merchant' | 'category' | 'note' | 'created_at' | 'method'
>;

/** AED totals for one month; `cash` is the part paid in cash. */
export type MonthSummary = {
  month: string;
  total: number;
  cash: number;
  count: number;
};

const DATABASE_VERSION = 5;

let db: DB | null = null;

function getDb(): DB {
  if (!db) db = open({ name: 'expenses.db' });
  return db;
}

export async function migrateDbIfNeeded() {
  const d = getDb();
  const { rows } = await d.execute('PRAGMA user_version');
  const current = Number(rows[0]?.user_version ?? 0);
  if (current >= DATABASE_VERSION) return;

  if (current === 0) {
    await d.execute(`CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AED',
      merchant TEXT NOT NULL,
      card TEXT,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    )`);
    await d.execute(
      'CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses (created_at)',
    );
  }
  if (current < 2) {
    await d.execute(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  }
  if (current < 3) {
    // One-month salary overrides; the recurring salary lives in meta.
    await d.execute(
      'CREATE TABLE IF NOT EXISTS salary (month TEXT PRIMARY KEY, amount REAL NOT NULL)',
    );
  }
  if (current < 4) {
    await d.execute(
      "ALTER TABLE expenses ADD COLUMN method TEXT NOT NULL DEFAULT 'card'",
    );
    // Manual entries saved without a merchant were named "Cash": they were cash payments.
    await d.execute(
      "UPDATE expenses SET method = 'cash' WHERE source = 'manual' AND merchant = 'Cash'",
    );
  }
  if (current < 5) {
    // Categories the user made, and the category they last picked for each merchant.
    // Both stay on this phone; nothing here is sent to the server.
    await d.execute(`CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      created_at INTEGER NOT NULL
    )`);
    // `merchant` is normalized with merchantKey(); SavePaymentIntent.swift reads this table too.
    await d.execute(`CREATE TABLE IF NOT EXISTS merchant_categories (
      merchant TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }
  await d.execute(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

export async function insertExpense(e: NewExpense): Promise<number> {
  const result = await getDb().execute(
    `INSERT INTO expenses (amount, currency, merchant, card, category, source, method, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.amount,
      e.currency,
      e.merchant,
      e.card,
      e.category,
      e.source,
      e.method ?? 'card',
      e.note,
      e.created_at ?? Date.now(),
    ],
  );
  return result.insertId ?? 0;
}

export async function updateExpense(id: number, e: ExpenseUpdate) {
  await getDb().execute(
    'UPDATE expenses SET amount = ?, merchant = ?, category = ?, note = ?, created_at = ?, method = ? WHERE id = ?',
    [e.amount, e.merchant, e.category, e.note, e.created_at, e.method, id],
  );
}

export async function getExpense(id: number): Promise<Expense | null> {
  const { rows } = await getDb().execute(
    'SELECT * FROM expenses WHERE id = ?',
    [id],
  );
  return (rows[0] as unknown as Expense) ?? null;
}

/** Categories the user added, oldest first. */
export async function listCustomCategories(): Promise<string[]> {
  const { rows } = await getDb().execute(
    'SELECT name FROM categories ORDER BY created_at',
  );
  return rows.map(r => String(r.name));
}

export async function addCustomCategory(name: string) {
  await getDb().execute(
    'INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)',
    [name, Date.now()],
  );
}

/** Removes a category the user added; its expenses move to "Other". */
export async function deleteCustomCategory(name: string) {
  await getDb().transaction(async tx => {
    await tx.execute(
      "UPDATE expenses SET category = 'Other' WHERE category = ?",
      [name],
    );
    await tx.execute('DELETE FROM merchant_categories WHERE category = ?', [
      name,
    ]);
    await tx.execute('DELETE FROM categories WHERE name = ?', [name]);
  });
}

/** "  Carrefour   MOE " → "carrefour moe". Must match merchantKey in SavePaymentIntent.swift. */
export const merchantKey = (merchant: string) =>
  merchant.trim().toLowerCase().replace(/\s+/g, ' ');

/** The category last picked for this merchant, or null if the user never chose one. */
export async function getMerchantCategory(
  merchant: string,
): Promise<string | null> {
  const key = merchantKey(merchant);
  if (!key) return null;
  const { rows } = await getDb().execute(
    'SELECT category FROM merchant_categories WHERE merchant = ?',
    [key],
  );
  return rows[0] ? String(rows[0].category) : null;
}

/** Every remembered merchant → category, for matching many rows at once (statement import). */
export async function listMerchantCategories(): Promise<Map<string, string>> {
  const { rows } = await getDb().execute(
    'SELECT merchant, category FROM merchant_categories',
  );
  return new Map(rows.map(r => [String(r.merchant), String(r.category)]));
}

export async function setMerchantCategory(merchant: string, category: string) {
  const key = merchantKey(merchant);
  if (!key) return;
  await getDb().execute(
    'INSERT OR REPLACE INTO merchant_categories (merchant, category, updated_at) VALUES (?, ?, ?)',
    [key, category, Date.now()],
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const { rows } = await getDb().execute(
    'SELECT value FROM meta WHERE key = ?',
    [key],
  );
  return rows[0] ? String(rows[0].value) : null;
}

export async function setMeta(key: string, value: string) {
  await getDb().execute(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    [key, value],
  );
}

/** When the Wallet automation first saved a payment (unix ms), or null if it never has. */
export async function getAutoLogSince(): Promise<number | null> {
  const { rows } = await getDb().execute(
    "SELECT value FROM meta WHERE key = 'auto_log_since'",
  );
  return rows[0] ? Number(rows[0].value) : null;
}

/** Records the first successful automation run. Returns true if this was the first one. */
export async function markAutoLogWorking(): Promise<boolean> {
  const result = await getDb().execute(
    "INSERT OR IGNORE INTO meta (key, value) VALUES ('auto_log_since', ?)",
    [String(Date.now())],
  );
  return result.rowsAffected > 0;
}

/** Card names the Wallet automation has sent so far (excluding the in-app test card). */
export async function listAutoLogCards(): Promise<string[]> {
  const { rows } = await getDb().execute(
    `SELECT DISTINCT card FROM expenses
     WHERE source = 'apple_pay' AND card IS NOT NULL AND card != '' AND card != 'Test Card'
     ORDER BY card`,
  );
  return rows.map(r => String(r.card));
}

/**
 * Salary: a recurring monthly amount (from `since` onwards) plus optional per-month overrides.
 * Months before `since` have no salary unless overridden, so old months aren't rewritten.
 */
export type SalaryInfo = {
  recurring: number | null;
  since: string | null;
  overrides: Record<string, number>;
};

export async function getSalaryInfo(): Promise<SalaryInfo> {
  const d = getDb();
  const meta = await d.execute(
    "SELECT key, value FROM meta WHERE key IN ('salary_recurring', 'salary_since')",
  );
  const kv = Object.fromEntries(
    meta.rows.map(r => [String(r.key), String(r.value)]),
  );
  const { rows } = await d.execute('SELECT month, amount FROM salary');
  return {
    recurring: kv.salary_recurring != null ? Number(kv.salary_recurring) : null,
    since: kv.salary_since ?? null,
    overrides: Object.fromEntries(
      rows.map(r => [String(r.month), Number(r.amount)]),
    ),
  };
}

export function salaryFor(info: SalaryInfo, month: string): number | null {
  if (month in info.overrides) return info.overrides[month];
  if (info.recurring != null && info.since != null && month >= info.since) {
    return info.recurring;
  }
  return null;
}

/** Sets the salary for `month`, either just for that month or as the recurring amount from then on. */
export async function setSalary(
  month: string,
  amount: number,
  recurring: boolean,
) {
  const d = getDb();
  if (recurring) {
    const before = await getSalaryInfo();
    await d.execute(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('salary_recurring', ?)",
      [String(amount)],
    );
    // Earlier months keep the old recurring amount: pin it on each of them first.
    if (
      before.recurring != null &&
      before.since != null &&
      before.since < month
    ) {
      for (let m = before.since; m < month; m = shiftMonth(m, 1)) {
        await d.execute(
          'INSERT OR IGNORE INTO salary (month, amount) VALUES (?, ?)',
          [m, before.recurring],
        );
      }
    }
    // Keep the earliest start so earlier months keep their salary.
    const since = before.since;
    if (!since || month < since) {
      await d.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('salary_since', ?)",
        [month],
      );
    }
    await d.execute('DELETE FROM salary WHERE month = ?', [month]);
  } else {
    await d.execute(
      'INSERT OR REPLACE INTO salary (month, amount) VALUES (?, ?)',
      [month, amount],
    );
  }
}

/** Removes the one-month override for `month`, or the recurring salary if there is none. */
export async function clearSalary(month: string) {
  const d = getDb();
  const result = await d.execute('DELETE FROM salary WHERE month = ?', [month]);
  if (result.rowsAffected === 0) {
    await d.execute(
      "DELETE FROM meta WHERE key IN ('salary_recurring', 'salary_since')",
    );
  }
}

/**
 * True if an expense with the same amount already exists within ±2 days of `at`
 * (an Apple Pay tap and the bank's posting date can differ by a day or two).
 */
export async function hasSimilarExpense(
  amount: number,
  at: number,
): Promise<boolean> {
  const window = 2 * 86_400_000;
  const { rows } = await getDb().execute(
    `SELECT COUNT(*) AS n FROM expenses
     WHERE ABS(amount - ?) < 0.005 AND created_at BETWEEN ? AND ?`,
    [amount, at - window, at + window],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Inserts many expenses in one transaction. Returns how many were added. */
export async function insertExpenses(items: NewExpense[]): Promise<number> {
  const d = getDb();
  await d.transaction(async tx => {
    for (const e of items) {
      await tx.execute(
        `INSERT INTO expenses (amount, currency, merchant, card, category, source, method, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.amount,
          e.currency,
          e.merchant,
          e.card,
          e.category,
          e.source,
          e.method ?? 'card',
          e.note,
          e.created_at ?? Date.now(),
        ],
      );
    }
  });
  return items.length;
}

export type AutoLogRun = {
  id: number;
  at: number;
  status: 'saved' | 'duplicate' | 'failed';
  amount: string | null;
  merchant: string | null;
  card: string | null;
  message: string | null;
};

/** Latest Wallet automation runs, written by the native "Save Apple Pay Payment" action. */
export async function listAutoLogRuns(limit = 10): Promise<AutoLogRun[]> {
  try {
    const { rows } = await getDb().execute(
      'SELECT * FROM autolog ORDER BY id DESC LIMIT ?',
      [limit],
    );
    return rows as unknown as AutoLogRun[];
  } catch {
    return []; // table appears after the first run
  }
}

/** Guards against the same Shortcut deep link being opened twice in a row. */
export async function isRecentDuplicate(
  amount: number,
  merchant: string,
  windowMs = 60_000,
): Promise<boolean> {
  const { rows } = await getDb().execute(
    `SELECT COUNT(*) AS n FROM expenses
     WHERE amount = ? AND merchant = ? AND created_at > ?`,
    [amount, merchant, Date.now() - windowMs],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Expenses with start <= created_at < end, newest first. */
export async function listExpenses(
  start: number,
  end: number,
): Promise<Expense[]> {
  const { rows } = await getDb().execute(
    'SELECT * FROM expenses WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC',
    [start, end],
  );
  return rows as unknown as Expense[];
}

/** AED totals per month (local time), newest month first. */
export async function listMonthSummaries(): Promise<MonthSummary[]> {
  const { rows } = await getDb().execute(
    `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', 'localtime') AS month,
            SUM(CASE WHEN currency = 'AED' THEN amount ELSE 0 END) AS total,
            SUM(CASE WHEN currency = 'AED' AND method = 'cash' THEN amount ELSE 0 END) AS cash,
            COUNT(*) AS count
     FROM expenses GROUP BY month ORDER BY month DESC`,
  );
  return rows.map(r => ({
    month: String(r.month),
    total: Number(r.total ?? 0),
    cash: Number(r.cash ?? 0),
    count: Number(r.count ?? 0),
  }));
}

/** AED total per calendar day ("2026-11-03", local time) with start <= created_at < end. */
export async function listDayTotals(
  start: number,
  end: number,
): Promise<Map<string, number>> {
  const { rows } = await getDb().execute(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS day,
            SUM(amount) AS total
     FROM expenses
     WHERE currency = 'AED' AND created_at >= ? AND created_at < ?
     GROUP BY day`,
    [start, end],
  );
  return new Map(rows.map(r => [String(r.day), Number(r.total ?? 0)]));
}

export type MonthCategoryTotal = {
  month: string;
  category: string;
  total: number;
};

/** AED totals per month and category (local time). */
export async function listMonthCategoryTotals(): Promise<MonthCategoryTotal[]> {
  const { rows } = await getDb().execute(
    `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', 'localtime') AS month,
            category, SUM(amount) AS total
     FROM expenses WHERE currency = 'AED'
     GROUP BY month, category`,
  );
  return rows.map(r => ({
    month: String(r.month),
    category: String(r.category),
    total: Number(r.total ?? 0),
  }));
}

export async function deleteExpense(id: number) {
  await getDb().execute('DELETE FROM expenses WHERE id = ?', [id]);
}

/** Deletes the given expenses in one transaction. Returns rows removed. */
export async function deleteExpensesByIds(ids: number[]): Promise<number> {
  let removed = 0;
  await getDb().transaction(async tx => {
    // SQLite caps bound parameters per statement, so go in chunks.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const result = await tx.execute(
        `DELETE FROM expenses WHERE id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      removed += result.rowsAffected;
    }
  });
  return removed;
}

/** The oldest expense's time (unix ms), or null when there are none. */
export async function firstExpenseAt(): Promise<number | null> {
  const { rows } = await getDb().execute(
    'SELECT MIN(created_at) AS first FROM expenses',
  );
  return rows[0]?.first != null ? Number(rows[0].first) : null;
}

/** Deletes everything, or only the given [start, end) range. Returns rows removed. */
export async function clearExpenses(range?: {
  start: number;
  end: number;
}): Promise<number> {
  const result = range
    ? await getDb().execute(
        'DELETE FROM expenses WHERE created_at >= ? AND created_at < ?',
        [range.start, range.end],
      )
    : await getDb().execute('DELETE FROM expenses');
  return result.rowsAffected;
}

export function toCsv(items: Expense[]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header =
    'Date,Merchant,Amount,Currency,Category,Paid with,Card,Source,Note';
  const lines = items.map(e =>
    [
      new Date(e.created_at).toISOString(),
      e.merchant,
      e.amount.toFixed(2),
      e.currency,
      e.category,
      e.method,
      e.card,
      e.source,
      e.note,
    ]
      .map(esc)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
