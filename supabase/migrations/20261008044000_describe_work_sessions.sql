-- Describe work_sessions: the 36 columns without a comment, a corrected comment on intent_source (5 of 41 had one
-- before; catalog count on prod, 2026-10-07) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read table in the atlas: 1,925 rows on 2026-10-07 16:02Z by exact count (the atlas
-- estimate of 1,899 is a stale pg_class.reltuples), no write since the statistics counters began, 86,404 index scans.
-- The table holds the private garage work days of the owner: these comments give shapes and counts only.
--
-- METHOD (read 2026-10-07 16:02-16:50Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists), RLS,
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; the 6 dependent views from pg_depend
--   (reloptions and grants) and the 4 foreign keys in from pg_constraint. The row count, the fills of every column, the
--   counts by status, session_type, work_type, intent_source, account, month and metadata key, the cross-tabulation of
--   type, status and fills, the vehicle-day uniqueness, the clock orderings, the UTC and Pacific day comparison, the
--   duration, confidence and image-count ranges, the cost arithmetic and non-zero counts, the text lengths and the
--   agreement of the boundary images with vehicle_images are exact counts over the whole table (2.2 MB heap, read only).
--   What anon and authenticated can read comes from counts under SET LOCAL ROLE in read-only transactions, and one call
--   of get_vehicle_work_dates under SET LOCAL ROLE anon in a read-only transaction (counted, not printed). "Filled"
--   means non-NULL; money columns are counted as non-zero, never summed.
--   Writers and readers from code at origin/main ee5dcd084 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writer): the creating migration
--   supabase/migrations/20250831155000_create_work_sessions.sql; 20250831160000_user_activity_system.sql,
--   20260227300000_labor_estimation_fixup.sql, 20260613190000_asset_provenance_engine.sql and
--   20260621000000_work_session_day_intent_and_confirm.sql (the five existing column comments); scripts/daily-receipt
--   build-day.mjs, synthesize-day.mjs, rebuild-worth-days.sh, classify-unfiled-day.mjs and byok-image-batch.sh;
--   scripts/imessage-vehicle-sync.mjs and deep-image-analysis-byok.mjs; nuke_frontend/src/services/workSessionService.ts
--   and the profile, ledger and worth pages; apps/nuke-capture-ios; the edge functions mcp-connector (deployed version 104,
--   2026-10-02 05:16Z, a minute after the last commit to its source; tool dispatch and handleConfirmWorkSession),
--   work-session, auto-sort-photos and _shared/dossier.ts, and the deleted auto-detect-sessions (added by 90817d2c4,
--   2026-02-28; deleted by 5741560ae, 2026-03-10; read at 5741560ae^); the deployed function list read through the
--   management API (328 functions, 2026-10-07); the bodies, read with pg_get_functiondef, of the 30 live functions whose
--   body names the table (writers derive_work_sessions, backfill_work_sessions_from_photos, recompute_worth_minutes,
--   finalize_work_session and confirm_work_session; 25 readers) with their EXECUTE grants, and of the two trigger
--   functions; cron.job (no job names the table or its writers); write_receipts (no rows); pg_stat_user_tables;
--   pipeline_registry (6 column rows; none is added or changed here); the launchd job com.nuke.byok-image-analysis
--   (defined, not loaded, 2026-10-07).
-- LIMITS:
--   Which writer produced the photo_interpolated rows and which one moved 432 capture_derived rows to completed is not
--   recorded. The migrations that added status, title, work_type, the cost columns, technician_id and place_id were not
--   traced. The anonymous paths through recompute_worth_minutes and the mcp-connector tool are read from their source,
--   not exercised. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). Private data: no
--   title, narrative, part, price, rate, session date, user id or vehicle id is quoted; write clocks are given by month.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Auto-detected work sessions from photo timestamp clustering. Owned by auto-detect-sessions." The first
--   sentence stays. "Owned by auto-detect-sessions" is wrong: that edge function was deleted on 2026-03-10 and none of
--   its output is recognizable in the table; the new comment names the live writers, readers and access paths.
--   Column intent_source: it said "Provenance of intent: ai_inferred (detective guess) or owner_confirmed (owner
--   testimony, set alongside owner_confirmed_at). Owner truth supersedes the AI guess." That text stays first. Corrected:
--   neither confirmation writer sets it, so the 2 owner-confirmed rows still say ai_inferred, as every row does.
--   Columns owner_confirmed_at, owner_confirmed_by, intent and intent_confidence: unchanged.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.work_sessions IS
'Auto-detected work sessions from photo timestamp clustering: one row per vehicle and day of work, rolled up from the photos of that day (grain: vehicle x session_date; only (vehicle_id, start_time) is unique, but the 1,925 rows hold 1,925 distinct vehicle-days). 1,925 rows on 2026-10-07 (the atlas estimate of 1,899 is a stale reltuples) for 112 vehicles and 2 accounts (1,914 rows on 111 vehicles belong to one), created 2026-02 .. 2026-07 (1,593 in 2026-06) and last updated in 2026-08; pg_stat_user_tables counts 0 inserts, updates and deletes but 209 sequential and 86,404 index scans since the server last started (2026-09-29 09:20Z; read 16:02Z), so the readers are live. Writers: derive_work_sessions(uuid) (SECURITY DEFINER, not executable by anon or authenticated; called by scripts/daily-receipt/byok-image-batch.sh) inserts capture_derived rows with status derived; scripts/daily-receipt/build-day.mjs inserts or rebuilds a day (status completed, title, work type, narrative, costs, boundary images, metadata.synthesis; rebuild-worth-days.sh reran it over every stored day) and synthesize-day.mjs rewrites title, work type and narrative in place; backfill_work_sessions_from_photos(uuid, uuid) (not executable by anon or authenticated) inserts baseline_backfill rows with status auto_inferred; recompute_worth_minutes(uuid) rewrites minutes and labor cost of the unconfirmed days of a vehicle; finalize_work_session(uuid) closes a day (1 finalized row) and confirm_work_session(uuid, boolean) records the owner confirmation (2 rows carry one). The edge function auto-detect-sessions that the former comment and pipeline_registry name as owner was deleted by commit 5741560ae on 2026-03-10; zones_touched, stages_observed and stage_transitions, which only it wrote, are empty on every row. Writers in code that have landed no row: nuke_frontend/src/services/workSessionService.ts (session types manual, continuous and break_detected), scripts/imessage-vehicle-sync.mjs (imessage_sync), the edge function work-session (its insert names columns the table lacks) and the mcp-connector tool confirm_work_session (statuses confirmed and rejected). The launchd job com.nuke.byok-image-analysis that ran the BYOK batch is defined on the laptop but not loaded, and no cron job names the table. Readers: the vehicle profile (VehicleProfileContext.tsx, loadVehicleData.ts, BarcodeTimeline.tsx, WorthEngineCard.tsx, useWorthEngine.ts), the user ledger and workspace pages, the intake screen, the iOS capture app, mcp-connector, supabase/functions/_shared/dossier.ts, six security_invoker views (technician_career_stats, technician_specializations, technician_tool_proficiency, technician_vehicle_expertise, vehicle_labor_provenance, work_session_timeline_events) and 25 SQL functions. Access: RLS is on with ten policies, all keyed on the caller: SELECT of own rows, of rows on vehicles the caller owns (vehicles.owner_id or user_id) and of rows on vehicles where the caller holds an active vehicle_user_permissions role (owner, co_owner, mechanic, appraiser, moderator, contributor, photographer, dealer_rep or sales_agent); INSERT, UPDATE and DELETE of own rows. anon, and authenticated without such a tie, read 0 rows (counted under SET LOCAL ROLE, 2026-10-07). The INSERT policies check only user_id, so any signed-in account can add a session to any vehicle. Paths around RLS: recompute_worth_minutes(uuid) (SECURITY DEFINER, EXECUTE granted to anon and authenticated) lets any caller rewrite duration_minutes, total_labor_cost, total_job_cost and metadata of the unconfirmed sessions of any vehicle; get_vehicle_work_dates, get_daily_work_receipt and intake_live_state (SECURITY DEFINER, EXECUTE granted to anon, no owner check) return narratives, titles, minutes and costs of sessions of any vehicle (counted: anon received 124 sessions with 116 narratives of one vehicle through get_vehicle_work_dates, 2026-10-07); by its source the mcp-connector tool confirm_work_session needs no authentication and updates any session through the service role. Two triggers: update_work_sessions_updated_at (BEFORE UPDATE) and work_session_to_timeline (AFTER INSERT OR UPDATE; adds a maintenance timeline_events row when status turns finalized). No write receipts. pipeline_registry holds 6 column rows (id owned by auto-detect-sessions, stale; owner_confirmed_at and owner_confirmed_by by owner-confirmation; intent, intent_confidence and intent_source by work-session-rollup). Duplicate indexes: idx_work_sessions_user and idx_work_sessions_user_id, idx_work_sessions_vehicle and idx_work_sessions_vehicle_id. Clocks: session_date is the UTC day of start_time (not the Pacific work day on 861 rows); start_time and end_time are photo capture times; created_at is the insert time and updated_at the last update (trigger). The rows describe the private work of the owner: comments give shapes and counts only, no title, narrative, part, price, rate or session date.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.id IS
'Surrogate key of the session, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 1,925 values (2026-10-07). Referenced by labor_estimates.work_session_id and vehicle_images.work_session_id (no ON DELETE action) and by tool_usage and work_session_parts (ON DELETE CASCADE). Unit: none (uuid). Source: column default. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.user_id IS
'Account the session belongs to: an auth.users id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed twice (idx_work_sessions_user and idx_work_sessions_user_id are duplicates) and first in idx_work_sessions_user_session_date; every policy keys on it. 2 accounts (2026-10-07): one with 1,914 rows on 111 vehicles, one with 11 rows on 3 vehicles; no id is quoted. Unit: none (uuid). Source: the writer (the account of the run). Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.vehicle_id IS
'Vehicle worked on: a vehicles.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed twice (idx_work_sessions_vehicle and idx_work_sessions_vehicle_id are duplicates) and first in the unique index idx_work_sessions_vehicle_start_time and in idx_work_sessions_unconfirmed. 112 vehicles, all existing (2026-10-07). Every row is a distinct vehicle and session_date (1,925 pairs) by the practice of the writers, which look a day up by vehicle and date, not by a constraint. The INSERT policies check only user_id, so a signed-in account can add a session to any vehicle. Unit: none (uuid). Source: the writer. Grain: one vehicle-day. Clock: n/a.';

