-- Contract for 20261113140000_image_stage_reconciler_refill.sql, on a fresh disposable database: the backfill refills
-- only when a reader has fewer than refill_below items it could claim; new uploads are queued on every tick; the
-- backfill cursor never passes a photo whose gaps it did not queue; a skipped or capped tick stamps last_run_at; a
-- replay leaves the cursor and a tuned mark alone; the revert restores the 20261113110000 body and comment.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN RAISE EXCEPTION 'needs an empty disposable database'; END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job, sched, cmd) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = j RETURNING true $$;
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, image_url text, created_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean, is_sensitive boolean, is_external boolean, is_superseded boolean, vision_gate_status text,
  ai_processing_status text, ai_processing_started_at timestamptz, ai_scan_metadata jsonb, exif_data jsonb);
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.img(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql
\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
SELECT md5(prosrc) AS prior FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure \gset
UPDATE image_stage_reconciler_state SET cursor_created_at = now() - interval '400 days', cursor_id = pg_temp.img(0) WHERE lane = 'backfill';  -- a pass in progress
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
SELECT pg_temp.ok((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler')
  @> '{"enabled": true, "refill_below": 100, "max_open": 300, "scan_per_lane": 200}', 'refill_below is set; the other settings are kept');
SELECT pg_temp.ok((SELECT cursor_id IS NULL AND cursor_created_at IS NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'first application restarts the pass');

-- 250 never-read photos of the named user, old enough to be work (photo 1 is the oldest)
INSERT INTO vehicle_images (id, user_id, image_url, created_at, ai_processing_status)
SELECT pg_temp.img(g), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/' || g || '.jpg', now() - interval '30 days' + g * interval '1 minute', 'completed'
  FROM generate_series(1, 250) g;

-- ===== 1. batches, and a cursor that stops where the queueing stopped
-- nothing claimable: the tick scans 200 candidates, finds 200 gaps and has room for 100
CREATE TEMP TABLE t1 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t1) = 100 AND (SELECT count(*) FROM image_stage_work) = 100
  AND (SELECT (r #>> '{backfill,scanned}')::int FROM t1) = 200, 'empty queue: 200 scanned, 100 queued');
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 3)::int ORDER BY image_id) FROM image_stage_work) = (SELECT array_agg(g) FROM generate_series(1, 100) g), 'oldest first: photos 1 to 100');
SELECT pg_temp.ok((SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(100), 'the cursor stops at the last photo queued, not at the 200th scanned');
-- 100 claimable is at the mark: the backfill is skipped and says why; the tick still stamps last_run_at on both lanes
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
CREATE TEMP TABLE t2 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT r -> 'backfill' FROM t2) = '{"skipped": "queue_ok", "ready": 100, "refill_below": 100}'::jsonb
  AND (SELECT (r ->> 'enqueued')::int FROM t2) = 0 AND (SELECT count(*) FROM image_stage_work) = 100, 'at the mark: the backfill is skipped as queue_ok, nothing queued');
SELECT pg_temp.ok((SELECT bool_and(last_run_at > now() - interval '1 minute') FROM image_stage_reconciler_state), 'the tick stamps last_run_at on both lanes');
SELECT pg_temp.ok((SELECT cursor_id = pg_temp.img(100) AND last_scanned = 0 AND last_enqueued = 0 FROM image_stage_reconciler_state WHERE lane = 'backfill'),
  'a skipped backfill leaves the cursor alone and reports a scan of nothing');

-- ===== 2. a new upload is queued on the next tick, whatever the backlog holds
INSERT INTO vehicle_images (id, user_id, image_url, created_at, ai_processing_status)
VALUES (pg_temp.img(900), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/900.jpg', now() - interval '1 hour', 'pending');
CREATE TEMP TABLE t3 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t3) = 1 AND (SELECT r #>> '{backfill,skipped}' FROM t3) = 'queue_ok'
  AND (SELECT lane FROM image_stage_work WHERE image_id = pg_temp.img(900)) = 'live', 'backlog above the mark: the new upload is queued by the live lane on this tick');

