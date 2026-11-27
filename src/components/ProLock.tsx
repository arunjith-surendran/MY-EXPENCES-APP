import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RootStackParamList } from '../../App';
import { useSubscription } from '../lib/subscription';
import { glow, useTheme } from '../lib/theme';

/** Stands in for a Pro feature once the trial is over: what it does, and a way to the plans. */
export default function ProLock({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.card, borderColor: t.accent },
        glow(t.accent, 8),
      ]}
    >
      <View style={[styles.badge, { backgroundColor: t.accentSoft }]}>
        <Text style={[styles.badgeText, { color: t.accent }]}>PRO</Text>
      </View>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <Text style={[styles.body, { color: t.muted }]}>{body}</Text>
      <Pressable
        onPress={() => navigation.navigate('Paywall')}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
        ]}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: t.onAccent }]}>
          See Pro plans
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * A whole screen that is Pro-only: shows it with access, the lock card without.
 * `locked` narrows it to some uses of the screen (e.g. only past months).
 */
export function withPro<P extends object>(
  Screen: ComponentType<P>,
  lock: { title: string; body: string },
  locked: (props: P) => boolean = () => true,
) {
  return function ProScreen(props: P) {
    const t = useTheme();
    const { hasPro } = useSubscription();
    if (hasPro || !locked(props)) return <Screen {...props} />;
    return (
      <ScrollView
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={styles.screen}
      >
        <ProLock {...lock} />
      </ScrollView>
    );
  };
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
  },
  body: { fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  button: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
  },
  buttonText: { fontSize: 15, fontWeight: '800' },
  screen: { padding: 16 },
});
