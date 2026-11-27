import { getDb } from './db';
import { cancelNotification, scheduleNotification } from './notifications';
import { formatMoney } from './parse';

/** Money lent or borrowed: "Ahmed owes me AED 120" or "I owe Sara AED 50". */
export type Debt = {
  id: number;
  person: string;
  amount: number;
  /** 'owed_to_me' = they owe me; 'i_owe' = I owe them. */
  direction: 'owed_to_me' | 'i_owe';
  note: string | null;
  created_at: number;
  due_at: number | null;
  settled_at: number | null;
};

const reminderId = (id: number) => `debt-${id}`;

export async function listDebts(): Promise<Debt[]> {
  const { rows } = await getDb().execute(
    'SELECT * FROM debts ORDER BY settled_at IS NOT NULL, COALESCE(due_at, 9e15), created_at DESC',
  );
  return rows as unknown as Debt[];
}

export async function addDebt(
  d: Omit<Debt, 'id' | 'created_at' | 'settled_at'>,
) {
  const result = await getDb().execute(
    'INSERT INTO debts (person, amount, direction, note, created_at, due_at) VALUES (?, ?, ?, ?, ?, ?)',
    [d.person, d.amount, d.direction, d.note, Date.now(), d.due_at],
  );
  const id = result.insertId ?? 0;
  if (d.due_at) {
    // A reminder at 9:00 on the day it's due.
    const at = new Date(d.due_at);
    at.setHours(9, 0, 0, 0);
    await scheduleNotification(
      reminderId(id),
      d.direction === 'owed_to_me'
        ? `${d.person} owes you ${formatMoney(d.amount)}`
        : `You owe ${d.person} ${formatMoney(d.amount)}`,
      d.note || 'Due today. Mark it settled in Expences when it’s paid.',
      at.getTime(),
    );
  }
  return id;
}

export async function settleDebt(id: number, settled: boolean) {
  await getDb().execute('UPDATE debts SET settled_at = ? WHERE id = ?', [
    settled ? Date.now() : null,
    id,
  ]);
  if (settled) await cancelNotification(reminderId(id));
}

export async function deleteDebt(id: number) {
  await getDb().execute('DELETE FROM debts WHERE id = ?', [id]);
  await cancelNotification(reminderId(id));
}

/** Open totals each way. Pure. */
export function debtTotals(debts: Debt[]) {
  let owedToMe = 0;
  let iOwe = 0;
  for (const d of debts) {
    if (d.settled_at) continue;
    if (d.direction === 'owed_to_me') owedToMe += d.amount;
    else iOwe += d.amount;
  }
  return { owedToMe, iOwe };
}
