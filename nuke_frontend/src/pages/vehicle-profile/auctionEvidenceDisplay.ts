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

export interface NativeListingHistory {
  observation_id: string; source_url: string; source_listing_id: string;
  source: 'collecting-cars'; qualification: 'publisher_reported_unverified';
  reported_outcome: 'sold' | 'unsold' | 'unknown'; reported_amount: number | null; currency: string | null;
  reported_listing_stage?: 'sold' | 'unsold' | 'ended'; sale_format?: 'auction' | 'sealed' | 'classified' | null;
  reported_amount_kind: 'sale_price' | 'high_bid' | null;
  reported_event_at: string | null; source_captured_at: string; ingested_at: string;
  mileage: number | null; mileage_unit: 'mi' | 'km' | null; bid_count: number | null;
}
const validInstant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();
/** Only the existing sanitized profile RPC may supply this source history.
 * It is separate from canonical properties and verified sale-price facts. */
export function readNativeListingHistory(input: unknown, vehicleId: string): { entries: NativeListingHistory[]; hasMore: boolean } {
  const rows = input as any;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.vehicle_id !== vehicleId
    || rows[0]?.schema_version !== 'vehicle_data_model_v1') throw Error('Source history unavailable');
  const history = rows[0].native_listing_history;
  if (history === undefined) return { entries: [], hasMore: false }; // older deployed reader
  if (!['cc_native_profile_history_v1', 'cc_native_profile_history_v2'].includes(history?.reader) || history.capture_limit !== 50
    || typeof history.has_more_captures !== 'boolean' || !Array.isArray(history.entries) || history.entries.length > 50
    || !history.entries.every((r: NativeListingHistory) => r && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.observation_id)
      && r.source === 'collecting-cars' && r.qualification === 'publisher_reported_unverified'
      && /^https:\/\/collectingcars\.com\/for-sale\/[a-zA-Z0-9+-]+$/.test(r.source_url) && /^\d+$/.test(r.source_listing_id)
      && ['sold', 'unsold', 'unknown'].includes(r.reported_outcome)
      && (r.reported_listing_stage === undefined || ['sold', 'unsold', 'ended'].includes(r.reported_listing_stage))
      && (r.sale_format === undefined || [null, 'auction', 'sealed', 'classified'].includes(r.sale_format))
      && (r.reported_listing_stage !== 'ended' || (r.reported_event_at !== null
        && (r.sale_format === 'classified' ? r.reported_outcome === 'unknown'
          : ['auction', 'sealed'].includes(r.sale_format ?? '') && r.reported_outcome === 'unsold')))
      && (r.reported_outcome !== 'unknown' || (r.reported_listing_stage === 'ended' && r.sale_format === 'classified'
        && r.reported_amount === null && r.reported_amount_kind === null))
      && (r.reported_amount_kind === null || (r.reported_outcome === 'sold' ? r.reported_amount_kind === 'sale_price' : r.reported_outcome === 'unsold' && r.reported_amount_kind === 'high_bid'))
      && (r.reported_amount === null || (r.reported_amount_kind !== null && typeof r.reported_amount === 'number' && Number.isFinite(r.reported_amount) && r.reported_amount > 0))
      && (r.currency === null || (typeof r.currency === 'string' && recordedCurrency(r.currency) === r.currency))
      && validInstant(r.source_captured_at) && validInstant(r.ingested_at) && Date.parse(r.ingested_at) >= Date.parse(r.source_captured_at)
      && (r.reported_event_at === null || (validInstant(r.reported_event_at) && Date.parse(r.reported_event_at) <= Date.parse(r.source_captured_at)))
      && (r.mileage === null || (typeof r.mileage === 'number' && Number.isFinite(r.mileage) && r.mileage >= 0 && r.mileage < 10000000))
      && [null, 'mi', 'km'].includes(r.mileage_unit)
      && (r.bid_count === null || (Number.isSafeInteger(r.bid_count) && r.bid_count >= 0 && r.bid_count <= 10000000)))) {
    throw Error('Invalid source history');
  }
  if (new Set(history.entries.map((r: NativeListingHistory) => r.source_url)).size !== history.entries.length) throw Error('Ambiguous source history');
  return { entries: history.entries, hasMore: history.has_more_captures };
}

export function nativeListingObservationData(row: NativeListingHistory): Record<string, unknown> {
  return { source_reported_outcome: row.reported_outcome, source_reported_amount: row.reported_amount,
    source_reported_listing_stage: row.reported_listing_stage, source_reported_sale_format: row.sale_format,
    source_reported_amount_type: row.reported_amount_kind,
    source_reported_amount_status: row.reported_amount === null ? 'not_stated' : 'reported',
    source_reported_currency: row.currency ?? 'not_stated', source_reported_event_at: row.reported_event_at,
    source_captured_at: row.source_captured_at, source_reported_fee_basis: 'unknown',
    mileage: row.mileage, mileage_unit: row.mileage_unit, reported_bid_count: row.bid_count };
}
