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
  'Entertainment',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

// Common UAE merchants → category. Matched case-insensitively against the merchant name.
const MERCHANT_RULES: [RegExp, Category][] = [
  [
    /carrefour|lulu|spinneys|waitrose|choithrams|union coop|viva|nesto|grandiose|al maya|kibsons|instashop/i,
    'Groceries',
  ],
  [
    /talabat|deliveroo|noon food|careem food|starbucks|tim hortons|costa|mcdonald|kfc|burger|pizza|shawarma|cafe|coffee|restaurant|cafeteria/i,
    'Food & Dining',
  ],
  [/enoc|adnoc|emarat|eppco/i, 'Fuel'],
  [/careem|uber|rta|nol|salik|darb|metro|taxi|parkin|valtrans/i, 'Transport'],
  [
    /dewa|sewa|addc|fewa|etisalat|e&|\bdu\b|empower|tabreed/i,
    'Bills & Utilities',
  ],
  [
    /noon|amazon|namshi|ikea|centrepoint|max|home centre|sharaf dg|jumbo|virgin|mall/i,
    'Shopping',
  ],
  [/pharmacy|aster|life pharmacy|boots|clinic|hospital|medcare|nmc/i, 'Health'],
  [
    /vox|reel cinema|novo|netflix|spotify|apple\.com|playstation|steam/i,
    'Entertainment',
  ],
];

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
