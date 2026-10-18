-- Describe vehicle_quality_scores: all 20 columns, none had a COMMENT ON COLUMN (0 of 20 described before, catalog count on
-- prod, 2026-10-07), and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 625,154 rows on 2026-10-07 13:06Z by exact count (the
-- atlas estimate of 624,342 is a stale pg_class.reltuples); the newest row is from 2026-10-07 05:42Z.
--
-- METHOD (read 2026-10-07 13:05-13:40Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy
--   and pg_description; the two views that read the table from pg_depend. Row count, minimum and maximum of every column,
--   flag and fill counts, score bands and the creation instants of each write batch are exact counts over the whole table
--   (89 MB heap, read only). Value shapes (the score distribution per batch), the orphan rows, the comparison of the
--   stored flags with the live vehicle row and the share of vehicles that carry a row come from 1% block samples
--   (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007): 5,137 rows of this table joined to vehicles; 9,814 rows of vehicles),
--   because the table holds more than 200,000 rows and the exact anti-join exceeded the 10 s timeout. "Filled" means
--   non-NULL.
--   Writers and readers from code at origin/main a483cd919 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history): the creating migration
--   20251110000001_automated_quality_validation.sql; 20251229000001_tier_system_missing_infrastructure.sql;
--   20260206_analytics_cron_jobs.sql (the weekly cron job); the source of the edge function backfill-quality-scores as it
--   stood before commit 200581de7 removed it (2026-03-31); the deployed function metadata from the management API (version,
--   verify_jwt, deploy time); the edge and function logs of 2026-09-30 20:20-20:30Z and 2026-10-07 05:35-05:45Z (who
--   called it); the bodies, read with pg_get_functiondef, of the four live functions whose body names the table
--   (auto_queue_backfills, calculate_verification_layer, queue_vehicle_for_backfill read it; backfill_vehicle_quality_scores
--   only shares the name and writes vehicles.data_quality_score) and of calculate_vehicle_quality_score(vehicles), whose
--   result the edge function stores; the prod migration log supabase_migrations.schema_migrations (6 logged versions name
--   the table; 20260314031411 rls_lockdown_internal_tables is not in the repo); cron.job (jobid 135, inactive);
--   pg_depend (the views repair_queue and vehicles_needing_micro_scrape); write_receipts (no rows: the table carries no
--   receipt trigger); pg_stat_user_tables; pipeline_registry (1 table-level row, owned_by unknown, from
--   20261007002507_declare_table_owners_1.sql; no row is added or changed here). Reader code: scripts/backfill-single-vehicle.js
--   and scripts/check-progress.sh.
-- LIMITS:
--   The SQL of the two bulk passes of 2026-02-06 (622,554 rows) is in no repo file, commit or logged migration, so their
--   rules are read from the values they left. Orphans, the agreement with the live vehicle and the coverage of vehicles come
--   from 1% block samples and can miss rare cases. Rows are overwritten in place, so the table keeps the last write only.
--   The table holds no personal data; quoted values are flag names, column and function names, job names and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Automated quality tracking - identifies incomplete listings and triggers repairs". That
--   stays as the opening; the new comment adds the grain, the two bulk passes, the still-deployed writer and what calls it,
--   the columns never written, the orphans, the coverage, the idle readers, the access and the clocks. There were no column
--   comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_quality_scores IS
'Automated quality tracking - identifies incomplete listings and triggers repairs: one completeness snapshot per vehicle (grain: one vehicle; PRIMARY KEY vehicle_id), upserted in place, so it keeps the latest write only. 625,154 rows on 2026-10-07 (the atlas estimate of 624,342 is a stale reltuples). Nothing recomputes it: 622,554 rows (99.6%) come from two bulk statements on 2026-02-06 (369,759 rows at 16:26:24Z and 252,795 at 17:12:03Z) whose SQL is in no repo file and no logged migration, and they have not changed since. The two passes used different rules: the first set has_vin, has_price, has_images, image_count and has_mileage and left every needs_* flag false; the second set has_price, needs_vin_lookup on every row and needs_price_backfill, and left has_vin, has_images and has_mileage false. The other 2,600 rows were written one at a time by the edge function backfill-quality-scores: 1,061 on 2026-02-06 (all with score 0), 30 on 2026-02-07 and 9 on 2026-02-14 (Saturday 03:00Z runs of the cron job analytics-quality-scores, jobid 135, now inactive), and 500 each on 2026-03-20, 2026-09-30 and 2026-10-07. Its source left the repo in commit 200581de7 (2026-03-31), but its version 26 (deployed 2026-03-20) is still ACTIVE with verify_jwt false and no write guard, and any request without a body scores the 500 newest vehicles that lack a row: the 2026-10-07 05:40Z batch came from an unauthenticated GET in a curl sweep that called every deployed function in turn, and the 2026-09-30 20:25Z batch ran during a similar GET sweep by a node client (edge and function logs, read 2026-10-07). It writes only vehicle_id, overall_score, last_checked_at and updated_at, so its rows keep the defaults in every other column. Never written on any row (2026-10-07): has_events, event_count, bat_image_count, dropbox_image_count, issues (an empty array), needs_bat_images, needs_deletion and last_repaired_at. Coverage (1% block sample of vehicles): 2,653 of 6,754 vehicles that are not soft-deleted (39.3%) have a row, and 10 of the 4,111 created after the 2026-02-06 passes. Orphans: 578 of 5,137 rows of a 1% block sample (11.3%, about 70,000 rows) point at a vehicle id that is not in vehicles, although the foreign key to vehicles (ON DELETE CASCADE) is validated and its triggers are enabled, so those vehicles were deleted with the RI triggers off; the exact count exceeded the 10 s timeout. Of the sampled rows whose vehicle exists, 2,244 of 4,559 (49.2%) belong to a soft-deleted vehicle (1,292 of the 1,631 rows of the second pass). pg_stat_user_tables since its counters began (the server last started 2026-09-29 09:20Z; read 13:05Z): 1,000 inserts (the two 500-row batches), 0 updates, 0 deletes, 10 sequential and 2,092 index scans. Readers: none live. auto_queue_backfills (trigger trg_auto_queue_backfills on scraper_versions, which had 0 writes since the counters began), calculate_verification_layer (reached only through refresh_platform_tier, which no trigger, cron job or code calls) and queue_vehicle_for_backfill (no caller) read overall_score; the views repair_queue and vehicles_needing_micro_scrape read it, and nothing reads them; scripts/backfill-single-vehicle.js and scripts/check-progress.sh read it by hand. pipeline_registry (owned_by unknown, do_not_write_directly true) lists it as a drop-list candidate; recorded here as a fact, not decided. Access: RLS is on with no policy and anon and authenticated hold no privilege (revoked by the logged migration 20260314031411 rls_lockdown_internal_tables, which is not in the repo); the two views are closed to both roles as well. No write receipts. Clocks: created_at is the database clock of the insert; updated_at and last_checked_at are the writer clock (equal to created_at on the bulk rows); nothing records which state of the vehicle a row was computed from.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_quality_scores.vehicle_id IS
'Vehicle the row scores: a vehicles.id, NOT NULL, the PRIMARY KEY and a foreign key to vehicles(id) ON DELETE CASCADE (validated, its triggers enabled). 625,154 distinct values (2026-10-07). In a 1% block sample 578 of 5,137 rows (11.3%; 341 of 3,234 rows of the first bulk pass, 235 of 1,866 of the second, 2 of 37 edge-function rows) point at an id that is not in vehicles, so about 70,000 rows are orphans whose vehicle was deleted with the RI triggers off. The edge function picked vehicles with deleted_at NULL and no row, newest first by vehicles.created_at. Unit: none (uuid). Source: the writing pass. Grain: one vehicle. Clock: n/a.';

