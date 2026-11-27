import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addDays, dayStart, shortDay } from '../lib/periods';
import { useTheme } from '../lib/theme';

/** A filter chip; `color` tints it when on (e.g. a category's color). */
export function Chip({
  label,
  on,
  color,
  onPress,
}: {
  label: string;
  on: boolean;
  color?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[
        styles.chip,
        { borderColor: on ? c : t.border },
        on && { backgroundColor: c },
      ]}
    >
      <Text
        style={on ? [styles.bold, { color: t.onAccent }] : { color: t.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** ‹ 12 Nov 2026 › — moves a day at a time, never past today or before the first expense. */
export function DayStepper({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  min: number | null;
}) {
  const t = useTheme();
  const today = dayStart(new Date());
  const day = dayStart(value);
  const atMax = day >= today;
  const atMin =
    min != null && day.getTime() <= dayStart(new Date(min)).getTime();
  const step = (n: number) => onChange(addDays(day, n));
  const arrow = (text: string, n: number, disabled: boolean) => (
    <Pressable
      onPress={() => step(n)}
      onLongPress={() => step(n * 7)}
      disabled={disabled}
      hitSlop={6}
      style={[
        styles.stepBtn,
        { borderColor: t.border, backgroundColor: t.card },
      ]}
    >
      <Text
        style={[styles.stepArrow, { color: disabled ? t.border : t.accent }]}
      >
        {text}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.stepRow}>
      <Text style={[styles.stepLabel, { color: t.muted }]}>{label}</Text>
      {arrow('‹', -1, atMin)}
      <View
        style={[
          styles.stepBox,
          { borderColor: t.accent, backgroundColor: t.card },
        ]}
      >
        <Text style={[styles.bold, { color: t.text }]}>{shortDay(day)}</Text>
      </View>
      {arrow('›', 1, atMax)}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  bold: { fontWeight: '700' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepLabel: { width: 40, fontWeight: '600' },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepArrow: { fontSize: 24, marginTop: -3 },
  stepBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
});
