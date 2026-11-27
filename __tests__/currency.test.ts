import { formatIn, isStale, parseRates } from '../src/lib/currency';

jest.mock('../src/lib/db', () => ({ getMeta: jest.fn(), setMeta: jest.fn() }));

describe('parseRates', () => {
  it('reads open.er-api.com', () => {
    const r = parseRates({
      result: 'success',
      time_last_update_unix: 1_795_737_751,
      rates: { AED: 1, INR: 25.19, USD: 0.2723 },
    });
    expect(r?.rates.INR).toBe(25.19);
    expect(r?.updatedAt).toBe(1_795_737_751_000);
  });

  it('reads the jsDelivr fallback and drops non-currency codes', () => {
    const r = parseRates({
      date: '2026-11-26',
      aed: { inr: 25.2, '1inch': 4.6, usd: 0.27 },
    });
    expect(r?.rates).toEqual({ INR: 25.2, USD: 0.27 });
  });

  it('rejects anything else', () => {
    expect(parseRates({ result: 'error' })).toBeNull();
    expect(parseRates(null)).toBeNull();
  });
});

describe('isStale', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  it('refreshes after 12 hours', () => {
    expect(isStale({ updatedAt: now - 11 * 3_600_000, rates: {} }, now)).toBe(
      false,
    );
    expect(isStale({ updatedAt: now - 13 * 3_600_000, rates: {} }, now)).toBe(
      true,
    );
    expect(isStale(null, now)).toBe(true);
  });
});

describe('formatIn', () => {
  it('uses whole rupees with Indian grouping for large amounts', () => {
    expect(formatIn(251_934.4, 'INR')).toMatch(/2,51,934/);
  });
  it('keeps decimals for small amounts', () => {
    expect(formatIn(27.23, 'USD')).toMatch(/27\.23/);
  });
});
