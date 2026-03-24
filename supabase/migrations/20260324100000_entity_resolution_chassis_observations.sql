-- Entity Resolution: Enhance merge_proposals + Create chassis_observations
--
-- Justification:
-- 1. merge_proposals gets new columns (match_tier, match_reason, confidence,
--    human_verified, proposed_by, etc.) to support the tiered entity resolution
--    pipeline defined in docs/architecture/ENTITY_RESOLUTION_RULES.md
-- 2. chassis_observations tracks chassis/engine/body numbers observed at events,
--    solving the conceptcarz problem where 35K vehicles represent the same
--    physical cars appearing at multiple events with no VIN but with chassis numbers.

-- ── Enhance merge_proposals ─────────────────────────────────────
ALTER TABLE merge_proposals
  ADD COLUMN IF NOT EXISTS match_tier int,
  ADD COLUMN IF NOT EXISTS match_reason text,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposed_by text DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text;

-- Constraints
DO $$ BEGIN
  ALTER TABLE merge_proposals
    ADD CONSTRAINT merge_proposals_match_tier_check
      CHECK (match_tier IS NULL OR (match_tier BETWEEN 1 AND 4));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE merge_proposals
    ADD CONSTRAINT merge_proposals_confidence_check
      CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_merge_proposals_status ON merge_proposals(status);
CREATE INDEX IF NOT EXISTS idx_merge_proposals_vehicle_a ON merge_proposals(vehicle_a_id);
CREATE INDEX IF NOT EXISTS idx_merge_proposals_vehicle_b ON merge_proposals(vehicle_b_id);
CREATE INDEX IF NOT EXISTS idx_merge_proposals_tier ON merge_proposals(match_tier) WHERE status = 'pending';

-- ── Create chassis_observations ─────────────────────────────────
CREATE TABLE IF NOT EXISTS chassis_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id),
  chassis_number text NOT NULL,
  chassis_number_normalized text NOT NULL,
  number_type text NOT NULL DEFAULT 'chassis'
    CHECK (number_type IN ('chassis', 'engine', 'body', 'serial', 'frame', 'unknown')),
  source_platform text NOT NULL,
  source_url text,
  source_event_id text,
  observed_year int,
  observed_make text,
  observed_model text,
  observed_at timestamptz,
  transcription_confidence numeric DEFAULT 1.0
    CHECK (transcription_confidence BETWEEN 0 AND 1),
  extracted_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chassis_obs_normalized ON chassis_observations(chassis_number_normalized);
CREATE INDEX IF NOT EXISTS idx_chassis_obs_vehicle ON chassis_observations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_chassis_obs_platform ON chassis_observations(source_platform);
CREATE INDEX IF NOT EXISTS idx_chassis_obs_make_year ON chassis_observations(observed_make, observed_year)
  WHERE observed_make IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chassis_obs_unique
  ON chassis_observations(chassis_number_normalized, source_platform, COALESCE(source_event_id, ''));
