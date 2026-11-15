// Evidence pages are not consented identity displays. Raw prose, nested JSON,
// OCR and original artifacts can contain names even without a `name` field.
// Keep this projection closed until a trusted, privacy-reviewed reader exists;
// a source handle, public vehicle or caller-supplied consent flag is insufficient.
const measurements = new Set([
  'value', 'confidence_score', 'completion_pct', 'items_complete', 'items_in_progress',
  'total_paid', 'balance_remaining', 'mileage', 'odometer', 'year', 'quantity',
  'duration_minutes', 'labor_hours', 'image_count', 'displacement', 'horsepower',
  'torque', 'voltage', 'amperage', 'resistance', 'temperature', 'weight',
]);

const categories: Record<string, readonly string[]> = {
  build_phase: ['pre-delivery', 'planning', 'in-progress', 'complete', 'post-delivery'],
  next_milestone: ['paint_completion', 'inspection', 'assembly', 'testing', 'delivery'],
  currency: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY', 'CHF'],
  observed_at_confidence: ['low', 'medium', 'high'],
  observed_at_source: ['file_upload_timestamp_ms', 'printed_date', 'source_timestamp'],
  source_reported_outcome: ['sold', 'unsold', 'no_sale', 'unknown'],
  source_reported_listing_stage: ['sold', 'unsold', 'ended'],
  source_reported_sale_format: ['auction', 'sealed', 'classified'],
  source_reported_amount_type: ['sale_price', 'high_bid'],
  source_reported_currency: ['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'CHF', 'JPY', 'HKD', 'SGD', 'NZD', 'AED', 'ZAR', 'SEK', 'NOK', 'DKK', 'not_stated'],
  source_reported_amount_status: ['not_stated', 'reported'],
  source_reported_fee_basis: ['unknown'], mileage_unit: ['mi', 'km'],
};

export function publicObservationData(data: Record<string, unknown> | null): Record<string, unknown> {
  const visible: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (measurements.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      visible[key] = value;
    } else if (key === 'source_reported_amount' && typeof value === 'number' && Number.isFinite(value) && value > 0) {
      visible[key] = value;
    } else if (key === 'reported_bid_count' && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      visible[key] = value;
    } else if (key === 'value' && typeof value === 'boolean') {
      visible[key] = value;
    } else if (Object.prototype.hasOwnProperty.call(categories, key) && typeof value === 'string' && categories[key].includes(value)) {
      visible[key] = value;
    } else if (['source_reported_event_at', 'source_captured_at'].includes(key) && typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now()) {
      visible[key] = new Date(value).toISOString();
    }
  }
  // Auction amounts are source claims, not verified transaction values. Project
  // only numbers and closed enums; never pass through the claim's literal text.
  const result = data?.result_claim;
  if (data?.kind_detail === 'auction_listing' && result && typeof result === 'object' && !Array.isArray(result)) {
    const claim = result as Record<string, unknown>;
    if ((claim.status === 'sold' || claim.status === 'no_sale') &&
        typeof claim.amount === 'number' && Number.isFinite(claim.amount) && claim.amount >= 0) {
      visible.source_reported_outcome = claim.status;
      visible.source_reported_amount_type = claim.status === 'sold' ? 'sale_price' : 'high_bid';
      visible.source_reported_amount = claim.amount;
      visible.source_reported_currency = typeof claim.currency === 'string' && categories.currency.includes(claim.currency)
        ? claim.currency : 'not_stated';
      visible.source_reported_fee_basis = 'unknown';
    }
  }
  return visible;
}

export function publicObservationArtifact(): string | null {
  return null; // No trusted redacted-artifact or name-consent reader is installed.
}

/** A transcription is not an original document or a decoded factory claim.
 * Only two-digit paint codes survive; all prose, identifiers and URLs stay out. */
export function publicCowlTagExtract(data: Record<string, unknown> | null) {
  if (data?.decode_rule !== 'cowl_tag_decode_v1' || data.claim_role !== 'cowl_tag_paint'
    || data.visual_relation !== 'direct_code') return null;
  const code = (value: unknown): string | null => typeof value === 'string' && /^[0-9]{2}$/.test(value) ? value : null;
  const lower = code(data.paint_code), upper = code(data.paint_code_secondary);
  if (!lower || !upper) return null;
  return { lower, upper };
}

