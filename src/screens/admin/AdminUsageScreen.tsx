import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '../../lib/auth/AuthContext';
import { useTheme } from '../../lib/theme';
import { Card, SectionTitle, StatTile, styles } from './ui';

type Adoption = {
  active7d: number;
  active30d: number;
  features: {
    feature: string;
    users7d: number;
    users30d: number;
    usersEver: number;
  }[];
};

const LABELS: Record<string, string> = {
  search: '🔍 Search',
  insights: '📊 Insights',
  budgets: '🎯 Budgets',
  recurring: '🔁 Recurring',
  goals: '🐷 Goals',
  debts: '🤝 Lent & borrowed',
  backup: '🛟 Backup',
  restore: '♻️ Restore',
  receipts: '📎 Receipts',
  split: '➗ Split',
  tags: '#️⃣ Tags',
  categories: '🏷️ Categories',
  statement_import: '🏦 Statement import',
  export: '📤 Export',
  trash: '🗑️ Recently deleted',
};

/**
 * Which features people use (from the app's daily, name-only reports): how many used
 * each in the last 7 and 30 days. No amounts or expenses are ever sent.
 */
export default function AdminUsageScreen() {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [data, setData] = useState<Adoption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      authedRequest<Adoption>('/admin/usage')
        .then(d => {
          setData(d);
          setError(null);
        })
        .catch(e => setError(e instanceof Error ? e.message : String(e))),
    [authedRequest],
  );
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!data) {
    return (
      <View style={[styles.screen, styles.flex, { backgroundColor: t.bg }]}>
        {error ? (
          <Text style={[styles.empty, { color: t.danger }]}>{error}</Text>
        ) : (
          <ActivityIndicator style={styles.loader} />
        )}
      </View>
    );
  }

  const top = Math.max(1, ...data.features.map(f => f.users30d));

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <View style={styles.tiles}>
        <StatTile
          label="Active 7 days"
          value={data.active7d}
          color={t.accent}
        />
        <StatTile label="Active 30 days" value={data.active30d} />
      </View>

      <SectionTitle>Features · people in the last 30 days</SectionTitle>
      <Card>
        {data.features.map(f => {
          const share = data.active30d ? f.users30d / data.active30d : 0;
          return (
            <View key={f.feature} style={s.row}>
              <View style={styles.between}>
                <Text style={[styles.meta, styles.strong, { color: t.text }]}>
                  {LABELS[f.feature] ?? f.feature}
                </Text>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {f.users30d} · {Math.round(share * 100)}% · 7d {f.users7d}
                </Text>
              </View>
              <View style={[s.track, { backgroundColor: t.cardHi }]}>
                <View
                  style={[
                    s.fill,
                    {
                      width: `${Math.max(1, (f.users30d / top) * 100)}%`,
                      backgroundColor: f.users30d ? t.accent : t.border,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
        <Text style={[styles.meta, styles.mt10, { color: t.muted }]}>
          Counted once a day per person. Only feature names are sent — never
          amounts, merchants or notes.
        </Text>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { gap: 6, marginBottom: 10 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
