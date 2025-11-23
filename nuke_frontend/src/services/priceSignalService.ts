/**
 * Price Signal Service
 *
 * Minimal, dependency-free helpers to compute a vehicle's primary price label
 * and a simple delta vs anchor using only existing vehicle fields.
 *
 * Priority for primary price (first available):
 *  - ASK (is_for_sale && asking_price)
 *  - SOLD (sale_price)
 *  - EST (current_value)
 *  - PAID (purchase_price)
 *  - MSRP (msrp)
 *
 * Delta anchor preference:
 *  - Compare primary (ASK/EST/SOLD) vs purchase_price
 *  - Else compare vs msrp
 */

export type PrimaryPriceLabel = 'ASK' | 'SOLD' | 'EST' | 'PAID' | 'MSRP' | null;

export interface PriceInfo {
  label: PrimaryPriceLabel;
  amount: number | null;
  source?: string; // Database field name that provided this price
}

export interface DeltaInfo {
  amount: number; // difference in USD
  percent: number; // percentage vs anchor
  isPositive: boolean;
}

export interface VehiclePriceMetadata {
  msrp?: number | null;
  current_value?: number | null;
  purchase_price?: number | null;
  asking_price?: number | null;
  sale_price?: number | null;
  is_for_sale?: boolean | null;
}

export const formatCurrency = (value?: number | null): string => {
  if (typeof value !== 'number') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
};

export const computePrimaryPrice = (m: VehiclePriceMetadata): PriceInfo => {
  if (m?.is_for_sale && typeof m?.asking_price === 'number') return { label: 'ASK', amount: m.asking_price, source: 'asking_price' };
  if (typeof m?.sale_price === 'number') return { label: 'SOLD', amount: m.sale_price, source: 'sale_price' };
  if (typeof m?.current_value === 'number') return { label: 'EST', amount: m.current_value, source: 'current_value' };
  if (typeof m?.purchase_price === 'number') return { label: 'PAID', amount: m.purchase_price, source: 'purchase_price' };
  if (typeof m?.msrp === 'number') return { label: 'MSRP', amount: m.msrp, source: 'msrp' };
  return { label: null, amount: null, source: '' };
};

export const computeDelta = (m: VehiclePriceMetadata): DeltaInfo | null => {
  // Primary: prefer current/ask/sold
  const primary = (typeof m?.current_value === 'number' ? m.current_value
                : typeof m?.asking_price === 'number' ? m.asking_price
                : typeof m?.sale_price === 'number' ? m.sale_price
                : null);
  // Anchor: prefer purchase, else msrp
  const anchor = (typeof m?.purchase_price === 'number' ? m.purchase_price
               : typeof m?.msrp === 'number' ? m.msrp
               : null);
  if (primary == null || anchor == null || anchor === 0) return null;
  const amount = primary - anchor;
  const percent = (amount / anchor) * 100;
  return { amount, percent, isPositive: amount >= 0 };
};

export interface ReadinessBreakdown {
  listingCompleteness: number;   // 0..40
  imagesReadiness: number;       // 0..25
  pricingReadiness: number;      // 0..15
  verificationReadiness: number; // 0..10
  activityMomentum: number;      // 0..10
}

export interface ReadinessResult {
  score: number;                 // 0..100
  breakdown: ReadinessBreakdown;
  eta_days?: number | null;      // optional rough ETA
}

export const computeReadinessScore = (args: {
  meta: any;             // vehicle metadata (from feed)
  imagesCount: number;   // number of images (thumbnails count ok)
  createdAt?: string;    // ISO date string (vehicle.created_at)
}): ReadinessResult => {
  const m = args?.meta || {};
  const images = Math.max(0, Number(args?.imagesCount || 0));

  let listing = 0;
  if (m?.year && m?.make && m?.model) listing += 10;
  if (m?.vin && String(m.vin).length >= 8) listing += 10;
  if (m?.description && String(m.description).trim().length >= 30) listing += 10;
  if (m?.color || m?.mileage || m?.trim || m?.transmission) listing += 10;
  listing = Math.min(40, listing);

  const imgRatio = Math.max(0, Math.min(1, images / 8));
  const imagesReadiness = Math.round(imgRatio * 25);

  const p = computePrimaryPrice(m);
  const pricingReadiness = (p.label && typeof p.amount === 'number') ? 15 : 0;

  const verified = Boolean(m?.is_verified_owner || m?.ownership_verified === true);
  const verificationReadiness = verified ? 10 : 0;

  let activity = 0;
  if (args?.createdAt) {
    const days = Math.max(0, (Date.now() - new Date(args.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 7) activity = 10;
    else if (days <= 30) activity = 5;
  }

  const breakdown: ReadinessBreakdown = {
    listingCompleteness: listing,
    imagesReadiness,
    pricingReadiness,
    verificationReadiness,
    activityMomentum: activity,
  };
  const score = Math.max(0, Math.min(100, listing + imagesReadiness + pricingReadiness + verificationReadiness + activity));
  return { score, breakdown, eta_days: null };
};
