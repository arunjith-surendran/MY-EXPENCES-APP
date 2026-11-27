import { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../lib/theme';

const MIN_SHOW_MS = 1500;
const EXIT_MS = 380;
const BARS = [0.42, 0.68, 1]; // relative heights of the three chart bars in the logo

/**
 * Animated intro shown over the app while it starts: the logo tile springs in, its chart
 * bars grow, then the name and tagline slide up. It fades out once `ready` and the
 * minimum time have both passed, then calls `onDone`.
 */
export default function Splash({
  ready,
  onDone,
}: {
  ready: boolean;
  onDone: () => void;
}) {
  const t = useTheme();
  const tile = useSharedValue(0);
  const b0 = useSharedValue(0);
  const b1 = useSharedValue(0);
  const b2 = useSharedValue(0);
  const title = useSharedValue(0);
  const tagline = useSharedValue(0);
  const exit = useSharedValue(0);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    tile.value = withSpring(1, { damping: 12, stiffness: 140 });
    [b0, b1, b2].forEach((b, i) => {
      b.value = withDelay(
        260 + i * 110,
        withSpring(1, { damping: 14, stiffness: 160 }),
      );
    });
    const ease = { duration: 420, easing: Easing.out(Easing.cubic) };
    title.value = withDelay(520, withTiming(1, ease));
    tagline.value = withDelay(680, withTiming(1, ease));
    // Shared values are stable refs; run the intro once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt.current));
    const start = setTimeout(() => {
      exit.value = withTiming(1, {
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
      });
    }, wait);
    const done = setTimeout(onDone, wait + EXIT_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(done);
    };
  }, [ready, onDone, exit]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: 1 + exit.value * 0.06 }],
  }));
  const tileStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, tile.value * 1.5),
    transform: [
      { scale: 0.6 + tile.value * 0.4 },
      { rotate: `${(1 - tile.value) * -12}deg` },
    ],
  }));
  const bar0 = useAnimatedStyle(() => ({
    height: `${BARS[0] * 100 * b0.value}%`,
  }));
  const bar1 = useAnimatedStyle(() => ({
    height: `${BARS[1] * 100 * b1.value}%`,
  }));
  const bar2 = useAnimatedStyle(() => ({
    height: `${BARS[2] * 100 * b2.value}%`,
  }));
  const barStyles = [bar0, bar1, bar2];
  const titleStyle = useAnimatedStyle(() => ({
    opacity: title.value,
    transform: [{ translateY: (1 - title.value) * 14 }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value,
    transform: [{ translateY: (1 - tagline.value) * 10 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root, rootStyle]}
    >
      {/* Same artwork as the native launch screen (LaunchSplash), so there is no jump. */}
      <Image
        source={require('../assets/brand/splash-bg.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <Animated.View style={[styles.tile, tileStyle]}>
        <View style={styles.chart}>
          {barStyles.map((style, i) => (
            <Animated.View
              key={i}
              style={[styles.bar, { backgroundColor: t.accent }, style]}
            />
          ))}
        </View>
      </Animated.View>
      <Animated.Text style={[styles.title, titleStyle]}>Expences</Animated.Text>
      <Animated.View style={taglineStyle}>
        <Text style={styles.tagline}>Every payment, tracked automatically</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    backgroundColor: '#1A3DB8',
  },
  tile: {
    width: 104,
    height: 104,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#061347',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  chart: {
    width: 56,
    height: 52,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  bar: { width: 14, borderRadius: 4 },
  title: {
    marginTop: 26,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  tagline: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
});
