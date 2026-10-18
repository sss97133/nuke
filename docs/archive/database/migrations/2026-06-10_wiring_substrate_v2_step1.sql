-- =============================================================================
-- WIRING SUBSTRATE V2 — STEP 1 (2026-06-10)
-- Spec: docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md ("every wiring fact is a DB atom
--       with provenance and state; every document is a projection")
-- Receipt: docs/wiring/receipts/2026-06-10_substrate-v2-step1-ingestion.md
--
-- DELTA PHILOSOPHY: reuse existing tables (vehicle_build_manifest,
-- vehicle_custom_circuits, vehicle_wiring_overlays) wherever a column already
-- exists. This migration adds ONLY what the spec requires and nothing existing
-- can carry. All target tables are tiny (manifest 141 rows, circuits 12 rows),
-- so ALTERs are instantaneous — no batching needed for DDL; ingest writes are
-- batched multi-row INSERTs (hard rule #8 satisfied by row volume « 1,000).
-- No backfill UPDATEs here: Step 1 is INSERT-only by design; mapping the
-- existing manifest status values (identified/purchased) onto lifecycle_state
-- (ordered vs in_hand is ambiguous for 'purchased') is a Skylar-level call,
-- deferred to Step 2.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. DEVICES: vehicle_build_manifest gains lifecycle_state + subsystem
--    (spec §"The model — Device": concept → decided → ordered → in_hand →
--     installed → wired → verified; subsystem = the workbench toggle group).
--    Existing `status` column is NOT reused: its enum (identified/sourced/
--    purchased/installed/wired/verified) conflates procurement and build and
--    cannot represent concept/decided/in_hand without rewriting checked data.
-- -----------------------------------------------------------------------------
ALTER TABLE vehicle_build_manifest
  ADD COLUMN IF NOT EXISTS lifecycle_state text
    CHECK (lifecycle_state IS NULL OR lifecycle_state IN
      ('concept','decided','ordered','in_hand','installed','wired','verified')),
  ADD COLUMN IF NOT EXISTS subsystem text;

COMMENT ON COLUMN vehicle_build_manifest.lifecycle_state IS
  'Wiring Substrate v2 device lifecycle (spec docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md). NULL = not yet migrated from legacy status column.';
COMMENT ON COLUMN vehicle_build_manifest.subsystem IS
  'Workbench toggle group, keys from docs/wiring/calc-data/subsystems.json (e.g. CORE_ENGINE, FUEL, LIGHTING_EXTERIOR).';

-- -----------------------------------------------------------------------------
-- 2. CIRCUITS: vehicle_custom_circuits gains build_state + derivation_version
--    + planned_length_ft. build_state is Dave's "28 of 61 pins" as live data.
--    planned_length_ft is NEW because measured_length_ft must stay reserved for
--    tape measurements (numbers carry source DNA — cut-list v4.1 lengths are
--    zone estimates / twin-derived, explicitly NOT measured per the file header).
-- -----------------------------------------------------------------------------
ALTER TABLE vehicle_custom_circuits
  ADD COLUMN IF NOT EXISTS build_state text NOT NULL DEFAULT 'uncut'
    CHECK (build_state IN ('uncut','cut','terminated_a','terminated_b','routed','verified')),
  ADD COLUMN IF NOT EXISTS derivation_version text,
  ADD COLUMN IF NOT EXISTS planned_length_ft numeric;

COMMENT ON COLUMN vehicle_custom_circuits.build_state IS
  'Physical build progress per wire (Wiring Substrate v2): uncut → cut → terminated_a → terminated_b → routed → verified.';
COMMENT ON COLUMN vehicle_custom_circuits.derivation_version IS
  'Which derivation produced this row (e.g. v4.1 = K5_cut_list_v4_1.txt one-time ingest).';
COMMENT ON COLUMN vehicle_custom_circuits.planned_length_ft IS
  'Planned/estimated cut length (zone estimate or digital-twin derived). NOT a tape measurement — those go in measured_length_ft.';

-- Natural key for idempotent ingest (existing 12 rows have distinct codes; verified pre-migration).
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_custom_circuits_overlay_code_uniq
  ON vehicle_custom_circuits (overlay_id, circuit_code);

-- -----------------------------------------------------------------------------
-- 3. NEW TABLE: wiring_decisions
--    JUSTIFICATION (hard rule #2): spec §"The model — Decision" requires
--    decision rows (subject, chosen, source, supersedes) so receipts become
--    queryable atoms with supersession chains. Audited alternatives:
--    wiring_design_issues (issue tracker, no chosen/supersedes semantics),
--    vehicle_observations (testimony table — wiring decisions are working
--    state, not vehicle testimony; also blocked for raw INSERT by trust rules).
--    Nothing existing carries a decision chain. Receipts stay as human render.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wiring_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   uuid NOT NULL REFERENCES vehicles(id),
  slug         text NOT NULL UNIQUE,          -- natural key = receipt id (YYYY-MM-DD_slug)
  decided_on   date,
  subject      text,                          -- first heading of the receipt
  chosen       text,                          -- shallow: heading/status line; deep parse deferred
  change_type  text,                          -- frontmatter change_type (decision/substrate_amendment/retraction/...)
  scope        text,
  status       text,
  source       text NOT NULL DEFAULT 'v1_file_substrate',
  supersedes   text[] DEFAULT '{}',           -- slugs from amends:/retracts: frontmatter
  receipt_path text NOT NULL,                 -- archive pointer to the frozen v1 file
  created_at   timestamptz DEFAULT now()
);
COMMENT ON TABLE wiring_decisions IS
  'Wiring Substrate v2 decision atoms — one row per docs/wiring/receipts/*.md, ingested 2026-06-10 (spec WIRING_SUBSTRATE_V2_SPEC.md). Receipts remain the human render; rows are the queryable chain.';

-- -----------------------------------------------------------------------------
-- 4. NEW TABLE: wiring_policy_rules
--    JUSTIFICATION (hard rule #2): spec §"The model — Rule" splits physics
--    (stays in code, harnessDerivation.ts) from POLICY (3% Vdrop, ×1.25 safety,
--    length pads, PDM channel ratings) which must be versioned rows with
--    provenance + successor pointers so Dave can challenge them. Audited
--    alternatives: the *_rules tables (aml/normalization/parsing — unrelated
--    domains), pdm_channels (per-channel instance data, not the rating policy).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wiring_policy_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid REFERENCES vehicles(id),  -- NULL = platform doctrine, set = vehicle-specific override
  rule_key       text NOT NULL,                 -- e.g. vdrop_max_pct, safety_margin_multiplier
  rule_value     jsonb NOT NULL,                -- value + structure ({"value":3,"unit":"pct"} or rating tables)
  version        text NOT NULL,                 -- e.g. v1_file_substrate_2026-06-10
  source         text NOT NULL,                 -- citation (doc/code path that carried the rule in v1)
  effective_date date,
  superseded_by  uuid REFERENCES wiring_policy_rules(id),
  notes          text,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (rule_key, version)
);
COMMENT ON TABLE wiring_policy_rules IS
  'Versioned wiring POLICY rows (Wiring Substrate v2). Physics stays in code; policy (limits, margins, pads, ratings) lives here with provenance and supersession. "Lawful" dies here per spec.';

-- -----------------------------------------------------------------------------
-- 5. NEW TABLE: vehicle_harness_landmarks
--    JUSTIFICATION (hard rule #2): the 30 L## routing landmarks
--    (K5_landmarks_blender_derived.yaml) are named path-segment distances with
--    method + provenance — the substrate for every length derivation. Audited
--    alternatives: vehicle_circuit_measurements (per-circuit FK shape, not
--    named waypoint segments), harness_endpoints (canvas UI nodes, FK to
--    harness_designs). Nothing existing models a landmark distance atom.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_harness_landmarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  landmark_code text NOT NULL,                 -- L01..L30
  description   text,                          -- the yaml comment (endpoints + anchor refs)
  distance_in   numeric NOT NULL,              -- inches along planned path, no service loop
  method        text NOT NULL,                 -- blender_polyline_derived_v2 | analytic_polyline_derived | tape_measured
  derived_on    date,
  derived_by    text,
  source_file   text,
  assumptions   text,                          -- A#/C# anchor + conflict flags from the yaml header
  superseded_by uuid REFERENCES vehicle_harness_landmarks(id),
  notes         text,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, landmark_code, method)
);
COMMENT ON TABLE vehicle_harness_landmarks IS
  'Named harness routing landmark distances (L## path segments) with derivation method + provenance. Tape measurements supersede derived rows via superseded_by — never UPDATE in place.';

COMMIT;