-- ── Day and clocks of the work ─────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.session_date IS
'Day of the session, date NOT NULL, indexed (idx_work_sessions_date, and with user_id in idx_work_sessions_user_session_date). It is the UTC calendar date of start_time on every row (2026-10-07); on 861 rows (44.7%) that differs from the Pacific calendar date of start_time, so a session day is a UTC day, not the local work day. No date is quoted. Unit: date (UTC day). Source: the writer, from photo capture times. Grain: one vehicle-day. Clock: event day (UTC).';
COMMENT ON COLUMN public.work_sessions.start_time IS
'Time of the first photo of the session, timestamptz NOT NULL; with vehicle_id the unique index idx_work_sessions_vehicle_start_time. Never after end_time, and equal to it on 522 rows (2026-10-07). No value is quoted. Unit: timestamptz. Source: the writer, from vehicle_images.taken_at of the day. Grain: one vehicle-day. Clock: event time (first photo).';
COMMENT ON COLUMN public.work_sessions.end_time IS
'Time of the last photo of the session, timestamptz NOT NULL, never before start_time (2026-10-07). No value is quoted. Unit: timestamptz. Source: the writer, from vehicle_images.taken_at of the day. Grain: one vehicle-day. Clock: event time (last photo).';
COMMENT ON COLUMN public.work_sessions.duration_minutes IS
'Labor minutes credited to the day, integer NOT NULL; not the span between start_time and end_time (it exceeds the span on 75 rows). 0 on 1,506 rows (78.2%), up to 1,374, median 0 (2026-10-07). recompute_worth_minutes rewrites it for the unconfirmed sessions of a vehicle from the photos whose BYOK verdict says labor with intent confidence 0.6 or more: bursts split at 45-minute gaps, each counted as the larger of its span and 5 minutes per photo, plus 10, capped at 480 a day; metadata.labor_minutes_recomputed_at marks the 949 rows it touched. build-day.mjs and backfill_work_sessions_from_photos compute their own minutes. Unit: minutes. Source: the writers, from photo times. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.confidence_score IS
'Confidence of the session inference, numeric(3,2) NOT NULL, default 0.0. 0.60 on the 169 baseline_backfill rows (a constant of backfill_work_sessions_from_photos), 0.50 .. 0.95 on the 26 photo_interpolated rows, 0 on the other 1,730 (2026-10-07). Unit: probability (0 to 1). Source: the writer. Grain: one vehicle-day. Clock: as of created_at.';
COMMENT ON COLUMN public.work_sessions.image_count IS
'Photos rolled into the session, integer NOT NULL, default 0. 25,686 in all, median 4, up to 756, 0 on 2 rows (2026-10-07). get_user_capture_stats sums it as the analyzed photo count of a user. Unit: count of photos. Source: the writer. Grain: one vehicle-day. Clock: as of updated_at.';

