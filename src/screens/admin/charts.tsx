import { useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { type Theme, useTheme } from '../../lib/theme';

/**
 * Categorical series colors, checked with the dataviz palette validator against the
 * app's card surfaces (light #FFFFFF, dark #131A26). Light slot 3 is under 3:1 on white,
 * so every chart shows its values as text (the readout and labels).
 */
export function seriesColors(t: Theme) {
  return t.scheme === 'dark'
    ? ['#3987e5', '#d95926', '#199e70']
    : ['#2a78d6', '#eb6834', '#1baf7a'];
}

export type Series = { name: string; color: string; values: number[] };

const HEIGHT = 150;
const GAP = 2; // surface gap between neighbouring bars
const RADIUS = 4;

/** A bar with only its data end rounded (top for positive, bottom for negative). */
function barPath(x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(RADIUS, w / 2, h);
  if (h <= 0) return '';
  return up
    ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${
        x + w
      },${y} ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${
        x + w
      },${y + h} ${x + w},${y + h - r}V${y}Z`;
}

/**
 * Grouped bars over months, one shared axis (zero line drawn when values go negative).
 * Tap a month to read its exact values; the latest month is shown by default.
 */
export function BarChart({
  labels,
  series,
  format,
  colorFor,
}: {
  labels: string[];
  series: Series[];
  format: (n: number) => string;
  /** Per-bar color override (e.g. profit green / loss red), else the series color. */
  colorFor?: (value: number, s: Series) => string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState(labels.length - 1);
  const all = series.flatMap(s => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const zeroY = (max / span) * HEIGHT;
  const slot = width / Math.max(labels.length, 1);
  const groupW = Math.min(slot * 0.62, 18 * series.length + GAP);
  const barW = (groupW - GAP * (series.length - 1)) / series.length;

  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  return (
    <View>
      <View style={styles.readout}>
        <Text style={[styles.readLabel, { color: t.muted }]}>
          {labels[picked]}
        </Text>
        <View style={styles.readValues}>
          {series.map(s => (
            <View key={s.name} style={styles.readItem}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <Text style={[styles.readText, { color: t.text }]}>
                {series.length > 1 ? `${s.name} ` : ''}
                <Text style={styles.readStrong}>
                  {format(s.values[picked] ?? 0)}
                </Text>
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ height: HEIGHT }} onLayout={onLayout}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {/* Recessive guides: top, middle and the zero line. */}
            {[0, HEIGHT / 2].map(y => (
              <Line
                key={y}
                x1={0}
                x2={width}
                y1={y + 0.5}
                y2={y + 0.5}
                stroke={t.border}
                strokeWidth={1}
              />
            ))}
            {/* Soft highlight behind the month being read. */}
            <Rect
              x={picked * slot}
              y={0}
              width={slot}
              height={HEIGHT}
              fill={t.cardHi}
              rx={6}
              opacity={0.7}
            />

            {labels.map((_, i) =>
              series.map((s, j) => {
                const v = s.values[i] ?? 0;
                const h = (Math.abs(v) / span) * HEIGHT;
                const x = i * slot + (slot - groupW) / 2 + j * (barW + GAP);
                const up = v >= 0;
                return (
                  <Path
                    key={`${s.name}-${i}`}
                    d={barPath(x, up ? zeroY - h : zeroY, barW, h, up)}
                    fill={colorFor ? colorFor(v, s) : s.color}
                    opacity={i === picked ? 1 : 0.75}
                  />
                );
              }),
            )}
            <Line
              x1={0}
              x2={width}
              y1={zeroY}
              y2={zeroY}
              stroke={t.muted}
              strokeWidth={1}
            />
          </Svg>
        )}
        {/* Tap targets bigger than the bars. */}
        <View style={StyleSheet.absoluteFill}>
          <View style={styles.hits}>
            {labels.map((label, i) => (
              <Pressable
                key={label + i}
                style={styles.hit}
                onPress={() => setPicked(i)}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${series
                  .map(s => `${s.name} ${format(s.values[i] ?? 0)}`)
                  .join(', ')}`}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.axis}>
        {labels.map((label, i) => (
          <Text
            key={label + i}
            style={[
              styles.axisLabel,
              { color: i === picked ? t.text : t.muted },
            ]}
          >
            {label}
          </Text>
        ))}
      </View>

      {series.length > 1 && (
        <View style={styles.legend}>
          {series.map(s => (
            <View key={s.name} style={styles.readItem}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <Text style={[styles.legendText, { color: t.muted }]}>
                {s.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** One stacked bar of parts of a whole, each part labelled with its count and share. */
export function PartsBar({
  parts,
}: {
  parts: { name: string; value: number; color: string }[];
}) {
  const t = useTheme();
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const shown = parts.filter(p => p.value > 0);
  return (
    <View>
      <View style={[styles.parts, { backgroundColor: t.cardHi }]}>
        {total > 0 &&
          shown.map((p, i) => (
            <View
              key={p.name}
              style={[
                styles.part,
                i > 0 && styles.partGap,
                { flex: p.value, backgroundColor: p.color },
              ]}
            />
          ))}
      </View>
      <View style={styles.legend}>
        {parts.map(p => (
          <View key={p.name} style={styles.readItem}>
            <View style={[styles.swatch, { backgroundColor: p.color }]} />
            <Text style={[styles.legendText, { color: t.text }]}>
              {p.name} <Text style={styles.readStrong}>{p.value}</Text>
              <Text style={{ color: t.muted }}>
                {' '}
                ({total ? Math.round((p.value / total) * 100) : 0}%)
              </Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { marginBottom: 10, gap: 4 },
  readLabel: { fontSize: 12, fontWeight: '700' },
  readValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  readItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readText: { fontSize: 13 },
  readStrong: { fontWeight: '800' },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  hits: { flex: 1, flexDirection: 'row' },
  hit: { flex: 1 },
  axis: { flexDirection: 'row', marginTop: 6 },
  axisLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  legendText: { fontSize: 12 },
  parts: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
  },
  part: { height: 14 },
  partGap: { marginLeft: GAP },
});
