import { sameShop, shopKey } from '../src/lib/merchants';
import { guessCategory, isSpending, statementCategory } from '../src/lib/parse';
import { incomeKind } from '../src/lib/income';

jest.mock('../src/lib/db', () => ({ getDb: jest.fn() }));

describe('sameShop', () => {
  it('ignores spacing, case and company words', () => {
    expect(shopKey('Akawi Oven DMCC')).toBe('akawioven');
    expect(sameShop('AKAWI OVENDMCC', 'Akawi Oven DMCC')).toBe(true);
    expect(sameShop('LEMANCHURIAN', 'Le Manchurian')).toBe(true);
  });
  it('matches a cut-off name', () => {
    expect(
      sameShop('Mehfil Biriyani Restaur', 'Mehfil Biriyani Restaurant'),
    ).toBe(true);
  });
  it('treats placeholder names as unknown (a match)', () => {
    expect(sameShop('Apple Pay', 'Carrefour')).toBe(true);
    expect(sameShop('Card', 'ENOC')).toBe(true);
  });
  it('keeps different shops apart', () => {
    expect(sameShop('Bright Moon Mini', 'Star Kadooli Supermrkt')).toBe(false);
    expect(sameShop('Noon', 'Carrefour')).toBe(false);
  });
});

describe('statement categories', () => {
  const cat = (s: string, amount = 10) => statementCategory(s, amount);
  it('files transfers and ATM cash as not spending', () => {
    expect(
      cat('MOBILE BANKING TRANSFERTO AE000000000000000000000 RefNo:-X'),
    ).toBe('Transfers');
    expect(cat('RMA 2026110800 AE060330000019120 156.00')).toBe('Transfers');
    expect(cat('-11-2026 12:25:09 DEIRA AE AN900397726497', 1000)).toBe(
      'Cash withdrawal',
    );
    expect(
      cat(
        'CARD NO.4111 -11-2026 19:39:49 E8001194 610459 Bur Dubai Branch Combo 1',
        200,
      ),
    ).toBe('Cash withdrawal');
    expect(isSpending('Transfers')).toBe(false);
    expect(isSpending('Cash withdrawal')).toBe(false);
    expect(isSpending('Groceries')).toBe(true);
  });
  it('treats an ATM line that is not a multiple of 10 as the fee', () => {
    expect(cat('CARD NO.4111 12:25:09 AN900397726497 DEIRA AE', 2)).toBe(
      'Bills & Utilities',
    );
    expect(cat('Value Added Tax(VAT) @5% AN900397 DEIRA AE', 0.1)).toBe(
      'Bills & Utilities',
    );
  });
  it('knows everyday shop words, not just brands', () => {
    expect(guessCategory('NWZ WESTZONE SUPERMARKET')).toBe('Groceries');
    expect(guessCategory('STAR KADOOLI SUPERMRKT')).toBe('Groceries');
    expect(guessCategory('BRIGHT MOON MINI DUBAI')).toBe('Groceries');
    expect(guessCategory('RAFA AL MADINA HYPERMA')).toBe('Groceries');
    expect(guessCategory('PAK DARBAR RESTAURANT B')).toBe('Food & Dining');
    expect(guessCategory('AKAWI OVEN DMCC')).toBe('Food & Dining');
    expect(guessCategory('LUXURY FIVE WOMEN SALO')).toBe('Personal care');
    expect(guessCategory('RTA GOLD SOUQ')).toBe('Transport');
    expect(guessCategory('e& Digital App')).toBe('Bills & Utilities');
    expect(guessCategory('Carrefour City')).toBe('Groceries');
  });
});

describe('incomeKind', () => {
  it('tells refunds from transfers in', () => {
    expect(incomeKind('REFUND AMAZON')).toBe('refund');
    expect(incomeKind('MOBILE BANKING TRANSFER FROM JOHN')).toBe('transfer_in');
    expect(incomeKind('INTEREST')).toBe('other');
  });
});
