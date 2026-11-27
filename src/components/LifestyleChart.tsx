import { useMemo, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { G, Line, Path } from 'react-native-svg';

import type { GroupTotals, SpendGroup } from '../lib/insights';
import { formatMoney } from '../lib/parse';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { useTheme } from '../lib/theme';

const HEIGHT = 150;
const GAP = 2; // surface gap between stacked segments
const RADIUS = 4;
const MAX_BAR = 30;

const SERIES: { key: SpendGroup; name: string }[] = [
  { key: 'essentials', name: 'Essentials' },
  { key: 'lifestyle', name: 'Lifestyle' },
  { key: 'other', name: 'Other' },
];

/** A rectangle with only its top corners rounded. */
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${
    x + w
  },${y} ${x + w},${y + r}V${y + h}Z`;
}

const rect = (x: number, y: number, w: number, h: number) =>
  `M${x},${y}H${x + w}V${y + h}H${x}Z`;

/**
 * Essentials / lifestyle / other per month as stacked bars on one axis, with the salary
 * as a dashed tick on each bar. Tap a month to read its split; the latest is shown first.
 */
export default function LifestyleChart({
  months,
  groups,
  salaryOf,
  onOpenMonth,
}: {
  /** Oldest first. */
  months: string[];
  groups: Map<string, GroupTotals>;
  salaryOf: (month: string) => number | null;
  onOpenMonth: (month: string) => void;
}) {
  const t = useTheme();
  const { money } = useSalaryPrivacy();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const sel = picked && months.includes(picked) ? picked : months.at(-1)!;

  const data = useMemo(
    () =>
      months.map(m => {
        const g = groups.get(m) ?? { essentials: 0, lifestyle: 0, other: 0 };
        return {
          month: m,
          g,
          total: g.essentials + g.lifestyle + g.other,
          salary: salaryOf(m),
        };
      }),
    [months, groups, salaryOf],
  );
  const max = Math.max(1, ...data.map(d => Math.max(d.total, d.salary ?? 0)));
  const hasSalary = data.some(d => d.salary != null);

  const slot = width / Math.max(data.length, 1);
  const barW = Math.min(MAX_BAR, slot * 0.6);
  const scale = (v: number) => (v / max) * HEIGHT;

  const label = (key: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-AE', opts);
  };

  const s = data.find(d => d.month === sel) ?? data[data.length - 1];
  const share = (v: number) =>
    s.total > 0 ? ` · ${Math.round((v / s.total) * 100)}%` : '';

  return (
    <View>
      <View style={styles.readout}>
        <View style={styles.flex}>
          <Text style={[styles.readLabel, { color: t.muted }]}>
            {label(s.month, { month: 'long', year: 'numeric' })}
          </Text>
          <Text style={[styles.readValue, { color: t.text }]}>
            {formatMoney(s.total)}
          </Text>
        </View>
        <Pressable
          onPress={() => onOpenMonth(s.month)}
          hitSlop={8}
          style={[styles.open, { borderColor: t.accent }]}
        >
          <Text style={[styles.openText, { color: t.accent }]}>Open ›</Text>
        </Pressable>
      </View>

      {/* Legend with the selected month's values: identity never relies on color alone. */}
      <View style={styles.legend}>
        {SERIES.map((series, i) => (
          <View key={series.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: t.series[i] }]} />
            <Text style={[styles.legendName, { color: t.muted }]}>
              {series.name}
            </Text>
            <Text style={[styles.legendValue, { color: t.text }]}>
              {formatMoney(s.g[series.key])}
              <Text style={{ color: t.muted }}>{share(s.g[series.key])}</Text>
            </Text>
          </View>
        ))}
        {s.salary != null && (
          <View style={styles.legendItem}>
            <View style={[styles.dash, { borderColor: t.muted }]} />
            <Text style={[styles.legendName, { color: t.muted }]}>Salary</Text>
            <Text style={[styles.legendValue, { color: t.text }]}>
              {money(s.salary)}
            </Text>
          </View>
        )}
      </View>

      <View
        style={styles.plot}
        onLayout={(e: LayoutChangeEvent) =>
          setWidth(e.nativeEvent.layout.width)
        }
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT + 1}>
            <Line
              x1={0}
              x2={width}
              y1={HEIGHT + 0.5}
              y2={HEIGHT + 0.5}
              stroke={t.border}
              strokeWidth={1}
            />
            {data.map((d, i) => {
              const x = i * slot + (slot - barW) / 2;
              const dim = d.month !== s.month;
              // Stack bottom → top; only the topmost visible segment is rounded.
              const top = SERIES.reduce(
                (last, series, k) => (d.g[series.key] > 0 ? k : last),
                -1,
              );
              let y = HEIGHT;
              return (
                <G key={d.month} opacity={dim ? 0.45 : 1}>
                  {SERIES.map((series, k) => {
                    const v = d.g[series.key];
                    if (v <= 0) return null;
                    const h = Math.max(scale(v) - (k < top ? GAP : 0), 1.5);
                    y -= h;
                    const path =
                      k === top
                        ? topRounded(x, y, barW, h)
                        : rect(x, y, barW, h);
                    if (k < top) y -= GAP;
                    return (
                      <Path key={series.key} d={path} fill={t.series[k]} />
                    );
                  })}
                  {d.salary != null && (
                    <Line
                      x1={x - 4}
                      x2={x + barW + 4}
                      y1={HEIGHT - scale(d.salary)}
                      y2={HEIGHT - scale(d.salary)}
                      stroke={t.text}
                      strokeOpacity={0.55}
                      strokeWidth={2}
                      strokeDasharray="3 2"
                    />
                  )}
                </G>
              );
            })}
          </Svg>
        )}
        {/* Hit targets: the whole column, wider than the bar. */}
        <View style={StyleSheet.absoluteFill}>
          <View style={styles.hits}>
            {data.map(d => (
              <Pressable
                key={d.month}
                style={styles.flex}
                onPress={() => setPicked(d.month)}
                accessibilityLabel={`${label(d.month, {
                  month: 'long',
                  year: 'numeric',
                })}: essentials ${formatMoney(
                  d.g.essentials,
                )}, lifestyle ${formatMoney(
                  d.g.lifestyle,
                )}, other ${formatMoney(d.g.other)}`}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.axis}>
        {data.map(d => (
          <Text
            key={d.month}
            style={[
              styles.tick,
              { color: d.month === s.month ? t.text : t.muted },
            ]}
          >
            {label(d.month, { month: data.length > 6 ? 'narrow' : 'short' })}
          </Text>
        ))}
      </View>
      {hasSalary && (
        <Text style={[styles.note, { color: t.muted }]}>
          Dashed line: your salary. Bars above it mean you spent more than you
          earned.
        </Text>
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
  },
  readLabel: { fontSize: 13, fontWeight: '600' },
  readValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  open: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openText: { fontWeight: '800' },
  legend: { marginTop: 10, marginBottom: 14, gap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  dash: { width: 12, borderTopWidth: 2, borderStyle: 'dashed' },
  legendName: { fontSize: 13, fontWeight: '600', flex: 1 },
  legendValue: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  plot: { height: HEIGHT + 1 },
  hits: { flex: 1, flexDirection: 'row' },
  axis: { flexDirection: 'row', marginTop: 6 },
  tick: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  note: { fontSize: 11, marginTop: 10 },
});
