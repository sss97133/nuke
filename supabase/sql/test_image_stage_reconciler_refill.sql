-- Contract for 20261113140000_image_stage_reconciler_refill.sql, on a fresh disposable database: with refill_below set,
-- a tick scans only when the queue has run down; a skipped tick still stamps last_run_at; without the key the function
-- behaves as 20261113110000 defined it; the revert restores that body.
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
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
SELECT pg_temp.ok((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler')
  @> '{"enabled": true, "refill_below": 100, "max_open": 300, "scan_per_lane": 200}', 'refill_below is set; the other settings are kept');

-- 250 never-read photos of the named user, old enough to be work
INSERT INTO vehicle_images (id, user_id, image_url, created_at, ai_processing_status)
SELECT pg_temp.img(g), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/' || g || '.jpg', now() - interval '30 days' + g * interval '1 minute', 'completed'
  FROM generate_series(1, 250) g;

-- an empty queue is below the mark: the tick scans 200 candidates, finds 200 gaps and has room for 100
CREATE TEMP TABLE t1 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t1) = 100 AND (SELECT count(*) FROM image_stage_work) = 100
  AND (SELECT (r #>> '{backfill,scanned}')::int FROM t1) = 200, 'empty queue: 200 scanned, 100 queued');
-- the oldest 100 were queued, and the cursor stopped at the last of them, not at the 200th scanned
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 3)::int ORDER BY image_id) FROM image_stage_work) = (SELECT array_agg(g) FROM generate_series(1, 100) g), 'oldest first: photos 1 to 100');
SELECT pg_temp.ok((SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(100), 'the cursor stops at the last photo queued');
-- 100 open is at the mark: the next tick does not scan, says why, and still stamps last_run_at
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
CREATE TEMP TABLE t2 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT r FROM t2) = '{"skipped": "queue_ok", "open": 100}'::jsonb AND (SELECT count(*) FROM image_stage_work) = 100, 'at the mark: skipped as queue_ok, nothing scanned or queued');
SELECT pg_temp.ok((SELECT bool_and(last_run_at > now() - interval '1 minute') FROM image_stage_reconciler_state), 'a skipped tick stamps last_run_at on both lanes');
SELECT pg_temp.ok((SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(100), 'and leaves the cursor alone');
-- the reader takes 20 and reads them: 80 open is below the mark, so the next tick refills with the next oldest
SELECT count(record_image_stage_receipt(c.image_id, 'classifier', 1, 'succeeded')) FROM claim_image_stage_work('classifier', 20, 900, '0b9f107a-d124-49de-9ded-94698f63c1c4') c;
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status IN ('queued', 'claimed')) = 80, '20 read: 80 open');
CREATE TEMP TABLE t3 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t3) = 100 AND (SELECT count(*) FROM image_stage_work WHERE status IN ('queued', 'claimed')) = 180, 'below the mark: refilled by 100 to 180 open');
SELECT pg_temp.ok((SELECT max(right(image_id::text, 3)::int) FROM image_stage_work) = 200 AND (SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(200),
  'the photos the first scan had no room for (101 to 200) are queued next, none passed over');
-- when every gap found is queued the cursor passes everything scanned, as before (the last 50 photos, room for 100)
UPDATE image_stage_work SET status = 'done', finished_at = now() WHERE status IN ('queued', 'claimed');
CREATE TEMP TABLE t4 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t4) = 50 AND (SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(250), 'all gaps queued: the cursor reaches the last photo scanned');
UPDATE image_stage_work SET status = 'queued', finished_at = NULL WHERE image_id BETWEEN pg_temp.img(71) AND pg_temp.img(200);  -- 130 + 50 = 180 open again
-- an item queued earlier and lying further along does not pull the cursor past gaps this run had no room for:
-- restart the pass with photos 150 to 200 already open and everything else unread and unqueued
DELETE FROM image_stage_work WHERE image_id NOT BETWEEN pg_temp.img(150) AND pg_temp.img(200);
SET session_replication_role = replica;
DELETE FROM image_stage_receipts;
SET session_replication_role = DEFAULT;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
UPDATE platform_config SET config_value = config_value || '{"refill_below": 1000}' WHERE config_key = 'image_stage_reconciler';
CREATE TEMP TABLE t5 AS SELECT reconcile_image_stages(100) AS r;  -- scans photos 1 to 200: 149 gaps (1 to 149), room for 100
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t5) = 100
  AND (SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(100),
  'the cursor stops at the last photo this run queued (100), not at the open item furthest along (200)');
CREATE TEMP TABLE t6 AS SELECT reconcile_image_stages(100) AS r;  -- photos 101 to 149 are next, then 201 to 250
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status = 'queued' AND image_id BETWEEN pg_temp.img(101) AND pg_temp.img(149)) = 49, 'photos 101 to 149 are queued by the next run');
UPDATE platform_config SET config_value = config_value || '{"refill_below": 100}' WHERE config_key = 'image_stage_reconciler';

-- the hard cap still holds and is named as such, with last_run_at stamped
UPDATE platform_config SET config_value = config_value || '{"max_open": 150}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
SELECT pg_temp.ok(reconcile_image_stages(100) ->> 'skipped' = 'queue_full', 'over max_open: queue_full');
SELECT pg_temp.ok((SELECT bool_and(last_run_at > now() - interval '1 minute') FROM image_stage_reconciler_state), 'a full queue stamps last_run_at too');
-- p_limit 0 and a disabled switch are unchanged
SELECT pg_temp.ok(reconcile_image_stages(0) ->> 'skipped' = 'queue_full', 'p_limit 0 enqueues nothing');
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(reconcile_image_stages(100) ->> 'skipped' = 'disabled', 'switched off: disabled');
-- without the key the function tops up on every tick, as before
UPDATE platform_config SET config_value = (config_value - 'refill_below') || '{"enabled": true, "max_open": 300}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(NOT (reconcile_image_stages(30) ? 'skipped'), 'no refill_below: 180 open, room under max_open, so the tick scans instead of skipping');
-- replay keeps one definition and the setting; a drifted body is refused
UPDATE platform_config SET config_value = config_value || '{"refill_below": 60}' WHERE config_key = 'image_stage_reconciler';
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
SELECT pg_temp.ok((SELECT config_value ->> 'refill_below' FROM platform_config WHERE config_key = 'image_stage_reconciler') = '100'
  AND (SELECT cursor_id IS NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'replay sets the mark again and restarts the pass');
\ir revert_20261113140000_image_stage_reconciler_refill.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure) = :'prior'
  AND NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'refill_below'), 'revert: the prior body, no refill_below');
CREATE OR REPLACE FUNCTION public.reconcile_image_stages(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(reconcile_image_stages(100) = '{}'::jsonb AND NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'refill_below'),
  'a drifted body is refused: nothing replaced, nothing set');
\echo image_stage_reconciler_refill contract: ok
