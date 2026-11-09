import { formatCurrencyAmount } from '../../utils/currency';

// Explicit ISO codes supported by the existing currency utility; never a default denomination.
const currencies = new Set((Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] }).supportedValuesOf?.('currency')
  ?? ['USD', 'EUR', 'GBP', 'AED', 'CHF', 'JPY', 'CAD', 'AUD']);
export function recordedCurrency(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return currencies.has(code) ? code : null;
}
const lotKey = (value: unknown): string | null => {
  try {
    const u = new URL(String(value));
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch { return null; }
};

/** A current episode's currency cannot denominate another source/amount's price. */
export function currentBidEvidenceAmount(
  fact: { price_amount: number | null; source_url: string | null },
  pulse: { listing_url: string; current_bid: number | null; currency_code?: string | null } | null,
): string {
  const amount = fact.price_amount;
  if (amount == null || !Number.isFinite(amount)) return 'Unrecorded';
  const currency = recordedCurrency(pulse?.currency_code);
  const sameLot = lotKey(fact.source_url) != null && lotKey(fact.source_url) === lotKey(pulse?.listing_url);
  return sameLot && pulse?.current_bid === amount && currency
    ? formatCurrencyAmount(amount, { currency, maximumFractionDigits: 2 })
    : `${amount.toLocaleString('en-US')} (currency unrecorded)`;
}

/** Legacy event counters default to zero; zero alone is not a source measurement. */
export function recordedAudienceCount(value: unknown, explicit: unknown): number | null {
  if (typeof explicit === 'number' && Number.isSafeInteger(explicit) && explicit >= 0) return explicit;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
