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
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { TabProps } from '../../App';
import BudgetCard from '../components/BudgetCard';
import Gradient from '../components/Gradient';
import HealthCard from '../components/HealthCard';
import LifestyleChart from '../components/LifestyleChart';
import PatternsChart from '../components/PatternsChart';
import ProLock from '../components/ProLock';
import {
  getMeta,
  getAutoLogSince,
  getSalaryInfo,
  listAutoLogCards,
  listDayTotals,
  listExpenses,
  sumAed,
  listMonthCategoryTotals,
  listMonthSummaries,
  type MonthCategoryTotal,
  type MonthSummary,
  salaryFor,
  type SalaryInfo,
  toCsv,
} from '../lib/db';
import {
  monthKey,
  monthLabel,
  monthRange,
  ordinal,
  shiftMonth,
  startOfToday,
} from '../lib/months';
import {
  activeMonths,
  assessMonth,
  dailySeries,
  groupByMonth,
  type GroupTotals,
  weekdayAverages,
} from '../lib/insights';
import { budgetProgress, type BudgetProgress, runsOutOn } from '../lib/budgets';
import { useCategories } from '../lib/categories';
import { useConversion } from '../lib/currency';
import { useDataChanged } from '../lib/dataEvents';
import { runUpkeep } from '../lib/upkeep';
import {
  askPermissionOnce,
  syncTeamNotifications,
  type TeamNotification,
} from '../lib/notifications';
import { formatMoney } from '../lib/parse';
import { useAuth } from '../lib/auth/AuthContext';
import { timeLeft, useCurrentOffer, useNow } from '../lib/growth';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { useSubscription } from '../lib/subscription';
import {
  cardShadow,
  glow,
  type ThemeMode,
  useTheme,
  useThemeMode,
} from '../lib/theme';
import { useTrackFeature } from '../lib/usage';
import { SEEN_KEY } from './SupportScreen';

type Props = TabProps<'Home'>;

