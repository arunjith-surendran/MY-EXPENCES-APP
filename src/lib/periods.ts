import { monthKey, monthLabel, monthRange, shiftMonth } from './months';

/** Time periods for filtering expenses (search and bulk delete). Local time; weeks start Monday. */
export type Period =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'month'
  | 'custom'
  | 'all';

export const PERIODS: [Period, string][] = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['thisWeek', 'This week'],
  ['lastWeek', 'Last week'],
  ['thisMonth', 'This month'],
  ['lastMonth', 'Last month'],
  ['month', 'Pick a month'],
  ['custom', 'Date range'],
  ['all', 'All time'],
];

export const DAY_MS = 86_400_000;

export const dayStart = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday of the week `d` is in (weeks run Monday to Sunday). */
export const weekStart = (d: Date) =>
  addDays(dayStart(d), -((d.getDay() + 6) % 7));

export const shortDay = (d: Date | number) =>
  new Date(d).toLocaleDateString('en-AE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** [start, end) in unix ms for a period. */
export function rangeFor(
  period: Period,
  month: string,
  from: Date,
  to: Date,
): { start: number; end: number } {
  const today = dayStart(new Date());
  switch (period) {
    case 'today':
      return { start: today.getTime(), end: addDays(today, 1).getTime() };
    case 'yesterday':
      return { start: addDays(today, -1).getTime(), end: today.getTime() };
    case 'thisWeek': {
      const s = weekStart(today);
      return { start: s.getTime(), end: addDays(s, 7).getTime() };
    }
    case 'lastWeek': {
      const s = addDays(weekStart(today), -7);
      return { start: s.getTime(), end: addDays(s, 7).getTime() };
    }
    case 'thisMonth':
      return monthRange(monthKey());
    case 'lastMonth':
      return monthRange(shiftMonth(monthKey(), -1));
    case 'month':
      return monthRange(month);
    case 'custom': {
      const [a, b] = from <= to ? [from, to] : [to, from];
      return {
        start: dayStart(a).getTime(),
        end: addDays(dayStart(b), 1).getTime(),
      };
    }
    case 'all':
      return { start: 0, end: Number.MAX_SAFE_INTEGER };
  }
}

/** "Nov 2026", "12 Nov 2026" or "3 Nov 2026 – 9 Nov 2026" for a period's range. */
export function periodLabel(
  period: Period,
  range: { start: number; end: number },
): string {
  if (period === 'all') return 'All time';
  if (period === 'month' || period === 'thisMonth' || period === 'lastMonth')
    return monthLabel(monthKey(new Date(range.start)));
  if (period === 'today' || period === 'yesterday')
    return shortDay(range.start);
  return `${shortDay(range.start)} – ${shortDay(range.end - DAY_MS)}`;
}
