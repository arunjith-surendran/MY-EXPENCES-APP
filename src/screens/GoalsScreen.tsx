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
  addGoal,
  addToGoal,
  deleteGoal,
  type Goal,
  listGoals,
  monthlyNeeded,
  setGoalDone,
} from '../lib/goals';
import { monthKey, monthLabel, shiftMonth } from '../lib/months';
import { formatMoney, parseAmount } from '../lib/parse';
import { cardShadow, useTheme } from '../lib/theme';
import { useFeatureUse } from '../lib/usage';

const EMOJIS = ['✈️', '🏠', '🚗', '🎓', '💍', '🛟', '📱', '🎁'];

/** End of the given month ("2027-03"), as the deadline. */
const monthEnd = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0, 23, 59).getTime();
};

/** Saving towards something: a target, an optional deadline, and money put aside over time. */
export default function GoalsScreen() {
  const t = useTheme();
  useFeatureUse('goals');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [deadline, setDeadline] = useState<string | null>(
    shiftMonth(monthKey(), 6),
  );
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    listGoals()
      .then(setGoals)
      .catch(() => {});
  }, []);
  useFocusEffect(load);

  const create = async () => {
    const value = parseAmount(target);
    if (!name.trim() || !value) {
      Alert.alert('Add a name and a target amount');
      return;
    }
    await addGoal({
      name: name.trim(),
      target: value,
      deadline: deadline ? monthEnd(deadline) : null,
      emoji,
    });
    setAdding(false);
    setName('');
    setTarget('');
    load();
  };

  const put = async (g: Goal, sign: 1 | -1) => {
    const value = parseAmount(amounts[g.id] ?? '');
    if (!value) {
      Alert.alert('Enter an amount first');
      return;
    }
    await addToGoal(g.id, sign * value);
    setAmounts(a => ({ ...a, [g.id]: '' }));
    const saved = g.saved + sign * value;
    if (sign > 0 && saved >= g.target && !g.done_at) {
      await setGoalDone(g.id, true);
      Alert.alert(
        `${g.emoji ?? '🎉'} Goal reached!`,
        `${g.name}: ${formatMoney(saved)} saved.`,
      );
    }
    load();
  };

  const remove = (g: Goal) =>
    Alert.alert(`Delete "${g.name}"?`, 'The goal and its history go away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteGoal(g.id).then(load),
      },
    ]);

  const totalSaved = goals.reduce((s, g) => s + Math.max(0, g.saved), 0);
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
      <View style={[styles.hero, { backgroundColor: t.accent }]}>
        <Text style={[styles.heroLabel, { color: t.onAccent }]}>
          Saved for goals
        </Text>
        <Text style={[styles.heroValue, { color: t.onAccent }]}>
          {formatMoney(totalSaved)}
        </Text>
        <Text style={[styles.heroHint, { color: t.onAccent }]}>
          Put money aside for what matters and see how much to save each month.
        </Text>
      </View>

      {adding ? (
        <View
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.border },
          ]}
        >
          <Text style={[styles.title, { color: t.text }]}>New goal</Text>
          <View style={styles.chips}>
            {EMOJIS.map(e => (
              <Pressable
                key={e}
                onPress={() => setEmoji(e)}
                style={[
                  styles.emoji,
                  { borderColor: emoji === e ? t.accent : t.border },
                  emoji === e && { backgroundColor: t.accentSoft },
                ]}
              >
                <Text style={styles.emojiText}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="What for (e.g. Trip to Georgia)"
            placeholderTextColor={t.muted}
            maxLength={40}
            style={input}
          />
          <TextInput
            value={target}
            onChangeText={setTarget}
            placeholder="Target (AED)"
            placeholderTextColor={t.muted}
            keyboardType="decimal-pad"
            style={input}
          />
          <Text style={[styles.label, { color: t.muted }]}>By</Text>
          <View style={styles.row}>
            <Chip
              label="No deadline"
              on={deadline == null}
              onPress={() => setDeadline(null)}
            />
            {deadline != null && (
              <>
                <Pressable
                  onPress={() =>
                    setDeadline(d =>
                      d && d > monthKey() ? shiftMonth(d, -1) : d,
                    )
                  }
                  hitSlop={8}
                  style={[styles.step, { borderColor: t.border }]}
                >
                  <Text style={[styles.stepText, { color: t.accent }]}>‹</Text>
                </Pressable>
                <Text style={[styles.bold, { color: t.text }]}>
                  {monthLabel(deadline)}
                </Text>
                <Pressable
                  onPress={() => setDeadline(d => (d ? shiftMonth(d, 1) : d))}
                  hitSlop={8}
                  style={[styles.step, { borderColor: t.border }]}
                >
                  <Text style={[styles.stepText, { color: t.accent }]}>›</Text>
                </Pressable>
              </>
            )}
            {deadline == null && (
              <Chip
                label="Set a month"
                on={false}
                onPress={() => setDeadline(shiftMonth(monthKey(), 6))}
              />
            )}
          </View>
          <View style={styles.row}>
            <Pressable
              onPress={() => setAdding(false)}
              style={[styles.button, styles.outline, { borderColor: t.border }]}
            >
              <Text style={[styles.buttonText, { color: t.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={create}
              style={[
                styles.button,
                styles.flex,
                { backgroundColor: t.accent },
              ]}
            >
              <Text style={[styles.buttonText, { color: t.onAccent }]}>
                Create goal
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
            + New goal
          </Text>
        </Pressable>
      )}

      {goals.map(g => {
        const ratio =
          g.target > 0 ? Math.min(1, Math.max(0, g.saved / g.target)) : 0;
        const perMonth = monthlyNeeded(g);
        const done = g.done_at != null;
        return (
          <View
            key={g.id}
            style={[
              styles.card,
              {
                backgroundColor: t.card,
                borderColor: done ? t.success : t.border,
              },
              cardShadow(t),
            ]}
          >
            <View style={styles.row}>
              <Text style={styles.goalEmoji}>{g.emoji ?? '🎯'}</Text>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: t.text }]}>{g.name}</Text>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {formatMoney(g.saved)} of {formatMoney(g.target)}
                  {g.deadline
                    ? ` · by ${monthLabel(monthKey(new Date(g.deadline)))}`
                    : ''}
                </Text>
              </View>
              <Text
                style={[styles.pct, { color: done ? t.success : t.accent }]}
              >
                {Math.round(ratio * 100)}%
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: t.cardHi }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(2, ratio * 100)}%`,
                    backgroundColor: done ? t.success : t.accent,
                  },
                ]}
              />
            </View>
            {done ? (
              <Text style={[styles.meta, { color: t.success }]}>
                🎉 Reached
              </Text>
            ) : perMonth != null ? (
              <Text style={[styles.meta, { color: t.muted }]}>
                Save {formatMoney(perMonth)} a month to make it.
              </Text>
            ) : null}
            {!done && (
              <View style={styles.row}>
                <TextInput
                  value={amounts[g.id] ?? ''}
                  onChangeText={v => setAmounts(a => ({ ...a, [g.id]: v }))}
                  placeholder="Amount"
                  placeholderTextColor={t.muted}
                  keyboardType="decimal-pad"
                  style={[input, styles.flex]}
                />
                <Pressable
                  onPress={() => put(g, 1)}
                  style={[styles.small, { backgroundColor: t.success }]}
                >
                  <Text style={[styles.smallText, { color: t.onAccent }]}>
                    + Add
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => put(g, -1)}
                  style={[
                    styles.small,
                    styles.outline,
                    { borderColor: t.border },
                  ]}
                >
                  <Text style={[styles.smallText, { color: t.text }]}>
                    − Take
                  </Text>
                </Pressable>
              </View>
            )}
            <View style={styles.actions}>
              <Pressable
                onPress={() => setGoalDone(g.id, !done).then(load)}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: t.accent }]}>
                  {done ? 'Reopen' : 'Mark reached'}
                </Text>
              </Pressable>
              <Pressable onPress={() => remove(g)} hitSlop={8}>
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
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
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
  emoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 22, marginTop: -2 },
  bold: { fontWeight: '700' },
  button: { padding: 14, borderRadius: 12, alignItems: 'center' },
  outline: { borderWidth: 1, paddingHorizontal: 18 },
  buttonText: { fontWeight: '800', fontSize: 15 },
  goalEmoji: { fontSize: 30 },
  meta: { fontSize: 13, marginTop: 2 },
  pct: { fontSize: 18, fontWeight: '900' },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  small: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  smallText: { fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 20 },
  link: { fontWeight: '700' },
});
