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

/** A category's group; `custom` holds the groups the user chose for their own categories. */
export const groupOf = (
  category: string,
  custom?: ReadonlyMap<string, SpendGroup>,
): SpendGroup => GROUP_OF[category] ?? custom?.get(category) ?? 'other';

export type GroupTotals = Record<SpendGroup, number>;

/** Per-month totals for each group, keyed by month ("2026-10"). */
export function groupByMonth(
  rows: MonthCategoryTotal[],
  custom?: ReadonlyMap<string, SpendGroup>,
): Map<string, GroupTotals> {
  const out = new Map<string, GroupTotals>();
  for (const r of rows) {
    let g = out.get(r.month);
    if (!g) {
      g = { essentials: 0, lifestyle: 0, other: 0 };
      out.set(r.month, g);
    }
    g[groupOf(r.category, custom)] += r.total;
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

/** "2026-11-03" for a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Spend for each day of `month` (index 0 = the 1st). Days after `today` are null. */
export function dailySeries(
  dayTotals: Map<string, number>,
  month: string,
  today: Date,
): (number | null)[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(y, m - 1, i + 1);
    if (d > today) return null;
    return dayTotals.get(dayKey(d)) ?? 0;
  });
}

/**
 * Average spend per weekday (index 0 = Monday) over the `weeks` weeks up to `today`,
 * counting days with no spending as zero. Days before `firstDay` (when the user started)
 * are left out so they don't drag the averages down.
 */
export function weekdayAverages(
  dayTotals: Map<string, number>,
  today: Date,
  firstDay: Date,
  weeks = 12,
): number[] {
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() - i,
    );
    if (d < firstDay) break;
    const w = (d.getDay() + 6) % 7; // Monday first
    sums[w] += dayTotals.get(dayKey(d)) ?? 0;
    counts[w] += 1;
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
}

export type CategoryChange = {
  category: string;
  now: number;
  before: number;
  /** now - before, in AED. */
  change: number;
  /** Relative change (0.32 = 32% more); null when there was nothing before. */
  ratio: number | null;
};

/** AED per category this month against the month before, biggest change first. Pure. */
export function compareCategories(
  now: Map<string, number>,
  before: Map<string, number>,
): CategoryChange[] {
  const names = new Set([...now.keys(), ...before.keys()]);
  return [...names]
    .map(category => {
      const a = now.get(category) ?? 0;
      const b = before.get(category) ?? 0;
      return {
        category,
        now: a,
        before: b,
        change: a - b,
        ratio: b > 0 ? (a - b) / b : null,
      };
    })
    .filter(c => c.now > 0 || c.before > 0)
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
}

export type MerchantTotal = { merchant: string; total: number; count: number };

/** Where the money went, by merchant name (case-insensitive), top `n`. Pure. */
export function topMerchants(
  items: { merchant: string; aed: number }[],
  n = 5,
): MerchantTotal[] {
  const map = new Map<string, MerchantTotal>();
  for (const { merchant, aed } of items) {
    const key = merchant.trim().toLowerCase();
    const m = map.get(key) ?? { merchant: merchant.trim(), total: 0, count: 0 };
    m.total += aed;
    m.count += 1;
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, n);
}
