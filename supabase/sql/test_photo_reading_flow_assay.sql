-- Photo reading flow assay (20261113100000): the reading reports classifier-contract coverage, the queue as the claim
-- sees it, the provider and the readers; it raises when claimable photos wait with nothing read, and when a backlog sits
-- unread with no reading for 72 h; it passes while readings land; only the service role (or a job) may call it; the
-- yield refresh finds its users from photo_land_progress without touching vehicle_images by status; both crons are
-- scheduled with a leading statement_timeout; the revert restores the prior state.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_photo_reading_flow_assay%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_photo_reading_flow_assay* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Stand-ins carrying the columns read from production on 2026-11-10 (information_schema.columns), no more.
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, image_url text,
  is_duplicate boolean DEFAULT false, ai_processing_status text DEFAULT 'pending', ai_processing_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_vehicle_images_pending_user ON public.vehicle_images (created_at DESC)
  WHERE ai_processing_status = 'pending' AND user_id IS NOT NULL;
CREATE TABLE public.user_image_counts(id bigserial PRIMARY KEY, user_id uuid NOT NULL, taken_day date, created_day date,
  n_all integer NOT NULL DEFAULT 0, n_owned integer NOT NULL DEFAULT 0, recorded_at timestamptz DEFAULT now());
CREATE TABLE public.image_descriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, vehicle_id uuid,
  description text, description_type text, source text, source_version text, confidence numeric, evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_image_deep_reads(image_id uuid PRIMARY KEY, user_id uuid NOT NULL, updated_at timestamptz NOT NULL);
CREATE TABLE public.image_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, vehicle_id uuid,
  role text, observed_by text NOT NULL, agent_version text, observed_at timestamptz NOT NULL DEFAULT now(), is_active boolean DEFAULT true);
CREATE TABLE public.photo_pipeline_retry_state(image_id uuid PRIMARY KEY, attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz, last_error_class text, last_http_status integer, last_fallback_error_class text,
  terminal boolean NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now(), rate_limited_attempts integer NOT NULL DEFAULT 0);
CREATE TABLE public.photo_pipeline_provider_state(provider text PRIMARY KEY, blocked_until timestamptz, consecutive_failures integer,
  last_http_status integer, last_error_class text, note text, updated_at timestamptz);
CREATE TABLE public.llm_cost_tracking(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
  date date, provider text, model text, task text, input_tokens integer, output_tokens integer, cost_cents numeric,
  duration_ms integer, caller text);
CREATE TABLE public.job_assay_readings(jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval, fresh_for interval);
CREATE TABLE public.photo_land_progress(image_id uuid PRIMARY KEY, landed_at timestamptz NOT NULL DEFAULT now(), result jsonb);
CREATE TABLE public.photo_analysis_yield_daily(user_id uuid NOT NULL, day date NOT NULL, photos integer, filed_photos integer,
  filed_pct numeric, median_rows_beyond_status numeric, pct_zero_beyond_status numeric, pct_zero_analysis numeric,
  rows_total bigint, rows_analysis bigint, mean_tables_touched numeric, mean_coverage numeric, mean_extraction numeric,
  landing_rate numeric, cited_evidence bigint, mean_confidence numeric, mismatch_rows bigint, make_agree_pct numeric,
  computed_at timestamptz DEFAULT now(), PRIMARY KEY (user_id, day));
