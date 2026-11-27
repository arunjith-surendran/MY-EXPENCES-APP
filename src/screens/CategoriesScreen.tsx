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
import { useCategories } from '../lib/categories';
import {
  type CategoryGroup,
  forgetMerchant,
  listRememberedMerchants,
  type RememberedMerchant,
} from '../lib/db';
import { CATEGORIES } from '../lib/parse';
import { categoryStyle, useTheme } from '../lib/theme';

const GROUPS: [CategoryGroup, string][] = [
  ['essentials', 'Essential'],
  ['lifestyle', 'Lifestyle'],
  ['other', 'Other'],
];

/** Built-in groups, for showing next to the built-in categories. */
const BUILT_IN_GROUP: Record<string, string> = {
  Groceries: 'Essential',
  'Bills & Utilities': 'Essential',
  Transport: 'Essential',
  Fuel: 'Essential',
  Health: 'Essential',
  'Food & Dining': 'Lifestyle',
  Shopping: 'Lifestyle',
  Entertainment: 'Lifestyle',
  Other: 'Other',
};

/**
 * The categories: add your own, rename them, say whether they're essential or lifestyle
 * spending (for the spending-health chart), delete them, and see which merchants the app
 * files automatically.
 */
export default function CategoriesScreen() {
  const t = useTheme();
  const categories = useCategories();
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<CategoryGroup>('other');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [merchants, setMerchants] = useState<RememberedMerchant[]>([]);

  const loadMerchants = useCallback(() => {
    listRememberedMerchants()
      .then(setMerchants)
      .catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      categories.reload();
      loadMerchants();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadMerchants]),
  );

  const fail = (err: unknown) =>
    Alert.alert(
      "Couldn't save",
      err instanceof Error ? err.message : String(err),
    );

  const add = async () => {
    try {
      await categories.add(newName, newGroup);
      setNewName('');
      setNewGroup('other');
    } catch (err) {
      fail(err);
    }
  };

  const saveRename = async (from: string) => {
    try {
      await categories.rename(from, draft);
      setEditing(null);
      loadMerchants();
    } catch (err) {
      fail(err);
    }
  };

  const remove = (name: string) =>
    Alert.alert(
      `Delete "${name}"?`,
      'Its expenses and recurring payments move to Other, and its budget is removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            categories.remove(name).then(loadMerchants).catch(fail),
        },
      ],
    );

  const forget = (m: RememberedMerchant) =>
    forgetMerchant(m.merchant).then(loadMerchants).catch(fail);

  const input = [
    styles.input,
    { color: t.text, backgroundColor: t.cardHi, borderColor: t.border },
  ];
  const card = [
    styles.card,
    { backgroundColor: t.card, borderColor: t.border },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.section, { color: t.muted }]}>New category</Text>
      <View style={card}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={add}
          placeholder="e.g. Kids, Gym, Rent"
          placeholderTextColor={t.muted}
          maxLength={24}
          returnKeyType="done"
          style={input}
        />
        <Text style={[styles.hint, { color: t.muted }]}>
          Counts as (for the spending-health chart)
        </Text>
        <View style={styles.chips}>
          {GROUPS.map(([g, label]) => (
            <Chip
              key={g}
              label={label}
              on={newGroup === g}
              onPress={() => setNewGroup(g)}
            />
          ))}
        </View>
        <Pressable
          onPress={add}
          disabled={!newName.trim()}
          style={[
            styles.button,
            { backgroundColor: t.accent },
            !newName.trim() && styles.dimmed,
          ]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            Add category
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.section, { color: t.muted }]}>Your categories</Text>
      {categories.custom.length === 0 ? (
        <View style={card}>
          <Text style={{ color: t.muted }}>
            None yet. Add one above, or with "+ New" when adding an expense.
          </Text>
        </View>
      ) : (
        <View style={card}>
          {categories.custom.map((name, i) => {
            const c = categoryStyle(name, t);
            const group = categories.groups.get(name) ?? 'other';
            return (
              <View
                key={name}
                style={[
                  styles.item,
                  i > 0 && { borderTopColor: t.border },
                  i > 0 && styles.divider,
                ]}
              >
                <View style={styles.row}>
                  <Badge color={c.color} text={c.icon} />
                  {editing === name ? (
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      onSubmitEditing={() => saveRename(name)}
                      autoFocus
                      maxLength={24}
                      returnKeyType="done"
                      style={[input, styles.flex]}
                    />
                  ) : (
                    <Text style={[styles.name, { color: t.text }]}>{name}</Text>
                  )}
                  {editing === name ? (
                    <>
                      <Pressable onPress={() => saveRename(name)} hitSlop={8}>
                        <Text style={[styles.link, { color: t.accent }]}>
                          Save
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                        <Text style={{ color: t.muted }}>Cancel</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => {
                          setEditing(name);
                          setDraft(name);
                        }}
                        hitSlop={8}
                      >
                        <Text style={[styles.link, { color: t.accent }]}>
                          Rename
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => remove(name)} hitSlop={8}>
                        <Text style={[styles.link, { color: t.danger }]}>
                          Delete
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
                <View style={[styles.chips, styles.indent]}>
                  {GROUPS.map(([g, label]) => (
                    <Chip
                      key={g}
                      label={label}
                      on={group === g}
                      onPress={() => categories.setGroup(name, g).catch(fail)}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Text style={[styles.section, { color: t.muted }]}>Built in</Text>
      <View style={card}>
        {CATEGORIES.map((name, i) => {
          const c = categoryStyle(name, t);
          return (
            <View
              key={name}
              style={[
                styles.row,
                styles.item,
                i > 0 && styles.divider,
                i > 0 && { borderTopColor: t.border },
              ]}
            >
              <Badge color={c.color} text={c.icon} />
              <Text style={[styles.name, { color: t.text }]}>{name}</Text>
              <Text style={{ color: t.muted }}>{BUILT_IN_GROUP[name]}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.section, { color: t.muted }]}>
        Remembered merchants
      </Text>
      <View style={card}>
        {merchants.length === 0 ? (
          <Text style={{ color: t.muted }}>
            When you pick a category for a merchant, it's remembered here and
            used next time (manual, Apple Pay and statements).
          </Text>
        ) : (
          merchants.map((m, i) => (
            <View
              key={m.merchant}
              style={[
                styles.row,
                styles.item,
                i > 0 && styles.divider,
                i > 0 && { borderTopColor: t.border },
              ]}
            >
              <View style={styles.flex}>
                <Text
                  numberOfLines={1}
                  style={[styles.merchant, { color: t.text }]}
                >
                  {m.merchant}
                </Text>
                <Text style={{ color: categoryStyle(m.category, t).color }}>
                  {m.category}
                </Text>
              </View>
              <Pressable onPress={() => forget(m)} hitSlop={8}>
                <Text style={[styles.link, { color: t.muted }]}>Forget</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  const t = useTheme();
  return (
    <View
      style={[styles.badge, { borderColor: color, backgroundColor: t.cardHi }]}
    >
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40 },
  flex: { flex: 1 },
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
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  hint: { fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { fontWeight: '800', fontSize: 15 },
  dimmed: { opacity: 0.5 },
  item: { paddingVertical: 6, gap: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  indent: { marginLeft: 46 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  merchant: { fontSize: 15, fontWeight: '600', textTransform: 'capitalize' },
  link: { fontWeight: '700' },
  badge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '900' },
});