const DAY_MS = 86_400_000;
const CHART_MONTHS = 12;
const NO_GROUPS: GroupTotals = { essentials: 0, lifestyle: 0, other: 0 };

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
  const track = useTrackFeature();
  const { mode, setMode } = useThemeMode();
  const { money } = useSalaryPrivacy();
  const { plan, hasPro, trialDaysLeft } = useSubscription();
  const { authedRequest } = useAuth();
  const { convert } = useConversion();
  // A reply from the Expences team that the chat hasn't shown yet.
  const [newReply, setNewReply] = useState(false);
  const [unread, setUnread] = useState(0);
  const offer = useCurrentOffer();
  const now = useNow(60_000);
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [dayTotals, setDayTotals] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [categoryTotals, setCategoryTotals] = useState<MonthCategoryTotal[]>(
    [],
  );
  const [todayTotal, setTodayTotal] = useState(0);
  const [autoLogOn, setAutoLogOn] = useState(false);
  const [cards, setCards] = useState<string[]>([]);
  const [salary, setSalaryInfo] = useState<SalaryInfo | null>(null);

  const [budgets, setBudgets] = useState<BudgetProgress[]>([]);
  const paceDay = (b: BudgetProgress) => {
    const d = new Date();
    return runsOutOn(
      b.spent,
      b.budget,
      d.getDate(),
      new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
    );
  };
  const categoryList = useCategories();

  const load = useCallback(() => {
    budgetProgress()
      .then(setBudgets)
      .catch(() => {});
    listMonthSummaries()
      .then(setSummaries)
      .catch(err => Alert.alert('Could not load expenses', String(err)));
    listMonthCategoryTotals()
      .then(setCategoryTotals)
      .catch(() => {});
    const today = startOfToday();
    // This month day by day, and 12 weeks back for the weekday pattern.
    listDayTotals(
      Math.min(monthRange(monthKey()).start, today - 83 * DAY_MS),
      today + DAY_MS,
    )
      .then(setDayTotals)
      .catch(() => {});
    listExpenses(today, today + DAY_MS)
      .then(rows => setTodayTotal(sumAed(rows)))
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
    // Team messages: new ones become notifications, the bell shows the unread count.
    authedRequest<{ notifications: TeamNotification[] }>('/notifications')
      .then(({ notifications }) => syncTeamNotifications(notifications))
      .then(setUnread)
      .catch(() => {});
  }, [authedRequest]);

  useEffect(() => {
    askPermissionOnce().catch(() => {});
  }, []);

  // Reload whenever the screen regains focus (e.g. after an auto-logged tap).
  // Recurring payments that came due are added first, so they show straight away.
  const refresh = useCallback(() => {
    runUpkeep().finally(load);
  }, [load]);
  useFocusEffect(refresh);
  useDataChanged(load);

  // Payments saved by the Wallet automation happen in the background; refresh on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

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
      cash: 0,
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
    // Every month from the user's first expense to now, newest first; nothing before they started.
    const active = activeMonths(
      summaries.map(s => s.month),
      current,
    );
    const months = active.map(
      key => byKey.get(key) ?? { month: key, total: 0, cash: 0, count: 0 },
    );
    const earlier = summaries.filter(s => s.month < current);
    return {
      thisMonth,
      lastMonth,
      allTotal,
      allCount,
      top,
      change,
      monthlyAvg: summaries.length ? allTotal / summaries.length : 0,
      earlierAvg: earlier.length
        ? earlier.reduce((sum, s) => sum + s.total, 0) / earlier.length
        : null,
      months,
      chartMonths: active.slice(0, CHART_MONTHS).reverse(),
      maxMonth: Math.max(1, ...summaries.map(s => s.total)),
    };
  }, [summaries, current]);

  const customGroups = categoryList.groups;
  const groups = useMemo(
    () => groupByMonth(categoryTotals, customGroups),
    [categoryTotals, customGroups],
  );
  const health = useMemo(() => {
    const today = new Date();
    return assessMonth({
      spent: stats.thisMonth.total,
      groups: groups.get(current) ?? NO_GROUPS,
      salary: salaryOf(current),
      averageMonth: stats.earlierAvg,
      daysElapsed: today.getDate(),
      daysInMonth: new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
      ).getDate(),
      format: n => formatMoney(n),
    });
  }, [stats, groups, current, salaryOf]);

  const patterns = useMemo(() => {
    const today = new Date();
    const first = stats.months[stats.months.length - 1]?.month ?? current;
    const pay = salaryOf(current);
    const daysInMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
    ).getDate();
    const daysLeft = daysInMonth - today.getDate() + 1;
    return {
      daily: dailySeries(dayTotals, current, today),
      weekdays: weekdayAverages(
        dayTotals,
        today,
        new Date(monthRange(first).start),
      ),
      monthly: stats.chartMonths.map(m => ({
        month: m,
        total: summaries.find(x => x.month === m)?.total ?? 0,
      })),
      safePerDay:
        pay != null && pay > 0
          ? Math.max(pay - stats.thisMonth.total, 0) / daysLeft
          : null,
    };
  }, [dayTotals, stats, summaries, current, salaryOf]);

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
    track('export');
    await Share.share({ title: 'All expenses', message: toCsv(rows) });
  }, [track]);

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
      ['Search & filter', () => navigation.navigate('Search')],
      ['Insights', () => navigation.navigate('Insights')],
      ['Budgets', () => navigation.navigate('Budgets')],
      ['Recurring payments', () => navigation.navigate('Recurring')],
      ['Savings goals', () => navigation.navigate('Goals')],
      ['Lent & borrowed', () => navigation.navigate('Debts')],
      ['Categories', () => navigation.navigate('Categories')],
      ['Import bank statement', () => navigation.navigate('Import')],
      ['Export all (CSV)', exportAll],
      ['Backup & restore', () => navigation.navigate('Backup')],
      ['Salary', () => navigation.navigate('Salary', { month: current })],
      ['Apple Pay auto-logging', () => navigation.navigate('Setup')],
      ['Appearance (light / dark)', chooseAppearance],
      ['Recently deleted', () => navigation.navigate('Trash')],
      ['Delete expenses…', () => navigation.navigate('Delete')],
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
        ...actions.map(([text, onPress]) => ({ text, onPress })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [chooseAppearance, current, exportAll, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      // React Navigation's documented pattern for header buttons.
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <View style={styles.headerButtons}>
          <Pressable
            onPress={() => navigation.navigate('Notifications')}
            hitSlop={10}
            accessibilityLabel={
              unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
            }
            style={[styles.botButton, { backgroundColor: t.accentSoft }]}
          >
            {unread > 0 && (
              <View
                style={[
                  styles.dot,
                  { backgroundColor: t.danger, borderColor: t.bg },
                ]}
              />
            )}
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path
                d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10zM10 20a2 2 0 0 0 4 0"
                stroke={t.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
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
  }, [
    navigation,
    openMenu,
    newReply,
    unread,
    t.accent,
    t.accentSoft,
    t.danger,
    t.bg,
  ]);

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
            <Pressable
              onPress={() => navigation.navigate('Search')}
              accessibilityRole="search"
              accessibilityLabel="Search expenses"
              style={({ pressed }) => [
                styles.searchBar,
                {
                  backgroundColor: pressed ? t.cardHi : t.card,
                  borderColor: t.border,
                },
                cardShadow(t),
              ]}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Circle
                  cx={11}
                  cy={11}
                  r={7}
                  stroke={t.muted}
                  strokeWidth={2.2}
                  fill="none"
                />
                <Path
                  d="m20 20-4-4"
                  stroke={t.muted}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </Svg>
              <Text style={[styles.searchText, { color: t.muted }]}>
                Search shops, notes, #tags, amounts
              </Text>
              <View
                style={[styles.searchFilter, { backgroundColor: t.accentSoft }]}
              >
                <Svg width={14} height={14} viewBox="0 0 24 24">
                  <Path
                    d="M3 5h18M6 12h12M10 19h4"
                    stroke={t.accent}
                    strokeWidth={2.6}
                    strokeLinecap="round"
                  />
                </Svg>
              </View>
            </Pressable>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quick}
            >
              {(
                [
                  ['📊', 'Insights', () => navigation.navigate('Insights')],
                  ['🎯', 'Budgets', () => navigation.navigate('Budgets')],
                  ['🔁', 'Recurring', () => navigation.navigate('Recurring')],
                  ['🐷', 'Goals', () => navigation.navigate('Goals')],
                  ['🤝', 'Lent & borrowed', () => navigation.navigate('Debts')],
                  ['🏷️', 'Categories', () => navigation.navigate('Categories')],
                  ['🛟', 'Backup', () => navigation.navigate('Backup')],
                ] as const
              ).map(([icon, label, go]) => (
                <Pressable
                  key={label}
                  onPress={go}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.quickItem,
                    {
                      backgroundColor: pressed ? t.cardHi : t.card,
                      borderColor: t.border,
                    },
                  ]}
                >
                  <Text style={styles.quickIcon}>{icon}</Text>
                  <Text style={[styles.quickLabel, { color: t.text }]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

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
              style={[styles.hero, glow(t.gradients.hero[1], 22)]}
              accessibilityRole="button"
              accessibilityLabel={`${monthLabel(current)}, ${formatMoney(
                stats.thisMonth.total,
              )} spent. Open month`}
            >
              <Gradient colors={t.gradients.hero} radius={HERO_RADIUS} />
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
              {convert(stats.thisMonth.total) && (
                <Text style={[styles.converted, { color: t.onAccent }]}>
                  {convert(stats.thisMonth.total)}
                </Text>
              )}
              <Text style={[styles.heroSub, { color: t.onAccent }]}>
                {stats.thisMonth.count} expense(s)
                {stats.change != null &&
                  `  ·  ${up ? '▲' : '▼'} ${Math.abs(
                    Math.round(stats.change),
                  )}% vs last month`}
              </Text>
              <View style={styles.chipRow}>
                <Stat label="Today" value={formatMoney(todayTotal)} />
                <Stat
                  label="Card"
                  value={formatMoney(
                    stats.thisMonth.total - stats.thisMonth.cash,
                  )}
                />
                <Stat label="Cash" value={formatMoney(stats.thisMonth.cash)} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate('Add', { method: 'cash' })}
              style={[styles.cashButton, glow(t.gradients.cash[1], 12)]}
              accessibilityRole="button"
              accessibilityLabel="Add a cash expense"
            >
              <Gradient colors={t.gradients.cash} radius={16} />
              <View style={styles.cashIcon}>
                <Text style={[styles.cashIconText, { color: t.onAccent }]}>
                  +
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.cashTitle, { color: t.onAccent }]}>
                  Paid in cash?
                </Text>
                <Text style={[styles.cashSub, { color: t.onAccent }]}>
                  Add it here so your totals stay complete.
                </Text>
              </View>
              <Text style={[styles.cashTitle, { color: t.onAccent }]}>›</Text>
            </Pressable>

            <HealthCard
              health={health}
              onAddSalary={() =>
                navigation.navigate('Salary', { month: current })
              }
            />

            <BudgetCard
              month={current}
              spent={stats.thisMonth.total}
              salary={salaryOf(current)}
              onEditSalary={() =>
                navigation.navigate('Salary', { month: current })
              }
            />

            {budgets.length > 0 && (
              <Pressable
                onPress={() => navigation.navigate('Budgets')}
                accessibilityRole="button"
                style={[
                  styles.card,
                  { backgroundColor: t.card, borderColor: t.border },
                  cardShadow(t),
                ]}
              >
                <View style={styles.row}>
                  <Text style={[styles.label, { color: t.muted }]}>
                    Category budgets
                  </Text>
                  <Text style={[styles.label, { color: t.accent }]}>
                    Edit ›
                  </Text>
                </View>
                {budgets.slice(0, 4).map(b => {
                  const ratio = b.budget > 0 ? b.spent / b.budget : 0;
                  const color =
                    ratio >= 1
                      ? t.danger
                      : ratio >= 0.8
                      ? t.warning
                      : t.success;
                  return (
                    <View key={b.category} style={styles.budgetRow}>
                      <View style={styles.row}>
                        <Text
                          numberOfLines={1}
                          style={[styles.budgetName, { color: t.text }]}
                        >
                          {b.category}
                        </Text>
                        <Text style={[styles.budgetMeta, { color }]}>
                          {formatMoney(b.spent)} / {formatMoney(b.budget)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.budgetTrack,
                          { backgroundColor: t.cardHi },
                        ]}
                      >
                        <View
                          style={[
                            styles.budgetFill,
                            {
                              width: `${Math.min(100, ratio * 100)}%`,
                              backgroundColor: color,
                            },
                          ]}
                        />
                      </View>
                      {paceDay(b) && (
                        <Text style={[styles.budgetMeta, { color: t.warning }]}>
                          At this pace it runs out on the {ordinal(paceDay(b)!)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </Pressable>
            )}

            {hasPro ? (
              <>
                <View
                  style={[
                    styles.card,
                    { backgroundColor: t.card, borderColor: t.border },
                    cardShadow(t),
                  ]}
                >
                  <Text style={[styles.label, { color: t.muted }]}>
                    Spending patterns
                  </Text>
                  <PatternsChart
                    daily={patterns.daily}
                    dailyMonth={current}
                    safePerDay={patterns.safePerDay}
                    months={patterns.monthly}
                    weekdays={patterns.weekdays}
                    onOpenMonth={openMonth}
                  />
                </View>

                <View
                  style={[
                    styles.card,
                    { backgroundColor: t.card, borderColor: t.border },
                    cardShadow(t),
                  ]}
                >
                  <Text style={[styles.label, { color: t.muted }]}>
                    Your lifestyle, month by month
                  </Text>
                  <LifestyleChart
                    months={stats.chartMonths}
                    groups={groups}
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
                cardShadow(t),
              ]}
            >
              <View style={styles.row}>
                <Text style={[styles.monthName, { color: t.text }]}>
                  {monthLabel(m.month)}
                </Text>
                <View style={styles.totalCol}>
                  <Text style={[styles.monthTotal, { color: t.text }]}>
                    {formatMoney(m.total)}
                  </Text>
                  {convert(m.total) && (
                    <Text style={[styles.convertedSmall, { color: t.muted }]}>
                      {convert(m.total)}
                    </Text>
                  )}
                </View>
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
                  {m.cash > 0 && `  ·  ${formatMoney(m.cash)} cash`}
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

const HERO_RADIUS = 24;

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
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchText: { flex: 1, fontSize: 15, paddingVertical: 6 },
  searchFilter: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quick: { gap: 8, paddingVertical: 12 },
  budgetRow: { gap: 6, marginTop: 10 },
  budgetName: { flex: 1, fontSize: 14, fontWeight: '700' },
  budgetMeta: { fontSize: 12, fontWeight: '700' },
  budgetTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  budgetFill: { height: 8, borderRadius: 4 },
  quickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickIcon: { fontSize: 15 },
  quickLabel: { fontSize: 13, fontWeight: '700' },
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
  hero: { padding: 20, borderRadius: HERO_RADIUS },
  heroLabel: { fontSize: 13, fontWeight: '600', opacity: 0.85 },
  converted: {
    fontSize: 17,
    fontWeight: '700',
    opacity: 0.92,
    fontVariant: ['tabular-nums'],
  },
  totalCol: { alignItems: 'flex-end' },
  convertedSmall: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  heroSub: { fontSize: 13, fontWeight: '600', opacity: 0.9, marginTop: 2 },
  cashButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
  },
  cashIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  cashIconText: { fontSize: 22, fontWeight: '800', marginTop: -2 },
  cashTitle: { fontSize: 16, fontWeight: '800' },
  cashSub: { fontSize: 12, fontWeight: '600', opacity: 0.9, marginTop: 1 },
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
    backgroundColor: 'rgba(255,255,255,0.16)',
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
