-- 20260523080100_technicians_table.sql
--
-- Technician profile substrate. Per docs/library/reference/encyclopedia/05-image-as-butterfly-node.md
-- a technician profile accumulates evidence atoms (specialty hours, tool usage, PPE compliance,
-- pace metrics, geography history, vehicle makes touched, client history) — all derived from the
-- photo cascade.
--
-- The technician's INFERRED tier is computed from the evidence base, not claimed.
-- Skylar's worth-proof at the person level depends on this table existing + being populated
-- by the multi-atom-per-photo writer (still to build).
--
-- A technician's `claimed_hourly_rate` and `inferred_hourly_rate` sit alongside each other.
-- The delta is the worth-proof.
--
-- Cross-references:
--   • docs/library/reference/encyclopedia/05-image-as-butterfly-node.md (How effort benefits the technician)
--   • docs/library/working/working-papers/2026-05-23_worth-proving-engine-retrospective.md
--   • compute_inferred_value() RPC — will query this table when populated

CREATE TABLE IF NOT EXISTS public.technicians (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id                  UUID,  -- soft ref to future contacts table; no FK to avoid coupling
  user_id                     UUID,  -- nullable, links to auth.users for technicians who are also platform users
  name                        TEXT NOT NULL,
  display_name                TEXT,

  -- Tier — INFERRED from evidence, not claimed
  tier_inferred               TEXT CHECK (tier_inferred IN ('apprentice', 'journeyman', 'master', 'specialist')),
  tier_multiplier             NUMERIC(4,2) DEFAULT 1.00,  -- 0.70 apprentice / 1.00 journeyman / 1.40 master
  tier_evidence_count         INT DEFAULT 0,
  tier_last_computed_at       TIMESTAMPTZ,

  -- Rates
  claimed_hourly_rate         NUMERIC(8,2),
  inferred_hourly_rate        NUMERIC(8,2),
  inferred_rate_confidence    TEXT CHECK (inferred_rate_confidence IN ('zero_data', 'low_n_under_3', 'moderate_n_under_10', 'high_n_at_least_10', 'fallback_to_claimed_rate')),
  rate_delta                  NUMERIC GENERATED ALWAYS AS (claimed_hourly_rate - inferred_hourly_rate) STORED,

  -- Specialties — JSONB so evolution doesn't require schema migration
  -- shape: {"wiring": {"hours": 145.5, "evidence_count": 38, "skill_score": 0.82}, ...}
  specialties                 JSONB DEFAULT '{}'::jsonb,

  -- Pace metrics: per-operation observed median minutes
  -- shape: {"exhaust_install": {"median_minutes": 240, "n": 12}, ...}
  pace_metrics                JSONB DEFAULT '{}'::jsonb,

  -- Geography: shops worked at over time
  -- shape: [{"shop_id": "...", "first_observed_at": "2024-01-15", "hours_logged": 320}]
  geography_history           JSONB DEFAULT '[]'::jsonb,

  -- Vehicle makes touched: which makes this tech has experience with
  -- shape: {"Ford": {"hours": 145, "vehicles": 8}, "GMC": ...}
  vehicle_makes_touched       JSONB DEFAULT '{}'::jsonb,

  -- Tool usage summary (skill signal — see chapter 05 "technician skill scoring")
  -- shape: {"tig_welder": {"observed_count": 23, "first_observed": "...", "last_observed": "..."}}
  tool_usage_summary          JSONB DEFAULT '{}'::jsonb,

  -- PPE compliance
  -- shape: {"gloves": {"observed_pct": 0.85}, "safety_glasses": {"observed_pct": 0.20}}
  ppe_compliance              JSONB DEFAULT '{}'::jsonb,

  -- Client/vehicle history
  vehicles_touched_count      INT DEFAULT 0,
  clients_served_count        INT DEFAULT 0,

  -- Certifications (separate from inferred — these are CLAIMED with source)
  -- shape: [{"name": "I-CAR Platinum", "issued_at": "...", "source_doc_url": "..."}]
  certifications              JSONB DEFAULT '[]'::jsonb,

  -- Provenance
  source                      TEXT,  -- e.g. 'photo_cascade', 'manual_entry', 'imported'
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now(),

  UNIQUE (contact_id)
);

CREATE INDEX IF NOT EXISTS idx_technicians_tier ON public.technicians(tier_inferred);
CREATE INDEX IF NOT EXISTS idx_technicians_user ON public.technicians(user_id);
CREATE INDEX IF NOT EXISTS idx_technicians_name ON public.technicians(name);

-- Per-photo technician work evidence — the cascade atom for the "Skylar's hands doing wiring" case
CREATE TABLE IF NOT EXISTS public.technician_work_evidence (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id               UUID NOT NULL REFERENCES public.technicians(id) ON DELETE CASCADE,
  derived_from_image_id       UUID REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  derived_from_observation_id UUID,  -- references vehicle_observations(id) but no FK to avoid coupling
  vehicle_id                  UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  observed_at                 TIMESTAMPTZ NOT NULL,
  specialty                   TEXT,        -- 'wiring', 'paint', 'engine', etc
  operation                   TEXT,        -- 'wiring_install_or_trace', 'harness_fabrication', etc
  duration_minutes            INT,         -- estimated minutes for THIS evidence atom
  tier_signal                 TEXT,        -- 'apprentice', 'journeyman', 'master' — inferred from operation quality
  tools_visible               JSONB DEFAULT '[]'::jsonb,
  ppe_visible                 JSONB DEFAULT '[]'::jsonb,
  notes                       TEXT,
  source_method               TEXT,        -- 'caller-vision-Read-tool', 'cv-classifier', etc
  source_model                TEXT,
  confidence                  NUMERIC(3,2),
  created_at                  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (technician_id, derived_from_image_id, operation)
);

CREATE INDEX IF NOT EXISTS idx_tech_evidence_technician ON public.technician_work_evidence(technician_id);
CREATE INDEX IF NOT EXISTS idx_tech_evidence_vehicle ON public.technician_work_evidence(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tech_evidence_observed ON public.technician_work_evidence(observed_at DESC);

GRANT SELECT ON public.technicians TO anon, authenticated;
GRANT SELECT ON public.technician_work_evidence TO anon, authenticated;

COMMENT ON TABLE public.technicians IS
'Technician profiles. Tier and hourly_rate are INFERRED from photo-cascade evidence, not claimed. The delta between claimed and inferred is the worth-proof at the person level. See encyclopedia chapter 05.';

COMMENT ON TABLE public.technician_work_evidence IS
'Per-photo evidence atoms derived from the photo cascade. Each row = one observation of this technician doing a specific operation, with tools/PPE visible and tier signal. Aggregated nightly to populate technicians.specialties / .pace_metrics / .tool_usage_summary.';
