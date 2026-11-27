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
  cash: '#0F7B55', // cash payments (paired with a "Cash" label)
  // Gradients run top-left → bottom-right. Text on them is always onAccent.
  gradients: {
    hero: ['#3D6EF5', '#1F4FD1', '#2B2E9C'],
    cash: ['#16A06C', '#0F7B55'],
    good: ['#1FA463', '#13804B'],
    warn: ['#E08A1E', '#B45309'],
    bad: ['#E5484D', '#B01A1A'],
    surface: ['#FFFFFF', '#F3F6FC'],
  } as Record<'hero' | 'cash' | 'good' | 'warn' | 'bad' | 'surface', string[]>,
  shadowOpacity: 0.16,
  // Chart series in fixed order (essentials, lifestyle, other); checked with the dataviz validator.
  series: ['#2A78D6', '#EB6834', '#1BAF7A'],
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
  // Categories the user adds take one of these, picked from the name so it stays the same.
  customCategories: [
    '#0B7A75',
    '#B5476B',
    '#4A64D0',
    '#8A6D00',
    '#7A52C7',
    '#2F8A3A',
    '#C2410C',
    '#0369A1',
  ],
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
  cash: '#2FBF8A',
  gradients: {
    hero: ['#4D7CFE', '#2F56D8', '#3A2B9E'],
    cash: ['#1FA673', '#117A55'],
    good: ['#25A866', '#167A47'],
    warn: ['#D98A1F', '#A35A0A'],
    bad: ['#E5484D', '#A31919'],
    surface: ['#172031', '#121926'],
  },
  shadowOpacity: 0.45,
  series: ['#3987E5', '#D95926', '#199E70'],
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
  customCategories: [
    '#14A39C',
    '#D55A82',
    '#6A84EE',
    '#B08F10',
    '#9772E0',
    '#3BA64A',
    '#E0612A',
    '#1E8FCB',
  ],
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

/** A soft shadow tinted with `color`, so a blue button casts a faint blue glow below it. */
export function glow(color: string, radius = 14): ViewStyle {
  return {
    shadowColor: color,
    shadowOpacity: 0.28,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: Math.round(radius / 2.5) },
    elevation: Math.min(Math.round(radius / 3), 8),
  };
}

/** The resting shadow under cards: neutral in light mode, deeper in dark mode. */
export function cardShadow(t: Theme): ViewStyle {
  return {
    shadowColor: t.scheme === 'dark' ? '#000000' : '#1B2A4A',
    shadowOpacity: t.shadowOpacity,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
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
  if (category in ICONS) {
    return { color: t.categories[category], icon: ICONS[category] };
  }
  // A category the user added: color from its name, badge from its first letters.
  const name = category.trim();
  if (!name) return { color: t.categories.Other, icon: ICONS.Other };
  let hash = 0;
  for (const ch of name.toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_003;
  }
  const words = name.split(/\s+/);
  const icon = (
    words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)
  ).toUpperCase();
  return {
    color: t.customCategories[hash % t.customCategories.length],
    icon,
  };
}
