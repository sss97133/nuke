-- Disposable PG17 only. Contract for the image stage queue: attempt cap -> dead, rate-limit cap -> deferred and its automatic
-- retrigger, and unavailable -> available retry. Runs the real migrations 20261112090000, 20261112110000, 20261112120000.
-- (Auto-run by CI db-contracts: scripts/ci/run-db-contracts.sh; each file gets a fresh dm_* database.)
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- pg_cron stand-in: the migrations only register jobs.
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(job text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

-- Live shapes (the columns the queue reads).
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, image_url text, created_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean DEFAULT false, is_sensitive boolean, is_external boolean, is_superseded boolean, vision_gate_status text,
  ai_processing_status text, ai_scan_metadata jsonb, exif_data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(), ai_retry_count int NOT NULL DEFAULT 0);
CREATE TABLE public.platform_config(config_key text PRIMARY KEY, config_value jsonb, description text);
CREATE TABLE public.photo_pipeline_provider_state(provider text PRIMARY KEY, blocked_until timestamptz, consecutive_failures int NOT NULL DEFAULT 0,
  last_http_status int, last_error_class text, note text, updated_at timestamptz NOT NULL DEFAULT now(), max_concurrency int NOT NULL DEFAULT 8);
INSERT INTO public.photo_pipeline_provider_state(provider) VALUES ('classifier');
CREATE TABLE public.photo_pipeline_retry_state(image_id uuid PRIMARY KEY, attempts int NOT NULL DEFAULT 0, rate_limited_attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz, terminal boolean NOT NULL DEFAULT false, last_error_class text, last_http_status int,
  last_fallback_error_class text, updated_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION t_assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

-- 12 fixture photos (created yesterday so the reconciler's grace window has passed)
INSERT INTO public.vehicle_images(id, user_id, image_url, created_at, ai_processing_status)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, gen_random_uuid(), 'https://example.test/' || n || '.jpg',
       now() - interval '1 day' - n * interval '1 minute', 'completed'
FROM generate_series(1, 12) n;

\ir ../migrations/20261109000500_photo_pipeline_backoff.sql   -- real order: the janitor's prior definition predates the stage queue
\ir ../migrations/20261112090000_image_stage_receipts_reconciler.sql
\ir ../migrations/20261112110000_image_stage_attempt_cap.sql

-- ===== 1. the status check was REPLACED, not left beside the old one (state after the attempt-cap migration)
DO $$
DECLARE d text; n int;
BEGIN
  SELECT count(*), max(pg_get_constraintdef(oid)) INTO n, d FROM pg_constraint
   WHERE conrelid = 'public.image_stage_work'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%queued%claimed%';
  PERFORM t_assert(n = 1, 'exactly one status check on image_stage_work (old one dropped)');
  PERFORM t_assert(d LIKE '%dead%' AND d NOT LIKE '%deferred%', 'status check admits dead and (at this stage) not deferred');
  BEGIN
    INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane, status, dead_reason)
    VALUES ('00000000-0000-0000-0000-000000000011', 'classifier', 1, 'missing', 'live', 'dead', 'max_attempts_exceeded');
    DELETE FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000011';
    PERFORM t_assert(true, 'status dead is admitted');
  EXCEPTION WHEN check_violation THEN PERFORM t_assert(false, 'status dead is admitted'); END;
  BEGIN
    INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane, status)
    VALUES ('00000000-0000-0000-0000-000000000011', 'classifier', 1, 'missing', 'live', 'bogus');
    PERFORM t_assert(false, 'status bogus is refused');
  EXCEPTION WHEN check_violation THEN PERFORM t_assert(true, 'status bogus is refused'); END;
  BEGIN
    INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane, status)
    VALUES ('00000000-0000-0000-0000-000000000011', 'classifier', 1, 'missing', 'live', 'dead');
    PERFORM t_assert(false, 'dead without a typed reason is refused');
  EXCEPTION WHEN check_violation THEN PERFORM t_assert(true, 'dead without a typed reason is refused'); END;
