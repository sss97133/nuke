-- Contract for 20261113130000_image_stage_reconciler_first_pass.sql, on a fresh disposable database: after the ledger
-- (20261113110000), the switch is on for one user, and the first pass queues only that user's photos that hold no
-- reading at all. A photo with an older finished reading waits for the second pass. The revert switches it off.
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
CREATE FUNCTION pg_temp.raises(stmt text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE stmt; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- without the ledger the file refuses and changes nothing
\set ON_ERROR_STOP off
\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok((SELECT count(*) FROM platform_config) = 0, 'no ledger: refused, nothing written');

\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql
SELECT pg_temp.ok((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') @> '{"enabled": false, "user_ids": []}', 'the ledger ships off and names nobody');

-- the owner's photos and another user's, an hour old
INSERT INTO vehicle_images (id, user_id, image_url, created_at, ai_processing_status, ai_scan_metadata) VALUES
  ('00000000-0000-4000-8000-000000000001', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/1.jpg', now() - interval '1 hour', 'completed', NULL),  -- never read
  ('00000000-0000-4000-8000-000000000002', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/2.jpg', now() - interval '1 hour', 'completed',
     '{"pipeline_version":"v2","classification":{"image_type":"other","confidence":0.2}}'),                                                                    -- an older finished reading
  ('00000000-0000-4000-8000-000000000003', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/3.jpg', now() - interval '1 hour', 'completed',
     '{"pipeline_version":"v2","classification":{"image_type":"engine_bay","confidence":0.9,"classifier_ok":true,"v2":{"prompt_version":"v98"}}}'),            -- a current reading
  ('00000000-0000-4000-8000-000000000004', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/4.jpg', now() - interval '1 hour', 'failed',
     '{"pipeline_version":"v2","classification":{"image_type":"other","confidence":0.2,"classifier_ok":false}}'),                                              -- a failed stand-in: not a reading
  ('00000000-0000-4000-8000-000000000005', '0b9f107a-d124-49de-9ded-94698f63c1c4', 'https://example.test/5.jpg', now() - interval '1 hour', 'completed', NULL),
  ('00000000-0000-4000-8000-000000000006', '0b9f107a-d124-49de-9ded-94698f63c1c4', '',                           now() - interval '1 hour', 'skipped', NULL),   -- pixels still on the phone
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000bb', 'https://example.test/7.jpg', now() - interval '1 hour', 'completed', NULL); -- someone else's
UPDATE vehicle_images SET is_sensitive = true WHERE id = '00000000-0000-4000-8000-000000000005';

\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
SELECT pg_temp.ok((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler')
  @> '{"enabled": true, "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"], "max_open": 300, "scan_per_lane": 200, "backfill_share": 0.5}', 'on, for one user, a smaller scan, the other settings kept');
SELECT pg_temp.ok((SELECT contract IS NULL FROM image_pipeline_stages WHERE stage = 'classifier'), 'first pass: any finished reading stands in');

SELECT reconcile_image_stages(100);
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 1) ORDER BY image_id) FROM image_stage_work WHERE status = 'queued') = ARRAY['1', '4'],
  'queued: the never-read photo and the failed stand-in; not the older reading, the current reading, the sensitive photo, the phone-only row or another user''s photo');
-- the paid drain starts on photo 4 after it was queued: the claim leaves it queued instead of reading it twice
UPDATE vehicle_images SET ai_processing_status = 'processing', ai_processing_started_at = now() - interval '2 minutes' WHERE id = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 1)) FROM claim_image_stage_work('classifier', 20, 900, '0b9f107a-d124-49de-9ded-94698f63c1c4')) = ARRAY['1'],
  'a photo with a run in flight is not handed out');
SELECT pg_temp.ok((SELECT status FROM image_stage_work WHERE image_id = '00000000-0000-4000-8000-000000000004') = 'queued', 'and its item stays queued, not dropped');
-- the run died half an hour ago without finishing: the item is handed out
UPDATE vehicle_images SET ai_processing_started_at = now() - interval '45 minutes' WHERE id = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.ok((SELECT array_agg(right(image_id::text, 1)) FROM claim_image_stage_work('classifier', 20, 900, '0b9f107a-d124-49de-9ded-94698f63c1c4')) = ARRAY['4'],
  'a run that went stale no longer holds the photo');
SELECT record_image_stage_receipt('00000000-0000-4000-8000-000000000001', 'classifier', 1, 'succeeded');
SELECT pg_temp.ok((image_stage_coverage() #>> '{stages,classifier,current_receipt_by_outcome,succeeded}')::int = 1
  AND (image_stage_coverage() #>> '{stages,classifier,open,claimed}')::int = 1, 'coverage shows one read and one in hand');

-- replay keeps it on; the second pass is a later, separate decision
\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
SELECT pg_temp.ok((SELECT (config_value ->> 'enabled')::boolean FROM platform_config WHERE config_key = 'image_stage_reconciler')
  AND (SELECT contract IS NULL FROM image_pipeline_stages WHERE stage = 'classifier'), 'replay: still on, still first pass');

\ir revert_20261113130000_image_stage_reconciler_first_pass.sql
SELECT pg_temp.ok((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') @> '{"enabled": false, "user_ids": []}'
  AND (SELECT contract FROM image_pipeline_stages WHERE stage = 'classifier') = 'v98'
  AND (SELECT count(*) FROM image_stage_receipts) = 1
  AND (SELECT config_value ->> 'scan_per_lane' FROM platform_config WHERE config_key = 'image_stage_reconciler') = '1000'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.claim_image_stage_work(text,integer,integer,uuid)'::regprocedure) = 'bddcc4c3061ef09e3f6a5fa7661aa12c'
  AND reconcile_image_stages(100) ->> 'skipped' = 'disabled', 'revert: off, nobody named, the receipt kept, the prior claim body and scan size, the reconciler a no-op');
-- a drifted claim body is refused, and nothing is switched on
CREATE OR REPLACE FUNCTION public.claim_image_stage_work(p_stage text, p_limit integer DEFAULT 8, p_lease_seconds integer DEFAULT 300, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
LANGUAGE sql AS $$ SELECT NULL::bigint, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer WHERE false $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok((SELECT (config_value ->> 'enabled')::boolean FROM platform_config WHERE config_key = 'image_stage_reconciler') IS FALSE, 'a claim body that drifted: refused, still off');
\echo image_stage_reconciler_first_pass contract: ok
