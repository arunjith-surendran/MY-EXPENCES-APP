import { config } from '../config';

export type User = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  linkedProviders: ('email' | 'google' | 'apple')[];
  createdAt: string;
  /** Missing in sessions saved before subscriptions existed. */
  subscription?: {
    plan: 'trial' | 'pro' | 'free';
    trialEndsAt: string;
    proUntil: string | null;
    product: string | null;
  };
  /** Sees the admin side (users, offers, support inbox). */
  isAdmin?: boolean;
};

export type TokenPair = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
};

export type SignInResult = TokenPair & { isNewUser: boolean; user: User };

/** An answer from the API that wasn't 2xx, or no answer at all (`status` 0). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }

  /** No connection, a timeout or a server that's down: worth retrying later, not a reason to sign out. */
  get isNetwork() {
    return this.status === 0 || this.status >= 500;
  }
}

const TIMEOUT_MS = 15_000;
// Photos take longer to upload than JSON.
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * One JSON request with a timeout. Errors carry the server's message when it sent one.
 * A FormData body is sent as multipart (photo uploads).
 */
export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const isForm = options.body instanceof FormData;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    isForm ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        // FormData sets its own multipart Content-Type with the boundary.
        ...(options.body && !isForm
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.accessToken
          ? { Authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
      body: isForm
        ? (options.body as FormData)
        : options.body
        ? JSON.stringify(options.body)
        : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join('\n')
      : data?.message;
    throw new ApiError(
      response.status === 429
        ? 'Too many attempts. Please wait a minute and try again.'
        : message || `Request failed (${response.status})`,
      response.status,
    );
  }
  return data as T;
}

export const authApi = {
  register: (body: { email: string; password: string; name?: string }) =>
    request<SignInResult>('/auth/register', { body }),
  login: (body: { email: string; password: string }) =>
    request<SignInResult>('/auth/login', { body }),
  google: (idToken: string) =>
    request<SignInResult>('/auth/google', { body: { idToken } }),
  apple: (body: {
    identityToken: string;
    nonce?: string;
    fullName?: { givenName?: string; familyName?: string };
  }) => request<SignInResult>('/auth/apple', { body }),
  refresh: (refreshToken: string) =>
    request<TokenPair>('/auth/refresh', { body: { refreshToken } }),
  logout: (refreshToken: string) =>
    request<void>('/auth/logout', { body: { refreshToken } }),
};
