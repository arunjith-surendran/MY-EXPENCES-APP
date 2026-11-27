import {
  type BottomTabScreenProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {
  type CompositeScreenProps,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type LinkingOptions,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getMeta, migrateDbIfNeeded, setMeta } from './src/lib/db';
import PrivacyIntro from './src/components/PrivacyIntro';
import { withPro } from './src/components/ProLock';
import Splash from './src/components/Splash';
import TabBar from './src/components/TabBar';
import { AuthProvider, useAuth } from './src/lib/auth/AuthContext';
import { SalaryPrivacyProvider } from './src/lib/salaryPrivacy';
import { useSyncProAccess } from './src/lib/subscription';
import { ThemeProvider, useTheme } from './src/lib/theme';
import AccountScreen from './src/screens/AccountScreen';
import AdminChatScreen from './src/screens/admin/AdminChatScreen';
import AdminFinanceScreen from './src/screens/admin/AdminFinanceScreen';
import AdminHomeScreen from './src/screens/admin/AdminHomeScreen';
import AdminInboxScreen from './src/screens/admin/AdminInboxScreen';
import AdminOfferNewScreen from './src/screens/admin/AdminOfferNewScreen';
import AdminOffersScreen from './src/screens/admin/AdminOffersScreen';
import AdminUserScreen from './src/screens/admin/AdminUserScreen';
import AdminUsersScreen from './src/screens/admin/AdminUsersScreen';
import type { UserFilter } from './src/screens/admin/ui';
import AddScreen from './src/screens/AddScreen';
import HomeScreen from './src/screens/HomeScreen';
import MonthScreen from './src/screens/MonthScreen';
import ImportScreen from './src/screens/ImportScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import SalaryScreen from './src/screens/SalaryScreen';
import SetupScreen from './src/screens/SetupScreen';
import SupportScreen from './src/screens/SupportScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';

/** The bottom tabs. NewExpense is the "+" in the middle: it opens Add instead of a tab. */
export type TabParamList = {
  Home: undefined;
  ThisMonth: undefined;
  NewExpense: undefined;
  Setup: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Add:
    | {
        id?: string;
        auto?: string;
        amount?: string;
        merchant?: string;
        card?: string;
        raw?: string;
        via?: string;
        month?: string;
      }
    | undefined;
  Month: { month: string };
  Salary: { month?: string } | undefined;
  Import: { month?: string } | undefined;
  Paywall: undefined;
  Support: undefined;
  // Admin side (only for accounts in the backend's ADMIN_EMAILS).
  AdminHome: undefined;
  AdminUsers: { filter?: UserFilter } | undefined;
  AdminUser: { id: string };
  AdminOffers: undefined;
  AdminOfferNew:
    | {
        audience?: 'all' | 'trial' | 'free' | 'user';
        userId?: string;
        userName?: string;
      }
    | undefined;
  AdminInbox: undefined;
  AdminChat: { userId: string; name: string };
  AdminFinance: undefined;
  Welcome: undefined;
  Privacy: undefined;
};

/** Props for a tab screen: its own tab route, plus navigation to the stack screens above the tabs. */
export type TabProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

const PRIVACY_SEEN_KEY = 'privacy_intro_seen';

/** The privacy explainer, replayed from Account or the sign-in screen. */
function PrivacyScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Privacy'>) {
  return <PrivacyIntro onDone={navigation.goBack} />;
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const NoScreen = () => null;

// Pro-only screens: after the free month they show a lock card that leads to the plans.
const ProSetupScreen = withPro(SetupScreen, {
  title: 'Apple Pay auto-logging',
  body: 'Every Apple Pay tap saved by itself, with the merchant, card and category.',
});
const ProImportScreen = withPro(ImportScreen, {
  title: 'Bank statement import',
  body: "Fill in whole months at once from your bank's PDF or CSV statement.",
});
const ProSalaryScreen = withPro(SalaryScreen, {
  title: 'Salary budget',
  body: 'See how much is left, what you can safely spend per day, and how much you save.',
});

// expences://add?auto=1&amount=...&merchant=...&card=...  → Add screen with those params.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['expences://'],
  config: {
    initialRouteName: 'Tabs',
    screens: {
      Tabs: {
        screens: {
          Home: '',
          ThisMonth: 'this-month',
          Setup: 'setup',
          Account: 'account',
        },
      },
      Add: 'add',
      Month: 'month/:month',
      Salary: 'salary',
      Import: 'import',
    },
  },
};

function Message({ title, body }: { title: string; body?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      {body ? (
        <Text style={[styles.body, { color: t.muted }]}>{body}</Text>
      ) : null}
    </View>
  );
}