END $$;

-- ===== 2. attempt cap: a never-receipted item is claimed max_attempts times, then dead; it cannot be revived
INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane)
VALUES ('00000000-0000-0000-0000-000000000001', 'classifier', 1, 'missing', 'live');
DO $$
DECLARE i int; got int; st text; r text; att int; max_a int;
BEGIN
  SELECT max_attempts INTO max_a FROM public.image_pipeline_stages WHERE stage = 'classifier';
  FOR i IN 1..max_a LOOP
    SELECT count(*) INTO got FROM public.claim_image_stage_work('classifier', 5, 30);
    PERFORM t_assert(got = 1, 'claim ' || i || ' of ' || max_a || ' hands the item out');
    UPDATE public.image_stage_work SET lease_until = now() - interval '1 second' WHERE status = 'claimed';
    PERFORM public.release_expired_image_stage_work();
  END LOOP;
  SELECT status, dead_reason, attempts INTO st, r, att FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000001';
  PERFORM t_assert(st = 'dead' AND r = 'max_attempts_exceeded' AND att = max_a, 'item is dead/max_attempts_exceeded after ' || max_a || ' claims');
  SELECT count(*) INTO got FROM public.claim_image_stage_work('classifier', 5, 30);
  PERFORM t_assert(got = 0, 'a dead item is never claimed again');
  INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane)
  VALUES ('00000000-0000-0000-0000-000000000001', 'classifier', 1, 'missing', 'live');
  SELECT count(*) INTO got FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000001' AND status IN ('queued', 'claimed');
  PERFORM t_assert(got = 0, 'a re-insert over a dead item at the same version is dropped by the trigger');
  SELECT count(*) INTO got FROM public.image_stage_gaps(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]) WHERE stage = 'classifier';
  PERFORM t_assert(got = 0, 'the gap finder skips an image whose item is dead at this version');
  UPDATE public.image_pipeline_stages SET required_version = 2 WHERE stage = 'classifier';
  SELECT count(*) INTO got FROM public.image_stage_gaps(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]) WHERE stage = 'classifier';
  PERFORM t_assert(got = 1, 'bumping required_version re-opens the gap');
  UPDATE public.image_pipeline_stages SET required_version = 1 WHERE stage = 'classifier';
END $$;

\ir ../migrations/20261112120000_image_stage_deferred_and_availability.sql

-- ===== 3. the status check now admits deferred; still exactly one
DO $$
DECLARE d text; n int;
BEGIN
  SELECT count(*), max(pg_get_constraintdef(oid)) INTO n, d FROM pg_constraint
   WHERE conrelid = 'public.image_stage_work'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%queued%claimed%';
  PERFORM t_assert(n = 1, 'still exactly one status check after the deferred migration');
  PERFORM t_assert(d LIKE '%dead%' AND d LIKE '%deferred%', 'status check admits dead and deferred');
  BEGIN
    INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane, status)
    VALUES ('00000000-0000-0000-0000-000000000011', 'classifier', 1, 'missing', 'live', 'deferred');
    PERFORM t_assert(false, 'deferred without a typed reason is refused');
  EXCEPTION WHEN check_violation THEN PERFORM t_assert(true, 'deferred without a typed reason is refused'); END;
END $$;

