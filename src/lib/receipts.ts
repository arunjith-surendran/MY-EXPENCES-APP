import { getDb } from './db';

/** Receipt photos (JPEG, base64), one per expense, stored in the phone's database. */

export async function getReceipt(expenseId: number): Promise<string | null> {
  const { rows } = await getDb().execute(
    'SELECT data FROM receipts WHERE expense_id = ?',
    [expenseId],
  );
  return rows[0] ? String(rows[0].data) : null;
}

export async function setReceipt(expenseId: number, base64: string) {
  await getDb().execute(
    'INSERT OR REPLACE INTO receipts (expense_id, data, created_at) VALUES (?, ?, ?)',
    [expenseId, base64, Date.now()],
  );
}

export async function removeReceipt(expenseId: number) {
  await getDb().execute('DELETE FROM receipts WHERE expense_id = ?', [
    expenseId,
  ]);
}

/** Which expenses have a receipt, for the 📎 mark in lists. */
export async function listReceiptIds(): Promise<Set<number>> {
  const { rows } = await getDb().execute('SELECT expense_id FROM receipts');
  return new Set(rows.map(r => Number(r.expense_id)));
}
