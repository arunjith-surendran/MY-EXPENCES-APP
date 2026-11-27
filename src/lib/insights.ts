import type { MonthCategoryTotal } from './db';
import { shiftMonth } from './months';

/** Needs you can't easily cut vs. lifestyle choices; everything else is "Other". */
export type SpendGroup = 'essentials' | 'lifestyle' | 'other';

const GROUP_OF: Record<string, SpendGroup> = {
  Groceries: 'essentials',
  'Bills & Utilities': 'essentials',
  Transport: 'essentials',
  Fuel: 'essentials',
  Health: 'essentials',
  'Food & Dining': 'lifestyle',
  Shopping: 'lifestyle',
  Entertainment: 'lifestyle',
};

export const groupOf = (category: string): SpendGroup =>
  GROUP_OF[category] ?? 'other';

export type GroupTotals = Record<SpendGroup, number>;

/** Per-month totals for each group, keyed by month ("2026-10"). */
export function groupByMonth(
  rows: MonthCategoryTotal[],
): Map<string, GroupTotals> {
  const out = new Map<string, GroupTotals>();
  for (const r of rows) {
    let g = out.get(r.month);
    if (!g) {
      g = { essentials: 0, lifestyle: 0, other: 0 };
      out.set(r.month, g);
    }
    g[groupOf(r.category)] += r.total;
  }
  return out;
}

/**
 * Months from the first one with an expense up to `current`, newest first, so the app
 * never lists empty months from before the user started. At most `max` months.
 */
export function activeMonths(
  monthsWithData: string[],
  current: string,
  max = Infinity,
): string[] {
  const first = monthsWithData.reduce((min, m) => (m < min ? m : min), current);
  const out: string[] = [];
  for (let m = current; m >= first && out.length < max; m = shiftMonth(m, -1)) {
    out.push(m);
  }
  return out;
}

export type HealthLevel = 'great' | 'good' | 'tight' | 'critical';

export type Health = {
  level: HealthLevel;
  title: string;
  detail: string;
  /** Expected month total: the current pace for this month, else what was spent. */
  projected: number;
  /** (salary − projected) / salary, or null without a salary. */
  savingsRate: number | null;
  /** Lifestyle's share of spending (0–1). */
  lifestyleShare: number;
  /** One concrete, money-saving suggestion, if there is one. */
  tip: string | null;
};

/** Days before the pace is trusted: an early rent payment would otherwise look like overspending. */
const MIN_DAYS_FOR_PACE = 7;

/**
 * How healthy a month's spending is. With a salary it judges the savings rate;
 * without one it compares against the user's own average month. Returns null when
 * there is nothing to compare against yet.
 */
export function assessMonth({
  spent,
  groups,
  salary,
  averageMonth,
  daysElapsed,
  daysInMonth,
  format,
}: {
  spent: number;
  groups: GroupTotals;
  salary: number | null;
  /** Average total of earlier months, or null if this is the first month. */
  averageMonth: number | null;
  /** Days of the month that have passed (equal to daysInMonth for past months). */
  daysElapsed: number;
  daysInMonth: number;
  format: (n: number) => string;
}): Health | null {
  const projected =
    daysElapsed >= MIN_DAYS_FOR_PACE && daysElapsed < daysInMonth
      ? Math.max(spent, (spent / daysElapsed) * daysInMonth)
      : spent;
  const finished = daysElapsed >= daysInMonth;
  const lifestyleShare = spent > 0 ? groups.lifestyle / spent : 0;

  const tip =
    lifestyleShare >= 0.4 && groups.lifestyle > 0
      ? `Dining, shopping and fun are ${Math.round(
          lifestyleShare * 100,
        )}% of your spending. Cutting them by a fifth saves ${format(
          groups.lifestyle * 0.2,
        )} a month.`
      : null;

  if (salary != null && salary > 0) {
    const savingsRate = (salary - projected) / salary;
    const base = { projected, savingsRate, lifestyleShare, tip };
    if (spent > salary) {
      return {
        ...base,
        level: 'critical',
        title: 'Over your salary',
        detail: `You've spent ${format(spent - salary)} more than you earn${
          finished ? ' this month' : ' so far'
        }.`,
      };
    }
    if (savingsRate < 0) {
      return {
        ...base,
        level: 'critical',
        title: 'On pace to overspend',
        detail: `At this pace you'll spend ${format(
          projected,
        )}, more than your salary. Slow down to stay in control.`,
      };
    }
    const pct = Math.round(savingsRate * 100);
    const saving = finished ? 'You saved' : "You're on pace to save";
    if (savingsRate < 0.1) {
      return {
        ...base,
        level: 'tight',
        title: 'Tight month',
        detail: `${saving} only ${pct}% of your salary. Aim for at least 20%.`,
      };
    }
    if (savingsRate < 0.25) {
      return {
        ...base,
        level: 'good',
        title: 'Healthy',
        detail: `${saving} ${pct}% of your salary. A little more and you're a great saver.`,
      };
    }
    return {
      ...base,
      level: 'great',
      title: 'Great saver',
      detail: `${saving} ${pct}% of your salary. Keep it up!`,
    };
  }

  if (averageMonth == null || averageMonth <= 0) return null;
  const ratio = projected / averageMonth;
  const base = { projected, savingsRate: null, lifestyleShare, tip };
  const vs = `${format(projected)} vs your usual ${format(averageMonth)}`;
  if (ratio > 1.5) {
    return {
      ...base,
      level: 'critical',
      title: 'Spending far above usual',
      detail: `${finished ? 'Spent' : 'On pace for'} ${vs}.`,
    };
  }
  if (ratio > 1.15) {
    return {
      ...base,
      level: 'tight',
      title: 'Above your usual',
      detail: `${finished ? 'Spent' : 'On pace for'} ${vs}.`,
    };
  }
  if (ratio < 0.9) {
    return {
      ...base,
      level: 'great',
      title: 'Below your usual',
      detail: `${finished ? 'Spent' : 'On pace for'} ${vs}. Nice control!`,
    };
  }
  return {
    ...base,
    level: 'good',
    title: 'Steady',
    detail: `${finished ? 'Spent' : 'On pace for'} ${vs}.`,
  };
}
