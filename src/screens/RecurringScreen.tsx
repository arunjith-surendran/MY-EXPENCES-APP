import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '../components/FilterControls';
import { useCategories } from '../lib/categories';
import type { PaymentMethod } from '../lib/db';
import { askPermissionOnce } from '../lib/notifications';
import { ordinal } from '../lib/months';
import { formatMoney, guessCategory, parseAmount } from '../lib/parse';
import {
  addRecurring,
  deleteRecurring,
  listRecurring,
  nextAfter,
  occurrenceIn,
  type Recurring,
  setRecurringActive,
  updateRecurring,
} from '../lib/recurring';
import { runUpkeep } from '../lib/upkeep';
import { categoryStyle, useTheme } from '../lib/theme';
import { useFeatureUse } from '../lib/usage';

type Draft = {
  id: number | null;
  amount: string;
  merchant: string;
  category: string;
  method: PaymentMethod;
  day: number;
  remind: boolean;
  note: string;
};

const blank = (): Draft => ({
  id: null,
  amount: '',
  merchant: '',
  category: 'Bills & Utilities',
  method: 'card',
  day: new Date().getDate(),
  remind: true,
  note: '',
});

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * Monthly payments that repeat (rent, subscriptions, school fees). Each is added by itself
 * on its day, with a reminder the day before.
 */
