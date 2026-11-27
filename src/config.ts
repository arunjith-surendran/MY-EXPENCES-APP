import { Platform } from 'react-native';
import {
  API_URL,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  PRIVACY_POLICY_URL,
  TERMS_URL,
} from '@env';

/**
 * App-wide settings, read from .env (copy .env.example). Fill in the OAuth client IDs
 * from Google Cloud Console (APIs & Services → Credentials) before shipping; see README "Sign-in setup".
 */
export const config = {
  /** The backend (MY-EXPENCES-BACKEND). In development the simulator reaches your Mac's localhost. */
  apiUrl:
    API_URL ||
    (__DEV__
      ? Platform.select({
          android: 'http://10.0.2.2:3000', // Android emulator → host machine
          default: 'http://localhost:3000',
        })
      : 'https://my-expences-mocha.vercel.app'), // Deployed backend (Vercel)

  google: {
    /** "Web application" client ID: Google issues the ID token for it, and the backend checks it (GOOGLE_CLIENT_IDS). */
    webClientId:
      GOOGLE_WEB_CLIENT_ID || 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
    /** "iOS" client ID. Its reversed form must also be a URL scheme in ios/Expences/Info.plist. */
    iosClientId:
      GOOGLE_IOS_CLIENT_ID || 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
  },

  privacyPolicyUrl: PRIVACY_POLICY_URL || 'https://your-domain.com/privacy',
  termsUrl: TERMS_URL || 'https://your-domain.com/terms',
};

export const isGoogleConfigured = () =>
  !config.google.webClientId.startsWith('YOUR_');
