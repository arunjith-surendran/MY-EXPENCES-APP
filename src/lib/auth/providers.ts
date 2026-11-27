import appleAuth from '@invertase/react-native-apple-authentication';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { config, isGoogleConfigured } from '../../config';

/** The user closed the Google or Apple sheet: not an error to show. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

let googleConfigured = false;

function configureGoogle() {
  if (googleConfigured) return;
  if (!isGoogleConfigured()) {
    throw new Error(
      'Google sign-in is not set up yet. Add your client IDs in .env.',
    );
  }
  GoogleSignin.configure({
    webClientId: config.google.webClientId,
    iosClientId: config.google.iosClientId,
  });
  googleConfigured = true;
}

/** Opens Google's sign-in sheet and returns the ID token for the backend. */
export async function googleIdToken(): Promise<string> {
  configureGoogle();
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new SignInCancelled();
    if (!response.data.idToken) {
      throw new Error('Google did not return an ID token.');
    }
    return response.data.idToken;
  } catch (error) {
    if (
      isErrorWithCode(error) &&
      (error.code === statusCodes.SIGN_IN_CANCELLED ||
        error.code === statusCodes.IN_PROGRESS)
    ) {
      throw new SignInCancelled();
    }
    if (
      isErrorWithCode(error) &&
      error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE
    ) {
      throw new Error('Google Play services are not available on this device.');
    }
    throw error;
  }
}

/** Forgets the Google account on this device, so the next sign-in shows the account picker. */
export async function googleSignOut() {
  if (!googleConfigured) return;
  await GoogleSignin.signOut().catch(() => {});
}

export const isAppleSignInAvailable = () =>
  Platform.OS === 'ios' && appleAuth.isSupported;

/** Opens Sign in with Apple; returns what the backend needs. */
export async function appleCredential() {
  try {
    const response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      // Full name first: Apple returns it only on the very first sign-in.
      requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
    });
    if (!response.identityToken) {
      throw new Error('Apple did not return an identity token.');
    }
    return {
      identityToken: response.identityToken,
      // The library sends Apple the SHA-256 of this nonce; the backend checks it.
      nonce: response.nonce,
      fullName: response.fullName
        ? {
            givenName: response.fullName.givenName ?? undefined,
            familyName: response.fullName.familyName ?? undefined,
          }
        : undefined,
    };
  } catch (error) {
    if ((error as { code?: string })?.code === appleAuth.Error.CANCELED) {
      throw new SignInCancelled();
    }
    throw error;
  }
}
