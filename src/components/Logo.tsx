import { StyleSheet, View } from 'react-native';

import { useTheme } from '../lib/theme';

const BARS = [0.42, 0.68, 1];

/** The app mark: three rising bars on the accent tile (same as the splash). */
export default function Logo({ size = 72 }: { size?: number }) {
  const t = useTheme();
  const chartW = size * 0.54;
  const chartH = size * 0.5;
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * 0.27,
          backgroundColor: t.accent,
        },
      ]}
    >
      <View style={[styles.chart, { width: chartW, height: chartH }]}>
        {BARS.map((h, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                width: chartW * 0.25,
                height: chartH * h,
                borderRadius: size * 0.04,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B1324',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  bar: { backgroundColor: '#FFFFFF' },
});
