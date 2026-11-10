-- Contract for 20261113110000_image_stage_receipts_reconciler.sql, run against a fresh disposable database.
-- Fixture = only the tables/roles the migration reads; the migration itself is replayed with \ir.
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
CREATE TABLE public.photo_pipeline_provider_state (provider text PRIMARY KEY, blocked_until timestamptz);
INSERT INTO public.photo_pipeline_provider_state VALUES ('classifier', NULL);
CREATE TABLE public.photo_pipeline_retry_state (image_id uuid PRIMARY KEY, terminal boolean NOT NULL DEFAULT false, next_attempt_at timestamptz);

\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql

CREATE FUNCTION pg_temp.img(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
-- expects the statement to raise the given SQLSTATE
CREATE FUNCTION pg_temp.raises(stmt text, state text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAILED: % (no error raised)', msg;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = 'P0001' AND SQLERRM LIKE 'FAILED:%' THEN RAISE; END IF;
  IF SQLSTATE <> state THEN RAISE EXCEPTION 'FAILED: % (got % %)', msg, SQLSTATE, SQLERRM; END IF;
END $$;
CREATE FUNCTION pg_temp.mk(n int, age interval, meta jsonb DEFAULT NULL, status text DEFAULT NULL,
                           dup boolean DEFAULT NULL, sens boolean DEFAULT NULL, ext boolean DEFAULT NULL) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (id, user_id, image_url, created_at, is_duplicate, is_sensitive, is_external, ai_processing_status, ai_scan_metadata)
  VALUES (pg_temp.img(n), gen_random_uuid(), 'https://example.test/' || n || '.jpg', now() - age, dup, sens, ext, status, meta)
  RETURNING id $$;

-- ===== 1. registry, defaults, grants
SELECT pg_temp.ok((SELECT required FROM image_pipeline_stages WHERE stage = 'classifier'), 'classifier is the required stage');
SELECT pg_temp.ok((SELECT count(*) FROM image_pipeline_stages WHERE required) = 1, 'only classifier is required at start');
SELECT pg_temp.ok((SELECT (config_value ->> 'enabled')::boolean FROM platform_config WHERE config_key = 'image_stage_reconciler') IS FALSE, 'flag defaults off');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.reconcile_image_stages(integer)', 'execute'), 'anon cannot reconcile');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)', 'execute'), 'authenticated cannot record');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.claim_image_stage_work(text,integer,integer,uuid)', 'execute'), 'authenticated cannot claim');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.reconcile_image_stages(integer)', 'execute'), 'service_role can reconcile');
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.image_stage_receipts', 'select'), 'anon cannot read receipts');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.image_stage_work', 'insert'), 'authenticated cannot write work');
SELECT pg_temp.ok(has_table_privilege('service_role', 'public.image_stage_receipts', 'select'), 'service_role reads receipts');

-- The migration seeds the classifier contract (v98). Sections 2-9 exercise the reconciler with the contract cleared, where
-- any finished legacy output stands in for a receipt (the rule this suite was written for); section 10 sets it back.
SELECT pg_temp.ok((SELECT contract FROM image_pipeline_stages WHERE stage = 'classifier') = 'v98', 'classifier contract is seeded');
UPDATE image_pipeline_stages SET contract = NULL WHERE stage = 'classifier';

-- ===== 2. image fixture
SELECT pg_temp.mk(1,  interval '1 hour');                                                         -- live, missing
SELECT pg_temp.mk(2,  interval '1 hour');                                                         -- live, gets succeeded
SELECT pg_temp.mk(3,  interval '1 hour', '{"classification":{"classifier_ok":true}}');            -- live, legacy evidence
SELECT pg_temp.mk(4,  interval '1 hour');                                                         -- live, rate_limited, retry in future
SELECT pg_temp.mk(5,  interval '1 hour');                                                         -- live, unavailable, due
SELECT pg_temp.mk(6,  interval '1 hour');                                                         -- live, policy_skip
SELECT pg_temp.mk(7,  interval '1 hour', sens => true);                                           -- sensitive
SELECT pg_temp.mk(8,  interval '1 hour', dup => true);                                            -- duplicate
SELECT pg_temp.mk(9,  interval '1 hour', status => 'processing');                                 -- a run is in flight on it
SELECT pg_temp.mk(10, interval '1 hour', ext => true);                                            -- external
SELECT pg_temp.mk(11, interval '1 hour');                                                         -- live, failed (typed, not blindly retried)
SELECT pg_temp.mk(12, interval '1 hour', status => 'processing');                                 -- in flight, and holding a paid-drain retry row
SELECT pg_temp.mk(13, interval '1 hour');                                                         -- live, blocked_input
SELECT pg_temp.mk(14, interval '10 days');                                                        -- backfill, missing
SELECT pg_temp.mk(16, interval '1 hour', '{"pipeline_version":"v2","classification":{"image_type":"exterior","confidence":0.91,"description":"x","is_automotive":true}}');  -- legacy shape C, v2
SELECT pg_temp.mk(17, interval '1 hour', '{"pipeline_version":"v1","classification":{"image_type":"engine_bay","confidence":0.5}}');   -- legacy shape C, v1
SELECT pg_temp.mk(18, interval '1 hour', '{"photo_pipeline":{"receipt":{"outcome":"completed"}}}');                                    -- shape B
SELECT pg_temp.mk(15, interval '5 minutes');                                                      -- too new: inside min_age grace
INSERT INTO photo_pipeline_retry_state VALUES (pg_temp.img(12), false, now() + interval '1 hour');
UPDATE vehicle_images SET ai_processing_started_at = now() - interval '5 minutes' WHERE id IN (pg_temp.img(9), pg_temp.img(12));

