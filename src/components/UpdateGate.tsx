import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { APP_VERSION } from '../version';
import {
  checkForUpdate,
  dismissVersion,
  getDismissedVersion,
  type VersionCheck,
} from '../lib/appVersion';
import { glow, useTheme } from '../lib/theme';
import Gradient from './Gradient';
import Logo from './Logo';

/** Checking again when the app comes back, at most this often. */
const RECHECK_MS = 30 * 60_000;

/**
 * Versions are set on the admin side (Admin → App version). Below the required version
 * this covers the whole app until it's updated; below the latest it suggests updating once
 * per new version. Expenses stay on the phone either way: updating keeps them.
 */
export default function UpdateGate({ ready }: { ready: boolean }) {
  const t = useTheme();
  const [check, setCheck] = useState<VersionCheck | null>(null);
  const [hidden, setHidden] = useState(false);
  const lastCheck = useRef(0);

  const run = useCallback(async () => {
    lastCheck.current = Date.now();
    const result = await checkForUpdate();
    if (result?.update === 'optional') {
      const dismissed = await getDismissedVersion();
      setHidden(dismissed === result.latestVersion);
    } else {
      setHidden(false);
    }
    setCheck(result);
  }, []);

  useEffect(() => {
    if (ready) run();
  }, [ready, run]);

  useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && Date.now() - lastCheck.current > RECHECK_MS) {
        run();
      }
    });
    return () => sub.remove();
  }, [ready, run]);

  if (!check || check.update === 'none' || hidden) return null;
  const required = check.update === 'required';

  const openStore = () => {
    if (!check.storeUrl) {
      Alert.alert(
        'Update Expences',
        'Open the App Store and update Expences to the latest version.',
      );
      return;
    }
    Linking.openURL(check.storeUrl).catch(() =>
      Alert.alert("Couldn't open the store", check.storeUrl ?? ''),
    );
  };

  const later = () => {
    setHidden(true);
    dismissVersion(check.latestVersion);
  };

  const body = (
    <>
      <Logo size={required ? 84 : 56} />
      <Text style={[styles.title, { color: t.text }]}>
        {required ? 'Update required' : 'A new version is ready'}
      </Text>
      <Text style={[styles.body, { color: t.muted }]}>
        {check.message ||
          (required
            ? 'This version of Expences is no longer supported. Update to keep using the app.'
            : 'Update to get the latest features and fixes.')}
      </Text>
      <Text style={[styles.version, { color: t.muted }]}>
        You have {APP_VERSION} · Latest {check.latestVersion}
      </Text>
      <Text style={[styles.version, { color: t.muted }]}>
        Your expenses stay on this phone and are kept when you update.
      </Text>
      <Pressable
        onPress={openStore}
        accessibilityRole="button"
        style={[styles.button, glow(t.gradients.hero[1], 14)]}
      >
        <Gradient colors={t.gradients.hero} radius={16} />
        <Text style={[styles.buttonText, { color: t.onAccent }]}>
          Update now
        </Text>
      </Pressable>
      {!required && (
        <Pressable onPress={later} hitSlop={10} accessibilityRole="button">
          <Text style={[styles.link, { color: t.accent }]}>Later</Text>
        </Pressable>
      )}
    </>
  );

  if (required) {
    return (
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.screen,
          { backgroundColor: t.bg },
        ]}
      >
        {body}
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <View
        style={[
          styles.sheet,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        {body}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
    zIndex: 200,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
    zIndex: 150,
  },
  sheet: {
    alignItems: 'center',
    padding: 24,
    gap: 12,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  version: { fontSize: 12, textAlign: 'center' },
  button: {
    marginTop: 8,
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '800' },
  link: { fontSize: 14, fontWeight: '700', marginTop: 4 },
});
