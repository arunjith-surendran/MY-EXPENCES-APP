import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import { glow, useTheme } from '../../lib/theme';
import { BarChart, PartsBar, seriesColors } from './charts';
import {
  aed,
  Button,
  Card,
  type Finance,
  monthShort,
  type Overview,
  SectionTitle,
  StatTile,
  styles,
  type UserFilter,
} from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminHome'>;

/** The owner's dashboard: money in and out, who pays, who is close to paying, what to do next. */
export default function AdminHomeScreen({ navigation }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [money, setMoney] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        authedRequest<Overview>('/admin/overview'),
        authedRequest<Finance>('/admin/finance'),
      ])
        .then(([overview, finance]) => {
          setData(overview);
          setMoney(finance);
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

  if (!data || !money) {
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

  const users = (filter: UserFilter) =>
    navigation.navigate('AdminUsers', { filter });
  const colors = seriesColors(t);
  const labels = money.months.map(m => monthShort(m.month));
  const thisMonth = money.months[money.months.length - 1];
  const inProfit = thisMonth.profit >= 0;

  // What to do next to win more subscribers, from the numbers.
  const actions: { text: string; button: string; go: () => void }[] = [];
  if (data.hot > 0) {
    actions.push({
      text: `${data.hot} hot lead${
        data.hot === 1 ? '' : 's'
      }: opened the plans often or tapped Subscribe. A personal offer can tip them over.`,
      button: 'See hot leads',
      go: () => users('interested'),
    });
  }
  if (data.trialsEndingThisWeek > 0) {
    actions.push({
      text: `${data.trialsEndingThisWeek} trial${
        data.trialsEndingThisWeek === 1 ? ' ends' : 's end'
      } this week. A limited-time discount converts best right before the end.`,
      button: 'Offer for trial users',
      go: () => navigation.navigate('AdminOfferNew', { audience: 'trial' }),
    });
  }
  if (data.free > 0) {
    actions.push({
      text: `${data.free} user${
        data.free === 1 ? ' is' : 's are'
      } on Free after the trial. Win them back with a bigger, short offer.`,
      button: 'Offer for free users',
      go: () => navigation.navigate('AdminOfferNew', { audience: 'free' }),
    });
  }
  if (data.supportWaiting > 0) {
    actions.push({
      text: `${data.supportWaiting} chat${
        data.supportWaiting === 1 ? ' is' : 's are'
      } waiting for a reply. Fast answers keep people subscribed.`,
      button: 'Open inbox',
      go: () => navigation.navigate('AdminInbox'),
    });
  }
  if (money.monthlyCosts === 0) {
    actions.push({
      text: 'Add your running costs (hosting, Apple Developer fee) to see real profit or loss.',
      button: 'Add costs',
      go: () => navigation.navigate('AdminFinance'),
    });
  }

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
      {/* Headline: this month's result. */}
      <View style={[s.hero, { backgroundColor: t.accent }, glow(t.accent, 16)]}>
        <Text style={[s.heroLabel, { color: t.onAccent }]}>
          {monthShort(thisMonth.month)} · {inProfit ? 'Profit' : 'Loss'}
        </Text>
        <Text style={[s.heroValue, { color: t.onAccent }]}>
          {inProfit ? '▲ ' : '▼ '}
          {aed(Math.abs(thisMonth.profit))}
        </Text>
        <View style={s.heroRow}>
          <HeroStat label="Revenue" value={aed(thisMonth.revenue)} />
          <HeroStat label="Costs" value={aed(thisMonth.costs)} />
          <HeroStat label="Est. MRR" value={aed(money.mrr)} />
        </View>
      </View>

      <SectionTitle>Revenue vs costs (6 months)</SectionTitle>
      <Card>
        <BarChart
          labels={labels}
          format={aed}
          series={[
            {
              name: 'Revenue',
              color: colors[0],
              values: money.months.map(m => m.revenue),
            },
            {
              name: 'Costs',
              color: colors[1],
              values: money.months.map(m => m.costs + m.appleFee),
            },
          ]}
        />
      </Card>

      <SectionTitle>Profit / loss</SectionTitle>
      <Card>
        <BarChart
          labels={labels}
          format={n => `${n < 0 ? '−' : '+'}${aed(Math.abs(n))}`}
          colorFor={v => (v < 0 ? t.danger : t.success)}
          series={[
            {
              name: 'Profit',
              color: t.success,
              values: money.months.map(m => m.profit),
            },
          ]}
        />
        <Text style={[styles.meta, { color: t.muted }]}>
          Green is profit, red is loss: revenue minus Apple's 15% and your
          running costs.
        </Text>
      </Card>

      <SectionTitle>Users</SectionTitle>
      <Card>
        <PartsBar
          parts={[
            { name: 'Paying', value: data.pro, color: colors[0] },
            { name: 'Trial', value: data.trial, color: colors[1] },
            { name: 'Free', value: data.free, color: colors[2] },
          ]}
        />
        <View style={s.divider} />
        <BarChart
          labels={labels}
          format={n => `${n} new`}
          series={[
            {
              name: 'Sign-ups',
              color: colors[0],
              values: money.months.map(m => m.signups),
            },
          ]}
        />
      </Card>

      <View style={[styles.tiles, styles.mt10]}>
        <StatTile
          label="Conversion"
          value={`${Math.round(data.conversionRate * 100)}%`}
          color={t.success}
        />
        <StatTile
          label="🔥 Hot"
          value={data.hot}
          color={t.danger}
          onPress={() => users('interested')}
        />
        <StatTile
          label="Warm"
          value={data.warm}
          color={t.warning}
          onPress={() => users('interested')}
        />
        <StatTile
          label="Trial ends 7d"
          value={data.trialsEndingThisWeek}
          onPress={() => users('ending')}
        />
        <StatTile
          label="New (7d)"
          value={data.newThisWeek}
          onPress={() => users('all')}
        />
        <StatTile
          label="Suspended"
          value={data.suspended}
          color={data.suspended ? t.danger : undefined}
          onPress={() => users('suspended')}
        />
      </View>

      {actions.length > 0 && (
        <>
          <SectionTitle>Suggested next steps</SectionTitle>
          <View style={styles.gap10}>
            {actions.map(a => (
              <Card key={a.button}>
                <Text style={[styles.meta, styles.relaxed, { color: t.text }]}>
                  {a.text}
                </Text>
                <View style={styles.mt6}>
                  <Button label={a.button} onPress={a.go} />
                </View>
              </Card>
            ))}
          </View>
        </>
      )}

      <SectionTitle>Manage</SectionTitle>
      <View style={s.grid}>
        <Tile
          icon="👥"
          label="Users"
          value={`${data.users} total`}
          onPress={() => users('all')}
        />
        <Tile
          icon="🎁"
          label="Offers"
          value={`${data.activeOffers} running`}
          onPress={() => navigation.navigate('AdminOffers')}
        />
        <Tile
          icon="💬"
          label="Support"
          value={
            data.supportWaiting > 0
              ? `${data.supportWaiting} waiting`
              : 'All answered'
          }
          alert={data.supportWaiting > 0}
          onPress={() => navigation.navigate('AdminInbox')}
        />
        <Tile
          icon="🔔"
          label="Notify"
          value="Send a message"
          onPress={() => navigation.navigate('AdminNotify')}
        />
        <Tile
          icon="💰"
          label="Money"
          value="Costs & payments"
          onPress={() => navigation.navigate('AdminFinance')}
        />
        <Tile
          icon="⬆️"
          label="App version"
          value="Force / suggest updates"
          onPress={() => navigation.navigate('AdminVersions')}
        />
      </View>
    </ScrollView>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={s.heroStat}>
      <Text style={[s.heroStatLabel, { color: t.onAccent }]}>{label}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[s.heroStatValue, { color: t.onAccent }]}
      >
        {value}
      </Text>
    </View>
  );
}

function Tile({
  icon,
  label,
  value,
  alert,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  alert?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.tile,
        {
          backgroundColor: pressed ? t.cardHi : t.card,
          borderColor: alert ? t.danger : t.border,
        },
      ]}
    >
      <Text style={s.tileIcon}>{icon}</Text>
      <Text style={[styles.title, { color: t.text }]}>{label}</Text>
      <Text style={[styles.meta, { color: alert ? t.danger : t.muted }]}>
        {value}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  hero: { padding: 20, borderRadius: 22 },
  heroLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.9,
  },
  heroValue: { fontSize: 34, fontWeight: '900', marginTop: 4 },
  heroRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  heroStat: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroStatLabel: { fontSize: 11, fontWeight: '700', opacity: 0.9 },
  heroStatValue: { fontSize: 15, fontWeight: '900', marginTop: 2 },
  divider: { height: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  tileIcon: { fontSize: 24, marginBottom: 6 },
});