-- ===== 4. deferred: a rate limit at the cap defers (not dead), and the reconciler re-queues when the provider is healthy
-- img2: the work item hits max_attempts while the newest receipt is a provider rate limit
SELECT public.record_image_stage_receipt('00000000-0000-0000-0000-000000000002', 'classifier', 1, 'rate_limited', 'classifier_rate_limited', 429, 60);
INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane, attempts)
VALUES ('00000000-0000-0000-0000-000000000002', 'classifier', 1, 'retryable_outcome', 'backfill', 6);
-- img3: the 6th rate_limited receipt (the receipt cap) lands while an item is open
SELECT public.record_image_stage_receipt('00000000-0000-0000-0000-000000000003', 'classifier', 1, 'rate_limited', 'classifier_rate_limited', 429, 60) FROM generate_series(1, 5);
INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane)
VALUES ('00000000-0000-0000-0000-000000000003', 'classifier', 1, 'retryable_outcome', 'backfill');
SELECT public.record_image_stage_receipt('00000000-0000-0000-0000-000000000003', 'classifier', 1, 'rate_limited', 'classifier_rate_limited', 429, 60);
-- img4: the 6th receipt lands from the live path, with no work item at all
SELECT public.record_image_stage_receipt('00000000-0000-0000-0000-000000000004', 'classifier', 1, 'rate_limited', 'classifier_rate_limited', 429, 60) FROM generate_series(1, 6);
-- img5: a plain failure at the cap is dead, not deferred
SELECT public.record_image_stage_receipt('00000000-0000-0000-0000-000000000005', 'classifier', 1, 'failed', 'stage_failed');
INSERT INTO public.image_stage_work(image_id, stage, target_version, reason, lane, attempts)
VALUES ('00000000-0000-0000-0000-000000000005', 'classifier', 1, 'retryable_outcome', 'backfill', 6);

DO $$
DECLARE got int; st text; dr text;
BEGIN
  SELECT count(*) INTO got FROM public.claim_image_stage_work('classifier', 5, 30);   -- cap step runs first
  PERFORM t_assert(got = 0, 'capped items are not handed out');
  SELECT status, deferred_reason INTO st, dr FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000002';
  PERFORM t_assert(st = 'deferred' AND dr = 'provider_rate_limited', 'attempt cap + newest receipt rate_limited => deferred (img2)');
  SELECT status INTO st FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000003';
  PERFORM t_assert(st = 'deferred', 'receipt cap on a rate limit defers the open item (img3)');
  SELECT count(*) INTO got FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000004' AND status = 'deferred';
  PERFORM t_assert(got = 1, 'receipt cap with no work item parks exactly one deferred item (img4)');
  SELECT status INTO st FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000005';
  PERFORM t_assert(st = 'dead', 'attempt cap on a non-rate-limit outcome is dead, not deferred (img5)');
  SELECT count(*) INTO got FROM public.image_stage_work WHERE status = 'dead' AND image_id IN
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004');
  PERFORM t_assert(got = 0, 'a provider rate limit never counts as dead');
  SELECT count(*) INTO got FROM public.image_stage_gaps(ARRAY['00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000003'::uuid]) WHERE stage = 'classifier';
  PERFORM t_assert(got = 0, 'a deferred item owns its gap: the gap finder does not double-enqueue');
  PERFORM t_assert(public.image_stage_cap_outcome('00000000-0000-0000-0000-000000000002', 'classifier', 0) = 'deferred', 'cap_outcome: deferrals left => deferred');
  PERFORM t_assert(public.image_stage_cap_outcome('00000000-0000-0000-0000-000000000002', 'classifier', 3) = 'dead', 'cap_outcome: deferrals spent => dead (bounded)');

  -- breaker active: nothing is re-queued
  UPDATE public.photo_pipeline_provider_state SET blocked_until = now() + interval '1 hour' WHERE provider = 'classifier';
  PERFORM t_assert(public.requeue_deferred_image_stage_work(25) ->> 'skipped' = 'provider_cooldown', 'cooldown active: deferred items stay deferred');
  SELECT count(*) INTO got FROM public.image_stage_work WHERE status = 'deferred';
  PERFORM t_assert(got = 3, 'all three are still deferred during the cooldown');

  -- breaker healthy: bounded, then idempotent
  UPDATE public.photo_pipeline_provider_state SET blocked_until = NULL WHERE provider = 'classifier';
  PERFORM t_assert((public.requeue_deferred_image_stage_work(1) ->> 'requeued')::int = 1, 'limit 1 re-queues exactly one (bounded)');
  PERFORM t_assert((public.requeue_deferred_image_stage_work(25) ->> 'requeued')::int = 2, 'the rest follow on the next run');
  PERFORM t_assert((public.requeue_deferred_image_stage_work(25) ->> 'requeued')::int = 0, 'a third run re-queues nothing (idempotent)');
  SELECT count(*) INTO got FROM public.image_stage_work WHERE status = 'queued' AND attempts = 0 AND deferrals = 1 AND deferred_reason IS NULL
     AND image_id IN ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004');
  PERFORM t_assert(got = 3, 're-queued items are queued with attempts reset and deferrals counted');
