import { open, type DB } from '@op-engineering/op-sqlite';

import { shiftMonth } from './months';
import { isSpending } from './parse';
import { parseSearch, tagsIn } from './searchQuery';

export type PaymentMethod = 'card' | 'cash';

export type Expense = {
  id: number;
  amount: number;
  currency: string;
  merchant: string;
  card: string | null;
  category: string;
  source: 'apple_pay' | 'manual' | 'statement' | 'recurring';
  /** How it was paid: card (Apple Pay, bank statement, or entered by hand) or cash. */
  method: PaymentMethod;
  note: string | null;
  created_at: number; // unix ms
  /** What a non-AED expense was worth in AED (filled in from exchange rates); null for AED. */
  aed_amount?: number | null;
  /** Shared by the parts of one payment split across categories. */
  split_id?: string | null;
};

/** The expense in AED for totals, or null if it's in another currency and has no rate yet. */
export const aedOf = (e: Pick<Expense, 'amount' | 'currency' | 'aed_amount'>) =>
  e.currency === 'AED' ? e.amount : e.aed_amount ?? null;

/** Total in AED of the expenses that have an AED value. */
export const sumAed = (items: Expense[]) =>
  items.reduce((sum, e) => sum + (aedOf(e) ?? 0), 0);

/** The same, counting only spending (not transfers or cash withdrawals). */
export const sumSpent = (items: Expense[]) =>
  sumAed(items.filter(e => isSpending(e.category)));

/** SQL for the same, for SUM(): AED amounts, converted ones, and 0 for the rest. */
const AED_SQL =
  "COALESCE(CASE WHEN currency = 'AED' THEN amount ELSE aed_amount END, 0)";

/** True for spending; transfers and cash withdrawals move money but aren't spent (parse.ts). */
const SPENDING_SQL = "category NOT IN ('Transfers', 'Cash withdrawal')";

/** Columns copied between `expenses` and the `deleted_expenses` bin. */
const EXPENSE_COLUMNS =
  'id, amount, currency, merchant, card, category, source, note, created_at, method, aed_amount, split_id';

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

const DATABASE_VERSION = 8;

let db: DB | null = null;

/** The app's database; feature modules (backup, budgets, recurring, receipts) build on it. */
export function getDb(): DB {
  if (!db) db = open({ name: 'expenses.db' });
  return db;
}

