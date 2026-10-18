-- Re-enable Gooding intake (lane G, 2026-10-06). Evidence: ~/nuke-logs/data-hygiene-20261005/G-INTAKE-SCHEDULES.md, section 2 #1.
--
-- Why: Gooding has had no new vehicles since the 2026-04-25 cron pause. 8,884 Gooding vehicles, the newest from 2026-04-02.
-- goodingco.com/sitemap.xml lists 9,552 lots on 2026-10-06. 275 of them are in none of import_queue,
-- import_queue_archive or vehicles; 274 are vehicles and 1 is an engine.
-- Expected movement: +274 vehicles (canonical_platform 'gooding' 8,884 -> ~9,158), each with its listing_page_snapshots row,
-- vehicle_images, vehicle_events and observations, written by extract-gooding.
--
-- Path, using only canonical, deployed pieces (extract-gooding on prod is byte-identical to main, sha256 bd3350ed83b4…):
--   1. Job 'enrich-gooding-sitemap' (371) is unchanged: every 4 h, extract-gooding {action: discover_and_enqueue}.
--      One sitemap fetch upserts lot URLs into import_queue. The unique index import_queue_listing_url_key drops the 9,277 known URLs.
--      The BEFORE INSERT trigger trigger_auto_set_import_queue_source stamps source_id
--      ce74e304-d190-4041-9cce-cb950652b9c4 (Gooding Auctions). The AFTER INSERT trigger auto_process_import_queue is disabled.
--   2. Job 'process-import-queue-batch-2' (457), a duplicate schedule of 420, becomes the Gooding-scoped drain.
--      It calls process-import-queue with that source_id, 10 rows every 10 min. Each row is posted as {url, save_to_db: true}
--      to extract-gooding, which reads the lot's Gatsby page-data.json directly. No Firecrawl and no AI.
--      Not job 451: its batch_from_queue calls claim_import_queue_batch with no p_source_id, so it can take any source's pending rows.
-- Load: one 1.9 MB sitemap fetch per 4 h; 10 page-data.json fetches and their writes per 10 min (60/h); 275 rows drain in ~4.6 h.
--   The database cost is the resolver: each new lot runs resolveExistingVehicleId step 3, a vehicles.discovery_url
--   ILIKE '%goodingco.com/lot/<slug>%'. Without a trigram index that took a mean of 15.4 s per call (pg_stat_statements:
--   39 calls, max 39.4 s), about 15 min of index-and-heap walking per hour at this rate.
--   Order: this migration lands after 20261006121500_idx_vehicles_discovery_url_trgm (PR #683), which makes that step an
--   index lookup. Check indisvalid on idx_vehicles_discovery_url_trgm before merging. If it is not valid, halve batch_size to 5.
-- No writer label: both jobs only enqueue an HTTP request. The rows are written by edge functions on their own connections,
--   so an app.writer set in the cron session would label nothing.
--
-- Measure (read-only):
--   select count(*) from vehicles where canonical_platform = 'gooding';                         -- 8,884 -> ~9,158
--   select status, count(*) from import_queue
--    where source_id = 'ce74e304-d190-4041-9cce-cb950652b9c4' and created_at > '2026-10-06' group by 1;   -- pending 275 -> 0
--   select start_time, status, left(return_message, 120) from cron.job_run_details
--    where jobid in (371, 457) order by start_time desc limit 10;
-- Stop rule: pause 457 (and 371) on any of these:
--   (a) over 20% of a run's rows end failed or skipped;
--   (b) a new Gooding vehicle with null year or make;
--   (c) a new vehicle_events sold_at that is not the lot's auction day;
--   (d) Gooding pending reaches 0. This one is done, not a failure; 371 may stay on to enqueue lots new to the sitemap.
--   select cron.alter_job(jobid, active := false) from cron.job where jobname in ('process-import-queue-batch-2', 'enrich-gooding-sitemap');

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $do$
DECLARE
  v_sitemap bigint;
  v_drain bigint;
BEGIN
  SELECT jobid INTO v_sitemap FROM cron.job WHERE jobname = 'enrich-gooding-sitemap';
  SELECT jobid INTO v_drain FROM cron.job WHERE jobname = 'process-import-queue-batch-2';
  IF v_sitemap IS NULL OR v_drain IS NULL THEN
    RAISE EXCEPTION 'gooding intake: job not found (enrich-gooding-sitemap=%, process-import-queue-batch-2=%)', v_sitemap, v_drain;
  END IF;

  PERFORM cron.alter_job(job_id := v_sitemap, active := true);

  PERFORM cron.alter_job(job_id := v_drain,
    schedule := '*/10 * * * *',
    command := $cmd$SELECT net.http_post(
  url := get_service_url() || '/functions/v1/process-import-queue',
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
  body := '{"batch_size": 10, "source_id": "ce74e304-d190-4041-9cce-cb950652b9c4"}'::jsonb,
  timeout_milliseconds := 120000);$cmd$,
    active := true);
END
$do$;

COMMIT;

-- Verify after apply (read-only):
--   select jobid, jobname, schedule, active, command from cron.job where jobname in ('enrich-gooding-sitemap', 'process-import-queue-batch-2');
--     both active; 457 '*/10 * * * *' with the Gooding source_id in its body.
--   After 371's first run (on the next 4-hour boundary): about 275 new pending import_queue rows on goodingco.com with that source_id.
-- Revert: select cron.alter_job(jobid, active := false) from cron.job where jobname in ('process-import-queue-batch-2', 'enrich-gooding-sitemap');