/** Shows a readable message instead of a white screen if a screen crashes. */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Message
          title="Something went wrong"
          body={`${this.state.error.message}\n\nYour saved expenses are safe. Please close and reopen the app.`}
        />
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [state, setState] = useState<'loading' | 'ready' | Error>('loading');
  const [splashDone, setSplashDone] = useState(false);
  const hideSplash = useCallback(() => setSplashDone(true), []);
  // The privacy explainer plays once, on the first launch.
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    migrateDbIfNeeded()
      .then(async () => {
        const seen = await getMeta(PRIVACY_SEEN_KEY).catch(() => '1');
        setShowIntro(seen == null);
        setState('ready');
      })
      .catch(err =>
        setState(err instanceof Error ? err : new Error(String(err))),
      );
  }, []);

  const finishIntro = useCallback(() => {
    setShowIntro(false);
    setMeta(PRIVACY_SEEN_KEY, '1').catch(() => {});
  }, []);

  return (
    <ThemeProvider ready={state === 'ready'}>
      <AuthProvider>
        <SalaryPrivacyProvider>
          <SafeAreaProvider>
            <View style={styles.flex}>
              <Main state={state} />
              {showIntro && (
                <PrivacyIntro onDone={finishIntro} paused={!splashDone} />
              )}
              {!splashDone && <AppSplash state={state} onDone={hideSplash} />}
            </View>
          </SafeAreaProvider>
        </SalaryPrivacyProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

/** Stays up until the database is open and the saved session is restored. */
function AppSplash({
  state,
  onDone,
}: {
  state: 'loading' | 'ready' | Error;
  onDone: () => void;
}) {
  const { status } = useAuth();
  return (
    <Splash
      ready={state !== 'loading' && status !== 'loading'}
      onDone={onDone}
    />
  );
}

function Tabs() {
  const t = useTheme();
  useSyncProAccess();
  return (
    <Tab.Navigator
      // React Navigation's documented pattern for a custom tab bar.
      // eslint-disable-next-line react/no-unstable-nested-components
      tabBar={props => <TabBar {...props} />}
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: t.accent,
        headerTitleStyle: { color: t.text, fontWeight: '700' },
        headerStyle: { backgroundColor: t.bg },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Dashboard' }}
      />
      <Tab.Screen name="ThisMonth" component={MonthScreen} />
      <Tab.Screen name="NewExpense" component={NoScreen} />
      <Tab.Screen
        name="Setup"
        component={ProSetupScreen}
        options={{ title: 'Auto-log Apple Pay' }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{ title: 'Account' }}
      />
    </Tab.Navigator>
  );
}

function Main({ state }: { state: 'loading' | 'ready' | Error }) {
  const t = useTheme();
  const { status, user } = useAuth();
  const base = t.scheme === 'dark' ? DarkTheme : DefaultTheme;

  if (state === 'loading' || status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (state instanceof Error) {
    return <Message title="Could not open the database" body={state.message} />;
  }

  return (
    <ErrorBoundary>
      <>
        <StatusBar
          barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'}
        />
        <NavigationContainer
          // Remount on sign-in/out: a link that opened the app while signed out is handled after sign-in.
          key={status}
          linking={status === 'signedIn' ? linking : undefined}
          theme={{
            ...base,
            colors: {
              ...base.colors,
              background: t.bg,
              card: t.bg,
              text: t.text,
              primary: t.accent,
              border: t.border,
            },
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerShadowVisible: false,
              headerTintColor: t.accent,
              headerTitleStyle: { color: t.text, fontWeight: '700' },
              headerStyle: { backgroundColor: t.bg },
              contentStyle: { backgroundColor: t.bg },
            }}
          >
            {status === 'signedOut' ? (
              <Stack.Screen
                name="Welcome"
                component={WelcomeScreen}
                options={{ headerShown: false, animationTypeForReplace: 'pop' }}
              />
            ) : (
              <>
                <Stack.Screen
                  name="Tabs"
                  component={Tabs}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="Add"
                  component={AddScreen}
                  options={{ title: 'Add expense', presentation: 'modal' }}
                />
                <Stack.Screen name="Month" component={MonthScreen} />
                <Stack.Screen
                  name="Salary"
                  component={ProSalaryScreen}
                  options={{ title: 'Salary', presentation: 'modal' }}
                />
                <Stack.Screen
                  name="Import"
                  component={ProImportScreen}
                  options={{ title: 'Import statement', presentation: 'modal' }}
                />
                <Stack.Screen
                  name="Paywall"
                  component={PaywallScreen}
                  options={{ title: 'Expences Pro', presentation: 'modal' }}
                />
                <Stack.Screen
                  name="Support"
                  component={SupportScreen}
                  options={{ title: 'Help & feedback' }}
                />
                {user?.isAdmin && (
                  <>
                    <Stack.Screen
                      name="AdminHome"
                      component={AdminHomeScreen}
                      options={{ title: 'Admin' }}
                    />
                    <Stack.Screen
                      name="AdminUsers"
                      component={AdminUsersScreen}
                      options={{ title: 'Users' }}
                    />
                    <Stack.Screen
                      name="AdminUser"
                      component={AdminUserScreen}
                      options={{ title: 'User' }}
                    />
                    <Stack.Screen
                      name="AdminOffers"
                      component={AdminOffersScreen}
                      options={{ title: 'Offers' }}
                    />
                    <Stack.Screen
                      name="AdminOfferNew"
                      component={AdminOfferNewScreen}
                      options={{ title: 'New offer', presentation: 'modal' }}
                    />
                    <Stack.Screen
                      name="AdminInbox"
                      component={AdminInboxScreen}
                      options={{ title: 'Support inbox' }}
                    />
                    <Stack.Screen
                      name="AdminFinance"
                      component={AdminFinanceScreen}
                      options={{ title: 'Money' }}
                    />
                    <Stack.Screen
                      name="AdminChat"
                      component={AdminChatScreen}
                      options={{ title: 'Chat' }}
                    />
                  </>
                )}
              </>
            )}
            <Stack.Screen
              name="Privacy"
              component={PrivacyScreen}
              options={{ headerShown: false, presentation: 'fullScreenModal' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body: { marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
