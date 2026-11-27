import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import { discounted } from '../../lib/growth';
import { PLANS } from '../../lib/subscription';
import { useTheme } from '../../lib/theme';
import {
  AUDIENCE_LABEL,
  Button,
  Card,
  Chip,
  type Offer,
  PLAN_LABEL,
  SectionTitle,
  styles,
} from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminOfferNew'>;

const DISCOUNTS = [10, 20, 30, 40, 50];
const DURATIONS: [number, string][] = [
  [24, '24 hours'],
  [72, '3 days'],
  [168, '7 days'],
  [336, '14 days'],
];

/** A new limited-time offer: who gets it, how much off, for how long. */
export default function AdminOfferNewScreen({ navigation, route }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const personal = route.params?.audience === 'user' && route.params.userId;
  const [audience, setAudience] = useState<Offer['audience']>(
    route.params?.audience ?? 'trial',
  );
  const [discount, setDiscount] = useState(30);
  const [plan, setPlan] = useState<Offer['plan']>('pro_yearly');
  const [hours, setHours] = useState(72);
  const [title, setTitle] = useState(
    personal ? 'A special offer for you' : 'Limited-time offer',
  );
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim()) {
      Alert.alert('Give the offer a title');
      return;
    }
    setBusy(true);
    try {
      await authedRequest('/admin/offers', {
        body: {
          title: title.trim(),
          message: message.trim() || undefined,
          discountPercent: discount,
          plan,
          audience,
          userId: personal ? route.params!.userId : undefined,
          durationHours: hours,
          notify,
        },
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not create the offer', String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = PLANS.filter(p => plan === 'all' || p.id === plan);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <SectionTitle>Who gets it</SectionTitle>
      {personal ? (
        <Card>
          <Text style={[styles.title, { color: t.text }]}>
            Only {route.params?.userName}
          </Text>
        </Card>
      ) : (
        <View style={styles.chips}>
          {(['trial', 'free', 'all'] as const).map(a => (
            <Chip
              key={a}
              label={AUDIENCE_LABEL[a]}
              on={audience === a}
              onPress={() => setAudience(a)}
            />
          ))}
        </View>
      )}

      <SectionTitle>Discount</SectionTitle>
      <View style={styles.chips}>
        {DISCOUNTS.map(d => (
          <Chip
            key={d}
            label={`${d}% off`}
            on={discount === d}
            onPress={() => setDiscount(d)}
          />
        ))}
      </View>

      <SectionTitle>On which plan</SectionTitle>
      <View style={styles.chips}>
        {(['pro_yearly', 'pro_monthly', 'all'] as const).map(p => (
          <Chip
            key={p}
            label={PLAN_LABEL[p]}
            on={plan === p}
            onPress={() => setPlan(p)}
          />
        ))}
      </View>

      <SectionTitle>Runs for</SectionTitle>
      <View style={styles.chips}>
        {DURATIONS.map(([h, label]) => (
          <Chip
            key={h}
            label={label}
            on={hours === h}
            onPress={() => setHours(h)}
          />
        ))}
      </View>

      <SectionTitle>Title</SectionTitle>
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={80}
        style={[styles.input, { backgroundColor: t.card, color: t.text }]}
      />
      <SectionTitle>Message (optional)</SectionTitle>
      <TextInput
        value={message}
        onChangeText={setMessage}
        maxLength={300}
        multiline
        placeholder="e.g. Your trial is ending soon. Keep auto-logging for less."
        placeholderTextColor={t.muted}
        style={[
          styles.input,
          styles.multiline,
          { backgroundColor: t.card, color: t.text },
        ]}
      />

      <SectionTitle>Preview</SectionTitle>
      <View
        style={[styles.card, styles.borderless, { backgroundColor: t.success }]}
      >
        <Text style={[styles.title, { color: t.onAccent }]}>
          🎁 {title || 'Offer'} · {discount}% off
        </Text>
        {message ? (
          <Text style={[styles.meta, { color: t.onAccent }]}>{message}</Text>
        ) : null}
        {shown.map(p => (
          <Text key={p.id} style={[styles.meta, { color: t.onAccent }]}>
            {p.title}: {discounted(p.amount, discount)} instead of {p.price}
          </Text>
        ))}
      </View>

      <SectionTitle>Notification</SectionTitle>
      <View style={styles.chips}>
        <Chip
          label="🔔 Notify them now"
          on={notify}
          onPress={() => setNotify(true)}
        />
        <Chip
          label="Show quietly"
          on={!notify}
          onPress={() => setNotify(false)}
        />
      </View>

      <View style={styles.mt20}>
        <Button label="Start offer" busy={busy} onPress={create} />
      </View>
      <Text style={[styles.meta, styles.mt10, { color: t.muted }]}>
        It shows on Home and on the plans screen with a countdown, and ends by
        itself. Real App Store prices follow once subscriptions are connected.
      </Text>
    </ScrollView>
  );
}
