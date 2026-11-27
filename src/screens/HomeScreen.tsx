import { useFocusEffect } from '@react-navigation/native';
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
  FlatList,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { TabProps } from '../../App';
import BudgetCard from '../components/BudgetCard';
import MonthlyChart from '../components/MonthlyChart';
import ProLock from '../components/ProLock';
import {
  clearExpenses,
  getMeta,
  getAutoLogSince,
  getSalaryInfo,
  listAutoLogCards,
  listExpenses,
  listMonthSummaries,
  type MonthSummary,
  salaryFor,
  type SalaryInfo,
  toCsv,
} from '../lib/db';
import { monthKey, monthLabel, shiftMonth, startOfToday } from '../lib/months';
import { formatMoney } from '../lib/parse';
import { useAuth } from '../lib/auth/AuthContext';
import { timeLeft, useCurrentOffer, useNow } from '../lib/growth';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { useSubscription } from '../lib/subscription';
import { glow, type ThemeMode, useTheme, useThemeMode } from '../lib/theme';
import { SEEN_KEY } from './SupportScreen';

type Props = TabProps<'Home'>;

const DAY_MS = 86_400_000;

const shortMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AE', {
    month: 'short',
    year: 'numeric',
  });
};

/** Dashboard across all months. Tap a month (list or chart) to open its full detail. */
export default function HomeScreen({ navigation }: Props) {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();
  const { money } = useSalaryPrivacy();
  const { plan, hasPro, trialDaysLeft } = useSubscription();
  const { authedRequest } = useAuth();
  // A reply from the Expences team that the chat hasn't shown yet.
  const [newReply, setNewReply] = useState(false);
  const offer = useCurrentOffer();
  const now = useNow(60_000);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [autoLogOn, setAutoLogOn] = useState(false);
  const [cards, setCards] = useState<string[]>([]);
  const [salary, setSalaryInfo] = useState<SalaryInfo | null>(null);

  const load = useCallback(() => {
    listMonthSummaries()
      .then(setSummaries)
      .catch(err => Alert.alert('Could not load expenses', String(err)));
    const today = startOfToday();
    listExpenses(today, today + DAY_MS)
      .then(rows =>
        setTodayTotal(
          rows
            .filter(e => e.currency === 'AED')
            .reduce((sum, e) => sum + e.amount, 0),
        ),
      )
      .catch(() => {});
    getAutoLogSince()
      .then(since => setAutoLogOn(since != null))
      .catch(() => {});
    getSalaryInfo()
      .then(setSalaryInfo)
      .catch(() => {});
    listAutoLogCards()
      .then(setCards)
      .catch(() => {});
    Promise.all([
      authedRequest<{ lastReplyAt: string | null }>('/support/status'),
      getMeta(SEEN_KEY),
    ])
      .then(([status, seen]) =>
        setNewReply(
          status.lastReplyAt != null &&
            Date.parse(status.lastReplyAt) > Number(seen ?? 0),
        ),
      )
      .catch(() => {});
  }, [authedRequest]);

  // Reload whenever the screen regains focus (e.g. after an auto-logged tap).
  useFocusEffect(load);

  // Payments saved by the Wallet automation happen in the background; refresh on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const current = monthKey();
  const salaryOf = useCallback(
    (month: string) => (salary ? salaryFor(salary, month) : null),
    [salary],
  );
  const stats = useMemo(() => {
    const byKey = new Map(summaries.map(s => [s.month, s]));
    const thisMonth = byKey.get(current) ?? {
      month: current,
      total: 0,
      count: 0,
    };
    const lastMonth = byKey.get(shiftMonth(current, -1));
    const allTotal = summaries.reduce((sum, s) => sum + s.total, 0);
    const allCount = summaries.reduce((sum, s) => sum + s.count, 0);
    const top = summaries.reduce<MonthSummary | null>(
      (best, s) => (!best || s.total > best.total ? s : best),
      null,
    );
    const change =
      lastMonth && lastMonth.total > 0
        ? ((thisMonth.total - lastMonth.total) / lastMonth.total) * 100
        : null;
    // Always list the last 6 months (even empty ones), plus any older month with expenses.
    const recent = Array.from({ length: 6 }, (_, i) => shiftMonth(current, -i));
    const months = [
      ...recent.map(
        key => byKey.get(key) ?? { month: key, total: 0, count: 0 },
      ),
      ...summaries.filter(s => !recent.includes(s.month)),
    ];
    return {
      thisMonth,
      lastMonth,
      allTotal,
      allCount,
      top,
      change,
      monthlyAvg: summaries.length ? allTotal / summaries.length : 0,
      months,
      maxMonth: Math.max(1, ...summaries.map(s => s.total)),
    };
  }, [summaries, current]);

  const openMonth = useCallback(
    (month: string) => navigation.navigate('Month', { month }),
    [navigation],
  );

  const exportAll = useCallback(async () => {
    const rows = await listExpenses(0, Date.now() + DAY_MS);
    if (rows.length === 0) {
      Alert.alert('Nothing to export', 'No expenses recorded yet.');
      return;
    }
    await Share.share({ title: 'All expenses', message: toCsv(rows) });
  }, []);

  const confirmClearAll = useCallback(() => {
    Alert.alert(
      'Clear all history?',
      'Every expense in every month will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const removed = await clearExpenses();
            load();
            Alert.alert('Cleared', `${removed} expense(s) deleted.`);
          },
        },
      ],
    );
  }, [load]);

  const chooseAppearance = useCallback(() => {
    const modes: [ThemeMode, string][] = [
      ['system', 'Match iPhone setting'],
      ['light', 'Light'],
      ['dark', 'Dark'],
    ];
    const labels = modes.map(([m, label]) =>
      m === mode ? `✓ ${label}` : label,
    );
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Appearance',
          options: [...labels, 'Cancel'],
          cancelButtonIndex: modes.length,
        },
        i => modes[i] && setMode(modes[i][0]),
      );
    } else {
      Alert.alert('Appearance', undefined, [
        ...modes.map(([m], i) => ({
          text: labels[i],
          onPress: () => setMode(m),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [mode, setMode]);

  const openMenu = useCallback(() => {
    const actions: [string, () => void][] = [
      ['Import bank statement', () => navigation.navigate('Import')],
      ['Export all (CSV)', exportAll],
      ['Salary', () => navigation.navigate('Salary', { month: current })],
      ['Apple Pay auto-logging', () => navigation.navigate('Setup')],
      ['Appearance (light / dark)', chooseAppearance],
      ['Clear all history', confirmClearAll],
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map(a => a[0]), 'Cancel'],
          destructiveButtonIndex: 5,
          cancelButtonIndex: actions.length,
        },
        i => actions[i]?.[1](),
      );
    } else {
      Alert.alert('Options', undefined, [
        ...actions.map(([text, onPress]) => ({ text, onPress })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [chooseAppearance, confirmClearAll, current, exportAll, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      // React Navigation's documented pattern for header buttons.
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <View style={styles.headerButtons}>
          <Pressable
            onPress={() => navigation.navigate('Support')}
            hitSlop={10}
            accessibilityLabel={
              newReply
                ? 'Help and feedback chat, new reply'
                : 'Help and feedback chat'
            }
            style={[styles.botButton, { backgroundColor: t.accentSoft }]}
          >
            {newReply && (
              <View
                style={[
                  styles.dot,
                  { backgroundColor: t.danger, borderColor: t.bg },
                ]}
              />
            )}
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M12 2.5v3"
                stroke={t.accent}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <Circle cx={12} cy={2.5} r={1.2} fill={t.accent} />
              <Rect
                x={4}
                y={6}
                width={16}
                height={13}
                rx={4}
                stroke={t.accent}
                strokeWidth={2}
                fill="none"
              />
              <Circle cx={9} cy={12} r={1.6} fill={t.accent} />
              <Circle cx={15} cy={12} r={1.6} fill={t.accent} />
              <Path
                d="M9.5 15.8h5M2 11v4M22 11v4"
                stroke={t.accent}
                strokeWidth={2}
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
  }, [navigation, openMenu, newReply, t.accent, t.accentSoft, t.danger, t.bg]);

  const setupColor = autoLogOn ? t.success : t.accent;
  const up = stats.change != null && stats.change > 0;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <FlatList
        data={stats.months}
        keyExtractor={m => m.month}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {offer && (
              <Pressable
                onPress={() => navigation.navigate('Paywall')}
                style={[
                  styles.offer,
                  { backgroundColor: t.success },
                  glow(t.success, 10),
                ]}
                accessibilityRole="button"
              >
                <View style={styles.flex}>
                  <Text style={[styles.offerTitle, { color: t.onAccent }]}>
                    🎁 {offer.title} · {offer.discountPercent}% off Pro
                  </Text>
                  <Text style={[styles.offerMeta, { color: t.onAccent }]}>
                    Ends in {timeLeft(offer.endsAt, now)}
                  </Text>
                </View>
                <Text style={[styles.offerTitle, { color: t.onAccent }]}>
                  ›
                </Text>
              </Pressable>
            )}

            {/* During the free month plans live quietly in Account; the dashboard only nudges once it's over. */}
            {plan === 'free' && (
              <Pressable
                onPress={() => navigation.navigate('Paywall')}
                style={[
                  styles.trial,
                  {
                    backgroundColor:
                      plan === 'free' || trialDaysLeft <= 7
                        ? t.cardHi
                        : t.accentSoft,
                  },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.trialText,
                    {
                      color:
                        plan === 'free' || trialDaysLeft <= 7
                          ? t.warning
                          : t.accent,
                    },
                  ]}
                >
                  {plan === 'free'
                    ? 'Your free trial has ended'
                    : `Free trial · ${trialDaysLeft} day${
                        trialDaysLeft === 1 ? '' : 's'
                      } left`}
                </Text>
                <Text style={[styles.trialText, { color: t.accent }]}>
                  {plan === 'free' ? 'Get Pro ›' : 'See plans ›'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => openMonth(current)}
              style={[
                styles.hero,
                { backgroundColor: t.accent },
                glow(t.accent, 18),
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${monthLabel(current)}, ${formatMoney(
                stats.thisMonth.total,
              )} spent. Open month`}
            >
              <View style={styles.row}>
                <Text style={[styles.heroLabel, { color: t.onAccent }]}>
                  Spent in {monthLabel(current)}
                </Text>
                <Text style={[styles.heroLabel, { color: t.onAccent }]}>
                  Details ›
                </Text>
              </View>
              <Text style={[styles.big, { color: t.onAccent }]}>
                {formatMoney(stats.thisMonth.total)}
              </Text>
              <View style={styles.chipRow}>
                <Stat label="Today" value={formatMoney(todayTotal)} />
                <Stat label="Expenses" value={String(stats.thisMonth.count)} />
                <Stat
                  label="vs last month"
                  value={
                    stats.change == null
                      ? '—'
                      : `${up ? '▲' : '▼'} ${Math.abs(
                          Math.round(stats.change),
                        )}%`
                  }
                />
              </View>
            </Pressable>

            <BudgetCard
              month={current}
              spent={stats.thisMonth.total}
              salary={salaryOf(current)}
              onEditSalary={() =>
                navigation.navigate('Salary', { month: current })
              }
            />

            {hasPro ? (
              <>
                <View
                  style={[
                    styles.card,
                    { backgroundColor: t.card, borderColor: t.border },
                  ]}
                >
                  <Text style={[styles.label, { color: t.muted }]}>
                    Spending by month
                  </Text>
                  <MonthlyChart
                    summaries={summaries}
                    salaryOf={salaryOf}
                    onOpenMonth={openMonth}
                  />
                </View>

                <Pressable
                  onPress={() => navigation.navigate('Import')}
                  style={[
                    styles.banner,
                    { backgroundColor: t.card, borderColor: t.accent },
                    glow(t.accent, 8),
                  ]}
                >
                  <Text style={[styles.bold, { color: t.accent }]}>
                    Import bank statement →
                  </Text>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    Add previous months from your bank's PDF or CSV statement.
                  </Text>
                </Pressable>

                {summaries.length > 0 && (
                  <View style={styles.tileRow}>
                    <Tile
                      label="All time"
                      value={formatMoney(stats.allTotal)}
                      sub={`${stats.allCount} expense(s)`}
                      color={t.accent}
                    />
                    <Tile
                      label="Highest month"
                      value={formatMoney(stats.top?.total ?? 0)}
                      sub={stats.top ? shortMonth(stats.top.month) : '—'}
                      color={t.highlight}
                    />
                    <Tile
                      label="Monthly avg"
                      value={formatMoney(stats.monthlyAvg)}
                      sub={`${summaries.length} month(s)`}
                      color={t.success}
                    />
                  </View>
                )}
              </>
            ) : (
              <ProLock
                title="Charts and insights"
                body="Monthly chart, all-time totals and averages, and statement import."
              />
            )}

            <Pressable
              onPress={() => navigation.navigate('Setup')}
              style={[
                styles.banner,
                { backgroundColor: t.card, borderColor: setupColor },
                glow(setupColor, 8),
              ]}
            >
              <Text style={[styles.bold, { color: setupColor }]}>
                {autoLogOn
                  ? '✓ Apple Pay auto-logging is on'
                  : 'Set up auto-logging for Apple Pay taps →'}
              </Text>
              {autoLogOn && (
                <Text style={[styles.meta, { color: t.muted }]}>
                  {cards.length > 0
                    ? `Cards: ${cards.join('  ·  ')}`
                    : 'Your cards will show here after your first Apple Pay tap.'}
                </Text>
              )}
            </Pressable>

            <Text
              style={[styles.label, styles.sectionTitle, { color: t.muted }]}
            >
              All months
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.muted }]}>
            No expenses yet. Tap your phone to pay, or add one manually.
          </Text>
        }
        renderItem={({ item: m }) => {
          const isCurrent = m.month === current;
          const color = isCurrent ? t.accent : t.secondary;
          return (
            <Pressable
              onPress={() => openMonth(m.month)}
              style={[
                styles.item,
                {
                  backgroundColor: t.card,
                  borderColor: isCurrent ? t.accent : t.border,
                },
              ]}
            >
              <View style={styles.row}>
                <Text style={[styles.monthName, { color: t.text }]}>
                  {monthLabel(m.month)}
                </Text>
                <Text style={[styles.monthTotal, { color: t.text }]}>
                  {formatMoney(m.total)}
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: t.cardHi }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor: color,
                      width: `${Math.max(
                        (m.total / stats.maxMonth) * 100,
                        2,
                      )}%`,
                    },
                    glow(color, 6),
                  ]}
                />
              </View>
              <View style={styles.row}>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {m.count} expense(s)
                  {hasPro && salaryOf(m.month) != null && (
                    <Text
                      style={{
                        color:
                          (salaryOf(m.month) ?? 0) >= m.total
                            ? t.success
                            : t.danger,
                      }}
                    >
                      {'  ·  '}
                      {(salaryOf(m.month) ?? 0) >= m.total ? 'Saved ' : 'Over '}
                      {money(Math.abs((salaryOf(m.month) ?? 0) - m.total))}
                    </Text>
                  )}
                </Text>
                <Text style={[styles.meta, { color }]}>View details ›</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

/** A figure on the hero card (white on the primary color). */
function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.statChip}>
      <Text numberOfLines={1} style={[styles.chipLabel, { color: t.onAccent }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.chipValue, { color: t.onAccent }]}
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
      style={[styles.tile, { backgroundColor: t.card, borderColor: t.border }]}
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
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  offerTitle: { fontSize: 15, fontWeight: '900' },
  offerMeta: { fontSize: 12, fontWeight: '700', marginTop: 2, opacity: 0.9 },
  trial: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    marginBottom: 12,
  },
  trialText: { fontSize: 13, fontWeight: '800' },
  menu: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    zIndex: 1,
  },
  botButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { padding: 20, borderRadius: 20 },
  heroLabel: { fontSize: 13, fontWeight: '600', opacity: 0.85 },
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionTitle: { marginTop: 24, marginBottom: 10 },
  big: {
    fontSize: 40,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  statChip: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  chipLabel: { fontSize: 11, fontWeight: '500', opacity: 0.85 },
  chipValue: { fontSize: 15, fontWeight: '700', marginTop: 2 },
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  banner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
  },
  bold: { fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 24 },
  meta: { fontSize: 12, marginTop: 6 },
  item: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  monthName: { fontSize: 16, fontWeight: '700' },
  monthTotal: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  track: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'visible' },
  bar: { height: 6, borderRadius: 3 },
});