-- ── Completeness flags (from the 2026-02-06 passes only) ──────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_quality_scores.has_vin IS
'Whether the vehicle had a VIN when the first bulk pass ran, boolean, nullable, default false. true on 107,095 rows (17.1%, 2026-10-07), all from the first bulk pass of 2026-02-06; false on every row of the second pass and of the edge function, whatever the vehicle holds. The rule of the pass is not recorded: in a 1% block sample it agrees with the live vehicle (VIN of 11 or more characters) on 2,443 of 2,893 first-pass rows whose vehicle exists (84.4%). Not updated when the vehicle changes. Unit: none (boolean). Source: the 2026-02-06 bulk pass (SQL not in the repo). Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.has_price IS
'Whether the vehicle had a price when a bulk pass ran, boolean, nullable, default false. true on 391,761 rows (62.7%, 2026-10-07): 229,145 from the first bulk pass and 162,616 from the second; false on every edge-function row. In a 1% block sample it agrees with the live vehicle (current_value or sale_price above 0) on 1,646 of 2,893 first-pass rows (56.9%) and on 461 of 1,631 second-pass rows (28.3%), so prices changed or the passes used another rule. Never true together with needs_price_backfill. Unit: none (boolean). Source: the 2026-02-06 bulk passes. Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.has_images IS
'Whether the vehicle had images when the first bulk pass ran, boolean, nullable, default false. true on 182,006 rows (29.1%, 2026-10-07), all from the first pass, and true exactly where image_count is above 0. In a 1% block sample it agrees with vehicles.image_count above 0 on 2,513 of 2,893 first-pass rows whose vehicle exists (86.9%). Unit: none (boolean). Source: the 2026-02-06 bulk pass. Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.has_events IS
'Intended flag that the vehicle has timeline events (the creating function counted timeline_events), boolean, nullable, default false. false on all 625,154 rows (2026-10-07): no pass set it. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_quality_scores.has_mileage IS
'Whether the vehicle had a mileage when the first bulk pass ran, boolean, nullable, default false. true on 137,160 rows (21.9%, 2026-10-07), all from the first pass. In a 1% block sample it agrees with vehicles.mileage being set on 2,509 of 2,893 first-pass rows whose vehicle exists (86.7%). Unit: none (boolean). Source: the 2026-02-06 bulk pass. Grain: one vehicle. Clock: as of created_at.';