END $$;

-- ===== 5. image level: the rate-limit budget parks the image (still pending, not terminal), and the reconciler reopens it
INSERT INTO public.photo_pipeline_retry_state(image_id) VALUES ('00000000-0000-0000-0000-000000000006');
UPDATE public.vehicle_images SET ai_processing_status = 'pending' WHERE id IN
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000008');
DO $$
DECLARE i int; res jsonb; r record; got int;
BEGIN
  FOR i IN 1..12 LOOP
    res := public.photo_pipeline_note_failure('00000000-0000-0000-0000-000000000006', 'classifier_rate_limited', 429);
  END LOOP;
  PERFORM t_assert(res ->> 'status' = 'deferred', 'the 12th rate limit returns deferred, not failed');
  SELECT * INTO r FROM public.photo_pipeline_retry_state WHERE image_id = '00000000-0000-0000-0000-000000000006';
  PERFORM t_assert(r.terminal = false AND r.next_attempt_at IS NULL AND r.deferred_at IS NOT NULL, 'parked: not terminal, no retry time, deferred_at set');
  PERFORM t_assert((SELECT ai_processing_status FROM public.vehicle_images WHERE id = '00000000-0000-0000-0000-000000000006') = 'pending', 'the image stays pending (honest: unclassified)');

  -- rows the earlier code left terminal after a rate limit (the stuck population) and one that is no longer pending
  INSERT INTO public.photo_pipeline_retry_state(image_id, terminal, rate_limited_attempts, last_error_class, last_http_status)
  VALUES ('00000000-0000-0000-0000-000000000007', true, 12, 'classifier_rate_limited', 429),
         ('00000000-0000-0000-0000-000000000009', true, 12, 'classifier_rate_limited', 429),   -- completed: must be left alone
         ('00000000-0000-0000-0000-000000000008', true, 1, 'image_http_error', 404);          -- a real failure: must be left alone

  -- the provider is cooling down (the 12 rate limits just blocked it)
  PERFORM t_assert(public.photo_pipeline_requeue_deferred() ->> 'skipped' = 'provider_cooldown', 'cooldown active: nothing is reopened');
  UPDATE public.photo_pipeline_provider_state SET blocked_until = NULL, max_concurrency = 8 WHERE provider = 'classifier';
  PERFORM t_assert((public.photo_pipeline_requeue_deferred(1) ->> 'requeued')::int = 1, 'healthy provider, limit 1: one image reopened (bounded)');
  PERFORM t_assert((public.photo_pipeline_requeue_deferred(25) ->> 'requeued')::int = 1, 'the other parked image follows');
  PERFORM t_assert((public.photo_pipeline_requeue_deferred(25) ->> 'requeued')::int = 0, 'nothing left: idempotent');
  SELECT count(*) INTO got FROM public.photo_pipeline_retry_state WHERE image_id IN ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007')
     AND terminal = false AND deferred_at IS NULL AND deferrals = 1 AND rate_limited_attempts = 0 AND next_attempt_at > now();
  PERFORM t_assert(got = 2, 'reopened rows are claimable later (next_attempt_at set, staggered) with a fresh rate-limit budget');
  SELECT count(*) INTO got FROM public.photo_pipeline_retry_state WHERE image_id IN ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000009') AND terminal AND deferrals = 0;
  PERFORM t_assert(got = 2, 'non-pending and non-rate-limit terminal rows are untouched');

  -- bounded in total: after max_deferrals the image stays visibly parked instead of looping
  UPDATE public.photo_pipeline_retry_state SET deferred_at = now(), next_attempt_at = NULL, deferrals = 3 WHERE image_id = '00000000-0000-0000-0000-000000000006';
  res := public.photo_pipeline_requeue_deferred(25);
  PERFORM t_assert((res ->> 'requeued')::int = 0 AND (res ->> 'exhausted_deferrals')::int = 1, 'deferrals are bounded and the exhausted count is reported');
  UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{enabled}', 'false') WHERE config_key = 'photo_pipeline_deferred_requeue';
  PERFORM t_assert(public.photo_pipeline_requeue_deferred() ->> 'skipped' = 'disabled', 'its own flag turns it off');
  UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{enabled}', 'true') WHERE config_key = 'photo_pipeline_deferred_requeue';
