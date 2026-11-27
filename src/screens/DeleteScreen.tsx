import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import {
  deleteExpensesByIds,
  sumAed,
  type Expense,
  firstExpenseAt,
  listExpenses,
  listMonthSummaries,
  type MonthSummary,
} from '../lib/db';
import { Chip, DayStepper } from '../components/FilterControls';
import { useUndo } from '../components/UndoToast';
import { monthKey, monthLabel } from '../lib/months';
import { formatMoney } from '../lib/parse';
import {
  addDays,
  type Period,
  PERIODS,
  periodLabel,
  rangeFor,
  shortDay,
} from '../lib/periods';
import { categoryStyle, glow, useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Delete'>;

type Method = 'any' | 'card' | 'cash';

/**
 * Delete expenses in bulk: pick a period (day, week, month, any month, a date range or
 * everything), narrow it by category or card/cash, untick any to keep, then delete.
 */
export default function DeleteScreen({ route }: Props) {
  const t = useTheme();
  const { showUndo } = useUndo();
  const presetMonth = route.params?.month;
  const [period, setPeriod] = useState<Period>(
    presetMonth ? 'month' : 'thisMonth',
  );
  const [month, setMonth] = useState(presetMonth ?? monthKey());
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [from, setFrom] = useState(() => addDays(new Date(), -6));
  const [to, setTo] = useState(() => new Date());
  const [firstAt, setFirstAt] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('any');
  const [category, setCategory] = useState<string | null>(null);
  const [items, setItems] = useState<Expense[] | null>(null);
  // Ticked rows are deleted; everything matching starts ticked.
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const range = useMemo(
    () => rangeFor(period, month, from, to),
    [period, month, from, to],
  );

  const load = useCallback(() => {
    listExpenses(range.start, range.end)
      .then(rows => {
        setItems(rows);
        setKept(new Set());
      })
      .catch(() => setItems([]));
    listMonthSummaries()
      .then(setMonths)
      .catch(() => {});
    firstExpenseAt()
      .then(setFirstAt)
      .catch(() => {});
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  // Only the categories that appear in this period, as filters.
  const categories = useMemo(
    () => [...new Set((items ?? []).map(e => e.category))].sort(),
    [items],
  );
  useEffect(() => {
    if (category && !categories.includes(category)) setCategory(null);
  }, [categories, category]);

  const matching = useMemo(
    () =>
      (items ?? []).filter(
        e =>
          (method === 'any' || e.method === method) &&
          (category == null || e.category === category),
      ),
    [items, method, category],
  );
  const chosen = matching.filter(e => !kept.has(e.id));
  const chosenTotal = sumAed(chosen);

  const toggle = (id: number) =>
    setKept(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allTicked = chosen.length === matching.length;
  const toggleAll = () =>
    setKept(allTicked ? new Set(matching.map(e => e.id)) : new Set());

  const periodText = period === 'all' ? 'all time' : periodLabel(period, range);

  const confirmDelete = () => {
    if (chosen.length === 0) return;
    const whole =
      chosen.length === items?.length && method === 'any' && category == null;
    Alert.alert(
      `Delete ${chosen.length} expense${chosen.length === 1 ? '' : 's'}?`,
      `${whole ? 'Everything' : 'The ticked expenses'} from ${periodText}${
        chosenTotal > 0 ? ` (${formatMoney(chosenTotal)})` : ''
      } will be deleted. You can undo it, or restore them from Recently deleted for 30 days.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const ids = chosen.map(e => e.id);
              const removed = await deleteExpensesByIds(ids);
              load();
              showUndo({
                message: `${removed} expense${
                  removed === 1 ? '' : 's'
                } deleted`,
                ids,
                onUndone: load,
              });
            } catch (err) {
              Alert.alert("Couldn't delete", String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const header = (
    <View style={styles.header}>
      <Text style={[styles.label, { color: t.muted }]}>Period</Text>
      <View style={styles.chips}>
        {PERIODS.map(([p, text]) => (
          <Chip
            key={p}
            label={text}
            on={period === p}
            onPress={() => setPeriod(p)}
          />
        ))}
      </View>

      {period === 'month' && (
        <>
          <Text style={[styles.label, { color: t.muted }]}>Month</Text>
          {months.length === 0 ? (
            <Text style={{ color: t.muted }}>No expenses yet.</Text>
          ) : (
            <View style={styles.chips}>
              {months.map(m => (
                <Chip
                  key={m.month}
                  label={`${monthLabel(m.month)} · ${m.count}`}
                  on={month === m.month}
                  onPress={() => setMonth(m.month)}
                />
              ))}
            </View>
          )}
        </>
      )}

      {period === 'custom' && (
        <>
          <DayStepper
            label="From"
            value={from}
            onChange={setFrom}
            min={firstAt}
          />
          <DayStepper label="To" value={to} onChange={setTo} min={firstAt} />
        </>
      )}

      <Text style={[styles.label, { color: t.muted }]}>Paid with</Text>
      <View style={styles.chips}>
        {(
          [
            ['any', 'Card & cash'],
            ['card', '💳 Card'],
            ['cash', '💵 Cash'],
          ] as const
        ).map(([m, text]) => (
          <Chip
            key={m}
            label={text}
            on={method === m}
            onPress={() => setMethod(m)}
          />
        ))}
      </View>

      {categories.length > 1 && (
        <>
          <Text style={[styles.label, { color: t.muted }]}>Category</Text>
          <View style={styles.chips}>
            <Chip
              label="All categories"
              on={category == null}
              onPress={() => setCategory(null)}
            />
            {categories.map(c => (
              <Chip
                key={c}
                label={c}
                on={category === c}
                color={categoryStyle(c, t).color}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
        </>
      )}

      <View
        style={[
          styles.summary,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <View style={styles.flex}>
          <Text style={[styles.summaryTitle, { color: t.text }]}>
            {chosen.length} of {matching.length} selected
          </Text>
          <Text style={{ color: t.muted }}>
            {periodText}
            {chosenTotal > 0 ? ` · ${formatMoney(chosenTotal)}` : ''}
          </Text>
        </View>
        {matching.length > 0 && (
          <Pressable onPress={toggleAll} hitSlop={8}>
            <Text style={[styles.bold, { color: t.accent }]}>
              {allTicked ? 'Untick all' : 'Tick all'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <FlatList
        data={matching}
        keyExtractor={e => String(e.id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          items == null ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <Text style={[styles.empty, { color: t.muted }]}>
              Nothing to delete in this period.
            </Text>
          )
        }
        renderItem={({ item: e }) => {
          const on = !kept.has(e.id);
          const c = categoryStyle(e.category, t);
          return (
            <Pressable
              onPress={() => toggle(e.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[
                styles.row,
                { backgroundColor: t.card, borderColor: t.border },
                !on && styles.off,
              ]}
            >
              <View
                style={[
                  styles.check,
                  { borderColor: on ? t.danger : t.border },
                  on && { backgroundColor: t.danger },
                ]}
              >
                {on && (
                  <Text style={[styles.checkMark, { color: t.onAccent }]}>
                    ✓
                  </Text>
                )}
              </View>
              <View style={styles.flex}>
                <Text
                  numberOfLines={1}
                  style={[styles.bold, { color: t.text }]}
                >
                  {e.merchant}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.meta, { color: t.muted }]}
                >
                  {shortDay(e.created_at)} ·{' '}
                  <Text style={{ color: c.color }}>{e.category}</Text>
                  {e.method === 'cash' ? ' · Cash' : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: t.text }]}>
                {formatMoney(e.amount, e.currency)}
              </Text>
            </Pressable>
          );
        }}
      />
      <View
        style={[
          styles.footer,
          { backgroundColor: t.bg, borderTopColor: t.border },
        ]}
      >
        <Pressable
          onPress={confirmDelete}
          disabled={busy || chosen.length === 0}
          accessibilityRole="button"
          style={[
            styles.button,
            { backgroundColor: t.danger },
            glow(t.danger, 10),
            (busy || chosen.length === 0) && styles.dimmed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text style={[styles.buttonText, { color: t.onAccent }]}>
              {chosen.length === 0
                ? 'Nothing selected'
                : `Delete ${chosen.length} expense${
                    chosen.length === 1 ? '' : 's'
                  }`}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 10, marginBottom: 10 },
  list: { padding: 16, paddingBottom: 24, gap: 8 },
  loader: { marginTop: 24 },
  label: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bold: { fontWeight: '700' },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  summaryTitle: { fontSize: 16, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  off: { opacity: 0.5 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 14, fontWeight: '900', marginTop: -1 },
  meta: { fontSize: 12, marginTop: 3 },
  amount: { fontWeight: '800', fontSize: 15 },
  empty: { textAlign: 'center', marginTop: 24 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  button: { padding: 16, borderRadius: 14, alignItems: 'center' },
  buttonText: { fontWeight: '800', fontSize: 16 },
  dimmed: { opacity: 0.5 },
});
