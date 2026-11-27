/**
 * Telling whether two merchant names are the same shop. Banks and Apple Pay spell names
 * differently ("AKAWI OVENDMCC", "Akawi Oven DMCC"; "LEMANCHURIAN" vs "Le Manchurian").
 * Pure, for tests.
 */

// Company-form words that say nothing about which shop it is.
const COMPANY_WORDS =
  /\b(dmcc|llc|l\.l\.c|fze|fzco|fzc|fz llc|est|establishment|trading|tr|co|company|branch|br)\b/g;

/** Placeholder names (manual entries, Apple Pay without a merchant) match anything. */
const GENERIC = new Set(['applepay', 'card', 'cash', 'banktransaction', '']);

/** "Akawi Oven DMCC" → "akawioven". */
export function shopKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(COMPANY_WORDS, ' ')
    .replace(/[^a-z0-9؀-ۿ]+/g, '');
}

/** True if the two names are probably the same shop. */
export function sameShop(a: string, b: string): boolean {
  const ka = shopKey(a);
  const kb = shopKey(b);
  if (GENERIC.has(ka) || GENERIC.has(kb)) return true;
  if (ka === kb) return true;
  // One is a cut-off or longer version of the other ("Mehfil Biriyani Restaur").
  const short = ka.length <= kb.length ? ka : kb;
  const long = ka.length <= kb.length ? kb : ka;
  return (
    short.length >= 5 &&
    long.startsWith(short.slice(0, Math.max(5, short.length - 2)))
  );
}
