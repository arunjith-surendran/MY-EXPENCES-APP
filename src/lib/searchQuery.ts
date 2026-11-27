/**
 * Reads what the user typed in Search. Pure, for tests.
 *
 *   "carrefour"        → words to match
 *   "#trip"            → a tag (a #word in the note)
 *   "45.50", "AED 45"  → that amount (and the words, in case it's part of a name)
 *   "45-50", ">100", "<= 20" → an amount range
 */
export type ParsedQuery = {
  words: string;
  tags: string[];
  exact?: number;
  min?: number;
  max?: number;
};

const TAG = /#[\p{L}\p{N}_-]+/gu;
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const CURRENCY = String.raw`(?:aed|dhs?|د\.إ)`;

const toNumber = (s: string) => Number(s.replace(/,/g, ''));

export function parseSearch(raw: string): ParsedQuery {
  const tags = [...raw.matchAll(TAG)].map(m => m[0].toLowerCase());
  let rest = raw.replace(TAG, ' ').replace(/\s+/g, ' ').trim();
  const out: ParsedQuery = { words: '', tags };

  const range = rest.match(
    new RegExp(
      String.raw`^${CURRENCY}?\s*${NUM}\s*(?:-|–|to)\s*${CURRENCY}?\s*${NUM}\s*${CURRENCY}?$`,
      'i',
    ),
  );
  const compare = rest.match(
    new RegExp(
      String.raw`^(>=|<=|>|<)\s*${CURRENCY}?\s*${NUM}\s*${CURRENCY}?$`,
      'i',
    ),
  );
  const exact = rest.match(
    new RegExp(String.raw`^${CURRENCY}?\s*${NUM}\s*${CURRENCY}?$`, 'i'),
  );

  if (range) {
    const a = toNumber(range[1]);
    const b = toNumber(range[2]);
    out.min = Math.min(a, b);
    out.max = Math.max(a, b);
  } else if (compare) {
    const n = toNumber(compare[2]);
    // Amounts have two decimals, so "> 100" starts at 100.01.
    if (compare[1] === '>') out.min = n + 0.005;
    if (compare[1] === '>=') out.min = n;
    if (compare[1] === '<') out.max = n - 0.005;
    if (compare[1] === '<=') out.max = n;
  } else if (exact) {
    out.exact = toNumber(exact[1]);
    // "7" could also be part of a merchant like "7-Eleven".
    out.words = exact[1];
  } else {
    out.words = rest;
  }
  return out;
}

/** The #tags in a note, lower-case, in order, without repeats. */
export function tagsIn(note: string | null | undefined): string[] {
  if (!note) return [];
  return [...new Set([...note.matchAll(TAG)].map(m => m[0].toLowerCase()))];
}
