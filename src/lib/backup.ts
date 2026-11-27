import { NativeModules, Share } from 'react-native';

import { getDb } from './db';

/**
 * A full backup of what's on the phone as one JSON file the user keeps (Files, iCloud
 * Drive, email). Nothing goes through our server.
 */

const APP = 'expences';
const FORMAT = 1;

/** Tables in a backup and the columns read back from it (anything else is ignored). */
const TABLES = {
  expenses: [
    'id',
    'amount',
    'currency',
    'merchant',
    'card',
    'category',
    'source',
    'note',
    'created_at',
    'method',
    'aed_amount',
  ],
  salary: ['month', 'amount'],
  meta: ['key', 'value'],
  categories: ['name', 'created_at', 'grp'],
  merchant_categories: ['merchant', 'category', 'updated_at'],
  budgets: ['category', 'amount'],
  recurring: [
    'id',
    'amount',
    'merchant',
    'category',
    'method',
    'note',
    'day',
    'next_at',
    'remind',
    'active',
    'created_at',
  ],
  receipts: ['expense_id', 'data', 'created_at'],
} as const;

type Table = keyof typeof TABLES;
type Row = Record<string, string | number | null>;

/** Device- or account-specific settings that shouldn't move to another phone. */
const LOCAL_META = [
  'pro_access_until',
  'update_required',
  'update_dismissed',
  'notify_asked',
  'notify_shown_at',
  'notify_read_at',
  'fx_rates',
  'privacy_intro_seen',
];

export type Backup = {
  app: typeof APP;
  format: number;
  createdAt: string;
  tables: Partial<Record<Table, Row[]>>;
};

export type BackupSummary = {
  expenses: number;
  receipts: number;
  createdAt: string;
};

type Importer = {
  writeFile?: (name: string, text: string) => Promise<string>;
  pickBackup?: () => Promise<{ name: string; path: string } | null>;
  extractText: (path: string, password: string | null) => Promise<string>;
};
const native = NativeModules.StatementImporter as Importer | undefined;

export const canSaveFiles = () => !!native?.writeFile && !!native?.pickBackup;

export async function createBackup(includePhotos: boolean): Promise<Backup> {
  const d = getDb();
  const tables: Backup['tables'] = {};
  for (const table of Object.keys(TABLES) as Table[]) {
    if (table === 'receipts' && !includePhotos) continue;
    const cols = TABLES[table].join(', ');
    const { rows } = await d.execute(`SELECT ${cols} FROM ${table}`);
    let list = rows as unknown as Row[];
    if (table === 'meta') {
      list = list.filter(r => !LOCAL_META.includes(String(r.key)));
    }
    tables[table] = list;
  }
  return {
    app: APP,
    format: FORMAT,
    createdAt: new Date().toISOString(),
    tables,
  };
}

/** Writes the backup to a file and opens the share sheet to save it (e.g. to Files). */
export async function shareBackup(includePhotos: boolean): Promise<number> {
  if (!native?.writeFile) {
    throw new Error('Update the app to save backups.');
  }
  const backup = await createBackup(includePhotos);
  const day = backup.createdAt.slice(0, 10);
  const path = await native.writeFile(
    `expences-backup-${day}.json`,
    JSON.stringify(backup),
  );
  await Share.share({ url: `file://${path}`, title: 'Expences backup' });
  return backup.tables.expenses?.length ?? 0;
}

/** Checks a file's contents is an Expences backup. Pure, for tests. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't an Expences backup.");
  }
  const b = data as Partial<Backup>;
  if (b?.app !== APP || typeof b.tables !== 'object' || b.tables == null) {
    throw new Error("This file isn't an Expences backup.");
  }
  if ((b.format ?? 0) > FORMAT) {
    throw new Error(
      'This backup is from a newer version. Update the app first.',
    );
  }
  if (!Array.isArray(b.tables.expenses)) {
    throw new Error('This backup has no expenses in it.');
  }
  return b as Backup;
}

export function summarize(b: Backup): BackupSummary {
  return {
    expenses: b.tables.expenses?.length ?? 0,
    receipts: b.tables.receipts?.length ?? 0,
    createdAt: b.createdAt,
  };
}

/** Lets the user pick a backup file; null if they cancel. */
export async function pickBackup(): Promise<Backup | null> {
  if (!native?.pickBackup)
    throw new Error('Update the app to restore backups.');
  const picked = await native.pickBackup();
  if (!picked) return null;
  return parseBackup(await native.extractText(picked.path, null));
}

