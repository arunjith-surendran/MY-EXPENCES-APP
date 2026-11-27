import { Platform } from 'react-native';

import { APP_VERSION } from '../version';
import { request } from './api';
import { getMeta, setMeta } from './db';

export type UpdateStatus = 'none' | 'optional' | 'required';

export type VersionCheck = {
  update: UpdateStatus;
  latestVersion: string;
  minVersion: string;
  storeUrl: string | null;
  message: string | null;
};

/** The admin side's settings for one platform (GET /admin/app-versions). */
export type AppVersionConfig = {
  platform: 'ios' | 'android';
  latestVersion: string;
  minVersion: string;
  storeUrl: string | null;
  message: string | null;
  updatedAt: string;
};

// The last answer that required an update, so going offline doesn't skip it.
const REQUIRED_KEY = 'update_required';
/** The latest version the user tapped "Later" on. */
const DISMISSED_KEY = 'update_dismissed';

/** Negative if a < b, 0 if equal, positive if a > b. Mirrors the backend's semver.ts. */
export function compareVersions(a: string, b: string) {
  const parts = (v: string) => {
    const nums = v
      .trim()
      .split(/[-+]/)[0]
      .split('.')
      .map(n => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return nums;
  };
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Asks the backend whether this build should update. Offline, it falls back to the last
 * required update it heard about, or to "none".
 */
export async function checkForUpdate(): Promise<VersionCheck | null> {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  try {
    const result = await request<VersionCheck>(
      `/app/version?platform=${platform}&version=${encodeURIComponent(
        APP_VERSION,
      )}`,
    );
    await setMeta(
      REQUIRED_KEY,
      result.update === 'required' ? JSON.stringify(result) : '',
    ).catch(() => {});
    return result;
  } catch {
    const saved = await getMeta(REQUIRED_KEY).catch(() => null);
    if (!saved) return null;
    try {
      const cached = JSON.parse(saved) as VersionCheck;
      // Still older than what was required (the user may have updated since).
      return compareVersions(APP_VERSION, cached.minVersion) < 0
        ? cached
        : null;
    } catch {
      return null;
    }
  }
}

export const getDismissedVersion = () =>
  getMeta(DISMISSED_KEY).catch(() => null);

export const dismissVersion = (version: string) =>
  setMeta(DISMISSED_KEY, version).catch(() => {});