END $$;

-- ===== 6. unavailable -> available: the retry is enqueued once the stage is live, required or not
DO $$
DECLARE got int; a boolean; since timestamptz; w record; res jsonb;
BEGIN
  PERFORM public.record_image_stage_receipt('00000000-0000-0000-0000-000000000010', 'engine_bay', 1, 'unavailable', 'edge_function_not_deployed', NULL, 3600);
  SELECT available, available_since INTO a, since FROM public.image_pipeline_stages WHERE stage = 'engine_bay';
  PERFORM t_assert(a = false AND since IS NULL, 'an unavailable receipt marks the stage unavailable');
  PERFORM t_assert((SELECT required FROM public.image_pipeline_stages WHERE stage = 'engine_bay') = false, 'engine_bay is required=false (retry must not depend on it)');
  PERFORM t_assert((public.enqueue_available_stage_retries(25) ->> 'enqueued')::int = 0, 'stage still unavailable: nothing enqueued');

  PERFORM public.set_image_stage_availability('engine_bay', true);          -- the probe saw it deployed
  SELECT available, available_since INTO a, since FROM public.image_pipeline_stages WHERE stage = 'engine_bay';
  PERFORM t_assert(a = true AND since IS NOT NULL, 'probe sets available and available_since');
  PERFORM t_assert((public.enqueue_available_stage_retries(25) ->> 'enqueued')::int = 1, 'available: the unavailable receipt is enqueued although retry_after has not passed');
  SELECT * INTO w FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000010' AND stage = 'engine_bay';
  PERFORM t_assert(w.status = 'queued' AND w.reason = 'retryable_outcome' AND w.target_version = 1, 'item is queued as retryable_outcome at the stage version');
  PERFORM t_assert((public.enqueue_available_stage_retries(25) ->> 'enqueued')::int = 0, 'idempotent: no second item while one is open');

  -- the retry succeeds: closes the item, nothing left to retry
  PERFORM public.record_image_stage_receipt('00000000-0000-0000-0000-000000000010', 'engine_bay', 1, 'succeeded');
  PERFORM t_assert((SELECT status FROM public.image_stage_work WHERE image_id = '00000000-0000-0000-0000-000000000010' AND stage = 'engine_bay') = 'done', 'succeeded receipt closes the item');
  PERFORM t_assert((public.enqueue_available_stage_retries(25) ->> 'enqueued')::int = 0, 'a newer succeeded receipt is not a retry candidate');

  -- bounded by the stage attempt cap: a stage flagged available that keeps answering unavailable stops being retried
  PERFORM public.record_image_stage_receipt('00000000-0000-0000-0000-000000000011', 'engine_bay', 1, 'unavailable', 'edge_function_not_deployed', NULL, 60) FROM generate_series(1, 6);
  PERFORM public.set_image_stage_availability('engine_bay', true);
  PERFORM t_assert((public.enqueue_available_stage_retries(25) ->> 'enqueued')::int = 0, 'receipts at max_attempts are not retried again');

  -- a succeeded receipt marks an unknown stage available; an unavailable one flips it back
  PERFORM public.record_image_stage_receipt('00000000-0000-0000-0000-000000000012', 'receipt_ocr', 1, 'succeeded');
  PERFORM t_assert((SELECT available FROM public.image_pipeline_stages WHERE stage = 'receipt_ocr') = true, 'first succeeded receipt marks the stage available');
  PERFORM public.record_image_stage_receipt('00000000-0000-0000-0000-000000000012', 'receipt_ocr', 1, 'unavailable', 'edge_function_not_deployed', NULL, 60);
  SELECT available, available_since INTO a, since FROM public.image_pipeline_stages WHERE stage = 'receipt_ocr';
  PERFORM t_assert(a = false AND since IS NULL, 'an unavailable receipt flips it back and clears available_since');
