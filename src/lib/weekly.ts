import { aedOf, getMeta, listExpenses, setMeta } from './db';
import { notifyNow } from './notifications';
import { formatMoney } from './parse';

const SENT_KEY = 'weekly_summary_for';
const DAY = 86_400_000;

/** Monday 00:00 of the week `d` is in. */
export function weekStartOf(d: Date): Date {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(day.getTime() - ((day.getDay() + 6) % 7) * DAY);
}

export type WeekSummary = {
  total: number;
  /** Average of the four weeks before, or null if there were none. */
  usual: number | null;
  topCategory: string | null;
};

/** Last week against the four before it. Pure, for tests. */
export function summarizeWeek(
  lastWeek: { category: string; aed: number }[],
  previousWeekTotals: number[],
): WeekSummary {
  const total = lastWeek.reduce((s, e) => s + e.aed, 0);
  const byCat = new Map<string, number>();
  for (const e of lastWeek)
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.aed);
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  const counted = previousWeekTotals.filter(v => v > 0);
  return {
    total,
    usual: counted.length
      ? counted.reduce((s, v) => s + v, 0) / counted.length
      : null,
    topCategory: top ? top[0] : null,
  };
}

export function summaryText(s: WeekSummary): string {
  const parts = [`You spent ${formatMoney(s.total)} last week`];
  if (s.usual && s.usual > 0) {
    const r = (s.total - s.usual) / s.usual;
    if (Math.abs(r) >= 0.05) {
      parts[0] += `, ${Math.round(Math.abs(r) * 100)}% ${
        r > 0 ? 'more' : 'less'
      } than usual`;
    } else {
      parts[0] += ', about as usual';
    }
  }
  if (s.topCategory) parts.push(`Most on ${s.topCategory}.`);
  return `${parts[0]}. ${parts.slice(1).join(' ')}`.trim();
}

/**
 * Once a week, the first time the app opens from Monday on: a notification with last
 * week's spending. (Local notifications can't be computed when they fire, so it comes
 * when the app runs.)
 */
export async function sendWeeklySummary(now = new Date()) {
  try {
    const thisWeek = weekStartOf(now);
    const key = thisWeek.toISOString().slice(0, 10);
    if ((await getMeta(SENT_KEY)) === key) return;
    await setMeta(SENT_KEY, key);
    const start = thisWeek.getTime() - 7 * DAY;
    const items = await listExpenses(start - 28 * DAY, thisWeek.getTime());
    const last = items
      .filter(e => e.created_at >= start)
      .map(e => ({ category: e.category, aed: aedOf(e) ?? 0 }));
    if (last.length === 0) return;
    const previous = [1, 2, 3, 4].map(w =>
      items
        .filter(
          e =>
            e.created_at >= start - w * 7 * DAY &&
            e.created_at < start - (w - 1) * 7 * DAY,
        )
        .reduce((s, e) => s + (aedOf(e) ?? 0), 0),
    );
    await notifyNow(
      `weekly-${key}`,
      'Your week in Expences',
      summaryText(summarizeWeek(last, previous)),
    );
  } catch {
    // A summary is a nicety.
  }
}
