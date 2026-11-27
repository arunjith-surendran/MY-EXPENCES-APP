import { useCallback, useEffect, useState } from 'react';
import { NativeModules } from 'react-native';

import { getMeta, setMeta } from './db';

/** A message from the Expences team (GET /notifications). */
export type TeamNotification = {
  id: string;
  title: string;
  body: string;
  kind: 'custom' | 'offer';
  offerId: string | null;
  createdAt: string;
};

type Native = {
  requestPermission: () => Promise<boolean>;
  show: (id: string, title: string, body: string) => Promise<void>;
};

// Missing on an old build without the native module: everything here becomes a no-op.
const native = NativeModules.LocalNotifications as Native | undefined;

const ASKED_KEY = 'notify_asked';
/** Newest message already shown as a notification (ISO time). */
const SHOWN_KEY = 'notify_shown_at';
/** Newest message the user has seen in the inbox (ISO time). */
const READ_KEY = 'notify_read_at';
/** Read by the Apple Pay action (ios/Expences/SavePaymentIntent.swift); '0' turns payment notifications off. */
export const PAYMENTS_KEY = 'notify_payments';

/** At most this many banners at once, so a long absence doesn't flood the lock screen. */
const MAX_BANNERS = 3;

/** Asks for notification permission the first time only; iOS remembers the answer. */
export async function askPermissionOnce() {
  if (!native || (await getMeta(ASKED_KEY).catch(() => '1'))) return;
  await setMeta(ASKED_KEY, '1');
  await native.requestPermission().catch(() => false);
}

/** Messages not yet shown as banners, oldest first. Pure, for tests. */
export function toAnnounce(
  items: TeamNotification[],
  shownAt: string | null,
): TeamNotification[] {
  // First sync on this phone: don't replay old messages as banners (the inbox still has them).
  if (shownAt == null) return [];
  return items
    .filter(n => n.createdAt > shownAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_BANNERS);
}

export function countUnread(
  items: TeamNotification[],
  readAt: string | null,
): number {
  return items.filter(n => readAt == null || n.createdAt > readAt).length;
}

const newest = (items: TeamNotification[]) =>
  items.reduce<string | null>(
    (max, n) => (max == null || n.createdAt > max ? n.createdAt : max),
    null,
  );

/** Shows banners for new messages and remembers them. Returns the unread count. */
export async function syncTeamNotifications(
  items: TeamNotification[],
): Promise<number> {
  const [shownAt, readAt] = await Promise.all([
    getMeta(SHOWN_KEY).catch(() => null),
    getMeta(READ_KEY).catch(() => null),
  ]);
  for (const n of toAnnounce(items, shownAt)) {
    await native?.show(n.id, n.title, n.body).catch(() => {});
  }
  const latest = newest(items) ?? new Date().toISOString();
  if (shownAt == null || latest > shownAt) {
    await setMeta(SHOWN_KEY, latest).catch(() => {});
  }
  return countUnread(items, readAt);
}

export async function markRead(items: TeamNotification[]) {
  const latest = newest(items);
  if (latest) await setMeta(READ_KEY, latest).catch(() => {});
}

/** The "notify me about payments" switch in Account. */
export function usePaymentNotifications() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    getMeta(PAYMENTS_KEY)
      .then(v => setEnabled(v !== '0'))
      .catch(() => {});
  }, []);
  const set = useCallback(async (on: boolean) => {
    setEnabled(on);
    if (on) await native?.requestPermission().catch(() => false);
    await setMeta(PAYMENTS_KEY, on ? '1' : '0').catch(() => {});
  }, []);
  return { enabled, set };
}
