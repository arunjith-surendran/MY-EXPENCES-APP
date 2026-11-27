import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RootStackParamList } from '../../App';
import { Chip, DayStepper } from '../components/FilterControls';
import {
  type Expense,
  type ExpenseSearch,
  firstExpenseAt,
  listMonthSummaries,
  listUsedCategories,
  type MonthSummary,
  searchExpenses,
} from '../lib/db';
import { monthKey, monthLabel } from '../lib/months';
import { formatMoney, parseAmount } from '../lib/parse';
import {
  addDays,
  type Period,
  PERIODS,
  periodLabel,
  rangeFor,
  shortDay,
} from '../lib/periods';
import { cardShadow, categoryStyle, useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

type Method = 'any' | 'card' | 'cash';
type Source = Expense['source'];
type Sort = NonNullable<ExpenseSearch['sort']>;

const SOURCES: [Source, string][] = [
  ['apple_pay', 'Apple Pay'],
  ['manual', 'Added by hand'],
  ['statement', 'Bank statement'],
];

const SORTS: [Sort, string][] = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['highest', 'Highest'],
  ['lowest', 'Lowest'],
];

/**
 * Search every expense by merchant, note, card, category or amount, and filter by
 * period, category, card/cash, where it came from and an amount range.
 */
export default function SearchScreen({ navigation, route }: Props) {
  const t = useTheme();
  const presetMonth = route.params?.month;

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(presetMonth != null);
  const [period, setPeriod] = useState<Period>(presetMonth ? 'month' : 'all');
  const [month, setMonth] = useState(presetMonth ?? monthKey());
  const [from, setFrom] = useState(() => addDays(new Date(), -6));
  const [to, setTo] = useState(() => new Date());
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<Method>('any');
  const [sources, setSources] = useState<Set<Source>>(new Set());
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const [results, setResults] = useState<Expense[] | null>(null);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [firstAt, setFirstAt] = useState<number | null>(null);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const range = useMemo(
    () => rangeFor(period, month, from, to),
    [period, month, from, to],
  );
  const minAmount = parseAmount(minText) ?? undefined;
  const maxAmount = parseAmount(maxText) ?? undefined;

  const search = useCallback(() => {
    searchExpenses({
      text: query,
      start: range.start,
      end: range.end,
      categories: [...categories],
      method: method === 'any' ? undefined : method,
      sources: [...sources],
      minAmount,
      maxAmount,
      sort,
    })
      .then(setResults)
      .catch(() => setResults([]));
  }, [query, range, categories, method, sources, minAmount, maxAmount, sort]);

  // Again on coming back, so an edited or deleted expense shows up right.
  useFocusEffect(
    useCallback(() => {
      search();
    }, [search]),
  );

  useFocusEffect(
    useCallback(() => {
      listMonthSummaries()
        .then(setMonths)
        .catch(() => {});
      listUsedCategories()
        .then(setUsedCategories)
        .catch(() => {});
      firstExpenseAt()
        .then(setFirstAt)
        .catch(() => {});
    }, []),
  );

  const activeFilters =
    (period !== 'all' ? 1 : 0) +
    (categories.size > 0 ? 1 : 0) +
    (method !== 'any' ? 1 : 0) +
    (sources.size > 0 ? 1 : 0) +
    (minAmount != null || maxAmount != null ? 1 : 0);

  const reset = () => {
    setPeriod('all');
    setCategories(new Set());
    setMethod('any');
    setSources(new Set());
    setMinText('');
    setMaxText('');
  };

  const toggleIn = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const total = (results ?? [])
    .filter(e => e.currency === 'AED')
    .reduce((s, e) => s + e.amount, 0);
  const aedCount = (results ?? []).filter(e => e.currency === 'AED').length;

  const input = [
    styles.input,
    { color: t.text, backgroundColor: t.card, borderColor: t.border },
  ];

  const filters = (
    <View
      style={[styles.panel, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <Text style={[styles.label, { color: t.muted }]}>Period</Text>
      <View style={styles.chips}>
        {PERIODS.map(([p, label]) => (
          <Chip
            key={p}
            label={label}
            on={period === p}
            onPress={() => setPeriod(p)}
          />
        ))}
      </View>
      {period === 'month' && (
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

      {usedCategories.length > 0 && (
        <>
          <Text style={[styles.label, { color: t.muted }]}>Category</Text>
          <View style={styles.chips}>
            {usedCategories.map(c => (
              <Chip
                key={c}
                label={c}
                on={categories.has(c)}
                color={categoryStyle(c, t).color}
                onPress={() => setCategories(prev => toggleIn(prev, c))}
              />
            ))}
          </View>
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
        ).map(([m, label]) => (
          <Chip
            key={m}
            label={label}
            on={method === m}
            onPress={() => setMethod(m)}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: t.muted }]}>Came from</Text>
      <View style={styles.chips}>
        {SOURCES.map(([src, label]) => (
          <Chip
            key={src}
            label={label}
            on={sources.has(src)}
            onPress={() => setSources(prev => toggleIn(prev, src))}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: t.muted }]}>Amount (AED)</Text>
      <View style={styles.amountRow}>
        <TextInput
          value={minText}
          onChangeText={setMinText}
          placeholder="Min"
          placeholderTextColor={t.muted}
          keyboardType="decimal-pad"
          style={[input, styles.flex]}
        />
        <Text style={{ color: t.muted }}>to</Text>
        <TextInput
          value={maxText}
          onChangeText={setMaxText}
          placeholder="Max"
          placeholderTextColor={t.muted}
          keyboardType="decimal-pad"
          style={[input, styles.flex]}
        />
      </View>

      {activeFilters > 0 && (
        <Pressable onPress={reset} hitSlop={8} style={styles.reset}>
          <Text style={[styles.bold, { color: t.danger }]}>Reset filters</Text>
        </Pressable>
      )}
    </View>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.sortRow}>
        <Pressable
          onPress={() => setShowFilters(v => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showFilters }}
          style={[
            styles.filterBtn,
            {
              borderColor: activeFilters ? t.accent : t.border,
              backgroundColor: activeFilters ? t.accentSoft : t.card,
            },
          ]}
        >
          <FilterIcon color={t.accent} />
          <Text style={[styles.bold, { color: t.accent }]}>
            Filters{activeFilters ? ` · ${activeFilters}` : ''}
          </Text>
        </Pressable>
        <View style={[styles.chips, styles.flex]}>
          {SORTS.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              on={sort === value}
              onPress={() => setSort(value)}
            />
          ))}
        </View>
      </View>

      {showFilters && filters}

      {results != null && (
        <View
          style={[styles.summary, { backgroundColor: t.accent }, cardShadow(t)]}
        >
          <View style={styles.flex}>
            <Text style={[styles.summaryLabel, { color: t.onAccent }]}>
              {results.length} result{results.length === 1 ? '' : 's'} ·{' '}
              {periodLabel(period, range)}
            </Text>
            <Text style={[styles.summaryValue, { color: t.onAccent }]}>
              {formatMoney(total)}
            </Text>
          </View>
          {aedCount > 1 && (
            <View style={styles.avg}>
              <Text style={[styles.summaryLabel, { color: t.onAccent }]}>
                Average
              </Text>
              <Text style={[styles.bold, { color: t.onAccent }]}>
                {formatMoney(total / aedCount)}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: t.card, borderColor: t.border },
          ]}
        >
          <SearchIcon color={t.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Merchant, note, card or amount"
            placeholderTextColor={t.muted}
            autoFocus={presetMonth == null}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="never"
            style={[styles.searchInput, { color: t.text }]}
          />
          {text.length > 0 && (
            <Pressable
              onPress={() => setText('')}
              hitSlop={10}
              accessibilityLabel="Clear search"
            >
              <Text style={[styles.clear, { color: t.muted }]}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={results ?? []}
        keyExtractor={e => String(e.id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          results == null ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.text }]}>
                No matching expenses
              </Text>
              <Text style={{ color: t.muted }}>
                Try another word{activeFilters ? ' or reset the filters' : ''}.
              </Text>
            </View>
          )
        }
        renderItem={({ item: e }) => {
          const c = categoryStyle(e.category, t);
          return (
            <Pressable
              onPress={() => navigation.navigate('Add', { id: String(e.id) })}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? t.cardHi : t.card,
                  borderColor: t.border,
                },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  { borderColor: c.color, backgroundColor: t.cardHi },
                ]}
              >
                <Text style={[styles.iconText, { color: c.color }]}>
                  {c.icon}
                </Text>
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
                  {e.card ? ` · ${e.card}` : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </Text>
              </View>
              <View style={styles.amountCol}>
                <Text style={[styles.amount, { color: t.text }]}>
                  {formatMoney(e.amount, e.currency)}
                </Text>
                {e.method === 'cash' && (
                  <Text style={[styles.cash, { color: t.cash }]}>Cash</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Circle
        cx={11}
        cy={11}
        r={7}
        stroke={color}
        strokeWidth={2.2}
        fill="none"
      />
      <Path
        d="m20 20-4-4"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function FilterIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M3 5h18M6 12h12M10 19h4"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 12 },
  clear: { fontSize: 15, fontWeight: '700' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32, gap: 8 },
  header: { gap: 10, marginBottom: 6 },
  sortRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  panel: {
    padding: 14,
    gap: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  reset: { alignSelf: 'flex-start', marginTop: 4 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  summaryLabel: { fontSize: 12, fontWeight: '700', opacity: 0.9 },
  summaryValue: { fontSize: 24, fontWeight: '900', marginTop: 2 },
  avg: { alignItems: 'flex-end' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 12, fontWeight: '900' },
  bold: { fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 3 },
  amountCol: { alignItems: 'flex-end', gap: 2 },
  amount: { fontWeight: '800', fontSize: 15 },
  cash: { fontSize: 11, fontWeight: '800' },
  loader: { marginTop: 24 },
  empty: { alignItems: 'center', gap: 4, marginTop: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
});