-- The two yield functions the refresh calls, reduced to recorders: which users and windows it asked for.
CREATE TABLE public.yield_calls(user_id uuid, since timestamptz, until timestamptz);
CREATE FUNCTION public.photo_analysis_yield_snapshot_run(p_user_id uuid, p_since timestamptz, p_until timestamptz, p_legacy boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.yield_calls VALUES (p_user_id, p_since, p_until); RETURN 1; END $$;
CREATE FUNCTION public.photo_analysis_yield_by_day(p_user_id uuid, p_since timestamptz, p_until timestamptz, p_tz text DEFAULT 'America/Los_Angeles')
RETURNS TABLE(day date, photos integer, filed_photos integer, filed_pct numeric, median_rows_beyond_status numeric,
  pct_zero_beyond_status numeric, pct_zero_analysis numeric, rows_total bigint, rows_analysis bigint, mean_tables_touched numeric,
  mean_coverage numeric, mean_extraction numeric, landing_rate numeric, cited_evidence bigint, mean_confidence numeric,
  mismatch_rows bigint, make_agree_pct numeric)
LANGUAGE sql STABLE AS $$ SELECT current_date, 3, 2, 66.7, 1::numeric, 0::numeric, 0::numeric, 9::bigint, 6::bigint, 2::numeric,
  0.5::numeric, 0.5::numeric, 1::numeric, 4::bigint, 0.9::numeric, 0::bigint, 100::numeric $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;
-- The refresh as production held it before this migration, and its cron without a leading SET.
CREATE FUNCTION public.photo_analysis_yield_daily_refresh(p_hours integer DEFAULT 2) RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '280s' AS $$ BEGIN RETURN -1; END $$;
SELECT cron.schedule('photo-analysis-yield-hourly', '17 * * * *', 'select public.photo_analysis_yield_daily_refresh(2)');

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.raises(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

\i supabase/migrations/20261113100000_photo_reading_flow_assay.sql

-- grants, schedule, the dropped function-level timeout
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE'), 'anon cannot read the assay');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE'), 'signed-in users cannot read the assay');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.assay_photo_reading_flow(boolean)', 'EXECUTE'), 'the service role reads the assay');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'photo-reading-flow-watch' AND schedule = '37 * * * *'
  AND command LIKE 'SET statement_timeout = ''20s'';%assay_photo_reading_flow()%') = 1, 'the watch runs hourly with its own statement budget');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'photo-analysis-yield-hourly') = 1
  AND (SELECT command FROM cron.job WHERE jobname = 'photo-analysis-yield-hourly') LIKE 'SET statement_timeout = ''55s'';%photo_analysis_yield_daily_refresh(2)%',
  'the yield cron is rescheduled once, with a leading statement_timeout');
SELECT pg_temp.assert_true((SELECT proconfig FROM pg_proc WHERE oid = 'public.photo_analysis_yield_daily_refresh(integer)'::regprocedure)::text NOT LIKE '%statement_timeout%',
  'the refresh no longer carries a function-level statement_timeout');