/** A reviewed rendition may use Storage's render endpoint for the same object.
 * Unknown parameters and different paths/hosts do not qualify. This is URL
 * identity, not a claim that bytes behind an unchanged URL were rehashed. */
export function sameReviewedImage(reviewed: unknown, current: string) {
  if (typeof reviewed !== 'string' || !reviewed) return false;
  if (reviewed === current) return true;
  try {
    const a = new URL(reviewed), b = new URL(current);
    if (a.protocol !== 'https:' || a.origin !== b.origin || a.username || b.username
      || a.password || b.password || a.hash || b.hash) return false;
    const path = (url: URL) => {
      if (!/^\/storage\/v1\/(object|render\/image)\/public\//.test(url.pathname)) return null;
      for (const key of url.searchParams.keys()) if (!['width', 'height', 'quality', 'resize', 'format'].includes(key)) return null;
      return url.pathname.replace('/storage/v1/render/image/public/', '/storage/v1/object/public/');
    };
    const first = path(a);
    return first !== null && first === path(b);
  } catch { return false; }
}

/** Public reproduction fields from current witnessed readings of one plate.
 * Identifying body/sequence numbers and prose are deliberately never copied. */
export function publicCowlTagFields(rows: unknown[], vehicleId: string, imageId: string, imageUrl: string, reviewedHash: string) {
  const fields: Record<string, Set<string>> = {};
  const accept = (key: string, value: unknown, pattern: RegExp) => {
    if (typeof value === 'string' && pattern.test(value)) (fields[key] ??= new Set()).add(value);
  };
  for (const witness of rows) {
    const w = witness as any, row = w?.observation, d = row?.structured_data;
    if (w?.witness_role !== 'derived' || row?.vehicle_id !== vehicleId || row.is_superseded || row.superseded_by
      || row.extraction_method !== 'cowl_tag_decode_v1' || d?.decode_rule !== 'cowl_tag_decode_v1' || d?.image_id !== imageId
      || !/^[a-f0-9]{64}$/.test(reviewedHash) || d.reviewed_sha256 !== reviewedHash
      || d.visual_relation !== 'direct_code' || !sameReviewedImage(d.reviewed_url, imageUrl)) continue;
    const role = d.claim_role;
    if (role === 'cowl_tag_style' || role === 'cowl_tag_transcription') {
      accept('modelYear', d.tag_model_year, /^[0-9]{2}$/);
      accept('style', d.fisher_style_number, /^[1-9][A-Z]{2}[0-9]{2}$/);
    }
    if (role === 'cowl_tag_body_number' || role === 'cowl_tag_transcription') accept('plant', d.assembly_plant_code, /^[A-Z]$/);
    if (role === 'cowl_tag_trim' || role === 'cowl_tag_transcription') {
      accept('trim', d.interior_trim_code, /^[0-9]{3}$/);
      accept('seat', d.seat_code, /^[A-Z][0-9]{2}$/);
    }
    if (role === 'cowl_tag_paint' || role === 'cowl_tag_transcription') {
      accept('paintLower', d.paint_code, /^[0-9]{2}$/);
      accept('paintUpper', d.paint_code_secondary, /^[0-9]{2}$/);
    }
    if (role === 'cowl_tag_build_date' || role === 'cowl_tag_transcription') accept('buildDate', d.body_build_date_code, /^(0[1-9]|1[0-2])[A-E]$/);
  }
  const single = (key: string) => fields[key]?.size === 1 ? [...fields[key]][0] : undefined;
  return { modelYear: single('modelYear'), style: single('style'), plant: single('plant'), trim: single('trim'),
    seat: single('seat'), paintLower: single('paintLower'), paintUpper: single('paintUpper'), buildDate: single('buildDate') };
}

export const OBSERVATION_PRIVACY_NOTICE = 'Source text and artifacts are withheld pending privacy review.';
