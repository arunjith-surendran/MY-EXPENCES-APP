import { remindBackup } from './backupReminder';
import { checkBudgetAlerts } from './budgets';
import { convertForeignExpenses } from './currency';
import { emitDataChanged } from './dataEvents';
import { purgeDeletedExpenses } from './db';
import { tidyReceipts } from './receipts';
import { addDueRecurring } from './recurring';
import { sendWeeklySummary } from './weekly';

/** Deleted expenses stay restorable this long. */
export const BIN_DAYS = 30;

let running: Promise<number> | null = null;

/**
 * Housekeeping when the app opens or comes back: add recurring expenses that came due,
 * give foreign-currency expenses their AED value, empty old items from the bin, and
 * send budget alerts. Returns how many recurring expenses were added. Never throws.
 */
export function runUpkeep(): Promise<number> {
  if (!running) {
    running = (async () => {
      let added = 0;
      try {
        added = await addDueRecurring();
      } catch {}
      await convertForeignExpenses();
      await purgeDeletedExpenses({
        olderThan: Date.now() - BIN_DAYS * 86_400_000,
      }).catch(() => 0);
      await checkBudgetAlerts();
      await sendWeeklySummary();
      await remindBackup();
      await tidyReceipts().catch(() => {});
      if (added > 0) emitDataChanged();
      return added;
    })().finally(() => {
      running = null;
    });
  }
  return running;
}
