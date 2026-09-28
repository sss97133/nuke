-- Dead-jobs review (bat-data lane, 2026-09-28; brief item 7, approved by Skylar): retire 20 INACTIVE pg_cron jobs.
-- Walked all 120 inactive jobs: every one still points at a deployed edge function or an existing SQL function, so
-- "dead" here means one of: the command carries a literal service-role key (10; the key leaves the database with the
-- job), the cron ledger already marks it superseded (3), or it is BaT plumbing the current path replaced (7; the BaT
-- path is 488 sync-live-auctions, 503 bat-closed-lots-sync-daily, 504 bat-settlement-drain, 505 bat-live-bids-snapshot
-- and extract-bat-core). Nothing active is touched: a job is unscheduled only if it is still inactive at apply time.
-- Unscheduling is not deletion: the functions stay deployed; restore any job with cron.schedule(<name>, <schedule>,
-- <command below>). Literal keys are shown as <redacted key>; a restored job reads get_service_role_key_for_cron().
-- The other 100 inactive jobs stay paused (verdicts in .claude/ISSUES.md); 175 / 182 / 212 belong to market-home.
--
-- 154 enrich-collecting-cars  '*/10 * * * *'
--   why: literal service key in the command; enrichment of collecting-cars rows. Re-create with get_service_role_key_for_cron() if wanted.
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-vehicles-cron',
--     headers := jsonb_build_object( 'Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--     get_service_role_key_for_cron() ), body := '{"source": "collecting_cars", "limit": 10}'::jsonb );
-- 160 enrich-bulk-derive-bat  '2-59/5 * * * *'
--   why: literal service key; enrich-bulk fan-out copy (derive, bat).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-bulk', headers :=
--     '{"Authorization": "Bearer <redacted key>", "Content-Type": "application/json"}'::jsonb, body :=
--     '{"strategy": "derive_fields", "limit": 500, "source": "bat"}'::jsonb )
-- 161 enrich-bulk-derive-mecum  '1-59/5 * * * *'
--   why: literal service key; enrich-bulk fan-out copy (derive, mecum).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-bulk', headers :=
--     '{"Authorization": "Bearer <redacted key>", "Content-Type": "application/json"}'::jsonb, body :=
--     '{"strategy": "derive_fields", "limit": 500, "source": "mecum"}'::jsonb )
-- 162 enrich-bulk-derive-cab  '2-59/5 * * * *'
--   why: literal service key; enrich-bulk fan-out copy (derive, cab).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-bulk', headers :=
--     '{"Authorization": "Bearer <redacted key>", "Content-Type": "application/json"}'::jsonb, body :=
--     '{"strategy": "derive_fields", "limit": 500, "source": "carsandbids"}'::jsonb )
-- 164 enrich-bulk-derive-batcore  '4-59/5 * * * *'
--   why: literal service key; enrich-bulk fan-out copy (derive, batcore).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-bulk', headers :=
--     '{"Authorization": "Bearer <redacted key>", "Content-Type": "application/json"}'::jsonb, body :=
--     '{"strategy": "derive_fields", "limit": 500, "source": "bat_core"}'::jsonb )
-- 165 enrich-bulk-crossref  '2-59/5 * * * *'
--   why: literal service key; enrich-bulk fan-out copy (crossref).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-bulk', headers :=
--     '{"Authorization": "Bearer <redacted key>", "Content-Type": "application/json"}'::jsonb, body :=
--     '{"strategy": "cross_reference", "limit": 300}'::jsonb )
-- 335 process-profile-queue  '*/5 * * * *'
--   why: literal service key; profile-queue worker.
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-profile-queue',
--     headers := jsonb_build_object( 'Authorization', 'Bearer ' || get_service_role_key_for_cron(),
--     'Content-Type', 'application/json' ), body := '{}'::jsonb ) AS request_id;
-- 422 live-auction-sync-others  '7,37 * * * *'
--   why: literal service key; non-BaT live-auction sync (488 sync-live-auctions is the live path).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-live-auctions',
--     headers := '{"Content-Type": "application/json", "Authorization": "Bearer <redacted key>"}'::jsonb, body :=
--     '{"action": "sync", "platform": "collecting-cars", "skip_vehicle_sync": false}'::jsonb, timeout_milliseconds
--     := 55000 ) AS request_id;
-- 423 live-auction-sync-cab  '22,52 * * * *'
--   why: literal service key; Cars & Bids live-auction sync (488 sync-live-auctions is the live path).
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-live-auctions',
--     headers := '{"Content-Type": "application/json", "Authorization": "Bearer <redacted key>"}'::jsonb, body :=
--     '{"action": "sync", "platform": "cars-and-bids", "skip_vehicle_sync": false}'::jsonb, timeout_milliseconds
--     := 55000 ) AS request_id;
-- 468 question-classify-batch  '*/5 * * * *'
--   why: literal service key; comment question classifier.
--     SELECT net.http_post( url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-comments-fast',
--     headers := '{"Authorization": "Bearer <redacted key>", "Content-Type": "application/json"}'::jsonb, body :=
--     '{"mode": "question_classify", "batch_size": 200}'::jsonb )
-- 474 drain-vehicle-metric-queue  '* * * * *'
--   why: superseded by 500 drain-vehicle-derived-queues (20260927010000); ledger: retire.
--     SELECT public.drain_vehicle_metric_queue(200);
-- 475 drain-vehicle-completion-queue  '* * * * *'
--   why: superseded by 500 drain-vehicle-derived-queues; ledger: retire.
--     SELECT public.drain_vehicle_completion_queue(50);
-- 477 drain-vehicle-stats-queue  '* * * * *'
--   why: superseded by 500 drain-vehicle-derived-queues; ledger: retire.
--     SELECT public.drain_vehicle_stats_queue(50);
-- 403 parse_bat_snapshots_bulk_1  '2-59/5 * * * *'
--   why: BaT snapshot bulk parse; replaced by extract-bat-core (reads the stored snapshot itself) and the BaT archive.
--     SELECT parse_bat_snapshots_bulk(100);
-- 406 batch_extract_snapshots_bat_sparse  '0-59/5 * * * *'
--   why: BaT sparse snapshot extraction; replaced by extract-bat-core (prefer_snapshot) and the BaT archive.
--     SELECT net.http_post( url := get_service_url() || '/functions/v1/batch-extract-snapshots', headers :=
--     jsonb_build_object( 'Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--     get_service_role_key_for_cron() ), body := '{"platform": "bat", "batch_size": 10, "mode": "sparse",
--     "use_queue": true}'::jsonb, timeout_milliseconds := 120000 );
-- 411 bat-weekly-price-propagation  '0 8 * * 0'
--   why: writes vehicles directly (bat-price-propagation/index.ts:270 .from("vehicles").update) -- bypasses correct_vehicle_sale_provenance_batch; must not run again.
--     SELECT net.http_post( url := get_service_url() || '/functions/v1/bat-price-propagation', headers :=
--     jsonb_build_object( 'Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--     get_service_role_key_for_cron() ), body := '{"action":"propagate","batch_size":500}'::jsonb,
--     timeout_milliseconds := 120000 );
-- 412 bat-snapshot-parser-batch  '1-59/5 * * * *'
--   why: BaT snapshot parser; replaced by extract-bat-core.
--     SELECT net.http_post( url := get_service_url() || '/functions/v1/bat-snapshot-parser', headers :=
--     jsonb_build_object( 'Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--     get_service_role_key_for_cron() ), body := '{"mode":"process","limit":50}'::jsonb, timeout_milliseconds :=
--     120000 );
-- 463 drain-bat-queue-from-metadata  '0-59/5 * * * *'
--   why: fills the BaT queue from metadata; replaced by 503 bat-closed-lots-sync-daily + 504 bat-settlement-drain.
--     SET client_min_messages TO warning; SELECT drain_bat_queue_from_metadata(200);
-- 469 sync-bat-auction-status  '5,20,35,50 * * * *'
--   why: BaT live status sync; 488 sync-live-auctions marks live/ended at every run.
--     SELECT sync_bat_live_auction_status()
-- 481 bat-import-queue-worker  '*/5 * * * *'
--   why: BaT import-queue worker; replaced by 504 bat-settlement-drain + extract-bat-core.
--     SELECT net.http_post( url := get_service_url() || '/functions/v1/bat-queue-worker', headers :=
--     jsonb_build_object( 'Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
--     get_service_role_key_for_cron() ), body := '{"batch_size": 10}'::jsonb );

SET statement_timeout = '30s';
SET lock_timeout = '10s';

DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobid IN (154, 160, 161, 162, 164, 165, 335, 422, 423, 468, 474, 475, 477, 403, 406, 411, 412, 463, 469, 481)
      AND NOT active
    ORDER BY jobid
  LOOP
    PERFORM cron.unschedule(r.jobid);
    RAISE NOTICE 'unscheduled % (job %)', r.jobname, r.jobid;
    n := n + 1;
  END LOOP;
  IF n <> 20 THEN
    RAISE WARNING 'expected 20 inactive jobs to retire, found %', n;
  END IF;
END
$do$;

-- POST-APPLY (read-only): 0 rows --
--   SELECT jobid FROM cron.job WHERE jobid IN (154, 160, 161, 162, 164, 165, 335, 422, 423, 468, 474, 475, 477, 403, 406, 411, 412, 463, 469, 481);
