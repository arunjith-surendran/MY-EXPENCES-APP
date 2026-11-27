import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  type ImagePickerResponse,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';

import type { RootStackParamList } from '../../App';
import Gradient from '../components/Gradient';
import { useUndo } from '../components/UndoToast';
import { checkBudgetAlerts } from '../lib/budgets';
import { getReceipt, removeReceipt, setReceipt } from '../lib/receipts';
import { addRecurring } from '../lib/recurring';
import {
  deleteExpense,
  getExpense,
  insertExpense,
  isRecentDuplicate,
  markAutoLogWorking,
  type PaymentMethod,
  updateExpense,
} from '../lib/db';
import {
  categoryFor,
  isBuiltInCategory,
  rememberCategory,
  useCategories,
} from '../lib/categories';
import {
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
  const categories = useCategories();
  const [category, setCategory] = useState<string>(() =>
    guessCategory(params.merchant ?? ''),
  );
  // Once the user taps a category, typing the merchant no longer changes it.
  const pickedCategory = useRef(false);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { showUndo } = useUndo();
  // Receipt photo (JPEG base64); `receiptChanged` says whether to save or remove it.
  const [receipt, setReceiptData] = useState<string | null>(null);
  const [receiptChanged, setReceiptChanged] = useState(false);
  const [viewReceipt, setViewReceipt] = useState(false);
  // Extra parts of a split payment; the rest of the amount stays in `category`.
  const [splits, setSplits] = useState<{ amount: string; category: string }[]>(
    [],
  );
  const [repeat, setRepeat] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>(
    params.method === 'cash' ? 'cash' : 'card',
  );
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
    navigation.setOptions({
      title: editId
        ? 'Edit expense'
        : params.method === 'cash'
        ? 'Add cash expense'
        : 'Add expense',
    });
  }, [editId, navigation, params.method]);

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
      setCategory(e.category || 'Other');
      setNote(e.note ?? '');
      setMethod(e.method === 'cash' ? 'cash' : 'card');
      setDate(new Date(e.created_at));
    });
    getReceipt(editId)
      .then(setReceiptData)
      .catch(() => {});
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
            category: await categoryFor(name),
            source: 'apple_pay',
            note: params.raw?.trim() || null,
          });
          checkBudgetAlerts();
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

  // Prefill from the merchant: what the user picked for it before, else the built-in guess.
  useEffect(() => {
    if (editId || pickedCategory.current) return;
    let current = true;
    categoryFor(merchant).then(c => {
      if (current && !pickedCategory.current) setCategory(c);
    });
    return () => {
      current = false;
    };
  }, [merchant, editId]);

  const pickCategory = (c: string) => {
    pickedCategory.current = true;
    setCategory(c);
  };

  const createCategory = async () => {
    try {
      const name = await categories.add(newCategory ?? '');
      pickCategory(name);
      setNewCategory(null);
    } catch (err) {
      Alert.alert(
        "Couldn't add category",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const confirmRemoveCategory = (name: string) => {
    if (isBuiltInCategory(name)) return;
    Alert.alert(
      `Delete "${name}"?`,
      'Expenses in this category move to Other.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            categories
              .remove(name)
              .then(() => {
                if (category === name) setCategory('Other');
              })
              .catch(() => {}),
        },
      ],
    );
  };

  const splitTotal = splits.reduce(
    (sum, p) => sum + (parseAmount(p.amount) ?? 0),
    0,
  );

  const pickReceipt = () => {
    const options = {
      mediaType: 'photo' as const,
      maxWidth: 1400,
      maxHeight: 1400,
      quality: 0.6 as const,
      includeBase64: true,
    };
    const done = (r: ImagePickerResponse) => {
      if (r.errorMessage) {
        Alert.alert('Could not add the photo', r.errorMessage);
        return;
      }
      const data = r.assets?.[0]?.base64;
      if (data) {
        setReceiptData(data);
        setReceiptChanged(true);
      }
    };
    const from = (source: 'camera' | 'library') =>
      source === 'camera'
        ? launchCamera(options, done)
        : launchImageLibrary({ ...options, selectionLimit: 1 }, done);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Take photo', 'Choose photo', 'Cancel'],
          cancelButtonIndex: 2,
        },
        i => (i === 0 ? from('camera') : i === 1 && from('library')),
      );
    } else {
      Alert.alert('Receipt photo', undefined, [
        { text: 'Take photo', onPress: () => from('camera') },
        { text: 'Choose photo', onPress: () => from('library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const dropReceipt = () => {
    setReceiptData(null);
    setReceiptChanged(true);
  };

  const pickSplitCategory = (index: number) => {
    const options = categories.all;
    const set = (c: string) =>
      setSplits(prev =>
        prev.map((p, i) => (i === index ? { ...p, category: c } : p)),
      );
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Category',
          options: [...options, 'Cancel'],
          cancelButtonIndex: options.length,
        },
        i => options[i] && set(options[i]),
      );
    } else {
      Alert.alert('Category', undefined, [
        ...options.map(c => ({ text: c, onPress: () => set(c) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
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
    const parts = splits
      .map(p => ({ amount: parseAmount(p.amount), category: p.category }))
      .filter((p): p is { amount: number; category: string } => !!p.amount);
    const mainAmount = Math.round((value - splitTotal) * 100) / 100;
    if (parts.length && mainAmount <= 0) {
      setStatus('The split parts add up to more than the total.');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        amount: parts.length ? mainAmount : value,
        merchant: merchant.trim() || (method === 'cash' ? 'Cash' : 'Card'),
        category,
        note: note.trim() || null,
        created_at: date.getTime(),
        method,
      };
      await rememberCategory(merchant, category).catch(() => {});
      let id = editId;
      if (editId) {
        await updateExpense(editId, fields);
      } else {
        const shared = {
          currency: params.auto === '1' ? parseCurrency(params.amount) : 'AED',
          card: params.card?.trim() || null,
          source: (params.auto === '1' ? 'apple_pay' : 'manual') as
            | 'apple_pay'
            | 'manual',
        };
        id = await insertExpense({ ...fields, ...shared });
        for (const p of parts) {
          await insertExpense({
            ...fields,
            ...shared,
            amount: p.amount,
            category: p.category,
            note: [fields.note, `Split of ${formatMoney(value)}`]
              .filter(Boolean)
              .join(' · '),
          });
        }
        if (repeat) {
          await addRecurring({
            amount: value,
            merchant: fields.merchant,
            category,
            method,
            note: fields.note,
            day: date.getDate(),
            after: date.getTime(),
          });
        }
      }
      if (id && receiptChanged) {
        if (receipt) await setReceipt(id, receipt);
        else await removeReceipt(id);
      }
      checkBudgetAlerts();
      leave();
    } catch (err) {
      setStatus(`Couldn't save: ${String(err)}`);
      setSaving(false);
    }
  };

  const remove = () => {
    if (!editId) return;
    Alert.alert('Delete expense?', 'It goes to Recently deleted for 30 days.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(editId);
          showUndo({
            message: `${merchant || 'Expense'} deleted`,
            ids: [editId],
          });
          leave();
        },
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

        <Text style={[styles.label, { color: t.muted }]}>Paid with</Text>
        <View style={[styles.segment, { backgroundColor: t.cardHi }]}>
          {(
            [
              ['card', 'Card'],
              ['cash', 'Cash'],
            ] as const
          ).map(([value, label]) => {
            const active = method === value;
            const colors =
              value === 'cash' ? t.gradients.cash : t.gradients.hero;
            return (
              <Pressable
                key={value}
                onPress={() => setMethod(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.segmentItem,
                  active && glow(colors[colors.length - 1], 8),
                ]}
              >
                {active && <Gradient colors={colors} radius={10} />}
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? t.onAccent : t.text },
                  ]}
                >
                  {value === 'cash' ? '💵 ' : '💳 '}
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: t.muted }]}>
          {method === 'cash' ? 'What for' : 'Merchant'}
        </Text>
        <TextInput
          style={input}
          value={merchant}
          onChangeText={setMerchant}
          placeholder={
            method === 'cash' ? 'e.g. Grocery shop, taxi' : 'e.g. Carrefour'
          }
          placeholderTextColor={t.muted}
          maxLength={80}
        />

        <Text style={[styles.label, { color: t.muted }]}>Category</Text>
        <View style={styles.chips}>
          {(categories.all.includes(category)
            ? categories.all
            : [...categories.all, category]
          ).map(c => {
            const active = c === category;
            const cs = categoryStyle(c, t);
            return (
              <Pressable
                key={c}
                onPress={() => pickCategory(c)}
                onLongPress={() => confirmRemoveCategory(c)}
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
          {newCategory == null && (
            <Pressable
              onPress={() => setNewCategory('')}
              accessibilityRole="button"
              style={[styles.chip, styles.dashed, { borderColor: t.accent }]}
            >
              <Text style={[styles.bold, { color: t.accent }]}>+ New</Text>
            </Pressable>
          )}
        </View>
        {newCategory != null && (
          <View style={styles.newRow}>
            <TextInput
              style={[input, styles.flex]}
              value={newCategory}
              onChangeText={setNewCategory}
              onSubmitEditing={createCategory}
              placeholder="e.g. Kids, Gym, Rent"
              placeholderTextColor={t.muted}
              maxLength={24}
              autoFocus
              returnKeyType="done"
            />
            <Pressable
              onPress={createCategory}
              style={[styles.addBtn, { backgroundColor: t.accent }]}
            >
              <Text style={[styles.bold, { color: t.onAccent }]}>Add</Text>
            </Pressable>
            <Pressable onPress={() => setNewCategory(null)} hitSlop={8}>
              <Text style={{ color: t.muted }}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {categories.custom.length > 0 && newCategory == null && (
          <Text style={[styles.hint, { color: t.muted }]}>
            Hold a category you added to delete it.
          </Text>
        )}

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
          placeholder="Optional · add #tags like #trip"
          placeholderTextColor={t.muted}
          maxLength={200}
        />

        <Text style={[styles.label, { color: t.muted }]}>Receipt</Text>
        {receipt ? (
          <View style={styles.receiptRow}>
            <Pressable onPress={() => setViewReceipt(true)}>
              <Image
                source={{ uri: `data:image/jpeg;base64,${receipt}` }}
                style={[styles.receiptThumb, { borderColor: t.border }]}
              />
            </Pressable>
            <View style={styles.receiptActions}>
              <Pressable onPress={pickReceipt} hitSlop={8}>
                <Text style={[styles.bold, { color: t.accent }]}>Replace</Text>
              </Pressable>
              <Pressable onPress={dropReceipt} hitSlop={8}>
                <Text style={[styles.bold, { color: t.danger }]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={pickReceipt}
            style={[
              styles.chip,
              styles.dashed,
              styles.attach,
              { borderColor: t.accent },
            ]}
          >
            <Text style={[styles.bold, { color: t.accent }]}>
              📎 Add receipt photo
            </Text>
          </Pressable>
        )}

        {!editId && params.auto !== '1' && (
          <>
            <Text style={[styles.label, { color: t.muted }]}>Split</Text>
            {splits.map((p, i) => {
              const cs = categoryStyle(p.category, t);
              return (
                <View key={i} style={styles.newRow}>
                  <TextInput
                    style={[input, styles.splitAmount]}
                    value={p.amount}
                    onChangeText={v =>
                      setSplits(prev =>
                        prev.map((x, j) => (j === i ? { ...x, amount: v } : x)),
                      )
                    }
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={t.muted}
                  />
                  <Pressable
                    onPress={() => pickSplitCategory(i)}
                    style={[
                      styles.chip,
                      styles.flex,
                      { borderColor: cs.color },
                    ]}
                  >
                    <Text numberOfLines={1} style={{ color: cs.color }}>
                      {p.category} ▾
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setSplits(prev => prev.filter((_, j) => j !== i))
                    }
                    hitSlop={8}
                  >
                    <Text style={{ color: t.muted }}>✕</Text>
                  </Pressable>
                </View>
              );
            })}
            {splits.length > 0 && (
              <Text
                style={[
                  styles.hint,
                  {
                    color:
                      (parseAmount(amount) ?? 0) - splitTotal <= 0
                        ? t.danger
                        : t.muted,
                  },
                ]}
              >
                {category} keeps{' '}
                {formatMoney(
                  Math.max(0, (parseAmount(amount) ?? 0) - splitTotal),
                )}
                . Each part is saved as its own expense.
              </Text>
            )}
            <Pressable
              onPress={() =>
                setSplits(prev => [
                  ...prev,
                  {
                    amount: '',
                    category:
                      category === 'Groceries' ? 'Shopping' : 'Groceries',
                  },
                ])
              }
              style={[
                styles.chip,
                styles.dashed,
                styles.attach,
                { borderColor: t.border },
              ]}
            >
              <Text style={[styles.bold, { color: t.text }]}>
                ➗{' '}
                {splits.length ? 'Add another part' : 'Split across categories'}
              </Text>
            </Pressable>

            <View style={styles.repeatRow}>
              <View style={styles.flex}>
                <Text style={[styles.bold, { color: t.text }]}>
                  Repeat every month
                </Text>
                <Text style={[styles.hint, { color: t.muted }]}>
                  Added by itself on day {date.getDate()} of each month, with a
                  reminder the day before.
                </Text>
              </View>
              <Switch value={repeat} onValueChange={setRepeat} />
            </View>
          </>
        )}

        <Pressable
          onPress={save}
          disabled={saving}
          style={[
            styles.button,
            glow((method === 'cash' ? t.gradients.cash : t.gradients.hero)[1]),
            saving && styles.dimmed,
          ]}
        >
          <Gradient
            colors={method === 'cash' ? t.gradients.cash : t.gradients.hero}
            radius={14}
          />
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
      <Modal
        visible={viewReceipt && !!receipt}
        transparent
        animationType="fade"
        onRequestClose={() => setViewReceipt(false)}
      >
        <Pressable style={styles.viewer} onPress={() => setViewReceipt(false)}>
          {receipt && (
            <Image
              source={{ uri: `data:image/jpeg;base64,${receipt}` }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          )}
          <Text style={styles.viewerHint}>Tap to close</Text>
        </Pressable>
      </Modal>
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
  segment: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentText: { fontSize: 15, fontWeight: '700' },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  button: { marginTop: 8, padding: 16, borderRadius: 14, alignItems: 'center' },
  outline: { borderWidth: 1 },
  bold: { fontWeight: '700' },
  dashed: { borderStyle: 'dashed' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  hint: { fontSize: 12, marginTop: -4 },
  attach: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  receiptThumb: { width: 84, height: 84, borderRadius: 12, borderWidth: 1 },
  receiptActions: { gap: 12 },
  splitAmount: { width: 110 },
  repeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  viewerImage: { width: '100%', height: '85%' },
  viewerHint: { color: '#FFFFFF', marginTop: 12, opacity: 0.8 },
  dimmed: { opacity: 0.6 },
  buttonText: { fontWeight: '800', fontSize: 16 },
});