END $$;

-- ===== 7. the single cron entry point: image-level recovery always, stage-level only when the reconciler flag is on
DO $$
DECLARE res jsonb;
BEGIN
  res := public.reconcile_image_pipeline(10);
  PERFORM t_assert(res ->> 'stages' = 'disabled' AND res ? 'images_deferred', 'flag off: only the image-level recovery runs');
  UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{enabled}', 'true') WHERE config_key = 'image_stage_reconciler';
  res := public.reconcile_image_pipeline(10);
  PERFORM t_assert(res ? 'work_deferred' AND res ? 'available_retries' AND res ? 'reconcile', 'flag on: deferred work, available retries and the gap scan all run');
END $$;

-- ===== 8. failed post-classifier receipts are retryable with backoff and the attempt cap (migration 20261112130000)
\ir ../migrations/20261112130000_image_stage_failed_retry.sql
INSERT INTO public.vehicle_images(id, user_id, image_url, created_at, ai_processing_status)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, gen_random_uuid(), 'https://example.test/' || n || '.jpg',
       now() - interval '1 day' - n * interval '1 minute', 'failed'
FROM generate_series(21, 24) n;
DO $$
DECLARE
  f uuid := '00000000-0000-0000-0000-000000000021'; ev uuid := '00000000-0000-0000-0000-000000000022';
  ex uuid := '00000000-0000-0000-0000-000000000023'; cl uuid := '00000000-0000-0000-0000-000000000024';
  r record; ra timestamptz; n int; secs numeric;
