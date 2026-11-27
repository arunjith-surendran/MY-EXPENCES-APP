/**
 * The app's real SQL (src/lib/db.ts and the feature modules) against a real SQLite database.
 */
import {
  addCustomCategory,
  deleteCustomCategory,
  deleteExpensesByIds,
  getDb,
  insertExpense,
  listDeletedExpenses,
  listExpenses,
  listMonthSummaries,
  listTags,
  migrateDbIfNeeded,
  purgeDeletedExpenses,
  renameCustomCategory,
  restoreExpenses,
  searchExpenses,
  setAedAmounts,
  setMerchantCategory,
  wipeAllData,
} from '../src/lib/db';
import { budgetProgress, setBudget } from '../src/lib/budgets';
import { createBackup, restoreBackup } from '../src/lib/backup';
import {
  addDueRecurring,
  addRecurring,
  listRecurring,
} from '../src/lib/recurring';
import { resetDatabase, shared } from '../test-support/sqlite';

jest.mock(
  '@op-engineering/op-sqlite',
  () => require('../test-support/sqlite').mock,
);

const NOV = (day: number) => new Date(2026, 10, day, 12).getTime();
const ALL = { start: 0, end: Number.MAX_SAFE_INTEGER };

const add = (
  merchant: string,
  amount: number,
  extra: Partial<Parameters<typeof insertExpense>[0]> = {},
) =>
  insertExpense({
    amount,
    currency: 'AED',
    merchant,
    card: null,
    category: 'Other',
    source: 'manual',
    note: null,
    created_at: NOV(5),
    ...extra,
  });

beforeEach(async () => {
  resetDatabase();
  await migrateDbIfNeeded();
});

describe('upgrade', () => {
  it('creates every table on a fresh install', async () => {
    const { rows } = await getDb().execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(rows.map(r => r.name)).toEqual(
      expect.arrayContaining([
        'expenses',
        'deleted_expenses',
        'budgets',
        'recurring',
        'receipts',
        'goals',
        'goal_entries',
        'debts',
      ]),
    );
    const { rows: v } = await getDb().execute('PRAGMA user_version');
    expect(v[0].user_version).toBe(8);
  });

  it('keeps the data of a version 5 database', async () => {
    resetDatabase();
    shared.db.exec(`
      CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AED', merchant TEXT NOT NULL, card TEXT,
        category TEXT NOT NULL, source TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL,
        method TEXT NOT NULL DEFAULT 'card');
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE salary (month TEXT PRIMARY KEY, amount REAL NOT NULL);
      CREATE TABLE categories (name TEXT PRIMARY KEY COLLATE NOCASE, created_at INTEGER NOT NULL);
      CREATE TABLE merchant_categories (merchant TEXT PRIMARY KEY, category TEXT NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO expenses (amount, merchant, category, source, created_at) VALUES (12.5, 'Old', 'Fuel', 'manual', 1);
      INSERT INTO categories VALUES ('Kids', 1);
      PRAGMA user_version = 5;
    `);
    await migrateDbIfNeeded();
    const rows = await listExpenses(0, 10);
    expect(rows[0]).toMatchObject({
      merchant: 'Old',
      amount: 12.5,
      aed_amount: null,
    });
    const { rows: c } = await getDb().execute(
      'SELECT name, grp FROM categories',
    );
    expect(c).toEqual([{ name: 'Kids', grp: 'other' }]);
  });

  it('can run again after stopping half way', async () => {
    await getDb().execute('PRAGMA user_version = 5');
    await expect(migrateDbIfNeeded()).resolves.toBeUndefined();
  });
});

describe('bin', () => {
  it('moves deleted expenses to the bin and back', async () => {
    const a = await add('Carrefour', 40);
    const b = await add('ENOC', 60);
    expect(await deleteExpensesByIds([a, b])).toBe(2);
    expect(await listExpenses(0, NOV(30))).toHaveLength(0);
    expect((await listDeletedExpenses()).map(e => e.merchant).sort()).toEqual([
      'Carrefour',
      'ENOC',
    ]);
    expect(await restoreExpenses([a])).toBe(1);
    expect((await listExpenses(0, NOV(30))).map(e => e.id)).toEqual([a]);
    expect(await purgeDeletedExpenses()).toBe(1);
    expect(await listDeletedExpenses()).toHaveLength(0);
  });
});

