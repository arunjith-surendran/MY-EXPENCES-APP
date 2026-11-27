import { open, type DB } from '@op-engineering/op-sqlite';

import { shiftMonth } from './months';

export type Expense = {
  id: number;
  amount: number;
  currency: string;
  merchant: string;
  card: string | null;
  category: string;
  source: 'apple_pay' | 'manual' | 'statement';
  note: string | null;
  created_at: number; // unix ms
};

export type NewExpense = Omit<Expense, 'id' | 'created_at'> & {
  created_at?: number;
};

export type ExpenseUpdate = Pick<
  Expense,
  'amount' | 'merchant' | 'category' | 'note' | 'created_at'
>;

export type MonthSummary = { month: string; total: number; count: number };

const DATABASE_VERSION = 3;

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
  await d.execute(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

export async function insertExpense(e: NewExpense): Promise<number> {
  const result = await getDb().execute(
    `INSERT INTO expenses (amount, currency, merchant, card, category, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.amount,
      e.currency,
      e.merchant,
      e.card,
      e.category,
      e.source,
      e.note,
      e.created_at ?? Date.now(),
    ],
  );
  return result.insertId ?? 0;
}

export async function updateExpense(id: number, e: ExpenseUpdate) {
  await getDb().execute(
    'UPDATE expenses SET amount = ?, merchant = ?, category = ?, note = ?, created_at = ? WHERE id = ?',
    [e.amount, e.merchant, e.category, e.note, e.created_at, id],
  );
}

export async function getExpense(id: number): Promise<Expense | null> {
  const { rows } = await getDb().execute(
    'SELECT * FROM expenses WHERE id = ?',
    [id],
  );
  return (rows[0] as unknown as Expense) ?? null;
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
        `INSERT INTO expenses (amount, currency, merchant, card, category, source, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.amount,
          e.currency,
          e.merchant,
          e.card,
          e.category,
          e.source,
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
            COUNT(*) AS count
     FROM expenses GROUP BY month ORDER BY month DESC`,
  );
  return rows.map(r => ({
    month: String(r.month),
    total: Number(r.total ?? 0),
    count: Number(r.count ?? 0),
  }));
}

export async function deleteExpense(id: number) {
  await getDb().execute('DELETE FROM expenses WHERE id = ?', [id]);
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
  const header = 'Date,Merchant,Amount,Currency,Category,Card,Source,Note';
  const lines = items.map(e =>
    [
      new Date(e.created_at).toISOString(),
      e.merchant,
      e.amount.toFixed(2),
      e.currency,
      e.category,
      e.card,
      e.source,
      e.note,
    ]
      .map(esc)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
