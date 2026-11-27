import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import { useTheme } from '../../lib/theme';
import {
  type AdminUser,
  Badge,
  Chip,
  displayName,
  styles,
  timeAgo,
  type UserFilter,
} from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminUsers'>;

const FILTERS: [UserFilter, string][] = [
  ['all', 'All'],
  ['interested', '🔥 Interested'],
  ['ending', 'Trial ending'],
  ['trial', 'Trial'],
  ['pro', 'Pro'],
  ['free', 'Free'],
  ['suspended', 'Suspended'],
];

/** Every user, filterable by plan and by how close they are to paying. */
export default function AdminUsersScreen({ navigation, route }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [filter, setFilter] = useState<UserFilter>(
    route.params?.filter ?? 'all',
  );
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    const params = `filter=${filter}${
      query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''
    }`;
    return authedRequest<AdminUser[]>(`/admin/users?${params}`)
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [authedRequest, filter, query]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name or email"
          placeholderTextColor={t.muted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.input, { backgroundColor: t.card, color: t.text }]}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gap8}
        >
          {FILTERS.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              on={filter === value}
              onPress={() => setFilter(value)}
            />
          ))}
        </ScrollView>
      </View>

      {users == null ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={u => u.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load().finally(() => setRefreshing(false));
              }}
            />
          }
          ListHeaderComponent={
            <Text style={[styles.meta, { color: t.muted }]}>
              {users.length} user{users.length === 1 ? '' : 's'}
            </Text>
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.muted }]}>
              Nobody here yet.
            </Text>
          }
          renderItem={({ item: u }) => (
            <Pressable
              onPress={() => navigation.navigate('AdminUser', { id: u.id })}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: pressed ? t.cardHi : t.card,
                  borderColor: t.border,
                },
              ]}
            >
              <View style={styles.between}>
                <Text
                  numberOfLines={1}
                  style={[styles.title, styles.shrink, { color: t.text }]}
                >
                  {displayName(u)}
                </Text>
                <View style={styles.row}>
                  {u.suspended && <Badge kind="suspended" />}
                  <Badge kind={u.plan} />
                  {u.interest !== 'paying' && u.interest !== 'cold' && (
                    <Badge kind={u.interest} />
                  )}
                </View>
              </View>
              {u.name && u.email ? (
                <Text
                  numberOfLines={1}
                  style={[styles.meta, { color: t.muted }]}
                >
                  {u.email}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: t.muted }]}>
                {u.plan === 'trial'
                  ? `Trial ends ${new Date(u.trialEndsAt).toLocaleDateString(
                      'en-AE',
                      { day: 'numeric', month: 'short' },
                    )}`
                  : u.plan === 'pro' && u.proUntil
                  ? `Pro until ${new Date(u.proUntil).toLocaleDateString(
                      'en-AE',
                      { day: 'numeric', month: 'short', year: 'numeric' },
                    )}`
                  : `Joined ${timeAgo(u.createdAt)}`}
                {u.paywallViews > 0 && `  ·  viewed plans ${u.paywallViews}×`}
                {u.subscribeTaps > 0 && `  ·  tapped Subscribe`}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
