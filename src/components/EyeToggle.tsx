import { Pressable, StyleSheet, View } from 'react-native';

import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { useTheme } from '../lib/theme';

/** Eye button that hides salary figures, or reveals them after Face ID. Slashed while hidden. */
export default function EyeToggle() {
  const t = useTheme();
  const { hidden, reveal, hide } = useSalaryPrivacy();

  return (
    <Pressable
      onPress={hidden ? reveal : hide}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={hidden ? 'Show salary' : 'Hide salary'}
      style={styles.button}
    >
      <View style={[styles.eye, { borderColor: t.accent }]}>
        <View style={[styles.pupil, { backgroundColor: t.accent }]} />
      </View>
      {hidden && (
        <View
          style={[
            styles.slash,
            { backgroundColor: t.accent, borderColor: t.card },
          ]}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 28,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: {
    width: 22,
    height: 14,
    borderWidth: 2,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: { width: 6, height: 6, borderRadius: 3 },
  slash: {
    position: 'absolute',
    width: 26,
    height: 4,
    borderRadius: 2,
    borderWidth: 1,
    transform: [{ rotate: '-40deg' }],
  },
});
