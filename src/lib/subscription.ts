import { useEffect } from 'react';

import type { User } from './api';
import { useAuth } from './auth/AuthContext';
import { setMeta } from './db';

/** Mirrors the backend's TRIAL_DAYS (src/users/subscription.ts). */
const TRIAL_DAYS = 30;
const DAY_MS = 86_400_000;

export type Plan = 'trial' | 'pro' | 'free';

/** App Store product ids; create these in App Store Connect with the same ids. */
export const PLANS = [
  {
    id: 'pro_yearly',
    title: 'Yearly',
    price: 'AED 79.99',
    amount: 79.99,
    period: 'year',
    note: 'Just AED 6.67 a month',
    badge: 'Best value · Save 33%',
  },
  {
    id: 'pro_monthly',
    title: 'Monthly',
    price: 'AED 9.99',
    amount: 9.99,
    period: 'month',
    note: 'Cancel anytime',
    badge: null,
  },
] as const;

export type PlanId = (typeof PLANS)[number]['id'];

/** What Pro unlocks, shown on the paywall. Manual entry, every recorded expense and CSV export stay free. */
export const PRO_FEATURES = [
  'Apple Pay auto-logging: every tap saved by itself',
  'Bank statement import (PDF / CSV)',
  'Charts, highlights and spending by category',
  'Salary budget and safe-to-spend per day',
  'Monthly chart, all-time totals and averages',
] as const;

/**
 * Worked out on the device from the dates the server sent, so the trial ends on time
 * even offline. Sessions saved before subscriptions existed have no `subscription`:
 * their trial counts from `createdAt`, like the server's.
 */
export function subscriptionOf(user: User | null, now = Date.now()) {
  const trialEndsAt = user?.subscription?.trialEndsAt
    ? Date.parse(user.subscription.trialEndsAt)
    : user
    ? Date.parse(user.createdAt) + TRIAL_DAYS * DAY_MS
    : 0;
  const proUntil = user?.subscription?.proUntil
    ? Date.parse(user.subscription.proUntil)
    : null;
  const plan: Plan =
    proUntil != null && proUntil > now
      ? 'pro'
      : trialEndsAt > now
      ? 'trial'
      : 'free';
  return {
    plan,
    /** Trial or paid: everything unlocked. */
    hasPro: plan !== 'free',
    trialDaysLeft:
      plan === 'trial' ? Math.ceil((trialEndsAt - now) / DAY_MS) : 0,
    /** When full access ends (unix ms). */
    accessUntil: Math.max(trialEndsAt, proUntil ?? 0),
  };
}

export function useSubscription() {
  const { user } = useAuth();
  return subscriptionOf(user);
}

/**
 * Tells the Wallet automation (ios/Expences/SavePaymentIntent.swift) until when it may
 * auto-log. It runs without the app, so it reads this from the database.
 */
export function useSyncProAccess() {
  const { accessUntil } = useSubscription();
  useEffect(() => {
    if (accessUntil > 0) {
      setMeta('pro_access_until', String(accessUntil)).catch(() => {});
    }
  }, [accessUntil]);
}
