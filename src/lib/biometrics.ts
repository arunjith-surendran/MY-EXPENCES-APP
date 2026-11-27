import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.expences.app.salary-reveal';

/**
 * Asks for Face ID / Touch ID (or the device passcode as fallback). Reading a Keychain item
 * guarded by biometric access control is what triggers the system prompt; the item itself
 * holds nothing secret. Resolves false when the user cancels or authentication fails.
 */
export async function authenticate(title: string): Promise<boolean> {
  // No passcode set: the phone itself is unlocked to anyone, nothing to check against.
  if (!(await canAuthenticate())) return true;
  try {
    if (!(await Keychain.hasGenericPassword({ service: SERVICE }))) {
      await Keychain.setGenericPassword('salary', 'reveal', {
        service: SERVICE,
        accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
        accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      });
    }
    const entry = await Keychain.getGenericPassword({
      service: SERVICE,
      authenticationPrompt: { title, cancel: 'Cancel' },
    });
    return entry !== false;
  } catch {
    return false;
  }
}

/** False when the phone has no passcode, so there is nothing to lock with. */
export function canAuthenticate(): Promise<boolean> {
  return Keychain.isPasscodeAuthAvailable().catch(() => false);
}

/** "Face ID", "Touch ID" or "Passcode", for labels. */
export async function biometryLabel(): Promise<string> {
  const type = await Keychain.getSupportedBiometryType().catch(() => null);
  if (type === Keychain.BIOMETRY_TYPE.FACE_ID) return 'Face ID';
  if (type === Keychain.BIOMETRY_TYPE.TOUCH_ID) return 'Touch ID';
  return 'Passcode';
}