-- ── Narrative ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.title IS
'Short title of the day, text, nullable. Filled on 1,355 rows (70.4%), median 77 characters (2026-10-07); written by build-day.mjs and synthesize-day.mjs from the day synthesis and as a constant by backfill_work_sessions_from_photos; NULL on the 570 derived rows. Becomes the timeline event title on finalization; intake_live_state returns it to anon for sessions created that day. Private: none is quoted. Unit: none (text). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.work_description IS
'Narrative of the day, text, nullable. Filled on 1,255 rows (65.2%), median 970 characters (2026-10-07); written by build-day.mjs and synthesize-day.mjs from the BYOK frame narratives, each run overwriting the previous text. get_vehicle_work_dates, get_daily_work_receipt and intake_live_state return it to anon without an owner check. Private: none is quoted. Unit: none (text). Source: the day synthesis scripts. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.work_type IS
'Kind of work of the day, text, nullable, no CHECK. Filled on 1,355 rows (2026-10-07): documentation 715, mixed 184, general 171, inspection 136, labor 66, parts_sourcing 36, acquisition 33, unknown 3, communication 2, teardown 2, wiring 2 and 5 values used once (parts_received, paint_prep, insulation, restoration, ac_retrofit); NULL on the 570 derived rows. Most values come from the BYOK intent vocabulary through the day synthesis; general is the build-day.mjs and backfill default. Unit: none (text code). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.metadata IS
'Writer context, jsonb, nullable. A non-empty object on 1,373 rows (2026-10-07). Keys: synthesis 949 (the day picture of build-day.mjs and synthesize-day.mjs), labor_minutes_recomputed_at 949 (recompute_worth_minutes; both keys on 655), burst_gap_minutes, derived_from and backfilled_at 169 (backfill_work_sessions_from_photos), created_by and sources 26 (the photo_interpolated rows), stale_zero_reason and stale_zeroed_at 23, corrected_at, corrected_by and reason 11, billable, ownership and sweat_equity 8, capped_at_480_pending_analysis 4, original_total_labor_cost 3. No row carries owner_confirmation, the key the mcp-connector tool would add. Unit: none (jsonb). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';

-- ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.status IS
'Lifecycle state of the session, text, nullable, default in_progress, no CHECK. 4 values (2026-10-07): completed 1,254 (build-day.mjs; 432 of them began as derive_work_sessions rows), derived 570 (derive_work_sessions, not yet synthesized), auto_inferred 100 (backfill_work_sessions_from_photos) and finalized 1 (finalize_work_session); the default in_progress never remains, so auto-sort-photos, which looks for an in_progress session of the day, never finds one. Values written by code that never occur: confirmed and rejected (the mcp-connector tool confirm_work_session) and asking (the edge function work-session). work_session_to_timeline adds a timeline event when it turns finalized; UserWorkLedger.tsx counts derived and auto_inferred as unconfirmed. Unit: none (text code). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.session_type IS
'How the session was produced, text, nullable, default auto_detected, no CHECK. 4 values (2026-10-07): capture_derived 1,006 (derive_work_sessions), auto_detected 724 (the default; build-day.mjs does not set it; 1 row from 2026-02), baseline_backfill 169 (backfill_work_sessions_from_photos) and photo_interpolated 26 (created in 2026-03; the writer is not in the repo). The values of workSessionService.ts (manual, continuous, break_detected) and imessage-vehicle-sync.mjs (imessage_sync) never occur. VehicleProfileContext.tsx hides imessage_sync and baseline_backfill rows. Unit: none (text code). Source: the writer or the column default. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.finalized_at IS
'When the session was closed, timestamptz, nullable. Filled on 1 row (2026-10-07), by finalize_work_session; the mcp-connector tool confirm_work_session would set it too. Unit: timestamptz. Source: the closing writer clock. Grain: one vehicle-day. Clock: recording (finalization).';