-- ── Counts ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_quality_scores.image_count IS
'Images of the vehicle when the first bulk pass ran, integer, nullable, default 0. Above 0 on 182,006 rows (2026-10-07), the same rows as has_images; 0 elsewhere, NULL never; the largest is 17,472. In a 1% block sample it equals the live vehicles.image_count on 2,210 of 2,893 first-pass rows whose vehicle exists (76.4%). Unit: images. Source: the 2026-02-06 bulk pass. Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.event_count IS
'Intended count of timeline events of the vehicle, integer, nullable, default 0. 0 on all 625,154 rows (2026-10-07); no pass counted them. Unit: count. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_quality_scores.bat_image_count IS
'Intended count of images whose URL is on bringatrailer (creating function: original BaT photos), integer, nullable, default 0. 0 on all 625,154 rows (2026-10-07); no pass counted them. Unit: images. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_quality_scores.dropbox_image_count IS
'Intended count of images whose URL is on dropbox (creating function: Dropbox dumps), integer, nullable, default 0. 0 on all 625,154 rows (2026-10-07); no pass counted them. Unit: images. Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Score and issues ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_quality_scores.overall_score IS
'Completeness score of the vehicle, 0 .. 100 by CHECK, integer, nullable, default 0; NULL never. Observed 0 .. 90 in steps of 5 (2026-10-07): 0 on 180,378 rows (28.9%), below 60 on 490,047 (78.4%), 80 or more on 95,006 (15.2%). Three rules wrote it and none is recomputed. The first bulk pass (2026-02-06 16:26Z) left values from 0 to 90 (1% block sample: 0 on 49%, 85 on 22%); the second pass (17:12Z) left 35 on 162,431 rows (all with has_price), 15 on 89,733 (all without) and other values on 631; the rules of both passes are not recorded. The edge-function rows hold calculate_vehicle_quality_score(vehicles) at write time: VIN of 11 or more characters 25, mileage 10, transmission 5, drivetrain 5, color 5, images 10, 20 or 30 (1, 5 or 10 or more), description 5 or 10, a title document 10; all 1,061 rows of 2026-02-06 hold 0, and the batches of 2026-03-20, 2026-09-30 and 2026-10-07 average 20.0, 41.6 and 61.4. The creating migration 20251110000001 scored differently again (VIN 20, price 20, images 30, events 15, mileage 5), so values from different batches do not compare. Read by auto_queue_backfills, calculate_verification_layer, queue_vehicle_for_backfill and the views repair_queue (priority bands below 20, 40, 60, rows below 80) and vehicles_needing_micro_scrape (below 85), none of them live. Unit: score points, 0 .. 100. Source: the 2026-02-06 bulk passes or calculate_vehicle_quality_score through backfill-quality-scores. Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.issues IS
'Intended list of problem codes (the creating function appended NO_VIN, NO_PRICE, NO_IMAGES, NO_EVENTS, NO_MILEAGE), text array, nullable, default an empty array. Empty on all 625,154 rows (2026-10-07): no pass wrote it. Read by the view repair_queue and by scripts/backfill-single-vehicle.js. Unit: none (text array). Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Repair flags ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_quality_scores.needs_bat_images IS
'Intended flag that a BaT import lacks its original photos, boolean, nullable, default false. false on all 625,154 rows (2026-10-07), so the partial index idx_quality_scores_needs_images (WHERE needs_bat_images) indexes nothing. Read by the view repair_queue. Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_quality_scores.needs_price_backfill IS
'Flag that the vehicle needed a price, boolean, nullable, default false. true on 90,179 rows (14.4%, 2026-10-07), all from the second bulk pass of 2026-02-06 and never together with has_price; false on every other row. In a 1% block sample it agrees with the live vehicle having neither sale_price nor current_value on 461 of 1,631 second-pass rows (28.3%). Read by the view repair_queue (action SYNC_PRICE_FROM_ORG), which nothing reads. Unit: none (boolean). Source: the 2026-02-06 second bulk pass. Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.needs_vin_lookup IS
'Flag that the vehicle needed a VIN, boolean, nullable, default false. true on exactly the 252,795 rows of the second bulk pass of 2026-02-06 (40.4%, 2026-10-07) and false on every other row, including first-pass rows without a VIN. In a 1% block sample it agrees with the live vehicle lacking a VIN of 11 or more characters on 1,441 of 1,631 second-pass rows (88.4%); 1,292 of those 1,631 vehicles are soft-deleted now. Read by the view repair_queue (action LOOKUP_VIN). Unit: none (boolean). Source: the 2026-02-06 second bulk pass. Grain: one vehicle. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_quality_scores.needs_deletion IS
'Intended flag that the vehicle is junk to remove (creating function: no images, no events and no price), boolean, nullable, default false. false on all 625,154 rows (2026-10-07). Read by the view repair_queue (action DELETE). Unit: none (boolean). Source: none. Grain: one vehicle. Clock: n/a.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_quality_scores.last_checked_at IS
'When the row was scored, timestamptz, nullable, default now(). Filled on every row (2026-10-07). On the 622,554 bulk rows it is the statement clock and equals created_at (2026-02-06 16:26:24Z or 17:12:03Z); on the 2,600 edge-function rows it is the function clock in milliseconds (new Date()), 0.01 to 0.23 s before created_at. Equal to updated_at on all but 21 rows. Range 2026-02-06 15:34Z .. 2026-10-07 05:42Z. It does not move when the vehicle changes. Unit: timestamptz. Source: column default or the writer clock. Grain: one vehicle. Clock: writer time of the scoring.';
COMMENT ON COLUMN public.vehicle_quality_scores.last_repaired_at IS
'Intended time of the last repair triggered by the flags, timestamptz, nullable. NULL on all 625,154 rows (2026-10-07): nothing repairs from this table. Unit: timestamptz. Source: none. Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_quality_scores.created_at IS
'When the row was inserted: default now(), the database clock of the insert, never changed. Filled on every row (2026-10-07). By day: 2026-02-06 623,615 (369,759 at 16:26:24Z and 252,795 at 17:12:03Z in two statements, and 1,061 single rows from 15:34Z to 17:11Z), 2026-02-07 30, 2026-02-14 9, 2026-03-20 500, 2026-09-30 500, 2026-10-07 500 (05:40Z .. 05:42Z). Unit: timestamptz. Source: column default. Grain: one vehicle. Clock: ingest time of the first write.';
COMMENT ON COLUMN public.vehicle_quality_scores.updated_at IS
'When the row was last written, timestamptz, nullable, default now(). No update trigger maintains it. Equal to created_at on the 622,554 bulk rows; on the 2,600 edge-function rows it is the function clock in milliseconds, sent with the upsert. Since the statistics counters began there were 0 updates (2026-10-07), so it is the insert time of every row. Unit: timestamptz. Source: column default or the writer clock. Grain: one vehicle. Clock: writer time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_quality_scores'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_quality_scores: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_quality_scores columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
