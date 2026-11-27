import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
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
import {
  type Asset,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { config } from '../config';
import { useAuth } from '../lib/auth/AuthContext';
import { setMeta } from '../lib/db';
import { glow, useTheme } from '../lib/theme';

type Topic = 'complaint' | 'suggestion' | 'bug' | 'billing' | 'other';

type Message = {
  id: string;
  sender: 'user' | 'support' | 'bot';
  topic: Topic | null;
  body: string;
  createdAt: string;
  attachments: { id: string }[];
};

const TOPICS: { id: Topic; label: string; prompt: string }[] = [
  {
    id: 'complaint',
    label: '😟 Complaint',
    prompt:
      'Sorry something went wrong. Tell us what happened; a screenshot helps us fix it faster.',
  },
  {
    id: 'suggestion',
    label: '💡 Suggestion',
    prompt: "We'd love to hear it! What should Expences do better or add next?",
  },
  {
    id: 'bug',
    label: '🐞 Report a bug',
    prompt:
      'What did you do, what happened, and what did you expect? Add a screenshot if you can.',
  },
  {
    id: 'billing',
    label: '💳 Subscription',
    prompt: 'Tell us about the problem with your plan or payment.',
  },
  {
    id: 'other',
    label: '💬 Something else',
    prompt: "Go ahead, we're listening.",
  },
];

const MAX_IMAGES = 3;
const POLL_MS = 20_000;
/** When the chat was last loaded on screen (unix ms); HomeScreen compares support replies to it. */
export const SEEN_KEY = 'support_seen_at';

const bot = (id: string, body: string, at = new Date()): Message => ({
  id,
  sender: 'bot',
  topic: null,
  body,
  createdAt: at.toISOString(),
  attachments: [],
});

/**
 * A chat with the Expences team for complaints, suggestions and bug reports, with photos.
 * A small scripted helper greets and asks for the topic; people at Expences reply in the same thread.
 */
export default function SupportScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, authedRequest, getAccessToken } = useAuth();
  const [thread, setThread] = useState<Message[]>([]);
  const [local, setLocal] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<Asset[]>([]);
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const list = useRef<FlatList<Message>>(null);

  const load = useCallback(() => {
    authedRequest<Message[]>('/support/messages')
      .then(next => {
        setThread(next);
        // Everything shown is now read: clears the dot on Home's chat button.
        setMeta(SEEN_KEY, String(Date.now())).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    getAccessToken()
      .then(setToken)
      .catch(() => {});
  }, [authedRequest, getAccessToken]);

  // Load when opened, then check for replies every little while.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const greeting = useMemo(() => {
    const first = user?.name?.split(' ')[0];
    return bot(
      'greeting',
      `Hi${
        first ? ` ${first}` : ''
      } 👋 This is Expences help. Got a complaint, an idea, or found a bug? Pick a topic below and tell us. You can add photos too.`,
      new Date(0),
    );
  }, [user?.name]);

  const messages = useMemo(
    () =>
      [greeting, ...thread, ...local].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
      ),
    [greeting, thread, local],
  );

  useEffect(() => {
    if (!loading) {
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length, loading]);

  const chooseTopic = (next: Topic) => {
    setTopic(next);
    const prompt = TOPICS.find(x => x.id === next)!.prompt;
    setLocal(prev => [...prev, bot(`topic-${Date.now()}`, prompt)]);
  };

  const addFrom = (source: 'library' | 'camera') => {
    const options = {
      mediaType: 'photo' as const,
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.7 as const,
    };
    const done = (response: { assets?: Asset[]; errorMessage?: string }) => {
      if (response.errorMessage) {
        Alert.alert('Could not add the photo', response.errorMessage);
        return;
      }
      setImages(prev =>
        [...prev, ...(response.assets ?? [])].slice(0, MAX_IMAGES),
      );
    };
    if (source === 'camera') launchCamera(options, done);
    else
      launchImageLibrary(
        { ...options, selectionLimit: MAX_IMAGES - images.length },
        done,
      );
  };

  const attach = () => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert(`Up to ${MAX_IMAGES} photos per message`);
      return;
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Choose photo', 'Take photo', 'Cancel'],
          cancelButtonIndex: 2,
        },
        i => (i === 0 ? addFrom('library') : i === 1 && addFrom('camera')),
      );
    } else {
      Alert.alert('Add a photo', undefined, [
        { text: 'Choose photo', onPress: () => addFrom('library') },
        { text: 'Take photo', onPress: () => addFrom('camera') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && images.length === 0) || sending) return;
    const form = new FormData();
    form.append('body', body);
    form.append('topic', topic ?? 'other');
    form.append('device', `${Platform.OS} ${Platform.Version}`);
    images.forEach((image, i) =>
      form.append('images', {
        uri: image.uri,
        type: image.type ?? 'image/jpeg',
        name: image.fileName ?? `photo-${i + 1}.jpg`,
      } as unknown as Blob),
    );
    setSending(true);
    try {
      const saved = await authedRequest<Message>('/support/messages', {
        body: form,
      });
      const first = !thread.some(m => m.sender === 'user');
      setThread(prev => [...prev, saved]);
      setText('');
      setImages([]);
      setTopic(null);
      setLocal(prev => [
        ...prev,
        bot(
          `thanks-${saved.id}`,
          first
            ? 'Thanks! Your message reached the Expences team. We usually reply within 1–2 days, right here in this chat.'
            : 'Got it, thanks! We’ll reply here.',
          new Date(Date.parse(saved.createdAt) + 1),
        ),
      ]);
    } catch (error) {
      Alert.alert(
        'Message not sent',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSending(false);
    }
  };

  const imageSource = (id: string) => ({
    uri: `${config.apiUrl}/support/attachments/${id}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const canSend = (text.trim().length > 0 || images.length > 0) && !sending;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: t.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          loading ? <ActivityIndicator style={styles.loading} /> : undefined
        }
        renderItem={({ item: m }) => {
          const mine = m.sender === 'user';
          return (
            <View style={[styles.bubbleRow, mine && styles.mineRow]}>
              {!mine && (
                <Text style={[styles.who, { color: t.muted }]}>
                  {m.sender === 'support' ? 'Expences team' : 'Expences help'}
                </Text>
              )}
              <View
                style={[
                  styles.bubble,
                  mine
                    ? [styles.mine, { backgroundColor: t.accent }]
                    : [
                        styles.theirs,
                        { backgroundColor: t.card, borderColor: t.border },
                      ],
                ]}
              >
                {mine && m.topic && (
                  <Text style={[styles.topicTag, { color: t.onAccent }]}>
                    {TOPICS.find(x => x.id === m.topic)?.label}
                  </Text>
                )}
                {m.attachments.length > 0 && (
                  <View style={styles.photos}>
                    {m.attachments.map(a => (
                      <Pressable key={a.id} onPress={() => setViewing(a.id)}>
                        <Image
                          source={imageSource(a.id)}
                          style={[styles.photo, { backgroundColor: t.cardHi }]}
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
                {m.body ? (
                  <Text
                    style={[styles.body, { color: mine ? t.onAccent : t.text }]}
                  >
                    {m.body}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.time, { color: t.muted }]}>
                {m.id === 'greeting'
                  ? ''
                  : new Date(m.createdAt).toLocaleString('en-AE', {
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
          styles.composer,
          {
            backgroundColor: t.card,
            borderTopColor: t.border,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <FlatList
          horizontal
          data={TOPICS}
          keyExtractor={x => x.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.topics}
          renderItem={({ item: x }) => {
            const on = topic === x.id;
            return (
              <Pressable
                onPress={() => chooseTopic(x.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[
                  styles.topic,
                  {
                    backgroundColor: on ? t.accent : t.cardHi,
                    borderColor: on ? t.accent : t.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.topicText,
                    { color: on ? t.onAccent : t.text },
                  ]}
                >
                  {x.label}
                </Text>
              </Pressable>
            );
          }}
        />

        {images.length > 0 && (
          <View style={styles.pending}>
            {images.map((image, i) => (
              <View key={image.uri ?? i}>
                <Image source={{ uri: image.uri }} style={styles.thumb} />
                <Pressable
                  onPress={() =>
                    setImages(prev => prev.filter((_, j) => j !== i))
                  }
                  hitSlop={8}
                  accessibilityLabel="Remove photo"
                  style={[styles.remove, { backgroundColor: t.text }]}
                >
                  <Text style={[styles.removeText, { color: t.bg }]}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.inputRow}>
          <Pressable
            onPress={attach}
            hitSlop={8}
            accessibilityLabel="Add photo"
            style={[styles.iconButton, { backgroundColor: t.cardHi }]}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M21 12.5 12.8 20.7a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"
                stroke={t.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={
              topic ? 'Type your message…' : 'Pick a topic, then type…'
            }
            placeholderTextColor={t.muted}
            multiline
            maxLength={4000}
            style={[styles.input, { color: t.text, backgroundColor: t.cardHi }]}
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            accessibilityLabel="Send"
            style={[
              styles.iconButton,
              { backgroundColor: canSend ? t.accent : t.cardHi },
              canSend && glow(t.accent, 8),
            ]}
          >
            {sending ? (
              <ActivityIndicator color={t.onAccent} />
            ) : (
              <Svg width={20} height={20} viewBox="0 0 24 24">
                <Path
                  d="M12 19V5M5 12l7-7 7 7"
                  stroke={canSend ? t.onAccent : t.muted}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            )}
          </Pressable>
        </View>
      </View>

      <Modal
        visible={viewing != null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <Pressable style={styles.viewer} onPress={() => setViewing(null)}>
          {viewing && (
            <Image
              source={imageSource(viewing)}
              style={styles.full}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 8 },
  loading: { marginTop: 16 },
  bubbleRow: { marginBottom: 12, alignItems: 'flex-start' },
  mineRow: { alignItems: 'flex-end' },
  who: { fontSize: 11, fontWeight: '700', marginBottom: 3, marginLeft: 4 },
  bubble: { maxWidth: '82%', padding: 12, borderRadius: 18 },
  mine: { borderBottomRightRadius: 6 },
  theirs: { borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  topicTag: { fontSize: 11, fontWeight: '800', opacity: 0.85, marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 21 },
  time: { fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  photo: { width: 120, height: 120, borderRadius: 12 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  topics: { paddingHorizontal: 12, gap: 8 },
  topic: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  topicText: { fontSize: 13, fontWeight: '700' },
  pending: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 11, fontWeight: '900' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { width: '100%', height: '80%' },
});
