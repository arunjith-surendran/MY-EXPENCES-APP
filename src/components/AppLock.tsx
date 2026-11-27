import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useAuth } from '../lib/auth/AuthContext';
import {
  authenticate,
  biometryLabel,
  canAuthenticate,
} from '../lib/biometrics';
import { getMeta, setMeta } from '../lib/db';
import { useTheme } from '../lib/theme';
import Logo from './Logo';

/** Meta key; '0' turns the lock off. On by default. */
const APP_LOCK_KEY = 'app_lock';
/** Coming back after this long in the background asks again. */
const RELOCK_AFTER_MS = 2 * 60_000;

async function lockEnabled() {
  const v = await getMeta(APP_LOCK_KEY).catch(() => null);
  return v !== '0' && (await canAuthenticate());
}

/**
 * Face ID before the app opens with a saved session (cold start, or back after a couple
 * of minutes away). Signing in fresh doesn't ask. It covers the app instead of replacing
 * it, so an Apple Pay link that opened the app still saves the payment underneath.
 */
export default function AppLock({
  ready,
  revealed,
}: {
  ready: boolean;
  /** False while the splash is still up: the lock sits under it and Face ID waits. */
  revealed: boolean;
}) {
  const { status, signOut } = useAuth();
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [label, setLabel] = useState('Face ID');
  const decided = useRef(false);
  const backgroundAt = useRef<number | null>(null);
  const prompting = useRef(false);

  useEffect(() => {
    biometryLabel().then(setLabel);
  }, []);

  // Cold start: lock only when the session was restored, not after signing in.
  useEffect(() => {
    if (!ready || decided.current || status === 'loading') return;
    decided.current = true;
    if (status === 'signedIn') {
      lockEnabled().then(on => on && setLocked(true));
    }
  }, [ready, status]);

  useEffect(() => {
    if (status !== 'signedIn') setLocked(false);
  }, [status]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') {
        backgroundAt.current = Date.now();
      } else if (state === 'active' && backgroundAt.current != null) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (status === 'signedIn' && away >= RELOCK_AFTER_MS) {
          lockEnabled().then(on => on && setLocked(true));
        }
      }
    });
    return () => sub.remove();
  }, [status]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const ok = await authenticate('Unlock Expences');
      setFailed(!ok);
      if (ok) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  // Ask straight away once the lock is visible (after the splash).
  useEffect(() => {
    if (locked && revealed) unlock();
  }, [locked, revealed, unlock]);

  if (!locked) return null;
  return (
    <LockScreen
      revealed={revealed}
      label={label}
      failed={failed}
      onUnlock={unlock}
      onSwitch={signOut}
    />
  );
}

const WHITE = '#FFFFFF';
const SOFT = 'rgba(255,255,255,0.78)';

/**
 * The locked view: the brand backdrop with the time, the logo inside pulsing rings with a
 * padlock, what keeps the data private, and a big unlock button.
 */
