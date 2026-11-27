import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MonthSummary } from '../lib/db';
import { monthKey, shiftMonth } from '../lib/months';
import { formatMoney } from '../lib/parse';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { glow, useTheme } from '../lib/theme';

const CHART_HEIGHT = 130;
const MONTHS = 12;

/**
 * AED total per month for the last 12 months, as a single-series bar chart.
 * The current month is the primary blue, the rest slate. Tap a bar to read it, then "Open" to drill in.
 */
export default function MonthlyChart({
  summaries,
  salaryOf,
  onOpenMonth,
}: {
  summaries: MonthSummary[];
  salaryOf: (month: string) => number | null;
  onOpenMonth: (month: string) => void;
}) {
  const t = useTheme();
  const { money } = useSalaryPrivacy();
  const current = monthKey();
  const bars = useMemo(() => {
    const byKey = new Map(summaries.map(s => [s.month, s]));
    return Array.from({ length: MONTHS }, (_, i) => {
      const key = shiftMonth(current, i - (MONTHS - 1));
      return byKey.get(key) ?? { month: key, total: 0, count: 0 };
    });
  }, [summaries, current]);

  const hasSalary = bars.some(b => salaryOf(b.month) != null);
  const max = Math.max(
    ...bars.map(b => Math.max(b.total, salaryOf(b.month) ?? 0)),
    0,
  );
  const selSalary = (month: string) => salaryOf(month);
  const [picked, setPicked] = useState(current);
  const sel = bars.find(b => b.month === picked) ?? bars[MONTHS - 1];

  const label = (key: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-AE', opts);
  };

  return (
    <View>
      <View style={styles.readout}>
        <View style={styles.flex}>
          <Text style={[styles.readLabel, { color: t.muted }]}>
            {label(sel.month, { month: 'long', year: 'numeric' })} · {sel.count}{' '}
            expense(s)
          </Text>
          <Text style={[styles.readValue, { color: t.text }]}>
            {formatMoney(sel.total)}
          </Text>
          {selSalary(sel.month) != null && (
            <Text style={[styles.readLabel, { color: t.muted }]}>
              Salary {money(selSalary(sel.month) ?? 0)} ·{' '}
              {(selSalary(sel.month) ?? 0) >= sel.total ? 'Saved ' : 'Over '}
              {money(Math.abs((selSalary(sel.month) ?? 0) - sel.total))}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => onOpenMonth(sel.month)}
          hitSlop={8}
          style={[styles.open, { borderColor: t.accent }]}
        >
          <Text style={[styles.openText, { color: t.accent }]}>Open ›</Text>
        </Pressable>
      </View>

      <View style={[styles.plot, { borderBottomColor: t.border }]}>
        {bars.map(b => {
          const isSel = b.month === sel.month;
          const color = b.month === current ? t.accent : t.secondary;
          const h =
            b.total > 0
              ? Math.max((b.total / (max || 1)) * CHART_HEIGHT, 3)
              : 0;
          return (
            <Pressable
              key={b.month}
              onPress={() => setPicked(b.month)}
              style={styles.slot}
              accessibilityLabel={`${label(b.month, {
                month: 'long',
                year: 'numeric',
              })}: ${formatMoney(b.total)}, ${b.count} expenses`}
            >
              {salaryOf(b.month) != null && (
                <View
                  style={[
                    styles.salaryMark,
                    {
                      bottom:
                        ((salaryOf(b.month) ?? 0) / (max || 1)) * CHART_HEIGHT,
                      backgroundColor: t.success,
                    },
                  ]}
                />
              )}
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor: color,
                    opacity: isSel ? 1 : 0.6,
                  },
                  isSel && b.total > 0 && glow(color, 10),
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.axis}>
        {bars.map(b => (
          <Text
            key={b.month}
            style={[
              styles.tick,
              { color: b.month === sel.month ? t.text : t.muted },
            ]}
          >
            {label(b.month, { month: 'narrow' })}
          </Text>
        ))}
      </View>

      {hasSalary && (
        <View style={styles.legend}>
          <View style={[styles.legendBar, { backgroundColor: t.secondary }]} />
          <Text style={[styles.legendText, { color: t.muted }]}>Spent</Text>
          <View style={[styles.legendLine, { backgroundColor: t.success }]} />
          <Text style={[styles.legendText, { color: t.muted }]}>Salary</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  readLabel: { fontSize: 13, fontWeight: '600' },
  readValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  open: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openText: { fontWeight: '800' },
  plot: {
    height: CHART_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  salaryMark: {
    position: 'absolute',
    left: -2,
    right: -2,
    height: 2,
    zIndex: 1,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  legendBar: { width: 10, height: 10, borderRadius: 2 },
  legendLine: { width: 14, height: 2, marginLeft: 10 },
  legendText: { fontSize: 11, fontWeight: '600' },
  axis: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tick: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
});
