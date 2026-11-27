import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type Backup,
  canEncrypt,
  canSaveFiles,
  type LockedBox,
  pickBackup,
  restoreBackup,
  shareBackup,
  summarize,
  unlockBackup,
} from '../lib/backup';
import { emitDataChanged } from '../lib/dataEvents';
import { getMeta, setMeta } from '../lib/db';
import { runUpkeep } from '../lib/upkeep';
import { useTheme } from '../lib/theme';
import { useTrackFeature } from '../lib/usage';

const LAST_BACKUP_KEY = 'last_backup_at';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Saves everything on the phone (expenses, salary, categories, budgets, recurring
 * payments, receipts) as one file, and brings it back on this or another phone.
 */
export default function BackupScreen() {
  const t = useTheme();
  const track = useTrackFeature();
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  // Optional password for the backup file.
  const [lock, setLock] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // A password-protected backup waiting for its password.
  const [locked, setLocked] = useState<LockedBox | null>(null);
  const [unlockWith, setUnlockWith] = useState('');

  useFocusEffect(
    useCallback(() => {
      getMeta(LAST_BACKUP_KEY)
        .then(setLast)
        .catch(() => {});
    }, []),
  );

  const backup = async () => {
    if (lock) {
      if (password.length < 6) {
        Alert.alert('Use a password of at least 6 characters');
        return;
      }
      if (password !== confirm) {
        Alert.alert("The passwords don't match");
        return;
      }
    }
    setBusy(lock ? 'Encrypting backup…' : 'Preparing backup…');
    try {
      const n = await shareBackup(photos, lock ? password : undefined);
      track('backup');
      const now = new Date().toISOString();
      await setMeta(LAST_BACKUP_KEY, now);
      setLast(now);
      if (n === 0) Alert.alert('Backup saved', 'There were no expenses yet.');
    } catch (err) {
      Alert.alert(
        "Couldn't back up",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    try {
      const picked = await pickBackup();
      if (!picked) return;
      if (picked.locked) {
        setUnlockWith('');
        setLocked(picked.box);
        return;
      }
      confirmRestore(picked.backup);
    } catch (err) {
      Alert.alert(
        "Couldn't open the backup",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const unlock = async () => {
    if (!locked) return;
    setBusy('Unlocking…');
    try {
      const file = await unlockBackup(locked, unlockWith);
      setLocked(null);
      setBusy(null);
      confirmRestore(file);
    } catch (err) {
      setBusy(null);
      Alert.alert(
        "Couldn't open the backup",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const confirmRestore = (file: Backup) => {
    const s = summarize(file);
    Alert.alert(
      'Restore this backup?',
      `${s.expenses} expense${s.expenses === 1 ? '' : 's'}${
        s.receipts
          ? ` and ${s.receipts} receipt photo${s.receipts === 1 ? '' : 's'}`
          : ''
      }, saved ${when(
        s.createdAt,
      )}.\n\nAdd keeps what's on this phone and adds what's missing. Replace makes this phone exactly like the backup.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace everything',
          style: 'destructive',
          onPress: () => run(file, 'replace'),
        },
        { text: 'Add missing', onPress: () => run(file, 'merge') },
      ],
    );
  };

  const run = async (file: Backup, mode: 'replace' | 'merge') => {
    setBusy('Restoring…');
    try {
      const added = await restoreBackup(file, mode);
      track('restore');
      await runUpkeep();
      emitDataChanged();
      Alert.alert(
        'Restored',
        mode === 'replace'
          ? `${added} expense${added === 1 ? '' : 's'} restored.`
          : `${added} expense${
              added === 1 ? '' : 's'
            } added. Ones already here were skipped.`,
      );
    } catch (err) {
      Alert.alert("Couldn't restore", String(err));
    } finally {
      setBusy(null);
    }
  };

  const card = [
    styles.card,
    { backgroundColor: t.card, borderColor: t.border },
  ];
  const supported = canSaveFiles();

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
    >
      <View style={[styles.hero, { backgroundColor: t.accent }]}>
        <Text style={styles.heroIcon}>🛟</Text>
        <Text style={[styles.heroTitle, { color: t.onAccent }]}>
          Your data lives only on this phone
        </Text>
        <Text style={[styles.heroBody, { color: t.onAccent }]}>
          Deleting the app or losing the phone loses it. Save a backup to Files,
          iCloud Drive or email now and then — it never goes through our
          servers.
        </Text>
        <Text style={[styles.heroMeta, { color: t.onAccent }]}>
          {last ? `Last backup: ${when(last)}` : 'No backup yet'}
        </Text>
      </View>

      {!supported && (
        <Text style={{ color: t.danger }}>
          This build can't save files. Install the latest version.
        </Text>
      )}

      <View style={card}>
        <Text style={[styles.title, { color: t.text }]}>Back up</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          Expenses, salary, your categories and remembered merchants, budgets
          and recurring payments, in one .json file.
        </Text>
        <View style={styles.switchRow}>
          <Text style={[styles.flex, { color: t.text }]}>
            Include receipt photos
          </Text>
          <Switch value={photos} onValueChange={setPhotos} />
        </View>
        {canEncrypt() && (
          <View style={styles.switchRow}>
            <Text style={[styles.flex, { color: t.text }]}>
              🔒 Protect with a password
            </Text>
            <Switch value={lock} onValueChange={setLock} />
          </View>
        )}
        {lock && (
          <>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password (6+ characters)"
              placeholderTextColor={t.muted}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
              style={[
                styles.input,
                { color: t.text, backgroundColor: t.cardHi },
              ]}
            />
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Same password again"
              placeholderTextColor={t.muted}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
              style={[
                styles.input,
                { color: t.text, backgroundColor: t.cardHi },
              ]}
            />
            <Text style={[styles.body, { color: t.warning }]}>
              Without this password the backup can't be opened — not even by us.
              Keep it somewhere safe.
            </Text>
          </>
        )}
        <Pressable
          onPress={backup}
          disabled={!!busy || !supported}
          style={[
            styles.button,
            { backgroundColor: t.accent },
            (!!busy || !supported) && styles.dimmed,
          ]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            Save backup…
          </Text>
        </Pressable>
      </View>

      <View style={card}>
        <Text style={[styles.title, { color: t.text }]}>Restore</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          Pick a backup file. You can add what's missing, or replace everything
          on this phone with it.
        </Text>
        <Pressable
          onPress={restore}
          disabled={!!busy || !supported}
          style={[
            styles.button,
            styles.outline,
            { borderColor: t.accent },
            (!!busy || !supported) && styles.dimmed,
          ]}
        >
          <Text style={[styles.buttonText, { color: t.accent }]}>
            Restore from backup…
          </Text>
        </Pressable>
      </View>

      {locked && (
        <View style={[card, { borderColor: t.accent }]}>
          <Text style={[styles.title, { color: t.text }]}>
            🔒 This backup has a password
          </Text>
          <TextInput
            value={unlockWith}
            onChangeText={setUnlockWith}
            onSubmitEditing={unlock}
            placeholder="Backup password"
            placeholderTextColor={t.muted}
            secureTextEntry
            autoCapitalize="none"
            autoFocus
            style={[styles.input, { color: t.text, backgroundColor: t.cardHi }]}
          />
          <View style={styles.row}>
            <Pressable
              onPress={() => setLocked(null)}
              style={[styles.button, styles.outline, { borderColor: t.border }]}
            >
              <Text style={[styles.buttonText, { color: t.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={unlock}
              disabled={!unlockWith || !!busy}
              style={[
                styles.button,
                styles.flex,
                { backgroundColor: t.accent },
                (!unlockWith || !!busy) && styles.dimmed,
              ]}
            >
              <Text style={[styles.buttonText, { color: t.onAccent }]}>
                Unlock
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator />
          <Text style={{ color: t.muted }}>{busy}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40, gap: 12 },
  flex: { flex: 1 },
  hero: { padding: 20, borderRadius: 20, gap: 8 },
  heroIcon: { fontSize: 34 },
  heroTitle: { fontSize: 20, fontWeight: '900' },
  heroBody: { fontSize: 14, lineHeight: 20, opacity: 0.92 },
  heroMeta: { fontSize: 12, fontWeight: '700', opacity: 0.85, marginTop: 4 },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  button: { padding: 15, borderRadius: 14, alignItems: 'center' },
  outline: { borderWidth: 1.5 },
  buttonText: { fontWeight: '800', fontSize: 15 },
  dimmed: { opacity: 0.5 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  row: { flexDirection: 'row', gap: 10 },
});
