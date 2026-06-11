-- ============================================================================
-- Source Data Reorg campaign, step 4: materialize vehicles.existence_tier.
-- docs/plans/2026-06-11_source-data-reorg-campaign.md (step 4)
--
-- OPERATIONAL classification column (not testimony — recomputable at any
-- time from on-row counters + EXISTS probes; a mistake is a re-run, not a
-- loss). Encodes render-worthiness so RLS/search/profile surfaces can stop
-- guessing (steps 5-7 wire the consumers; nothing reads it yet).
--
-- Tiers (measured predicates from the 3-agent substrate audit, predictions
-- in parens against the 910,175-row table):
--   'dead' (~316K) deleted_at IS NOT NULL OR merged_into_vehicle_id IS NOT NULL
--   'a'    (~325K) human-linked (user_id/uploaded_by/owner_id set, or an
--                  active vehicle_user_permissions row)
--                  OR dense substrate: image_count>=4 AND (EXISTS
--                  vehicle_events OR EXISTS vehicle_observations) AND
--                  year+make+model all set
--   'b'    (~166K) live, not 'a', any sale-price column > 0 (sale_price,
--                  sold_price, bat_sold_price, canonical_sold_price) AND
--                  year+make set — comp-stub stratum
--   'c'    (~103K) remaining live rows — archive substrate, queryable forever
--
-- BACKFILL IS NOT IN THIS MIGRATION. An unbounded UPDATE over 910K rows
-- violates .claude/rules/db-safety.md — and the vehicles table carries 26
-- UPDATE triggers whose unscoped members (trigger_update_vehicle_status,
-- update_vehicle_completion, vehicles_update_timestamp,
-- vehicles_search_vector_trigger) make ANY mass UPDATE both >110s/batch
-- (measured) and churn-corrupting: updated_at + last_activity_at bumped and
-- a completion-recompute enqueued on every one of 910K rows. The backfill
-- therefore runs in two phases via scripts/backfill-existence-tier.sh:
--   A) tiers computed READ-ONLY into existence_tier_staging (no trigger
--      fires anywhere) — executed 2026-06-10;
--   B) gated copy staging -> vehicles.existence_tier, 1,000/batch — needs
--      either the churn triggers scoped to their columns first, or
--      owner-sanctioned per-session trigger suspension (the integrity
--      triggers — VIN uniqueness, taxonomy, normalize — are column-scoped
--      to vin/make/model/etc and never fire for an existence_tier-only
--      update either way). See the script header.
-- display_tier is untouched (FB importer's featured semantics).
-- ============================================================================

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS existence_tier text;

-- Staging side of the two-phase backfill (phase A target, phase B source).
-- Operational, recomputable, not testimony.
CREATE TABLE IF NOT EXISTS public.existence_tier_staging (
  vehicle_id uuid PRIMARY KEY,
  tier text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.existence_tier_staging IS
  'Operational staging for the source-data-reorg step-4 existence_tier backfill: tiers computed read-only from vehicles (no trigger churn). Copy into vehicles.existence_tier is the gated final step. Recomputable; not testimony. See scripts/backfill-existence-tier.sh.';

COMMENT ON COLUMN public.vehicles.existence_tier IS
  'Operational render-worthiness tier (source-data-reorg step 4): dead=soft-deleted/merged; a=human-linked or dense (>=4 images + events/observations + full YMM); b=comp stub (sale price + year/make); c=archive residue. Recomputable — backfilled/maintained by scripts/backfill-existence-tier.sh; NOT testimony.';

-- Partial index for the live-tier predicates the RLS/search consumers will
-- use (steps 5-7). On prod this was created CONCURRENTLY (2026-06-10);
-- IF NOT EXISTS makes this a no-op there and a plain create on fresh DBs.
CREATE INDEX IF NOT EXISTS idx_vehicles_existence_tier
  ON public.vehicles (existence_tier)
  WHERE deleted_at IS NULL;
