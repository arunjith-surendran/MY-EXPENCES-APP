import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import Gradient from '../components/Gradient';
import { useAuth } from '../lib/auth/AuthContext';
import {
  markRead,
  syncTeamNotifications,
  type TeamNotification,
} from '../lib/notifications';
import { cardShadow, glow, useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Messages and offers from the Expences team, newest first. Opening it marks them read. */
export default function NotificationsScreen({ navigation }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [items, setItems] = useState<TeamNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { notifications } = await authedRequest<{
        notifications: TeamNotification[];
      }>('/notifications');
      setItems(notifications);
      setError(null);
      await syncTeamNotifications(notifications);
      await markRead(notifications);
    } catch (e) {
      setError(String(e));
      setItems(prev => prev ?? []);
    }
  }, [authedRequest]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (items == null) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={n => n.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        error ? (
          <Text style={[styles.meta, { color: t.danger }]}>
            Couldn't refresh: {error}
          </Text>
        ) : undefined
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: t.muted }]}>
          No messages yet. Offers and news from the Expences team show up here.
        </Text>
      }
      renderItem={({ item: n }) =>
        n.kind === 'offer' ? (
          <Pressable
            onPress={() => navigation.navigate('Paywall')}
            style={[styles.card, glow(t.gradients.good[1], 12)]}
            accessibilityRole="button"
          >
            <Gradient colors={t.gradients.good} radius={RADIUS} />
            <Text style={[styles.title, { color: t.onAccent }]}>{n.title}</Text>
            <Text style={[styles.body, { color: t.onAccent }]}>{n.body}</Text>
            <View style={styles.row}>
              <Text
                style={[styles.meta, styles.onGradient, { color: t.onAccent }]}
              >
                {when(n.createdAt)}
              </Text>
              <Text style={[styles.cta, { color: t.onAccent }]}>
                See plans ›
              </Text>
            </View>
          </Pressable>
        ) : (
          <View
            style={[
              styles.card,
              styles.plain,
              { backgroundColor: t.card, borderColor: t.border },
              cardShadow(t),
            ]}
          >
            <Text style={[styles.title, { color: t.text }]}>{n.title}</Text>
            <Text style={[styles.body, { color: t.text }]}>{n.body}</Text>
            <Text style={[styles.meta, { color: t.muted }]}>
              {when(n.createdAt)}
            </Text>
          </View>
        )
      }
    />
  );
}

const RADIUS = 18;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { padding: 16, borderRadius: RADIUS },
  plain: { borderWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  meta: { fontSize: 12, marginTop: 10 },
  onGradient: { opacity: 0.85 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cta: { fontSize: 14, fontWeight: '800', marginTop: 10 },
  empty: { textAlign: 'center', marginTop: 40, lineHeight: 20 },
});
