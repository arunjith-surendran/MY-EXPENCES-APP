import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import { config } from '../config';
import {
  discounted,
  offerApplies,
  timeLeft,
  useCurrentOffer,
  useNow,
  useTrack,
} from '../lib/growth';
import {
  PLANS,
  PRO_FEATURES,
  type PlanId,
  useSubscription,
} from '../lib/subscription';
import { glow, useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;

/** The Pro plans. Purchases go through the App Store (connected via RevenueCat). */
export default function PaywallScreen({ navigation }: Props) {
  const t = useTheme();
  const { plan, trialDaysLeft } = useSubscription();
  const [selected, setSelected] = useState<PlanId>('pro_yearly');
  const chosen = PLANS.find(p => p.id === selected) ?? PLANS[0];
  const offer = useCurrentOffer();
  const now = useNow(1000);
  const track = useTrack();
  const priceOf = (p: (typeof PLANS)[number]) =>
    offerApplies(offer, p.id)
      ? discounted(p.amount, offer!.discountPercent)
      : p.price;

  // Interest for the admin side: who opens the plans, picks one, taps Subscribe.
  useEffect(() => {
    track('paywall_view');
  }, [track]);
  const pick = (id: PlanId) => {
    setSelected(id);
    track('plan_select', { plan: id });
  };

  // TODO: buy through RevenueCat once the App Store products exist (needs the paid Apple Developer Program).
  // An offer maps to an App Store promotional offer with the same discount.
  const subscribe = () => {
    track('subscribe_tap', { plan: selected, offerId: offer?.id });
    Alert.alert(
      'Coming soon',
      'Subscriptions open with the App Store release. Until then you keep full access during your free trial.',
    );
  };
  const restore = () =>
    Alert.alert(
      'Coming soon',
      'Restoring purchases opens with the App Store release.',
    );

  const status =
    plan === 'pro'
      ? "You're on Pro. Thank you!"
      : plan === 'trial'
      ? `Free trial: ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
      : 'Your free trial has ended';

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.kicker, { color: t.accent }]}>EXPENCES PRO</Text>
      <Text style={[styles.title, { color: t.text }]}>
        Your spending, tracked for you
      </Text>
      <View
        style={[
          styles.status,
          {
            backgroundColor: plan === 'free' ? t.cardHi : t.accentSoft,
          },
        ]}
      >
        <Text
          style={[
            styles.statusText,
            { color: plan === 'free' ? t.warning : t.accent },
          ]}
        >
          {status}
        </Text>
      </View>

      {offer && (
        <View
          style={[
            styles.offer,
            { backgroundColor: t.success },
            glow(t.success, 12),
          ]}
        >
          <Text style={[styles.offerTitle, { color: t.onAccent }]}>
            🎁 {offer.title} · {offer.discountPercent}% off
          </Text>
          {offer.message ? (
            <Text style={[styles.offerText, { color: t.onAccent }]}>
              {offer.message}
            </Text>
          ) : null}
          <Text style={[styles.offerEnds, { color: t.onAccent }]}>
            Ends in {timeLeft(offer.endsAt, now)}
          </Text>
        </View>
      )}

      <View style={styles.features}>
        {PRO_FEATURES.map(f => (
          <View key={f} style={styles.feature}>
            <Text style={[styles.check, { color: t.success }]}>✓</Text>
            <Text style={[styles.featureText, { color: t.text }]}>{f}</Text>
          </View>
        ))}
      </View>

      {PLANS.map(p => {
        const on = p.id === selected;
        return (
          <Pressable
            key={p.id}
            onPress={() => pick(p.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={[
              styles.plan,
              {
                backgroundColor: t.card,
                borderColor: on ? t.accent : t.border,
              },
              on && styles.planOn,
              on && glow(t.accent, 10),
            ]}
          >
            <View
              style={[styles.radio, { borderColor: on ? t.accent : t.muted }]}
            >
              {on && (
                <View
                  style={[styles.radioDot, { backgroundColor: t.accent }]}
                />
              )}
            </View>
            <View style={styles.planInfo}>
              <View style={styles.planHead}>
                <Text style={[styles.planTitle, { color: t.text }]}>
                  {p.title}
                </Text>
                {p.badge && (
                  <View style={[styles.badge, { backgroundColor: t.success }]}>
                    <Text style={[styles.badgeText, { color: t.onAccent }]}>
                      {p.badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.planNote, { color: t.muted }]}>
                {p.note}
              </Text>
            </View>
            <View style={styles.priceBox}>
              {offerApplies(offer, p.id) && (
                <Text style={[styles.oldPrice, { color: t.muted }]}>
                  {p.price}
                </Text>
              )}
              <Text
                style={[
                  styles.price,
                  { color: offerApplies(offer, p.id) ? t.success : t.text },
                ]}
              >
                {priceOf(p)}
                <Text style={[styles.period, { color: t.muted }]}>
                  {' '}
                  / {p.period}
                </Text>
              </Text>
            </View>
          </Pressable>
        );
      })}

      {plan !== 'pro' && (
        <Pressable
          onPress={subscribe}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
            glow(t.accent, 14),
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.ctaText, { color: t.onAccent }]}>
            Subscribe for {priceOf(chosen)} / {chosen.period}
          </Text>
        </Pressable>
      )}

      <Text style={[styles.fine, { color: t.muted }]}>
        Renews automatically until cancelled. Cancel anytime in Settings → Apple
        ID → Subscriptions. Adding expenses by hand, all the expenses you've
        recorded and CSV export stay free.
      </Text>

      <View style={styles.links}>
        <Pressable onPress={restore} hitSlop={8}>
          <Text style={[styles.link, { color: t.accent }]}>
            Restore purchases
          </Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(config.termsUrl)} hitSlop={8}>
          <Text style={[styles.link, { color: t.accent }]}>Terms</Text>
        </Pressable>
        <Pressable
          onPress={() => Linking.openURL(config.privacyPolicyUrl)}
          hitSlop={8}
        >
          <Text style={[styles.link, { color: t.accent }]}>Privacy</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={8}
        style={styles.later}
      >
        <Text style={[styles.link, { color: t.muted }]}>Not now</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  kicker: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 26, fontWeight: '900', marginTop: 6 },
  status: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusText: { fontSize: 13, fontWeight: '800' },
  features: { marginTop: 20, marginBottom: 12, gap: 10 },
  feature: { flexDirection: 'row', gap: 10 },
  check: { fontSize: 16, fontWeight: '900' },
  featureText: { flex: 1, fontSize: 15, lineHeight: 21 },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  planOn: { borderWidth: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  planInfo: { flex: 1 },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  planTitle: { fontSize: 17, fontWeight: '800' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '900' },
  planNote: { fontSize: 13, marginTop: 2 },
  priceBox: { alignItems: 'flex-end' },
  oldPrice: { fontSize: 12, textDecorationLine: 'line-through' },
  price: { fontSize: 16, fontWeight: '900' },
  offer: { marginTop: 16, padding: 16, borderRadius: 18 },
  offerTitle: { fontSize: 17, fontWeight: '900' },
  offerText: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  offerEnds: { fontSize: 13, fontWeight: '800', marginTop: 8 },
  period: { fontSize: 12, fontWeight: '600' },
  cta: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '900' },
  fine: { fontSize: 12, lineHeight: 17, marginTop: 14, textAlign: 'center' },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 16,
  },
  link: { fontSize: 13, fontWeight: '700' },
  later: { alignSelf: 'center', marginTop: 18 },
});
