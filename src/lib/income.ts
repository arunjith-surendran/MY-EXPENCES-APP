import { getDb } from './db';

/** Money in that isn't salary: transfers from others, refunds, anything else. */
export type Income = {
  id: number;
  amount: number;
  source: string;
  kind: 'transfer_in' | 'refund' | 'other';
  note: string | null;
  created_at: number;
};

export async function addIncome(items: Omit<Income, 'id'>[]): Promise<number> {
  await getDb().transaction(async tx => {
    for (const i of items) {
      await tx.execute(
        'INSERT INTO income (amount, source, kind, note, created_at) VALUES (?, ?, ?, ?, ?)',
        [i.amount, i.source, i.kind, i.note, i.created_at],
      );
    }
  });
  return items.length;
}

export async function listIncome(
  start: number,
  end: number,
): Promise<Income[]> {
  const { rows } = await getDb().execute(
    'SELECT * FROM income WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC',
    [start, end],
  );
  return rows as unknown as Income[];
}

export async function deleteIncome(id: number) {
  await getDb().execute('DELETE FROM income WHERE id = ?', [id]);
}

/** Refund, transfer from someone, or other money in, from a statement line. Pure. */
export function incomeKind(description: string): Income['kind'] {
  if (/refund|reversal|cash ?back|استرداد|مسترد/i.test(description))
    return 'refund';
  if (/transfer|remittance|تحويل|حوالة/i.test(description))
    return 'transfer_in';
  return 'other';
}