-- ===== 3. the reader takes 20 (the new upload first) and reads them: 81 claimable, so the backfill refills with the next oldest
CREATE TEMP TABLE c1 AS SELECT * FROM claim_image_stage_work('classifier', 20, 900, '0b9f107a-d124-49de-9ded-94698f63c1c4');
SELECT pg_temp.ok((SELECT count(*) FROM c1) = 20 AND EXISTS (SELECT 1 FROM c1 WHERE image_id = pg_temp.img(900)), 'the reader claims 20, the new upload among them');
SELECT count(record_image_stage_receipt(image_id, 'classifier', 1, 'succeeded')) FROM c1;
CREATE TEMP TABLE t4 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t4) = 100 AND (SELECT count(*) FROM image_stage_work WHERE status IN ('queued', 'claimed')) = 181, 'below the mark: refilled by 100 to 181 open');
SELECT pg_temp.ok((SELECT max(right(image_id::text, 3)::int) FROM image_stage_work WHERE image_id <> pg_temp.img(900)) = 200
  AND (SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(200),
  'the photos the first scan had no room for (101 to 200) are queued next, none passed over');

-- ===== 4. the mark counts what a reader could claim now: items that are not due yet do not hold the backfill back
UPDATE image_stage_work SET not_before = now() + interval '20 hours' WHERE status = 'queued';
CREATE TEMP TABLE t5 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t5) = 50 AND NOT (SELECT r -> 'backfill' ? 'skipped' FROM t5), '181 open but none due: the backfill scans and queues the last 50');
-- that scan was short (51 candidates of 200) and queued every gap it found: the pass is over, in the same tick
SELECT pg_temp.ok((SELECT cursor_id IS NULL AND wrapped_at > now() - interval '1 minute' FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'a short scan with every gap queued ends the pass at once');
UPDATE image_stage_work SET not_before = now() WHERE status = 'queued';

-- ===== 5. a mark that is not a number of 1 or more is no mark: the backfill is never idled by a bad value, and nothing raises
DO $$ DECLARE v jsonb; r jsonb; BEGIN
  FOREACH v IN ARRAY ARRAY['0', '-5', '"abc"', '"100"', 'true', '[100]', 'null', '3000000000']::jsonb[] LOOP
    UPDATE platform_config SET config_value = jsonb_set(config_value, '{refill_below}', v) WHERE config_key = 'image_stage_reconciler';
    r := reconcile_image_stages(100);
    IF r -> 'backfill' ? 'skipped' OR r ? 'skipped' THEN RAISE EXCEPTION 'FAILED: refill_below % must mean no mark, got %', v, r; END IF;
  END LOOP;
END $$;
UPDATE platform_config SET config_value = config_value || '{"refill_below": 99.5}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(reconcile_image_stages(100) #>> '{backfill,refill_below}' = '99', 'a fractional mark is floored (231 claimable: skipped at 99)');

-- ===== 6. the cap: named as such, stamped when it is a real cap, not stamped when the cap is zero
UPDATE platform_config SET config_value = config_value || '{"max_open": 150, "refill_below": 100}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
SELECT pg_temp.ok(reconcile_image_stages(100) = '{"skipped": "queue_full", "open": 231}'::jsonb, 'over max_open: queue_full');
SELECT pg_temp.ok((SELECT bool_and(last_run_at > now() - interval '1 minute') FROM image_stage_reconciler_state), 'a full queue stamps last_run_at');
UPDATE platform_config SET config_value = config_value || '{"max_open": 0}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
SELECT pg_temp.ok(reconcile_image_stages(100) ->> 'skipped' = 'queue_full' AND (SELECT bool_and(last_run_at < now() - interval '2 hours') FROM image_stage_reconciler_state),
  'max_open 0 is a misconfiguration: the tick does not stamp, so the watch sees a reconciler that queues nothing');
UPDATE platform_config SET config_value = config_value || '{"max_open": 300}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(reconcile_image_stages(0) ->> 'skipped' = 'queue_full', 'p_limit 0 enqueues nothing');
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(reconcile_image_stages(100) ->> 'skipped' = 'disabled', 'switched off: disabled');
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_reconciler';

-- ===== 7. an item queued earlier and lying further along does not pull the cursor past gaps this run had no room for
DELETE FROM image_stage_work WHERE image_id NOT BETWEEN pg_temp.img(150) AND pg_temp.img(200);
UPDATE image_stage_work SET status = 'queued', lease_until = NULL, finished_at = NULL;
SET session_replication_role = replica;
DELETE FROM image_stage_receipts;
SET session_replication_role = DEFAULT;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
UPDATE platform_config SET config_value = config_value - 'refill_below' WHERE config_key = 'image_stage_reconciler';
DELETE FROM vehicle_images WHERE id = pg_temp.img(900);
CREATE TEMP TABLE t6 AS SELECT reconcile_image_stages(100) AS r;  -- scans photos 1 to 200: 149 gaps (1 to 149), room for 100
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t6) = 100
  AND (SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(100),
  'the cursor stops at the last photo this run queued (100), not at the open item furthest along (200)');