-- ===== 3. receipt constraints (direct inserts hit the table's own CHECK/UNIQUE)
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class) VALUES (%L,'classifier','p',1,'weird','x')$q$, pg_temp.img(1)), '23514', 'outcome vocabulary is closed');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (%L,'classifier','p',1,'failed')$q$, pg_temp.img(1)), '23514', 'failed needs an error_class');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (%L,'classifier','p',1,'unavailable')$q$, pg_temp.img(1)), '23514', 'unavailable needs an error_class');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, retry_after) VALUES (%L,'classifier','p',1,'succeeded',now())$q$, pg_temp.img(1)), '23514', 'retry_after only on retryable outcomes');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail) VALUES (%L,'classifier','p',1,'succeeded','[]')$q$, pg_temp.img(1)), '23514', 'detail must be an object');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (%L,'classifier','p',0,'succeeded')$q$, pg_temp.img(1)), '23514', 'version >= 1');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (%L,'nope','p',1,'succeeded')$q$, pg_temp.img(1)), '23503', 'stage must be registered');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (%L,'classifier','p',1,'succeeded')$q$, gen_random_uuid()), '23503', 'image must exist');
SELECT pg_temp.raises($q$SELECT record_image_stage_receipt(gen_random_uuid(), 'nope', 1, 'succeeded')$q$, 'P0001', 'writer refuses an unknown stage');

-- ===== 4. record_image_stage_receipt: attempts, retry_after, closing work
SELECT record_image_stage_receipt(pg_temp.img(2), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(4), 'classifier', 1, 'rate_limited', 'classifier_rate_limited', 429, 3600);
SELECT record_image_stage_receipt(pg_temp.img(5), 'classifier', 1, 'unavailable', 'stage_not_deployed', NULL, 0);
SELECT record_image_stage_receipt(pg_temp.img(6), 'classifier', 1, 'policy_skip');
SELECT record_image_stage_receipt(pg_temp.img(11), 'classifier', 1, 'failed', 'image_download_error');
SELECT record_image_stage_receipt(pg_temp.img(13), 'classifier', 1, 'blocked_input', 'image_unreadable', NULL, NULL, md5('https://example.test/13.jpg'));
SELECT pg_temp.ok((SELECT retry_after > now() + interval '55 minutes' FROM image_stage_receipts WHERE image_id = pg_temp.img(4)), 'rate_limited retry_after = now + requested seconds');
SELECT pg_temp.ok((SELECT retry_after IS NULL FROM image_stage_receipts WHERE image_id = pg_temp.img(2)), 'succeeded carries no retry_after');
SELECT pg_temp.ok((SELECT retry_after IS NULL FROM image_stage_receipts WHERE image_id = pg_temp.img(13)), 'blocked_input carries no retry_after');
SELECT pg_temp.ok((SELECT producer = 'photo-pipeline-orchestrator' FROM image_stage_receipts WHERE image_id = pg_temp.img(2)), 'producer comes from the registry');
SELECT record_image_stage_receipt(pg_temp.img(4), 'classifier', 1, 'rate_limited', 'classifier_rate_limited', 429, 99999999);
SELECT pg_temp.ok((SELECT array_agg(attempt ORDER BY attempt) FROM image_stage_receipts WHERE image_id = pg_temp.img(4)) = ARRAY[1,2], 'attempts increment per (image, stage, version); history kept');
SELECT pg_temp.ok((SELECT retry_after < now() + interval '25 hours' FROM image_stage_receipts WHERE image_id = pg_temp.img(4) AND attempt = 2), 'retry delay is capped at 24h');
SELECT pg_temp.ok((SELECT attempt = 2 FROM image_stage_current WHERE image_id = pg_temp.img(4) AND stage = 'classifier'), 'current view returns the newest attempt');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt) VALUES (%L,'classifier','p',1,'succeeded',1)$q$, pg_temp.img(2)), '23505', 'one row per (image, stage, version, attempt)');
-- a newer producer version is a new row beside the old one
SELECT record_image_stage_receipt(pg_temp.img(6), 'classifier', 2, 'succeeded');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM image_stage_receipts WHERE image_id = pg_temp.img(6)), 'new version appends, never overwrites');
SELECT pg_temp.ok((SELECT producer_version = 2 FROM image_stage_current WHERE image_id = pg_temp.img(6)), 'current view prefers the higher version');
DELETE FROM image_stage_receipts WHERE image_id = pg_temp.img(6) AND producer_version = 2;  -- fixture reset only, so image 6 is policy_skip again

