import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  type AutoLogRun,
  getAutoLogSince,
  listAutoLogCards,
  listAutoLogRuns,
  markAutoLogWorking,
} from '../lib/db';
import { glow, useTheme } from '../lib/theme';

type Step = { title: string; body?: string; image: ImageSourcePropType };

// Screenshots from a real setup, with the place to tap circled in red.
const STEPS: Step[] = [
  {
    title: 'Open Shortcuts and tap "Automation"',
    body: 'Use the "Open Shortcuts" button above. Automation is in the middle of the bottom bar.',
    image: require('../assets/setup/01-automation-tab.jpg'),
  },
  {
    title: 'Tap "+" at the top right',
    image: require('../assets/setup/02-plus.jpg'),
  },
  {
    title: 'Scroll down and tap "Wallet"',
    body: '"When I tap a Wallet Card or Pass".',
    image: require('../assets/setup/03-wallet.jpg'),
  },
  {
    title: 'Tick all your cards (1), then tap "Next" (2)',
    body: 'Leave every category ticked.',
    image: require('../assets/setup/04-cards.jpg'),
  },
  {
    title: 'Choose "Run Immediately" (1), then "Next" (2)',
    body: 'Scroll to the bottom to find it. Otherwise iOS asks you every time.',
    image: require('../assets/setup/05-run-immediately.jpg'),
  },
  {
    title: 'Tap "Create New Shortcut"',
    image: require('../assets/setup/06-create-new.jpg'),
  },
  {
    title: 'Search "save" (1), tap "Save Apple Pay Payment" (2)',
    body: 'It has the green Expences icon.',
    image: require('../assets/setup/07-search-save.jpg'),
  },
  {
    title: 'Tap the word "Amount" (1), then "Select Variable" (2)',
    body: 'Then tap the top box "Receive transaction as input".',
    image: require('../assets/setup/08-tap-amount.jpg'),
  },
  {
    title: 'Tap the blue "Shortcut Input" once',
    body: 'If the keyboard is open, close it first with the blue ✓ key.',
    image: require('../assets/setup/09-pick-input.jpg'),
  },
  {
    title: 'Choose "Amount" from the list',
    body: 'Optional, for shop and card names: do the same for "Merchant" (choose Merchant) and "Card" (choose Card or Pass).',
    image: require('../assets/setup/10-choose-amount.jpg'),
  },
  {
    title: 'Tap ✓ at the top, then "Done"',
    body: 'Check it says "Run Immediately" and "Notify When Run" is off.',
    image: require('../assets/setup/11-done.jpg'),
  },
  {
    title: 'All set',
    body: 'The automation shows "Save Apple Pay Payment". Pay once with Apple Pay and check "Recent automation runs" above.',
    image: require('../assets/setup/12-all-set.jpg'),
  },
];