CREATE TEMP TABLE t7 AS SELECT reconcile_image_stages(100) AS r;  -- no mark: tops up at once; photos 101 to 149, then 201 to 250
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status = 'queued' AND image_id BETWEEN pg_temp.img(101) AND pg_temp.img(149)) = 49, 'photos 101 to 149 are queued by the next run');

-- ===== 8. two required stages: the cursor stops at the last photo whose gaps were ALL queued
DELETE FROM image_stage_work;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
UPDATE image_pipeline_stages SET required = true WHERE stage = 'exif';
CREATE TEMP TABLE t8 AS SELECT reconcile_image_stages(5) AS r;   -- room for 5 rows: photos 1 and 2 whole, photo 3's first stage
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 1) || ':' || stage ORDER BY image_id, stage) FROM image_stage_work)
  = ARRAY['1:classifier', '1:exif', '2:classifier', '2:exif', '3:classifier'], 'five rows queued, the cut falling inside photo 3');
SELECT pg_temp.ok((SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(2), 'the cursor stops at photo 2, the last one fully queued');
CREATE TEMP TABLE t9 AS SELECT reconcile_image_stages(5) AS r;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM image_stage_work WHERE image_id = pg_temp.img(3) AND stage = 'exif'), 'photo 3''s other stage is the first thing the next run queues');
UPDATE image_pipeline_stages SET required = false WHERE stage = 'exif';

-- ===== 9. replay leaves a pass in progress and a tuned mark alone
UPDATE platform_config SET config_value = config_value || '{"refill_below": 60}' WHERE config_key = 'image_stage_reconciler';
SELECT cursor_id AS mid_pass FROM image_stage_reconciler_state WHERE lane = 'backfill' \gset
SELECT pg_temp.ok(:'mid_pass' IS NOT NULL, 'a pass is in progress');
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
SELECT pg_temp.ok((SELECT config_value ->> 'refill_below' FROM platform_config WHERE config_key = 'image_stage_reconciler') = '60'
  AND (SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = :'mid_pass', 'replay: the tuned mark and the cursor are kept');

-- ===== 10. revert restores the prior body and comment; a body nobody knows is refused both ways
\ir revert_20261113140000_image_stage_reconciler_refill.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure) = :'prior'
  AND NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'refill_below')
  AND obj_description('public.reconcile_image_stages(integer)'::regprocedure) LIKE '%live lane first, backfill oldest-first by cursor%', 'revert: the prior body and comment, no refill_below');
CREATE OR REPLACE FUNCTION public.reconcile_image_stages(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
\ir revert_20261113140000_image_stage_reconciler_refill.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(reconcile_image_stages(100) = '{}'::jsonb AND NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'refill_below'),
  'a drifted body is refused by the migration and by the revert: nothing replaced, nothing set');
\echo image_stage_reconciler_refill contract: ok
