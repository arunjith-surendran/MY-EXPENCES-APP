import { NativeModules } from 'react-native';

/** Used only if the native AppInfo module is missing (an old build). Keep it near MARKETING_VERSION. */
const FALLBACK_VERSION = '1.0.0';

const info = NativeModules.AppInfo as
  | { version?: string; build?: string }
  | undefined;

/**
 * This build's version, read from the app bundle (MARKETING_VERSION in Xcode), and sent
 * to the backend to decide whether it must update.
 */
export const APP_VERSION = info?.version || FALLBACK_VERSION;

/** The build number (CURRENT_PROJECT_VERSION), for display. */
export const APP_BUILD = info?.build || '';
