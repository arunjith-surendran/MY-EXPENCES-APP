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
  useNavigationState,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  Component,
  type ComponentProps,
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
import AppLock from './src/components/AppLock';
import PrivacyIntro from './src/components/PrivacyIntro';
import { withPro } from './src/components/ProLock';
import Splash from './src/components/Splash';
import TabBar, { BottomBar, type TabName } from './src/components/TabBar';
import UpdateGate from './src/components/UpdateGate';
import { AuthProvider, useAuth } from './src/lib/auth/AuthContext';
import { ConversionProvider } from './src/lib/currency';
import { SalaryPrivacyProvider } from './src/lib/salaryPrivacy';
import { useSyncProAccess } from './src/lib/subscription';
import { ThemeProvider, useTheme } from './src/lib/theme';
import AccountScreen from './src/screens/AccountScreen';
import AdminChatScreen from './src/screens/admin/AdminChatScreen';
import AdminFinanceScreen from './src/screens/admin/AdminFinanceScreen';
import AdminHomeScreen from './src/screens/admin/AdminHomeScreen';
import AdminInboxScreen from './src/screens/admin/AdminInboxScreen';
import AdminNotifyScreen from './src/screens/admin/AdminNotifyScreen';
import AdminOfferNewScreen from './src/screens/admin/AdminOfferNewScreen';
import AdminOffersScreen from './src/screens/admin/AdminOffersScreen';
import AdminUserScreen from './src/screens/admin/AdminUserScreen';
import AdminUsersScreen from './src/screens/admin/AdminUsersScreen';
import AdminVersionsScreen from './src/screens/admin/AdminVersionsScreen';
import type { UserFilter } from './src/screens/admin/ui';
import AddScreen from './src/screens/AddScreen';
import CurrencyScreen from './src/screens/CurrencyScreen';
import DeleteScreen from './src/screens/DeleteScreen';
import HomeScreen from './src/screens/HomeScreen';
import MonthScreen from './src/screens/MonthScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
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
        /** Preselects how it was paid, e.g. "cash" from the dashboard's cash button. */
        method?: string;
      }
    | undefined;
  Month: { month: string };
  Salary: { month?: string } | undefined;
  Import: { month?: string } | undefined;
  /** Bulk delete; with a month, starts on that month. */
  Delete: { month?: string } | undefined;
  Paywall: undefined;
  Support: undefined;
  Notifications: undefined;
  Currency: undefined;
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
  /** With a user: a message for only them. */
  AdminNotify: { userId?: string; userName?: string } | undefined;
  AdminChat: { userId: string; name: string };
  AdminFinance: undefined;
  AdminVersions: undefined;
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

type StackLayout = NonNullable<
  ComponentProps<typeof Stack.Navigator>['screenLayout']
>;
const Tab = createBottomTabNavigator<TabParamList>();

const NoScreen = () => null;

/** Wraps each stack page (except NO_BAR ones) with the bottom bar. */
const withBottomBar: StackLayout = ({ children, route, navigation }) =>
  NO_BAR.has(route.name) ? (
    children
  ) : (
    <View style={styles.flex}>
      <View style={styles.flex}>{children}</View>
      <StackBottomBar
        routeName={route.name}
        onAdd={() => navigation.navigate('Add')}
        onSelect={tab => navigation.navigate('Tabs', { screen: tab })}
      />
    </View>
  );

// Sheets, chats (they have their own composer at the bottom) and the sign-in flow go without the bottom bar.
const NO_BAR = new Set<keyof RootStackParamList>([
  'Tabs',
  'Add',
  'Paywall',
  'AdminOfferNew',
  'Support',
  'AdminChat',
  'Welcome',
  'Privacy',
]);

/** The tab bar under a page opened on top of the tabs, so every page can jump to any tab. */
function StackBottomBar({
  routeName,
  onSelect,
  onAdd,
}: {
  routeName: keyof RootStackParamList;
  onSelect: (tab: TabName) => void;
  onAdd: () => void;
}) {
  // Highlight the tab this page was opened from (a past month counts as Month).
  const underTab = useNavigationState(state => {
    const tabs = state.routes.find(r => r.name === 'Tabs')?.state;
    return tabs?.index != null
      ? (tabs.routes[tabs.index].name as TabName)
      : 'Home';
  });
  return (
    <BottomBar
      active={routeName === 'Month' ? 'ThisMonth' : underTab}
      onAdd={onAdd}
      onSelect={onSelect}
    />
  );
}

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
          <ConversionProvider ready={state === 'ready'}>
            <SafeAreaProvider>
              <View style={styles.flex}>
                <Main state={state} />
                <AppLock ready={state === 'ready'} revealed={splashDone} />
                {showIntro && (
                  <PrivacyIntro onDone={finishIntro} paused={!splashDone} />
                )}
                <UpdateGate ready={state === 'ready'} />
                {!splashDone && <AppSplash state={state} onDone={hideSplash} />}
              </View>
            </SafeAreaProvider>
          </ConversionProvider>
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
            screenLayout={withBottomBar}
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
                  options={{ title: 'Salary' }}
                />
                <Stack.Screen
                  name="Import"
                  component={ProImportScreen}
                  options={{ title: 'Import statement' }}
                />
                <Stack.Screen
                  name="Delete"
                  component={DeleteScreen}
                  options={{ title: 'Delete expenses' }}
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
                <Stack.Screen
                  name="Currency"
                  component={CurrencyScreen}
                  options={{ title: 'Show amounts in' }}
                />
                <Stack.Screen
                  name="Notifications"
                  component={NotificationsScreen}
                  options={{ title: 'Notifications' }}
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
                      name="AdminNotify"
                      component={AdminNotifyScreen}
                      options={{ title: 'Send notification' }}
                    />
                    <Stack.Screen
                      name="AdminFinance"
                      component={AdminFinanceScreen}
                      options={{ title: 'Money' }}
                    />
                    <Stack.Screen
                      name="AdminVersions"
                      component={AdminVersionsScreen}
                      options={{ title: 'App version' }}
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