/** Only known columns, with values of a type SQLite takes. */
function clean(table: Table, row: Row): Row {
  const out: Row = {};
  for (const col of TABLES[table]) {
    // Leave out columns the backup doesn't have, so the table's defaults apply.
    if (!(col in row)) continue;
    const v = row[col];
    out[col] =
      v == null
        ? null
        : typeof v === 'number' || typeof v === 'string'
        ? v
        : String(v);
  }
  return out;
}

/** The row without its id, so the table gives it a new one. */
function withoutId(row: Row): Row {
  const out = { ...row };
  delete out.id;
  return out;
}

/**
 * Restores a backup.
 *  - 'replace': the phone ends up exactly like the backup (current data is removed).
 *  - 'merge': adds what's missing; expenses already here (same amount, merchant and time) are skipped.
 * Returns how many expenses were added.
 */
export async function restoreBackup(
  backup: Backup,
  mode: 'replace' | 'merge',
): Promise<number> {
  const d = getDb();
  let added = 0;
  await d.transaction(async tx => {
    const insert = async (
      table: Table,
      row: Row,
      verb = 'INSERT OR REPLACE',
    ) => {
      const r = clean(table, row);
      const cols = Object.keys(r);
      return tx.execute(
        `${verb} INTO ${table} (${cols.join(', ')}) VALUES (${cols
          .map(() => '?')
          .join(', ')})`,
        cols.map(c => r[c]),
      );
    };

    if (mode === 'replace') {
      for (const table of Object.keys(TABLES) as Table[]) {
        if (table === 'meta') {
          await tx.execute(
            `DELETE FROM meta WHERE key NOT IN (${LOCAL_META.map(
              () => '?',
            ).join(',')})`,
            LOCAL_META,
          );
        } else {
          await tx.execute(`DELETE FROM ${table}`);
        }
      }
      await tx.execute('DELETE FROM deleted_expenses');
      for (const table of Object.keys(TABLES) as Table[]) {
        for (const row of backup.tables[table] ?? []) {
          if (table === 'meta' && LOCAL_META.includes(String(row.key)))
            continue;
          await insert(table, row);
        }
      }
      added = backup.tables.expenses?.length ?? 0;
      return;
    }

    // Merge: expenses get new ids here, so receipts follow them through `idMap`.
    const idMap = new Map<number, number>();
    for (const row of backup.tables.expenses ?? []) {
      const { rows } = await tx.execute(
        'SELECT id FROM expenses WHERE ABS(amount - ?) < 0.005 AND merchant = ? AND created_at = ?',
        [Number(row.amount), String(row.merchant), Number(row.created_at)],
      );
      if (rows[0]) {
        idMap.set(Number(row.id), Number(rows[0].id));
        continue;
      }
      const rest = withoutId(clean('expenses', row));
      const cols = Object.keys(rest);
      const result = await tx.execute(
        `INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols
          .map(() => '?')
          .join(', ')})`,
        cols.map(c => rest[c]),
      );
      idMap.set(Number(row.id), result.insertId ?? 0);
      added++;
    }
    for (const row of backup.tables.receipts ?? []) {
      const id = idMap.get(Number(row.expense_id));
      if (id)
        await insert(
          'receipts',
          { ...row, expense_id: id },
          'INSERT OR IGNORE',
        );
    }
    for (const table of [
      'salary',
      'categories',
      'merchant_categories',
      'budgets',
    ] as const) {
      for (const row of backup.tables[table] ?? []) {
        await insert(table, row, 'INSERT OR IGNORE');
      }
    }
    // Recurring ones only if the same one isn't set up here already.
    for (const row of backup.tables.recurring ?? []) {
      const { rows } = await tx.execute(
        'SELECT id FROM recurring WHERE merchant = ? AND ABS(amount - ?) < 0.005 AND day = ?',
        [String(row.merchant), Number(row.amount), Number(row.day)],
      );
      if (rows[0]) continue;
      const rest = withoutId(clean('recurring', row));
      const cols = Object.keys(rest);
      await tx.execute(
        `INSERT INTO recurring (${cols.join(', ')}) VALUES (${cols
          .map(() => '?')
          .join(', ')})`,
        cols.map(c => rest[c]),
      );
    }
  });
  return added;
}