function LockScreen({
  revealed,
  label,
  failed,
  onUnlock,
  onSwitch,
}: {
  revealed: boolean;
  label: string;
  failed: boolean;
  onUnlock: () => void;
  onSwitch: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const now = useClock();
  const enter = useSharedValue(0);
  const pulse = useSharedValue(0);

  // Animate in when the splash has gone, not underneath it.
  useEffect(() => {
    if (!revealed) return;
    enter.value = withSpring(1, { damping: 14, stiffness: 120 });
    pulse.value = withDelay(
      300,
      withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }),
        -1,
      ),
    );
    // Shared values are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  const artStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.8 + enter.value * 0.2 }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 24 }],
  }));
  // Two rings, half a cycle apart, growing and fading out from the logo.
  const ringA = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));
  const ringB = useAnimatedStyle(() => {
    const p = (pulse.value + 0.5) % 1;
    return { opacity: 0.55 * (1 - p), transform: [{ scale: 1 + p * 0.9 }] };
  });

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]}>
      <Image
        source={require('../assets/brand/splash-bg.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />

      <View style={[styles.top, { paddingTop: insets.top + 28 }]}>
        <Text style={styles.date}>
          {now.toLocaleDateString('en-AE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>
        <Text style={styles.clock}>
          {now.toLocaleTimeString('en-AE', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>

      <Animated.View style={[styles.art, artStyle]}>
        <Animated.View style={[styles.ring, ringA]} />
        <Animated.View style={[styles.ring, ringB]} />
        <View style={styles.halo}>
          <Logo size={92} />
        </View>
        <View style={[styles.lockBadge, { backgroundColor: t.accent }]}>
          <PadlockIcon color={WHITE} />
        </View>
      </Animated.View>

      <Animated.View style={[styles.content, contentStyle]}>
        <Text style={styles.title}>Expences is locked</Text>
        <Text style={styles.body}>
          Your spending stays private. Unlock with {label} to continue.
        </Text>

        <View style={styles.features}>
          <Feature icon="phone" text="Never sent to our servers" />
          <Feature icon="shield" text={`Protected by ${label}`} />
          <Feature icon="eye" text="No bank login, ever" />
        </View>
      </Animated.View>

      <View
        style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        {failed && (
          <Text style={styles.failed}>
            {label} didn't work. Tap to try again.
          </Text>
        )}
        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.button,
            { opacity: pressed ? 0.88 : 1 },
          ]}
        >
          <FaceIdIcon color={t.accent} />
          <Text style={[styles.buttonText, { color: t.accent }]}>
            Unlock with {label}
          </Text>
        </Pressable>
        <Pressable onPress={onSwitch} hitSlop={10} accessibilityRole="button">
          <Text style={styles.link}>Sign in with another account</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The current time, ticking every 15 seconds while the lock is up. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Feature({
  icon,
  text,
}: {
  icon: 'phone' | 'shield' | 'eye';
  text: string;
}) {
  const stroke = {
    stroke: WHITE,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          {icon === 'phone' && (
            <>
              <Rect x={6} y={2.5} width={12} height={19} rx={2.5} {...stroke} />
              <Path d="M11 18.5h2" {...stroke} />
            </>
          )}
          {icon === 'shield' && (
            <>
              <Path
                d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"
                {...stroke}
              />
              <Path d="m8.8 12 2.2 2.2 4.2-4.4" {...stroke} />
            </>
          )}
          {icon === 'eye' && (
            <>
              <Path
                d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
                {...stroke}
              />
              <Circle cx={12} cy={12} r={3} {...stroke} />
              <Path d="M4 20 20 4" {...stroke} />
            </>
          )}
        </Svg>
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function PadlockIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Rect x={4.5} y={10.5} width={15} height={10.5} rx={2.5} fill={color} />
      <Path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/** A Face ID style glyph: corner brackets around a simple face. */
function FaceIdIcon({ color }: { color: string }) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"
        {...stroke}
      />
      <Path
        d="M9 9v1.5M15 9v1.5M12 9v4h-1M9 16a4.2 4.2 0 0 0 6 0"
        {...stroke}
      />
    </Svg>
  );
}

/** For the Account switch. Turning the lock off asks for Face ID first. */
export function useAppLockSetting() {
  const [enabled, setEnabled] = useState(true);
  const [available, setAvailable] = useState(false);
  const [label, setLabel] = useState('Face ID');

  useEffect(() => {
    getMeta(APP_LOCK_KEY)
      .then(v => setEnabled(v !== '0'))
      .catch(() => {});
    canAuthenticate().then(setAvailable);
    biometryLabel().then(setLabel);
  }, []);

  const set = useCallback(async (on: boolean) => {
    if (!on && !(await authenticate('Turn off the lock'))) return;
    setEnabled(on);
    await setMeta(APP_LOCK_KEY, on ? '1' : '0').catch(() => {});
  }, []);

  return { enabled: enabled && available, available, label, set };
}

const RING = 150;

const styles = StyleSheet.create({
  screen: { alignItems: 'center', zIndex: 100, backgroundColor: '#1A3DB8' },
  shade: { backgroundColor: 'rgba(8,16,48,0.35)' },
  top: { alignItems: 'center' },
  date: { color: SOFT, fontSize: 16, fontWeight: '600' },
  clock: {
    color: WHITE,
    fontSize: 64,
    fontWeight: '200',
    letterSpacing: 1,
    marginTop: -2,
    fontVariant: ['tabular-nums'],
  },
  art: {
    width: RING * 1.9,
    height: RING * 1.9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    borderColor: WHITE,
  },
  halo: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    bottom: RING * 0.45 - 4,
    right: RING * 0.45 - 4,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { alignItems: 'center', paddingHorizontal: 28, width: '100%' },
  title: { color: WHITE, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  body: {
    color: SOFT,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 6,
  },
  features: {
    alignSelf: 'stretch',
    marginTop: 22,
    padding: 14,
    gap: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { color: WHITE, fontSize: 14, fontWeight: '600' },
  bottom: {
    marginTop: 'auto',
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  failed: { color: WHITE, fontSize: 13, fontWeight: '600' },
  button: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 17,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  buttonText: { fontSize: 17, fontWeight: '800' },
  link: { color: WHITE, fontSize: 14, fontWeight: '700', opacity: 0.9 },
});