describe('totals in AED', () => {
  it('counts foreign payments once they have a rate', async () => {
    await add('Dubai Mall', 100);
    await add('Amazon US', 27.23, { currency: 'USD' });
    expect((await listMonthSummaries())[0].total).toBe(100);
    await setAedAmounts('USD', 0.2723);
    expect((await listMonthSummaries())[0].total).toBe(200);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await add('Carrefour MOE', 45.5, { category: 'Groceries' });
    await add('50% off_shop', 10);
    await add('Talabat', 120, { note: 'Team lunch #work' });
    await add('Uber', 30, { method: 'cash', note: '#trip #work' });
  });

  const names = async (q: Parameters<typeof searchExpenses>[0]) =>
    (await searchExpenses(q)).map(e => e.merchant).sort();

  it('finds words in the merchant, note or category', async () => {
    expect(await names({ ...ALL, text: 'carre' })).toEqual(['Carrefour MOE']);
    expect(await names({ ...ALL, text: 'groceries' })).toEqual([
      'Carrefour MOE',
    ]);
    expect(await names({ ...ALL, text: 'lunch' })).toEqual(['Talabat']);
  });

  it('treats % and _ literally', async () => {
    expect(await names({ ...ALL, text: '50% off_' })).toEqual(['50% off_shop']);
  });

  it('finds amounts and ranges', async () => {
    expect(await names({ ...ALL, text: '45.50' })).toEqual(['Carrefour MOE']);
    expect(await names({ ...ALL, text: '30-50' })).toEqual([
      'Carrefour MOE',
      'Uber',
    ]);
    expect(await names({ ...ALL, text: '>100' })).toEqual(['Talabat']);
  });

  it('filters by tag, method and category', async () => {
    expect(await names({ ...ALL, text: '#work' })).toEqual(['Talabat', 'Uber']);
    expect(await names({ ...ALL, tags: ['#trip'] })).toEqual(['Uber']);
    expect(await names({ ...ALL, method: 'cash' })).toEqual(['Uber']);
    expect(await names({ ...ALL, categories: ['Groceries'] })).toEqual([
      'Carrefour MOE',
    ]);
    expect(await listTags()).toEqual(['#work', '#trip']);
  });
});

describe('categories', () => {
  it('renames a category everywhere it is used', async () => {
    await addCustomCategory('Kids', 'essentials');
    await add('Toy shop', 80, { category: 'Kids' });
    await setMerchantCategory('Toy shop', 'Kids');
    await setBudget('Kids', 500);
    await renameCustomCategory('Kids', 'Children');
    expect((await listExpenses(0, NOV(30)))[0].category).toBe('Children');
    expect((await budgetProgress('2026-11'))[0]).toMatchObject({
      category: 'Children',
      spent: 80,
    });
  });

  it('moves expenses to Other when a category is deleted', async () => {
    await addCustomCategory('Gym');
    await add('Fitness First', 300, { category: 'Gym' });
    await setBudget('Gym', 400);
    await deleteCustomCategory('Gym');
    expect((await listExpenses(0, NOV(30)))[0].category).toBe('Other');
    expect(await budgetProgress('2026-11')).toHaveLength(0);
  });
});

describe('recurring', () => {
  it('adds each payment that came due, once', async () => {
    await addRecurring({
      amount: 3500,
      merchant: 'Rent',
      category: 'Bills & Utilities',
      method: 'card',
      note: null,
      day: 1,
      remind: false,
      after: new Date(2026, 8, 1, 9).getTime(), // starts 1 Oct
    });
    const now = new Date(2026, 10, 15).getTime(); // 15 Nov
    expect(await addDueRecurring(now)).toBe(2); // 1 Oct and 1 Nov
    expect(await addDueRecurring(now)).toBe(0);
    const rows = await searchExpenses({ ...ALL, sources: ['recurring'] });
    expect(
      rows.map(r => new Date(r.created_at).getMonth()).sort((a, b) => a - b),
    ).toEqual([9, 10]);
    expect(new Date((await listRecurring())[0].next_at).getMonth()).toBe(11);
  });
});

