import { getDb, getMeta, setMeta } from './db';
import { monthKey, monthLabel, monthRange } from './months';
import { notifyNow } from './notifications';
import { formatMoney } from './parse';

/** A monthly limit per category, e.g. Food & Dining ≤ AED 1,500. Kept on the phone. */
export type BudgetProgress = {
  category: string;
  budget: number;
  spent: number;
};

/** Alert when spending passes these shares of a budget. */
const LEVELS = [0.8, 1] as const;

export async function listBudgets(): Promise<Map<string, number>> {
  const { rows } = await getDb().execute(
    'SELECT category, amount FROM budgets ORDER BY category',
  );
  return new Map(rows.map(r => [String(r.category), Number(r.amount)]));
}

/** Sets a category's monthly budget; null or 0 removes it. */
export async function setBudget(category: string, amount: number | null) {
  if (!amount || amount <= 0) {
    await getDb().execute('DELETE FROM budgets WHERE category = ?', [category]);
  } else {
    await getDb().execute(
      'INSERT OR REPLACE INTO budgets (category, amount) VALUES (?, ?)',
      [category, amount],
    );
  }
}

/** Each budget with what's been spent against it in `month` ("2026-11"), fullest first. */
export async function budgetProgress(
  month = monthKey(),
): Promise<BudgetProgress[]> {
  const { start, end } = monthRange(month);
  const { rows } = await getDb().execute(
    `SELECT b.category AS category, b.amount AS budget,
            COALESCE(SUM(CASE WHEN e.currency = 'AED' THEN e.amount ELSE e.aed_amount END), 0) AS spent
     FROM budgets b
     LEFT JOIN expenses e
       ON e.category = b.category AND e.created_at >= ? AND e.created_at < ?
     GROUP BY b.category, b.amount`,
    [start, end],
  );
  return rows
    .map(r => ({
      category: String(r.category),
      budget: Number(r.budget),
      spent: Number(r.spent ?? 0),
    }))
    .sort((a, b) => b.spent / b.budget - a.spent / a.budget);
}

/** The highest alert level reached (0, 0.8 or 1). Pure, for tests. */
export function levelReached(spent: number, budget: number): number {
  let reached = 0;
  for (const level of LEVELS)
    if (budget > 0 && spent >= budget * level) reached = level;
  return reached;
}

/**
 * Sends a notification the first time this month a budget passes 80% and 100%.
 * Runs after saving expenses and when the app opens (Apple Pay taps save natively).
 */
export async function checkBudgetAlerts(month = monthKey()) {
  try {
    for (const b of await budgetProgress(month)) {
      const reached = levelReached(b.spent, b.budget);
      if (reached === 0) continue;
      const key = `budget_alert:${month}:${b.category}`;
      const sent = Number((await getMeta(key)) ?? 0);
      if (reached <= sent) continue;
      await setMeta(key, String(reached));
      const over = b.spent - b.budget;
      await notifyNow(
        key,
        reached >= 1
          ? `${b.category} budget used up`
          : `${b.category}: 80% of budget spent`,
        reached >= 1
          ? `${formatMoney(b.spent)} of ${formatMoney(
              b.budget,
            )} in ${monthLabel(month)}${
              over > 0 ? ` (${formatMoney(over)} over)` : ''
            }.`
          : `${formatMoney(b.spent)} of ${formatMoney(
              b.budget,
            )} so far in ${monthLabel(month)}.`,
      );
    }
  } catch {
    // Alerts are a nicety; never break saving an expense.
  }
}