export default function SetupScreen() {
  const t = useTheme();
  const [since, setSince] = useState<number | null>(null);
  const [cards, setCards] = useState<string[]>([]);
  const [showSteps, setShowSteps] = useState(false);
  const [runs, setRuns] = useState<AutoLogRun[]>([]);
  const [zoom, setZoom] = useState<ImageSourcePropType | null>(null);
  const refresh = useCallback(() => {
    getAutoLogSince()
      .then(setSince)
      .catch(() => {});
    listAutoLogCards()
      .then(setCards)
      .catch(() => {});
    listAutoLogRuns()
      .then(setRuns)
      .catch(() => {});
  }, []);
  useFocusEffect(refresh);
  const markDone = () => markAutoLogWorking().then(refresh);
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View
        style={[
          styles.step,
          {
            backgroundColor: t.card,
            borderColor: since ? t.success : t.border,
          },
        ]}
      >
        <Text style={[styles.heavy, { color: since ? t.success : t.muted }]}>
          {since ? '✓ Setup complete' : 'Not set up yet'}
        </Text>
        <Text style={[styles.body, styles.stepBody, { color: t.muted }]}>
          {since
            ? `Apple Pay payments are saved automatically. On since ${new Date(
                since,
              ).toLocaleDateString('en-AE', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}.`
            : 'Follow the steps below, then pay once with Apple Pay. This turns green when it works.'}
        </Text>
        {since != null && (
          <Text style={[styles.body, styles.stepBody, { color: t.text }]}>
            {cards.length > 0
              ? `Connected cards:\n${cards.map(c => `• ${c}`).join('\n')}`
              : 'Connected cards will appear here after your first Apple Pay tap.'}
          </Text>
        )}
      </View>

      {since == null && (
        <Pressable
          onPress={markDone}
          style={[styles.button, { backgroundColor: t.accent }, glow(t.accent)]}
        >
          <Text style={[styles.heavy, { color: t.onAccent }]}>
            I've finished the setup ✓
          </Text>
        </Pressable>
      )}

      <View
        style={[
          styles.step,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Text style={[styles.heavy, { color: t.text }]}>
          Recent automation runs
        </Text>
        {runs.length === 0 ? (
          <Text style={[styles.body, styles.stepBody, { color: t.muted }]}>
            None yet. After your next Apple Pay payment, the result shows here —
            saved, skipped as a duplicate, or the exact error. If a payment
            doesn't appear here at all, the automation didn't run.
          </Text>
        ) : (
          runs.map(r => {
            const color =
              r.status === 'saved'
                ? t.success
                : r.status === 'duplicate'
                ? t.warning
                : t.danger;
            const label =
              r.status === 'saved'
                ? '✓ Saved'
                : r.status === 'duplicate'
                ? 'Skipped (duplicate)'
                : '✕ Failed';
            return (
              <View
                key={r.id}
                style={[styles.run, { borderTopColor: t.border }]}
              >
                <View style={styles.runRow}>
                  <Text style={[styles.semi, { color }]}>{label}</Text>
                  <Text style={[styles.runMeta, { color: t.muted }]}>
                    {new Date(r.at).toLocaleString('en-AE', {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text style={[styles.runMeta, { color: t.text }]} selectable>
                  {[r.amount, r.merchant, r.card].filter(Boolean).join(' · ') ||
                    'No values received'}
                </Text>
                {r.message ? (
                  <Text
                    style={[styles.runMeta, { color: t.danger }]}
                    selectable
                  >
                    {r.message}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {since != null && (
        <Pressable
          onPress={() => setShowSteps(v => !v)}
          style={[styles.button, { borderColor: t.border }]}
        >
          <Text style={[styles.semi, { color: t.muted }]}>
            {showSteps ? 'Hide setup steps' : 'Show setup steps'}
          </Text>
        </Pressable>
      )}

      {(since == null || showSteps) && (
        <>
          <Text style={[styles.body, { color: t.muted }]}>
            iOS doesn't let apps read Apple Pay payments directly, but the
            Shortcuts app can run an automation every time you tap. It then
            sends the amount, shop and card to this app, which saves them in the
            background. One-time setup, about 3 minutes.
          </Text>

          <Pressable
            onPress={() => Linking.openURL('shortcuts://')}
            style={[
              styles.button,
              { backgroundColor: t.accent },
              glow(t.accent),
            ]}
          >
            <Text style={[styles.heavy, { color: t.onAccent }]}>
              Open Shortcuts
            </Text>
          </Pressable>

          {STEPS.map((s, i) => (
            <View
              key={i}
              style={[
                styles.step,
                { backgroundColor: t.card, borderColor: t.border },
              ]}
            >
              <Text style={[styles.heavy, { color: t.accent }]}>
                Step {i + 1}
              </Text>
              <Text style={[styles.stepTitle, { color: t.text }]}>
                {s.title}
              </Text>
              {s.body ? (
                <Text
                  selectable
                  style={[styles.body, styles.stepBody, { color: t.muted }]}
                >
                  {s.body}
                </Text>
              ) : null}
              <Pressable
                onPress={() => setZoom(s.image)}
                accessibilityLabel={`Step ${i + 1} screenshot, tap to enlarge`}
              >
                <Image
                  source={s.image}
                  style={[styles.shot, { borderColor: t.border }]}
                  resizeMode="cover"
                />
              </Pressable>
            </View>
          ))}
        </>
      )}

      <Modal
        visible={zoom != null}
        transparent
        animationType="fade"
        onRequestClose={() => setZoom(null)}
      >
        <Pressable style={styles.zoomBg} onPress={() => setZoom(null)}>
          {zoom != null && (
            <Image source={zoom} style={styles.zoomImg} resizeMode="contain" />
          )}
          <Text style={styles.zoomHint}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  body: { lineHeight: 20 },
  stepBody: { marginTop: 6 },
  stepTitle: { fontWeight: '600', marginTop: 2 },
  heavy: { fontWeight: '700' },
  semi: { fontWeight: '600' },
  run: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  runRow: { flexDirection: 'row', justifyContent: 'space-between' },
  runMeta: { fontSize: 13, marginTop: 2 },
  step: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  shot: {
    marginTop: 12,
    alignSelf: 'center',
    width: '78%',
    aspectRatio: 420 / 912,
    borderRadius: 18,
    borderWidth: 1,
  },
  zoomBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImg: { width: '92%', height: '86%' },
  zoomHint: { color: '#9A93C9', marginTop: 10 },
  button: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
});
