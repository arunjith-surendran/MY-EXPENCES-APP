import { getDb, insertExpense, type PaymentMethod } from './db';
import { formatMoney } from './parse';
import { cancelNotification, scheduleNotification } from './notifications';

/**
 * Expenses that come back every month (rent, subscriptions, school fees). On its day the
 * app adds the expense by itself the next time it opens, and reminds the day before.
 */
export type Recurring = {
  id: number;
  amount: number;
  merchant: string;
  category: string;
  method: PaymentMethod;
  note: string | null;
  /** Day of the month, 1–31; short months use their last day. */
  day: number;
  /** When it's next added (unix ms). */
  next_at: number;
  remind: number;
  active: number;
  created_at: number;
};

export type NewRecurring = Pick<
  Recurring,
  'amount' | 'merchant' | 'category' | 'method' | 'note' | 'day'
> & {
  remind?: boolean;
  /** Start the month after this time (an expense saved today repeats from next month). */
  after?: number;
};

/** Expenses are added at 9:00 on their day. */
const HOUR = 9;

/** The occurrence in this year/month (month 0–11), on `day` or the month's last day. */
export function occurrenceIn(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last), HOUR);
}

/** The first time it's due: this month's day if it hasn't passed yet (today counts), else next month's. */
export function firstOccurrence(day: number, now = new Date()): number {
  const here = occurrenceIn(now.getFullYear(), now.getMonth(), day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (here >= today) return here.getTime();
  return occurrenceIn(now.getFullYear(), now.getMonth() + 1, day).getTime();
}

/** The occurrence a month after `at`. */
export function nextAfter(at: number, day: number): number {
  const d = new Date(at);
  return occurrenceIn(d.getFullYear(), d.getMonth() + 1, day).getTime();
}

/** Every occurrence from `nextAt` up to `now`, and the one after them. Pure, for tests. */
export function dueOccurrences(
  nextAt: number,
  day: number,
  now: number,
): { due: number[]; next: number } {
  const due: number[] = [];
  let at = nextAt;
  // A year at most, so a phone that wasn't opened for ages doesn't add hundreds.
  while (at <= now && due.length < 12) {
    due.push(at);
    at = nextAfter(at, day);
  }
  while (at <= now) at = nextAfter(at, day);
  return { due, next: at };
}

export async function listRecurring(): Promise<Recurring[]> {
  const { rows } = await getDb().execute(
    'SELECT * FROM recurring ORDER BY active DESC, next_at ASC',
  );
  return rows as unknown as Recurring[];
}

export async function addRecurring(r: NewRecurring): Promise<number> {
  const result = await getDb().execute(
    `INSERT INTO recurring (amount, merchant, category, method, note, day, next_at, remind, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      r.amount,
      r.merchant,
      r.category,
      r.method,
      r.note,
      r.day,
      r.after != null ? nextAfter(r.after, r.day) : firstOccurrence(r.day),
      r.remind === false ? 0 : 1,
      Date.now(),
    ],
  );
  const id = result.insertId ?? 0;
  await scheduleReminders();
  return id;
}

export async function updateRecurring(id: number, r: NewRecurring) {
  await getDb().execute(
    `UPDATE recurring SET amount = ?, merchant = ?, category = ?, method = ?, note = ?,
       day = ?, next_at = ?, remind = ? WHERE id = ?`,
    [
      r.amount,
      r.merchant,
      r.category,
      r.method,
      r.note,
      r.day,
      firstOccurrence(r.day),
      r.remind === false ? 0 : 1,
      id,
    ],
  );
  await scheduleReminders();
}

export async function setRecurringActive(id: number, active: boolean) {
  const d = getDb();
  if (active) {
    // Resuming starts from the next due day, without adding the months it was paused.
    const { rows } = await d.execute('SELECT day FROM recurring WHERE id = ?', [
      id,
    ]);
    const day = Number(rows[0]?.day ?? 1);
    await d.execute(
      'UPDATE recurring SET active = 1, next_at = ? WHERE id = ?',
      [firstOccurrence(day), id],
    );
  } else {
    await d.execute('UPDATE recurring SET active = 0 WHERE id = ?', [id]);
  }
  await scheduleReminders();
}

export async function deleteRecurring(id: number) {
  await getDb().execute('DELETE FROM recurring WHERE id = ?', [id]);
  await cancelNotification(`recurring-${id}`);
}

/** Adds every expense that has come due. Returns how many were added. */
export async function addDueRecurring(now = Date.now()): Promise<number> {
  const items = (await listRecurring()).filter(r => r.active);
  let added = 0;
  for (const r of items) {
    if (r.next_at > now) continue;
    const { due, next } = dueOccurrences(r.next_at, r.day, now);
    for (const at of due) {
      await insertExpense({
        amount: r.amount,
        currency: 'AED',
        merchant: r.merchant,
        card: null,
        category: r.category,
        source: 'recurring',
        method: r.method,
        note: r.note,
        created_at: at,
      });
      added++;
    }
    await getDb().execute('UPDATE recurring SET next_at = ? WHERE id = ?', [
      next,
      r.id,
    ]);
  }
  if (added > 0) await scheduleReminders();
  return added;
}

/** A reminder the day before each one, at 9:00. */
export async function scheduleReminders() {
  for (const r of await listRecurring()) {
    const id = `recurring-${r.id}`;
    if (!r.active || !r.remind) {
      await cancelNotification(id);
      continue;
    }
    await scheduleNotification(
      id,
      `Tomorrow: ${r.merchant}`,
      `${formatMoney(r.amount)} (${r.category}) will be added to Expences.`,
      r.next_at - 86_400_000,
    );
  }
}
