-- Deal Jacket Decomposition: add sale_result to deal-jacket-ocr source
--
-- The decompose-deal-jacket function emits sale_result observations that capture
-- complete transaction financials (fees, proceeds, profit).
-- sale_result already exists in the observation_kind enum (20260124),
-- but wasn't included in the deal-jacket-ocr source's supported_observations.

-- Add sale_result to observation_kind enum if somehow missing (idempotent safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'observation_kind'::regtype
      AND enumlabel = 'sale_result'
  ) THEN
    ALTER TYPE observation_kind ADD VALUE 'sale_result';
  END IF;
END $$;

-- Update deal-jacket-ocr supported_observations to include sale_result
UPDATE observation_sources
SET supported_observations = ARRAY['provenance','ownership','work_record','specification','sale_result']::observation_kind[]
WHERE slug = 'deal-jacket-ocr';
