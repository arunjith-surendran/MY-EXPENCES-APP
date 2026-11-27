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

import { authenticate } from './biometrics';
import { formatMoney } from './parse';

/** Shown in place of any salary-derived figure while hidden. */
export const HIDDEN_AMOUNT = 'AED ••••••';

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
    const ok = await authenticate('Show salary');
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
