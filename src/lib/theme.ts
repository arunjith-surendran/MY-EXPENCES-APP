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
import { useColorScheme, type ViewStyle } from 'react-native';

import { getMeta, setMeta } from './db';

// A restrained finance palette: deep blue primary, teal highlight, slate neutrals.
// Status colors (success / warning / danger) are always paired with a text label.
// Category colors were checked against each surface (contrast >= 3:1, colorblind-separable with labels).
const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: '#F4F6FA',
  card: '#FFFFFF',
  cardHi: '#EEF2F7',
  text: '#0B1324',
  muted: '#5B6577',
  border: '#E2E8F0',
  accent: '#1F4FD1', // primary: buttons, links, the current month
  accentSoft: '#E8EEFC', // tinted background behind accent content
  onAccent: '#FFFFFF', // text on a filled accent / highlight / danger button
  highlight: '#0E7C86', // secondary emphasis: today, highest month
  secondary: '#6B7FA8', // past months in charts and lists
  success: '#13804B',
  warning: '#B45309',
  danger: '#C81E1E',
  categories: {
    Groceries: '#25904A',
    'Food & Dining': '#D2620A',
    Transport: '#008A9E',
    Fuel: '#A67C00',
    'Bills & Utilities': '#5E5CE6',
    Shopping: '#D12E6E',
    Entertainment: '#8E4FD6',
    Health: '#D93B40',
    Other: '#8E8E93',
  } as Record<string, string>,
};

const dark: typeof light = {
  scheme: 'dark',
  bg: '#0A0E16',
  card: '#131A26',
  cardHi: '#1B2433',
  text: '#E8EDF5',
  muted: '#8B96A8',
  border: '#243043',
  accent: '#4D7CFE',
  accentSoft: '#17233F',
  onAccent: '#FFFFFF',
  highlight: '#2BB3BF',
  secondary: '#7D8CB0',
  success: '#2FBF71',
  warning: '#F0A732',
  danger: '#F05252',
  categories: {
    Groceries: '#30B05A',
    'Food & Dining': '#D9660A',
    Transport: '#0FA3B1',
    Fuel: '#B88C00',
    'Bills & Utilities': '#6E6CF0',
    Shopping: '#E0367A',
    Entertainment: '#A06AE8',
    Health: '#E5484D',
    Other: '#8E8E93',
  },
};

export type Theme = typeof light;
export type ThemeMode = 'system' | 'light' | 'dark';

type ThemeState = {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeState>({
  theme: dark,
  mode: 'system',
  setMode: () => {},
});

/**
 * Follows the phone's light/dark setting unless the user picked one in Appearance.
 * The choice is stored in the database once `ready` (after migrations).
 */
export function ThemeProvider({
  ready,
  children,
}: {
  ready: boolean;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    if (!ready) return;
    getMeta('theme_mode')
      .then(v => {
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      })
      .catch(() => {});
  }, [ready]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setMeta('theme_mode', next).catch(() => {});
  }, []);

  const scheme =
    mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  const value = useMemo(
    () => ({ theme: scheme === 'dark' ? dark : light, mode, setMode }),
    [scheme, mode, setMode],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeMode() {
  const { mode, setMode } = useContext(ThemeContext);
  return { mode, setMode };
}

/** A soft, neutral card shadow (the color argument is kept for call-site compatibility). */
export function glow(_color: string, _radius = 14): ViewStyle {
  return {
    shadowColor: '#0B1324',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  };
}

/** Headline numbers no longer glow; kept as a no-op so call sites stay simple. */
export function textGlow(_color: string) {
  return {};
}

// `icon` is a two-letter badge (emoji glyphs don't render reliably everywhere).
const ICONS: Record<string, string> = {
  Groceries: 'GR',
  'Food & Dining': 'FD',
  Fuel: 'FU',
  Transport: 'TR',
  'Bills & Utilities': 'BL',
  Shopping: 'SH',
  Health: 'HE',
  Entertainment: 'EN',
  Other: 'OT',
};

export function categoryStyle(category: string, t: Theme) {
  const key = category in ICONS ? category : 'Other';
  return { color: t.categories[key], icon: ICONS[key] };
}
