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
};

export function publicObservationData(data: Record<string, unknown> | null): Record<string, unknown> {
  const visible: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (measurements.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      visible[key] = value;
    } else if (key === 'value' && typeof value === 'boolean') {
      visible[key] = value;
    } else if (Object.prototype.hasOwnProperty.call(categories, key) && typeof value === 'string' && categories[key].includes(value)) {
      visible[key] = value;
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

export const OBSERVATION_PRIVACY_NOTICE = 'Source text and artifacts are withheld pending privacy review.';