-- ===== 5. gap finder (pure read)
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(1)])) = 'missing', 'no receipt => missing');
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(5)])) = 'retryable_outcome', 'unavailable past retry_after => retryable');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(4)])), 'rate_limited before retry_after is not a gap');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(2), pg_temp.img(3), pg_temp.img(6), pg_temp.img(11), pg_temp.img(13)])), 'succeeded, legacy evidence, policy_skip, failed, blocked_input are not gaps');
-- legacy shapes (live sample 2026-11-07): shapes A/B/C satisfy the stage; incomplete shapes stay gaps
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(16), pg_temp.img(17), pg_temp.img(18)])), 'legacy v2 / v1 classification and orchestrator receipt are not gaps');
SELECT pg_temp.ok(NOT image_stage_legacy_evidence('classifier', m, NULL), 'incomplete legacy shape is not evidence: ' || m::text)
  FROM unnest(ARRAY[
    '{"classification":{"image_type":"exterior","confidence":0.9}}',
    '{"pipeline_version":"v2"}',
    '{"pipeline_version":"v2","classification":{"image_type":"","confidence":0.9}}',
    '{"pipeline_version":"v2","classification":{"image_type":"exterior","confidence":"high"}}',
    '{"pipeline_version":"v2","classification":"exterior"}',
    '{"pipeline_version":"","classification":{"image_type":"exterior","confidence":0.9}}',
    '{}']::jsonb[]) AS m;
SELECT pg_temp.ok(image_stage_legacy_version('classifier', (SELECT ai_scan_metadata FROM vehicle_images WHERE id = pg_temp.img(16))) = 'legacy-v2', 'legacy producer version v2 recorded');
SELECT pg_temp.ok(image_stage_legacy_version('classifier', (SELECT ai_scan_metadata FROM vehicle_images WHERE id = pg_temp.img(17))) = 'legacy-v1', 'legacy producer version v1 recorded');
SELECT pg_temp.ok(image_stage_legacy_version('classifier', (SELECT ai_scan_metadata FROM vehicle_images WHERE id = pg_temp.img(3))) = 'orchestrator-receipt', 'classifier_ok is the orchestrator shape');
-- outdated: bump the registry version, nothing is blanket-updated
UPDATE image_pipeline_stages SET required_version = 2 WHERE stage = 'classifier';
SELECT pg_temp.ok((SELECT reason || target_version FROM image_stage_gaps(ARRAY[pg_temp.img(2)])) = 'outdated2', 'v1 receipt under required v2 => outdated');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(3), pg_temp.img(16), pg_temp.img(17)])), 'legacy evidence (incl. v1) satisfies an outdated stage');
SELECT record_image_stage_receipt(pg_temp.img(2), 'classifier', 2, 'succeeded');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(2)])), 'a v2 receipt clears the outdated gap');
UPDATE image_pipeline_stages SET required_version = 1 WHERE stage = 'classifier';
-- attempts budget: a due retryable receipt at max_attempts is no longer retried
UPDATE image_pipeline_stages SET max_attempts = 1 WHERE stage = 'classifier';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(5)])), 'attempt >= max_attempts stops retrying');
UPDATE image_pipeline_stages SET max_attempts = 6 WHERE stage = 'classifier';

-- ===== 6. reconciler: disabled by default
SELECT pg_temp.ok(reconcile_image_stages(100) ->> 'skipped' = 'disabled', 'flag off => no-op');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work) = 0, 'disabled run enqueues nothing');

-- ===== 7. reconciler enabled: only the real gaps, only eligible images
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_reconciler';
CREATE TEMP TABLE run1 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM run1) = 3, 'enqueued exactly the 3 gaps (missing live, retryable live, missing backfill)');
SELECT pg_temp.ok((SELECT array_agg(image_id ORDER BY image_id) FROM image_stage_work) = ARRAY[pg_temp.img(1), pg_temp.img(5), pg_temp.img(14)], 'work rows are images 1, 5, 14');
SELECT pg_temp.ok((SELECT reason FROM image_stage_work WHERE image_id = pg_temp.img(1)) = 'missing', 'image 1 reason missing');
SELECT pg_temp.ok((SELECT reason FROM image_stage_work WHERE image_id = pg_temp.img(5)) = 'retryable_outcome', 'image 5 reason retryable_outcome');
SELECT pg_temp.ok((SELECT lane FROM image_stage_work WHERE image_id = pg_temp.img(1)) = 'live' AND (SELECT lane FROM image_stage_work WHERE image_id = pg_temp.img(14)) = 'backfill', 'lanes assigned by age');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_work WHERE image_id IN (pg_temp.img(7), pg_temp.img(8), pg_temp.img(9), pg_temp.img(10), pg_temp.img(15))),
  'sensitive, duplicate, in-flight, external and too-new images are skipped');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_work WHERE image_id = pg_temp.img(12)), 'a row with a run in flight is left alone');