-- a signed-in caller is refused in the body even if granted by mistake
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000aa"}', false);
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_photo_reading_flow(false)$$) LIKE '%service admission required%', 'body refuses a non-service caller');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- 1. empty system: nothing to read, nothing stalled
SELECT public.assay_photo_reading_flow() AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'passed' AND ((:'a')::jsonb#>>'{classifier,images_total}')::int = 0, 'empty: passes with zero population');

-- 2. a backlog with nothing ever read: 600 user-owned photos counted, all completed long ago, no reading under the contract
INSERT INTO public.user_image_counts(user_id, taken_day, created_day, n_all, n_owned)
VALUES ('00000000-0000-4000-8000-000000000001', current_date - 40, current_date - 40, 700, 700),
       ('00000000-0000-4000-8000-000000000001', current_date - 40, current_date - 40, -100, -100);  -- signed rows sum
INSERT INTO public.image_descriptions(image_id, description_type, source, source_version, evidence, created_at)
SELECT gen_random_uuid(), 'classifier_v2', 'photo-pipeline-classifier', 'legacy', '{}'::jsonb, now() - interval '7 days' FROM generate_series(1, 50);
INSERT INTO public.image_descriptions(image_id, description_type, source, source_version, evidence, created_at)
SELECT gen_random_uuid(), 'auto', 'florence2_caption', 'finetuned_v2', '{}'::jsonb, now() FROM generate_series(1, 30);  -- another kind: not a classifier reading
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'failed'
  AND ((:'a')::jsonb#>>'{classifier,images_total}')::int = 600
  AND ((:'a')::jsonb#>>'{classifier,images_read_under_contract}')::int = 0
  AND ((:'a')::jsonb#>>'{classifier,images_without_current_reading}')::int = 600
  AND ((:'a')::jsonb#>>'{classifier,images_read_under_other_versions}')::int = 50
  AND (:'a')::jsonb->'reasons'->>0 LIKE '600 of 600 user-owned photos have no reading under contract v98%never%',
  'a backlog with no current reading fails and says how many; legacy and non-classifier rows do not count as read');
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_photo_reading_flow()$$) LIKE 'photo reading stalled: 600 of 600%', 'the cron form raises with the numbers');

-- 3. readings landing under the contract within 72 h: passes, and names who read
INSERT INTO public.image_descriptions(image_id, description_type, source, source_version, evidence, created_at)
SELECT gen_random_uuid(), 'classifier_v2', 'photo-pipeline-classifier', 'v98', '{"model":"reader:claude-cli sonnet subscription"}'::jsonb, now() - interval '30 hours'
  FROM generate_series(1, 40);
SELECT public.assay_photo_reading_flow() AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'passed'
  AND ((:'a')::jsonb#>>'{classifier,images_read_under_contract}')::int = 40
  AND ((:'a')::jsonb#>>'{classifier,images_without_current_reading}')::int = 560
  AND ((:'a')::jsonb#>>'{classifier,readings_24h}')::int = 0 AND ((:'a')::jsonb#>>'{classifier,readings_72h}')::int = 40
  AND ((:'a')::jsonb#>>'{classifier,readings_72h_by_producer,reader:claude-cli sonnet subscription}')::int = 40,
  'readings within 72 h pass and are attributed to their producer');

-- 4. the same readings older than 72 h: silent again, unless a deep reading landed
UPDATE public.image_descriptions SET created_at = now() - interval '80 hours' WHERE source_version = 'v98';
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_photo_reading_flow()$$) LIKE 'photo reading stalled: 560 of 600%', 'readings older than 72 h do not keep the flow alive');
INSERT INTO public.image_observations(image_id, role, observed_by, agent_version, observed_at)
VALUES (gen_random_uuid(), 'incidental', 'clip_embed_carrier_v1', 'carrier_v1', now() - interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_photo_reading_flow()$$) LIKE 'photo reading stalled:%', 'an embedding carrier row is not a reading');
INSERT INTO public.image_observations(image_id, role, observed_by, agent_version, observed_at)
VALUES (gen_random_uuid(), 'subject', 'caller-byok', 'reviewed_image_analysis_v1', now() - interval '2 hours');
INSERT INTO public.user_image_deep_reads(image_id, user_id, updated_at) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', now());
SELECT public.assay_photo_reading_flow() AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'passed'
  AND ((:'a')::jsonb#>>'{deep,readings_72h}')::int = 1 AND ((:'a')::jsonb#>>'{deep,images_with_verdict}')::int = 1
  AND ((:'a')::jsonb#>>'{deep,image_observations_72h_by_producer,clip_embed_carrier_v1}')::int = 1,
  'a deep reading within 72 h keeps the flow alive; every producer is listed');

-- 5. the queue as the claim sees it: duplicates, terminal and backing-off rows are pending but not claimable
INSERT INTO public.vehicle_images(id, user_id, image_url, is_duplicate, ai_processing_status, created_at) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'https://x/1.jpg', false, 'pending', now() - interval '9 hours'),  -- claimable, waiting
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'https://x/2.jpg', true,  'pending', now() - interval '9 hours'),  -- duplicate
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'https://x/3.jpg', false, 'pending', now() - interval '9 hours'),  -- terminal
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'https://x/4.jpg', false, 'pending', now() - interval '9 hours'),  -- backing off
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'https://x/5.jpg', false, 'pending', now() - interval '9 hours'),  -- backoff elapsed
  ('10000000-0000-4000-8000-000000000006', NULL,                                   'https://x/6.jpg', false, 'pending', now() - interval '9 hours'),  -- listing photo: outside
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'https://x/7.jpg', false, 'completed', now() - interval '9 hours');
INSERT INTO public.photo_pipeline_retry_state(image_id, attempts, next_attempt_at, terminal, last_error_class, last_http_status) VALUES
  ('10000000-0000-4000-8000-000000000003', 3, NULL, true, 'image_http_error', 400),
  ('10000000-0000-4000-8000-000000000004', 1, now() + interval '1 hour', false, 'classifier_rate_limited', 429),
  ('10000000-0000-4000-8000-000000000005', 1, now() - interval '1 hour', false, 'classifier_timeout', NULL);
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_photo_reading_flow()$$) LIKE 'photo reading stalled: 2 claimable pending photos, oldest waiting since %no reading landed in 06:00:00%',
  'claimable photos waiting past 6 h with nothing read raise, even while a deep reading is fresh');
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.assert_true(((:'a')::jsonb#>>'{queue,pending_user_photos}')::int = 5 AND ((:'a')::jsonb#>>'{queue,claimable_now}')::int = 2
  AND ((:'a')::jsonb#>>'{queue,terminal_retry_rows}')::int = 1, 'five pending user photos, two claimable, one terminal retry row');
-- a reading in the last 6 h means the queue is moving
INSERT INTO public.image_descriptions(image_id, description_type, source, source_version, evidence, created_at)
VALUES (gen_random_uuid(), 'classifier_v2', 'photo-pipeline-classifier', 'v98', '{"model":"openai:gpt-4.1-mini"}'::jsonb, now() - interval '10 minutes');
SELECT public.assay_photo_reading_flow() AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'passed' AND ((:'a')::jsonb#>>'{classifier,readings_6h}')::int = 1, 'a reading in the last 6 h: the queue is moving');

-- 6. provider and reader lines are carried as read
INSERT INTO public.photo_pipeline_provider_state(provider, blocked_until, consecutive_failures, last_http_status, last_error_class, note, updated_at)
VALUES ('classifier', NULL, 0, 429, 'classifier_rate_limited', 'healthy', now() - interval '1 day');
INSERT INTO public.llm_cost_tracking(created_at, provider, model, task, input_tokens, caller) VALUES
  (now() - interval '6 days', 'openai', 'gpt-4.1-mini', '200', 5000, 'photo-pipeline-orchestrator'),
  (now() - interval '2 hours', 'openai', 'gpt-4.1-mini', '429', NULL, 'photo-pipeline-orchestrator'),
  (now() - interval '2 hours', 'google', 'gemini-flash-latest', '402', NULL, 'photo-pipeline-orchestrator'),
  (now() - interval '2 hours', 'google_block', 'gemini-flash-latest', '402', NULL, 'photo-pipeline-orchestrator'),
  (now() - interval '1 hour', 'openai', 'gpt-4.1-mini', '200', 9000, 'some-other-caller');
INSERT INTO public.job_assay_readings(jobname, reading, assayed_at, elapsed_ms, refresh_every, fresh_for)
VALUES ('subscription-frame-classifier', '{"frames":20,"accepted":19}'::jsonb, now() - interval '3 hours', 1000, interval '10 minutes', interval '40 minutes');
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.assert_true(((:'a')::jsonb#>>'{provider,calls_24h}')::int = 2 AND ((:'a')::jsonb#>>'{provider,successes_24h}')::int = 0
  AND ((:'a')::jsonb#>>'{provider,last_success_at}')::timestamptz < now() - interval '5 days'
  AND (:'a')::jsonb#>>'{provider,breaker,note}' = 'healthy'
  AND ((:'a')::jsonb#>>'{readers,subscription-frame-classifier,reading,accepted}')::int = 19,
  'the reading shows a breaker that says healthy beside a provider with no success in 24 h, and the reader heartbeat');

-- 7. the yield refresh: users come from photo_land_progress in the window; nothing else is asked for
INSERT INTO public.vehicle_images(id, user_id, image_url, ai_processing_status, ai_processing_completed_at) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'https://x/a.jpg', 'completed', now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'https://x/b.jpg', 'completed', now()),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'https://x/c.jpg', 'completed', now() - interval '5 hours'),
  ('20000000-0000-4000-8000-000000000004', NULL,                                   'https://x/d.jpg', 'completed', now());
INSERT INTO public.photo_land_progress(image_id, landed_at, result) VALUES
  ('20000000-0000-4000-8000-000000000001', now() - interval '20 minutes', '{}'),
  ('20000000-0000-4000-8000-000000000002', now() - interval '30 minutes', '{}'),
  ('20000000-0000-4000-8000-000000000003', now() - interval '5 hours', '{}'),   -- outside the 2 h window
  ('20000000-0000-4000-8000-000000000004', now() - interval '10 minutes', '{}'); -- no user: skipped
SELECT public.photo_analysis_yield_daily_refresh(2) AS n \gset
SELECT pg_temp.assert_true(:n = 1 AND (SELECT count(*) FROM public.yield_calls) = 1
  AND (SELECT user_id FROM public.yield_calls) = '00000000-0000-4000-8000-000000000001'
  AND (SELECT count(*) FROM public.photo_analysis_yield_daily WHERE user_id = '00000000-0000-4000-8000-000000000001' AND photos = 3) = 1,
  'one user landed photos in the window: one snapshot run and one daily row');
SELECT public.photo_analysis_yield_daily_refresh(2);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.photo_analysis_yield_daily) = 1, 'a second run upserts the same day');
DELETE FROM public.photo_land_progress WHERE landed_at > now() - interval '2 hours';
TRUNCATE public.yield_calls;
SELECT pg_temp.assert_true(public.photo_analysis_yield_daily_refresh(2) = 0 AND (SELECT count(*) FROM public.yield_calls) = 0, 'nothing landed: nothing to do, returns 0');

-- 8. the revert restores the prior cron and removes the assay
\i supabase/sql/revert_20261113100000_photo_reading_flow_assay.sql
SELECT pg_temp.assert_true(to_regprocedure('public.assay_photo_reading_flow(boolean)') IS NULL
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'photo-reading-flow-watch') = 0
  AND (SELECT command FROM cron.job WHERE jobname = 'photo-analysis-yield-hourly') = 'select public.photo_analysis_yield_daily_refresh(2)'
  AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.photo_analysis_yield_daily_refresh(integer)'::regprocedure)::text LIKE '%statement_timeout=280s%',
  'revert: no assay, no watch, the prior refresh and cron');
\echo 'photo reading flow assay contract passed'
