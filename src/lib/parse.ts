/**
 * Helpers for turning the raw values iOS Shortcuts passes from a Wallet
 * "Transaction" automation into clean expense fields.
 *
 * Shortcuts formats the amount using the phone's locale, so we may receive
 * "AED 25.00", "25.00 AED", "د.إ.‏ 25.00", "1,234.50" or Arabic-Indic digits.
 */

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/٫/g, '.').replace(/٬/g, ',');
  const match = s.match(/-?\d[\d,]*(\.\d+)?/);
  if (!match) return null;
  const n = Math.abs(parseFloat(match[0].replace(/,/g, '')));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function parseCurrency(raw: string | undefined): string {
  if (!raw) return 'AED';
  if (raw.includes('د.إ')) return 'AED';
  if (raw.includes('$')) return 'USD';
  if (raw.includes('€')) return 'EUR';
  if (raw.includes('£')) return 'GBP';
  if (raw.includes('₹')) return 'INR';
  const code = raw.match(/\b[A-Z]{3}\b/);
  return code ? code[0] : 'AED';
}

export const CATEGORIES = [
  'Groceries',
  'Food & Dining',
  'Fuel',
  'Transport',
  'Bills & Utilities',
  'Shopping',
  'Health',
  'Personal care',
  'Entertainment',
  'Transfers',
  'Cash withdrawal',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Money that moves but isn't spent: sending to your own or someone else's account, and
 * taking cash out (what the cash is spent on is logged separately). These don't count in
 * spending totals, budgets or insights.
 */
export const NOT_SPENDING: readonly string[] = ['Transfers', 'Cash withdrawal'];

export const isSpending = (category: string) =>
  !NOT_SPENDING.includes(category);

// Merchant → category, first match wins. Brands first, then everyday words, so a
// "Carrefour Market" is Groceries and an unknown "X Cafeteria" is still Food & Dining.
const MERCHANT_RULES: [RegExp, Category][] = [
  [
    // "TRANSFERTO" (no space) on Emirates NBD statements; RMA = a payment to another account.
    /\btransfer|remittance|\bRMA\b|botim money|western union|al ansari exchange|lulu exchange|\bIPP\b|\bFTS\b/i,
    'Transfers',
  ],
  // Bank fees and their VAT (before cash withdrawals: an ATM fee line has the ATM's id too).
  [
    /value added tax|\bvat\b|\bfees?\b|\bcharges?\b|commission/i,
    'Bills & Utilities',
  ],
  [
    // An ATM: a terminal id ("E8001194", "AN900397726497") with a time, or a branch.
    /\bATM\b|cash withdrawal|cash wdl|\bwithdrawal\b|\b[A-Z]\d{7}\b[\s\S]*\bbranch\b|branch combo|\bCDM\b|\d{2}:\d{2}:\d{2}[\s\S]*\b[A-Z]{1,2}\d{7,}\b|\b[A-Z]{1,2}\d{7,}\b[\s\S]*\d{2}:\d{2}:\d{2}/i,
    'Cash withdrawal',
  ],
  [
    /carrefour|lulu|spinneys|waitrose|choithrams|union coop|viva|nesto|grandiose|al maya|kibsons|instashop|west ?zone|nwz|safeer|al madina|rafa al madina|day ?to ?day|aswaaq/i,
    'Groceries',
  ],
  [
    /talabat|deliveroo|noon food|careem food|starbucks|tim hortons|costa|mcdonald|kfc|burger|pizza|shawarma|cafe|caf[eé]|coffee|restaurant|restaur|cafeteria|biriyani|biryani|grill|kitchen|bakery|bakers|karak|chai|tea |tea tower|foods?\b|oven|paratha|manchurian|mandi|darbar|dhaba|qawwali|seafood|eatery|diner/i,
    'Food & Dining',
  ],
  [
    /supermarket|superma\b|supermrkt|super market|hypermarket|hyperma|grocery|groceries|mini ?mart|minimart|mini mar\b|\bmini\b|baqala|bakala|market\b|mart\b|fruits|vegetables/i,
    'Groceries',
  ],
  [/enoc|adnoc|emarat|eppco/i, 'Fuel'],
  [
    /careem|uber|\brta\b|\bnol\b|salik|darb|metro|taxi|parkin|valtrans/i,
    'Transport',
  ],
  [
    /dewa|sewa|addc|fewa|etisalat|e&|\bdu\b|empower|tabreed|digital dubai|dubai now|virgin mobile/i,
    'Bills & Utilities',
  ],
  [
    /salon|\bsalo\b|barber|beauty|spa\b|nails|grooming|parlour|parlor/i,
    'Personal care',
  ],
  [
    /noon|amazon|namshi|ikea|centrepoint|\bmax\b|home centre|sharaf dg|jumbo|virgin|mall|tamara|tabby|department|trading|general tr|genral tr/i,
    'Shopping',
  ],
  [/pharmacy|aster|life pharmacy|boots|clinic|hospital|medcare|nmc/i, 'Health'],
  [
    /vox|reel cinema|novo|netflix|spotify|apple\.com|playstation|steam/i,
    'Entertainment',
  ],
];

/**
 * A statement line's category: the merchant rules, plus the amount for ATM lines, since
 * an ATM only pays out multiples of AED 10 (an AED 2.00 line there is the ATM's fee).
 */
export function statementCategory(
  description: string,
  amount: number,
): Category {
  const c = guessCategory(description);
  if (c === 'Cash withdrawal' && Math.round(amount * 100) % 1000 !== 0) {
    return 'Bills & Utilities';
  }
  return c;
}

export function guessCategory(merchant: string): Category {
  for (const [re, cat] of MERCHANT_RULES) if (re.test(merchant)) return cat;
  return 'Other';
}

export function formatMoney(amount: number, currency = 'AED') {
  return `${currency} ${amount.toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
