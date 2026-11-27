import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Expense } from '../lib/db';
import { monthKey } from '../lib/months';
import { formatMoney } from '../lib/parse';
import { glow, useTheme } from '../lib/theme';

const CHART_HEIGHT = 120;

/**
 * Daily AED spend for one month as a single-series bar chart built from Views.
 * One hue for every day, today highlighted in teal; tap a bar to read its value.
 */
export default function DailyChart({
  items,
  month,
}: {
  items: Expense[];
  month: string;
}) {
  const t = useTheme();
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = month === monthKey();
  const today = isCurrent ? new Date().getDate() : -1;

  const days = useMemo(() => {
    const totals = new Array<number>(daysInMonth).fill(0);
    const counts = new Array<number>(daysInMonth).fill(0);
    for (const e of items) {
      const i = new Date(e.created_at).getDate() - 1;
      counts[i] += 1;
      if (e.currency === 'AED') totals[i] += e.amount;
    }
    return { totals, counts };
  }, [items, daysInMonth]);

  const max = Math.max(...days.totals, 0);
  const peakDay = days.totals.indexOf(max) + 1;
  const [picked, setPicked] = useState<number | null>(null);
  // Default readout: today in the current month, otherwise the biggest day.
  const selected = picked ?? (isCurrent ? today : peakDay);

  const dayLabel = (d: number) =>
    new Date(y, m - 1, d).toLocaleDateString('en-AE', {
      day: 'numeric',
      month: 'short',
    });

  return (
    <View>
      <View style={styles.readout}>
        <Text style={[styles.readDay, { color: t.muted }]}>
          {selected === today ? 'Today' : dayLabel(selected)}
        </Text>
        <Text style={[styles.readValue, { color: t.text }]}>
          {formatMoney(days.totals[selected - 1] ?? 0)}
        </Text>
        <Text style={[styles.readDay, { color: t.muted }]}>
          · {days.counts[selected - 1] ?? 0} expense(s)
        </Text>
      </View>

      <View style={[styles.plot, { borderBottomColor: t.border }]}>
        {max > 0 && (
          <Text style={[styles.maxLabel, { color: t.muted }]}>
            {formatMoney(max)}
          </Text>
        )}
        {days.totals.map((v, i) => {
          const d = i + 1;
          const isToday = d === today;
          const isSel = d === selected;
          const color = isToday ? t.highlight : t.accent;
          const h = v > 0 ? Math.max((v / (max || 1)) * CHART_HEIGHT, 3) : 0;
          return (
            <Pressable
              key={d}
              onPress={() => setPicked(d)}
              style={styles.slot}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityLabel={`${dayLabel(d)}: ${formatMoney(v)}`}
            >
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor: color,
                    opacity: isSel || isToday ? 1 : 0.7,
                  },
                  isSel && v > 0 && glow(color, 8),
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.axis}>
        {[1, 8, 15, 22, daysInMonth].map(d => (
          <Text key={d} style={[styles.tick, { color: t.muted }]}>
            {d}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
  },
  readDay: { fontSize: 13, fontWeight: '600' },
  readValue: { fontSize: 18, fontWeight: '800' },
  plot: {
    height: CHART_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  maxLabel: { position: 'absolute', top: -2, right: 0, fontSize: 10 },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  tick: { fontSize: 10 },
});
