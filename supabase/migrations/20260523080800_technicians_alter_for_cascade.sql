-- 20260523080800_technicians_alter_for_cascade.sql
--
-- The technicians table already existed with a different schema (id, name, license_number,
-- certification_level, specializations text[], shop_id FK, hourly_rate_cents,
-- experience_years, contact_info jsonb, active, inserted_at, updated_at).
--
-- This migration ALTERs that existing table to add the cascade-related columns from
-- 20260523080100_technicians_table.sql, preserving existing rows + FKs.

ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS contact_id              UUID,
  ADD COLUMN IF NOT EXISTS user_id                 UUID,
  ADD COLUMN IF NOT EXISTS display_name            TEXT,
  ADD COLUMN IF NOT EXISTS tier_inferred           TEXT CHECK (tier_inferred IN ('apprentice', 'journeyman', 'master', 'specialist')),
  ADD COLUMN IF NOT EXISTS tier_multiplier         NUMERIC(4,2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS tier_evidence_count     INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier_last_computed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_hourly_rate     NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS inferred_hourly_rate    NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS inferred_rate_confidence TEXT CHECK (inferred_rate_confidence IN ('zero_data', 'low_n_under_3', 'moderate_n_under_10', 'high_n_at_least_10', 'fallback_to_claimed_rate')),
  ADD COLUMN IF NOT EXISTS specialties_jsonb       JSONB DEFAULT '{}'::jsonb,  -- richer than existing text[] specializations
  ADD COLUMN IF NOT EXISTS pace_metrics            JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS geography_history       JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_makes_touched   JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tool_usage_summary      JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ppe_compliance          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vehicles_touched_count  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clients_served_count    INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS certifications_jsonb    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source                  TEXT,
  ADD COLUMN IF NOT EXISTS rate_delta              NUMERIC GENERATED ALWAYS AS (claimed_hourly_rate - inferred_hourly_rate) STORED;

CREATE INDEX IF NOT EXISTS idx_technicians_tier ON public.technicians(tier_inferred);
CREATE INDEX IF NOT EXISTS idx_technicians_user ON public.technicians(user_id);

-- Technician work-evidence table (this part was new — should have applied cleanly but didn't due to early error)
CREATE TABLE IF NOT EXISTS public.technician_work_evidence (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id               UUID NOT NULL REFERENCES public.technicians(id) ON DELETE CASCADE,
  derived_from_image_id       UUID,
  derived_from_observation_id UUID,
  vehicle_id                  UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  observed_at                 TIMESTAMPTZ NOT NULL,
  specialty                   TEXT,
  operation                   TEXT,
  duration_minutes            INT,
  tier_signal                 TEXT,
  tools_visible               JSONB DEFAULT '[]'::jsonb,
  ppe_visible                 JSONB DEFAULT '[]'::jsonb,
  notes                       TEXT,
  source_method               TEXT,
  source_model                TEXT,
  confidence                  NUMERIC(3,2),
  created_at                  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (technician_id, derived_from_image_id, operation)
);

CREATE INDEX IF NOT EXISTS idx_tech_evidence_technician ON public.technician_work_evidence(technician_id);
CREATE INDEX IF NOT EXISTS idx_tech_evidence_vehicle ON public.technician_work_evidence(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tech_evidence_observed ON public.technician_work_evidence(observed_at DESC);

GRANT SELECT ON public.technician_work_evidence TO anon, authenticated;
