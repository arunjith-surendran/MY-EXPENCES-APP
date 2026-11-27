import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import { PLANS } from '../../lib/subscription';
import { useTheme } from '../../lib/theme';
import {
  type AdminUserDetail,
  Badge,
  Button,
  Card,
  displayName,
  SectionTitle,
  shortDate,
  styles,
  timeAgo,
} from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminUser'>;

const EVENT_LABEL: Record<string, string> = {
  paywall_view: 'Opened the plans',
  plan_select: 'Picked a plan',
  subscribe_tap: 'Tapped Subscribe',
  offer_view: 'Saw an offer',
};

const GIFTS: [number, string][] = [
  [7, '7 days'],
  [30, '1 month'],
  [365, '1 year'],
];

/** One user: plan, how interested they are, and ways to win them over. */
export default function AdminUserScreen({ navigation, route }: Props) {
  const t = useTheme();
  const { authedRequest, user: me } = useAuth();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const id = route.params.id;

  useFocusEffect(
    useCallback(() => {
      authedRequest<AdminUserDetail>(`/admin/users/${id}`)
        .then(setUser)
        .catch(e => Alert.alert('Could not load the user', String(e)));
    }, [authedRequest, id]),
  );

  if (!user) return <ActivityIndicator style={styles.loader} />;
  const name = displayName(user);

  const gift = (days: number, label: string) =>
    Alert.alert(
      `Gift ${label} of Pro?`,
      `${name} gets Pro right away, on top of any time they already have.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Gift',
          onPress: async () => {
            setBusy(days);
            try {
              setUser(
                await authedRequest<AdminUserDetail>(
                  `/admin/users/${id}/grant`,
                  { body: { days } },
                ),
              );
            } catch (e) {
              Alert.alert('Could not gift Pro', String(e));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );

  /** Confirms, then runs an admin action that returns the updated user. */
  const act = (
    key: string,
    title: string,
    message: string,
    path: string,
    body: object = {},
    destructive = false,
  ) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: destructive ? 'destructive' : 'default',
        onPress: async () => {
          setActing(key);
          try {
            setUser(
              await authedRequest<AdminUserDetail>(
                `/admin/users/${id}/${path}`,
                {
                  body,
                },
              ),
            );
          } catch (e) {
            Alert.alert('That didn’t work', String(e));
          } finally {
            setActing(null);
          }
        },
      },
    ]);

  const remove = () =>
    Alert.alert(
      `Delete ${name}'s account?`,
      'Their account, chats and offers are removed for good. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setActing('delete');
            try {
              await authedRequest(`/admin/users/${id}`, { method: 'DELETE' });
              navigation.goBack();
            } catch (e) {
              Alert.alert('Could not delete', String(e));
              setActing(null);
            }
          },
        },
      ],
    );

  const isMe = me?.id === user.id;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
    >
      <Card>
        <View style={styles.between}>
          <Text style={[styles.title, styles.bigTitle, { color: t.text }]}>
            {name}
          </Text>
          <View style={styles.row}>
            {user.suspended && <Badge kind="suspended" />}
            <Badge kind={user.plan} />
            <Badge kind={user.interest} />
          </View>
        </View>
        {user.email ? (
          <Text style={[styles.meta, { color: t.muted }]}>{user.email}</Text>
        ) : null}
        <Text style={[styles.meta, { color: t.muted }]}>
          Joined {shortDate(user.createdAt)}
        </Text>
        <Text style={[styles.meta, { color: t.text }]}>
          {user.plan === 'pro' && user.proUntil
            ? `Pro until ${shortDate(user.proUntil)}${
                user.product === 'gift' ? ' (gift)' : ''
              }`
            : user.plan === 'trial'
            ? `Trial ends ${shortDate(user.trialEndsAt)}`
            : `Trial ended ${shortDate(user.trialEndsAt)}`}
        </Text>
      </Card>

      <SectionTitle>Interest (last 14 days)</SectionTitle>
      <Card>
        <Text style={[styles.meta, { color: t.text }]}>
          Opened the plans {user.paywallViews}× · tapped Subscribe{' '}
          {user.subscribeTaps}×
        </Text>
        <Text style={[styles.meta, { color: t.muted }]}>
          Last seen on the plans: {timeAgo(user.lastInterestAt)}
        </Text>
      </Card>

      {user.plan !== 'pro' && (
        <>
          <SectionTitle>Win them over</SectionTitle>
          <Button
            label="Send a personal offer"
            onPress={() =>
              navigation.navigate('AdminOfferNew', {
                audience: 'user',
                userId: user.id,
                userName: name,
              })
            }
          />
        </>
      )}

      <SectionTitle>Gift Pro</SectionTitle>
      <View style={[styles.row, styles.wrap]}>
        {GIFTS.map(([days, label]) => (
          <View key={days} style={styles.grow}>
            <Button
              label={label}
              outline
              busy={busy === days}
              onPress={() => gift(days, label)}
            />
          </View>
        ))}
      </View>

      {user.plan !== 'pro' && (
        <>
          <SectionTitle>Extend free trial</SectionTitle>
          <View style={[styles.row, styles.wrap]}>
            {[7, 14].map(days => (
              <View key={days} style={styles.grow}>
                <Button
                  label={`+${days} days`}
                  outline
                  busy={acting === `trial-${days}`}
                  onPress={() =>
                    act(
                      `trial-${days}`,
                      `Give ${days} more trial days?`,
                      `${name} gets full access for ${days} more days${
                        user.plan === 'free' ? ', starting now' : ''
                      }.`,
                      'extend-trial',
                      { days },
                    )
                  }
                />
              </View>
            ))}
          </View>
        </>
      )}

      <SectionTitle>Record a payment</SectionTitle>
      <Text style={[styles.meta, { color: t.muted }]}>
        For money received outside the App Store (e.g. a bank transfer). It
        counts in revenue and gives the Pro period.
      </Text>
      <View style={[styles.row, styles.wrap, styles.mt6]}>
        {PLANS.map(p => (
          <View key={p.id} style={styles.grow}>
            <Button
              label={`${p.title} · ${p.price}`}
              outline
              color={t.success}
              busy={acting === p.id}
              onPress={() =>
                act(
                  p.id,
                  `Record ${p.price} from ${name}?`,
                  `Adds a ${p.title.toLowerCase()} payment and extends Pro.`,
                  'payments',
                  { product: p.id, amount: p.amount },
                )
              }
            />
          </View>
        ))}
      </View>

      <SectionTitle>Support</SectionTitle>
      <Button
        label="Send a notification"
        outline
        onPress={() =>
          navigation.navigate('AdminNotify', {
            userId: user.id,
            userName: name,
          })
        }
      />
      <View style={styles.mt10} />
      <Button
        label="Open chat"
        outline
        onPress={() =>
          navigation.navigate('AdminChat', { userId: user.id, name })
        }
      />

      <SectionTitle>Account control</SectionTitle>
      <View style={styles.gap8}>
        {user.plan === 'pro' && (
          <Button
            label="Revoke Pro now"
            outline
            color={t.warning}
            busy={acting === 'revoke'}
            onPress={() =>
              act(
                'revoke',
                'Revoke Pro?',
                `${name} loses Pro at once (use for refunds or mistaken gifts).`,
                'revoke-pro',
                {},
                true,
              )
            }
          />
        )}
        {isMe ? (
          <Text style={[styles.meta, { color: t.muted }]}>
            This is your own account: it can't be suspended or deleted here.
          </Text>
        ) : (
          <>
            {user.suspended ? (
              <Button
                label="Unsuspend account"
                color={t.success}
                busy={acting === 'unsuspend'}
                onPress={() =>
                  act(
                    'unsuspend',
                    `Unsuspend ${name}?`,
                    'They can sign in and use the app again.',
                    'unsuspend',
                  )
                }
              />
            ) : (
              <Button
                label="Suspend account"
                outline
                color={t.danger}
                busy={acting === 'suspend'}
                onPress={() =>
                  act(
                    'suspend',
                    `Suspend ${name}?`,
                    "They're signed out on every device and can't sign in until you unsuspend them. Their data is kept.",
                    'suspend',
                    {},
                    true,
                  )
                }
              />
            )}
            <Button
              label="Delete account"
              color={t.danger}
              busy={acting === 'delete'}
              onPress={remove}
            />
          </>
        )}
      </View>

      <SectionTitle>Activity</SectionTitle>
      <Card>
        {user.events.length === 0 ? (
          <Text style={[styles.meta, { color: t.muted }]}>
            Hasn't looked at the plans yet.
          </Text>
        ) : (
          user.events.map((e, i) => (
            <View key={i} style={styles.between}>
              <Text style={[styles.meta, { color: t.text }]}>
                {EVENT_LABEL[e.type] ?? e.type}
                {e.plan ? ` · ${e.plan.replace('pro_', '')}` : ''}
              </Text>
              <Text style={[styles.meta, { color: t.muted }]}>
                {timeAgo(e.createdAt)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}
