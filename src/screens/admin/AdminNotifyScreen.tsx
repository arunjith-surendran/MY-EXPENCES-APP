import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../../App';
import { useAuth } from '../../lib/auth/AuthContext';
import type { TeamNotification } from '../../lib/notifications';
import { useTheme } from '../../lib/theme';
import {
  type AdminUser,
  Badge,
  Button,
  Card,
  Chip,
  displayName,
  SectionTitle,
  shortDate,
  styles,
} from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminNotify'>;

type Audience = 'all' | 'trial' | 'free' | 'pro' | 'user';

const AUDIENCES: [Audience, string][] = [
  ['all', 'Everyone'],
  ['trial', 'Trial users'],
  ['free', 'Free users'],
  ['pro', 'Pro users'],
  ['user', 'Choose users'],
];

type Sent = TeamNotification & { audience: Audience; userId: string | null };

/**
 * Compose a notification for everyone, a plan group, or hand-picked users. It reaches
 * them the next time they open the app (as a banner and in their inbox).
 */
export default function AdminNotifyScreen({ navigation, route }: Props) {
  const t = useTheme();
  const { authedRequest } = useAuth();
  const presetId = route.params?.userId;
  const preset = presetId
    ? { id: presetId, name: route.params?.userName ?? 'this user' }
    : null;
  const [audience, setAudience] = useState<Audience>(preset ? 'user' : 'all');
  const [picked, setPicked] = useState<Map<string, string>>(
    () => new Map(preset ? [[preset.id, preset.name]] : []),
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUser[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent[]>([]);

  const loadSent = useCallback(() => {
    authedRequest<Sent[]>('/admin/notifications')
      .then(setSent)
      .catch(() => {});
  }, [authedRequest]);
  useFocusEffect(loadSent);

  // Search users to pick, while "Choose users" is on.
  useEffect(() => {
    if (audience !== 'user' || presetId) return;
    const q = query.trim();
    const timer = setTimeout(() => {
      authedRequest<AdminUser[]>(
        `/admin/users?filter=all${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      )
        .then(users => setResults(users.slice(0, 30)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [audience, query, authedRequest, presetId]);

  const toggle = (u: AdminUser) =>
    setPicked(prev => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, displayName(u));
      return next;
    });

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Add a title and a message');
      return;
    }
    if (audience === 'user' && picked.size === 0) {
      Alert.alert('Choose at least one user');
      return;
    }
    setBusy(true);
    try {
      const result = await authedRequest<{ sent: number }>(
        '/admin/notifications',
        {
          body: {
            title: title.trim(),
            body: body.trim(),
            audience,
            userIds: audience === 'user' ? [...picked.keys()] : undefined,
          },
        },
      );
      Alert.alert(
        'Sent',
        audience === 'user'
          ? `Sent to ${result.sent} user(s). They'll see it next time they open the app.`
          : "They'll see it next time they open the app.",
      );
      if (preset) {
        navigation.goBack();
        return;
      }
      setTitle('');
      setBody('');
      loadSent();
    } catch (e) {
      Alert.alert('Could not send', String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = (n: Sent) =>
    AUDIENCES.find(([a]) => a === n.audience)?.[1] ?? n.audience;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <SectionTitle>Who gets it</SectionTitle>
      {preset ? (
        <Card>
          <Text style={[styles.title, { color: t.text }]}>
            Only {preset.name}
          </Text>
        </Card>
      ) : (
        <View style={styles.chips}>
          {AUDIENCES.map(([a, text]) => (
            <Chip
              key={a}
              label={text}
              on={audience === a}
              onPress={() => setAudience(a)}
            />
          ))}
        </View>
      )}

      {audience === 'user' && !preset && (
        <>
          {picked.size > 0 && (
            <Text style={[styles.meta, styles.mt10, { color: t.muted }]}>
              {picked.size} chosen: {[...picked.values()].join(', ')}
            </Text>
          )}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or email"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              styles.mt10,
              { backgroundColor: t.card, color: t.text },
            ]}
          />
          <Card>
            {results.length === 0 ? (
              <Text style={[styles.meta, { color: t.muted }]}>
                No users found
              </Text>
            ) : (
              results.map(u => {
                const on = picked.has(u.id);
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => toggle(u)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={[styles.row, styles.mt6]}
                  >
                    <Text
                      style={[styles.title, { color: on ? t.accent : t.muted }]}
                    >
                      {on ? '☑' : '☐'}
                    </Text>
                    <View style={styles.flex}>
                      <Text style={[styles.meta, { color: t.text }]}>
                        {displayName(u)}
                      </Text>
                      {u.email && (
                        <Text style={[styles.meta, { color: t.muted }]}>
                          {u.email}
                        </Text>
                      )}
                    </View>
                    <Badge kind={u.plan} />
                  </Pressable>
                );
              })
            )}
          </Card>
        </>
      )}

      <SectionTitle>Title</SectionTitle>
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={80}
        placeholder="e.g. New: cash expenses"
        placeholderTextColor={t.muted}
        style={[styles.input, { backgroundColor: t.card, color: t.text }]}
      />
      <SectionTitle>Message</SectionTitle>
      <TextInput
        value={body}
        onChangeText={setBody}
        maxLength={300}
        multiline
        placeholder="e.g. You can now add cash payments from the dashboard."
        placeholderTextColor={t.muted}
        style={[
          styles.input,
          styles.multiline,
          { backgroundColor: t.card, color: t.text },
        ]}
      />

      <View style={styles.mt20}>
        <Button label="Send notification" busy={busy} onPress={send} />
      </View>
      <Text style={[styles.meta, styles.mt10, { color: t.muted }]}>
        Shown as a notification the next time each person opens Expences, and
        kept in their inbox (bell on the dashboard).
      </Text>

      {!preset && sent.length > 0 && (
        <>
          <SectionTitle>Recently sent</SectionTitle>
          {sent.slice(0, 20).map(n => (
            <Card key={n.id}>
              <Text style={[styles.title, { color: t.text }]}>{n.title}</Text>
              <Text style={[styles.meta, { color: t.text }]}>{n.body}</Text>
              <Text style={[styles.meta, styles.mt6, { color: t.muted }]}>
                {n.kind === 'offer' ? '🎁 Offer · ' : ''}
                {label(n)} · {shortDate(n.createdAt)}
              </Text>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}