SELECT pg_temp.ok((SELECT count(*) FROM vehicle_images WHERE ai_processing_status IS DISTINCT FROM CASE WHEN id IN (pg_temp.img(9), pg_temp.img(12)) THEN 'processing' END) = 0, 'reconciler never writes ai_processing_status');
-- idempotent
CREATE TEMP TABLE run2 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM run2) = 0, 'second run enqueues nothing');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work) = 3, 'still one open item per (image, stage)');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane) VALUES (%L,'classifier',1,'missing','live')$q$, pg_temp.img(1)), '23505', 'unique open item per (image, stage)');
SELECT pg_temp.raises(format($q$INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane) VALUES (%L,'classifier',1,'because','live')$q$, pg_temp.img(2)), '23514', 'work reason vocabulary closed');

-- ===== 8. claim / release
-- the paid provider's breaker is not this queue's business (section 13 claims through a blocked breaker)
SELECT pg_temp.ok(NOT (reconcile_image_stages(100) ? 'classifier_blocked'), 'the reconciler does not consult the provider breaker');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('engine_bay', 8)) = 0, 'claim is per stage');
CREATE TEMP TABLE claimed AS SELECT * FROM claim_image_stage_work('classifier', 1);
SELECT pg_temp.ok((SELECT count(*) FROM claimed) = 1, 'limit respected');
SELECT pg_temp.ok((SELECT lane FROM claimed) = 'live', 'live lane is first in the interleave');
INSERT INTO claimed SELECT * FROM claim_image_stage_work('classifier', 8);
SELECT pg_temp.ok((SELECT count(*) FROM claimed) = 3 AND (SELECT count(DISTINCT work_id) FROM claimed) = 3, 'all three items claimed once');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 8)) = 0, 'claimed items are not handed out twice');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status = 'claimed' AND lease_until > now()) = 3, 'claims carry a lease');
SELECT pg_temp.ok((SELECT count(*) FROM claimed WHERE image_url IS NOT NULL AND user_id IS NOT NULL) = 3, 'claim returns the image row fields');
-- a claimed item blocks a duplicate enqueue
SELECT pg_temp.ok((reconcile_image_stages(100) ->> 'enqueued')::int = 0, 'claimed items count as open: no re-enqueue');
-- crash recovery
UPDATE image_stage_work SET lease_until = now() - interval '1 minute' WHERE image_id = pg_temp.img(1);
SELECT pg_temp.ok(release_expired_image_stage_work() = 1, 'only the expired lease is released');
SELECT pg_temp.ok((SELECT status FROM image_stage_work WHERE image_id = pg_temp.img(1)) = 'queued', 'released item is queued again');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 8)) = 1, 'released item can be claimed again');
-- not_before is honoured
UPDATE image_stage_work SET status = 'queued', lease_until = NULL, not_before = now() + interval '1 hour' WHERE image_id = pg_temp.img(1);
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 8)) = 0, 'not_before in the future is not claimable');
-- a receipt closes the open work item
SELECT record_image_stage_receipt(pg_temp.img(1), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(5), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(14), 'classifier', 1, 'succeeded');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status IN ('queued','claimed')) = 0, 'receipts close the work');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status = 'done' AND finished_at IS NOT NULL AND lease_until IS NULL) = 3, 'closed items are done with finished_at');
-- once closed, the same image can be queued again for a later gap (partial unique index)
SELECT pg_temp.ok((reconcile_image_stages(100) ->> 'enqueued')::int = 0, 'no gaps remain after the receipts');

-- ===== 9. fairness budget, queue cap
DELETE FROM image_stage_work;  -- fixture reset
SELECT pg_temp.mk(100 + g, interval '1 hour' + g * interval '1 minute') FROM generate_series(1, 6) g;   -- six live gaps
SELECT pg_temp.mk(200 + g, interval '5 days' + g * interval '1 minute') FROM generate_series(1, 6) g;   -- six older gaps
-- a new pass: the backfill lane walks everything past the grace period oldest first, so it reaches the older six first
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
CREATE TEMP TABLE run3 AS SELECT reconcile_image_stages(4) AS r;
SELECT pg_temp.ok((SELECT (r ->> 'enqueued')::int FROM run3) = 4, 'p_limit bounds the run');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE lane = 'live') = 2 AND (SELECT count(*) FROM image_stage_work WHERE lane = 'backfill') = 2,
  'budget 4 at backfill_share 0.5 => 2 live + 2 backfill; neither lane starves the other');
