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

import {
  getMeta,
  listUnconvertedCurrencies,
  setAedAmounts,
  setMeta,
} from './db';

/** AED → currency, e.g. { INR: 25.19 }, as of `updatedAt` (unix ms). */
export type Rates = { updatedAt: number; rates: Record<string, number> };

const CURRENCY_KEY = 'fx_currency';
const RATES_KEY = 'fx_rates';
/** The sources update once a day; checking twice a day keeps us within a day of current. */
const MAX_AGE_MS = 12 * 3_600_000;

/** Free, no key. Attribution is required by its terms (shown under the picker). */
const PRIMARY = 'https://open.er-api.com/v6/latest/AED';
const FALLBACK =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/aed.min.json';

/** Offered first in the picker: where most UAE residents send money home. */
export const POPULAR = [
  'INR',
  'PKR',
  'PHP',
  'BDT',
  'LKR',
  'NPR',
  'EGP',
  'USD',
  'EUR',
  'GBP',
  'SAR',
];

export const CURRENCY_NAMES: Record<string, string> = {
  INR: 'Indian rupee',
  PKR: 'Pakistani rupee',
  PHP: 'Philippine peso',
  BDT: 'Bangladeshi taka',
  LKR: 'Sri Lankan rupee',
  NPR: 'Nepalese rupee',
  EGP: 'Egyptian pound',
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  SAR: 'Saudi riyal',
  QAR: 'Qatari riyal',
  OMR: 'Omani rial',
  KWD: 'Kuwaiti dinar',
  BHD: 'Bahraini dinar',
  JOD: 'Jordanian dinar',
  LBP: 'Lebanese pound',
  CAD: 'Canadian dollar',
  AUD: 'Australian dollar',
  CNY: 'Chinese yuan',
  JPY: 'Japanese yen',
  KES: 'Kenyan shilling',
  NGN: 'Nigerian naira',
  ZAR: 'South African rand',
  IDR: 'Indonesian rupiah',
  MYR: 'Malaysian ringgit',
  SGD: 'Singapore dollar',
  THB: 'Thai baht',
  TRY: 'Turkish lira',
  RUB: 'Russian ruble',
  CHF: 'Swiss franc',
};

/** Reads either source's JSON into AED-based rates with upper-case codes. Pure, for tests. */
export function parseRates(json: unknown, now = Date.now()): Rates | null {
  const j = json as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_unix?: number;
    aed?: Record<string, number>;
    date?: string;
  };
  let raw: Record<string, number> | undefined;
  let updatedAt = now;
  if (j?.result === 'success' && j.rates) {
    raw = j.rates;
    if (j.time_last_update_unix) updatedAt = j.time_last_update_unix * 1000;
  } else if (j?.aed) {
    raw = j.aed;
    if (j.date) updatedAt = Date.parse(`${j.date}T00:00:00Z`) || now;
  }
  if (!raw) return null;
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw)) {
    // Fiat ISO codes only (the fallback also lists crypto like "1inch").
    if (/^[a-z]{3}$/i.test(code) && Number.isFinite(value) && value > 0) {
      rates[code.toUpperCase()] = value;
    }
  }
  return rates.INR ? { updatedAt, rates } : null;
}

export function isStale(r: Rates | null, now = Date.now()) {
  return !r || now - r.updatedAt > MAX_AGE_MS;
}

/** "₹2,519" (en-IN grouping for rupees), whole units above 100, else 2 decimals. */
export function formatIn(amount: number, code: string): string {
  const locale = code === 'INR' ? 'en-IN' : 'en-AE';
  try {
    return amount.toLocaleString(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    });
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

async function download(): Promise<Rates | null> {
  for (const url of [PRIMARY, FALLBACK]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const parsed = parseRates(await res.json());
      if (parsed) return { ...parsed, updatedAt: Date.now() };
    } catch {
      // Try the next source.
    }
  }
  return null;
}

/**
 * Gives foreign-currency expenses (e.g. a USD Apple Pay tap abroad) their AED value, so
 * they count in totals. Uses the cached rates, downloading fresh ones if they're old.
 * Each expense keeps the rate from when it was first converted. Never throws.
 */
export async function convertForeignExpenses(): Promise<number> {
  try {
    const pending = await listUnconvertedCurrencies();
    if (pending.length === 0) return 0;
    let rates: Rates | null = null;
    try {
      const cached = await getMeta(RATES_KEY);
      rates = cached ? (JSON.parse(cached) as Rates) : null;
    } catch {}
    if (isStale(rates)) {
      const fresh = await download();
      if (fresh) {
        rates = fresh;
        await setMeta(RATES_KEY, JSON.stringify(fresh)).catch(() => {});
      }
    }
    if (!rates) return 0;
    let converted = 0;
    for (const code of pending) {
      const perAed = rates.rates[code.toUpperCase()];
      if (perAed) {
        await setAedAmounts(code, perAed);
        converted++;
      }
    }
    return converted;
  } catch {
    return 0;
  }
}

type Conversion = {
  /** The chosen currency, or null when conversion is off. */
  currency: string | null;
  setCurrency: (code: string | null) => void;
  rates: Rates | null;
  /** "≈ ₹2,519" for an AED amount, or null (off, or no rates yet). */
  convert: (aed: number) => string | null;
};

const ConversionContext = createContext<Conversion>({
  currency: null,
  setCurrency: () => {},
  rates: null,
  convert: () => null,
});

/** Loads the chosen currency and cached rates once the database is ready; refreshes stale rates. */
export function ConversionProvider({
  ready,
  children,
}: {
  ready: boolean;
  children: ReactNode;
}) {
  const [currency, setCurrencyState] = useState<string | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);

  const refresh = useCallback(async (current: Rates | null) => {
    if (!isStale(current)) return;
    const fresh = await download();
    if (!fresh) return; // offline: keep the cached rates
    setRates(fresh);
    await setMeta(RATES_KEY, JSON.stringify(fresh)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [code, cached] = await Promise.all([
        getMeta(CURRENCY_KEY).catch(() => null),
        getMeta(RATES_KEY).catch(() => null),
      ]);
      let parsed: Rates | null = null;
      try {
        parsed = cached ? (JSON.parse(cached) as Rates) : null;
      } catch {}
      setCurrencyState(code || null);
      setRates(parsed);
      if (code) await refresh(parsed);
    })();
  }, [ready, refresh]);

  // Coming back to the app the next day picks up the new rate.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && currency) refresh(rates);
    });
    return () => sub.remove();
  }, [currency, rates, refresh]);

  const setCurrency = useCallback(
    (code: string | null) => {
      setCurrencyState(code);
      setMeta(CURRENCY_KEY, code ?? '').catch(() => {});
      if (code) refresh(rates);
    },
    [rates, refresh],
  );

  const value = useMemo<Conversion>(() => {
    const rate = currency ? rates?.rates[currency] : undefined;
    return {
      currency,
      setCurrency,
      rates,
      convert: (aed: number) =>
        rate && currency ? `≈ ${formatIn(aed * rate, currency)}` : null,
    };
  }, [currency, rates, setCurrency]);

  return createElement(ConversionContext.Provider, { value }, children);
}

export function useConversion() {
  return useContext(ConversionContext);
}
