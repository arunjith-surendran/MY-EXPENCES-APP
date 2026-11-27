import { monthKey, monthRange, shiftMonth } from '../src/lib/months';

describe('months', () => {
  it('builds zero-padded keys', () => {
    expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01');
    expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12');
  });

  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('returns a [start, end) range covering the whole month', () => {
    const { start, end } = monthRange('2026-02');
    expect(new Date(start)).toEqual(new Date(2026, 1, 1));
    expect(new Date(end)).toEqual(new Date(2026, 2, 1));
    // The last millisecond of Feb 28 is inside, March 1 00:00 is not.
    expect(new Date(2026, 1, 28, 23, 59, 59, 999).getTime()).toBeLessThan(end);
  });
});
