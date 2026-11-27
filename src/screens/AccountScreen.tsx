import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import { useAppLockSetting } from '../components/AppLock';
import Avatar from '../components/Avatar';
import { config } from '../config';
import { useAuth } from '../lib/auth/AuthContext';
import { CURRENCY_NAMES, useConversion } from '../lib/currency';
import { clearExpenses } from '../lib/db';
import { usePaymentNotifications } from '../lib/notifications';
import { useSubscription } from '../lib/subscription';
import { type ThemeMode, useTheme, useThemeMode } from '../lib/theme';

const PROVIDER_LABEL = {
  email: 'Email',
  google: 'Google',
  apple: 'Apple',
} as const;

const APPEARANCE: [ThemeMode, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** Profile, appearance, sign out and account deletion. */
export default function AccountScreen() {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();
  const { user, signOut, deleteAccount } = useAuth();
  const { plan, trialDaysLeft } = useSubscription();
  const lock = useAppLockSetting();
  const { currency } = useConversion();
  const paymentAlerts = usePaymentNotifications();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [busy, setBusy] = useState<'signOut' | 'delete' | null>(null);

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      'Your expenses stay on this phone. Sign in again to keep using the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setBusy('signOut');
            await signOut();
          },
        },
      ],
    );

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'Your account and every expense on this phone will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              await deleteAccount();
              await clearExpenses().catch(() => {});
            } catch (e) {
              setBusy(null);
              Alert.alert(
                'Could not delete your account',
                e instanceof Error ? e.message : String(e),
              );
            }
          },
        },
      ],
    );

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-AE', {
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <View
        style={[
          styles.profile,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Avatar user={user} size={64} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.name, { color: t.text }]}>
            {user?.name || 'Your account'}
          </Text>
          {user?.email ? (
            <Text numberOfLines={1} style={[styles.meta, { color: t.muted }]}>
              {user.email}
            </Text>
          ) : null}
          <View style={styles.chips}>
            {user?.linkedProviders.map(p => (
              <View
                key={p}
                style={[styles.chip, { backgroundColor: t.accentSoft }]}
              >
                <Text style={[styles.chipText, { color: t.accent }]}>
                  {PROVIDER_LABEL[p]}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      {memberSince && (
        <Text style={[styles.caption, { color: t.muted }]}>
          Member since {memberSince}
        </Text>
      )}

      <Text style={[styles.section, { color: t.muted }]}>Appearance</Text>
      <View style={[styles.segment, { backgroundColor: t.cardHi }]}>
        {APPEARANCE.map(([value, label]) => {
          const active = mode === value;
          return (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.segmentItem,
                active && {
                  backgroundColor: t.scheme === 'dark' ? t.border : t.card,
                },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? t.text : t.muted },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.section, { color: t.muted }]}>Your data</Text>
      <View
        style={[
          styles.group,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Row
          label="🛟 Backup & restore"
          onPress={() => navigation.navigate('Backup')}
        />
        <Row
          label="🏷️ Categories"
          onPress={() => navigation.navigate('Categories')}
          divider
        />
        <Row
          label="🎯 Budgets"
          onPress={() => navigation.navigate('Budgets')}
          divider
        />
        <Row
          label="🔁 Recurring payments"
          onPress={() => navigation.navigate('Recurring')}
          divider
        />
        <Row
          label="🗑️ Recently deleted"
          onPress={() => navigation.navigate('Trash')}
          divider
        />
      </View>
      <Text style={[styles.caption, { color: t.muted }]}>
        Everything stays on this phone. Save a backup now and then so you don't
        lose it if the app is removed.
      </Text>

      <Text style={[styles.section, { color: t.muted }]}>Currency</Text>
      <View
        style={[
          styles.group,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Row
          label="Also show spending in"
          value={
            currency
              ? [currency, CURRENCY_NAMES[currency]].filter(Boolean).join(' · ')
              : 'Off'
          }
          onPress={() => navigation.navigate('Currency')}
        />
      </View>
      <Text style={[styles.caption, { color: t.muted }]}>
        E.g. pick INR to see what you spend in rupees. Live rates, updated
        daily.
      </Text>

      <Text style={[styles.section, { color: t.muted }]}>
        Security & notifications
      </Text>
      <View
        style={[
          styles.group,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <SwitchRow
          label={`Unlock with ${lock.label}`}
          value={lock.enabled}
          disabled={!lock.available}
          onChange={lock.set}
        />
        <SwitchRow
          label="Notify me when a payment is saved"
          value={paymentAlerts.enabled}
          onChange={paymentAlerts.set}
          divider
        />
        <Row
          label="Notifications from Expences"
          divider
          onPress={() => navigation.navigate('Notifications')}
        />
      </View>
      <Text style={[styles.caption, { color: t.muted }]}>
        {lock.available
          ? `You stay signed in for a month at a time. ${lock.label} keeps the app private when you open it.`
          : 'Set a passcode on your iPhone to lock Expences with Face ID.'}
      </Text>

      {user?.isAdmin && (
        <>
          <Text style={[styles.section, { color: t.muted }]}>Owner</Text>
          <View
            style={[
              styles.group,
              { backgroundColor: t.card, borderColor: t.accent },
            ]}
          >
            <Row
              label="Admin dashboard"
              value="Users, offers, support"
              color={t.accent}
              onPress={() => navigation.navigate('AdminHome')}
            />
          </View>
        </>
      )}

      {/* After the free month the plans get their own, visible section. */}
      {plan === 'free' && (
        <>
          <Text style={[styles.section, { color: t.muted }]}>Subscription</Text>
          <View
            style={[
              styles.group,
              { backgroundColor: t.card, borderColor: t.accent },
            ]}
          >
            <Row
              label="Get Expences Pro"
              value="Trial ended"
              color={t.accent}
              onPress={() => navigation.navigate('Paywall')}
            />
          </View>
        </>
      )}

      <Text style={[styles.section, { color: t.muted }]}>Help</Text>
      <View
        style={[
          styles.group,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Row
          label="Chat with us"
          value="Complaints, ideas, bugs"
          color={t.accent}
          onPress={() => navigation.navigate('Support')}
        />
      </View>

      <Text style={[styles.section, { color: t.muted }]}>About</Text>
      <View
        style={[
          styles.group,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Row
          label="How your data is protected"
          color={t.accent}
          onPress={() => navigation.navigate('Privacy')}
        />
        <Row
          label="Privacy Policy"
          onPress={() => Linking.openURL(config.privacyPolicyUrl)}
          divider
        />
        <Row
          label="Terms of Service"
          onPress={() => Linking.openURL(config.termsUrl)}
          divider
        />
        {/* During the trial (and on Pro) the plan is just a quiet line here. */}
        {plan !== 'free' && (
          <Row
            label="Plan"
            value={
              plan === 'pro'
                ? 'Expences Pro'
                : `Free trial · ${trialDaysLeft} day${
                    trialDaysLeft === 1 ? '' : 's'
                  } left`
            }
            onPress={() => navigation.navigate('Paywall')}
            divider
          />
        )}
      </View>

      <Text style={[styles.section, { color: t.muted }]}>Account</Text>
      <View
        style={[
          styles.group,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Row
          label="Sign out"
          color={t.accent}
          busy={busy === 'signOut'}
          onPress={busy ? undefined : confirmSignOut}
        />
        <Row
          label="Delete account"
          color={t.danger}
          busy={busy === 'delete'}
          onPress={busy ? undefined : confirmDelete}
          divider
        />
      </View>
      <Text style={[styles.caption, { color: t.muted }]}>
        Expenses are stored only on this phone. Deleting your account also
        erases them.
      </Text>
    </ScrollView>
  );
}

function SwitchRow({
  label,
  value,
  disabled,
  divider,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  divider?: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.row,
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.border,
        },
      ]}
    >
      <Text style={[styles.rowText, styles.flexShrink, { color: t.text }]}>
        {label}
      </Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: t.accent }}
      />
    </View>
  );
}

function Row({
  label,
  value,
  color,
  busy,
  divider,
  onPress,
}: {
  label: string;
  /** Muted text before the chevron. */
  value?: string;
  color?: string;
  busy?: boolean;
  divider?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.border,
        },
        pressed && { backgroundColor: t.cardHi },
      ]}
    >
      <Text style={[styles.rowText, { color: color ?? t.text }]}>{label}</Text>
      {busy ? (
        <ActivityIndicator color={t.muted} />
      ) : (
        <View style={styles.rowEnd}>
          {value ? (
            <Text
              numberOfLines={1}
              style={[styles.rowValue, { color: t.muted }]}
            >
              {value}
            </Text>
          ) : null}
          <Text style={[styles.chevron, { color: t.muted }]}>›</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 19, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 2 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 12, fontWeight: '600' },
  caption: { fontSize: 12, marginTop: 8, marginHorizontal: 4, lineHeight: 17 },
  section: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 28,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  segment: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentText: { fontSize: 14, fontWeight: '600' },
  group: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 50,
  },
  rowText: { fontSize: 16, fontWeight: '500' },
  flexShrink: { flexShrink: 1, marginRight: 12 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rowValue: { fontSize: 14, flexShrink: 1 },
  chevron: { fontSize: 22, fontWeight: '300' },
});
