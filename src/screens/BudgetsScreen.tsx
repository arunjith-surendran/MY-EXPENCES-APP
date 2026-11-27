import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCategories } from '../lib/categories';
import {
  budgetProgress,
  checkBudgetAlerts,
  listBudgets,
  runsOutOn,
  setBudget,
} from '../lib/budgets';
import { listMonthCategoryTotals } from '../lib/db';
import { monthKey, monthLabel, ordinal } from '../lib/months';
import { formatMoney, parseAmount } from '../lib/parse';
import { categoryStyle, useTheme } from '../lib/theme';
import { useFeatureUse } from '../lib/usage';

/**
 * A monthly limit per category. The dashboard shows how much of each is used, and a
 * notification comes at 80% and when it's used up.
 */
export default function BudgetsScreen() {
  const t = useTheme();
  useFeatureUse('budgets');
  const categories = useCategories();
  const month = monthKey();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [total, setTotal] = useState({ budget: 0, spent: 0 });

  const load = useCallback(async () => {
    const [budgets, totals, progress] = await Promise.all([
      listBudgets(),
      listMonthCategoryTotals(),
      budgetProgress(month),
    ]);
    setDrafts(Object.fromEntries([...budgets].map(([c, a]) => [c, String(a)])));
    setSpent(
      Object.fromEntries(
        totals.filter(r => r.month === month).map(r => [r.category, r.total]),
      ),
    );
    setTotal({
      budget: progress.reduce((s, p) => s + p.budget, 0),
      spent: progress.reduce((s, p) => s + p.spent, 0),
    });
  }, [month]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const save = async (category: string) => {
    const amount = parseAmount(drafts[category] ?? '');
    await setBudget(category, amount).catch(() => {});
    setDrafts(d => ({ ...d, [category]: amount ? String(amount) : '' }));
    await load().catch(() => {});
    checkBudgetAlerts(month);
  };

  const used = total.budget > 0 ? total.spent / total.budget : 0;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.hero, { backgroundColor: t.accent }]}>
        <Text style={[styles.heroLabel, { color: t.onAccent }]}>
          {monthLabel(month)} · budgets
        </Text>
        <Text style={[styles.heroValue, { color: t.onAccent }]}>
          {total.budget > 0
            ? `${formatMoney(total.spent)} of ${formatMoney(total.budget)}`
            : 'No budgets yet'}
        </Text>
        {total.budget > 0 && (
          <View style={styles.heroTrack}>
            <View
              style={[
                styles.heroFill,
                { width: `${Math.min(100, used * 100)}%` },
              ]}
            />
          </View>
        )}
        <Text style={[styles.heroHint, { color: t.onAccent }]}>
          Set a monthly limit for any category. You'll get a notification at 80%
          and when it's used up.
        </Text>
      </View>

      {categories.all.map(category => {
        const c = categoryStyle(category, t);
        const budget = parseAmount(drafts[category] ?? '') ?? 0;
        const s = spent[category] ?? 0;
        const ratio = budget > 0 ? s / budget : 0;
        const color =
          ratio >= 1 ? t.danger : ratio >= 0.8 ? t.warning : t.success;
        return (
          <View
            key={category}
            style={[
              styles.card,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: c.color }]} />
              <View style={styles.flex}>
                <Text style={[styles.name, { color: t.text }]}>{category}</Text>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {formatMoney(s)} this month
                </Text>
              </View>
              <TextInput
                value={drafts[category] ?? ''}
                onChangeText={v => setDrafts(d => ({ ...d, [category]: v }))}
                onEndEditing={() => save(category)}
                placeholder="No limit"
                placeholderTextColor={t.muted}
                keyboardType="decimal-pad"
                returnKeyType="done"
                style={[
                  styles.input,
                  {
                    color: t.text,
                    backgroundColor: t.cardHi,
                    borderColor: budget ? c.color : t.border,
                  },
                ]}
              />
            </View>
            {budget > 0 && (
              <>
                <View style={[styles.track, { backgroundColor: t.cardHi }]}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.min(100, ratio * 100)}%`,
                        backgroundColor: color,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.meta, { color }]}>
                  {ratio >= 1
                    ? `${formatMoney(s - budget)} over`
                    : `${formatMoney(budget - s)} left · ${Math.round(
                        ratio * 100,
                      )}% used`}
                </Text>
                {(() => {
                  const d = new Date();
                  const on = runsOutOn(
                    s,
                    budget,
                    d.getDate(),
                    new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
                  );
                  return on ? (
                    <Text style={[styles.meta, { color: t.warning }]}>
                      ⚠️ At this pace it runs out on the {ordinal(on)}. Spend{' '}
                      {formatMoney(
                        (budget - s) /
                          Math.max(
                            1,
                            new Date(
                              d.getFullYear(),
                              d.getMonth() + 1,
                              0,
                            ).getDate() - d.getDate(),
                          ),
                      )}{' '}
                      a day or less to stay within it.
                    </Text>
                  ) : null;
                })()}
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40, gap: 10 },
  flex: { flex: 1 },
  hero: { padding: 18, borderRadius: 20, gap: 8, marginBottom: 6 },
  heroLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.9,
  },
  heroValue: { fontSize: 22, fontWeight: '900' },
  heroTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  heroFill: { height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  heroHint: { fontSize: 13, lineHeight: 18, opacity: 0.9 },
  card: {
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12, fontWeight: '600' },
  input: {
    width: 110,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    textAlign: 'right',
  },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