BEGIN
  PERFORM t_assert((SELECT retries_failed FROM public.image_pipeline_stages WHERE stage = 'filing')
                   AND (SELECT retries_failed FROM public.image_pipeline_stages WHERE stage = 'evidence')
                   AND NOT (SELECT retries_failed FROM public.image_pipeline_stages WHERE stage = 'classifier'), 'only filing and evidence retry failed receipts');

  -- a never-run filing stage is not a gap (filing is not required)
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[f]) WHERE stage IN ('filing', 'evidence')), 'no receipt on a non-required stage: no gap');

  -- attempt 1 failed: backoff 300 s chosen by the server, whatever the caller passes
  PERFORM public.record_image_stage_receipt(f, 'filing', 1, 'failed', 'photo_pipeline_attribution_failed', NULL, 1);
  SELECT retry_after, attempt INTO ra, n FROM public.image_stage_receipts WHERE image_id = f AND stage = 'filing' ORDER BY attempt DESC LIMIT 1;
  secs := extract(epoch FROM ra - now());
  PERFORM t_assert(n = 1 AND secs BETWEEN 290 AND 301, 'first failed receipt backs off ~300 s (caller hint of 1 s ignored)');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[f]) WHERE stage = 'filing'), 'inside the backoff the failure is not a gap');

  -- backoff elapsed: it becomes a gap, not_before = retry_after, reason retryable_outcome
  UPDATE public.image_stage_receipts SET retry_after = now() - interval '1 second' WHERE image_id = f AND stage = 'filing';   -- test-only clock move on the disposable DB
  SELECT * INTO r FROM public.image_stage_gaps(ARRAY[f]) WHERE stage = 'filing';
  PERFORM t_assert(r.image_id IS NOT NULL AND r.reason = 'retryable_outcome' AND r.target_version = 1, 'a failed receipt past its backoff is a retryable_outcome gap');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[f]) WHERE stage = 'evidence'), 'a failed filing opens no evidence gap');

  -- second failure doubles the backoff
  PERFORM public.record_image_stage_receipt(f, 'filing', 1, 'failed', 'photo_pipeline_attribution_failed');
  SELECT extract(epoch FROM retry_after - now()) INTO secs FROM public.image_stage_receipts WHERE image_id = f AND stage = 'filing' AND attempt = 2;
  PERFORM t_assert(secs BETWEEN 590 AND 601, 'second failure backs off ~600 s');

  -- attempt cap: at max_attempts the item is no longer a gap, however old
  FOR n IN 3..6 LOOP PERFORM public.record_image_stage_receipt(f, 'filing', 1, 'failed', 'photo_pipeline_attribution_failed'); END LOOP;
  UPDATE public.image_stage_receipts SET retry_after = now() - interval '1 second' WHERE image_id = f AND stage = 'filing';
  PERFORM t_assert((SELECT max(attempt) FROM public.image_stage_receipts WHERE image_id = f AND stage = 'filing') = (SELECT max_attempts FROM public.image_pipeline_stages WHERE stage = 'filing'), 'six attempts recorded');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[f]) WHERE stage = 'filing'), 'at max_attempts a failed receipt is no longer retried');

  -- backoff is capped at 24 h
  FOR n IN 1..12 LOOP PERFORM public.record_image_stage_receipt(ev, 'evidence', 1, 'failed', 'pipeline_operation_failed'); END LOOP;
  SELECT extract(epoch FROM retry_after - now()) INTO secs FROM public.image_stage_receipts WHERE image_id = ev AND stage = 'evidence' AND attempt = 12;
  PERFORM t_assert(secs <= 86401, 'backoff never exceeds 24 h');

  -- a later success closes the retry
  PERFORM public.record_image_stage_receipt(ex, 'evidence', 1, 'failed', 'pipeline_operation_failed');
  UPDATE public.image_stage_receipts SET retry_after = now() - interval '1 second' WHERE image_id = ex AND stage = 'evidence';
  PERFORM t_assert(EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[ex]) WHERE stage = 'evidence'), 'evidence failure is a gap once due');
  PERFORM public.record_image_stage_receipt(ex, 'evidence', 1, 'succeeded');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[ex]) WHERE stage = 'evidence'), 'a succeeded receipt ends the retry');

  -- a failed classifier receipt keeps the old rule: terminal, no retry_after, no gap
  PERFORM public.record_image_stage_receipt(cl, 'classifier', 1, 'failed', 'classifier_failed');
  PERFORM t_assert((SELECT retry_after FROM public.image_stage_receipts WHERE image_id = cl AND stage = 'classifier') IS NULL
                   AND NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[cl]) WHERE stage = 'classifier'), 'classifier failed stays terminal (the paid stage is never blindly retried)');

  -- blocked_input (no saved classification) is terminal on filing/evidence
  PERFORM public.record_image_stage_receipt(cl, 'filing', 1, 'failed', 'pipeline_operation_failed');
  UPDATE public.image_stage_receipts SET retry_after = now() - interval '1 second' WHERE image_id = cl AND stage = 'filing';
  PERFORM t_assert(EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[cl]) WHERE stage = 'filing'), 'precondition: the failed filing receipt is due');
  PERFORM public.record_image_stage_receipt(cl, 'filing', 1, 'blocked_input', 'no_saved_classification');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[cl]) WHERE stage = 'filing'), 'a newer blocked_input receipt ends the retry (terminal)');

  -- receipts written before this migration have no retry_after: due 5 minutes after observed_at, still capped
  INSERT INTO public.image_stage_receipts(image_id, stage, producer, producer_version, outcome, attempt, observed_at, error_class)
  VALUES ('00000000-0000-0000-0000-000000000012', 'filing', 'photo-pipeline-orchestrator', 1, 'failed', 1, now() - interval '10 minutes', 'pipeline_operation_failed');
  PERFORM t_assert(EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY['00000000-0000-0000-0000-000000000012'::uuid]) WHERE stage = 'filing'), 'a legacy failed receipt (retry_after NULL) older than 5 min is due');

  -- the retry constraint admits failed and still refuses a retry time on succeeded
  BEGIN
    INSERT INTO public.image_stage_receipts(image_id, stage, producer, producer_version, outcome, attempt, retry_after)
    VALUES (f, 'filing', 'photo-pipeline-orchestrator', 1, 'succeeded', 99, now());
    PERFORM t_assert(false, 'retry_after on succeeded is refused');
  EXCEPTION WHEN check_violation THEN PERFORM t_assert(true, 'retry_after on succeeded is refused'); END;