-- ── Money (counted, never quoted) ──────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.total_parts_cost IS
'Parts spend of the day, numeric(10,2), nullable, default 0. Non-zero on 3 rows (2026-10-07); no amount is quoted. finalize_work_session sums work_session_parts into it; build-day.mjs sets it. Unit: currency amount (currency not recorded). Source: the writers, from receipts and work_session_parts. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.total_tool_depreciation IS
'Tool depreciation charged to the day, numeric(10,2), nullable, default 0. Non-zero on 1 row (2026-10-07), set by finalize_work_session from tool_usage; no amount is quoted. Unit: currency amount (currency not recorded). Source: finalize_work_session. Grain: one vehicle-day. Clock: as of finalized_at.';
COMMENT ON COLUMN public.work_sessions.labor_rate_per_hour IS
'Hourly labor rate, numeric(10,2), nullable. Filled on 170 rows (2026-10-07): a constant of backfill_work_sessions_from_photos on its 169 rows, and 1 other; finalize_work_session prices labor with it, but recompute_worth_minutes uses a fixed rate in its own body instead. No rate is quoted. Unit: currency per hour (currency not recorded). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.total_labor_cost IS
'Labor value of the day, numeric(10,2), nullable, default 0. Non-zero on 71 rows (2026-10-07); no amount is quoted. recompute_worth_minutes sets it to duration_minutes / 60 times its fixed rate for unconfirmed sessions; finalize_work_session and build-day.mjs compute their own; the mcp-connector tool confirm_work_session overwrites it on amend. Unit: currency amount (currency not recorded). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.total_job_cost IS
'Total cost of the day: labor + parts + tool depreciation on all rows but 2, numeric(10,2), nullable, default 0. Non-zero on 71 rows (2026-10-07); no amount is quoted. The owner-confirmed value gate: build-day.mjs keeps it on owner-confirmed rows and recompute_worth_minutes skips them. Read by the investment and worth readers, by get_daily_work_receipt (open to anon) and by four of the dependent views. Unit: currency amount (currency not recorded). Source: the writers. Grain: one vehicle-day. Clock: as of updated_at.';
COMMENT ON COLUMN public.work_sessions.quoted_price IS
'Intended price quoted to a customer, numeric(10,2), nullable. NULL on all 1,925 rows (2026-10-07); no writer sets it. Unit: currency amount. Source: none (never written). Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.final_invoice IS
'Intended invoiced amount, numeric(10,2), nullable. NULL on all 1,925 rows (2026-10-07); finalize_work_session reads it for profit_margin, nothing writes it. Unit: currency amount. Source: none (never written). Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.profit_margin IS
'Intended margin of final_invoice over total_job_cost, percent, numeric(5,2), nullable. NULL on all 1,925 rows (2026-10-07): finalize_work_session computes it only when final_invoice is set, and it never is. Unit: percent. Source: finalize_work_session (never produced). Grain: one vehicle-day. Clock: n/a.';

