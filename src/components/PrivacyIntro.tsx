import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCENE_MS = 4800;
const BLUE = '#1F4FD1';
const RED = '#F05252';
const GREEN = '#13804B';

type Scene = { title: string; body: string; art: () => ReactNode };

// Every claim here matches the code: card numbers never reach the app (the Wallet
// automation sends amount, merchant and card *name*), statements are read on the
// phone (PDFKit), and the server keeps only the account (name, email, password hash).
const SCENES: Scene[] = [
  {
    title: 'Your money stays yours',
    body: 'Expences tracks what you spend. Here is exactly what we do, and what we never do.',
    art: LogoArt,
  },
  {
    title: 'We never store your card',
    body: 'Apple Pay shares only the amount, the shop and your card’s nickname. Never the card number, CVV or PIN.',
    art: CardArt,
  },
  {
    title: 'Expenses stay on this iPhone',
    body: 'Every expense and every statement you import is read and saved on this device only. Nothing is uploaded.',
    art: PhoneArt,
  },
  {
    title: 'No access to your bank',
    body: 'We never ask for bank logins and can’t see your accounts. You choose what to import.',
    art: BankArt,
  },
  {
    title: 'Your account holds the basics',
    body: 'Just your name, email and a scrambled password. Delete it anytime from Account.',
    art: AccountArt,
  },
];

/**
 * A short animated explainer of what the app does with your data, played like a
 * story: progress bars, tap to go forward or back, Skip, and "Got it" at the end.
 */
export default function PrivacyIntro({
  onDone,
  paused = false,
}: {
  onDone: () => void;
  /** Hold on the first scene (e.g. while the splash still covers it). */
  paused?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const progress = useSharedValue(0);
  const last = index === SCENES.length - 1;

  const go = useCallback((next: number) => {
    if (next < 0) return;
    if (next >= SCENES.length) return;
    setIndex(next);
  }, []);

  // Fill this scene's bar, then move on (the last scene waits for "Got it").
  useEffect(() => {
    progress.value = 0;
    if (paused) return;
    progress.value = withTiming(1, {
      duration: SCENE_MS,
      easing: Easing.linear,
    });
    const scene = SCENES[index];
    AccessibilityInfo.announceForAccessibility(`${scene.title}. ${scene.body}`);
    if (last) return () => cancelAnimation(progress);
    const timer = setTimeout(() => setIndex(i => i + 1), SCENE_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(progress);
    };
  }, [index, last, paused, progress]);

  const scene = SCENES[index];
  const Art = scene.art;

  return (
    <View style={styles.root} accessibilityViewIsModal>
      <StatusBar barStyle="light-content" />
      <Image
        source={require('../assets/brand/splash-bg.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />

      {/* Tap left third: back. Anywhere else: forward. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={e => {
          const x = e.nativeEvent.pageX;
          if (x < 120) go(index - 1);
          else if (!last) go(index + 1);
        }}
        accessibilityRole="button"
        accessibilityLabel={last ? scene.title : 'Next'}
      />

      <View
        style={[styles.top, { paddingTop: insets.top + 10 }]}
        pointerEvents="box-none"
      >
        <View style={styles.bars} pointerEvents="none">
          {SCENES.map((_, i) => (
            <Bar
              key={i}
              state={i < index ? 'done' : i === index ? 'active' : 'todo'}
              progress={progress}
            />
          ))}
        </View>
        <View style={styles.topRow} pointerEvents="box-none">
          <Text style={styles.kicker}>Your privacy</Text>
          {!last && (
            <Pressable
              onPress={onDone}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Skip"
              style={styles.skip}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Mounted only when playing, so the entrance animations aren't spent unseen. */}
      {paused ? (
        <View style={styles.center} />
      ) : (
        <View style={styles.center} pointerEvents="none" key={index}>
          <View style={styles.art}>
            <Art />
          </View>
          <Animated.Text
            entering={FadeInUp.delay(250).duration(500)}
            style={styles.title}
          >
            {scene.title}
          </Animated.Text>
          <Animated.Text
            entering={FadeInUp.delay(450).duration(500)}
            style={styles.body}
          >
            {scene.body}
          </Animated.Text>
        </View>
      )}

      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}
        pointerEvents="box-none"
      >
        {last ? (
          <Animated.View entering={FadeInDown.delay(600)} style={styles.full}>
            <Pressable
              onPress={onDone}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              <Text style={styles.ctaText}>Got it</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <Text style={styles.hint}>Tap to continue</Text>
        )}
      </View>
    </View>
  );
}

function Bar({
  state,
  progress,
}: {
  state: 'done' | 'active' | 'todo';
  progress: { value: number };
}) {
  const fill = useAnimatedStyle(() => ({
    width: `${
      (state === 'done' ? 1 : state === 'active' ? progress.value : 0) * 100
    }%`,
  }));
  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, fill]} />
    </View>
  );
}

