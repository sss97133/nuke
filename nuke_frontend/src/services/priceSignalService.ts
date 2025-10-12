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
  if (m?.is_for_sale && typeof m?.asking_price === 'number') return { label: 'ASK', amount: m.asking_price };
  if (typeof m?.sale_price === 'number') return { label: 'SOLD', amount: m.sale_price };
  if (typeof m?.current_value === 'number') return { label: 'EST', amount: m.current_value };
  if (typeof m?.purchase_price === 'number') return { label: 'PAID', amount: m.purchase_price };
  if (typeof m?.msrp === 'number') return { label: 'MSRP', amount: m.msrp };
  return { label: null, amount: null };
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
