-- Describe vehicle_status_metadata: all 23 columns, none had a COMMENT ON COLUMN (0 of 23 described before, catalog count
-- on prod, 2026-10-07) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table: 1,112,544 rows on 2026-10-07 10:33Z by exact count (the atlas estimate of
-- 1,114,369 is a stale pg_class.reltuples).
--
-- METHOD (read 2026-10-07 10:25-10:45Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon) and existing
--   comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, information_schema and
--   pg_description. Fill, constant values, score distribution and date windows are exact counts over the whole table (477 MB
--   heap, read only, one scan per query). Orphan rows and vehicles without a row come from anti-joins against vehicles over
--   the whole table. The comparison of the stored score and of the clocks with the live vehicle row comes from a 1% block
--   sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 8,536 rows joined to vehicles; the score is recomputed with the
--   20-field expression of calculate_vehicle_data_completeness, read only). "Filled" means non-NULL.
--   Writers and readers from code at origin/main c3ba67f92 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps; also a whole-repo search for the table name): the creating migration
--   20250921000005_intelligent_annotation_system.sql; the bodies of the two live functions that name the table, read with
--   pg_get_functiondef (calculate_vehicle_data_completeness(uuid) and trigger_update_vehicle_status(), both SECURITY
--   DEFINER and the only functions in any non-system schema whose body names the table); the trigger
--   update_vehicle_status_trigger on vehicles that calls the second; the 0 cron.job commands, 0 views or rules and 0 policies
--   of other tables that name it; write_receipts (no rows: the table carries no receipt trigger); pg_stat_user_tables; and
--   pipeline_registry (1 table-level row, owned_by trigger_update_vehicle_status, written by
--   20261007002507_declare_table_owners_1.sql; no row is added or changed here). Reader code: nuke_frontend/src/services/
--   vehicleDiscoveryService.ts and its type nuke_frontend/src/types/vehicleDiscovery.ts, scripts/database-deep-audit.ts, and
--   the deletes in scripts/cleanup-non-vehicles.ts and scripts/deep-data-cleanup.ts.
-- LIMITS:
--   Rows are overwritten, so the table keeps the last write only: when a score last changed is not recorded. The cause of
--   the orphan rows is not in the repo: the foreign key is validated and its triggers are enabled today, the delete that
--   skipped the cascade is undated (the orphans were last written 2025-12 .. 2026-03), no deletion log table exists, and no
--   script found deletes vehicles with triggers off. Counts of writes come from pg_stat_user_tables, whose reset date is not
--   recorded. The 1% block sample can miss rare cases. The table holds no personal data; quoted values are categorical codes,
--   column names, function names and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Tracks vehicle data completeness, verification levels, and engagement metrics". Verification
--   levels and engagement metrics are never written: 18 of the 23 columns hold their column default on every row. It now says
--   what is live, what is not, the writer, the readers, the access and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_status_metadata IS
'Per-vehicle derived state: one row per vehicle (grain: one vehicle; PRIMARY KEY vehicle_id), upserted in place, so it keeps the latest values only and no history. 1,112,544 rows on 2026-10-07 (the atlas estimate of 1,114,369 is a stale reltuples): 998,321 join to a vehicle and 114,223 (10.3%) are orphans whose vehicle no longer exists, although the foreign key to vehicles (ON DELETE CASCADE) is validated and its triggers are enabled; the orphans were created 2025-11 .. 2026-03 and last written 2025-12 .. 2026-03 (113,582 of them in 2026-03), and the delete that skipped the cascade is unexplained in the repo. 11,056 vehicles (1.1%; created 2026-02-01 .. 2026-03-29, last updated 2026-03-21 .. 2026-05-01) have no row; the next insert or update of the vehicle creates it. Only 5 of the 23 columns carry information: vehicle_id, data_completeness_score, last_activity_at, created_at and updated_at. The other 18 hold their column default on every row (2026-10-07): status, missing_fields and verification_level are NULL, the ten counters are 0 and the five needs_* flags are false, because nothing writes them; the creating migration 20250921000005 planned verification and engagement tracking that was never built, so the former comment overstated the table. Both live columns are derived from the vehicle row itself: the score is recomputed from 20 vehicles columns and last_activity_at is the time of the last write to the vehicle. The only writer is the trigger update_vehicle_status_trigger on vehicles (AFTER INSERT OR UPDATE, FOR EACH ROW, not scoped to columns, so any update of any column fires it; pipeline_registry owner trigger_update_vehicle_status, do_not_write_directly true): its function trigger_update_vehicle_status() calls calculate_vehicle_data_completeness(vehicle_id), which upserts the score, and then upserts last_activity_at, so each vehicle write is two upserts here. Since the statistics counters began (read 2026-10-07 10:38Z): 18,356 inserts, 813,626 updates (783,243 of them HOT, 96.3%; the primary key is the only index, the three secondary indexes of the creating migration are absent on prod) and 0 deletes; writes were still arriving (latest 10:32Z at the 10:33Z scan). Readers: none live. The only reader code is VehicleDiscoveryService (nuke_frontend/src/services/vehicleDiscoveryService.ts), which nothing imports; it selects two columns the table does not have (needs_verification, owner_seeking_info), reads a table that does not exist on prod (vehicle_contribution_requests), calls an rpc that no function on prod defines (update_vehicle_status_metadata) and filters activity_heat_score above 60, which no row reaches. No view, rule, policy, function body, cron.job command or edge function reads the table; idx_scan was 832,029 against 831,904 inserts plus updates and seq_scan was 0 at 10:30Z, before this work scanned the table, so the index use is the upserts own conflict probes. A drop-list candidate: 536 MB for five live columns that nothing reads and that are derived from the vehicle row (the score exactly, last_activity_at to within 5 seconds of vehicles.updated_at on 96.5% of a sample); recorded as a fact, not decided here. Access: RLS is on, but the policies allow_status_metadata_all_ops (ALL, USING true, WITH CHECK true), allow_status_metadata_insert (INSERT, WITH CHECK true) and Public read access to vehicle status (SELECT, USING true) apply to every role, and anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE (has_table_privilege, 2026-10-07), so anyone with the public API key can read, insert, overwrite or delete any row through the REST API; the two allow_ policies are in no repo migration (the creating migration let only vehicle owners and permitted users write). Clocks: last_activity_at and updated_at = the transaction clock of the last write to the vehicle row (equal on every row); created_at = when the status row was first inserted.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.vehicle_id IS
'Vehicle the row describes: a vehicles.id, NOT NULL, the PRIMARY KEY and a foreign key to vehicles(id) ON DELETE CASCADE (validated, its triggers enabled). 1,112,544 distinct values (2026-10-07); 998,321 match a vehicles row and 114,223 (10.3%) do not (orphans, see the table comment); 11,056 vehicles have no row. Copied by the trigger function from NEW.id (calculate_vehicle_data_completeness takes it as p_vehicle_id); nothing chooses it by hand. Unit: none (uuid). Grain: one vehicle. Clock: n/a.';

