import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import { useTheme } from '../../lib/theme';
import { displayName, styles, type Thread, timeAgo } from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminInbox'>;

/** Every help chat, newest first; the ones waiting for a reply are marked. */
export default function AdminInboxScreen({ navigation }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      authedRequest<Thread[]>('/admin/support')
        .then(setThreads)
        .catch(() => setThreads([])),
    [authedRequest],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!threads) return <ActivityIndicator style={styles.loader} />;

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      data={threads}
      keyExtractor={th => th.userId}
      contentContainerStyle={[styles.screen, styles.gap8]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load().finally(() => setRefreshing(false));
          }}
        />
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: t.muted }]}>No messages yet.</Text>
      }
      renderItem={({ item: th }) => {
        const waiting = th.lastSender === 'user';
        return (
          <Pressable
            onPress={() =>
              navigation.navigate('AdminChat', {
                userId: th.userId,
                name: displayName(th),
              })
            }
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: pressed ? t.cardHi : t.card,
                borderColor: waiting ? t.danger : t.border,
              },
            ]}
          >
            <View style={styles.between}>
              <Text
                numberOfLines={1}
                style={[styles.title, styles.shrink, { color: t.text }]}
              >
                {waiting ? '● ' : ''}
                {displayName(th)}
              </Text>
              <Text style={[styles.meta, { color: t.muted }]}>
                {timeAgo(th.lastAt)}
              </Text>
            </View>
            <Text numberOfLines={2} style={[styles.meta, { color: t.muted }]}>
              {th.lastSender === 'support' ? 'You: ' : ''}
              {th.lastMessage || '📷 Photo'}
            </Text>
            <Text style={[styles.meta, styles.small, { color: t.muted }]}>
              {th.topic ? `${th.topic} · ` : ''}
              {th.count} message{th.count === 1 ? '' : 's'}
              {waiting ? ' · waiting for reply' : ''}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
