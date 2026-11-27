import { getDb } from './db';

/** Something to save for ("Trip to Georgia", AED 5,000 by March), kept on the phone. */
export type Goal = {
  id: number;
  name: string;
  target: number;
  deadline: number | null;
  emoji: string | null;
  created_at: number;
  done_at: number | null;
  /** Sum of the money put towards it. */
  saved: number;
};

export async function listGoals(): Promise<Goal[]> {
  const { rows } = await getDb().execute(
    `SELECT g.*, COALESCE(SUM(e.amount), 0) AS saved
     FROM goals g LEFT JOIN goal_entries e ON e.goal_id = g.id
     GROUP BY g.id
     ORDER BY g.done_at IS NOT NULL, COALESCE(g.deadline, 9e15), g.created_at`,
  );
  return rows.map(r => ({ ...(r as unknown as Goal), saved: Number(r.saved) }));
}

export async function addGoal(g: {
  name: string;
  target: number;
  deadline: number | null;
  emoji: string | null;
}): Promise<number> {
  const result = await getDb().execute(
    'INSERT INTO goals (name, target, deadline, emoji, created_at) VALUES (?, ?, ?, ?, ?)',
    [g.name, g.target, g.deadline, g.emoji, Date.now()],
  );
  return result.insertId ?? 0;
}

/** Puts money towards a goal (or takes it out, with a negative amount). */
export async function addToGoal(goalId: number, amount: number) {
  await getDb().execute(
    'INSERT INTO goal_entries (goal_id, amount, created_at) VALUES (?, ?, ?)',
    [goalId, amount, Date.now()],
  );
}

export async function setGoalDone(goalId: number, done: boolean) {
  await getDb().execute('UPDATE goals SET done_at = ? WHERE id = ?', [
    done ? Date.now() : null,
    goalId,
  ]);
}

export async function deleteGoal(goalId: number) {
  await getDb().transaction(async tx => {
    await tx.execute('DELETE FROM goal_entries WHERE goal_id = ?', [goalId]);
    await tx.execute('DELETE FROM goals WHERE id = ?', [goalId]);
  });
}

/** How much to put aside each month to reach it in time; null without a deadline. Pure. */
export function monthlyNeeded(
  goal: Pick<Goal, 'target' | 'saved' | 'deadline'>,
  now = new Date(),
): number | null {
  if (goal.deadline == null) return null;
  const left = Math.max(0, goal.target - goal.saved);
  if (left === 0) return 0;
  const end = new Date(goal.deadline);
  const months =
    (end.getFullYear() - now.getFullYear()) * 12 +
    (end.getMonth() - now.getMonth()) +
    (end.getDate() >= now.getDate() ? 1 : 0);
  return left / Math.max(1, months);
}