END $$;

-- ===== 9. the hourly janitor does not re-pay for a saved classification (migration 20261112140000)
\ir ../migrations/20261112140000_reset_stuck_skip_classified.sql
INSERT INTO public.vehicle_images(id, user_id, image_url, created_at, ai_processing_status, updated_at, ai_scan_metadata)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, gen_random_uuid(), 'https://example.test/' || n || '.jpg',
       now() - interval '1 day', 'failed', now() - interval '1 hour',
       CASE WHEN n = 33 THEN '{"classification":{"classifier_ok":true}}'::jsonb END
FROM generate_series(31, 34) n;
DO $$
DECLARE
  plain uuid := '00000000-0000-0000-0000-000000000031'; rcpt uuid := '00000000-0000-0000-0000-000000000032';
  legacy uuid := '00000000-0000-0000-0000-000000000033'; failcl uuid := '00000000-0000-0000-0000-000000000034';
  res record;
BEGIN
  PERFORM public.record_image_stage_receipt(rcpt, 'classifier', 1, 'succeeded');
  PERFORM public.record_image_stage_receipt(failcl, 'classifier', 1, 'failed', 'classifier_failed');
  UPDATE public.vehicle_images SET ai_processing_status = 'completed' WHERE id NOT IN (plain, rcpt, legacy, failcl) AND ai_processing_status = 'failed';
  SELECT * INTO res FROM public.reset_stuck_photo_pipeline_images();
  PERFORM t_assert(res.requeued_failed = 2, 'only the 2 failed images with no saved classification are re-armed');
  PERFORM t_assert((SELECT ai_processing_status FROM public.vehicle_images WHERE id = plain) = 'pending', 'failed, never classified: back to pending (unchanged behaviour)');
  PERFORM t_assert((SELECT ai_processing_status FROM public.vehicle_images WHERE id = failcl) = 'pending', 'failed classifier receipt: still re-armed (unchanged behaviour)');
  PERFORM t_assert((SELECT ai_processing_status FROM public.vehicle_images WHERE id = rcpt) = 'failed'
                   AND (SELECT ai_retry_count FROM public.vehicle_images WHERE id = rcpt) = 0, 'succeeded classifier receipt: left failed for the filing/evidence runners, no retry burnt');
  PERFORM t_assert((SELECT ai_processing_status FROM public.vehicle_images WHERE id = legacy) = 'failed', 'legacy saved classification (classifier_ok): left failed, no paid reclassify');
  -- other guards keep working: terminal retry state still blocks
  UPDATE public.vehicle_images SET ai_processing_status = 'failed', updated_at = now() - interval '1 hour' WHERE id = plain;
  INSERT INTO public.photo_pipeline_retry_state(image_id, terminal) VALUES (plain, true);
  SELECT * INTO res FROM public.reset_stuck_photo_pipeline_images();
  PERFORM t_assert((SELECT ai_processing_status FROM public.vehicle_images WHERE id = plain) = 'failed', 'terminal retry state still blocks the reset');
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL image_stage_attempt_cap CHECKS PASSED'; END $$;