SELECT pg_temp.ok((SELECT bool_and(i.created_at > now() - interval '2 hours') FROM image_stage_work w JOIN vehicle_images i ON i.id = w.image_id WHERE w.lane = 'live'), 'live lane takes newest uploads');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work w JOIN vehicle_images i ON i.id = w.image_id WHERE w.lane = 'backfill' AND i.id IN (SELECT pg_temp.img(200 + g) FROM generate_series(1, 6) g)) = 2, 'backfill lane draws from the older population');
SELECT pg_temp.ok((SELECT cursor_created_at IS NOT NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'backfill cursor advanced');
-- cap on open items
UPDATE platform_config SET config_value = config_value || '{"max_open": 4}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(reconcile_image_stages(100) ->> 'skipped' = 'queue_full', 'max_open stops the run');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work) = 4, 'nothing added when full');
-- limit 0 / negative are no-ops, upper bound 500
UPDATE platform_config SET config_value = config_value || '{"max_open": 300}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(reconcile_image_stages(0) ->> 'skipped' = 'queue_full', 'p_limit 0 enqueues nothing');
-- unused live budget rolls to the backfill: close the remaining live gaps, then only backfill work remains
DELETE FROM image_stage_work;
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome)
  SELECT id, 'classifier', 'photo-pipeline-orchestrator', 1, 'succeeded' FROM vehicle_images WHERE id IN (SELECT pg_temp.img(100 + g) FROM generate_series(1, 6) g);
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
CREATE TEMP TABLE run4 AS SELECT reconcile_image_stages(4) AS r;
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE lane = 'backfill') = 4 AND (SELECT count(*) FROM image_stage_work WHERE lane = 'live') = 0, 'live budget unused => rolls to backfill (4 backfill)');

-- ===== 10. the classifier contract: only a reading under the current contract stands in for a receipt
UPDATE image_pipeline_stages SET contract = 'v98' WHERE stage = 'classifier';
DELETE FROM image_stage_work;
SELECT pg_temp.mk(301, interval '1 hour', '{"pipeline_version":"v2","classification":{"image_type":"vehicle_exterior","confidence":0.93,"classifier_ok":true,"v2":{"prompt_version":"v98","vehicle_fields":[]}}}');  -- current reading
SELECT pg_temp.mk(302, interval '1 hour', '{"pipeline_version":"v2","classification":{"image_type":"other","confidence":0.2}}');                                   -- legacy shape C, no v2 block
SELECT pg_temp.mk(303, interval '1 hour', '{"pipeline_version":"v2","classification":{"image_type":"engine_bay","confidence":0.9,"classifier_ok":true}}');             -- answered by the thin legacy prompt
SELECT pg_temp.mk(304, interval '1 hour', '{"pipeline_version":"v2","classification":{"image_type":"other","confidence":0.2,"classifier_ok":false,"v2":{"prompt_version":"v98"}}}');  -- failed stand-in
SELECT pg_temp.mk(305, interval '1 hour', '{"appraiser":{"condition":7},"byok_deep_analysis":{"scene_type":"shop"}}');                                           -- other generations only
SELECT pg_temp.mk(306, interval '1 hour', '{"pipeline_version":"v2","classification":{"image_type":"vin_plate","confidence":0.95,"classifier_ok":true,"v2":{"prompt_version":"v97"}}}');  -- an earlier contract
SELECT pg_temp.ok(image_stage_legacy_evidence('classifier', (SELECT ai_scan_metadata FROM vehicle_images WHERE id = pg_temp.img(301)), NULL, 'v98'), 'a reading under the contract is evidence');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(301)])), 'a reading under the contract is not a gap');
SELECT pg_temp.ok((SELECT array_agg(reason ORDER BY image_id) FROM image_stage_gaps(ARRAY[pg_temp.img(302), pg_temp.img(303), pg_temp.img(304), pg_temp.img(306)]))
  = ARRAY['outdated', 'outdated', 'missing', 'outdated'], 'legacy, thin-prompt and earlier-contract readings are outdated gaps; a failed stand-in is not a reading at all');
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(305)])) = 'missing', 'only other generations'' output on the row: the classifier stage is missing');
-- a receipt at the required version settles the image whatever the row holds
SELECT record_image_stage_receipt(pg_temp.img(302), 'classifier', 1, 'succeeded', NULL, NULL, NULL, NULL, '{"reader":"reader:claude-cli sonnet subscription","prompt_version":"v98"}');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(302)])), 'a succeeded receipt closes an outdated gap');
-- the reconciler enqueues the outdated and missing ones, once, with their reasons
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok((SELECT array_agg(w.reason ORDER BY w.image_id) FROM image_stage_work w WHERE w.image_id IN (pg_temp.img(301), pg_temp.img(302), pg_temp.img(303), pg_temp.img(304), pg_temp.img(305), pg_temp.img(306)))
  = ARRAY['outdated', 'missing', 'missing', 'outdated'], 'queued: 303 (outdated), 304 and 305 (missing), 306 (outdated); not 301 (current) or 302 (receipt)');
