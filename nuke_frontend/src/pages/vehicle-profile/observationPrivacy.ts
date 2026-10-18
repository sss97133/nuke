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
  return visible;
}

export function publicObservationArtifact(): string | null {
  return null; // No trusted redacted-artifact or name-consent reader is installed.
}

export const OBSERVATION_PRIVACY_NOTICE = 'Source text and artifacts are withheld pending privacy review.';
