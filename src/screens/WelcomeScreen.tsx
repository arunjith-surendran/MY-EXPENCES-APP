import { AppleButton } from '@invertase/react-native-apple-authentication';
import { forwardRef, type ReactNode, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../App';

import { config } from '../config';
import { type Provider, useAuth } from '../lib/auth/AuthContext';
import { isAppleSignInAvailable, SignInCancelled } from '../lib/auth/providers';
import { useTheme } from '../lib/theme';

type Mode = 'signIn' | 'signUp';
type Busy = Provider | 'email' | null;

const HERO_HEIGHT = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Problems with the form before it is sent; the server checks the same rules. */
function validate(mode: Mode, email: string, password: string) {
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.';
  if (mode === 'signIn') return password ? null : 'Enter your password.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain a letter and a number.';
  }
  return null;
}

/**
 * Sign in or create an account: email and password, or Apple / Google
 * (where the first sign-in creates the account).
 */
export default function WelcomeScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Welcome'>) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const apple = isAppleSignInAvailable();
  const signUp = mode === 'signUp';

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    const problem = validate(mode, email, password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy('email');
    setError(null);
    try {
      if (signUp) await signUpWithEmail(name, email, password);
      else await signInWithEmail(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const social = async (provider: Provider) => {
    if (busy) return;
    setBusy(provider);
    setError(null);
    try {
      const { isNewUser } = await signIn(provider);
      if (isNewUser) {
        Alert.alert(
          'Account created',
          'There was no account for this login yet, so we created one for you.',
        );
      }
    } catch (e) {
      if (!(e instanceof SignInCancelled)) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setBusy(null);
    }
  };

  // Google's branding colors for its sign-in button (light / dark).
  const google =
    t.scheme === 'dark'
      ? { bg: '#131314', border: '#8E918F', text: '#E3E3E3' }
      : { bg: '#FFFFFF', border: '#747775', text: '#1F1F1F' };

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          style={{ backgroundColor: t.bg }}
        >
          <ImageBackground
            source={require('../assets/brand/auth-hero.jpg')}
            resizeMode="cover"
            style={[styles.hero, { paddingTop: insets.top + 12 }]}
            accessibilityIgnoresInvertColors
          >
            <View style={styles.brandRow}>
              <View style={styles.brandTile}>
                {[0.42, 0.68, 1].map((h, i) => (
                  <View
                    key={i}
                    style={[
                      styles.brandBar,
                      { height: 16 * h, backgroundColor: t.accent },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.brandName}>Expences</Text>
            </View>
          </ImageBackground>

          <View style={[styles.sheet, { backgroundColor: t.bg }]}>
            <Text style={[styles.heading, { color: t.text }]}>
              {signUp ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={[styles.sub, { color: t.muted }]}>
              {signUp
                ? 'Track every dirham, automatically.'
                : 'Sign in to continue to your expenses.'}
            </Text>

            <View
              style={[styles.segment, { backgroundColor: t.cardHi }]}
              accessibilityRole="tablist"
            >
              {(
                [
                  ['signIn', 'Sign in'],
                  ['signUp', 'Create account'],
                ] as const
              ).map(([value, label]) => {
                const active = mode === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => switchMode(value)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.segmentItem,
                      active && [
                        styles.segmentActive,
                        {
                          backgroundColor:
                            t.scheme === 'dark' ? t.border : t.card,
                        },
                      ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        { color: active ? t.text : t.muted },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.form}>
              {signUp && (
                <Field
                  label="Full name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  textContentType="name"
                  autoComplete="name"
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                />
              )}
              <Field
                ref={emailRef}
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                textContentType={signUp ? 'username' : 'emailAddress'}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Field
                ref={passwordRef}
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={signUp ? 'At least 8 characters' : 'Your password'}
                secureTextEntry={!showPassword}
                textContentType={signUp ? 'newPassword' : 'password'}
                autoComplete={signUp ? 'new-password' : 'current-password'}
                passwordRules="minlength: 8; required: lower; required: digit;"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={submit}
                accessory={
                  <Pressable
                    onPress={() => setShowPassword(v => !v)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                  >
                    <Text style={[styles.show, { color: t.accent }]}>
                      {showPassword ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                }
              />
              {signUp && (
                <Text style={[styles.hint, { color: t.muted }]}>
                  Use 8 or more characters with a letter and a number.
                </Text>
              )}
            </View>

            {error && (
              <View
                style={[
                  styles.error,
                  { borderColor: t.danger, backgroundColor: t.card },
                ]}
                accessibilityLiveRegion="polite"
              >
                <Text style={[styles.errorText, { color: t.danger }]}>
                  {error}
                </Text>
              </View>
            )}

            <Pressable
              onPress={submit}
              disabled={busy != null}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: t.accent },
                (pressed || (busy && busy !== 'email')) && styles.dim,
              ]}
            >
              {busy === 'email' ? (
                <ActivityIndicator color={t.onAccent} />
              ) : (
                <Text style={[styles.primaryText, { color: t.onAccent }]}>
                  {signUp ? 'Create account' : 'Sign in'}
                </Text>
              )}
            </Pressable>

            {/* Apple and Google sign in only: new accounts are created with email and password. */}
            {!signUp && (
              <>
                <View style={styles.divider}>
                  <View style={[styles.line, { backgroundColor: t.border }]} />
                  <Text style={[styles.dividerText, { color: t.muted }]}>
                    or continue with
                  </Text>
                  <View style={[styles.line, { backgroundColor: t.border }]} />
                </View>

                <View
                  style={styles.buttons}
                  pointerEvents={busy ? 'none' : 'auto'}
                >
                  {apple && (
                    <View style={busy && busy !== 'apple' && styles.dim}>
                      <AppleButton
                        // Re-mount on scheme change: the native button doesn't update in place.
                        key={t.scheme}
                        buttonStyle={
                          t.scheme === 'dark'
                            ? AppleButton.Style.WHITE
                            : AppleButton.Style.BLACK
                        }
                        buttonType={AppleButton.Type.SIGN_IN}
                        cornerRadius={14}
                        style={styles.providerButton}
                        onPress={() => social('apple')}
                      />
                      {busy === 'apple' && (
                        <ActivityIndicator
                          style={styles.spinner}
                          color={t.muted}
                        />
                      )}
                    </View>
                  )}

                  <Pressable
                    onPress={() => social('google')}
                    accessibilityRole="button"
                    accessibilityLabel="Sign in with Google"
                    style={({ pressed }) => [
                      styles.providerButton,
                      styles.google,
                      {
                        backgroundColor: google.bg,
                        borderColor: google.border,
                      },
                      (pressed || (busy && busy !== 'google')) && styles.dim,
                    ]}
                  >
                    {busy === 'google' ? (
                      <ActivityIndicator color={t.muted} />
                    ) : (
                      <>
                        <Image
                          source={require('../assets/brand/google-g.png')}
                          style={styles.googleLogo}
                        />
                        <Text
                          style={[styles.googleText, { color: google.text }]}
                        >
                          Sign in with Google
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            )}

            <Pressable
              onPress={() => switchMode(signUp ? 'signIn' : 'signUp')}
              style={styles.switch}
              accessibilityRole="button"
            >
              <Text style={[styles.switchText, { color: t.muted }]}>
                {signUp ? 'Already have an account? ' : 'New to Expences? '}
                <Text style={[styles.switchLink, { color: t.accent }]}>
                  {signUp ? 'Sign in' : 'Create an account'}
                </Text>
              </Text>
            </Pressable>

            <Text style={[styles.legal, { color: t.muted }]}>
              By continuing you agree to our{' '}
              <Text
                style={{ color: t.accent }}
                onPress={() => Linking.openURL(config.termsUrl)}
              >
                Terms
              </Text>{' '}
              and{' '}
              <Text
                style={{ color: t.accent }}
                onPress={() => Linking.openURL(config.privacyPolicyUrl)}
              >
                Privacy Policy
              </Text>
              .
            </Text>
            <Pressable
              onPress={() => navigation.navigate('Privacy')}
              style={styles.privacyLink}
              accessibilityRole="button"
            >
              <Text style={[styles.privacyText, { color: t.accent }]}>
                How we protect your data
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A labelled text field; the border turns to the accent color while focused. */
const Field = forwardRef<
  TextInputInstance,
  TextInputProps & { label: string; accessory?: ReactNode }
>(function FieldInput({ label, accessory, ...input }, ref) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      <View
        style={[
          styles.inputBox,
          {
            backgroundColor: t.card,
            borderColor: focused ? t.accent : t.border,
          },
        ]}
      >
        <TextInput
          ref={ref}
          {...input}
          accessibilityLabel={label}
          placeholderTextColor={t.muted}
          onFocus={e => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, { color: t.text }]}
        />
        {accessory}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { height: HERO_HEIGHT, paddingHorizontal: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
    paddingBottom: 9,
  },
  brandBar: { width: 5, borderRadius: 2 },
  brandName: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  sheet: {
    marginTop: -28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  heading: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  sub: { marginTop: 4, fontSize: 15 },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginTop: 20,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 10,
  },
  segmentActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 14, fontWeight: '600' },
  form: { marginTop: 20, gap: 14 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  show: { fontSize: 14, fontWeight: '600', marginLeft: 8 },
  hint: { fontSize: 12, marginTop: -6 },
  error: { marginTop: 16, borderWidth: 1, borderRadius: 12, padding: 12 },
  errorText: { fontSize: 14, lineHeight: 20 },
  primary: {
    marginTop: 20,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F4FD1',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  primaryText: { fontSize: 17, fontWeight: '700' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
  },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  buttons: { marginTop: 18, gap: 12 },
  providerButton: { height: 50, width: '100%' },
  google: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  googleLogo: { width: 20, height: 20 },
  googleText: { fontSize: 17, fontWeight: '600' },
  spinner: { position: 'absolute', right: 16, top: 15 },
  dim: { opacity: 0.5 },
  switch: { marginTop: 22, alignItems: 'center' },
  switchText: { fontSize: 14 },
  switchLink: { fontWeight: '700' },
  privacyLink: { marginTop: 10, alignSelf: 'center', padding: 6 },
  privacyText: { fontSize: 13, fontWeight: '600' },
  legal: { marginTop: 14, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