export default function RecurringScreen() {
  const t = useTheme();
  useFeatureUse('recurring');
  const categories = useCategories();
  const [items, setItems] = useState<Recurring[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(() => {
    listRecurring()
      .then(setItems)
      .catch(() => {});
  }, []);
  useFocusEffect(load);

  const edit = (patch: Partial<Draft>) =>
    setDraft(d => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    const amount = parseAmount(draft.amount);
    if (!amount) {
      Alert.alert('Enter the amount');
      return;
    }
    if (!draft.merchant.trim()) {
      Alert.alert('What is it for?', 'e.g. Rent, Netflix, School fees');
      return;
    }
    const fields = {
      amount,
      merchant: draft.merchant.trim(),
      category: draft.category,
      method: draft.method,
      note: draft.note.trim() || null,
      day: draft.day,
      remind: draft.remind,
    };
    try {
      if (draft.id) await updateRecurring(draft.id, fields);
      else await addRecurring(fields);
      if (draft.remind) askPermissionOnce();
      setDraft(null);
      // Today's one (if it's today) is added right away.
      await runUpkeep();
      load();
    } catch (err) {
      Alert.alert("Couldn't save", String(err));
    }
  };

  const remove = (r: Recurring) =>
    Alert.alert(
      `Stop "${r.merchant}"?`,
      "It won't be added any more. Expenses already added stay.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteRecurring(r.id).then(load),
        },
      ],
    );

  const input = [
    styles.input,
    { color: t.text, backgroundColor: t.cardHi, borderColor: t.border },
  ];
  const card = [
    styles.card,
    { backgroundColor: t.card, borderColor: t.border },
  ];
  const monthlyTotal = items
    .filter(r => r.active)
    .reduce((s, r) => s + r.amount, 0);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.hero, { backgroundColor: t.accent }]}>
        <Text style={[styles.heroLabel, { color: t.onAccent }]}>
          Every month
        </Text>
        <Text style={[styles.heroValue, { color: t.onAccent }]}>
          {formatMoney(monthlyTotal)}
        </Text>
        <Text style={[styles.heroHint, { color: t.onAccent }]}>
          {items.filter(r => r.active).length} recurring payment
          {items.filter(r => r.active).length === 1 ? '' : 's'}, added on their
          day with a reminder the day before.
        </Text>
      </View>

      {items.some(r => r.active) && !draft && <BillCalendar items={items} />}

      {draft ? (
        <View style={card}>
          <Text style={[styles.title, { color: t.text }]}>
            {draft.id ? 'Edit recurring payment' : 'New recurring payment'}
          </Text>
          <TextInput
            value={draft.merchant}
            onChangeText={v =>
              edit({
                merchant: v,
                ...(draft.id
                  ? {}
                  : {
                      category:
                        guessCategory(v) === 'Other'
                          ? draft.category
                          : guessCategory(v),
                    }),
              })
            }
            placeholder="What for (e.g. Rent, Netflix)"
            placeholderTextColor={t.muted}
            maxLength={80}
            style={input}
          />
          <TextInput
            value={draft.amount}
            onChangeText={v => edit({ amount: v })}
            placeholder="Amount (AED)"
            placeholderTextColor={t.muted}
            keyboardType="decimal-pad"
            style={input}
          />
          <Text style={[styles.label, { color: t.muted }]}>
            Day of the month
          </Text>
          <View style={styles.dayRow}>
            <Pressable
              onPress={() => edit({ day: draft.day <= 1 ? 31 : draft.day - 1 })}
              style={[styles.step, { borderColor: t.border }]}
            >
              <Text style={[styles.stepText, { color: t.accent }]}>−</Text>
            </Pressable>
            <Text style={[styles.day, { color: t.text }]}>
              {ordinal(draft.day)}
            </Text>
            <Pressable
              onPress={() => edit({ day: draft.day >= 31 ? 1 : draft.day + 1 })}
              style={[styles.step, { borderColor: t.border }]}
            >
              <Text style={[styles.stepText, { color: t.accent }]}>+</Text>
            </Pressable>
            {draft.day > 28 && (
              <Text style={[styles.meta, styles.flex, { color: t.muted }]}>
                Short months use their last day.
              </Text>
            )}
          </View>
          <Text style={[styles.label, { color: t.muted }]}>Category</Text>
          <View style={styles.chips}>
            {categories.all.map(c => (
              <Chip
                key={c}
                label={c}
                on={draft.category === c}
                color={categoryStyle(c, t).color}
                onPress={() => edit({ category: c })}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: t.muted }]}>Paid with</Text>
          <View style={styles.chips}>
            <Chip
              label="💳 Card"
              on={draft.method === 'card'}
              onPress={() => edit({ method: 'card' })}
            />
            <Chip
              label="💵 Cash"
              on={draft.method === 'cash'}
              onPress={() => edit({ method: 'cash' })}
            />
          </View>
          <TextInput
            value={draft.note}
            onChangeText={v => edit({ note: v })}
            placeholder="Note (optional)"
            placeholderTextColor={t.muted}
            maxLength={200}
            style={input}
          />
          <View style={styles.switchRow}>
            <Text style={[styles.flex, { color: t.text }]}>
              Remind me the day before
            </Text>
            <Switch
              value={draft.remind}
              onValueChange={v => edit({ remind: v })}
            />
          </View>
          <View style={styles.buttons}>
            <Pressable
              onPress={() => setDraft(null)}
              style={[styles.button, styles.outline, { borderColor: t.border }]}
            >
              <Text style={[styles.buttonText, { color: t.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              style={[
                styles.button,
                styles.flex,
                { backgroundColor: t.accent },
              ]}
            >
              <Text style={[styles.buttonText, { color: t.onAccent }]}>
                Save
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setDraft(blank())}
          style={[styles.button, { backgroundColor: t.accent }]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            + Add recurring payment
          </Text>
        </Pressable>
      )}

      {items.map(r => {
        const c = categoryStyle(r.category, t);
        return (
          <View key={r.id} style={[card, !r.active && styles.paused]}>
            <View style={styles.row}>
              <View
                style={[
                  styles.badge,
                  { borderColor: c.color, backgroundColor: t.cardHi },
                ]}
              >
                <Text style={[styles.badgeText, { color: c.color }]}>
                  {c.icon}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: t.text }]}>
                  {r.merchant}
                </Text>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {r.category} · every month on the {ordinal(r.day)}
                </Text>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {r.active
                    ? `Next: ${shortDate(r.next_at)}${r.remind ? ' · 🔔' : ''}`
                    : 'Paused'}
                </Text>
              </View>
              <View style={styles.right}>
                <Text style={[styles.amount, { color: t.text }]}>
                  {formatMoney(r.amount)}
                </Text>
                <Switch
                  value={!!r.active}
                  onValueChange={v => setRecurringActive(r.id, v).then(load)}
                />
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={() =>
                  setDraft({
                    id: r.id,
                    amount: String(r.amount),
                    merchant: r.merchant,
                    category: r.category,
                    method: r.method,
                    day: r.day,
                    remind: !!r.remind,
                    note: r.note ?? '',
                  })
                }
                hitSlop={8}
              >
                <Text style={[styles.link, { color: t.accent }]}>Edit</Text>
              </Pressable>
              <Pressable onPress={() => remove(r)} hitSlop={8}>
                <Text style={[styles.link, { color: t.danger }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

type Bill = { at: number; item: Recurring };

/** Every active payment due from today through `days` days ahead, soonest first. Pure. */
export function upcomingBills(
  items: Recurring[],
  days = 35,
  now = Date.now(),
): Bill[] {
  const until = now + days * 86_400_000;
  const out: Bill[] = [];
  for (const r of items) {
    if (!r.active) continue;
    for (let at = r.next_at; at <= until; at = nextAfter(at, r.day)) {
      out.push({ at, item: r });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** This month as a calendar with a dot on each bill's day, then the next few weeks as a list. */
function BillCalendar({ items }: { items: Recurring[] }) {
  const t = useTheme();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const bills = upcomingBills(items);
  // Every active payment's day this month, paid already or not.
  const dueOn = new Map<number, number>();
  for (const r of items) {
    if (!r.active) continue;
    const d = occurrenceIn(y, m, r.day).getDate();
    dueOn.set(d, (dueOn.get(d) ?? 0) + r.amount);
  }
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const soon = bills.slice(0, 6);
  return (
    <View
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <Text style={[styles.title, { color: t.text }]}>
        {now.toLocaleDateString('en-AE', { month: 'long', year: 'numeric' })}
      </Text>
      <View style={styles.calGrid}>
        {WEEKDAY_LETTERS.map((w, i) => (
          <Text key={`w${i}`} style={[styles.calHead, { color: t.muted }]}>
            {w}
          </Text>
        ))}
        {cells.map((d, i) => {
          const due = d != null ? dueOn.get(d) : undefined;
          const today = d === now.getDate();
          return (
            <View key={i} style={styles.calCell}>
              {d != null && (
                <View
                  style={[
                    styles.calDay,
                    today && [styles.calToday, { borderColor: t.accent }],
                    due != null && { backgroundColor: t.accentSoft },
                  ]}
                >
                  <Text
                    style={[
                      styles.calNum,
                      { color: due != null ? t.accent : t.text },
                      due != null && styles.calDue,
                    ]}
                  >
                    {d}
                  </Text>
                  {due != null && (
                    <View
                      style={[styles.calDot, { backgroundColor: t.accent }]}
                    />
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
      {soon.length > 0 && (
        <>
          <Text style={[styles.label, { color: t.muted }]}>Coming up</Text>
          {soon.map(b => (
            <View key={`${b.item.id}-${b.at}`} style={styles.soonRow}>
              <Text style={[styles.soonDate, { color: t.muted }]}>
                {new Date(b.at).toLocaleDateString('en-AE', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </Text>
              <Text numberOfLines={1} style={[styles.flex, { color: t.text }]}>
                {b.item.merchant}
              </Text>
              <Text style={[styles.amount, { color: t.text }]}>
                {formatMoney(b.item.amount)}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calHead: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  calDay: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calToday: { borderWidth: 1.5 },
  calNum: { fontSize: 13 },
  calDue: { fontWeight: '900' },
  calDot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  soonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  soonDate: { width: 92, fontSize: 12, fontWeight: '700' },
  screen: { padding: 16, paddingBottom: 40, gap: 10 },
  flex: { flex: 1 },
  hero: { padding: 18, borderRadius: 20, gap: 6 },
  heroLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.9,
  },
  heroValue: { fontSize: 28, fontWeight: '900' },
  heroHint: { fontSize: 13, lineHeight: 18, opacity: 0.9 },
  card: {
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  paused: { opacity: 0.6 },
  title: { fontSize: 16, fontWeight: '800' },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  step: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 22, fontWeight: '700', marginTop: -2 },
  day: { fontSize: 18, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { padding: 14, borderRadius: 12, alignItems: 'center' },
  outline: { borderWidth: 1, paddingHorizontal: 20 },
  buttonText: { fontWeight: '800', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '900' },
  meta: { fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 6 },
  amount: { fontWeight: '800', fontSize: 15 },
  actions: { flexDirection: 'row', gap: 20, marginLeft: 50 },
  link: { fontWeight: '700' },
});