-- ── People, places and links ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.technician_id IS
'Technician who did the work: a technician_phone_links.id, uuid, nullable, foreign key without ON DELETE action (validated). Filled on 1 row (2026-10-07). The four technician views read it. Unit: none (uuid). Source: a writer not identified in the repo. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.technician_phone_link_id IS
'Intended technician phone link of the session (added by 20260227300000_labor_estimation_fixup.sql), uuid, nullable, no foreign key. NULL on all 1,925 rows (2026-10-07). Unit: none (uuid). Source: none (never written). Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.place_id IS
'Intended place where the work happened: a known_places.id, uuid, nullable, foreign key without ON DELETE action (validated). NULL on all 1,925 rows (2026-10-07). Unit: none (uuid). Source: none (never written). Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.user_activity_id IS
'Intended link to user_activities (added by 20250831160000_user_activity_system.sql with a foreign key ON DELETE SET NULL, which prod lacks), uuid, nullable, indexed (idx_work_sessions_activity). NULL on all 1,925 rows (2026-10-07). Unit: none (uuid). Source: none (never written). Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.start_image_id IS
'First photo of the session: a vehicle_images.id, uuid, nullable, no foreign key (added by 20260227300000_labor_estimation_fixup.sql). Filled on 683 rows, all existing (2026-10-07): 588 auto_detected rows of build-day.mjs and 95 of other types; 26 of those images now belong to another vehicle. Unit: none (uuid). Source: the writer. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.end_image_id IS
'Last photo of the session: a vehicle_images.id, uuid, nullable, no foreign key (added by 20260227300000_labor_estimation_fixup.sql). Filled on the same 683 rows as start_image_id, all existing (2026-10-07). Unit: none (uuid). Source: the writer. Grain: one vehicle-day. Clock: n/a.';

-- ── Stage tracking of the deleted detector (never filled) ──────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.zones_touched IS
'Vehicle zones the photos of the session showed, text[], nullable, default {}. Empty on all 1,925 rows (2026-10-07); only the deleted edge function auto-detect-sessions wrote it. Unit: none (text array). Source: column default. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.stages_observed IS
'Build stages the photos of the session showed, text[], nullable, default {}. Empty on all 1,925 rows (2026-10-07); only the deleted auto-detect-sessions wrote it. Unit: none (text array). Source: column default. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.stage_transitions IS
'Stage changes detected within the session, jsonb, nullable, default []. [] on all 1,925 rows (2026-10-07); only the deleted auto-detect-sessions wrote it. Unit: none (jsonb array). Source: column default. Grain: one vehicle-day. Clock: n/a.';
COMMENT ON COLUMN public.work_sessions.evidence IS
'Intended evidence of the session, jsonb, nullable, default {}. {} on all 1,925 rows (2026-10-07); no writer sets it. Unit: none (jsonb). Source: column default. Grain: one vehicle-day. Clock: n/a.';

-- ── Write clocks ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.work_sessions.created_at IS
'When the row was inserted: default now(), or now() of the writing function, timestamptz, nullable. By month (2026-10-07): 2026-02 1, 2026-03 26, 2026-05 211, 2026-06 1,593, 2026-07 94; none since. Unit: timestamptz. Source: column default or writer clock. Grain: one vehicle-day. Clock: ingest time.';
COMMENT ON COLUMN public.work_sessions.updated_at IS
'Time of the last change: the BEFORE UPDATE trigger update_work_sessions_updated_at sets now() on every update, timestamptz, nullable, default now(). By month (2026-10-07): 2026-02 1, 2026-04 1, 2026-05 107, 2026-06 880, 2026-07 935, 2026-08 1; none since. Unit: timestamptz. Source: the trigger. Grain: one vehicle-day. Clock: recording (last update).';

-- ── Day intent (existing comments on owner_confirmed_at, owner_confirmed_by, intent, intent_confidence kept) ───

COMMENT ON COLUMN public.work_sessions.intent_source IS
'Provenance of intent: ai_inferred (detective guess) or owner_confirmed (owner testimony, set alongside owner_confirmed_at). Owner truth supersedes the AI guess. (Text of 20260621000000_work_session_day_intent_and_confirm.sql.) text NOT NULL, default ai_inferred, CHECK in (ai_inferred, owner_confirmed). ai_inferred on all 1,925 rows (2026-10-07), the 2 owner-confirmed rows included: neither confirm_work_session(uuid, boolean) nor the mcp-connector tool confirm_work_session sets it, and intent is NULL on every row, so the value has never varied. Unit: none (text code). Source: column default. Grain: one vehicle-day. Clock: n/a.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.work_sessions'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'work_sessions: every column has a comment';
  ELSE
    RAISE NOTICE 'work_sessions columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
