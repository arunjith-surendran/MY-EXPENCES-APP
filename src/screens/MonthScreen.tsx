import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActionSheetIOS,
  Alert,
  AppState,
  Platform,
  Pressable,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RootStackParamList, TabProps } from '../../App';
import BudgetCard from '../components/BudgetCard';
import ProLock from '../components/ProLock';
import DailyChart from '../components/DailyChart';
import Gradient from '../components/Gradient';
import { useUndo } from '../components/UndoToast';
import { useDataChanged } from '../lib/dataEvents';
import { listReceiptIds } from '../lib/receipts';
import {
  aedOf,
  deleteExpensesByIds,
  sumAed,
  getSalaryInfo,
  salaryFor,
  type Expense,
  listExpenses,
  toCsv,
} from '../lib/db';
import { useConversion } from '../lib/currency';
import { monthKey, monthLabel, monthRange, startOfToday } from '../lib/months';
import { formatMoney } from '../lib/parse';
import { useSubscription } from '../lib/subscription';
import {
  cardShadow,
  categoryStyle,
  glow,
  textGlow,
  useTheme,
} from '../lib/theme';
import { useTrackFeature } from '../lib/usage';

/** Opened for any month from the stack, or as the "Month" tab for the current month. */
type Props =
  | NativeStackScreenProps<RootStackParamList, 'Month'>
  | TabProps<'ThisMonth'>;

type DaySection = { title: string; total: number; data: Expense[] };

