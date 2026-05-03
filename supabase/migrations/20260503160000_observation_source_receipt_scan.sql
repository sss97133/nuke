-- WS-3: Receipts → vehicle_observations bridge
-- Register the 'receipt-scan' observation source so ingest-observation accepts it.
-- Receipts are documentation testimony (OCR + LLM extraction), trust 0.85.
-- Also adds bookkeeping columns to receipts so we can mark which ones were
-- already submitted as observations (idempotent re-runs).

INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations, notes)
VALUES (
  'receipt-scan',
  'Receipt OCR',
  'documentation',
  0.85,
  ARRAY['work_record','specification','comment']::observation_kind[],
  'Receipts table OCR extractions (Apple Vision + Claude re-extraction). One receipt = one observation. Parts/labor receipts → work_record; insurance/registration/title docs → specification; misc → comment.'
)
ON CONFLICT (slug) DO UPDATE
SET supported_observations = EXCLUDED.supported_observations,
    base_trust_score = EXCLUDED.base_trust_score,
    notes = EXCLUDED.notes;

-- Bookkeeping: which receipts have been submitted to ingest-observation
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS submitted_observation_id uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_receipts_submission_pending
  ON receipts (vehicle_id)
  WHERE submitted_observation_id IS NULL AND vehicle_id IS NOT NULL;