-- cursor walks candidates, not only eligible rows: a page of ineligible rows still advances it
DELETE FROM image_stage_work;
UPDATE platform_config SET config_value = config_value || '{"scan_per_lane": 3, "live_days": 0, "min_age_minutes": 0}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
UPDATE vehicle_images SET is_sensitive = true WHERE id IN (SELECT id FROM vehicle_images ORDER BY created_at, id LIMIT 3);
CREATE TEMP TABLE run10 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r #>> '{backfill,scanned}')::int FROM run10) = 3 AND (SELECT (r #>> '{backfill,eligible}')::int FROM run10) = 0
  AND (SELECT cursor_created_at IS NOT NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'),
  'three ineligible candidates: scanned 3, eligible 0, cursor moved past them');
CREATE TEMP TABLE run11 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT (r #>> '{backfill,scanned}')::int FROM run11) = 3 AND (SELECT (r #>> '{backfill,eligible}')::int FROM run11) > 0, 'the next run reads the next page');

-- ===== 11. a claim scoped to one user hands out only that user's photos
DELETE FROM image_stage_work;
UPDATE platform_config SET config_value = config_value || '{"scan_per_lane": 1000, "live_days": 2, "min_age_minutes": 15}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
SELECT pg_temp.mk(401, interval '1 hour'); SELECT pg_temp.mk(402, interval '1 hour'); SELECT pg_temp.mk(403, interval '1 hour');
UPDATE vehicle_images SET user_id = '00000000-0000-4000-8000-0000000000aa' WHERE id IN (pg_temp.img(401), pg_temp.img(402));
UPDATE vehicle_images SET user_id = '00000000-0000-4000-8000-0000000000bb' WHERE id = pg_temp.img(403);
SELECT reconcile_image_stages(100);
CREATE TEMP TABLE claim_a AS SELECT * FROM claim_image_stage_work('classifier', 25, 300, '00000000-0000-4000-8000-0000000000aa');
SELECT pg_temp.ok((SELECT array_agg(image_id ORDER BY image_id) FROM claim_a) = ARRAY[pg_temp.img(401), pg_temp.img(402)], 'a user-scoped claim returns only that user''s photos');
SELECT pg_temp.ok((SELECT status FROM image_stage_work WHERE image_id = pg_temp.img(403)) = 'queued', 'another user''s photo stays queued');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 25, 300, '00000000-0000-4000-8000-0000000000cc')) = 0, 'a user with nothing queued gets nothing');

