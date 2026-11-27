import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '../lib/auth/AuthContext';
import { shareBackup } from '../lib/backup';
import { emitDataChanged } from '../lib/dataEvents';
import {
  getOwner,
  type Owner,
  setOwner,
  wipeEverything,
} from '../lib/dataOwner';
import { glow, useTheme } from '../lib/theme';
import Logo from './Logo';

/**
 * Expenses are stored per phone. When an account signs in on a phone that holds another
 * account's data, this asks what to do with it before showing anything.
 */
export default function DataOwnerGate({ ready }: { ready: boolean }) {
  const t = useTheme();
  const { status, user } = useAuth();
  const [other, setOther] = useState<Owner | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || status !== 'signedIn' || !user) {
      setOther(null);
      return;
    }
    const me: Owner = { id: user.id, label: user.email || user.name || 'you' };
    getOwner().then(owner => {
      // First sign-in (or the first run after this check was added): the data is theirs.
      if (!owner) setOwner(me).catch(() => {});
      else if (owner.id !== me.id) setOther(owner);
      else setOther(null);
    });
  }, [ready, status, user]);

  if (!other || !user) return null;
  const me: Owner = { id: user.id, label: user.email || user.name || 'you' };

  const backup = async () => {
    setBusy('backup');
    try {
      await shareBackup(true);
    } catch (err) {
      Alert.alert("Couldn't back up", String(err));
    } finally {
      setBusy(null);
    }
  };

  const clear = () =>
    Alert.alert(
      'Clear the data on this phone?',
      `Everything from ${other.label} (expenses, salary, budgets, recurring payments) will be deleted. Back it up first if it's needed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear and start fresh',
          style: 'destructive',
          onPress: async () => {
            setBusy('clear');
            await wipeEverything().catch(() => {});
            await setOwner(me).catch(() => {});
            setBusy(null);
            setOther(null);
            emitDataChanged();
          },
        },
      ],
    );

  const keep = async () => {
    await setOwner(me).catch(() => {});
    setOther(null);
  };

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.screen,
        { backgroundColor: t.bg },
      ]}
    >
      <Logo size={72} />
      <Text style={[styles.title, { color: t.text }]}>
        This phone has someone else's data
      </Text>
      <Text style={[styles.body, { color: t.muted }]}>
        Expenses here were saved while{' '}
        <Text style={[styles.strong, { color: t.text }]}>{other.label}</Text>{' '}
        was signed in. You're signed in as{' '}
        <Text style={[styles.strong, { color: t.text }]}>{me.label}</Text>.
      </Text>

      <Pressable
        onPress={backup}
        disabled={!!busy}
        style={[styles.button, styles.outline, { borderColor: t.accent }]}
      >
        {busy === 'backup' ? (
          <ActivityIndicator color={t.accent} />
        ) : (
          <Text style={[styles.buttonText, { color: t.accent }]}>
            🛟 Back it up first
          </Text>
        )}
      </Pressable>
      <Pressable
        onPress={clear}
        disabled={!!busy}
        style={[
          styles.button,
          { backgroundColor: t.danger },
          glow(t.danger, 10),
        ]}
      >
        {busy === 'clear' ? (
          <ActivityIndicator color={t.onAccent} />
        ) : (
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            Clear it and start fresh
          </Text>
        )}
      </Pressable>
      <Pressable onPress={keep} disabled={!!busy} hitSlop={10}>
        <Text style={[styles.link, { color: t.accent }]}>
          Keep it — it's mine too
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
    zIndex: 120,
  },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 8 },
  strong: { fontWeight: '800' },
  button: {
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  outline: { borderWidth: 1.5 },
  buttonText: { fontSize: 16, fontWeight: '800' },
  link: { fontSize: 14, fontWeight: '700', marginTop: 6 },
});
