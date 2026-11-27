import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Offer } from '../../lib/growth';
import { glow, useTheme } from '../../lib/theme';

export type UserFilter =
  | 'all'
  | 'suspended'
  | 'trial'
  | 'pro'
  | 'free'
  | 'interested'
  | 'ending';

export type Interest = 'hot' | 'warm' | 'cold' | 'paying';

export type Overview = {
  users: number;
  newThisWeek: number;
  trial: number;
  pro: number;
  free: number;
  trialsEndingThisWeek: number;
  hot: number;
  warm: number;
  suspended: number;
  conversionRate: number;
  activeOffers: number;
  supportWaiting: number;
};

export type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  plan: 'trial' | 'pro' | 'free';
  trialEndsAt: string;
  proUntil: string | null;
  product: string | null;
  suspended: boolean;
  suspendedAt: string | null;
  paywallViews: number;
  subscribeTaps: number;
  lastInterestAt: string | null;
  interest: Interest;
};

export type AdminUserDetail = AdminUser & {
  events: { type: string; plan: string | null; createdAt: string }[];
};

export type Thread = {
  userId: string;
  email: string | null;
  name: string | null;
  lastSender: 'user' | 'support';
  topic: string | null;
  lastMessage: string;
  lastAt: string;
  count: number;
};

export type { Offer };

export type Finance = {
  months: {
    month: string;
    revenue: number;
    appleFee: number;
    costs: number;
    profit: number;
    signups: number;
  }[];
  mrr: number;
  monthlyCosts: number;
  revenueAllTime: number;
};

export const aed = (n: number) =>
  `AED ${n.toLocaleString('en-AE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

/** "2026-11" → "Nov" */
export const monthShort = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-AE', { month: 'short' });
};

export const displayName = (u: { name: string | null; email: string | null }) =>
  u.name || u.email || 'Unknown user';

export function timeAgo(iso: string | null, now = Date.now()) {
  if (!iso) return '—';
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.muted }]}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      {children}
    </View>
  );
}

export function StatTile({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value: string | number;
  color?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: t.card, borderColor: t.border },
        pressed && { backgroundColor: t.cardHi },
      ]}
    >
      <Text numberOfLines={1} style={[styles.tileLabel, { color: t.muted }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.tileValue, { color: color ?? t.text }]}
      >
        {value}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[
        styles.chip,
        {
          backgroundColor: on ? t.accent : t.cardHi,
          borderColor: on ? t.accent : t.border,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: on ? t.onAccent : t.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  color,
  busy,
  outline,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  busy?: boolean;
  outline?: boolean;
}) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        outline
          ? { borderColor: c, borderWidth: 1.5 }
          : [{ backgroundColor: c }, glow(c, 8)],
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={outline ? c : t.onAccent} />
      ) : (
        <Text style={[styles.buttonText, { color: outline ? c : t.onAccent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Plan or interest as a small colored label. */
export function Badge({
  kind,
}: {
  kind: AdminUser['plan'] | Interest | 'suspended';
}) {
  const t = useTheme();
  const look: Record<string, { text: string; color: string }> = {
    trial: { text: 'Trial', color: t.accent },
    pro: { text: 'Pro', color: t.success },
    free: { text: 'Free', color: t.muted },
    hot: { text: '🔥 Hot', color: t.danger },
    warm: { text: 'Warm', color: t.warning },
    cold: { text: 'Cold', color: t.muted },
    paying: { text: 'Paying', color: t.success },
    suspended: { text: 'Suspended', color: t.danger },
  };
  const { text, color } = look[kind];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function offerStatus(offer: Offer, now = Date.now()) {
  if (!offer.active) return 'Ended';
  if (Date.parse(offer.endsAt) <= now) return 'Expired';
  if (Date.parse(offer.startsAt) > now) return 'Scheduled';
  return 'Running';
}

export const AUDIENCE_LABEL: Record<Offer['audience'], string> = {
  all: 'Everyone',
  trial: 'Trial users',
  free: 'Free users',
  user: 'One user',
};

export const PLAN_LABEL: Record<Offer['plan'], string> = {
  all: 'All plans',
  pro_yearly: 'Yearly',
  pro_monthly: 'Monthly',
};

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 32 },
  gap8: { gap: 8 },
  gap10: { gap: 10 },
  gap16: { gap: 16 },
  mt6: { marginTop: 6 },
  mt10: { marginTop: 10 },
  mt20: { marginTop: 20 },
  shrink: { flexShrink: 1 },
  wrap: { flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
  bigTitle: { fontSize: 20 },
  small: { fontSize: 11 },
  strong: { fontWeight: '800' },
  relaxed: { lineHeight: 19 },
  multiline: { minHeight: 80 },
  borderless: { borderWidth: 0 },
  padded: { padding: 16 },
  header: { padding: 16, paddingBottom: 8, gap: 10 },
  list: { padding: 16, paddingTop: 4, gap: 8 },
  screen: { padding: 16, paddingBottom: 48 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tileValue: { fontSize: 22, fontWeight: '900', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  button: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '800' },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 13 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 14 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
});