/** ALTER TABLE … ADD COLUMN that can run twice (if an upgrade stopped half way). */
async function addColumnIfMissing(
  d: DB,
  table: string,
  column: string,
  type: string,
) {
  const { rows } = await d.execute(`PRAGMA table_info(${table})`);
  if (rows.some(r => r.name === column)) return;
  await d.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
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
  if (current < 6) {
    // AED value of foreign-currency expenses, so they count in totals.
    await addColumnIfMissing(d, 'expenses', 'aed_amount', 'REAL');
    // Deleted expenses wait here for 30 days, so a delete can be undone.
    await d.execute(`CREATE TABLE IF NOT EXISTS deleted_expenses (
      id INTEGER PRIMARY KEY,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      merchant TEXT NOT NULL,
      card TEXT,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      method TEXT NOT NULL,
      aed_amount REAL,
      deleted_at INTEGER NOT NULL
    )`);
    // essentials / lifestyle / other, for the spending-health chart.
    await addColumnIfMissing(
      d,
      'categories',
      'grp',
      "TEXT NOT NULL DEFAULT 'other'",
    );
    await d.execute(`CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      amount REAL NOT NULL
    )`);
    await d.execute(`CREATE TABLE IF NOT EXISTS recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      merchant TEXT NOT NULL,
      category TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'card',
      note TEXT,
      day INTEGER NOT NULL,
      next_at INTEGER NOT NULL,
      remind INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`);
    // Receipt photos as JPEG base64, one per expense; they stay on the phone.
    await d.execute(`CREATE TABLE IF NOT EXISTS receipts (
      expense_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
  }
  if (current < 7) {
    await addColumnIfMissing(d, 'expenses', 'split_id', 'TEXT');
    await addColumnIfMissing(d, 'deleted_expenses', 'split_id', 'TEXT');
    // Savings goals ("Trip to Georgia, AED 5,000 by March") and money put towards them.
    await d.execute(`CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target REAL NOT NULL,
      deadline INTEGER,
      emoji TEXT,
      created_at INTEGER NOT NULL,
      done_at INTEGER
    )`);
    await d.execute(`CREATE TABLE IF NOT EXISTS goal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    // Money lent and borrowed: who, how much, which way, and when it was settled.
    await d.execute(`CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person TEXT NOT NULL,
      amount REAL NOT NULL,
      direction TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      due_at INTEGER,
      settled_at INTEGER
    )`);
  }
  if (current < 8) {
    // Money in: transfers from others, refunds (salary has its own table).
    await d.execute(`CREATE TABLE IF NOT EXISTS income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      note TEXT,
      created_at INTEGER NOT NULL
    )`);
    await d.execute(
      'CREATE INDEX IF NOT EXISTS idx_income_created_at ON income (created_at)',
    );
    // Receipt photos move out of the database into files (Library/receipts/<file>).
    await addColumnIfMissing(d, 'receipts', 'file', 'TEXT');
  }
  await d.execute(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

export async function insertExpense(e: NewExpense): Promise<number> {
  const result = await getDb().execute(
    `INSERT INTO expenses (amount, currency, merchant, card, category, source, method, note, created_at, split_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      e.split_id ?? null,
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

export type CategoryGroup = 'essentials' | 'lifestyle' | 'other';

export type CustomCategory = { name: string; group: CategoryGroup };

const asGroup = (v: unknown): CategoryGroup =>
  v === 'essentials' || v === 'lifestyle' ? v : 'other';

/** Categories the user added, oldest first. */
export async function listCustomCategories(): Promise<CustomCategory[]> {
  const { rows } = await getDb().execute(
    'SELECT name, grp FROM categories ORDER BY created_at',
  );
  return rows.map(r => ({ name: String(r.name), group: asGroup(r.grp) }));
}

export async function addCustomCategory(
  name: string,
  group: CategoryGroup = 'other',
) {
  await getDb().execute(
    'INSERT OR IGNORE INTO categories (name, created_at, grp) VALUES (?, ?, ?)',
    [name, Date.now(), group],
  );
}

export async function setCategoryGroup(name: string, group: CategoryGroup) {
  await getDb().execute('UPDATE categories SET grp = ? WHERE name = ?', [
    group,
    name,
  ]);
}

/** Renames a category the user added, everywhere it's used. */
export async function renameCustomCategory(from: string, to: string) {
  await getDb().transaction(async tx => {
    for (const table of ['expenses', 'deleted_expenses', 'recurring']) {
      await tx.execute(`UPDATE ${table} SET category = ? WHERE category = ?`, [
        to,
        from,
      ]);
    }
    await tx.execute(
      'UPDATE merchant_categories SET category = ? WHERE category = ?',
      [to, from],
    );
    await tx.execute(
      'UPDATE OR REPLACE budgets SET category = ? WHERE category = ?',
      [to, from],
    );
    await tx.execute('UPDATE categories SET name = ? WHERE name = ?', [
      to,
      from,
    ]);
  });
}

export type RememberedMerchant = {
  merchant: string;
  category: string;
  updated_at: number;
};

/** Merchants whose category the app remembers, most recently changed first. */
export async function listRememberedMerchants(): Promise<RememberedMerchant[]> {
  const { rows } = await getDb().execute(
    'SELECT merchant, category, updated_at FROM merchant_categories ORDER BY updated_at DESC',
  );
  return rows as unknown as RememberedMerchant[];
}

export async function forgetMerchant(merchantKeyValue: string) {
  await getDb().execute('DELETE FROM merchant_categories WHERE merchant = ?', [
    merchantKeyValue,
  ]);
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
    await tx.execute(
      "UPDATE recurring SET category = 'Other' WHERE category = ?",
      [name],
    );
    await tx.execute('DELETE FROM budgets WHERE category = ?', [name]);
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
 * Expenses with the same amount within ±2 days of `at`, for spotting a statement line
 * that's already logged (compare the merchant with sameShop in merchants.ts).
 */
export async function listSimilarExpenses(
  amount: number,
  at: number,
): Promise<Pick<Expense, 'merchant' | 'source'>[]> {
  const window = 2 * 86_400_000;
  const { rows } = await getDb().execute(
    `SELECT merchant, source FROM expenses
     WHERE ABS(amount - ?) < 0.005 AND created_at BETWEEN ? AND ?`,
    [amount, at - window, at + window],
  );
  return rows as unknown as Pick<Expense, 'merchant' | 'source'>[];
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
            SUM(CASE WHEN ${SPENDING_SQL} THEN ${AED_SQL} ELSE 0 END) AS total,
            SUM(CASE WHEN method = 'cash' AND ${SPENDING_SQL} THEN ${AED_SQL} ELSE 0 END) AS cash,
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
            SUM(${AED_SQL}) AS total
     FROM expenses
     WHERE created_at >= ? AND created_at < ? AND ${SPENDING_SQL}
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
            category, SUM(${AED_SQL}) AS total
     FROM expenses
     WHERE ${SPENDING_SQL}
     GROUP BY month, category`,
  );
  return rows.map(r => ({
    month: String(r.month),
    category: String(r.category),
    total: Number(r.total ?? 0),
  }));
}

/** The other parts of a split payment, oldest first. */
export async function listSplitParts(splitId: string): Promise<Expense[]> {
  const { rows } = await getDb().execute(
    'SELECT * FROM expenses WHERE split_id = ? ORDER BY id',
    [splitId],
  );
  return rows as unknown as Expense[];
}

/** Moves one expense to the bin (see deleteExpensesByIds). */
export async function deleteExpense(id: number) {
  await deleteExpensesByIds([id]);
}

export type ExpenseSearch = {
  /** What was typed: words, #tags, an amount or a range (see parseSearch). */
  text?: string;
  /** #tags that must all be in the note. */
  tags?: string[];
  start: number;
  end: number;
  categories?: string[];
  method?: PaymentMethod;
  sources?: Expense['source'][];
  minAmount?: number;
  maxAmount?: number;
  sort?: 'newest' | 'oldest' | 'highest' | 'lowest';
};

const SORT_SQL: Record<NonNullable<ExpenseSearch['sort']>, string> = {
  newest: 'created_at DESC',
  oldest: 'created_at ASC',
  highest: 'amount DESC, created_at DESC',
  lowest: 'amount ASC, created_at DESC',
};

/** Expenses matching every given filter. */
export async function searchExpenses(q: ExpenseSearch): Promise<Expense[]> {
  const where = ['created_at >= ?', 'created_at < ?'];
  const args: (string | number)[] = [q.start, q.end];
  const parsed = parseSearch(q.text ?? '');
  // Escape LIKE wildcards so "50%" or "a_b" are searched literally.
  const like = (v: string) => `%${v.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const parts: string[] = [];
  if (parsed.words) {
    const w = like(parsed.words);
    parts.push(
      "merchant LIKE ? ESCAPE '\\'",
      "note LIKE ? ESCAPE '\\'",
      "card LIKE ? ESCAPE '\\'",
      "category LIKE ? ESCAPE '\\'",
    );
    args.push(w, w, w, w);
  }
  if (parsed.exact != null) {
    parts.push('ABS(amount - ?) < 0.005');
    args.push(parsed.exact);
  }
  if (parts.length) where.push(`(${parts.join(' OR ')})`);
  for (const tag of [...parsed.tags, ...(q.tags ?? [])]) {
    where.push("note LIKE ? ESCAPE '\\'");
    args.push(like(tag));
  }
  const min = Math.max(parsed.min ?? -Infinity, q.minAmount ?? -Infinity);
  const max = Math.min(parsed.max ?? Infinity, q.maxAmount ?? Infinity);
  if (Number.isFinite(min)) {
    where.push('amount >= ?');
    args.push(min);
  }
  if (Number.isFinite(max)) {
    where.push('amount <= ?');
    args.push(max);
  }
  if (q.categories?.length) {
    where.push(`category IN (${q.categories.map(() => '?').join(',')})`);
    args.push(...q.categories);
  }
  if (q.method) {
    where.push('method = ?');
    args.push(q.method);
  }
  if (q.sources?.length) {
    where.push(`source IN (${q.sources.map(() => '?').join(',')})`);
    args.push(...q.sources);
  }
  const { rows } = await getDb().execute(
    `SELECT * FROM expenses WHERE ${where.join(' AND ')}
     ORDER BY ${SORT_SQL[q.sort ?? 'newest']}`,
    args,
  );
  return rows as unknown as Expense[];
}

/** What was paid at this merchant last time (for "same as last time"), or null. */
export async function lastAmountAt(
  merchant: string,
): Promise<{ amount: number; currency: string } | null> {
  const name = merchant.trim();
  if (name.length < 2) return null;
  const { rows } = await getDb().execute(
    'SELECT amount, currency FROM expenses WHERE merchant = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1',
    [name],
  );
  return rows[0]
    ? { amount: Number(rows[0].amount), currency: String(rows[0].currency) }
    : null;
}

/** Every #tag used in notes, most used first. */
export async function listTags(): Promise<string[]> {
  const { rows } = await getDb().execute(
    "SELECT note FROM expenses WHERE note LIKE '%#%'",
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const tag of tagsIn(String(r.note))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** Every category used by at least one expense, most used first. */
export async function listUsedCategories(): Promise<string[]> {
  const { rows } = await getDb().execute(
    'SELECT category, COUNT(*) AS n FROM expenses GROUP BY category ORDER BY n DESC',
  );
  return rows.map(r => String(r.category));
}

const placeholders = (n: number) => Array(n).fill('?').join(',');

/** SQLite caps bound parameters per statement, so long id lists go in chunks. */
function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Moves the given expenses to the bin (deleted_expenses), where they can be restored for
 * 30 days. Returns how many were removed.
 */
export async function deleteExpensesByIds(ids: number[]): Promise<number> {
  let removed = 0;
  const now = Date.now();
  await getDb().transaction(async tx => {
    for (const chunk of chunks(ids)) {
      const marks = placeholders(chunk.length);
      await tx.execute(
        `INSERT OR REPLACE INTO deleted_expenses (${EXPENSE_COLUMNS}, deleted_at)
         SELECT ${EXPENSE_COLUMNS}, ? FROM expenses WHERE id IN (${marks})`,
        [now, ...chunk],
      );
      const result = await tx.execute(
        `DELETE FROM expenses WHERE id IN (${marks})`,
        chunk,
      );
      removed += result.rowsAffected;
    }
  });
  return removed;
}

/** Puts expenses from the bin back. Returns how many came back. */
export async function restoreExpenses(ids: number[]): Promise<number> {
  let restored = 0;
  await getDb().transaction(async tx => {
    for (const chunk of chunks(ids)) {
      const marks = placeholders(chunk.length);
      const result = await tx.execute(
        `INSERT OR IGNORE INTO expenses (${EXPENSE_COLUMNS})
         SELECT ${EXPENSE_COLUMNS} FROM deleted_expenses WHERE id IN (${marks})`,
        chunk,
      );
      restored += result.rowsAffected;
      await tx.execute(
        `DELETE FROM deleted_expenses WHERE id IN (${marks})`,
        chunk,
      );
    }
  });
  return restored;
}

export type DeletedExpense = Expense & { deleted_at: number };

/** The bin, most recently deleted first. */
export async function listDeletedExpenses(): Promise<DeletedExpense[]> {
  const { rows } = await getDb().execute(
    'SELECT * FROM deleted_expenses ORDER BY deleted_at DESC, created_at DESC',
  );
  return rows as unknown as DeletedExpense[];
}

/** Empties the bin for good: all of it, the given ids, or what's older than `olderThan` (ms). */
export async function purgeDeletedExpenses(
  opts: { ids?: number[]; olderThan?: number } = {},
): Promise<number> {
  const d = getDb();
  let where = '';
  let args: number[] = [];
  if (opts.ids) {
    if (opts.ids.length === 0) return 0;
    where = `WHERE id IN (${placeholders(opts.ids.length)})`;
    args = opts.ids;
  } else if (opts.olderThan != null) {
    where = 'WHERE deleted_at < ?';
    args = [opts.olderThan];
  }
  let removed = 0;
  await d.transaction(async tx => {
    // Their receipt photos are removed by tidyReceipts (receipts.ts), files included.
    const result = await tx.execute(
      `DELETE FROM deleted_expenses ${where}`,
      args,
    );
    removed = result.rowsAffected;
  });
  return removed;
}

/** Non-AED expenses still missing their AED value, by currency. */
export async function listUnconvertedCurrencies(): Promise<string[]> {
  const { rows } = await getDb().execute(
    "SELECT DISTINCT currency FROM expenses WHERE currency != 'AED' AND aed_amount IS NULL",
  );
  return rows.map(r => String(r.currency));
}

/** Fills in the AED value for one currency, from `perAed` units of it per 1 AED. */
export async function setAedAmounts(currency: string, perAed: number) {
  if (!(perAed > 0)) return;
  await getDb().execute(
    'UPDATE expenses SET aed_amount = ROUND(amount / ?, 2) WHERE currency = ? AND aed_amount IS NULL',
    [perAed, currency],
  );
}

/** The oldest expense's time (unix ms), or null when there are none. */
export async function firstExpenseAt(): Promise<number | null> {
  const { rows } = await getDb().execute(
    'SELECT MIN(created_at) AS first FROM expenses',
  );
  return rows[0]?.first != null ? Number(rows[0].first) : null;
}

/** Every table holding the user's data; wipeAllData empties them all. */
const USER_TABLES = [
  'expenses',
  'income',
  'deleted_expenses',
  'receipts',
  'salary',
  'categories',
  'merchant_categories',
  'budgets',
  'recurring',
  'goals',
  'goal_entries',
  'debts',
  'meta',
];

/**
 * Removes everything this app stores on the phone (account deletion, or clearing another
 * account's data). Scheduled reminders are cancelled by the caller (see dataOwner.ts).
 */
export async function wipeAllData() {
  // Only tables that exist (an older database may not have every one yet).
  const { rows } = await getDb().execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const existing = new Set(rows.map(r => String(r.name)));
  await getDb().transaction(async tx => {
    for (const table of USER_TABLES) {
      if (existing.has(table)) await tx.execute(`DELETE FROM ${table}`);
    }
  });
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
  if (!range) {
    // Everything means everything: the bin and receipt photos too.
    // Receipt photos go with the next tidyReceipts (receipts.ts), files included.
    await getDb().execute('DELETE FROM deleted_expenses');
  }
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
