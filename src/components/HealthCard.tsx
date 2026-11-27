import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Health, HealthLevel } from '../lib/insights';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { glow, useTheme } from '../lib/theme';
import Gradient from './Gradient';

const RADIUS = 20;

const LOOK: Record<
  HealthLevel,
  { icon: string; tone: 'good' | 'warn' | 'bad' }
> = {
  great: { icon: '★', tone: 'good' },
  good: { icon: '✓', tone: 'good' },
  tight: { icon: '!', tone: 'warn' },
  critical: { icon: '!!', tone: 'bad' },
};

/**
 * The month's verdict: saving well, under control, or overspending. Color is always
 * paired with an icon and a title. Without a verdict yet it invites the user to add a salary.
 */
export default function HealthCard({
  health,
  onAddSalary,
}: {
  health: Health | null;
  onAddSalary: () => void;
}) {
  const t = useTheme();
  const { hidden } = useSalaryPrivacy();

  if (!health) {
    return (
      <Pressable
        onPress={onAddSalary}
        style={[
          styles.card,
          styles.empty,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Text style={[styles.title, { color: t.text }]}>
          How healthy is your spending?
        </Text>
        <Text style={[styles.detail, { color: t.muted }]}>
          Add your salary to see your savings rate and whether you're in
          control. ›
        </Text>
      </Pressable>
    );
  }

  const look = LOOK[health.level];
  const colors = t.gradients[look.tone];
  return (
    <View style={[styles.card, glow(colors[colors.length - 1], 16)]}>
      <Gradient colors={colors} radius={RADIUS} />
      <View style={styles.row}>
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { color: t.onAccent }]}>
            {look.icon}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text style={[styles.kicker, { color: t.onAccent }]}>
            Spending health
          </Text>
          <Text style={[styles.title, { color: t.onAccent }]}>
            {health.title}
          </Text>
        </View>
        {health.savingsRate != null && (
          <View style={styles.rate}>
            <Text style={[styles.rateValue, { color: t.onAccent }]}>
              {hidden ? '••%' : `${Math.round(health.savingsRate * 100)}%`}
            </Text>
            <Text style={[styles.kicker, { color: t.onAccent }]}>saved</Text>
          </View>
        )}
      </View>
      <Text style={[styles.detail, { color: t.onAccent }]}>
        {hidden && health.savingsRate != null
          ? 'Tap the eye on Salary budget to see the details.'
          : health.detail}
      </Text>
      {health.tip && (
        <View style={styles.tip}>
          <Text style={[styles.tipText, { color: t.onAccent }]}>
            💡 {health.tip}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginTop: 16, padding: 16, borderRadius: RADIUS },
  empty: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  badgeText: { fontSize: 17, fontWeight: '900' },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    opacity: 0.85,
  },
  title: { fontSize: 18, fontWeight: '800', marginTop: 1 },
  rate: { alignItems: 'flex-end' },
  rateValue: {
    fontSize: 24,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  detail: { fontSize: 14, fontWeight: '500', marginTop: 10, lineHeight: 20 },
  tip: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  tipText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
