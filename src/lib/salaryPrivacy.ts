import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';

import { formatMoney } from './parse';

const SERVICE = 'com.expences.app.salary-reveal';

/** Shown in place of any salary-derived figure while hidden. */
export const HIDDEN_AMOUNT = 'AED ••••••';

/**
 * Asks for Face ID / Touch ID (or the device passcode as fallback). Reading a Keychain item
 * guarded by biometric access control is what triggers the system prompt; the item itself
 * holds nothing secret. Resolves false when the user cancels or authentication fails.
 */
async function authenticate(): Promise<boolean> {
  // No passcode set: the phone itself is unlocked to anyone, nothing to check against.
  if (!(await Keychain.isPasscodeAuthAvailable().catch(() => false))) {
    return true;
  }
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
      authenticationPrompt: {
        title: 'Show salary',
        cancel: 'Cancel',
      },
    });
    return entry !== false;
  } catch {
    return false;
  }
}

type SalaryPrivacy = {
  hidden: boolean;
  /** Prompts Face ID; resolves true once salary is visible. */
  reveal: () => Promise<boolean>;
  hide: () => void;
  /** formatMoney, or the mask while hidden. */
  money: (amount: number) => string;
};

const SalaryPrivacyContext = createContext<SalaryPrivacy>({
  hidden: true,
  reveal: async () => false,
  hide: () => {},
  money: () => HIDDEN_AMOUNT,
});

/**
 * Salary figures start hidden, like a banking app's balance, and hide again whenever
 * the app leaves the foreground.
 */
export function SalaryPrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') setHidden(true);
    });
    return () => sub.remove();
  }, []);

  const reveal = useCallback(async () => {
    if (!hidden) return true;
    const ok = await authenticate();
    if (ok) setHidden(false);
    return ok;
  }, [hidden]);

  const hide = useCallback(() => setHidden(true), []);

  const value = useMemo(
    () => ({
      hidden,
      reveal,
      hide,
      money: (amount: number) => (hidden ? HIDDEN_AMOUNT : formatMoney(amount)),
    }),
    [hidden, reveal, hide],
  );
  return createElement(SalaryPrivacyContext.Provider, { value }, children);
}

export function useSalaryPrivacy() {
  return useContext(SalaryPrivacyContext);
}
