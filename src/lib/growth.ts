import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from './auth/AuthContext';
import type { PlanId } from './subscription';

export type PlanEventType =
  | 'paywall_view'
  | 'plan_select'
  | 'subscribe_tap'
  | 'offer_view';

/** A limited-time discount set up on the admin side. */
export type Offer = {
  id: string;
  title: string;
  message: string | null;
  discountPercent: number;
  plan: 'all' | PlanId;
  audience: 'all' | 'trial' | 'free' | 'user';
  userId: string | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
};

/** Reports interest in the plans, so the admin side can see who is close to subscribing. Never throws. */
export function useTrack() {
  const { authedRequest } = useAuth();
  return useCallback(
    (type: PlanEventType, extra: { plan?: string; offerId?: string } = {}) => {
      authedRequest('/events', { body: { type, ...extra } }).catch(() => {});
    },
    [authedRequest],
  );
}

// Offer views are counted once per app run, not on every visit to Home.
const seenOffers = new Set<string>();

/** The running offer for this user, refreshed whenever the screen comes into view. */
export function useCurrentOffer() {
  const { authedRequest } = useAuth();
  const track = useTrack();
  const [offer, setOffer] = useState<Offer | null>(null);

  useFocusEffect(
    useCallback(() => {
      authedRequest<{ offer: Offer | null }>('/offers/current')
        .then(result => {
          setOffer(result.offer);
          if (result.offer && !seenOffers.has(result.offer.id)) {
            seenOffers.add(result.offer.id);
            track('offer_view', { offerId: result.offer.id });
          }
        })
        .catch(() => {});
    }, [authedRequest, track]),
  );

  // Drop it the moment it ends.
  const now = useNow(30_000);
  return offer && Date.parse(offer.endsAt) > now ? offer : null;
}

/** The current time, updated every `ms` (for countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** "2d 4h", "3h 12m", "45m" until `endsAt`. */
export function timeLeft(endsAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export const offerApplies = (offer: Offer | null, plan: PlanId) =>
  offer != null && (offer.plan === 'all' || offer.plan === plan);

export const discounted = (amount: number, percent: number) =>
  `AED ${(Math.round(amount * (100 - percent)) / 100).toFixed(2)}`;
