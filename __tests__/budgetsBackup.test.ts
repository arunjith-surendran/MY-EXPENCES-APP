import { levelReached } from '../src/lib/budgets';
import { parseBackup, summarize } from '../src/lib/backup';

jest.mock('../src/lib/db', () => ({
  getDb: jest.fn(),
  getMeta: jest.fn(),
  setMeta: jest.fn(),
}));
jest.mock('../src/lib/notifications', () => ({ notifyNow: jest.fn() }));

describe('levelReached', () => {
  it('is 0 under 80%, 0.8 from 80%, 1 from 100%', () => {
    expect(levelReached(79, 100)).toBe(0);
    expect(levelReached(80, 100)).toBe(0.8);
    expect(levelReached(130, 100)).toBe(1);
    expect(levelReached(10, 0)).toBe(0);
  });
});

describe('parseBackup', () => {
  const good = {
    app: 'expences',
    format: 1,
    createdAt: '2026-11-27T10:00:00.000Z',
    tables: { expenses: [{ id: 1 }, { id: 2 }], receipts: [{ expense_id: 1 }] },
  };

  it('accepts an Expences backup', () => {
    expect(summarize(parseBackup(JSON.stringify(good)))).toEqual({
      expenses: 2,
      receipts: 1,
      createdAt: good.createdAt,
    });
  });

  it('rejects other files', () => {
    expect(() => parseBackup('not json')).toThrow(/isn't an Expences backup/);
    expect(() => parseBackup('{"app":"other","tables":{}}')).toThrow();
  });

  it('rejects a newer format', () => {
    expect(() => parseBackup(JSON.stringify({ ...good, format: 99 }))).toThrow(
      /newer version/,
    );
  });
});
