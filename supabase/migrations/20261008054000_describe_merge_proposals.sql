-- Describe merge_proposals: all 21 columns (0 of 21 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and a corrected table comment. Comments only. This is a different table from vehicle_merge_proposals, which the web
-- merge screens read and write.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 34,783 rows on 2026-10-07 16:58Z by exact count (the
-- atlas estimate of 33,423 is a stale pg_class.reltuples); rows arrive with every new listing vehicle (928 so far today).
--
-- METHOD (read 2026-10-07 16:57-17:20Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies, RLS, grants
--   (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint,
--   pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; foreign keys in and views from pg_constraint and
--   pg_depend (none). Exact over the whole table (27 MB heap, read only): the counts by detection_source, status,
--   ai_decision, match_tier, proposed_by, confidence, match_reason and creation month; the fills; the evidence keys; the
--   distinct vehicles; proposed_at against created_at; and the state of both vehicles of every pair (soft-deleted,
--   merged, platform, VIN) by a join to vehicles. What anon can read comes from a count under SET LOCAL ROLE anon in a
--   read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 0409bab44 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps): the creating script scripts/generate-merge-proposals.mjs (CREATE TABLE IF NOT
--   EXISTS; not in prod migration history); 20260324100000_entity_resolution_chassis_observations.sql (match_tier through
--   reviewed_by, the tier and confidence checks and the indexes); docs/architecture/ENTITY_RESOLUTION_RULES.md (the tiers);
--   20261006073000_table_purpose_live_tables.sql (the former table comment); the edge function ingest (index.ts, Tier 3
--   entity resolution); the web files that name vehicle_merge_proposals instead (MergeProposalsPanel.tsx,
--   VehicleMergeInterface.tsx, MergeHistoryBanner.tsx, MarkAsDuplicateButton.tsx, TriageDock.tsx,
--   MergeProposalsDashboard.tsx); scripts/guardrails/no-raw-testimony-insert.mjs. Bodies read with pg_get_functiondef: the
--   4 live functions whose body names the table (propose_vin_merges, propose_owner_merges, and the triggers
--   enforce_vin_uniqueness and enforce_image_origin_consistency, which only name it in a hint), propose_anchor_merges and
--   get_merge_proposals_with_details, with their EXECUTE grants; cron.job (no job names the table or the proposers);
--   write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 row; none is added or changed here).
-- LIMITS:
--   How propose_vin_merges and propose_owner_merges were run on 2026-05-24 is not recorded (propose_anchor_merges has no
--   caller in the repo or in SQL). pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The
--   rows pair vehicles of public listings and of one owner: quoted values are decision, status, tier, source and reason
--   codes, column and function names and counts only; no vehicle id, VIN, URL, location, price, user id or reviewer text.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Proposed duplicate-vehicle merges: one row per candidate pair (vehicle_a_id, vehicle_b_id) with
--   detection source, match tier, evidence and AI and human verdicts (grain: one proposed pair). Writers: SQL
--   propose_vin_merges and propose_owner_merges, edge function ingest, scripts/generate-merge-proposals.mjs. created_at =
--   proposal time (2026-03-21 .. 2026-10-06); executed_at when merged." The opening stays. Corrected: 99.5% of the rows
--   carry no AI or human verdict (ingest writes REVIEW as a constant and nothing reviews them); the SQL proposers have no
--   caller and ran once. Added: the liveness, the absence of a consumer, the blocked deletes and the access.
--   There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.merge_proposals IS
'Proposed merges of two vehicle rows that may be one physical vehicle: one row per ordered pair (UNIQUE vehicle_a_id, vehicle_b_id; grain: one proposed pair) with the detection source, match tier, confidence, reasons, evidence and verdict fields. 34,783 rows on 2026-10-07 16:58Z (exact): pending 34,762, executed 17, approved 4, rejected none. Writers. (1) The edge function ingest, Tier 3 entity resolution (docs/architecture/ENTITY_RESOLUTION_RULES.md): when it creates a vehicle from a listing, it scores up to 5 existing vehicles with the same year, make and model (0.50 base, more for location, mileage and price agreement) and upserts a pending REVIEW row for each one at 0.60 or more, or 0.50 or more when the identity is uncertain (an unresolved Craigslist share URL); 34,611 rows (99.5%) since 2026-07-02, 17,780 of them since the server start (2026-09-29 09:20Z), 12,804 in the last 7 days. 29,801 of them pair a new craigslist vehicle, and 27,548 (79.6%) sit at the 0.50 floor with year, make and model as the only signal. (2) SQL propose_vin_merges (same VIN on two vehicles) and propose_owner_merges (same owner photos), reached through propose_anchor_merges, which has no caller in the repo or in SQL; they ran once, on 2026-05-24 (142 MERGE rows). (3) scripts/generate-merge-proposals.mjs, the creating script: 26 LLM-reviewed VIN pairs on 2026-03-21; its --execute-approved mode merged 16 of them through merge_into_primary and marked them executed. (4) Four single rows by hand or by agents (2026-05 .. 2026-07). Nothing consumes the ingest rows: none carries an AI or human verdict, none was approved or executed, and no code reads the table besides the script; the last execution was 2026-06-24 and the last review 2026-07-08. The rules doc requires AI verification of a Tier 3 candidate before linking; none runs. The web merge screens (MergeProposalsPanel.tsx, VehicleMergeInterface.tsx, MergeProposalsDashboard.tsx and others) and get_merge_proposals_with_details use vehicle_merge_proposals, a different table. Liveness: pg_stat_user_tables counts 17,780 inserts, 0 updates and 0 deletes since the server last started (read 16:57Z); the newest row 2026-10-07 16:46Z. Foreign keys: vehicle_a_id and vehicle_b_id reference vehicles(id) with no ON DELETE action (validated), so a vehicle named in any proposal cannot be deleted outright; 2,896 proposals name a vehicle that is soft-deleted, and 31 of the ingest pairs carry two different full VINs (2026-10-07). Access: RLS is on with no policy; anon and authenticated hold SELECT, INSERT and UPDATE, read 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07) and cannot write rows through the API; no SECURITY DEFINER function open to them writes the table. pipeline_registry holds one table-level row (2026-10-07: owner ingest, do_not_write_directly true). No triggers, views, cron jobs or write receipts. Clocks: created_at is the insert time (database clock); proposed_at is the clock of the proposer (ingest sends its own, a few milliseconds earlier); reviewed_at and executed_at are set by hand or by the script.';

-- ── The pair ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.merge_proposals.id IS
'Surrogate key of the proposal, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 34,783 values (2026-10-07). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.vehicle_a_id IS
'First vehicle of the pair: a vehicles.id, uuid NOT NULL, foreign key without ON DELETE action (validated), indexed (idx_merge_proposals_vehicle_a) and the first column of the UNIQUE key. Which vehicle it is depends on the writer: for ingest the existing candidate (15,599 distinct vehicles on its 34,611 rows, 2026-10-07); for propose_vin_merges the earlier-created vehicle of the VIN; for propose_owner_merges the lower id. The pair is ordered, so the UNIQUE key does not stop the same two vehicles appearing as (b, a); the SQL proposers check both orders, ingest does not. Unit: none (uuid). Source: the proposer. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.vehicle_b_id IS
'Second vehicle of the pair: a vehicles.id, uuid NOT NULL, foreign key without ON DELETE action (validated), indexed (idx_merge_proposals_vehicle_b). For ingest the vehicle it has just created (10,586 distinct new vehicles, up to 5 proposals each; 2026-10-07); for propose_vin_merges the later-created vehicle of the VIN. preferred_primary says which of the two should survive a merge, where set. Unit: none (uuid). Source: the proposer. Grain: one proposed pair. Clock: n/a.';

-- ── Detection and decision ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.merge_proposals.detection_source IS
'Code of the process that found the pair, text NOT NULL, no CHECK. Exact (2026-10-07): ingest-entity-resolution 34,611, anchor_system_vin_match 139 (propose_vin_merges), vin 26 (scripts/generate-merge-proposals.mjs), anchor_system_owner_match 3 (propose_owner_merges), and one row each of dhash-collision-substrate-stabilization, form_fill_owner_confirmation, worth_engine_dedup_2026-05-23 and claude-fable-5-image-audit-20260610 (hand or agent rows). Unit: none (text code). Source: the proposer. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.ai_decision IS
'Verdict on the pair, text NOT NULL, CHECK MERGE, SKIP or REVIEW. Exact (2026-10-07): REVIEW 34,615, MERGE 162, SKIP 6. Only the 26 rows of scripts/generate-merge-proposals.mjs carry an AI verdict (an LLM read the evidence); ingest writes REVIEW as a constant without any AI step, the SQL proposers write MERGE by rule, and the remaining rows were set by hand or by agents. Unit: none (text code). Source: the proposer. Grain: one proposed pair. Clock: as of proposed_at.';
COMMENT ON COLUMN public.merge_proposals.ai_confidence IS
'Confidence attached to the verdict, numeric(3,2), nullable, so stored with two decimals. Filled on every row (2026-10-07). For ingest it is the rule score of the pair (0.50 .. 0.85), not an AI output, and equals confidence rounded to two decimals; propose_vin_merges writes 0.99 and propose_owner_merges 0.92; the script rows carry the LLM confidence (0.50 .. 0.95). Unit: score (0 to 1). Source: the proposer. Grain: one proposed pair. Clock: as of proposed_at.';
COMMENT ON COLUMN public.merge_proposals.ai_reasoning IS
'Why the pair was proposed, free text, nullable; filled on every row (2026-10-07). For ingest it repeats match_reason; propose_vin_merges writes a sentence that names the shared VIN; the script rows hold the LLM explanation. No text is quoted here. Unit: none (text). Source: the proposer. Grain: one proposed pair. Clock: as of proposed_at.';
COMMENT ON COLUMN public.merge_proposals.preferred_primary IS
'Which vehicle should survive a merge, text, nullable, CHECK A or B. Filled on the 172 rows not written by ingest (A 168, B 4); NULL on every ingest row (2026-10-07). scripts/generate-merge-proposals.mjs keeps the A or B vehicle as primary when it executes. Unit: none (text code). Source: the proposer. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.evidence IS
'Evidence of the pair, jsonb, nullable. Ingest writes 11 keys on each of its rows: ingest_url, ingest_year, ingest_make, ingest_model, ingest_location, ingest_price and ingest_mileage of the new listing, and candidate_id, candidate_location, candidate_mileage and candidate_price of the existing vehicle (ingest_location absent on 1,427 rows, ingest_price on 1,403, ingest_mileage on 208); the script and hand rows carry their own shapes; NULL on 141 of the 142 rows of the SQL proposers and on 1 agent row (2026-10-07). It holds public listing URLs, places and prices; none is quoted here. Unit: none (jsonb). Source: the proposer. Grain: one proposed pair. Clock: as of proposed_at.';
COMMENT ON COLUMN public.merge_proposals.match_tier IS
'Entity-resolution tier of the match (docs/architecture/ENTITY_RESOLUTION_RULES.md: 1 definitive, 2 strong, 3 circumstantial, 4 weak), integer, nullable, CHECK 1 to 4, indexed for pending rows (idx_merge_proposals_tier). Exact (2026-10-07): 3 on 34,611 (ingest, always 3 whatever the score: 2,322 of them score 0.81 or 0.85, inside the Tier 2 range of the rules doc), 1 on 141, 2 on 4, NULL on 27 (rows older than the column, and one agent row). Unit: none (tier 1 to 4). Source: the proposer. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.match_reason IS
'Signals that matched, text, nullable. For ingest the reasons joined by a semicolon, from year+make+model match, exact location match, city match, mileage within 1% or 5% and price within 5% or 10%: year+make+model match alone on 27,548 rows, all four signals on 2,064 (2026-10-07). Filled on the ingest rows and 3 others. Unit: none (text). Source: the proposer. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.confidence IS
'Rule score of the pair, numeric (unbounded scale), nullable, CHECK 0 to 1. Filled on every row but the 26 script rows and 1 agent row (2026-10-07). Ingest writes its JavaScript sum unrounded, so 84 rows carry float artifacts (such as 0.6000000000000001) and differ from ai_confidence; values 0.50 .. 0.85, 0.50 on 27,548 rows. Unit: score (0 to 1). Source: the proposer. Grain: one proposed pair. Clock: as of proposed_at.';

-- ── Verdicts and review ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.merge_proposals.status IS
'Lifecycle of the proposal, text, nullable, default pending, CHECK pending, approved, rejected or executed, indexed (idx_merge_proposals_status). Exact (2026-10-07): pending 34,762, executed 17, approved 4 (one of them carries an executed_at), rejected 0. Only scripts/generate-merge-proposals.mjs (executed, after merge_into_primary) and hand or agent updates change it; no update since 2026-09-29. Unit: none (text code). Source: the proposer, then the script or a reviewer. Grain: one proposed pair. Clock: as of reviewed_at or executed_at where set.';
COMMENT ON COLUMN public.merge_proposals.ai_verified IS
'Whether an AI check confirmed the pair, boolean, nullable, default false. true on 145 rows (2026-10-07): the 139 propose_vin_merges rows and the 3 propose_owner_merges rows, which set it true by rule, and 3 hand or agent rows; false on every ingest row, so no Tier 3 candidate has the AI verification the rules doc requires. Unit: none (boolean). Source: the proposer. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.human_verified IS
'Whether a person confirmed the pair, boolean, nullable, default false. true on 3 rows, all set by hand (2026-05 .. 2026-07); false on the other 34,780 (2026-10-07). Unit: none (boolean). Source: a reviewer. Grain: one proposed pair. Clock: as of reviewed_at.';
COMMENT ON COLUMN public.merge_proposals.proposed_by IS
'Who proposed the pair, text, nullable, default system. Exact (2026-10-07): ingest 34,611, origination_anchor_cron 142 (the SQL proposers; no such cron job exists now), system 26 (the default, filled into the script rows when the column was added on 2026-03-24), and one row each of claude_worth_engine, substrate-stabilization-agent, claude-form-fill-pipeline-2026-05-03 and a user id (not quoted). Unit: none (text). Source: the proposer or the column default. Grain: one proposed pair. Clock: n/a.';
COMMENT ON COLUMN public.merge_proposals.reviewed_by IS
'Who reviewed the proposal, free text, nullable. Filled on 3 rows (2026-10-07), each a short text naming the reviewer and the basis of the review; not quoted here (it holds a name and a VIN). Unit: none (text). Source: a reviewer. Grain: one proposed pair. Clock: as of reviewed_at.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.merge_proposals.created_at IS
'When the row was inserted, timestamptz, nullable, default now() (database clock). 2026-03-21 18:51Z .. 2026-10-07 16:46Z; by month (2026-10-07): 2026-03 26, 05 144, 06 1, 07 2,866, 08 1,934, 09 18,062, 10 11,750. Unit: timestamptz. Source: column default. Grain: one proposed pair. Clock: ingest time.';
COMMENT ON COLUMN public.merge_proposals.proposed_at IS
'When the proposer made the proposal, timestamptz, nullable, default now(). Ingest sends its own clock, which precedes created_at on 34,540 of its rows (median 17 ms, at most 43 s); the SQL proposers and hand rows take the default and equal created_at; the 26 script rows hold 2026-03-24 07:15Z, the moment 20260324100000 added the column, not their proposal time (2026-03-21). Unit: timestamptz. Source: the proposer clock or the column default. Grain: one proposed pair. Clock: derived (proposal time; wrong on the 26 oldest rows).';
COMMENT ON COLUMN public.merge_proposals.reviewed_at IS
'When the proposal was reviewed, timestamptz, nullable. Set on 3 rows by hand, the last 2026-07-08 16:19Z (2026-10-07). Unit: timestamptz. Source: a reviewer. Grain: one proposed pair. Clock: derived (review time).';
COMMENT ON COLUMN public.merge_proposals.executed_at IS
'When the merge was carried out, timestamptz, nullable. Set on 18 rows (2026-10-07): the 16 executed script rows of 2026-03-21, 1 executed agent row (2026-05-24) and 1 row still marked approved although it carries an execution time (2026-06-24 01:29Z, the last). Set by scripts/generate-merge-proposals.mjs after merge_into_primary succeeds, or by hand. Unit: timestamptz. Source: the script or a reviewer. Grain: one proposed pair. Clock: derived (merge time).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.merge_proposals'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'merge_proposals: every column has a comment';
  ELSE
    RAISE NOTICE 'merge_proposals columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
