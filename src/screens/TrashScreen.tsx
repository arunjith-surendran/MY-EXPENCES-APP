import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type DeletedExpense,
  listDeletedExpenses,
  purgeDeletedExpenses,
  restoreExpenses,
} from '../lib/db';
import { formatMoney } from '../lib/parse';
import { shortDay } from '../lib/periods';
import { BIN_DAYS } from '../lib/upkeep';
import { categoryStyle, useTheme } from '../lib/theme';
import { useFeatureUse } from '../lib/usage';

const DAY_MS = 86_400_000;

/** Deleted expenses, kept for 30 days: restore them, or delete them for good. */
export default function TrashScreen() {
  const t = useTheme();
  useFeatureUse('trash');
  const [items, setItems] = useState<DeletedExpense[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    listDeletedExpenses()
      .then(rows => {
        setItems(rows);
        setPicked(new Set());
      })
      .catch(() => {});
  }, []);
  useFocusEffect(load);

  const ids = picked.size ? [...picked] : items.map(e => e.id);
  const label = picked.size ? `${picked.size} selected` : `all ${items.length}`;

  const toggle = (id: number) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const restore = async () => {
    const n = await restoreExpenses(ids).catch(() => 0);
    load();
    Alert.alert('Restored', `${n} expense${n === 1 ? '' : 's'} back in place.`);
  };

  const purge = () =>
    Alert.alert(
      `Delete ${label} for good?`,
      "They can't be restored after this.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete for good',
          style: 'destructive',
          onPress: async () => {
            await purgeDeletedExpenses(picked.size ? { ids } : {}).catch(
              () => 0,
            );
            load();
          },
        },
      ],
    );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <FlatList
        data={items}
        keyExtractor={e => String(e.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={[styles.intro, { color: t.muted }]}>
            Deleted expenses wait here for {BIN_DAYS} days, then go for good.
            Tap to select, or restore everything at once.
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗑️</Text>
            <Text style={[styles.emptyTitle, { color: t.text }]}>
              Nothing deleted
            </Text>
          </View>
        }
        renderItem={({ item: e }) => {
          const on = picked.has(e.id);
          const c = categoryStyle(e.category, t);
          const daysLeft = Math.max(
            0,
            BIN_DAYS - Math.floor((Date.now() - e.deleted_at) / DAY_MS),
          );
          return (
            <Pressable
              onPress={() => toggle(e.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[
                styles.row,
                {
                  backgroundColor: t.card,
                  borderColor: on ? t.accent : t.border,
                },
              ]}
            >
              <View
                style={[
                  styles.check,
                  { borderColor: on ? t.accent : t.border },
                  on && { backgroundColor: t.accent },
                ]}
              >
                {on && (
                  <Text style={[styles.checkMark, { color: t.onAccent }]}>
                    ✓
                  </Text>
                )}
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
                  <Text style={{ color: c.color }}>{e.category}</Text> ·{' '}
                  {daysLeft}d left
                </Text>
              </View>
              <Text style={[styles.amount, { color: t.text }]}>
                {formatMoney(e.amount, e.currency)}
              </Text>
            </Pressable>
          );
        }}
      />
      {items.length > 0 && (
        <View
          style={[
            styles.footer,
            { backgroundColor: t.bg, borderTopColor: t.border },
          ]}
        >
          <Pressable
            onPress={purge}
            style={[styles.button, styles.outline, { borderColor: t.danger }]}
          >
            <Text style={[styles.buttonText, { color: t.danger }]}>
              Delete {picked.size ? picked.size : 'all'}
            </Text>
          </Pressable>
          <Pressable
            onPress={restore}
            style={[styles.button, styles.flex, { backgroundColor: t.accent }]}
          >
            <Text style={[styles.buttonText, { color: t.onAccent }]}>
              Restore {label}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, gap: 8 },
  intro: { fontSize: 13, lineHeight: 18, marginBottom: 6 },
  empty: { alignItems: 'center', marginTop: 48, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 14, fontWeight: '900', marginTop: -1 },
  bold: { fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 3 },
  amount: { fontWeight: '800', fontSize: 15 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: { padding: 15, borderRadius: 14, alignItems: 'center' },
  outline: { borderWidth: 1.5, paddingHorizontal: 18 },
  buttonText: { fontWeight: '800', fontSize: 15 },
});
