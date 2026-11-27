import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '../components/FilterControls';
import {
  addDebt,
  type Debt,
  debtTotals,
  deleteDebt,
  listDebts,
  settleDebt,
} from '../lib/debts';
import { askPermissionOnce } from '../lib/notifications';
import { formatMoney, parseAmount } from '../lib/parse';
import { useTheme } from '../lib/theme';
import { useFeatureUse } from '../lib/usage';

const DAY = 86_400_000;
const DUE: [string, number | null][] = [
  ['No date', null],
  ['In 3 days', 3],
  ['In a week', 7],
  ['In 2 weeks', 14],
  ['In a month', 30],
];

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' });

/** Who owes you and whom you owe, with a reminder on the day it's due. */
export default function DebtsScreen() {
  const t = useTheme();
  useFeatureUse('debts');
  const [debts, setDebts] = useState<Debt[]>([]);
  const [adding, setAdding] = useState(false);
  const [direction, setDirection] = useState<Debt['direction']>('owed_to_me');
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [dueIn, setDueIn] = useState<number | null>(7);

  const load = useCallback(() => {
    listDebts()
      .then(setDebts)
      .catch(() => {});
  }, []);
  useFocusEffect(load);

  const save = async () => {
    const value = parseAmount(amount);
    if (!person.trim() || !value) {
      Alert.alert('Add a name and an amount');
      return;
    }
    await addDebt({
      person: person.trim(),
      amount: value,
      direction,
      note: note.trim() || null,
      due_at: dueIn != null ? Date.now() + dueIn * DAY : null,
    });
    if (dueIn != null) askPermissionOnce();
    setAdding(false);
    setPerson('');
    setAmount('');
    setNote('');
    load();
  };

  const remove = (d: Debt) =>
    Alert.alert(`Delete this?`, `${d.person} · ${formatMoney(d.amount)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteDebt(d.id).then(load),
      },
    ]);

  const { owedToMe, iOwe } = debtTotals(debts);
  const input = [
    styles.input,
    { color: t.text, backgroundColor: t.cardHi, borderColor: t.border },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.row}>
        <View style={[styles.total, { backgroundColor: t.success }]}>
          <Text style={[styles.totalLabel, { color: t.onAccent }]}>
            Owed to you
          </Text>
          <Text style={[styles.totalValue, { color: t.onAccent }]}>
            {formatMoney(owedToMe)}
          </Text>
        </View>
        <View style={[styles.total, { backgroundColor: t.danger }]}>
          <Text style={[styles.totalLabel, { color: t.onAccent }]}>
            You owe
          </Text>
          <Text style={[styles.totalValue, { color: t.onAccent }]}>
            {formatMoney(iOwe)}
          </Text>
        </View>
      </View>

      {adding ? (
        <View
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.border },
          ]}
        >
          <View style={styles.chips}>
            <Chip
              label="They owe me"
              on={direction === 'owed_to_me'}
              color={t.success}
              onPress={() => setDirection('owed_to_me')}
            />
            <Chip
              label="I owe them"
              on={direction === 'i_owe'}
              color={t.danger}
              onPress={() => setDirection('i_owe')}
            />
          </View>
          <TextInput
            value={person}
            onChangeText={setPerson}
            placeholder="Who"
            placeholderTextColor={t.muted}
            maxLength={40}
            style={input}
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount (AED)"
            placeholderTextColor={t.muted}
            keyboardType="decimal-pad"
            style={input}
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What for (optional)"
            placeholderTextColor={t.muted}
            maxLength={120}
            style={input}
          />
          <Text style={[styles.label, { color: t.muted }]}>Remind me</Text>
          <View style={styles.chips}>
            {DUE.map(([label, days]) => (
              <Chip
                key={label}
                label={label}
                on={dueIn === days}
                onPress={() => setDueIn(days)}
              />
            ))}
          </View>
          <View style={styles.row}>
            <Pressable
              onPress={() => setAdding(false)}
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
          onPress={() => setAdding(true)}
          style={[styles.button, { backgroundColor: t.accent }]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            + Money lent or borrowed
          </Text>
        </Pressable>
      )}

      {debts.length === 0 && !adding && (
        <Text style={[styles.empty, { color: t.muted }]}>
          Nothing yet. Add money you lent a friend or borrowed, and get a
          reminder when it's due.
        </Text>
      )}

      {debts.map(d => {
        const mine = d.direction === 'owed_to_me';
        const color = mine ? t.success : t.danger;
        const settled = d.settled_at != null;
        const late = !settled && d.due_at != null && d.due_at < Date.now();
        return (
          <View
            key={d.id}
            style={[
              styles.card,
              { backgroundColor: t.card, borderColor: t.border },
              settled && styles.settled,
            ]}
          >
            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: color }]}>
                <Text style={[styles.avatarText, { color: t.onAccent }]}>
                  {d.person.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: t.text }]}>
                  {mine ? `${d.person} owes you` : `You owe ${d.person}`}
                </Text>
                <Text
                  style={[styles.meta, { color: late ? t.danger : t.muted }]}
                >
                  {settled
                    ? `Settled ${shortDate(d.settled_at!)}`
                    : d.due_at
                    ? `${late ? 'Was due' : 'Due'} ${shortDate(d.due_at)}`
                    : `Since ${shortDate(d.created_at)}`}
                  {d.note ? ` · ${d.note}` : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color }]}>
                {formatMoney(d.amount)}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={() => settleDebt(d.id, !settled).then(load)}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: t.accent }]}>
                  {settled ? 'Reopen' : '✓ Settled'}
                </Text>
              </Pressable>
              <Pressable onPress={() => remove(d)} hitSlop={8}>
                <Text style={[styles.link, { color: t.danger }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40, gap: 12 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  total: { flex: 1, padding: 16, borderRadius: 18, gap: 4 },
  totalLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    opacity: 0.9,
  },
  totalValue: { fontSize: 20, fontWeight: '900' },
  card: {
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  settled: { opacity: 0.55 },
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
  button: { padding: 14, borderRadius: 12, alignItems: 'center' },
  outline: { borderWidth: 1, paddingHorizontal: 18 },
  buttonText: { fontWeight: '800', fontSize: 15 },
  empty: { textAlign: 'center', lineHeight: 20, marginTop: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '900' },
  title: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 12, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '900' },
  actions: { flexDirection: 'row', gap: 20, marginLeft: 50 },
  link: { fontWeight: '700' },
});