describe('backup', () => {
  it('restores everything with replace', async () => {
    await add('Carrefour', 40);
    await setBudget('Groceries', 900);
    const backup = await createBackup(true);
    await wipeAllData();
    expect(await listExpenses(0, NOV(30))).toHaveLength(0);
    expect(await restoreBackup(backup, 'replace')).toBe(1);
    expect((await listExpenses(0, NOV(30)))[0].merchant).toBe('Carrefour');
    expect(await budgetProgress('2026-11')).toHaveLength(1);
  });

  it('adds only what is missing with merge', async () => {
    await add('Carrefour', 40);
    const backup = await createBackup(false);
    await add('ENOC', 60);
    expect(await restoreBackup(backup, 'merge')).toBe(0);
    expect(await listExpenses(0, NOV(30))).toHaveLength(2);
  });
});

describe('goals and debts', () => {
  it('adds up money put towards a goal', async () => {
    const { addGoal, addToGoal, listGoals } = require('../src/lib/goals');
    const id = await addGoal({
      name: 'Trip',
      target: 1000,
      deadline: null,
      emoji: '✈️',
    });
    await addToGoal(id, 300);
    await addToGoal(id, -50);
    expect((await listGoals())[0]).toMatchObject({ name: 'Trip', saved: 250 });
  });

  it('keeps open debts first and settles them', async () => {
    const { addDebt, listDebts, settleDebt } = require('../src/lib/debts');
    const a = await addDebt({
      person: 'Ahmed',
      amount: 120,
      direction: 'owed_to_me',
      note: null,
      due_at: null,
    });
    await addDebt({
      person: 'Sara',
      amount: 50,
      direction: 'i_owe',
      note: null,
      due_at: null,
    });
    await settleDebt(a, true);
    expect(
      (await listDebts()).map((d: { person: string }) => d.person),
    ).toEqual(['Sara', 'Ahmed']);
  });

  it('wipes every table', async () => {
    const { addGoal } = require('../src/lib/goals');
    await add('Carrefour', 10);
    await addGoal({ name: 'Car', target: 9000, deadline: null, emoji: null });
    await wipeAllData();
    const { rows } = await getDb().execute(
      'SELECT (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM goals) AS n',
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('spending, money in and duplicates', () => {
  it('leaves transfers and cash withdrawals out of spending totals', async () => {
    await add('Carrefour', 100, { category: 'Groceries' });
    await add('Bank transfer', 4000, { category: 'Transfers' });
    await add('ATM', 500, { category: 'Cash withdrawal' });
    const [m] = await listMonthSummaries();
    expect(m).toMatchObject({ total: 100, count: 3 });
  });

  it('stores money in separately', async () => {
    const { addIncome, listIncome } = require('../src/lib/income');
    await addIncome([
      {
        amount: 500,
        source: 'Transfer from Sam',
        kind: 'transfer_in',
        note: null,
        created_at: NOV(2),
      },
    ]);
    expect((await listIncome(0, NOV(30)))[0]).toMatchObject({
      amount: 500,
      kind: 'transfer_in',
    });
    expect(await listMonthSummaries()).toHaveLength(0); // not an expense
  });

  it('finds same-amount expenses near a date for the duplicate check', async () => {
    const { listSimilarExpenses } = require('../src/lib/db');
    await add('Akawi Oven DMCC', 12, { created_at: NOV(5) });
    expect(await listSimilarExpenses(12, NOV(6))).toEqual([
      { merchant: 'Akawi Oven DMCC', source: 'manual' },
    ]);
    expect(await listSimilarExpenses(12, NOV(9))).toEqual([]);
  });

  it('says a backup is due once there is real data and no recent backup', async () => {
    const { backupDue } = require('../src/lib/backupReminder');
    expect((await backupDue()).due).toBe(false); // too few expenses
    for (let i = 0; i < 20; i++) await add(`Shop ${i}`, 1);
    expect(await backupDue()).toEqual({ due: true, days: null });
    const { setMeta } = require('../src/lib/db');
    await setMeta('last_backup_at', new Date().toISOString());
    expect((await backupDue()).due).toBe(false);
  });
});
