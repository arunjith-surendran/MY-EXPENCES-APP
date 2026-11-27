import {
  dueOccurrences,
  firstOccurrence,
  nextAfter,
  occurrenceIn,
} from '../src/lib/recurring';

jest.mock('../src/lib/db', () => ({
  getDb: jest.fn(),
  insertExpense: jest.fn(),
}));
jest.mock('../src/lib/notifications', () => ({
  cancelNotification: jest.fn(),
  scheduleNotification: jest.fn(),
}));

const at = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 9).getTime();

describe('recurring dates', () => {
  it('uses the last day in short months', () => {
    expect(occurrenceIn(2026, 1, 31).getDate()).toBe(28); // February
    expect(occurrenceIn(2028, 1, 30).getDate()).toBe(29); // leap year
  });

  it('starts this month if the day is still ahead, else next month', () => {
    const now = new Date(2026, 10, 10, 15); // 10 Nov, afternoon
    expect(firstOccurrence(10, now)).toBe(at(2026, 11, 10)); // today counts
    expect(firstOccurrence(25, now)).toBe(at(2026, 11, 25));
    expect(firstOccurrence(5, now)).toBe(at(2026, 12, 5));
  });

  it('keeps the chosen day after a short month', () => {
    const feb = nextAfter(at(2026, 1, 31), 31);
    expect(new Date(feb).getDate()).toBe(28);
    expect(new Date(nextAfter(feb, 31)).getDate()).toBe(31); // back to 31 in March
  });

  it('lists every missed occurrence and the next one', () => {
    const { due, next } = dueOccurrences(at(2026, 9, 1), 1, at(2026, 11, 15));
    expect(due).toEqual([at(2026, 9, 1), at(2026, 10, 1), at(2026, 11, 1)]);
    expect(next).toBe(at(2026, 12, 1));
  });

  it('adds at most a year after a long gap', () => {
    const { due, next } = dueOccurrences(at(2020, 1, 1), 1, at(2026, 6, 15));
    expect(due).toHaveLength(12);
    expect(next).toBe(at(2026, 7, 1));
  });
});
