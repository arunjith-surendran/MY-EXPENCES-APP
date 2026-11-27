import { useCallback, useEffect, useState } from 'react';

import {
  addCustomCategory,
  deleteCustomCategory,
  getMerchantCategory,
  listCustomCategories,
  listMerchantCategories,
  merchantKey,
  setMerchantCategory,
} from './db';
import { CATEGORIES, guessCategory } from './parse';

/**
 * Categories are the built-in ones plus any the user adds. User categories and the
 * per-merchant memory live only in the phone's database, like the expenses themselves.
 */

export const isBuiltInCategory = (name: string) =>
  (CATEGORIES as readonly string[]).some(
    c => c.toLowerCase() === name.trim().toLowerCase(),
  );

// Placeholder names that say nothing about the merchant, so they aren't remembered.
const GENERIC_MERCHANTS = new Set(['cash', 'card', 'apple pay']);

/** The category for a merchant: the one the user last picked for it, else the built-in guess. */
export async function categoryFor(merchant: string): Promise<string> {
  const learned = await getMerchantCategory(merchant).catch(() => null);
  return learned ?? guessCategory(merchant);
}

export type CategoryResolver = (
  merchant: string,
  description?: string,
) => string;

/**
 * The same lookup for many merchants at once (statement import). The built-in guess
 * reads `description` when given, since a statement line says more than the merchant name.
 */
export async function categoryResolver(): Promise<CategoryResolver> {
  const learned = await listMerchantCategories().catch(
    () => new Map<string, string>(),
  );
  return (merchant, description = merchant) =>
    learned.get(merchantKey(merchant)) ?? guessCategory(description);
}

/**
 * Remembers the user's choice so the next payment at this merchant (manual, Apple Pay
 * or a statement) gets the same category without picking it again.
 */
export async function rememberCategory(merchant: string, category: string) {
  const key = merchantKey(merchant);
  if (!key || GENERIC_MERCHANTS.has(key)) return;
  // Nothing to remember when it matches the built-in guess, unless it overrides an earlier choice.
  const previous = await getMerchantCategory(merchant);
  if (previous == null && guessCategory(merchant) === category) return;
  await setMerchantCategory(merchant, category);
}

/** Built-in categories, then the user's own, with "Other" always last. */
export function useCategories() {
  const [custom, setCustom] = useState<string[]>([]);

  const reload = useCallback(
    () =>
      listCustomCategories()
        .then(setCustom)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const add = useCallback(
    async (raw: string): Promise<string> => {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (!name) throw new Error('Type a name for the category.');
      if (name.length > 24) throw new Error('Keep it to 24 characters.');
      const existing = [...CATEGORIES, ...custom].find(
        c => c.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return existing;
      await addCustomCategory(name);
      await reload();
      return name;
    },
    [custom, reload],
  );

  const remove = useCallback(
    async (name: string) => {
      await deleteCustomCategory(name);
      await reload();
    },
    [reload],
  );

  const builtIn = CATEGORIES.filter(c => c !== 'Other');
  return {
    all: [...builtIn, ...custom, 'Other'] as string[],
    custom,
    add,
    remove,
  };
}
