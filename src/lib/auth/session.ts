import * as Keychain from 'react-native-keychain';

import type { User } from '../api';

const SERVICE = 'com.expences.app.session';

/** What survives an app restart: the refresh token and the last known profile (for offline start). */
export type StoredSession = { refreshToken: string; user: User };

/**
 * Kept in the iOS Keychain / Android Keystore, never in AsyncStorage or SQLite.
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: readable while the app runs in the
 * background (Apple Pay auto-logging), never restored onto another device from a backup.
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const entry = await Keychain.getGenericPassword({ service: SERVICE });
    if (!entry) return null;
    const parsed = JSON.parse(entry.password) as StoredSession;
    return parsed.refreshToken && parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession) {
  await Keychain.setGenericPassword('session', JSON.stringify(session), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearSession() {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
