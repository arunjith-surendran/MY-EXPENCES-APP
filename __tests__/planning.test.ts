import { debtTotals, type Debt } from '../src/lib/debts';
import { monthlyNeeded } from '../src/lib/goals';
import { runsOutOn } from '../src/lib/budgets';
import { summarizeWeek, summaryText, weekStartOf } from '../src/lib/weekly';
import { lockedBox } from '../src/lib/backup';
import { yearHint } from '../src/lib/statement';

jest.mock('../src/lib/db', () => ({
  getDb: jest.fn(),
  getMeta: jest.fn(),
  setMeta: jest.fn(),
  listExpenses: jest.fn(),
  aedOf: jest.fn(),
}));
jest.mock('../src/lib/notifications', () => ({
  notifyNow: jest.fn(),
  scheduleNotification: jest.fn(),
  cancelNotification: jest.fn(),
}));

describe('monthlyNeeded', () => {
  const now = new Date(2026, 10, 15);
  it('spreads what is left over the months to the deadline', () => {
    const deadline = new Date(2027, 2, 31).getTime(); // end of March: Nov..Mar = 5 months
    expect(monthlyNeeded({ target: 5000, saved: 0, deadline }, now)).toBe(1000);
  });
  it('is 0 once reached and null without a deadline', () => {
    expect(
      monthlyNeeded({ target: 100, saved: 150, deadline: Date.now() }, now),
    ).toBe(0);
    expect(
      monthlyNeeded({ target: 100, saved: 0, deadline: null }, now),
    ).toBeNull();
  });
});

describe('debtTotals', () => {
  const d = (
    amount: number,
    direction: Debt['direction'],
    settled = false,
  ): Debt => ({
    id: amount,
    person: 'x',
    amount,
    direction,
    note: null,
    created_at: 0,
    due_at: null,
    settled_at: settled ? 1 : null,
  });
  it('adds open debts each way and skips settled ones', () => {
    expect(
      debtTotals([
        d(100, 'owed_to_me'),
        d(50, 'i_owe'),
        d(999, 'owed_to_me', true),
      ]),
    ).toEqual({ owedToMe: 100, iOwe: 50 });
  });
});

describe('runsOutOn', () => {
  it('predicts the day at the current pace', () => {
    // 600 of 1000 by the 10th → 60/day → runs out on the 17th.
    expect(runsOutOn(600, 1000, 10, 30)).toBe(17);
  });
  it("is null when it won't run out this month or it's too early to tell", () => {
    expect(runsOutOn(200, 1000, 10, 30)).toBeNull();
    expect(runsOutOn(900, 1000, 2, 30)).toBeNull();
    expect(runsOutOn(1200, 1000, 10, 30)).toBeNull();
  });
});

describe('weekly summary', () => {
  it('starts weeks on Monday', () => {
    expect(weekStartOf(new Date(2026, 10, 29)).getDate()).toBe(23); // Sun 29 → Mon 23
    expect(weekStartOf(new Date(2026, 10, 23)).getDate()).toBe(23);
  });
  it('compares with the usual week and names the top category', () => {
    const s = summarizeWeek(
      [
        { category: 'Food & Dining', aed: 300 },
        { category: 'Fuel', aed: 100 },
      ],
      [500, 500, 0, 500],
    );
    expect(s).toEqual({ total: 400, usual: 500, topCategory: 'Food & Dining' });
    expect(summaryText(s)).toBe(
      'You spent AED 400.00 last week, 20% less than usual. Most on Food & Dining.',
    );
  });
});

describe('lockedBox', () => {
  it('recognises password-protected backups only', () => {
    const box = { salt: 's', iv: 'i', data: 'd', mac: 'm', iter: 1 };
    expect(
      lockedBox(JSON.stringify({ app: 'expences', format: 1, encrypted: box })),
    ).toEqual(box);
    expect(
      lockedBox(JSON.stringify({ app: 'expences', tables: {} })),
    ).toBeNull();
    expect(lockedBox('nope')).toBeNull();
  });
});

describe('yearHint', () => {
  it('uses the most common year in the statement', () => {
    expect(
      yearHint(
        'Period 01/12/2025 - 31/12/2025, printed 2026',
        new Date(2026, 0, 5),
      ),
    ).toBe(2025);
    expect(yearHint('no years here', new Date(2026, 0, 5))).toBe(2026);
  });
});
