import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../lib/auth/AuthContext';
import {
  authenticate,
  biometryLabel,
  canAuthenticate,
} from '../lib/biometrics';
import { getMeta, setMeta } from '../lib/db';
import { glow, useTheme } from '../lib/theme';
import Gradient from './Gradient';
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
export default function AppLock({ ready }: { ready: boolean }) {
  const t = useTheme();
  const { status, signOut } = useAuth();
  const [locked, setLocked] = useState(false);
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
      if (await authenticate('Unlock Expences')) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  // Ask straight away when the lock appears.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  if (!locked) return null;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.screen,
        { backgroundColor: t.bg },
      ]}
    >
      <Logo size={84} />
      <Text style={[styles.title, { color: t.text }]}>Expences is locked</Text>
      <Text style={[styles.body, { color: t.muted }]}>
        Your spending stays private. Unlock with {label} to continue.
      </Text>
      <Pressable
        onPress={unlock}
        accessibilityRole="button"
        style={[styles.button, glow(t.gradients.hero[1], 14)]}
      >
        <Gradient colors={t.gradients.hero} radius={16} />
        <Text style={[styles.buttonText, { color: t.onAccent }]}>
          Unlock with {label}
        </Text>
      </Pressable>
      <Pressable onPress={signOut} hitSlop={10} accessibilityRole="button">
        <Text style={[styles.link, { color: t.accent }]}>
          Sign in with another account
        </Text>
      </Pressable>
    </View>
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

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
    zIndex: 100,
  },
  title: { fontSize: 22, fontWeight: '800', marginTop: 10 },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  button: {
    marginTop: 12,
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '800' },
  link: { fontSize: 14, fontWeight: '700', marginTop: 6 },
});
