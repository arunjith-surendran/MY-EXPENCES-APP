import { type ReactNode, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { formatMoney } from '../lib/parse';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { type Theme, useTheme } from '../lib/theme';

const HEIGHT = 140;
const RADIUS = 4;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = [
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
  'Sundays',
];

type Tab = 'daily' | 'monthly' | 'weekdays';

type RefLine = { value: number; label: string; color: string };

/** A bar with its top corners rounded, anchored to the baseline. */
function bar(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${
    x + w
  },${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Width-aware SVG area with full-height tap columns over it. */
function Plot({
  count,
  selected,
  onSelect,
  labelFor,
  children,
}: {
  count: number;
  selected: number;
  onSelect: (i: number) => void;
  labelFor: (i: number) => string;
  children: (width: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  return (
    <View
      style={styles.plot}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <Svg width={width} height={HEIGHT + 1}>
          {children(width)}
        </Svg>
      )}
      <View style={[StyleSheet.absoluteFill, styles.hits]}>
        {Array.from({ length: count }, (_, i) => (
          <Pressable
            key={i}
            style={styles.flex}
            onPress={() => onSelect(i)}
            accessibilityLabel={labelFor(i)}
            accessibilityState={{ selected: i === selected }}
          />
        ))}
      </View>
    </View>
  );
}

function Bars({
  values,
  selected,
  max,
  colorFor,
  refs,
  t,
  width,
}: {
  values: (number | null)[];
  selected: number;
  max: number;
  colorFor: (i: number) => string;
  refs: RefLine[];
  t: Theme;
  width: number;
}) {
  const slot = width / values.length;
  // 2px surface gap between neighbouring bars, but never thinner than 2px.
  const barW = Math.max(Math.min(slot - 2, 28), 2);
  const scale = (v: number) => (v / max) * HEIGHT;
  return (
    <>
      <Line
        x1={0}
        x2={width}
        y1={HEIGHT + 0.5}
        y2={HEIGHT + 0.5}
        stroke={t.border}
      />
      {values.map((v, i) => {
        if (v == null || v <= 0) return null;
        const h = Math.max(scale(v), 2);
        const x = i * slot + (slot - barW) / 2;
        return (
          <Path
            key={i}
            d={bar(x, HEIGHT - h, barW, h)}
            fill={colorFor(i)}
            opacity={i === selected ? 1 : 0.55}
          />
        );
      })}
      {refs.map(r => {
        const y = HEIGHT - scale(r.value);
        if (y < 8) return null;
        return (
          <G key={r.label}>
            <Line
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke={r.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <SvgText
              x={width - 2}
              y={y - 4}
              fontSize={10}
              fontWeight="700"
              fill={t.muted}
              textAnchor="end"
            >
              {r.label}
            </SvgText>
          </G>
        );
      })}
    </>
  );
}

/**
 * Spending patterns on the dashboard, one card with three views:
 * this month day by day, the monthly trend, and which weekdays cost the most.
 * Each is a single series (no legend); tap a bar or point to read it.
 */
export default function PatternsChart({
  daily,
  dailyMonth,
  safePerDay,
  months,
  weekdays,
  onOpenMonth,
}: {
  /** Spend per day of the current month; null for days still to come. */
  daily: (number | null)[];
  dailyMonth: string;
  /** What's left of the salary per remaining day, or null without a salary. */
  safePerDay: number | null;
  /** Oldest first. */
  months: { month: string; total: number }[];
  /** Average spend per weekday, Monday first. */
  weekdays: number[];
  onOpenMonth: (month: string) => void;
}) {
  const t = useTheme();
  const { hidden, money } = useSalaryPrivacy();
  const [tab, setTab] = useState<Tab>('daily');

  return (
    <View>
      <View style={[styles.segment, { backgroundColor: t.cardHi }]}>
        {(
          [
            ['daily', 'Daily'],
            ['monthly', 'Monthly'],
            ['weekdays', 'Weekdays'],
          ] as const
        ).map(([value, label]) => {
          const on = tab === value;
          return (
            <Pressable
              key={value}
              onPress={() => setTab(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.segmentItem,
                on && {
                  backgroundColor: t.scheme === 'dark' ? t.border : t.card,
                },
              ]}
            >
              <Text
                style={[styles.segmentText, { color: on ? t.text : t.muted }]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'daily' && (
        <Daily
          values={daily}
          month={dailyMonth}
          safePerDay={hidden ? null : safePerDay}
          safeText={safePerDay != null ? money(safePerDay) : null}
        />
      )}
      {tab === 'monthly' && (
        <Monthly months={months} onOpenMonth={onOpenMonth} />
      )}
      {tab === 'weekdays' && <Weekdays values={weekdays} />}
    </View>
  );
}

function Daily({
  values,
  month,
  safePerDay,
  safeText,
}: {
  values: (number | null)[];
  month: string;
  /** Drawn as a line only while the salary is revealed. */
  safePerDay: number | null;
  safeText: string | null;
}) {
  const t = useTheme();
  const elapsed = values.filter(v => v != null).length;
  const today = Math.max(elapsed - 1, 0);
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked != null && values[picked] != null ? picked : today;
  const spent = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const avg = elapsed ? spent / elapsed : 0;
  const max = Math.max(1, ...values.map(v => v ?? 0), avg, safePerDay ?? 0);
  const [y, m] = month.split('-').map(Number);
  const label = (i: number) =>
    i === today
      ? 'Today'
      : new Date(y, m - 1, i + 1).toLocaleDateString('en-AE', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
  const quiet = values.filter(v => v === 0).length;

  const refs: RefLine[] = [];
  if (avg > 0) refs.push({ value: avg, label: 'avg', color: t.muted });
  if (safePerDay != null && safePerDay > 0) {
    refs.push({ value: safePerDay, label: 'safe', color: t.highlight });
  }

  return (
    <View>
      <View style={styles.readout}>
        <Text style={[styles.readLabel, { color: t.muted }]}>{label(sel)}</Text>
        <Text style={[styles.readValue, { color: t.text }]}>
          {formatMoney(values[sel] ?? 0)}
        </Text>
        <Text style={[styles.readLabel, { color: t.muted }]}>
          Average {formatMoney(avg)} a day
          {safeText ? ` · Safe ${safeText} a day` : ''}
        </Text>
      </View>
      <Plot
        count={values.length}
        selected={sel}
        onSelect={setPicked}
        labelFor={i => `${label(i)}: ${formatMoney(values[i] ?? 0)}`}
      >
        {width => (
          <Bars
            values={values}
            selected={sel}
            max={max}
            refs={refs}
            t={t}
            width={width}
            colorFor={i =>
              safePerDay != null && (values[i] ?? 0) > safePerDay
                ? t.warning
                : t.accent
            }
          />
        )}
      </Plot>
      <View style={styles.axis}>
        {values.map((_, i) => (
          <Text
            key={i}
            style={[styles.tick, { color: i === sel ? t.text : t.muted }]}
          >
            {i === 0 || (i + 1) % 5 === 0 ? i + 1 : ''}
          </Text>
        ))}
      </View>
      <Text style={[styles.insight, { color: t.muted }]}>
        {quiet > 0
          ? `🌿 ${quiet} no-spend day${quiet === 1 ? '' : 's'} this month.`
          : 'Every day this month had spending.'}
        {safePerDay != null ? ' Amber bars went over your safe amount.' : ''}
      </Text>
    </View>
  );
}

function Monthly({
  months,
  onOpenMonth,
}: {
  months: { month: string; total: number }[];
  onOpenMonth: (month: string) => void;
}) {
  const t = useTheme();
  const last = months.length - 1;
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked != null && picked <= last ? picked : last;
  const avg = months.length
    ? months.reduce((s, m) => s + m.total, 0) / months.length
    : 0;
  const max = Math.max(1, ...months.map(m => m.total), avg) * 1.1;
  const label = (key: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-AE', opts);
  };
  const s = months[sel];
  const vsAvg = avg > 0 && s ? Math.round(((s.total - avg) / avg) * 100) : null;

  if (months.length < 2) {
    return (
      <Text style={[styles.insight, styles.empty, { color: t.muted }]}>
        The monthly trend appears once you have two months of spending.
      </Text>
    );
  }

  return (
    <View>
      <View style={styles.readoutRow}>
        <View style={styles.flex}>
          <Text style={[styles.readLabel, { color: t.muted }]}>
            {label(s.month, { month: 'long', year: 'numeric' })}
          </Text>
          <Text style={[styles.readValue, { color: t.text }]}>
            {formatMoney(s.total)}
          </Text>
          {vsAvg != null && (
            <Text style={[styles.readLabel, { color: t.muted }]}>
              {vsAvg === 0
                ? 'Same as your average'
                : `${vsAvg > 0 ? '▲' : '▼'} ${Math.abs(
                    vsAvg,
                  )}% vs your average ${formatMoney(avg)}`}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => onOpenMonth(s.month)}
          hitSlop={8}
          style={[styles.open, { borderColor: t.accent }]}
        >
          <Text style={[styles.openText, { color: t.accent }]}>Open ›</Text>
        </Pressable>
      </View>
      <Plot
        count={months.length}
        selected={sel}
        onSelect={setPicked}
        labelFor={i =>
          `${label(months[i].month, {
            month: 'long',
            year: 'numeric',
          })}: ${formatMoney(months[i].total)}`
        }
      >
        {width => {
          const slot = width / months.length;
          const pts = months.map((m, i) => ({
            x: i * slot + slot / 2,
            y: HEIGHT - (m.total / max) * HEIGHT,
          }));
          const line = pts
            .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
            .join('');
          const area = `${line}L${pts[last].x},${HEIGHT}L${pts[0].x},${HEIGHT}Z`;
          const avgY = HEIGHT - (avg / max) * HEIGHT;
          return (
            <>
              <Defs>
                <LinearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={t.accent} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Line
                x1={0}
                x2={width}
                y1={HEIGHT + 0.5}
                y2={HEIGHT + 0.5}
                stroke={t.border}
              />
              <Path d={area} fill="url(#trend)" />
              <Line
                x1={0}
                x2={width}
                y1={avgY}
                y2={avgY}
                stroke={t.muted}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <SvgText
                x={width - 2}
                y={avgY - 4}
                fontSize={10}
                fontWeight="700"
                fill={t.muted}
                textAnchor="end"
              >
                avg
              </SvgText>
              <Path
                d={line}
                stroke={t.accent}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
              />
              <Line
                x1={pts[sel].x}
                x2={pts[sel].x}
                y1={0}
                y2={HEIGHT}
                stroke={t.border}
              />
              {pts.map((p, i) => (
                <Circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={i === sel ? 6 : 4}
                  fill={t.accent}
                  stroke={t.card}
                  strokeWidth={2}
                />
              ))}
            </>
          );
        }}
      </Plot>
      <View style={styles.axis}>
        {months.map((m, i) => (
          <Text
            key={m.month}
            style={[styles.tick, { color: i === sel ? t.text : t.muted }]}
          >
            {label(m.month, { month: months.length > 6 ? 'narrow' : 'short' })}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Weekdays({ values }: { values: number[] }) {
  const t = useTheme();
  const top = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? top;
  const max = Math.max(1, ...values);
  const total = values.reduce((s, v) => s + v, 0);
  const weekend = values[5] + values[6]; // Saturday and Sunday, the UAE weekend since 2022
  const weekendShare = total > 0 ? Math.round((weekend / total) * 100) : 0;

  if (total === 0) {
    return (
      <Text style={[styles.insight, styles.empty, { color: t.muted }]}>
        Your weekday pattern appears after a week or two of spending.
      </Text>
    );
  }

  return (
    <View>
      <View style={styles.readout}>
        <Text style={[styles.readLabel, { color: t.muted }]}>
          {WEEKDAY_NAMES[sel]}, on average
        </Text>
        <Text style={[styles.readValue, { color: t.text }]}>
          {formatMoney(values[sel])}
        </Text>
        <Text style={[styles.readLabel, { color: t.muted }]}>
          Last 12 weeks
        </Text>
      </View>
      <Plot
        count={7}
        selected={sel}
        onSelect={setPicked}
        labelFor={i =>
          `${WEEKDAY_NAMES[i]}: ${formatMoney(values[i])} on average`
        }
      >
        {width => (
          <Bars
            values={values}
            selected={sel}
            max={max}
            refs={[]}
            t={t}
            width={width}
            colorFor={i => (i === top ? t.accent : t.secondary)}
          />
        )}
      </Plot>
      <View style={styles.axis}>
        {WEEKDAYS.map((d, i) => (
          <Text
            key={d}
            style={[styles.tick, { color: i === sel ? t.text : t.muted }]}
          >
            {d}
          </Text>
        ))}
      </View>
      <Text style={[styles.insight, { color: t.muted }]}>
        💡 You spend most on {WEEKDAY_NAMES[top]}. The weekend (Sat–Sun) is{' '}
        {weekendShare}% of a typical week
        {weekendShare > 35 ? ', so plan weekends ahead' : ''}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segment: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 3,
    marginTop: 10,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  readout: { marginTop: 12, marginBottom: 12 },
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    marginBottom: 12,
  },
  readLabel: { fontSize: 13, fontWeight: '600' },
  readValue: {
    fontSize: 22,
    fontWeight: '800',
    marginVertical: 2,
    fontVariant: ['tabular-nums'],
  },
  open: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openText: { fontWeight: '800' },
  plot: { height: HEIGHT + 1 },
  hits: { flexDirection: 'row' },
  axis: { flexDirection: 'row', marginTop: 6 },
  tick: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600' },
  insight: { fontSize: 12, marginTop: 10, lineHeight: 17 },
  empty: { marginTop: 16, marginBottom: 8 },
});
