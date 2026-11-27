import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  addCustomCategory,
  type CategoryGroup,
  type CustomCategory,
  deleteCustomCategory,
  getMerchantCategory,
  listCustomCategories,
  listMerchantCategories,
  merchantKey,
  renameCustomCategory,
  setCategoryGroup,
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

/** Checks a new or renamed category name; returns it tidied, or throws a readable error. */
export function cleanCategoryName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Type a name for the category.');
  if (name.length > 24) throw new Error('Keep it to 24 characters.');
  return name;
}

/** Built-in categories, then the user's own, with "Other" always last. */
export function useCategories() {
  const [customList, setCustomList] = useState<CustomCategory[]>([]);

  const reload = useCallback(
    () =>
      listCustomCategories()
        .then(setCustomList)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const custom = useMemo(() => customList.map(c => c.name), [customList]);
  const groups = useMemo(
    () => new Map(customList.map(c => [c.name, c.group] as const)),
    [customList],
  );

  const add = useCallback(
    async (raw: string, group: CategoryGroup = 'other'): Promise<string> => {
      const name = cleanCategoryName(raw);
      const existing = [...CATEGORIES, ...custom].find(
        c => c.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return existing;
      await addCustomCategory(name, group);
      await reload();
      return name;
    },
    [custom, reload],
  );

  const rename = useCallback(
    async (from: string, raw: string): Promise<string> => {
      const to = cleanCategoryName(raw);
      if (to === from) return to;
      const clash = [...CATEGORIES, ...custom].find(
        c => c !== from && c.toLowerCase() === to.toLowerCase(),
      );
      if (clash) throw new Error(`"${clash}" already exists.`);
      await renameCustomCategory(from, to);
      await reload();
      return to;
    },
    [custom, reload],
  );

  const setGroup = useCallback(
    async (name: string, group: CategoryGroup) => {
      await setCategoryGroup(name, group);
      await reload();
    },
    [reload],
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
    /** The group of each category the user added. */
    groups,
    add,
    rename,
    setGroup,
    remove,
    reload,
  };
}
