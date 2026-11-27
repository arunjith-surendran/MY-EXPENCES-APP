import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../../lib/auth/AuthContext';
import { type AppVersionConfig, compareVersions } from '../../lib/appVersion';
import { useTheme } from '../../lib/theme';
import { APP_VERSION } from '../../version';
import { Button, Card, SectionTitle, shortDate, styles } from './ui';

type Platform = AppVersionConfig['platform'];

type Draft = {
  latestVersion: string;
  minVersion: string;
  storeUrl: string;
  message: string;
};

const LABEL: Record<Platform, string> = {
  ios: 'iPhone (iOS)',
  android: 'Android',
};
const VERSION = /^\d{1,4}(\.\d{1,4}){0,2}$/;

const toDraft = (c?: AppVersionConfig): Draft => ({
  latestVersion: c?.latestVersion ?? APP_VERSION,
  minVersion: c?.minVersion ?? APP_VERSION,
  storeUrl: c?.storeUrl ?? '',
  message: c?.message ?? '',
});

/**
 * Latest and required app version per platform. Older than "required" is blocked until
 * it updates (force update); older than "latest" gets a dismissible "update available".
 */
export default function AdminVersionsScreen() {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const [configs, setConfigs] = useState<AppVersionConfig[] | null>(null);
  const [drafts, setDrafts] = useState<Record<Platform, Draft>>({
    ios: toDraft(),
    android: toDraft(),
  });
  const [busy, setBusy] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      authedRequest<AppVersionConfig[]>('/admin/app-versions')
        .then(list => {
          setConfigs(list);
          setDrafts({
            ios: toDraft(list.find(c => c.platform === 'ios')),
            android: toDraft(list.find(c => c.platform === 'android')),
          });
          setError(null);
        })
        .catch(e => setError(e instanceof Error ? e.message : String(e))),
    [authedRequest],
  );
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const edit = (platform: Platform, patch: Partial<Draft>) =>
    setDrafts(prev => ({
      ...prev,
      [platform]: { ...prev[platform], ...patch },
    }));

  const save = async (platform: Platform, draft: Draft) => {
    if (!VERSION.test(draft.latestVersion) || !VERSION.test(draft.minVersion)) {
      Alert.alert('Use versions like 1.2.0');
      return;
    }
    if (compareVersions(draft.minVersion, draft.latestVersion) > 0) {
      Alert.alert("Required can't be newer than latest");
      return;
    }
    setBusy(platform);
    try {
      await authedRequest(`/admin/app-versions/${platform}`, {
        method: 'PUT',
        body: {
          latestVersion: draft.latestVersion,
          minVersion: draft.minVersion,
          storeUrl: draft.storeUrl,
          message: draft.message,
        },
      });
      await load();
      Alert.alert('Saved', 'Apps check this when they open.');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Makes the latest version the required one: everyone older must update. */
  const forceLatest = (platform: Platform) => {
    const draft = drafts[platform];
    Alert.alert(
      `Force ${draft.latestVersion} on ${LABEL[platform]}?`,
      'Anyone on an older version is blocked until they update from the store.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force update',
          style: 'destructive',
          onPress: () =>
            save(platform, { ...draft, minVersion: draft.latestVersion }),
        },
      ],
    );
  };

  if (!configs) {
    return (
      <View style={[styles.screen, styles.flex, { backgroundColor: t.bg }]}>
        {error ? (
          <Text style={[styles.empty, { color: t.danger }]}>{error}</Text>
        ) : (
          <ActivityIndicator style={styles.loader} />
        )}
      </View>
    );
  }

  const input = [styles.input, { backgroundColor: t.cardHi, color: t.text }];

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <Text style={[styles.meta, styles.relaxed, { color: t.text }]}>
          This phone runs {APP_VERSION}. Older than{' '}
          <Text style={styles.strong}>required</Text> → blocked until updated.
          Older than <Text style={styles.strong}>latest</Text> → "update
          available", which they can skip.
        </Text>
      </Card>

      {(['ios', 'android'] as const).map(platform => {
        const draft = drafts[platform];
        const saved = configs.find(c => c.platform === platform);
        const forced =
          saved != null &&
          compareVersions(saved.minVersion, saved.latestVersion) === 0;
        return (
          <View key={platform}>
            <SectionTitle>{LABEL[platform]}</SectionTitle>
            <Card>
              <Text style={[styles.meta, { color: t.muted }]}>
                {saved
                  ? `${
                      forced
                        ? 'Latest is required'
                        : `Latest ${saved.latestVersion}, required ${saved.minVersion}`
                    } · updated ${shortDate(saved.updatedAt)}`
                  : 'Not set yet: nobody is asked to update.'}
              </Text>
              <View style={[styles.row, styles.mt6]}>
                <View style={styles.flex}>
                  <Text style={[styles.meta, { color: t.muted }]}>Latest</Text>
                  <TextInput
                    value={draft.latestVersion}
                    onChangeText={v =>
                      edit(platform, { latestVersion: v.trim() })
                    }
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    placeholder="1.1.0"
                    placeholderTextColor={t.muted}
                    style={input}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    Required
                  </Text>
                  <TextInput
                    value={draft.minVersion}
                    onChangeText={v => edit(platform, { minVersion: v.trim() })}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    placeholder="1.0.0"
                    placeholderTextColor={t.muted}
                    style={input}
                  />
                </View>
              </View>
              <Text style={[styles.meta, styles.mt6, { color: t.muted }]}>
                Store link
              </Text>
              <TextInput
                value={draft.storeUrl}
                onChangeText={v => edit(platform, { storeUrl: v })}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={
                  platform === 'ios'
                    ? 'https://apps.apple.com/app/id…'
                    : 'https://play.google.com/store/apps/details?id=…'
                }
                placeholderTextColor={t.muted}
                style={input}
              />
              <Text style={[styles.meta, styles.mt6, { color: t.muted }]}>
                What's new (shown on the update screen)
              </Text>
              <TextInput
                value={draft.message}
                onChangeText={v => edit(platform, { message: v })}
                maxLength={300}
                multiline
                placeholder="e.g. Your own categories, and faster Apple Pay logging."
                placeholderTextColor={t.muted}
                style={[input, styles.multiline]}
              />
              <View style={[styles.gap8, styles.mt10]}>
                <Button
                  label="Save"
                  busy={busy === platform}
                  onPress={() => save(platform, draft)}
                />
                <Button
                  label={`Force everyone to ${draft.latestVersion || 'latest'}`}
                  color={t.danger}
                  outline
                  onPress={() => forceLatest(platform)}
                />
              </View>
            </Card>
          </View>
        );
      })}
    </ScrollView>
  );
}
