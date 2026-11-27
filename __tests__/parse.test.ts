import {
  formatMoney,
  guessCategory,
  parseAmount,
  parseCurrency,
} from '../src/lib/parse';

describe('parseAmount', () => {
  it.each([
    ['AED 25.00', 25],
    ['25.00 AED', 25],
    ['د.إ.‏ 1,234.50', 1234.5],
    ['٤٢٫٥٠ د.إ.‏', 42.5],
    ['$9.99', 9.99],
    ['-AED 10', 10],
    ['12.345', 12.35],
  ])('%s → %d', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each([undefined, '', 'AED', 'abc', '0', 'AED 0.00'])('rejects %p', raw => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe('parseCurrency', () => {
  it('defaults to AED', () => {
    expect(parseCurrency(undefined)).toBe('AED');
    expect(parseCurrency('42.50')).toBe('AED');
  });
  it('reads symbols and codes', () => {
    expect(parseCurrency('د.إ.‏ 10')).toBe('AED');
    expect(parseCurrency('$5')).toBe('USD');
    expect(parseCurrency('USD 5.00')).toBe('USD');
    expect(parseCurrency('₹100')).toBe('INR');
  });
});

describe('guessCategory', () => {
  it.each([
    ['CARREFOUR MOE', 'Groceries'],
    ['LULU HYPERMARKET', 'Groceries'],
    ['ENOC 1023', 'Fuel'],
    ['Careem Food', 'Food & Dining'],
    ['Careem', 'Transport'],
    ['DEWA', 'Bills & Utilities'],
    ['Talabat', 'Food & Dining'],
    ['Life Pharmacy', 'Health'],
    ['Random Shop LLC', 'Other'],
  ])('%s → %s', (merchant, category) => {
    expect(guessCategory(merchant)).toBe(category);
  });
});

describe('formatMoney', () => {
  it('uses two decimals and a currency prefix', () => {
    expect(formatMoney(1234.5)).toBe('AED 1,234.50');
    expect(formatMoney(9.99, 'USD')).toBe('USD 9.99');
  });
});
