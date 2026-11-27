import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import { aedOf, type Expense, listExpenses } from '../lib/db';
import { compareCategories, topMerchants } from '../lib/insights';
import { monthKey, monthLabel, monthRange, shiftMonth } from '../lib/months';
import { formatMoney, isSpending } from '../lib/parse';
import { cardShadow, categoryStyle, useTheme } from '../lib/theme';
import { useFeatureUse } from '../lib/usage';

type Props = NativeStackScreenProps<RootStackParamList, 'Insights'>;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const byCategory = (items: Expense[]) => {
  const map = new Map<string, number>();
  for (const e of items) {
    const aed = aedOf(e);
    if (aed != null) map.set(e.category, (map.get(e.category) ?? 0) + aed);
  }
  return map;
};

const pct = (r: number) => `${Math.round(Math.abs(r) * 100)}%`;

/** What changed this month: categories against last month, top merchants, busiest weekdays. */
export default function InsightsScreen({ navigation, route }: Props) {
  const t = useTheme();
  useFeatureUse('insights');
  const [month, setMonth] = useState(route.params?.month ?? monthKey());
  const [now, setNow] = useState<Expense[] | null>(null);
  const [before, setBefore] = useState<Expense[]>([]);

  const load = useCallback(() => {
    const a = monthRange(month);
    const b = monthRange(shiftMonth(month, -1));
    // Transfers and cash withdrawals aren't spending.
    const spent = (rows: Expense[]) => rows.filter(e => isSpending(e.category));
    Promise.all([listExpenses(a.start, a.end), listExpenses(b.start, b.end)])
      .then(([x, y]) => {
        setNow(spent(x));
        setBefore(spent(y));
      })
      .catch(() => setNow([]));
  }, [month]);
  useFocusEffect(load);

  const data = useMemo(() => {
    const items = now ?? [];
    const total = items.reduce((s, e) => s + (aedOf(e) ?? 0), 0);
    const prevTotal = before.reduce((s, e) => s + (aedOf(e) ?? 0), 0);
    const changes = compareCategories(byCategory(items), byCategory(before));
    const merchants = topMerchants(
      items
        .map(e => ({ merchant: e.merchant, aed: aedOf(e) ?? 0 }))
        .filter(m => m.aed > 0),
    );
    const weekday = new Array<number>(7).fill(0);
    for (const e of items) {
      weekday[(new Date(e.created_at).getDay() + 6) % 7] += aedOf(e) ?? 0;
    }
    let biggest: Expense | null = null;
    for (const e of items) {
      if (!biggest || (aedOf(e) ?? 0) > (aedOf(biggest) ?? 0)) biggest = e;
    }
    const cash = items
      .filter(e => e.method === 'cash')
      .reduce((s, e) => s + (aedOf(e) ?? 0), 0);
    return { total, prevTotal, changes, merchants, weekday, biggest, cash };
  }, [now, before]);

  const headline = useMemo(() => {
    const { total, prevTotal } = data;
    if (prevTotal === 0) return null;
    const r = (total - prevTotal) / prevTotal;
    return { r, more: r >= 0 };
  }, [data]);

  if (now == null) {
    return <ActivityIndicator style={styles.loader} />;
  }

  const topWeekday = Math.max(...data.weekday);
  const card = [
    styles.card,
    { backgroundColor: t.card, borderColor: t.border },
    cardShadow(t),
  ];
  const isCurrent = month === monthKey();

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
    >
      <View style={styles.monthRow}>
        <Pressable
          onPress={() => setMonth(m => shiftMonth(m, -1))}
          hitSlop={10}
          style={[styles.arrow, { borderColor: t.border }]}
        >
          <Text style={[styles.arrowText, { color: t.accent }]}>‹</Text>
        </Pressable>
        <Text style={[styles.month, { color: t.text }]}>
          {monthLabel(month)}
        </Text>
        <Pressable
          onPress={() => setMonth(m => shiftMonth(m, 1))}
          disabled={isCurrent}
          hitSlop={10}
          style={[styles.arrow, { borderColor: t.border }]}
        >
          <Text
            style={[
              styles.arrowText,
              { color: isCurrent ? t.border : t.accent },
            ]}
          >
            ›
          </Text>
        </Pressable>
      </View>

      <View style={[styles.hero, { backgroundColor: t.accent }]}>
        <Text style={[styles.heroLabel, { color: t.onAccent }]}>
          {isCurrent ? 'So far this month' : 'Spent'}
        </Text>
        <Text style={[styles.heroValue, { color: t.onAccent }]}>
          {formatMoney(data.total)}
        </Text>
        <Text style={[styles.heroLine, { color: t.onAccent }]}>
          {headline
            ? `${headline.more ? '▲' : '▼'} ${pct(headline.r)} ${
                headline.more ? 'more' : 'less'
              } than ${monthLabel(shiftMonth(month, -1))} (${formatMoney(
                data.prevTotal,
              )})`
            : 'Nothing to compare with last month.'}
        </Text>
        {data.cash > 0 && (
          <Text style={[styles.heroLine, { color: t.onAccent }]}>
            💵 {formatMoney(data.cash)} in cash
          </Text>
        )}
      </View>

      {now.length === 0 ? (
        <Text style={[styles.empty, { color: t.muted }]}>
          No expenses in {monthLabel(month)}.
        </Text>
      ) : (
        <>
          <Text style={[styles.section, { color: t.muted }]}>
            Compared with last month
          </Text>
          <View style={card}>
            {data.changes.slice(0, 8).map(c => {
              const cs = categoryStyle(c.category, t);
              const up = c.change > 0;
              return (
                <Pressable
                  key={c.category}
                  onPress={() =>
                    navigation.navigate('Search', {
                      month,
                      category: c.category,
                    })
                  }
                  style={styles.changeRow}
                >
                  <View style={[styles.dot, { backgroundColor: cs.color }]} />
                  <View style={styles.flex}>
                    <Text style={[styles.bold, { color: t.text }]}>
                      {c.category}
                    </Text>
                    <Text style={[styles.meta, { color: t.muted }]}>
                      {formatMoney(c.now)} · was {formatMoney(c.before)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.change,
                      {
                        color:
                          Math.abs(c.change) < 1
                            ? t.muted
                            : up
                            ? t.danger
                            : t.success,
                      },
                    ]}
                  >
                    {Math.abs(c.change) < 1
                      ? 'same'
                      : `${up ? '▲' : '▼'} ${
                          c.ratio == null ? 'new' : pct(c.ratio)
                        }`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.section, { color: t.muted }]}>
            Top merchants
          </Text>
          <View style={card}>
            {data.merchants.map((m, i) => {
              const share = data.total > 0 ? m.total / data.total : 0;
              return (
                <View key={m.merchant} style={styles.merchant}>
                  <View style={styles.merchantHead}>
                    <Text style={[styles.rank, { color: t.muted }]}>
                      {i + 1}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.bold, styles.flex, { color: t.text }]}
                    >
                      {m.merchant}
                    </Text>
                    <Text style={[styles.bold, { color: t.text }]}>
                      {formatMoney(m.total)}
                    </Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: t.cardHi }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          width: `${Math.max(2, share * 100)}%`,
                          backgroundColor: t.accent,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    {m.count} payment{m.count === 1 ? '' : 's'} ·{' '}
                    {Math.round(share * 100)}% of the month
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={[styles.section, { color: t.muted }]}>By weekday</Text>
          <View style={card}>
            <View style={styles.bars}>
              {data.weekday.map((v, i) => {
                const h = topWeekday > 0 ? (v / topWeekday) * 100 : 0;
                const top = v === topWeekday && v > 0;
                return (
                  <View key={WEEKDAYS[i]} style={styles.barCol}>
                    <Text style={[styles.barValue, { color: t.muted }]}>
                      {v >= 1000
                        ? `${Math.round(v / 100) / 10}k`
                        : Math.round(v)}
                    </Text>
                    <View style={styles.barArea}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(3, h)}%`,
                            backgroundColor: top ? t.highlight : t.secondary,
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[
                        styles.barLabel,
                        { color: top ? t.text : t.muted },
                        top && styles.bold,
                      ]}
                    >
                      {WEEKDAYS[i]}
                    </Text>
                  </View>
                );
              })}
            </View>
            {topWeekday > 0 && (
              <Text style={[styles.meta, { color: t.muted }]}>
                You spend the most on{' '}
                {WEEKDAYS[data.weekday.indexOf(topWeekday)]}s.
              </Text>
            )}
          </View>

          {data.biggest && (
            <>
              <Text style={[styles.section, { color: t.muted }]}>
                Biggest payment
              </Text>
              <Pressable
                onPress={() =>
                  navigation.navigate('Add', { id: String(data.biggest!.id) })
                }
                style={card}
              >
                <View style={styles.merchantHead}>
                  <Text style={[styles.bold, styles.flex, { color: t.text }]}>
                    {data.biggest.merchant}
                  </Text>
                  <Text style={[styles.bold, { color: t.text }]}>
                    {formatMoney(data.biggest.amount, data.biggest.currency)}
                  </Text>
                </View>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {new Date(data.biggest.created_at).toLocaleDateString(
                    'en-AE',
                    { weekday: 'long', day: 'numeric', month: 'long' },
                  )}{' '}
                  · {data.biggest.category}
                </Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40 },
  loader: { marginTop: 40 },
  flex: { flex: 1 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: 24, marginTop: -3 },
  month: { fontSize: 18, fontWeight: '800' },
  hero: { padding: 20, borderRadius: 22, gap: 4 },
  heroLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.9,
  },
  heroValue: { fontSize: 32, fontWeight: '900' },
  heroLine: { fontSize: 14, fontWeight: '600', opacity: 0.92, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 32 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 22,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  bold: { fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  change: { fontSize: 14, fontWeight: '800' },
  merchant: { gap: 4 },
  merchantHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { width: 16, fontWeight: '800' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  bars: { flexDirection: 'row', gap: 6, height: 150 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barValue: { fontSize: 10, fontWeight: '700' },
  barArea: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 5 },
  barLabel: { fontSize: 11 },
});
