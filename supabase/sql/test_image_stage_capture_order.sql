-- Contract for 20261113160000_image_stage_capture_order.sql, on a fresh disposable database: the backfill queues and
-- hands out photos in the order they were taken (upload time only when a photo carries no capture time), the cursor
-- follows that order and passes no gap, the live lane is unchanged, a replay leaves a pass in progress alone, and the
-- revert restores the two prior bodies.
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
  ai_processing_status text, ai_processing_started_at timestamptz, ai_scan_metadata jsonb, exif_data jsonb, taken_at timestamptz);
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.img(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql
\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
SELECT md5(prosrc) AS rec_prior FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure \gset
SELECT md5(prosrc) AS clm_prior FROM pg_proc WHERE oid = 'public.claim_image_stage_work(text,integer,integer,uuid)'::regprocedure \gset
UPDATE image_stage_reconciler_state SET cursor_created_at = now() - interval '400 days', cursor_id = pg_temp.img(0) WHERE lane = 'backfill';  -- a pass in progress under the old order
\ir ../migrations/20261113160000_image_stage_capture_order.sql
SELECT pg_temp.ok((SELECT config_value ->> 'order' FROM platform_config WHERE config_key = 'image_stage_reconciler') = 'capture_time'
  AND (SELECT cursor_id IS NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'first application: order marked, pass restarted');

-- One library uploaded in one sitting 30 days ago (photo 1 uploaded first), shot over the years in the OPPOSITE order:
-- photo 250 is the earliest taken, photo 1 the latest. Photo 300 was taken in 1999. Photo 301 carries no capture time.
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
SELECT pg_temp.img(g), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/' || g || '.jpg',
       now() - interval '30 days' + g * interval '1 second', timestamptz '2020-01-01' + (251 - g) * interval '1 day', 'completed'
  FROM generate_series(1, 250) g;
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status) VALUES
  (pg_temp.img(300), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/300.jpg', now() - interval '30 days', '1999-06-01', 'completed'),
  (pg_temp.img(301), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/301.jpg', now() - interval '29 days', NULL, 'completed');

-- ===== 1. the earliest photos are queued first, whatever order they were uploaded in
CREATE TEMP TABLE t1 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t1) = 100, '100 queued');
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 3)::int ORDER BY right(image_id::text, 3)::int) FROM image_stage_work)
  = (SELECT array_agg(g ORDER BY g) FROM (SELECT generate_series(152, 250) g UNION ALL SELECT 300) x),
  'the 100 earliest taken: the 1999 photo, then photos 250 down to 152 (not photos 1 to 100, the first uploaded)');
SELECT pg_temp.ok((SELECT cursor_id = pg_temp.img(152) AND cursor_created_at = timestamptz '2020-01-01' + 99 * interval '1 day' FROM image_stage_reconciler_state WHERE lane = 'backfill'),
  'the cursor holds the capture time of the last photo queued');

-- ===== 2. the reader is handed the earliest photo first
CREATE TEMP TABLE c1 AS SELECT row_number() OVER () AS n, image_id FROM claim_image_stage_work('classifier', 1, 600, '0b9f107a-d124-49de-9ded-94698f63c1c4');
SELECT pg_temp.ok((SELECT image_id FROM c1) = pg_temp.img(300), 'one at a time: the 1999 photo first');
SELECT record_image_stage_receipt(pg_temp.img(300), 'classifier', 1, 'succeeded');
SELECT pg_temp.ok((SELECT image_id FROM claim_image_stage_work('classifier', 1, 600, '0b9f107a-d124-49de-9ded-94698f63c1c4')) = pg_temp.img(250), 'then the next earliest (photo 250, taken 2020-01-02)');
SELECT record_image_stage_receipt(pg_temp.img(250), 'classifier', 1, 'succeeded');

-- ===== 3. the next refill continues in capture order and passes nothing
CREATE TEMP TABLE t3 AS SELECT reconcile_image_stages(100) AS r;   -- 98 claimable: under the mark of 100
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t3) = 100
  AND (SELECT min(right(image_id::text, 3)::int) FROM image_stage_work WHERE status = 'queued') = 52, 'the next 100 by capture time: photos 151 down to 52');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM vehicle_images v WHERE v.id BETWEEN pg_temp.img(52) AND pg_temp.img(250)
    AND NOT EXISTS (SELECT 1 FROM image_stage_work w WHERE w.image_id = v.id)), 'no photo between the earliest and the cursor is left unqueued');

-- ===== 4. a photo with no capture time takes its place by upload time: after every dated photo here, since it was uploaded 29 days ago
UPDATE image_stage_work SET status = 'done', finished_at = now() WHERE status IN ('queued', 'claimed');
CREATE TEMP TABLE t4 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM t4) = 52 AND EXISTS (SELECT 1 FROM image_stage_work WHERE image_id = pg_temp.img(301) AND status = 'queued'),
  'the last 51 dated photos and the undated one are queued');
SELECT pg_temp.ok((SELECT image_id FROM (SELECT image_id, row_number() OVER () n FROM claim_image_stage_work('classifier', 25, 600, '0b9f107a-d124-49de-9ded-94698f63c1c4')) q ORDER BY n LIMIT 1) = pg_temp.img(51),
  'and the earliest dated one among them is handed out first');

-- ===== 5. what was just shot is still read first (the live lane is unchanged)
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
VALUES (pg_temp.img(900), '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/900.jpg', now() - interval '1 hour', now() - interval '70 minutes', 'pending');
UPDATE image_stage_work SET status = 'queued', lease_until = NULL WHERE status = 'claimed';
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok((SELECT lane FROM image_stage_work WHERE image_id = pg_temp.img(900)) = 'live', 'the new upload is queued in the live lane');
SELECT pg_temp.ok((SELECT image_id FROM claim_image_stage_work('classifier', 1, 600, '0b9f107a-d124-49de-9ded-94698f63c1c4')) = pg_temp.img(900), 'and handed out before the backlog');

-- ===== 6. replay leaves a pass in progress alone
UPDATE image_stage_reconciler_state SET cursor_created_at = timestamptz '2020-03-01', cursor_id = pg_temp.img(190) WHERE lane = 'backfill';
\ir ../migrations/20261113160000_image_stage_capture_order.sql
SELECT pg_temp.ok((SELECT cursor_id FROM image_stage_reconciler_state WHERE lane = 'backfill') = pg_temp.img(190), 'replay: the cursor is kept');

-- ===== 7. revert restores both prior bodies and restarts the pass; unknown bodies are refused both ways
\ir revert_20261113160000_image_stage_capture_order.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure) = :'rec_prior'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.claim_image_stage_work(text,integer,integer,uuid)'::regprocedure) = :'clm_prior'
  AND NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'order')
  AND (SELECT cursor_id IS NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'revert: prior bodies, no order marker, pass restarted');
CREATE OR REPLACE FUNCTION public.reconcile_image_stages(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261113160000_image_stage_capture_order.sql
\ir revert_20261113160000_image_stage_capture_order.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(reconcile_image_stages(100) = '{}'::jsonb AND NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'order'),
  'a drifted body is refused by the migration and by the revert');
\echo image_stage_capture_order contract: ok
