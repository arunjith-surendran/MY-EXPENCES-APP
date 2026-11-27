import { getDb, getMeta, setMeta } from './db';
import { notifyNow } from './notifications';

/** Set by the Backup screen after each backup. */
export const LAST_BACKUP_KEY = 'last_backup_at';
const NUDGED_KEY = 'backup_nudged_at';
const HIDDEN_UNTIL_KEY = 'backup_card_hidden_until';
const DAY = 86_400_000;
const EVERY_DAYS = 30;
/** Not worth nagging about a handful of expenses. */
const MIN_EXPENSES = 20;

export type BackupDue = { due: boolean; days: number | null };

/** Whether a backup is due: over 30 days since the last one (or never), with real data. */
export async function backupDue(now = Date.now()): Promise<BackupDue> {
  const { rows } = await getDb().execute('SELECT COUNT(*) AS n FROM expenses');
  if (Number(rows[0]?.n ?? 0) < MIN_EXPENSES) return { due: false, days: null };
  const last = await getMeta(LAST_BACKUP_KEY).catch(() => null);
  const days = last ? Math.floor((now - Date.parse(last)) / DAY) : null;
  return { due: days == null || days >= EVERY_DAYS, days };
}

/** For the dashboard card: due, and not put off with "Later" in the last week. */
export async function showBackupCard(now = Date.now()): Promise<BackupDue> {
  const status = await backupDue(now);
  const hidden = Number(
    (await getMeta(HIDDEN_UNTIL_KEY).catch(() => null)) ?? 0,
  );
  return { ...status, due: status.due && now > hidden };
}

export async function hideBackupCard(now = Date.now()) {
  await setMeta(HIDDEN_UNTIL_KEY, String(now + 7 * DAY)).catch(() => {});
}

/** At most once a month, a notification when a backup is due. Never throws. */
export async function remindBackup(now = Date.now()) {
  try {
    const { due, days } = await backupDue(now);
    if (!due) return;
    const nudged = Number((await getMeta(NUDGED_KEY)) ?? 0);
    if (now - nudged < EVERY_DAYS * DAY) return;
    await setMeta(NUDGED_KEY, String(now));
    await notifyNow(
      'backup-reminder',
      'Back up your expenses',
      days == null
        ? "Your expenses live only on this phone. Save a backup to Files or iCloud Drive so they're safe."
        : `Your last backup was ${days} days ago. Save a new one so recent expenses are safe too.`,
    );
  } catch {
    // A reminder is a nicety.
  }
}
