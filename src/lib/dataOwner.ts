import { getMeta, setMeta, wipeAllData } from './db';
import { cancelNotification } from './notifications';
import { listRecurring } from './recurring';

/**
 * Expenses live in one database on the phone, not per account. The account that owns
 * them is remembered here, so a different account signing in is asked what to do
 * instead of silently seeing someone else's spending.
 */
const OWNER_ID_KEY = 'data_owner_id';
const OWNER_LABEL_KEY = 'data_owner_label';

export type Owner = { id: string; label: string };

export async function getOwner(): Promise<Owner | null> {
  const [id, label] = await Promise.all([
    getMeta(OWNER_ID_KEY).catch(() => null),
    getMeta(OWNER_LABEL_KEY).catch(() => null),
  ]);
  return id ? { id, label: label || 'another account' } : null;
}

export async function setOwner(owner: Owner) {
  await setMeta(OWNER_ID_KEY, owner.id);
  await setMeta(OWNER_LABEL_KEY, owner.label);
}

/** Deletes everything on the phone, including scheduled reminders. */
export async function wipeEverything() {
  const reminders = await listRecurring().catch(() => []);
  for (const r of reminders) await cancelNotification(`recurring-${r.id}`);
  await wipeAllData();
}

/** Keys that belong to this phone and account, never copied by a backup. */
export const OWNER_KEYS = [OWNER_ID_KEY, OWNER_LABEL_KEY];
