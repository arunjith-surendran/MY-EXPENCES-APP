import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import { timeLeft, useNow } from '../../lib/growth';
import { useTheme } from '../../lib/theme';
import {
  AUDIENCE_LABEL,
  Button,
  type Offer,
  offerStatus,
  PLAN_LABEL,
  shortDate,
  styles,
} from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminOffers'>;

/** Limited-time offers: what's running, what ended, and a way to start a new one. */
export default function AdminOffersScreen({ navigation }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const now = useNow(60_000);

  const load = useCallback(() => {
    authedRequest<Offer[]>('/admin/offers')
      .then(setOffers)
      .catch(() => setOffers([]));
  }, [authedRequest]);

  useFocusEffect(load);

  useLayoutEffect(() => {
    navigation.setOptions({
      // React Navigation's documented pattern for header buttons.
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('AdminOfferNew', {})}
          hitSlop={10}
          accessibilityLabel="New offer"
        >
          <Text style={[styles.title, { color: t.accent }]}>+ New</Text>
        </Pressable>
      ),
    });
  }, [navigation, t.accent]);

  const end = (offer: Offer) =>
    Alert.alert(
      `End "${offer.title}"?`,
      'It disappears from the app at once.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End offer',
          style: 'destructive',
          onPress: () =>
            authedRequest(`/admin/offers/${offer.id}/end`, { method: 'POST' })
              .then(load)
              .catch(e => Alert.alert('Could not end the offer', String(e))),
        },
      ],
    );

  if (!offers) return <ActivityIndicator style={styles.loader} />;

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      data={offers}
      keyExtractor={o => o.id}
      contentContainerStyle={[styles.screen, styles.gap10]}
      ListEmptyComponent={
        <View style={styles.gap16}>
          <Text style={[styles.empty, { color: t.muted }]}>
            No offers yet. A short, limited-time discount is one of the best
            ways to turn trial users into subscribers.
          </Text>
          <Button
            label="Create the first offer"
            onPress={() => navigation.navigate('AdminOfferNew', {})}
          />
        </View>
      }
      renderItem={({ item: o }) => {
        const status = offerStatus(o, now);
        const running = status === 'Running';
        return (
          <View
            style={[
              styles.card,
              {
                backgroundColor: t.card,
                borderColor: running ? t.success : t.border,
              },
            ]}
          >
            <View style={styles.between}>
              <Text style={[styles.title, styles.shrink, { color: t.text }]}>
                {o.title}
              </Text>
              <Text
                style={[
                  styles.meta,
                  styles.strong,
                  { color: running ? t.success : t.muted },
                ]}
              >
                {running ? `● ${timeLeft(o.endsAt, now)} left` : status}
              </Text>
            </View>
            <Text style={[styles.meta, { color: t.text }]}>
              {o.discountPercent}% off · {PLAN_LABEL[o.plan]} ·{' '}
              {AUDIENCE_LABEL[o.audience]}
            </Text>
            {o.message ? (
              <Text style={[styles.meta, { color: t.muted }]}>{o.message}</Text>
            ) : null}
            <Text style={[styles.meta, { color: t.muted }]}>
              {shortDate(o.startsAt)} → {shortDate(o.endsAt)}
            </Text>
            {running && (
              <View style={styles.mt6}>
                <Button
                  label="End now"
                  outline
                  color={t.danger}
                  onPress={() => end(o)}
                />
              </View>
            )}
          </View>
        );
      }}
    />
  );
}