/** Everything for one month: totals, daily chart, highlights, categories, expenses by day. */
export default function MonthScreen({ route }: Props) {
  const t = useTheme();
  const track = useTrackFeature();
  // Same object either way; typed as the stack so it can open Add, Import and Salary.
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { hasPro } = useSubscription();
  const { convert } = useConversion();
  const { showUndo } = useUndo();
  const month = route.name === 'Month' ? route.params.month : monthKey();
  const isCurrentMonth = month === monthKey();
  const [items, setItems] = useState<Expense[]>([]);
  const [receiptIds, setReceiptIds] = useState<Set<number>>(new Set());
  // Select mode (hold an expense, or "Select expenses" in the menu): ids ticked for deleting.
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [salary, setSalary] = useState<number | null>(null);

  const load = useCallback(() => {
    const { start, end } = monthRange(month);
    listExpenses(start, end)
      .then(setItems)
      .catch(err => Alert.alert('Could not load expenses', String(err)));
    getSalaryInfo()
      .then(info => setSalary(salaryFor(info, month)))
      .catch(() => {});
    listReceiptIds()
      .then(setReceiptIds)
      .catch(() => {});
  }, [month]);

  // Reload whenever the screen regains focus (e.g. after editing an expense).
  useFocusEffect(load);
  useDataChanged(load);

  // Payments saved by the Wallet automation happen in the background; refresh on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  // Foreign-currency payments still waiting for an exchange rate.
  const unconverted = useMemo(
    () => items.filter(e => aedOf(e) == null),
    [items],
  );

  const { monthTotal, todayTotal, cashTotal, byCategory } = useMemo(() => {
    const today = startOfToday();
    let monthSum = 0;
    let todaySum = 0;
    let cashSum = 0;
    const perCategory: Record<string, number> = {};
    for (const e of items) {
      // Totals are in AED: other currencies count once their rate is known.
      const aed = aedOf(e);
      if (aed == null) continue;
      monthSum += aed;
      if (e.method === 'cash') cashSum += aed;
      if (e.created_at >= today) todaySum += aed;
      perCategory[e.category] = (perCategory[e.category] ?? 0) + aed;
    }
    return {
      monthTotal: monthSum,
      todayTotal: todaySum,
      cashTotal: cashSum,
      byCategory: Object.entries(perCategory).sort((a, b) => b[1] - a[1]),
    };
  }, [items]);

  const highlights = useMemo(() => {
    const perDay = new Map<number, number>();
    let biggest: Expense | null = null;
    for (const e of items) {
      const aed = aedOf(e);
      if (aed == null) continue;
      const d = new Date(e.created_at).getDate();
      perDay.set(d, (perDay.get(d) ?? 0) + aed);
      if (!biggest || aed > (aedOf(biggest) ?? 0)) biggest = e;
    }
    let topDay = 0;
    let topAmount = 0;
    perDay.forEach((amt, d) => {
      if (amt > topAmount) {
        topAmount = amt;
        topDay = d;
      }
    });
    const [y, m] = month.split('-').map(Number);
    const daysSoFar = isCurrentMonth
      ? new Date().getDate()
      : new Date(y, m, 0).getDate();
    return {
      topDayLabel: topDay
        ? new Date(y, m - 1, topDay).toLocaleDateString('en-AE', {
            day: 'numeric',
            month: 'short',
          })
        : '—',
      topAmount,
      biggest,
      perDayAvg: monthTotal / daysSoFar,
    };
  }, [items, month, isCurrentMonth, monthTotal]);

  // Expenses grouped by calendar day, newest day first (items arrive newest first).
  const sections = useMemo(() => {
    const out: DaySection[] = [];
    for (const e of items) {
      const title = new Date(e.created_at).toLocaleDateString('en-AE', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      let s = out[out.length - 1];
      if (!s || s.title !== title) {
        s = { title, total: 0, data: [] };
        out.push(s);
      }
      s.data.push(e);
      s.total += aedOf(e) ?? 0;
    }
    return out;
  }, [items]);

  const toggleSelected = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = useCallback(() => {
    if (!selected || selected.size === 0) return;
    const chosen = items.filter(e => selected.has(e.id));
    const total = sumAed(chosen);
    Alert.alert(
      `Delete ${chosen.length} expense${chosen.length === 1 ? '' : 's'}?`,
      `${formatMoney(total)} in total. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ids = chosen.map(e => e.id);
            await deleteExpensesByIds(ids).catch(() => 0);
            setSelected(null);
            load();
            showUndo({
              message: `${ids.length} expense${
                ids.length === 1 ? '' : 's'
              } deleted`,
              ids,
              onUndone: load,
            });
          },
        },
      ],
    );
  }, [items, load, selected, showUndo]);

  const exportCsv = useCallback(async () => {
    if (items.length === 0) {
      Alert.alert('Nothing to export', `No expenses in ${monthLabel(month)}.`);
      return;
    }
    track('export');
    await Share.share({ title: `Expenses ${month}`, message: toCsv(items) });
  }, [items, month, track]);

  const openMenu = useCallback(() => {
    const actions: [string, () => void][] = [
      [
        `Import ${monthLabel(month)} statement`,
        () => navigation.navigate('Import', { month }),
      ],
      ['Insights', () => navigation.navigate('Insights', { month })],
      ['Export this month (CSV)', exportCsv],
      ['Select expenses', () => setSelected(new Set())],
      ['Delete expenses…', () => navigation.navigate('Delete', { month })],
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map(a => a[0]), 'Cancel'],
          destructiveButtonIndex: actions.length - 1,
          cancelButtonIndex: actions.length,
        },
        i => actions[i]?.[1](),
      );
    } else {
      Alert.alert('Options', undefined, [
        ...actions.map(([text, onPress], i) => ({
          text,
          onPress,
          style:
            i === actions.length - 1
              ? ('destructive' as const)
              : ('default' as const),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [exportCsv, month, navigation]);

  const selecting = selected != null;
  const allSelected =
    selecting && items.length > 0 && selected.size === items.length;

  useLayoutEffect(() => {
    if (selecting) {
      navigation.setOptions({
        title: selected.size ? `${selected.size} selected` : 'Select expenses',
        // eslint-disable-next-line react/no-unstable-nested-components
        headerLeft: () => (
          <Pressable onPress={() => setSelected(null)} hitSlop={12}>
            <Text style={[styles.headerBtn, { color: t.accent }]}>Cancel</Text>
          </Pressable>
        ),
        // eslint-disable-next-line react/no-unstable-nested-components
        headerRight: () => (
          <Pressable
            onPress={() =>
              setSelected(
                allSelected ? new Set() : new Set(items.map(e => e.id)),
              )
            }
            hitSlop={12}
          >
            <Text style={[styles.headerBtn, { color: t.accent }]}>
              {allSelected ? 'Select none' : 'Select all'}
            </Text>
          </Pressable>
        ),
      });
      return;
    }
    navigation.setOptions({
      title: monthLabel(month),
      headerLeft: undefined,
      // React Navigation's documented pattern for header buttons.
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.navigate('Search', { month })}
            hitSlop={12}
            accessibilityLabel={`Search ${monthLabel(month)}`}
          >
            <Svg width={21} height={21} viewBox="0 0 24 24">
              <Circle
                cx={11}
                cy={11}
                r={7}
                stroke={t.accent}
                strokeWidth={2.2}
                fill="none"
              />
              <Path
                d="m20 20-4-4"
                stroke={t.accent}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
          <Pressable
            onPress={openMenu}
            hitSlop={12}
            accessibilityLabel="More options"
          >
            <Text style={[styles.menu, { color: t.accent }]}>•••</Text>
          </Pressable>
        </View>
      ),
    });
  }, [
    navigation,
    openMenu,
    month,
    t.accent,
    selecting,
    selected,
    allSelected,
    items,
  ]);

  // Leaving the month (or switching it) ends select mode.
  useEffect(() => setSelected(null), [month]);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={e => String(e.id)}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <View
              style={[styles.hero, { borderColor: t.border }, cardShadow(t)]}
            >
              <Gradient colors={t.gradients.surface} radius={22} />
              <Text style={[styles.label, { color: t.accent }]}>
                Total spent · {items.length} expense(s)
              </Text>
              <Text style={[styles.big, { color: t.text }, textGlow(t.accent)]}>
                {formatMoney(monthTotal)}
              </Text>
              {convert(monthTotal) && (
                <Text style={[styles.converted, { color: t.muted }]}>
                  {convert(monthTotal)}
                </Text>
              )}
              {unconverted.length > 0 && (
                <Text style={[styles.converted, { color: t.warning }]}>
                  {unconverted.length} payment
                  {unconverted.length === 1 ? '' : 's'} in{' '}
                  {[...new Set(unconverted.map(e => e.currency))].join(', ')}{' '}
                  not counted yet: needs an exchange rate (go online).
                </Text>
              )}
              <View style={styles.chipRow}>
                {isCurrentMonth && (
                  <Stat
                    label="Today"
                    value={formatMoney(todayTotal)}
                    color={t.highlight}
                  />
                )}
                <Stat
                  label="Card"
                  value={formatMoney(monthTotal - cashTotal)}
                  color={t.accent}
                />
                <Stat
                  label="Cash"
                  value={formatMoney(cashTotal)}
                  color={t.cash}
                />
              </View>
            </View>

            <BudgetCard
              month={month}
              spent={monthTotal}
              salary={salary}
              onEditSalary={() => navigation.navigate('Salary', { month })}
            />

            {hasPro ? (
              <>
                <Pressable
                  onPress={() => navigation.navigate('Import', { month })}
                  style={[
                    styles.importCard,
                    { backgroundColor: t.card, borderColor: t.accent },
                    glow(t.accent, 8),
                  ]}
                >
                  <Text style={[styles.bold, { color: t.accent }]}>
                    Import {monthLabel(month)} statement →
                  </Text>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    Upload your bank statement to fill in this month
                    automatically.
                  </Text>
                </Pressable>

                <View
                  style={[
                    styles.card,
                    { backgroundColor: t.card, borderColor: t.border },
                    cardShadow(t),
                  ]}
                >
                  <Text style={[styles.label, { color: t.muted }]}>
                    Daily spending
                  </Text>
                  <DailyChart items={items} month={month} />
                </View>

                {items.length > 0 && (
                  <View style={styles.tileRow}>
                    <Tile
                      label="Highest day"
                      value={formatMoney(highlights.topAmount)}
                      sub={highlights.topDayLabel}
                      color={t.highlight}
                    />
                    <Tile
                      label="Biggest expense"
                      value={formatMoney(highlights.biggest?.amount ?? 0)}
                      sub={highlights.biggest?.merchant ?? '—'}
                      color={t.warning}
                    />
                    <Tile
                      label="Per day"
                      value={formatMoney(highlights.perDayAvg)}
                      sub="average"
                      color={t.success}
                    />
                  </View>
                )}

                {byCategory.length > 0 && (
                  <View
                    style={[
                      styles.card,
                      { backgroundColor: t.card, borderColor: t.border },
                      cardShadow(t),
                    ]}
                  >
                    <Text style={[styles.label, { color: t.muted }]}>
                      By category
                    </Text>
                    {byCategory.map(([cat, amt]) => {
                      const c = categoryStyle(cat, t);
                      const pct = monthTotal > 0 ? (amt / monthTotal) * 100 : 0;
                      return (
                        <View key={cat} style={styles.catRow}>
                          <View style={styles.row}>
                            <View style={styles.catName}>
                              <View
                                style={[
                                  styles.dot,
                                  { backgroundColor: c.color },
                                  glow(c.color, 4),
                                ]}
                              />
                              <Text style={{ color: t.text }}>{cat}</Text>
                            </View>
                            <Text style={[styles.bold, { color: t.text }]}>
                              {formatMoney(amt)}
                              <Text style={{ color: t.muted }}>
                                {'  '}
                                {Math.round(pct)}%
                              </Text>
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.track,
                              { backgroundColor: t.cardHi },
                            ]}
                          >
                            <View
                              style={[
                                styles.bar,
                                {
                                  backgroundColor: c.color,
                                  width: `${Math.max(pct, 2)}%`,
                                },
                                glow(c.color, 6),
                              ]}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            ) : (
              <ProLock
                title="Charts and insights"
                body="Daily chart, highlights, spending by category and statement import."
              />
            )}

            <Text
              style={[styles.label, styles.sectionTitle, { color: t.muted }]}
            >
              Day by day
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.muted }]}>
            {isCurrentMonth
              ? 'No expenses yet. Tap your phone to pay, or add one manually.'
              : 'No expenses this month.'}
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={[styles.dayTitle, { color: t.text }]}>
              {section.title}
            </Text>
            <Text style={[styles.dayTotal, { color: t.accent }]}>
              {formatMoney(section.total)}
              <Text style={{ color: t.muted }}>
                {'  ·  '}
                {section.data.length}
              </Text>
            </Text>
          </View>
        )}
        renderItem={({ item: e }) => {
          const c = categoryStyle(e.category, t);
          const ticked = selected?.has(e.id) ?? false;
          return (
            <Pressable
              onPress={() =>
                selecting
                  ? toggleSelected(e.id)
                  : navigation.navigate('Add', { id: String(e.id) })
              }
              onLongPress={() => toggleSelected(e.id)}
              accessibilityState={selecting ? { checked: ticked } : undefined}
              style={[
                styles.item,
                {
                  backgroundColor: t.card,
                  borderColor: ticked ? t.danger : t.border,
                },
                ticked && styles.itemTicked,
                cardShadow(t),
              ]}
            >
              {selecting && (
                <View
                  style={[
                    styles.check,
                    { borderColor: ticked ? t.danger : t.border },
                    ticked && { backgroundColor: t.danger },
                  ]}
                >
                  {ticked && (
                    <Text style={[styles.checkMark, { color: t.onAccent }]}>
                      ✓
                    </Text>
                  )}
                </View>
              )}
              <View
                style={[
                  styles.icon,
                  { borderColor: c.color, backgroundColor: t.cardHi },
                  glow(c.color, 6),
                ]}
              >
                <Text style={[styles.iconText, { color: c.color }]}>
                  {c.icon}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text
                  style={[styles.bold, { color: t.text }]}
                  numberOfLines={1}
                >
                  {e.merchant}
                  {receiptIds.has(e.id) ? ' 📎' : ''}
                </Text>
                <Text
                  style={[styles.meta, { color: t.muted }]}
                  numberOfLines={1}
                >
                  {new Date(e.created_at).toLocaleTimeString('en-AE', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {e.category}
                  {e.card ? ` · ${e.card}` : ''}
                </Text>
              </View>
              <View style={styles.amountCol}>
                <Text style={[styles.amount, { color: t.text }]}>
                  {formatMoney(e.amount, e.currency)}
                </Text>
                {e.method === 'cash' && (
                  <Text
                    style={[
                      styles.cashPill,
                      { color: t.cash, borderColor: t.cash },
                    ]}
                  >
                    Cash
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {selecting && (
        <View
          style={[
            styles.selectBar,
            { backgroundColor: t.bg, borderTopColor: t.border },
          ]}
        >
          <Pressable
            onPress={deleteSelected}
            disabled={selected.size === 0}
            accessibilityRole="button"
            style={[
              styles.deleteBtn,
              { backgroundColor: t.danger },
              selected.size === 0 && styles.dimmed,
            ]}
          >
            <Text style={[styles.fabText, { color: t.onAccent }]}>
              {selected.size === 0
                ? 'Tap expenses to select'
                : `Delete ${selected.size} expense${
                    selected.size === 1 ? '' : 's'
                  }`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.statChip,
        { borderColor: t.border, backgroundColor: t.cardHi },
      ]}
    >
      <Text style={[styles.chipLabel, { color: t.muted }]}>{label}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.chipValue, { color }]}
      >
        {value}
      </Text>
    </View>
  );
}

function Tile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: t.card, borderColor: t.border },
        cardShadow(t),
      ]}
    >
      <Text style={[styles.tileLabel, { color: t.muted }]}>{label}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.tileValue, { color: t.text }]}
      >
        {value}
      </Text>
      <Text numberOfLines={1} style={[styles.tileSub, { color }]}>
        {sub}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 32 },
  menu: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  hero: {
    padding: 20,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  sectionTitle: { marginTop: 24 },
  big: { fontSize: 42, fontWeight: '800', marginTop: 6 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  statChip: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  chipValue: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  catName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  catRow: { marginTop: 12 },
  tileRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tileValue: { fontSize: 15, fontWeight: '800', marginTop: 6 },
  tileSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, marginTop: 6, overflow: 'visible' },
  bar: { height: 6, borderRadius: 3 },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 16,
    marginBottom: 8,
  },
  dayTitle: { fontSize: 15, fontWeight: '800' },
  dayTotal: { fontSize: 14, fontWeight: '800' },
  bold: { fontWeight: '700' },
  importCard: { marginTop: 16, padding: 14, borderRadius: 16, borderWidth: 1 },
  empty: { textAlign: 'center', marginTop: 24 },
  meta: { fontSize: 12, marginTop: 3 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  amount: { fontWeight: '800', fontSize: 15 },
  converted: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  amountCol: { alignItems: 'flex-end', gap: 4 },
  cashPill: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  fabText: { fontWeight: '800', fontSize: 17 },
  headerBtn: { fontSize: 16, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  itemTicked: { borderWidth: 1.5 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 15, fontWeight: '900', marginTop: -1 },
  selectBar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  deleteBtn: { padding: 16, borderRadius: 14, alignItems: 'center' },
  dimmed: { opacity: 0.5 },
});
