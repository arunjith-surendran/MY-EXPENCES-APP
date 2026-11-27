import { useCallback, useEffect } from 'react';

import { useAuth } from './auth/AuthContext';
import { getMeta, setMeta } from './db';

/**
 * Tells the admin side which features people use, so the right ones get improved.
 * Only the feature's name, at most once a day each — never amounts, merchants or notes.
 * Must match FEATURES in the backend (src/usage/feature-use.entity.ts).
 */
export type Feature =
  | 'search'
  | 'insights'
  | 'budgets'
  | 'recurring'
  | 'goals'
  | 'debts'
  | 'backup'
  | 'restore'
  | 'receipts'
  | 'split'
  | 'tags'
  | 'categories'
  | 'statement_import'
  | 'export'
  | 'trash';

const today = () => new Date().toISOString().slice(0, 10);
const pending = new Set<Feature>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Returns a function that records a feature as used (batched, once a day, never throws). */
export function useTrackFeature() {
  const { authedRequest, status } = useAuth();
  return useCallback(
    (feature: Feature) => {
      if (status !== 'signedIn') return;
      (async () => {
        const key = `usage:${feature}`;
        if ((await getMeta(key).catch(() => null)) === today()) return;
        pending.add(feature);
        if (timer) return;
        timer = setTimeout(async () => {
          timer = null;
          const features = [...pending];
          pending.clear();
          try {
            await authedRequest('/usage', { body: { features } });
            for (const f of features) await setMeta(`usage:${f}`, today());
          } catch {
            // Offline or an older server: try again another day.
          }
        }, 3000);
      })();
    },
    [authedRequest, status],
  );
}

/** Records a feature when its screen opens. */
export function useFeatureUse(feature: Feature) {
  const track = useTrackFeature();
  useEffect(() => {
    track(feature);
  }, [feature, track]);
}
