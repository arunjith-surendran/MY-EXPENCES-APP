/**
 * A stand-in for op-sqlite backed by Node's built-in SQLite, so tests run the app's real
 * SQL. Use: jest.mock('@op-engineering/op-sqlite', () => require('../test-support/sqlite').mock)
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

type Value = string | number | null;

export const shared: { db: any } = { db: new DatabaseSync(':memory:') };

/** A fresh empty database for the next `open()`. */
export function resetDatabase() {
  shared.db = new DatabaseSync(':memory:');
}

const returnsRows = (sql: string) =>
  /^\s*(select|pragma\s+\w+\s*(\(|$)|with)/i.test(sql) &&
  !/^\s*pragma\s+\w+\s*=/i.test(sql);

type Result = {
  rows: Record<string, Value>[];
  rowsAffected: number;
  insertId: number | undefined;
};
type Api = {
  execute(sql: string, params?: Value[]): Promise<Result>;
  transaction(fn: (tx: Api) => Promise<void>): Promise<void>;
};

function makeDb(): Api {
  const api: Api = {
    async execute(sql: string, params: Value[] = []) {
      const stmt = shared.db.prepare(sql);
      const args = params.map(p => (p === undefined ? null : p));
      if (returnsRows(sql)) {
        const rows = stmt.all(...args).map((r: object) => ({ ...r }));
        return { rows, rowsAffected: 0, insertId: undefined };
      }
      const r = stmt.run(...args);
      return {
        rows: [],
        rowsAffected: Number(r.changes),
        insertId: Number(r.lastInsertRowid),
      };
    },
    async transaction(fn) {
      shared.db.exec('BEGIN');
      try {
        await fn(api);
        shared.db.exec('COMMIT');
      } catch (err) {
        shared.db.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return api;
}

export const mock = { open: () => makeDb() };
