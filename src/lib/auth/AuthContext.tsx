import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ApiError,
  authApi,
  request,
  type SignInResult,
  type TokenPair,
  type User,
} from '../api';
import { appleCredential, googleIdToken, googleSignOut } from './providers';
import { clearSession, loadSession, saveSession } from './session';

type Status = 'loading' | 'signedOut' | 'signedIn';
export type Provider = 'google' | 'apple';

type AuthState = {
  status: Status;
  user: User | null;
  /** Opens the provider's sheet. Resolves `isNewUser` (the account was just created). Throws `SignInCancelled`. */
  signIn: (provider: Provider) => Promise<{ isNewUser: boolean }>;
  /** Email + password sign-in. Throws `ApiError` (401 for a wrong email or password). */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Creates an email + password account and signs it in. Throws `ApiError` (409 if the email is taken). */
  signUpWithEmail: (
    name: string,
    email: string,
    password: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** A request to the API as the signed-in user; refreshes the access token when needed. */
  authedRequest: <T>(
    path: string,
    options?: { method?: string; body?: unknown },
  ) => Promise<T>;
  /** A valid access token, for requests `authedRequest` can't make (e.g. an <Image> with headers). */
  getAccessToken: () => Promise<string>;
};

const AuthContext = createContext<AuthState | null>(null);

// Refresh a little early so a token never expires in flight.
const EXPIRY_MARGIN_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  const refreshToken = useRef<string | null>(null);
  const access = useRef<{ token: string; expiresAt: number } | null>(null);
  // One refresh at a time: refresh tokens are single use, and two concurrent
  // refreshes with the same token look like theft and sign the user out.
  const refreshing = useRef<Promise<string> | null>(null);
  const userRef = useRef<User | null>(null);

  const reset = useCallback(async () => {
    refreshToken.current = null;
    access.current = null;
    userRef.current = null;
    await clearSession().catch(() => {});
    setUser(null);
    setStatus('signedOut');
  }, []);

  const applyTokens = useCallback(async (tokens: TokenPair, next: User) => {
    refreshToken.current = tokens.refreshToken;
    access.current = {
      token: tokens.accessToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };
    userRef.current = next;
    // Persist the rotated refresh token at once: the previous one no longer works.
    await saveSession({ refreshToken: tokens.refreshToken, user: next });
  }, []);

  const refresh = useCallback((): Promise<string> => {
    if (refreshing.current) return refreshing.current;
    const run = (async () => {
      const current = refreshToken.current;
      if (!current || !userRef.current) {
        throw new ApiError('Not signed in', 401);
      }
      try {
        const tokens = await authApi.refresh(current);
        await applyTokens(tokens, userRef.current);
        return tokens.accessToken;
      } catch (error) {
        // Rejected (expired, revoked, reused): the session is over. Network errors keep it.
        if (error instanceof ApiError && error.status === 401) await reset();
        throw error;
      }
    })();
    refreshing.current = run;
    run
      .catch(() => {})
      .finally(() => {
        refreshing.current = null;
      });
    return run;
  }, [applyTokens, reset]);

  const accessToken = useCallback(async () => {
    const current = access.current;
    if (current && current.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return current.token;
    }
    return refresh();
  }, [refresh]);

  const authedRequest = useCallback(
    async <T,>(
      path: string,
      options: { method?: string; body?: unknown } = {},
    ): Promise<T> => {
      try {
        return await request<T>(path, {
          ...options,
          accessToken: await accessToken(),
        });
      } catch (error) {
        // The access token was refused (e.g. the server's secret rotated): refresh once and retry.
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        access.current = null;
        return request<T>(path, { ...options, accessToken: await refresh() });
      }
    },
    [accessToken, refresh],
  );

  // Restore the session at launch. Start signed in from the cached profile so the
  // app works offline, then confirm the session and update the profile in the background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // loadSession() never rejects, but a native module missing from an old build
      // throws on load: show sign-in rather than a splash that never ends.
      const stored = await Promise.resolve()
        .then(loadSession)
        .catch(() => null);
      if (cancelled) return;
      if (!stored) {
        setStatus('signedOut');
        return;
      }
      refreshToken.current = stored.refreshToken;
      userRef.current = stored.user;
      setUser(stored.user);
      setStatus('signedIn');
      try {
        const me = await authedRequest<User>('/users/me');
        if (cancelled || !refreshToken.current) return;
        userRef.current = me;
        setUser(me);
        await saveSession({ refreshToken: refreshToken.current, user: me });
      } catch {
        // Offline or server down: keep the cached profile. A 401 already signed out.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authedRequest]);

  const finishSignIn = useCallback(
    async (result: SignInResult) => {
      await applyTokens(result, result.user);
      setUser(result.user);
      setStatus('signedIn');
      return { isNewUser: result.isNewUser };
    },
    [applyTokens],
  );

  const signIn = useCallback(
    async (provider: Provider) =>
      finishSignIn(
        provider === 'google'
          ? await authApi.google(await googleIdToken())
          : await authApi.apple(await appleCredential()),
      ),
    [finishSignIn],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      await finishSignIn(
        await authApi.login({ email: email.trim(), password }),
      );
    },
    [finishSignIn],
  );

  const signUpWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      await finishSignIn(
        await authApi.register({
          email: email.trim(),
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      );
    },
    [finishSignIn],
  );

  const signOut = useCallback(async () => {
    const token = refreshToken.current;
    // Revoke on the server when reachable; sign out locally regardless.
    if (token) await authApi.logout(token).catch(() => {});
    await googleSignOut();
    await reset();
  }, [reset]);

  const deleteAccount = useCallback(async () => {
    await authedRequest<void>('/users/me', { method: 'DELETE' });
    await googleSignOut();
    await reset();
  }, [authedRequest, reset]);

  const value = useMemo(
    () => ({
      status,
      user,
      signIn,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      deleteAccount,
      authedRequest,
      getAccessToken: accessToken,
    }),
    [
      status,
      user,
      signIn,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      deleteAccount,
      authedRequest,
      accessToken,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
