import { Pressable, StyleSheet, Text, View } from 'react-native';

import { monthKey } from '../lib/months';
import { formatMoney } from '../lib/parse';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { useSubscription } from '../lib/subscription';
import { cardShadow, glow, useTheme } from '../lib/theme';
import EyeToggle from './EyeToggle';
import ProLock from './ProLock';

/**
 * Salary vs spending for one month: progress bar, money left, safe-to-spend per day
 * (current month only) and savings rate. Without a salary it shows a prompt to add one.
 * Every figure that would give the salary away is masked until revealed with Face ID.
 */
export default function BudgetCard({
  month,
  spent,
  salary,
  onEditSalary,
}: {
  month: string;
  spent: number;
  salary: number | null;
  onEditSalary: () => void;
}) {
  const t = useTheme();
  const { hidden, money } = useSalaryPrivacy();
  const { hasPro } = useSubscription();

  if (!hasPro) {
    return (
      <ProLock
        title="Salary budget"
        body="See how much is left, what you can safely spend per day, and how much you save."
      />
    );
  }

  if (salary == null || salary <= 0) {
    return (
      <Pressable
        onPress={onEditSalary}
        style={[
          styles.card,
          styles.cta,
          { backgroundColor: t.card, borderColor: t.success },
          glow(t.success, 8),
        ]}
      >
        <Text style={[styles.ctaTitle, { color: t.success }]}>
          + Add your salary
        </Text>
        <Text style={[styles.sub, { color: t.muted }]}>
          See how much is left, what you can safely spend per day, and how much
          you save.
        </Text>
      </Pressable>
    );
  }

  const left = salary - spent;
  const over = left < 0;
  const used = spent / salary;
  // Status bands: on track / getting close / over budget, always paired with a text label.
  const status =
    used >= 1
      ? { color: t.danger, text: 'Over budget' }
      : used >= 0.8
      ? { color: t.warning, text: 'Getting close' }
      : { color: t.success, text: 'On track' };

  const isCurrent = month === monthKey();
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = isCurrent ? daysInMonth - new Date().getDate() + 1 : 0;
  const savedPct = Math.round((left / salary) * 100);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.card, borderColor: t.border },
        cardShadow(t),
      ]}
    >
      <View style={styles.row}>
        <View style={styles.title}>
          <Text style={[styles.label, { color: t.muted }]}>Salary budget</Text>
          <EyeToggle />
        </View>
        <Pressable onPress={onEditSalary} hitSlop={10}>
          <Text style={[styles.edit, { color: t.accent }]}>
            {money(salary)} · Edit
          </Text>
        </Pressable>
      </View>

      <View style={[styles.track, { backgroundColor: t.cardHi }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: status.color,
              width: `${Math.min(used, 1) * 100}%`,
            },
            glow(status.color, 8),
          ]}
        />
      </View>
      <View style={styles.row}>
        <Text style={[styles.sub, { color: status.color }]}>
          {status.text} · {hidden ? '••' : Math.round(used * 100)}% used
        </Text>
        <Text style={[styles.sub, { color: t.muted }]}>
          {formatMoney(spent)} spent
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat
          label={over ? 'Over by' : 'Left'}
          value={money(Math.abs(left))}
          color={over ? t.danger : t.success}
        />
        {isCurrent ? (
          <Stat
            label="Safe / day"
            value={over ? money(0) : money(left / daysLeft)}
            sub={`${daysLeft} day(s) left`}
            color={t.accent}
          />
        ) : (
          <Stat
            label={over ? 'Overspent' : 'Saved'}
            value={money(Math.abs(left))}
            color={over ? t.danger : t.accent}
          />
        )}
        <Stat
          label="Savings rate"
          value={hidden ? '••%' : `${savedPct}%`}
          color={
            savedPct >= 20 ? t.success : savedPct >= 0 ? t.warning : t.danger
          }
        />
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { borderColor: t.border }]}>
      <Text numberOfLines={1} style={[styles.statLabel, { color: t.muted }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.statValue, { color }]}
      >
        {value}
      </Text>
      {sub ? (
        <Text numberOfLines={1} style={[styles.statSub, { color: t.muted }]}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cta: { borderWidth: 1 },
  ctaTitle: { fontSize: 17, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  edit: { fontSize: 13, fontWeight: '800' },
  track: { height: 10, borderRadius: 5, marginTop: 14, marginBottom: 8 },
  fill: { height: 10, borderRadius: 5 },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  statSub: { fontSize: 10, marginTop: 1 },
});