-- ===== 12. coverage reader and revert
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.image_stage_coverage()', 'execute') AND has_function_privilege('service_role', 'public.image_stage_coverage()', 'execute'), 'coverage is service-role only');
CREATE TEMP TABLE cov AS SELECT image_stage_coverage() AS c;
SELECT pg_temp.ok((SELECT (c ->> 'enabled')::boolean FROM cov)
  AND (SELECT (c #>> '{stages,classifier,open,claimed}')::int FROM cov) = 2
  AND (SELECT (c #>> '{stages,classifier,open,queued}')::int FROM cov) >= 1
  AND (SELECT (c #>> '{stages,classifier,current_receipt_by_outcome,succeeded}')::int FROM cov) >= 1
  AND (SELECT c #>> '{stages,classifier,contract}' FROM cov) = 'v98'
  AND (SELECT c #> '{reconciler,backfill}' ? 'last_run_at' FROM cov)
  AND (SELECT (c #>> '{stages,exif,open,queued}')::int FROM cov) = 0,
  'coverage reports open work, current receipts by outcome, the contract and the reconciler position per stage');

-- ===== 13. what the review of 2026-11-10 found, as cases
DELETE FROM image_stage_work;
UPDATE platform_config SET config_value = '{"enabled": true, "live_days": 2, "scan_per_lane": 1000, "max_open": 300, "backfill_share": 0.5, "min_age_minutes": 15}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
UPDATE image_pipeline_stages SET contract = 'v98' WHERE stage = 'classifier';
-- settle everything made so far, so only this section's images are gaps
SELECT count(record_image_stage_receipt(v.id, 'classifier', 1, 'succeeded')) FROM vehicle_images v
 WHERE NOT EXISTS (SELECT 1 FROM image_stage_receipts r WHERE r.image_id = v.id AND r.outcome = 'succeeded');
SELECT pg_temp.mk(501, interval '1 hour', status => 'pending');     -- the paid drain's 'pending' is not a hold
SELECT pg_temp.mk(502, interval '1 hour', status => 'failed');      -- nor is its terminal retry row
SELECT pg_temp.mk(503, interval '1 hour', status => 'processing');  -- a run that died an hour ago
SELECT pg_temp.mk(504, interval '1 hour', status => 'processing');  -- a run in flight
SELECT pg_temp.mk(505, interval '1 hour', '{"pipeline_version":"v2","skipped":"apple_ml_non_automotive","photo_pipeline":{"receipt":{"outcome":"policy_skip"}}}', 'completed');  -- the orchestrator decided not to read it
SELECT pg_temp.mk(506, interval '1 hour', '{"classification":{"classifier_ok":true,"v2":{"prompt_version":"v98"}}}');  -- contract block without image_type
INSERT INTO photo_pipeline_retry_state VALUES (pg_temp.img(502), true, NULL);
UPDATE vehicle_images SET ai_processing_started_at = now() - interval '1 hour' WHERE id = pg_temp.img(503);
UPDATE vehicle_images SET ai_processing_started_at = now() - interval '2 minutes' WHERE id = pg_temp.img(504);
UPDATE vehicle_images SET user_id = '00000000-0000-4000-8000-0000000000aa' WHERE id BETWEEN pg_temp.img(501) AND pg_temp.img(506);
UPDATE photo_pipeline_provider_state SET blocked_until = now() + interval '6 hours' WHERE provider = 'classifier';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(505)])), 'a policy-skipped photo is a finished decision, not a gap');
SELECT pg_temp.ok(image_stage_legacy_evidence('classifier', '{"classification":{"classifier_ok":true,"v2":{"prompt_version":"v98"}}}', NULL, 'v98') IS FALSE, 'evidence is false, never NULL, for a contract block with no image_type');
CREATE TEMP TABLE run13 AS SELECT reconcile_image_stages(100) AS r;
SELECT pg_temp.ok((SELECT array_agg(image_id ORDER BY image_id) FROM image_stage_work WHERE status = 'queued')
  = ARRAY[pg_temp.img(501), pg_temp.img(502), pg_temp.img(503), pg_temp.img(506)],
  'queued through a blocked provider breaker: the pending row, the row with a terminal paid-drain retry, the dead run and the incomplete reading; not the run in flight, not the policy skip');
-- the claim is not gated by the paid provider either
CREATE TEMP TABLE claim13 AS SELECT * FROM claim_image_stage_work('classifier', 25, 900, '00000000-0000-4000-8000-0000000000aa');
SELECT pg_temp.ok((SELECT count(*) FROM claim13) = 4, 'the reader claims while the paid provider is blocked');
UPDATE photo_pipeline_provider_state SET blocked_until = NULL WHERE provider = 'classifier';
-- a photo marked sensitive while it waits is dropped at the claim, never handed out
UPDATE image_stage_work SET status = 'queued', lease_until = NULL WHERE image_id IN (pg_temp.img(501), pg_temp.img(502));
UPDATE vehicle_images SET is_sensitive = true WHERE id = pg_temp.img(501);
UPDATE vehicle_images SET vision_gate_status = 'rejected_personal' WHERE id = pg_temp.img(502);
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 25, 900, '00000000-0000-4000-8000-0000000000aa')) = 0, 'photos that became sensitive or personal while queued are not handed out');
SELECT pg_temp.ok((SELECT array_agg(status ORDER BY image_id) FROM image_stage_work WHERE image_id IN (pg_temp.img(501), pg_temp.img(502))) = ARRAY['dropped', 'dropped'], 'and their items are dropped');
SELECT pg_temp.ok((image_stage_coverage() #>> '{stages,classifier,closed,dropped}')::int = 2, 'coverage counts dropped items');
-- a reader-wide outage must not retire a photo: out of attempts, it is offered again after a day
SELECT record_image_stage_receipt(pg_temp.img(503), 'classifier', 1, 'unavailable', 'reader_exited', NULL, 0);
UPDATE image_pipeline_stages SET max_attempts = 1 WHERE stage = 'classifier';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(503)])), 'out of attempts today: not offered');
SELECT pg_temp.ok((image_stage_coverage() #>> '{stages,classifier,out_of_attempts}')::int >= 1, 'coverage lists images out of attempts');
SET session_replication_role = replica;  -- fixture only: age the receipt (the table is append-only to every role but the owner)
UPDATE image_stage_receipts SET observed_at = now() - interval '25 hours', retry_after = now() - interval '24 hours' WHERE image_id = pg_temp.img(503);
SET session_replication_role = DEFAULT;
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(503)])) = 'retryable_outcome', 'a day later it is offered again');
UPDATE image_pipeline_stages SET max_attempts = 6 WHERE stage = 'classifier';
-- blocked_input comes back when the image URL changes, and only then
SELECT record_image_stage_receipt(pg_temp.img(506), 'classifier', 1, 'blocked_input', 'image_http_error', 404, NULL, md5('https://example.test/506.jpg'));
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(506)])), 'blocked_input with the same URL is not offered');
UPDATE vehicle_images SET image_url = 'https://example.test/506-restored.jpg' WHERE id = pg_temp.img(506);
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(506)])) = 'retryable_outcome', 'a changed URL offers a blocked_input photo again');
SELECT record_image_stage_receipt(pg_temp.img(504), 'classifier', 1, 'blocked_input', 'image_http_error', 404, NULL, NULL);
UPDATE vehicle_images SET image_url = 'https://example.test/504-moved.jpg' WHERE id = pg_temp.img(504);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(504)])), 'a blocked_input receipt with no fingerprint is never re-offered blindly');
-- two workers on one item: a late non-success does not undo a success
SELECT record_image_stage_receipt(pg_temp.img(505), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(505), 'classifier', 1, 'rate_limited', 'reader_usage_limit', NULL, 0);
SELECT pg_temp.ok((SELECT outcome FROM image_stage_current WHERE image_id = pg_temp.img(505) AND stage = 'classifier') = 'succeeded', 'the current receipt stays the success');
-- user scope: with user_ids set, other users' photos are never queued
DELETE FROM image_stage_work;
SELECT pg_temp.mk(601, interval '1 hour'); SELECT pg_temp.mk(602, interval '1 hour');
UPDATE vehicle_images SET user_id = '00000000-0000-4000-8000-0000000000aa' WHERE id = pg_temp.img(601);
UPDATE vehicle_images SET user_id = '00000000-0000-4000-8000-0000000000bb' WHERE id = pg_temp.img(602);
UPDATE platform_config SET config_value = config_value || '{"user_ids": ["00000000-0000-4000-8000-0000000000aa"]}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL WHERE lane = 'backfill';
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM image_stage_work WHERE image_id = pg_temp.img(601)) AND NOT EXISTS (SELECT 1 FROM image_stage_work WHERE image_id = pg_temp.img(602)),
  'only the scoped user''s photo is queued');
