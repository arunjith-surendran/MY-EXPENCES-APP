import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../../lib/auth/AuthContext';
import { useTheme } from '../../lib/theme';
import { aed, Button, Card, Chip, SectionTitle, shortDate, styles } from './ui';

type Cost = { id: string; name: string; monthlyAmount: number };
type Payment = {
  id: string;
  product: string;
  amount: number;
  source: 'app_store' | 'manual';
  note: string | null;
  paidAt: string;
  email: string | null;
  name: string | null;
};

/** Typical costs of running the app, one tap to add. */
const COMMON: [string, number][] = [
  ['Apple Developer Program ($99/yr)', 30.3],
  ['Server hosting', 0],
  ['Database', 0],
];

/** Running costs (they make the profit/loss chart real) and the money received. */
export default function AdminFinanceScreen() {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [costs, setCosts] = useState<Cost[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    authedRequest<Cost[]>('/admin/costs')
      .then(setCosts)
      .catch(() => setCosts([]));
    authedRequest<Payment[]>('/admin/payments')
      .then(setPayments)
      .catch(() => {});
  }, [authedRequest]);

  useFocusEffect(load);

  const add = async () => {
    const value = Number(amount.replace(/,/g, ''));
    if (!name.trim() || !Number.isFinite(value) || value < 0) {
      Alert.alert('Enter a name and a monthly amount in AED');
      return;
    }
    setBusy(true);
    try {
      await authedRequest('/admin/costs', {
        body: {
          name: name.trim(),
          monthlyAmount: Math.round(value * 100) / 100,
        },
      });
      setName('');
      setAmount('');
      load();
    } catch (e) {
      Alert.alert('Could not add the cost', String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (cost: Cost) =>
    Alert.alert(`Remove "${cost.name}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          authedRequest(`/admin/costs/${cost.id}`, { method: 'DELETE' })
            .then(load)
            .catch(e => Alert.alert('Could not remove it', String(e))),
      },
    ]);

  if (!costs) return <ActivityIndicator style={styles.loader} />;
  const total = costs.reduce((sum, c) => sum + c.monthlyAmount, 0);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <SectionTitle>Running costs per month</SectionTitle>
      <Card>
        {costs.length === 0 ? (
          <Text style={[styles.meta, { color: t.muted }]}>
            No costs yet. Add them so profit and loss are real.
          </Text>
        ) : (
          costs.map(c => (
            <Pressable
              key={c.id}
              onLongPress={() => remove(c)}
              style={styles.between}
            >
              <Text style={[styles.meta, styles.shrink, { color: t.text }]}>
                {c.name}
              </Text>
              <View style={styles.row}>
                <Text style={[styles.meta, styles.strong, { color: t.text }]}>
                  {aed(c.monthlyAmount)}
                </Text>
                <Pressable
                  onPress={() => remove(c)}
                  hitSlop={10}
                  accessibilityLabel={`Remove ${c.name}`}
                >
                  <Text style={[styles.meta, { color: t.danger }]}>✕</Text>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
        {costs.length > 0 && (
          <View style={[styles.between, styles.mt6]}>
            <Text style={[styles.title, { color: t.text }]}>Total</Text>
            <Text style={[styles.title, { color: t.danger }]}>
              {aed(total)} / month
            </Text>
          </View>
        )}
      </Card>

      <SectionTitle>Add a cost</SectionTitle>
      <View style={styles.chips}>
        {COMMON.map(([n, v]) => (
          <Chip
            key={n}
            label={n}
            on={name === n}
            onPress={() => {
              setName(n);
              setAmount(v ? String(v) : '');
            }}
          />
        ))}
      </View>
      <View style={[styles.gap8, styles.mt10]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name, e.g. Server hosting"
          placeholderTextColor={t.muted}
          maxLength={80}
          style={[styles.input, { backgroundColor: t.card, color: t.text }]}
        />
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="AED per month"
          placeholderTextColor={t.muted}
          keyboardType="decimal-pad"
          style={[styles.input, { backgroundColor: t.card, color: t.text }]}
        />
        <Button label="Add cost" busy={busy} onPress={add} />
      </View>

      <SectionTitle>Payments received</SectionTitle>
      <Card>
        {payments.length === 0 ? (
          <Text style={[styles.meta, { color: t.muted }]}>
            No payments yet. App Store payments appear here once subscriptions
            are connected; you can also record a payment from a user's page.
          </Text>
        ) : (
          payments.map(p => (
            <View key={p.id} style={styles.between}>
              <View style={styles.shrink}>
                <Text style={[styles.meta, { color: t.text }]}>
                  {p.name || p.email || 'Deleted user'}
                </Text>
                <Text style={[styles.meta, styles.small, { color: t.muted }]}>
                  {shortDate(p.paidAt)} · {p.product.replace('pro_', '')} ·{' '}
                  {p.source === 'manual' ? 'recorded by hand' : 'App Store'}
                </Text>
              </View>
              <Text style={[styles.meta, styles.strong, { color: t.success }]}>
                +{aed(p.amount)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}