// ---------- scene artwork (plain views, so it stays sharp at any size) ----------

function LogoArt() {
  return (
    <View style={styles.artCenter}>
      <Animated.View
        entering={FadeIn.duration(800)}
        style={[styles.ring, styles.ringLg]}
      />
      <Animated.View
        entering={FadeIn.delay(150).duration(800)}
        style={[styles.ring, styles.ringMd]}
      />
      <Animated.View
        entering={ZoomIn.springify().damping(12)}
        style={styles.logoTile}
      >
        {[0.42, 0.68, 1].map((h, i) => (
          <Animated.View
            key={i}
            entering={FadeInUp.delay(300 + i * 120)}
            style={[styles.logoBar, { height: 52 * h }]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

function Lock({ color = BLUE, size = 1 }: { color?: string; size?: number }) {
  return (
    <View style={[styles.lock, { transform: [{ scale: size }] }]}>
      <View style={[styles.shackle, { borderColor: color }]} />
      <View style={[styles.lockBody, { backgroundColor: color }]}>
        <View style={styles.keyhole} />
      </View>
    </View>
  );
}

function CardArt() {
  return (
    <View style={styles.artCenter}>
      <Animated.View
        entering={FadeInDown.springify().damping(14)}
        style={styles.card}
      >
        <View style={styles.cardShine} />
        <View style={styles.chip} />
        <Text style={styles.cardNumber}>•••• •••• •••• ••••</Text>
        <View style={styles.cardFooter}>
          <View style={styles.cardLine} />
          <View style={styles.cardCircles}>
            <View style={[styles.cardCircle, styles.cardCircleA]} />
            <View style={[styles.cardCircle, styles.cardCircleB]} />
          </View>
        </View>
      </Animated.View>
      <Animated.View
        entering={ZoomIn.delay(700).springify().damping(10)}
        style={styles.badge}
      >
        <Lock />
      </Animated.View>
    </View>
  );
}

function PhoneArt() {
  const rows = [
    ['#25904A', 0.7],
    ['#D2620A', 0.55],
    ['#5E5CE6', 0.8],
  ] as const;
  return (
    <View style={styles.artCenter}>
      <Animated.View
        entering={FadeInDown.springify().damping(14)}
        style={styles.phone}
      >
        <View style={styles.notch} />
        {rows.map(([color, w], i) => (
          <Animated.View
            key={i}
            entering={FadeInRight.delay(350 + i * 180)}
            style={styles.row}
          >
            <View style={[styles.rowDot, { backgroundColor: color }]} />
            <View style={[styles.rowLine, { width: `${w * 100}%` }]} />
          </Animated.View>
        ))}
      </Animated.View>
      <Animated.View
        entering={ZoomIn.delay(950).springify().damping(10)}
        style={[styles.badge, styles.badgeLeft]}
      >
        <Check />
      </Animated.View>
    </View>
  );
}

function BankArt() {
  return (
    <View style={styles.artCenter}>
      <Animated.View
        entering={FadeInDown.springify().damping(14)}
        style={styles.bank}
      >
        <View style={styles.roof} />
        <View style={styles.beam} />
        <View style={styles.columns}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={styles.column} />
          ))}
        </View>
        <View style={styles.floor} />
      </Animated.View>
      <Animated.View
        entering={ZoomIn.delay(700).springify().damping(9)}
        style={styles.noSign}
      >
        <View style={styles.noSlash} />
      </Animated.View>
    </View>
  );
}

function AccountArt() {
  return (
    <View style={styles.artCenter}>
      <Animated.View
        entering={FadeInDown.springify().damping(14)}
        style={styles.account}
      >
        <View style={styles.accountHead}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>A</Text>
          </View>
          <View style={styles.flex}>
            <View style={[styles.textLine, styles.w70]} />
            <View style={[styles.textLine, styles.textLineSoft, styles.w50]} />
          </View>
        </View>
        <Animated.View
          entering={FadeInRight.delay(450)}
          style={styles.accountRow}
        >
          <Text style={styles.accountLabel}>Email</Text>
          <View style={[styles.textLine, styles.textLineSoft, styles.w55]} />
        </Animated.View>
        <Animated.View
          entering={FadeInRight.delay(650)}
          style={styles.accountRow}
        >
          <Text style={styles.accountLabel}>Password</Text>
          <Text style={styles.dots}>••••••••</Text>
          <Lock size={0.55} />
        </Animated.View>
      </Animated.View>
      <Animated.View
        entering={ZoomIn.delay(950).springify().damping(10)}
        style={styles.badge}
      >
        <Check />
      </Animated.View>
    </View>
  );
}

function Check() {
  return (
    <View style={styles.checkCircle}>
      <View style={styles.checkMark} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#1A3DB8',
    zIndex: 20,
  },
  flex: { flex: 1 },
  full: { width: '100%' },
  top: { paddingHorizontal: 16 },
  bars: { flexDirection: 'row', gap: 5 },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  barFill: { height: 3, backgroundColor: '#FFFFFF' },
  topRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kicker: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  skip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  skipText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  art: { width: 280, height: 240, marginBottom: 32 },
  artCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.86)',
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  bottom: { paddingHorizontal: 24, alignItems: 'center' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '500' },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  ctaText: { color: BLUE, fontSize: 17, fontWeight: '700' },

  // logo
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  ringLg: { width: 230, height: 230, borderRadius: 115 },
  ringMd: { width: 170, height: 170, borderRadius: 85 },
  logoTile: {
    width: 116,
    height: 116,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 9,
    paddingBottom: 30,
    shadowColor: '#061347',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  logoBar: { width: 14, borderRadius: 4, backgroundColor: BLUE },

  // badges
  badge: {
    position: 'absolute',
    right: 22,
    bottom: 14,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#061347',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  badgeLeft: { right: undefined, left: 52 },
  lock: { alignItems: 'center' },
  shackle: {
    width: 22,
    height: 16,
    borderWidth: 4,
    borderBottomWidth: 0,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  lockBody: {
    width: 32,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyhole: { width: 5, height: 9, borderRadius: 3, backgroundColor: '#FFFFFF' },
  checkCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    width: 22,
    height: 12,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderColor: '#FFFFFF',
    transform: [{ rotate: '-45deg' }, { translateY: -2 }],
  },

  // card
  card: {
    width: 250,
    height: 156,
    borderRadius: 20,
    backgroundColor: '#1A9BB8',
    padding: 20,
    overflow: 'hidden',
    transform: [{ rotate: '-6deg' }],
    shadowColor: '#061347',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  cardShine: {
    position: 'absolute',
    right: -60,
    top: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  chip: { width: 38, height: 28, borderRadius: 7, backgroundColor: '#F5C451' },
  cardNumber: {
    marginTop: 18,
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLine: {
    width: 90,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  cardCircles: { flexDirection: 'row' },
  cardCircle: { width: 24, height: 24, borderRadius: 12 },
  cardCircleA: { backgroundColor: 'rgba(255,255,255,0.55)' },
  cardCircleB: { marginLeft: -10, backgroundColor: 'rgba(255,255,255,0.3)' },

  // phone
  phone: {
    width: 136,
    height: 224,
    borderRadius: 28,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingTop: 14,
    gap: 10,
  },
  notch: {
    alignSelf: 'center',
    width: 44,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 9,
  },
  rowDot: { width: 14, height: 14, borderRadius: 7 },
  rowLine: { height: 7, borderRadius: 4, backgroundColor: '#CBD5E1' },

  // bank
  bank: { alignItems: 'center' },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 92,
    borderRightWidth: 92,
    borderBottomWidth: 50,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF',
  },
  beam: { width: 184, height: 12, backgroundColor: '#FFFFFF', marginTop: 4 },
  columns: {
    width: 160,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  column: {
    width: 18,
    height: 74,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  floor: {
    width: 200,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    marginTop: 6,
  },
  noSign: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 12,
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noSlash: {
    width: 200,
    height: 12,
    backgroundColor: RED,
    transform: [{ rotate: '-45deg' }],
  },

  // account
  account: {
    width: 250,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
    gap: 14,
    shadowColor: '#061347',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8EEFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: BLUE, fontSize: 18, fontWeight: '800' },
  textLine: { height: 9, borderRadius: 5, backgroundColor: '#334155' },
  textLineSoft: { backgroundColor: '#CBD5E1', marginTop: 7 },
  w70: { width: '70%' },
  w50: { width: '50%' },
  w55: { width: '55%', marginTop: 0 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
    paddingTop: 12,
  },
  accountLabel: {
    width: 70,
    color: '#5B6577',
    fontSize: 13,
    fontWeight: '600',
  },
  dots: { flex: 1, color: '#0B1324', fontSize: 16, letterSpacing: 1 },
});
