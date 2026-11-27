import {
  activeMonths,
  assessMonth,
  dailySeries,
  groupByMonth,
  groupOf,
  weekdayAverages,
} from '../src/lib/insights';

const format = (n: number) => `AED ${Math.round(n)}`;
const groups = (essentials: number, lifestyle: number, other = 0) => ({
  essentials,
  lifestyle,
  other,
});

describe('groups', () => {
  it('splits categories into essentials, lifestyle and other', () => {
    expect(groupOf('Groceries')).toBe('essentials');
    expect(groupOf('Shopping')).toBe('lifestyle');
    expect(groupOf('Other')).toBe('other');
    expect(groupOf('Something new')).toBe('other');
  });

  it('sums each month by group', () => {
    const byMonth = groupByMonth([
      { month: '2026-10', category: 'Groceries', total: 100 },
      { month: '2026-10', category: 'Fuel', total: 50 },
      { month: '2026-10', category: 'Food & Dining', total: 30 },
      { month: '2026-11', category: 'Other', total: 5 },
    ]);
    expect(byMonth.get('2026-10')).toEqual(groups(150, 30));
    expect(byMonth.get('2026-11')).toEqual(groups(0, 0, 5));
  });
});

describe('activeMonths', () => {
  it('starts at the first month with data, newest first', () => {
    expect(activeMonths(['2026-09', '2026-11'], '2026-11')).toEqual([
      '2026-11',
      '2026-10',
      '2026-09',
    ]);
  });

  it('shows only the current month for a new user', () => {
    expect(activeMonths([], '2026-11')).toEqual(['2026-11']);
  });

  it('crosses years and respects the limit', () => {
    expect(activeMonths(['2025-01'], '2026-02', 3)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
    ]);
  });
});

describe('assessMonth', () => {
  const base = {
    groups: groups(1000, 500),
    averageMonth: null,
    daysInMonth: 30,
    format,
  };

  it('flags spending over the salary as critical', () => {
    const h = assessMonth({
      ...base,
      spent: 6000,
      salary: 5000,
      daysElapsed: 20,
    });
    expect(h?.level).toBe('critical');
    expect(h?.title).toBe('Over your salary');
  });

  it('projects the current pace and warns before the salary runs out', () => {
    // 3000 in 10 days → 9000 for the month, above a 5000 salary.
    const h = assessMonth({
      ...base,
      spent: 3000,
      salary: 5000,
      daysElapsed: 10,
    });
    expect(h?.projected).toBe(9000);
    expect(h?.level).toBe('critical');
  });

  it("doesn't project from the first few days", () => {
    const h = assessMonth({
      ...base,
      spent: 3000,
      salary: 10000,
      daysElapsed: 2,
    });
    expect(h?.projected).toBe(3000);
    expect(h?.level).toBe('great');
  });

  it('grades savings rates', () => {
    const at = (spent: number) =>
      assessMonth({ ...base, spent, salary: 10000, daysElapsed: 30 })?.level;
    expect(at(9500)).toBe('tight');
    expect(at(8000)).toBe('good');
    expect(at(6000)).toBe('great');
  });

  it('compares with the usual month when there is no salary', () => {
    const at = (spent: number) =>
      assessMonth({
        ...base,
        spent,
        salary: null,
        averageMonth: 4000,
        daysElapsed: 30,
      })?.level;
    expect(at(7000)).toBe('critical');
    expect(at(5000)).toBe('tight');
    expect(at(4000)).toBe('good');
    expect(at(3000)).toBe('great');
  });

  it('returns null with nothing to compare against', () => {
    expect(
      assessMonth({ ...base, spent: 100, salary: null, daysElapsed: 30 }),
    ).toBeNull();
  });

  it('suggests trimming lifestyle when it is a large share', () => {
    const h = assessMonth({
      ...base,
      groups: groups(1000, 1000),
      spent: 2000,
      salary: 10000,
      daysElapsed: 30,
    });
    expect(h?.lifestyleShare).toBe(0.5);
    expect(h?.tip).toContain('AED 200');
  });
});

describe('dailySeries', () => {
  it('fills every day of the month and leaves future days empty', () => {
    const totals = new Map([
      ['2026-11-01', 50],
      ['2026-11-03', 20],
    ]);
    const s = dailySeries(totals, '2026-11', new Date(2026, 10, 3, 18));
    expect(s).toHaveLength(30);
    expect(s.slice(0, 4)).toEqual([50, 0, 20, null]);
  });
});

describe('weekdayAverages', () => {
  it('averages each weekday, counting quiet days as zero', () => {
    // Fri 27 Nov 2026 and Fri 20 Nov: 100 and 0 → Friday average 50.
    const totals = new Map([['2026-11-27', 100]]);
    const avg = weekdayAverages(
      totals,
      new Date(2026, 10, 27),
      new Date(2026, 10, 16), // Monday
      12,
    );
    expect(avg[4]).toBe(50);
    expect(avg[0]).toBe(0);
  });

  it('ignores days before the user started', () => {
    const totals = new Map([['2026-11-27', 70]]);
    const avg = weekdayAverages(
      totals,
      new Date(2026, 10, 27),
      new Date(2026, 10, 27),
    );
    expect(avg[4]).toBe(70);
  });
});

describe('compareCategories and topMerchants', () => {
  const {
    compareCategories,
    topMerchants,
    groupOf,
  } = require('../src/lib/insights');

  it('sorts by the biggest change and marks new categories', () => {
    const out = compareCategories(
      new Map([
        ['Food & Dining', 300],
        ['Gym', 100],
      ]),
      new Map([
        ['Food & Dining', 200],
        ['Fuel', 400],
      ]),
    );
    expect(out.map((c: { category: string }) => c.category)).toEqual([
      'Fuel',
      'Food & Dining',
      'Gym',
    ]);
    expect(out[1].ratio).toBeCloseTo(0.5);
    expect(out[2].ratio).toBeNull();
  });

  it('groups merchants case-insensitively', () => {
    const out = topMerchants([
      { merchant: 'Carrefour', aed: 50 },
      { merchant: 'carrefour ', aed: 30 },
      { merchant: 'ENOC', aed: 60 },
    ]);
    expect(out[0]).toEqual({ merchant: 'Carrefour', total: 80, count: 2 });
  });

  it('uses the group chosen for a custom category', () => {
    expect(groupOf('Rent')).toBe('other');
    expect(groupOf('Rent', new Map([['Rent', 'essentials']]))).toBe(
      'essentials',
    );
    expect(groupOf('Groceries', new Map([['Groceries', 'lifestyle']]))).toBe(
      'essentials',
    );
  });
});
