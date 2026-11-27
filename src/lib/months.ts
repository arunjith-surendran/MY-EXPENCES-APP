/** Month keys look like "2026-10" and always use the phone's local time zone. */

export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseKey(key: string): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [y, m - 1];
}

/** [start, end) in unix ms for the given month. */
export function monthRange(key: string): { start: number; end: number } {
  const [y, m] = parseKey(key);
  return {
    start: new Date(y, m, 1).getTime(),
    end: new Date(y, m + 1, 1).getTime(),
  };
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = parseKey(key);
  return monthKey(new Date(y, m + delta, 1));
}

export function monthLabel(key: string): string {
  const [y, m] = parseKey(key);
  return new Date(y, m, 1).toLocaleString('en-AE', {
    month: 'long',
    year: 'numeric',
  });
}

export function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
