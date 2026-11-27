import { NativeModules } from 'react-native';

import { getDb } from './db';

/**
 * Receipt photos, one per expense. Each is a JPEG file in the app's private Library
 * folder (receipts/<file>); the `receipts` table maps the expense to its file. Photos
 * saved before files existed sit in the table as base64 until moveReceiptsToFiles runs.
 */

type Files = {
  writeAppFile?: (rel: string, base64: string) => Promise<string>;
  readAppFile?: (rel: string) => Promise<string | null>;
  deleteAppFile?: (rel: string) => Promise<void>;
};
const files = NativeModules.StatementImporter as Files | undefined;
const libraryPath = (
  NativeModules.AppInfo as { libraryPath?: string } | undefined
)?.libraryPath;

const canUseFiles = () =>
  !!(files?.writeAppFile && files.readAppFile && libraryPath);

type Row = { expense_id: number; data: string; file: string | null };

async function row(expenseId: number): Promise<Row | null> {
  const { rows } = await getDb().execute(
    'SELECT expense_id, data, file FROM receipts WHERE expense_id = ?',
    [expenseId],
  );
  return (rows[0] as unknown as Row) ?? null;
}

/** Something an <Image> can show, or null when there's no receipt. */
export async function getReceiptUri(expenseId: number): Promise<string | null> {
  const r = await row(expenseId);
  if (!r) return null;
  if (r.file && libraryPath) return `file://${libraryPath}/${r.file}`;
  return r.data ? `data:image/jpeg;base64,${r.data}` : null;
}

/** The photo as base64, for backups. */
export async function getReceiptBase64(
  expenseId: number,
): Promise<string | null> {
  const r = await row(expenseId);
  if (!r) return null;
  if (r.file && files?.readAppFile) return files.readAppFile(r.file);
  return r.data || null;
}

export async function setReceipt(expenseId: number, base64: string) {
  const old = await row(expenseId);
  if (canUseFiles()) {
    // A new name each time, so an <Image> showing the old one doesn't keep it cached.
    const file = `receipts/${expenseId}-${Date.now()}.jpg`;
    await files!.writeAppFile!(file, base64);
    await getDb().execute(
      "INSERT OR REPLACE INTO receipts (expense_id, data, created_at, file) VALUES (?, '', ?, ?)",
      [expenseId, Date.now(), file],
    );
  } else {
    await getDb().execute(
      'INSERT OR REPLACE INTO receipts (expense_id, data, created_at, file) VALUES (?, ?, ?, NULL)',
      [expenseId, base64, Date.now()],
    );
  }
  if (old?.file) await files?.deleteAppFile?.(old.file).catch(() => {});
}

export async function removeReceipt(expenseId: number) {
  const old = await row(expenseId);
  await getDb().execute('DELETE FROM receipts WHERE expense_id = ?', [
    expenseId,
  ]);
  if (old?.file) await files?.deleteAppFile?.(old.file).catch(() => {});
}

/** Which expenses have a receipt, for the 📎 mark in lists. */
export async function listReceiptIds(): Promise<Set<number>> {
  const { rows } = await getDb().execute('SELECT expense_id FROM receipts');
  return new Set(rows.map(r => Number(r.expense_id)));
}

/**
 * Housekeeping (on app open): photos still stored in the database become files, and
 * photos whose expense is gone for good (bin emptied, account wiped) are deleted.
 */
export async function tidyReceipts() {
  if (!canUseFiles()) return;
  const d = getDb();
  const { rows: inline } = await d.execute(
    "SELECT expense_id, data FROM receipts WHERE (file IS NULL OR file = '') AND data != ''",
  );
  for (const r of inline) {
    const id = Number(r.expense_id);
    const file = `receipts/${id}-${Date.now()}.jpg`;
    try {
      await files!.writeAppFile!(file, String(r.data));
      await d.execute(
        "UPDATE receipts SET file = ?, data = '' WHERE expense_id = ?",
        [file, id],
      );
    } catch {
      // Leave it in the database; it still shows.
    }
  }
  const { rows: orphans } = await d.execute(
    `SELECT expense_id, file FROM receipts
     WHERE expense_id NOT IN (SELECT id FROM expenses)
       AND expense_id NOT IN (SELECT id FROM deleted_expenses)`,
  );
  for (const r of orphans) {
    if (r.file) await files?.deleteAppFile?.(String(r.file)).catch(() => {});
    await d.execute('DELETE FROM receipts WHERE expense_id = ?', [
      Number(r.expense_id),
    ]);
  }
}
