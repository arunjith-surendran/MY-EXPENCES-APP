import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../../App';
import { config } from '../../config';
import { useAuth } from '../../lib/auth/AuthContext';
import { useTheme } from '../../lib/theme';
import { styles as ui } from './ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminChat'>;

type Message = {
  id: string;
  sender: 'user' | 'support';
  topic: string | null;
  body: string;
  createdAt: string;
  attachments: { id: string }[];
};

/** One user's help chat, answered as the Expences team. */
export default function AdminChatScreen({ navigation, route }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { authedRequest, getAccessToken } = useAuth();
  const { userId, name } = route.params;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const list = useRef<FlatList<Message>>(null);

  useEffect(() => {
    navigation.setOptions({ title: name });
  }, [navigation, name]);

  const load = useCallback(() => {
    authedRequest<Message[]>(`/admin/support/users/${userId}`)
      .then(setMessages)
      .catch(() => setMessages([]));
    getAccessToken()
      .then(setToken)
      .catch(() => {});
  }, [authedRequest, getAccessToken, userId]);

  useFocusEffect(load);

  useEffect(() => {
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [messages?.length]);

  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const saved = await authedRequest<Message>(
        `/admin/support/users/${userId}/reply`,
        { body: { body } },
      );
      setMessages(prev => [...(prev ?? []), saved]);
      setReply('');
    } catch (e) {
      Alert.alert('Reply not sent', String(e));
    } finally {
      setSending(false);
    }
  };

  const image = (id: string) => ({
    uri: `${config.apiUrl}/admin/support/attachments/${id}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!messages) return <ActivityIndicator style={ui.loader} />;

  return (
    <KeyboardAvoidingView
      style={[ui.flex, { backgroundColor: t.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={ui.padded}
        ListEmptyComponent={
          <Text style={[ui.empty, { color: t.muted }]}>No messages.</Text>
        }
        renderItem={({ item: m }) => {
          // Here "mine" is the team's side.
          const mine = m.sender === 'support';
          return (
            <View style={[s.row, mine && s.mineRow]}>
              <View
                style={[
                  s.bubble,
                  mine
                    ? [s.mine, { backgroundColor: t.accent }]
                    : [
                        s.theirs,
                        { backgroundColor: t.card, borderColor: t.border },
                      ],
                ]}
              >
                {m.topic && (
                  <Text style={[s.topic, { color: t.muted }]}>{m.topic}</Text>
                )}
                {m.attachments.length > 0 && (
                  <View style={s.photos}>
                    {m.attachments.map(a => (
                      <Pressable key={a.id} onPress={() => setViewing(a.id)}>
                        <Image
                          source={image(a.id)}
                          style={[s.photo, { backgroundColor: t.cardHi }]}
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
                {m.body ? (
                  <Text style={[s.body, { color: mine ? t.onAccent : t.text }]}>
                    {m.body}
                  </Text>
                ) : null}
              </View>
              <Text style={[s.time, { color: t.muted }]}>
                {new Date(m.createdAt).toLocaleString('en-AE', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          );
        }}
      />

      <View
        style={[
          s.composer,
          {
            backgroundColor: t.card,
            borderTopColor: t.border,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="Reply as the Expences team…"
          placeholderTextColor={t.muted}
          multiline
          maxLength={4000}
          style={[s.input, { color: t.text, backgroundColor: t.cardHi }]}
        />
        <Pressable
          onPress={send}
          disabled={!reply.trim() || sending}
          style={[
            s.send,
            { backgroundColor: reply.trim() ? t.accent : t.cardHi },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text
              style={[
                s.sendText,
                { color: reply.trim() ? t.onAccent : t.muted },
              ]}
            >
              Send
            </Text>
          )}
        </Pressable>
      </View>

      <Modal
        visible={viewing != null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <Pressable style={s.viewer} onPress={() => setViewing(null)}>
          {viewing && (
            <Image
              source={image(viewing)}
              style={s.full}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  row: { marginBottom: 12, alignItems: 'flex-start' },
  mineRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '82%', padding: 12, borderRadius: 18 },
  mine: { borderBottomRightRadius: 6 },
  theirs: { borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  topic: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  body: { fontSize: 15, lineHeight: 21 },
  time: { fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  photo: { width: 120, height: 120, borderRadius: 12 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  send: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontSize: 15, fontWeight: '800' },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { width: '100%', height: '80%' },
});