-- ── Status and verification (never written) ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.status IS
'Intended discovery label of the vehicle, CHECK in (needs_data, active_work, for_sale, verified_profile, open_contributions, professional_serviced), nullable, no default. NULL on all 1,112,544 rows (100%, 2026-10-07): no function body on prod and no code in the repo writes it. Not vehicles.status, which is a separate column on vehicles. VehicleDiscoveryService selects it, and nothing imports that service. Unit: none (text). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.verification_level IS
'Intended verification state of the vehicle record, CHECK in (none, ai_only, human_verified, professional_verified), nullable, no default. NULL on all 1,112,544 rows (100%, 2026-10-07): no writer sets it, so the table says nothing about whether a record was verified. Unit: none (text). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.professional_verifications_count IS
'Intended count of professional verifications of the vehicle, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no writer maintains it. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.contributor_count IS
'Intended count of people who contributed to the vehicle record, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no writer maintains it. VehicleDiscoveryService selects it for its trending list. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Completeness (live) ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.data_completeness_score IS
'Share of 20 vehicle fields that are filled, as a whole percent: filled fields x 100 / 20 with integer division, so only multiples of 5 occur (21 values, 0 .. 100); CHECK between 0 and 100, nullable, default 0, NULL on 0 rows. The 20 fields of the vehicles row, each counted when non-NULL (and non-empty for text): make, model, year, vin, color, mileage, fuel_type, transmission, engine_size, horsepower, torque, drivetrain, body_style, doors, seats, weight_lbs, mpg_city, mpg_highway, msrp, current_value. It counts presence only, not whether a value is right, sourced or verified, and it ignores images, history and provenance. Written by calculate_vehicle_data_completeness(vehicle_id), which trigger_update_vehicle_status() calls on every insert or update of the vehicle, so it is rewritten on every vehicle write even when no counted field changed. Distribution (exact, 2026-10-07): 0 on 17,958 rows (1.6%), 15 on 232,712 (20.9%, the mode), 20 on 169,810, mean 33.0, median 30, 80 or more on 40,175 (3.6%), 100 on 1,020 (0.09%). A 1% block sample (8,536 rows joined to vehicles) recomputed from the current vehicle gives the stored value on 8,532 rows (99.95%; 2 lower, 2 higher), so it tracks the vehicle. Read by VehicleDiscoveryService (order by, unused). Unit: percent of fields filled (whole number, steps of 5). Source: calculate_vehicle_data_completeness. Grain: one vehicle. Clock: as of updated_at.';
COMMENT ON COLUMN public.vehicle_status_metadata.missing_fields IS
'Intended list of vehicle field names that still need data (creating comment: array of field names that need data), text array, nullable, no default. NULL on all 1,112,544 rows (100%, 2026-10-07): no writer sets it; calculate_vehicle_data_completeness counts the filled fields but does not record which ones are empty. Unit: none (text array). Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Activity (last_activity_at live; the counters never written) ────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.last_activity_at IS
'When the vehicle row in vehicles was last inserted or updated, as stamped by trigger_update_vehicle_status() with the transaction clock (NOW()). The trigger fires on any update of any column of the vehicle, so every backfill and automatic recompute moves it: it is not a measure of owner, user or market activity (scripts/backfill-existence-tier.sh documents that a column-unrelated update of vehicles bumps it on every row). Filled on all 1,112,544 rows (NULL on 0, 2026-10-07) and equal to updated_at on every row. Range 2025-12-02 .. 2026-10-07 10:32Z (at the 10:33Z scan); by month of the last write: 2025-12 131, 2026-01 1, 2026-02 582, 2026-03 320,096, 2026-04 166,792, 2026-05 24,097, 2026-06 73,277, 2026-07 313,820, 2026-08 6,752, 2026-09 91,905, 2026-10 (7 days) 115,091. Many rows share one instant because one transaction updated many vehicles: 15,102 rows at 2026-04-13 05:27:57Z and 11,898 at 2026-03-23 20:39:06Z. In a 1% block sample (8,536 rows) it lies within 5 seconds of vehicles.updated_at on 8,234 rows (96.5%); vehicles.updated_at is newer on 112 and older on 190. The 114,223 orphan rows keep the time of the vehicle last write before it was deleted. Unit: timestamptz. Source: trigger_update_vehicle_status. Grain: one vehicle. Clock: ingest time of our last write to the vehicle row (not an event time of the vehicle).';
COMMENT ON COLUMN public.vehicle_status_metadata.activity_heat_score IS
'Intended score of recent activity on the vehicle, 0 .. 100 (creating comment), integer, nullable, default 0, no CHECK. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no writer computes it, so VehicleDiscoveryService.getTrendingVehicles, which asks for values above 60, can return nothing. vehicles carries a separate heat_score column. Unit: score, 0 .. 100 (integer). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.timeline_event_count IS
'Intended count of timeline events of the vehicle, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); nothing maintains it. The events are rows of timeline_events keyed by vehicle_id. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.photos_count IS
'Intended count of photos of the vehicle, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); nothing maintains it. The images are rows of vehicle_images keyed by vehicle_id, and vehicles carries its own image_count column. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Engagement (never written) ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.views_this_week IS
'Intended page views of the vehicle in the last 7 days, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no job rolls views up. Views are logged one row per view in vehicle_views (VehicleProfileContext.tsx inserts them), and the service method that would refresh this table after logging a view calls an rpc that does not exist on prod. vehicles carries view_count. Unit: views. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.views_this_month IS
'Intended page views of the vehicle in the last 30 days, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no job rolls views up (see views_this_week). Unit: views. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.views_total IS
'Intended all-time page views of the vehicle, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no job rolls views up (see views_this_week). Unit: views. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.active_discussions_count IS
'Intended count of open discussions on the vehicle, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no writer maintains it. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.pending_questions_count IS
'Intended count of unanswered questions on the vehicle, integer, nullable, default 0. 0 on all 1,112,544 rows (non-NULL, 2026-10-07); no writer maintains it. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Contribution opportunities (never written) ──────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.needs_photos IS
'Intended flag that the vehicle is open for contributed photos (creating comment: contribution opportunities), boolean, nullable, default false. false on all 1,112,544 rows (non-NULL, 2026-10-07); no writer sets it, so no vehicle is ever flagged. VehicleDiscoveryService.getVehiclesNeedingContributions filters on it, but the same query also selects needs_verification and owner_seeking_info, which the table does not have, so that query fails. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.needs_specifications IS
'Intended flag that the vehicle is open for contributed specifications, boolean, nullable, default false. false on all 1,112,544 rows (non-NULL, 2026-10-07); no writer sets it. Same unused reader as needs_photos. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.needs_history IS
'Intended flag that the vehicle is open for contributed history, boolean, nullable, default false. false on all 1,112,544 rows (non-NULL, 2026-10-07); no writer sets it. Same unused reader as needs_photos. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.needs_maintenance_records IS
'Intended flag that the vehicle is open for contributed maintenance records, boolean, nullable, default false. false on all 1,112,544 rows (non-NULL, 2026-10-07); no writer sets it and no code reads it. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_status_metadata.needs_professional_inspection IS
'Intended flag that the vehicle is open for a professional inspection, boolean, nullable, default false. false on all 1,112,544 rows (non-NULL, 2026-10-07); no writer sets it and no code reads it. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_status_metadata.created_at IS
'When the status row was first inserted: default now(), the transaction clock of the first trigger run for the vehicle, never changed afterwards (both upserts update only the score, last_activity_at and updated_at). Filled on every row (2026-10-07). Range 2025-11-10 .. 2026-10-07; by month: 2025-11 116, 2025-12 8,621, 2026-01 193,998, 2026-02 517,434, 2026-03 113,187, 2026-04 88,726, 2026-05 36,988, 2026-06 9,183, 2026-07 77,016, 2026-08 2,503, 2026-09 58,147, 2026-10 (7 days) 6,625. Many rows share one instant because the clock is the transaction clock: 155,990 rows (14.0%) were created in one transaction at 2026-02-06 17:13:14Z and 55,567 at 17:08:21Z (613,410 distinct values in all). It equals the vehicle created_at within 5 seconds on 4,532 of 8,536 sampled rows (53.1%) and is later on the other 4,004, never earlier, so for those it is the time of a later write to the vehicle (the trigger creates the row on the first insert or update it sees), not the time the vehicle was added. Unit: timestamptz. Source: column default. Grain: one vehicle. Clock: ingest time of the first write.';
COMMENT ON COLUMN public.vehicle_status_metadata.updated_at IS
'When the row was last written: now() set by calculate_vehicle_data_completeness (score upsert) and again by trigger_update_vehicle_status (activity upsert) in the same transaction, so both write the same instant. No update trigger exists on this table; nothing else sets it. Filled on every row (2026-10-07), equal to last_activity_at on all 1,112,544 rows and to created_at on 4,780 (0.4%). Range 2025-12-02 .. 2026-10-07 10:32Z, 392,859 distinct values (see last_activity_at for the months and the shared instants). Unit: timestamptz. Source: the two upserts. Grain: one vehicle. Clock: ingest time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_status_metadata'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_status_metadata: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_status_metadata columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