-- grants: the service role reads, and writes only through the functions
SELECT pg_temp.ok(has_table_privilege('service_role', 'public.image_stage_receipts', 'select')
  AND NOT has_table_privilege('service_role', 'public.image_stage_receipts', 'insert') AND NOT has_table_privilege('service_role', 'public.image_stage_receipts', 'update')
  AND NOT has_table_privilege('service_role', 'public.image_stage_receipts', 'delete') AND NOT has_table_privilege('service_role', 'public.image_stage_work', 'update')
  AND NOT has_table_privilege('service_role', 'public.image_pipeline_stages', 'update'), 'service_role holds SELECT only on the ledger tables');
SELECT pg_temp.ok((SELECT count(*) FROM cron.job WHERE jobname = 'image-stage-reconciler' AND schedule = '8-59/10 * * * *') = 1, 'one cron job, on an offset 10-minute slot');
SELECT pg_temp.ok((SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.image_stage_receipts'::regclass, 'public.image_stage_work'::regclass) AND contype = 'f' AND confrelid = 'public.vehicle_images'::regclass) = 2, 'both foreign keys to vehicle_images exist');
-- applying the file again changes nothing the owner set
UPDATE image_pipeline_stages SET contract = NULL WHERE stage = 'classifier';
\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql
SELECT pg_temp.ok((SELECT contract FROM image_pipeline_stages WHERE stage = 'classifier') IS NULL AND (SELECT count(*) FROM cron.job WHERE jobname = 'image-stage-reconciler') = 1
  AND (SELECT (config_value ->> 'enabled')::boolean FROM platform_config WHERE config_key = 'image_stage_reconciler'),
  'a replay keeps the owner''s contract, the enabled flag and a single cron job');

-- ===== 14. revert: refuses while receipts exist; removes everything once they are gone
\set ON_ERROR_STOP off
\ir revert_20261113110000_image_stage_receipts_reconciler.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(to_regclass('public.image_stage_receipts') IS NOT NULL AND to_regprocedure('public.image_stage_coverage()') IS NOT NULL
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'image-stage-reconciler') = 1, 'revert refuses while receipts exist: nothing dropped, cron still scheduled');
SET session_replication_role = replica;
DELETE FROM image_stage_receipts;
SET session_replication_role = DEFAULT;
\ir revert_20261113110000_image_stage_receipts_reconciler.sql
SELECT pg_temp.ok((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND (c.relname LIKE 'image_stage%' OR c.relname = 'image_pipeline_stages')) = 0
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE '%image_stage%' OR p.proname = 'reconcile_image_stages')) = 0
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'image_stage_reconciler')
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'image-stage-reconciler') = 0
  AND (SELECT count(*) FROM pg_constraint WHERE confrelid = 'public.vehicle_images'::regclass AND contype = 'f') = 0,
  'revert with no receipts: no table, view, function, config row, cron job or foreign key left');

\echo image_stage_receipts_reconciler contract: ok
