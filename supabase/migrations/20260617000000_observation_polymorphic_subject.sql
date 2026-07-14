-- 20260617000000_observation_polymorphic_subject.sql
--
-- KEYSTONE STEP 1 — make the observation subject polymorphic.
-- Design + rationale: docs/library/technical/engineering-manual/20-polymorphic-subject-build-guide.md
-- Approved by Skylar 2026-06-17 (schema change gate).
--
-- WHY: the observation system's declared target (schematics/observation-system.md)
-- is a single, type-agnostic intake path — the "Body without Organs". Today
-- observations are vehicle-keyed, so only vehicles can be "built out via proof".
-- This lifts the proven polymorphic-subject pattern from the financial layer
-- (cashflow_deals.subject_type, 20260112100000) up into the testimony layer so an
-- org / user / asset can accumulate verified observations the same way a vehicle
-- does. Unblocks: org build-out, asset analysis, CPA profiles, modes-as-projection.
--
-- SAFETY (vehicle_observations is ~7.5M rows, a testimony table under the trust
-- invariant — see .claude/rules/agent-trust-invariants.md):
--   * Purely ADDITIVE. No existing testimony value is read, updated, or deleted.
--   * subject_type uses a CONSTANT default → metadata-only in PG11+ (no table
--     rewrite, momentary catalog lock only). Safe at 7.5M rows.
--   * subject_id is NULLABLE with no default → metadata-only, instant.
--   * NO backfill UPDATE. Legacy rows keep subject_id NULL; the EFFECTIVE subject
--     is (subject_type, COALESCE(subject_id, vehicle_id)). This avoids rewriting
--     7.5M rows and never touches existing testimony.
--   * CHECK added NOT VALID → instant, no full-table scan; enforces new/updated
--     rows immediately. VALIDATE deferred to a follow-up (all legacy rows are
--     'vehicle' by default and already satisfy it).
--   * NO index here. A non-concurrent index on 7.5M rows would lock writes;
--     CREATE INDEX CONCURRENTLY cannot run inside a migration txn. Deferred to a
--     separate, concurrent follow-up once non-vehicle rows actually exist.
--
-- BACKWARD COMPATIBILITY: subject_type defaults to 'vehicle'; the existing
-- ingest-observation contract and every current reader are unaffected. Non-vehicle
-- subjects merely become EXPRESSIBLE.

ALTER TABLE vehicle_observations
  ADD COLUMN IF NOT EXISTS subject_type text NOT NULL DEFAULT 'vehicle',
  ADD COLUMN IF NOT EXISTS subject_id uuid;

COMMENT ON COLUMN vehicle_observations.subject_type IS
  'Polymorphic subject kind: vehicle|organization|user|asset. Default vehicle for backward compat. See engineering-manual/20.';
COMMENT ON COLUMN vehicle_observations.subject_id IS
  'Polymorphic subject id. NULL for legacy vehicle rows; effective subject = COALESCE(subject_id, vehicle_id). See engineering-manual/20.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_observations_subject_type_chk'
  ) THEN
    ALTER TABLE vehicle_observations
      ADD CONSTRAINT vehicle_observations_subject_type_chk
      CHECK (subject_type IN ('vehicle','organization','user','asset')) NOT VALID;
  END IF;
END $$;
