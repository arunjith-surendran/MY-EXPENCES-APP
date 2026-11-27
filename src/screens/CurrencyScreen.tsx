import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import {
  CURRENCY_NAMES,
  formatIn,
  POPULAR,
  useConversion,
} from '../lib/currency';
import { useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Currency'>;

type Item = { code: string | null; name: string };

/** Pick a second currency: spending totals then also show converted, e.g. "≈ ₹25,193". */
export default function CurrencyScreen({ navigation }: Props) {
  const t = useTheme();
  const { currency, setCurrency, rates } = useConversion();
  const [query, setQuery] = useState('');

  const items = useMemo<Item[]>(() => {
    const codes = Object.keys(rates?.rates ?? {}).filter(c => c !== 'AED');
    const all = [
      ...POPULAR,
      ...codes.filter(c => !POPULAR.includes(c)).sort(),
    ].filter((c, i, arr) => arr.indexOf(c) === i);
    const q = query.trim().toLowerCase();
    const list = all
      .map(code => ({ code, name: CURRENCY_NAMES[code] ?? code }))
      .filter(
        i =>
          !q ||
          i.code.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q),
      );
    return q ? list : [{ code: null, name: 'Off (AED only)' }, ...list];
  }, [rates, query]);

  const pick = (code: string | null) => {
    setCurrency(code);
    navigation.goBack();
  };

  const updated = rates
    ? new Date(rates.updatedAt).toLocaleString('en-AE', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={i => i.code ?? 'off'}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search, e.g. rupee or INR"
          placeholderTextColor={t.muted}
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[
            styles.search,
            { backgroundColor: t.card, color: t.text, borderColor: t.border },
          ]}
        />
      }
      renderItem={({ item }) => {
        const on = item.code === currency;
        const rate = item.code ? rates?.rates[item.code] : undefined;
        return (
          <Pressable
            onPress={() => pick(item.code)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? t.cardHi : t.card,
                borderColor: on ? t.accent : t.border,
              },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.name, { color: t.text }]}>
                {item.code ? `${item.code} · ${item.name}` : item.name}
              </Text>
              {rate != null && item.code && (
                <Text style={[styles.rate, { color: t.muted }]}>
                  AED 1 = {formatIn(rate, item.code)}
                </Text>
              )}
            </View>
            {on && <Text style={[styles.check, { color: t.accent }]}>✓</Text>}
          </Pressable>
        );
      }}
      ListFooterComponent={
        <Text style={[styles.footer, { color: t.muted }]}>
          {updated
            ? `Rates updated ${updated}. They refresh about once a day and are kept for offline use. `
            : 'Rates download the first time you pick a currency. '}
          Amounts are estimates for reference.{'\n'}
          <Text
            style={{ color: t.accent }}
            onPress={() => Linking.openURL('https://www.exchangerate-api.com')}
          >
            Rates By Exchange Rate API
          </Text>
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 40, gap: 8 },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  name: { fontSize: 15, fontWeight: '700' },
  rate: { fontSize: 12, marginTop: 3 },
  check: { fontSize: 18, fontWeight: '800' },
  footer: { fontSize: 12, lineHeight: 18, marginTop: 12 },
});
