import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import {
  deleteExpense,
  getExpense,
  insertExpense,
  isRecentDuplicate,
  markAutoLogWorking,
  updateExpense,
} from '../lib/db';
import {
  CATEGORIES,
  type Category,
  formatMoney,
  guessCategory,
  parseAmount,
  parseCurrency,
} from '../lib/parse';
import { monthKey } from '../lib/months';
import { categoryStyle, glow, useTheme } from '../lib/theme';

/**
 * Three ways in:
 *  1. Manual: tapping "+ Add" in the app.
 *  2. Edit: tapping an expense in the list (params.id).
 *  3. Automatic: the iOS Shortcuts Wallet automation opens
 *     expences://add?auto=1&amount=...&merchant=...&card=...
 *     and the expense is saved straight away without any input.
 */
type Props = NativeStackScreenProps<RootStackParamList, 'Add'>;

export default function AddScreen({ navigation, route }: Props) {
  const t = useTheme();
  const params = route.params ?? {};
  const editId = params.id ? Number(params.id) : null;
  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('Tabs');
  };
  // Several links can arrive back to back (e.g. taps queued while the phone was locked),
  // so remember which one we handled instead of only the first.
  const lastAutoKey = useRef<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [autoFailed, setAutoFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(() => {
    const n = parseAmount(params.amount);
    return n ? String(n) : '';
  });
  const [merchant, setMerchant] = useState(params.merchant ?? '');
  const [category, setCategory] = useState<Category>(() =>
    guessCategory(params.merchant ?? ''),
  );
  const [note, setNote] = useState('');
  // When adding from a past month, start on that month's last day; otherwise today.
  const [date, setDate] = useState(() => {
    const now = new Date();
    if (params.month && params.month !== monthKey(now)) {
      const [y, m] = params.month.split('-').map(Number);
      return new Date(y, m, 0, 12);
    }
    return now;
  });

  useEffect(() => {
    navigation.setOptions({ title: editId ? 'Edit expense' : 'Add expense' });
  }, [editId, navigation]);

  // Edit path: load the existing expense into the form.
  useEffect(() => {
    if (editId == null) return;
    getExpense(editId).then(e => {
      if (!e) {
        setStatus('This expense no longer exists.');
        return;
      }
      setAmount(String(e.amount));
      setMerchant(e.merchant);
      setCategory(
        (CATEGORIES as readonly string[]).includes(e.category)
          ? (e.category as Category)
          : 'Other',
      );
      setNote(e.note ?? '');
      setDate(new Date(e.created_at));
    });
  }, [editId]);

  // Auto-save path for Apple Pay taps.
  useEffect(() => {
    if (params.auto !== '1') return;
    const key = `${params.amount}|${params.merchant}|${params.card}|${params.raw}|${params.via}`;
    if (key === lastAutoKey.current) return;
    lastAutoKey.current = key;
    setAutoFailed(false);
    setStatus(null);

    const value = parseAmount(params.amount);
    const name = (params.merchant ?? '').trim() || 'Apple Pay';
    if (value == null) {
      setStatus(
        `Couldn't read the amount "${params.amount ?? ''}". Please fill it in.`,
      );
      setAutoFailed(true);
      return;
    }

    (async () => {
      try {
        const firstRun =
          params.via === 'shortcut' && (await markAutoLogWorking());
        if (await isRecentDuplicate(value, name)) {
          setStatus('Already logged.');
        } else {
          await insertExpense({
            amount: value,
            currency: parseCurrency(params.amount),
            merchant: name,
            card: params.card?.trim() || null,
            category: guessCategory(name),
            source: 'apple_pay',
            note: params.raw?.trim() || null,
          });
          const saved = `Saved ${formatMoney(
            value,
            parseCurrency(params.amount),
          )} at ${name} ✓`;
          setStatus(
            firstRun
              ? `Setup complete 🎉\nApple Pay auto-logging is on.\n\n${saved}`
              : saved,
          );
        }
        setTimeout(leave, firstRun ? 3500 : 1200);
      } catch (err) {
        setStatus(
          `Couldn't save automatically (${String(
            err,
          )}). Please save it manually.`,
        );
        setAutoFailed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.auto,
    params.amount,
    params.merchant,
    params.card,
    params.raw,
    params.via,
  ]);

  const onMerchantChange = (v: string) => {
    setMerchant(v);
    if (!editId) setCategory(guessCategory(v));
  };

  const save = async () => {
    const value = parseAmount(amount);
    if (value == null) {
      setStatus('Enter a valid amount.');
      return;
    }
    if (value > 1_000_000) {
      setStatus('That amount looks too large. Please check it.');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        amount: value,
        merchant: merchant.trim() || 'Cash',
        category,
        note: note.trim() || null,
        created_at: date.getTime(),
      };
      if (editId) {
        await updateExpense(editId, fields);
      } else {
        await insertExpense({
          ...fields,
          currency: params.auto === '1' ? parseCurrency(params.amount) : 'AED',
          card: params.card?.trim() || null,
          source: params.auto === '1' ? 'apple_pay' : 'manual',
        });
      }
      leave();
    } catch (err) {
      setStatus(`Couldn't save: ${String(err)}`);
      setSaving(false);
    }
  };

  const remove = () => {
    if (!editId) return;
    Alert.alert('Delete expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteExpense(editId).then(leave),
      },
    ]);
  };

  if (params.auto === '1' && !autoFailed) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={[styles.statusBig, { color: t.text }]}>
          {status ?? 'Saving…'}
        </Text>
      </View>
    );
  }

  const input = [
    styles.input,
    { color: t.text, backgroundColor: t.card, borderColor: t.border },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        {status && <Text style={{ color: t.danger }}>{status}</Text>}

        <Text style={[styles.label, { color: t.muted }]}>Amount (AED)</Text>
        <TextInput
          style={[input, styles.amountInput]}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={t.muted}
          autoFocus={!editId}
        />

        <Text style={[styles.label, { color: t.muted }]}>Merchant</Text>
        <TextInput
          style={input}
          value={merchant}
          onChangeText={onMerchantChange}
          placeholder="e.g. Carrefour"
          placeholderTextColor={t.muted}
          maxLength={80}
        />

        <Text style={[styles.label, { color: t.muted }]}>Category</Text>
        <View style={styles.chips}>
          {CATEGORIES.map(c => {
            const active = c === category;
            const cs = categoryStyle(c, t);
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[
                  styles.chip,
                  { borderColor: active ? cs.color : t.border },
                  active && [{ backgroundColor: cs.color }, glow(cs.color, 8)],
                ]}
              >
                <Text
                  style={
                    active
                      ? [styles.bold, { color: t.onAccent }]
                      : { color: t.text }
                  }
                >
                  {c}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: t.muted }]}>Date</Text>
        <View style={styles.dateRow}>
          <Pressable
            onPress={() => setDate(d => shiftDay(d, -1))}
            hitSlop={8}
            style={[
              styles.dateBtn,
              { borderColor: t.border, backgroundColor: t.card },
            ]}
          >
            <Text style={[styles.dateArrow, { color: t.accent }]}>‹</Text>
          </Pressable>
          <View
            style={[
              styles.dateBox,
              { borderColor: t.accent, backgroundColor: t.card },
            ]}
          >
            <Text style={[styles.dateText, { color: t.text }]}>
              {isSameDay(date, new Date())
                ? 'Today'
                : date.toLocaleDateString('en-AE', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
            </Text>
          </View>
          <Pressable
            onPress={() => setDate(d => shiftDay(d, 1))}
            disabled={isSameDay(date, new Date())}
            hitSlop={8}
            style={[
              styles.dateBtn,
              { borderColor: t.border, backgroundColor: t.card },
            ]}
          >
            <Text
              style={[
                styles.dateArrow,
                { color: isSameDay(date, new Date()) ? t.border : t.accent },
              ]}
            >
              ›
            </Text>
          </Pressable>
        </View>
        <View style={styles.chips}>
          {[
            ['Today', 0],
            ['Yesterday', -1],
            ['−1 week', -7],
            ['−1 month', -30],
          ].map(([label, delta]) => (
            <Pressable
              key={label}
              onPress={() => setDate(d => shiftDay(d, delta as number))}
              style={[styles.chip, { borderColor: t.border }]}
            >
              <Text style={{ color: t.text }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { color: t.muted }]}>Note</Text>
        <TextInput
          style={input}
          value={note}
          onChangeText={setNote}
          placeholder="Optional"
          placeholderTextColor={t.muted}
          maxLength={200}
        />

        <Pressable
          onPress={save}
          disabled={saving}
          style={[
            styles.button,
            { backgroundColor: t.accent },
            glow(t.accent),
            saving && styles.dimmed,
          ]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            {editId ? 'Save changes' : 'Save'}
          </Text>
        </Pressable>

        {editId != null && (
          <Pressable
            onPress={remove}
            style={[styles.button, styles.outline, { borderColor: t.danger }]}
          >
            <Text style={[styles.buttonText, { color: t.danger }]}>
              Delete expense
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Moves `d` by `days` (0 = now). Landing on today, or later, gives the current time. */
function shiftDay(d: Date, days: number): Date {
  const now = new Date();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12);
  return days === 0 || next.getTime() >= now.getTime() || isSameDay(next, now)
    ? now
    : next;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: 16, gap: 12 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  statusBig: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  label: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  amountInput: { fontSize: 28, fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateArrow: { fontSize: 26, marginTop: -3 },
  dateBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dateText: { fontSize: 16, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  button: { marginTop: 8, padding: 16, borderRadius: 14, alignItems: 'center' },
  outline: { borderWidth: 1 },
  bold: { fontWeight: '700' },
  dimmed: { opacity: 0.6 },
  buttonText: { fontWeight: '800', fontSize: 16 },
});
