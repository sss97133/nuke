-- Contract for 20261120130000_photo_deep_reading_keyed_values_stages.sql, on a fresh disposable database: deep reading
-- and keyed values are two more stages of the per-image stage ledger. Deploying with the scope off changes nothing
-- observable (the classifier stage is judged, queued and receipted as before); with the scope on, a photo that is
-- filed, approved and first-read is a deep_reading gap unless a reading exists, and a photo whose reading has no
-- projected child for it is a keyed_values gap; work is created by the events that make it due, the backfill is held to
-- a daily cap, the levels count per photo and add up, and the flow watch names a stalled stage. The migration's
-- predecessors are replayed with \ir; the fixture holds only the tables and columns they read.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN RAISE EXCEPTION 'needs an empty disposable database'; END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role(), auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, image_url text, created_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean, is_sensitive boolean, is_external boolean, is_superseded boolean, is_document boolean, doc_flag boolean,
  image_vehicle_match_status text, vision_gate_status text, ai_processing_status text, ai_processing_started_at timestamptz,
  ai_scan_metadata jsonb, exif_data jsonb, taken_at timestamptz);
CREATE INDEX idx_vehicle_images_pending_user ON public.vehicle_images (created_at DESC)
  WHERE ai_processing_status = 'pending' AND user_id IS NOT NULL;
-- (the assay's own stand-ins follow: user_image_counts, image_descriptions, provider and retry state, cron, the yield functions)
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
INSERT INTO public.photo_pipeline_provider_state(provider) VALUES ('classifier');
-- production shapes of the observation tables the projection and the levels read (columns used, no more)
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, kind text, extraction_method text, structured_data jsonb,
  is_superseded boolean DEFAULT false, descriptor_id uuid, property_id uuid, observed_at timestamptz, ingested_at timestamptz DEFAULT now(), agent_tier text);
CREATE INDEX idx_vobs_image_id_analysis ON public.vehicle_observations (((structured_data ->> 'image_id')), ((structured_data ->> 'analysis_kind')))
  WHERE ((structured_data ->> 'image_id') IS NOT NULL);
CREATE TABLE public.observation_witnesses (observation_id uuid REFERENCES public.vehicle_observations(id), image_id uuid, witness_role text);
CREATE INDEX idx_observation_witnesses_image ON public.observation_witnesses (image_id);
CREATE TABLE public.schema_proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, motivating_observation_ids uuid[]);
ALTER TABLE public.image_observations ADD COLUMN embedding_clip_vitb32 real[];
-- the landing the trigger calls: a recorder, so the contract can see that it ran
CREATE TABLE public.land_calls (image_id uuid, include_classifier boolean);
CREATE FUNCTION public.photo_land_classification(p_image_id uuid, p_include_classifier boolean) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.land_calls VALUES (p_image_id, p_include_classifier) $$;

-- the trigger function as the repository defined it (20261109213000) and the two triggers as production holds them
CREATE OR REPLACE FUNCTION public.photo_land_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  -- A deep-result-only update changes camera testimony, not the classifier.
  -- Keep classifier/filing transitions on the original full landing path.
  PERFORM public.photo_land_classification(NEW.id,
    OLD.ai_processing_status IS DISTINCT FROM 'completed'
    OR OLD.ai_scan_metadata->'classification' IS DISTINCT FROM NEW.ai_scan_metadata->'classification'
    OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
    OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'photo_land_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER a06_trg_land_classification AFTER UPDATE OF ai_processing_status, ai_scan_metadata ON public.vehicle_images FOR EACH ROW WHEN (((new.ai_processing_status = 'completed'::text) AND (new.ai_scan_metadata ? 'classification'::text) AND ((old.ai_processing_status IS DISTINCT FROM 'completed'::text) OR ((old.ai_scan_metadata -> 'classification'::text) IS DISTINCT FROM (new.ai_scan_metadata -> 'classification'::text)) OR ((old.ai_scan_metadata -> 'byok_deep_analysis'::text) IS DISTINCT FROM (new.ai_scan_metadata -> 'byok_deep_analysis'::text))))) EXECUTE FUNCTION photo_land_trigger();
CREATE TRIGGER a07_trg_land_on_filing AFTER UPDATE OF vehicle_id, vision_gate_status ON public.vehicle_images FOR EACH ROW WHEN (((new.ai_processing_status = 'completed'::text) AND (new.vehicle_id IS NOT NULL) AND (new.ai_scan_metadata ? 'classification'::text) AND ((old.vehicle_id IS NULL) OR (old.vision_gate_status IS DISTINCT FROM new.vision_gate_status)))) EXECUTE FUNCTION photo_land_trigger();

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.img(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.obs(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.raises(stmt text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAILED: % (no error raised)', msg;
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAILED:%' THEN RAISE; END IF; END $$;
-- the scope, as the later migration will write it
CREATE FUNCTION pg_temp.scope(cfg jsonb) RETURNS void LANGUAGE sql AS
  $$ UPDATE public.platform_config SET config_value = cfg WHERE config_key = 'image_stage_deep_reading' $$;

-- the migrations the change builds on, in order
\ir ../migrations/20261113100000_photo_reading_flow_assay.sql
\ir ../migrations/20261113120000_photo_reading_flow_assay_v2.sql
\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql
\ir ../migrations/20261113130000_image_stage_reconciler_first_pass.sql
\ir ../migrations/20261113140000_image_stage_reconciler_refill.sql
\ir ../migrations/20261116042000_image_stage_coverage_model_gain.sql
-- production's classifier stage has no contract (the v98 seed was cleared); the reconciler is on, for the one reader's user
UPDATE image_pipeline_stages SET contract = NULL WHERE stage = 'classifier';
UPDATE platform_config SET config_value = '{"enabled": true, "max_open": 300, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "live_days": 2, "refill_below": 100, "scan_per_lane": 200, "backfill_share": 0.5, "min_age_minutes": 15}'
 WHERE config_key = 'image_stage_reconciler';

-- ===== fixture before the migration: one reader's user, two vehicles and a vehicle that is never in scope
--   U1 is the reader's user; U2 is someone else. V1, V2 filed vehicles; VX the excluded one.
CREATE FUNCTION pg_temp.u1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE FUNCTION pg_temp.u2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000a2'::uuid $$;
CREATE FUNCTION pg_temp.v1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000b1'::uuid $$;
CREATE FUNCTION pg_temp.v2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000b2'::uuid $$;
CREATE FUNCTION pg_temp.vx() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000bf'::uuid $$;
-- a photo: filed to V1 by default, approved, first-read, owned by U1, an hour old
CREATE FUNCTION pg_temp.mk(n int, veh uuid DEFAULT NULL, usr uuid DEFAULT NULL, age interval DEFAULT interval '1 hour',
  meta jsonb DEFAULT '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true}}', gate text DEFAULT 'approved',
  status text DEFAULT 'completed', doc boolean DEFAULT NULL, docflag boolean DEFAULT NULL, sens boolean DEFAULT NULL,
  dup boolean DEFAULT NULL, ext boolean DEFAULT NULL, match text DEFAULT NULL, unfiled boolean DEFAULT false) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (id, user_id, vehicle_id, image_url, created_at, is_duplicate, is_sensitive, is_external, is_document, doc_flag,
    image_vehicle_match_status, vision_gate_status, ai_processing_status, ai_scan_metadata)
  VALUES (pg_temp.img(n), coalesce(usr, pg_temp.u1()), CASE WHEN unfiled THEN NULL ELSE coalesce(veh, pg_temp.v1()) END,
    'https://example.test/' || n || '.jpg', now() - age, dup, sens, ext, doc, docflag, match, gate, status, meta)
  RETURNING id $$;
-- a reading stamped as the reviewed-analysis intake stamps it, with the observation it came from
CREATE FUNCTION pg_temp.reading(n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT jsonb_build_object('classification', jsonb_build_object('image_type', 'exterior', 'confidence', 0.9, 'classifier_ok', true),
       'byok_deep_analysis', jsonb_build_object('scene_type', 'exterior', 'observation_id', pg_temp.obs(n))) $$;
-- the reading's own observation (the projection's parent)
CREATE FUNCTION pg_temp.parent(n int, veh uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data)
  VALUES (pg_temp.obs(n), coalesce(veh, pg_temp.v1()), 'condition',
          jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(n))) $$;
-- a projected child for a reading (a keyed value witnessed by the photo)
CREATE FUNCTION pg_temp.child(n int, source_n int DEFAULT NULL, veh uuid DEFAULT NULL, sup boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, property_id, is_superseded, extraction_method)
  VALUES (cid, coalesce(veh, pg_temp.v1()), 'condition',
          jsonb_build_object('analysis_kind', 'image_property_projection', 'image_id', pg_temp.img(n),
                             'source_observation_id', pg_temp.obs(coalesce(source_n, n))), gen_random_uuid(), sup, 'cached_byok_property_projection_v1');
  INSERT INTO public.observation_witnesses VALUES (cid, pg_temp.img(n), 'subject');
END $$;
CREATE FUNCTION pg_temp.has_gap(n int, st text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.image_stage_gaps(ARRAY[pg_temp.img(n)]) g WHERE g.stage = st) $$;
CREATE FUNCTION pg_temp.open_items(n int, st text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.image_stage_work WHERE image_id = pg_temp.img(n) AND stage = st AND status IN ('queued', 'claimed') $$;

-- Before the change: six photos and the first-read stage's view of them
SELECT pg_temp.mk(1);                                                                    -- first-read, filed: no classifier gap
SELECT pg_temp.mk(2, status => 'pending', meta => '{}');                                               -- not read yet: a classifier gap
SELECT pg_temp.mk(3, meta => '{}', status => 'completed');                               -- completed with no classification: gap
SELECT pg_temp.mk(4, meta => pg_temp.reading(4));                                        -- a reading
SELECT pg_temp.mk(5, unfiled => true, status => 'pending', meta => '{}');                              -- unfiled, unread
SELECT pg_temp.mk(6, usr => pg_temp.u2(), status => 'pending', meta => '{}');                          -- another user, unread
SELECT pg_temp.parent(4);
CREATE TEMP TABLE before_gaps AS SELECT g.image_id, g.stage, g.reason, g.target_version FROM public.image_stage_gaps(
  ARRAY[pg_temp.img(1), pg_temp.img(2), pg_temp.img(3), pg_temp.img(4), pg_temp.img(5), pg_temp.img(6)]) g;
SELECT pg_temp.ok((SELECT count(*) FROM before_gaps) = 4, 'precondition: four classifier gaps before the change');
CREATE TEMP TABLE before_state AS SELECT public.image_stage_coverage(pg_temp.v1()) AS cov, public.image_stage_coverage() AS allcov,
  pg_get_function_identity_arguments('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)'::regprocedure) AS rec_args,
  pg_get_function_result('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)'::regprocedure) AS rec_result;

\ir ../migrations/20261120130000_photo_deep_reading_keyed_values_stages.sql

-- ===== 1. registry, scope row, grants
SELECT pg_temp.ok((SELECT required AND applies_when = 'filed_for_reading' AND required_version = 1 AND max_attempts = 6 AND backfill_daily_cap = 150
                     AND producer = 'photo-pipeline-orchestrator' FROM image_pipeline_stages WHERE stage = 'deep_reading'), 'deep_reading registered: required, filed_for_reading, cap 150');
SELECT pg_temp.ok((SELECT required AND applies_when = 'deep_reading_landed' AND required_version = 1 AND max_attempts = 6 AND backfill_daily_cap IS NULL
                     AND producer = 'ingest-observation-batch' FROM image_pipeline_stages WHERE stage = 'keyed_values'), 'keyed_values registered: required, deep_reading_landed, no cap');
SELECT pg_temp.ok((SELECT backfill_daily_cap IS NULL AND applies_when = 'always' AND required FROM image_pipeline_stages WHERE stage = 'classifier'), 'classifier row untouched');
SELECT pg_temp.ok((SELECT count(*) FROM image_pipeline_stages WHERE backfill_daily_cap IS NOT NULL) = 1, 'only deep_reading is capped');
SELECT pg_temp.raises($q$UPDATE image_pipeline_stages SET applies_when = 'weekly' WHERE stage = 'deep_reading'$q$, 'applies_when stays a closed vocabulary');
SELECT pg_temp.ok((SELECT config_value ->> 'enabled' = 'false' AND config_value -> 'user_ids' = '["0b9f107a-d124-49de-9ded-94698f63c1c4"]'::jsonb
                     AND jsonb_array_length(config_value -> 'vehicle_ids') = 2 AND jsonb_array_length(config_value -> 'exclude_vehicle_ids') = 2
                     FROM platform_config WHERE config_key = 'image_stage_deep_reading'), 'scope row: off, one user, two vehicles, two exclusions');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.enqueue_image_stage_work(uuid[],text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.enqueue_image_stage_work(uuid[],text)', 'execute')
  AND has_function_privilege('service_role', 'public.enqueue_image_stage_work(uuid[],text)', 'execute'), 'enqueue: service role only');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.image_stage_levels(uuid)', 'execute')
  AND has_function_privilege('authenticated', 'public.image_stage_levels(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.image_stage_levels(uuid)', 'execute'), 'levels: not anon; the owner and the service role');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.image_stage_photo_levels(uuid,uuid)', 'execute')
  AND NOT has_function_privilege('anon', 'public.image_stage_level_counts(uuid,uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_levels_json(uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_backfill_cap_left(text)', 'execute'), 'the per-photo helpers are not callable by users');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.image_stage_coverage(uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_coverage(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.image_stage_coverage(uuid)', 'execute'), 'coverage keeps its grants');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.assay_photo_reading_flow(boolean)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.assay_photo_reading_flow(boolean)', 'execute'), 'the assay keeps its grants');
SELECT pg_temp.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.image_stage_coverage(uuid)'::regprocedure)
  AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.image_stage_coverage(uuid)'::regprocedure) = ARRAY['search_path=""'],
  'image_stage_coverage(uuid) keeps SECURITY DEFINER and its empty search_path');
SELECT pg_temp.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.assay_photo_reading_flow(boolean)'::regprocedure)
  AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.assay_photo_reading_flow(boolean)'::regprocedure) = ARRAY['search_path=public, pg_temp'], 'the assay keeps SECURITY DEFINER and its search_path');
SELECT pg_temp.ok((SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.enqueue_image_stage_work(uuid[],text)'::regprocedure), 'enqueue is SECURITY DEFINER with a pinned search_path');
SELECT pg_temp.ok((SELECT rec_args = pg_get_function_identity_arguments('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)'::regprocedure)
  AND rec_result = pg_get_function_result('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)'::regprocedure) FROM before_state),
  'record_image_stage_receipt: same arguments and return type');

-- ===== 2. deploying with the scope off changes nothing observable
SELECT pg_temp.ok((SELECT count(*) = 0 FROM (
  (SELECT image_id, stage, reason, target_version FROM before_gaps EXCEPT SELECT g.image_id, g.stage, g.reason, g.target_version FROM image_stage_gaps(ARRAY[pg_temp.img(1), pg_temp.img(2), pg_temp.img(3), pg_temp.img(4), pg_temp.img(5), pg_temp.img(6)]) g)
  UNION ALL
  (SELECT g.image_id, g.stage, g.reason, g.target_version FROM image_stage_gaps(ARRAY[pg_temp.img(1), pg_temp.img(2), pg_temp.img(3), pg_temp.img(4), pg_temp.img(5), pg_temp.img(6)]) g EXCEPT SELECT image_id, stage, reason, target_version FROM before_gaps)) x),
  'scope off: the classifier stage''s gaps are exactly what they were');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(1), pg_temp.img(2), pg_temp.img(3), pg_temp.img(4), pg_temp.img(5), pg_temp.img(6)]) g WHERE g.stage <> 'classifier'),
  'scope off: no photo is a gap of deep_reading or keyed_values');
SELECT pg_temp.ok(public.enqueue_image_stage_work(ARRAY[pg_temp.img(1), pg_temp.img(4)]) = 0 AND (SELECT count(*) FROM image_stage_work) = 0, 'scope off: the enqueue finds nothing and queues nothing');
-- a trigger fire with the scope off lands the classification and queues nothing
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"classification":{"image_type":"interior","confidence":0.8,"classifier_ok":true}}' WHERE id = pg_temp.img(1);
SELECT pg_temp.ok((SELECT count(*) FROM land_calls WHERE image_id = pg_temp.img(1) AND include_classifier) = 1 AND (SELECT count(*) FROM image_stage_work) = 0,
  'scope off: photo_land_trigger lands the classification and queues nothing');
-- the reconciler queues the classifier's work as it did (photos 2, 3 and 5 are old enough), and nothing else
UPDATE public.vehicle_images SET created_at = now() - interval '1 day' WHERE id IN (pg_temp.img(2), pg_temp.img(3));
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT array_agg(image_id::text || stage ORDER BY image_id) FROM image_stage_work)
  = ARRAY[pg_temp.img(2)::text || 'classifier', pg_temp.img(3)::text || 'classifier', pg_temp.img(5)::text || 'classifier'],
  'scope off: the reconciler queues the three classifier gaps (photos 2, 3 and 5) and nothing else');
SELECT pg_temp.ok((SELECT before_state.cov -> 'model_gain' = public.image_stage_coverage(pg_temp.v1()) -> 'model_gain' FROM before_state)
  AND NOT (SELECT before_state.cov ? 'levels' FROM before_state) AND public.image_stage_coverage(pg_temp.v1()) ? 'levels',
  'coverage(uuid): model_gain is unchanged, levels is new');
SELECT pg_temp.ok((SELECT (allcov -> 'stages' -> 'classifier') - ARRAY['open', 'closed', 'current_receipt_by_outcome', 'receipts_6h', 'receipts_24h', 'last_receipt_at', 'out_of_attempts']
  = ((public.image_stage_coverage() -> 'stages' -> 'classifier') - ARRAY['open', 'closed', 'current_receipt_by_outcome', 'receipts_6h', 'receipts_24h', 'last_receipt_at', 'out_of_attempts']) FROM before_state)
  AND (SELECT count(*) FROM jsonb_object_keys(public.image_stage_coverage() -> 'stages')) = 6, 'coverage(): the classifier stage''s registry block is unchanged; the two new stages are listed');
DELETE FROM image_stage_work;
DELETE FROM public.land_calls;
DELETE FROM public.observation_witnesses;
DELETE FROM public.vehicle_observations;
DELETE FROM public.vehicle_images;

-- ===== 3. the gap finder with the scope on
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "vehicle_ids": ["00000000-0000-4000-8000-0000000000b1"],
  "exclude_vehicle_ids": ["00000000-0000-4000-8000-0000000000bf"]}');
-- legacy evidence: a reading with a scene_type, whoever made it
SELECT pg_temp.ok(image_stage_legacy_evidence('deep_reading', '{"byok_deep_analysis":{"scene_type":"exterior"}}', NULL), 'a reading with a scene_type is evidence');
SELECT pg_temp.ok(NOT image_stage_legacy_evidence('deep_reading', m::jsonb, NULL), 'not a reading: ' || m)
  FROM unnest(ARRAY['{}', '{"byok_deep_analysis":{}}', '{"byok_deep_analysis":{"scene_type":null}}', '{"byok_deep_analysis":{"scene_type":""}}',
    '{"byok_deep_analysis":{"scene_type":7}}', '{"byok_deep_analysis":"exterior"}', '{"byok_deep_analysis":[]}', '{"classification":{"image_type":"exterior"}}']) AS m;
SELECT pg_temp.ok(image_stage_legacy_version('deep_reading', '{"byok_deep_analysis":{"scene_type":"x"}}') IS NOT NULL
  AND image_stage_legacy_version('deep_reading', '{}') IS NULL AND image_stage_legacy_evidence('keyed_values', '{"byok_deep_analysis":{"scene_type":"x"}}', NULL) IS FALSE,
  'the legacy version names a reading; keyed_values has no legacy evidence (it is judged in the gap finder)');
-- photos
SELECT pg_temp.mk(10);                                                                   -- filed, approved, first-read, no reading: deep gap
SELECT pg_temp.mk(11, meta => pg_temp.reading(11)); SELECT pg_temp.parent(11);           -- reading, parent, no child: keyed gap
SELECT pg_temp.mk(12, meta => pg_temp.reading(12)); SELECT pg_temp.parent(12); SELECT pg_temp.child(12);   -- child for the current reading
SELECT pg_temp.mk(13, meta => pg_temp.reading(13)); SELECT pg_temp.parent(13); SELECT pg_temp.child(13, source_n => 99);  -- child of an older reading only
SELECT pg_temp.mk(14, meta => pg_temp.reading(14)); SELECT pg_temp.parent(14); SELECT pg_temp.child(14, sup => true);     -- child superseded
SELECT pg_temp.mk(15, meta => '{"classification":{"image_type":"exterior"},"byok_deep_analysis":{"scene_type":"exterior"}}');  -- reading without an observation id
SELECT pg_temp.mk(16, meta => pg_temp.reading(16));                                      -- observation id, but no such observation
SELECT pg_temp.mk(17, meta => pg_temp.reading(17)); SELECT pg_temp.parent(17, pg_temp.v2());   -- the observation belongs to another vehicle
SELECT pg_temp.mk(18, meta => pg_temp.reading(18)); INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, is_superseded)
  VALUES (pg_temp.obs(18), pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(18)), true);  -- the observation was superseded
SELECT pg_temp.mk(20, veh => pg_temp.v2());                                              -- another vehicle, not in vehicle_ids
SELECT pg_temp.mk(21, veh => pg_temp.vx());                                              -- the excluded vehicle
SELECT pg_temp.mk(22, unfiled => true);
SELECT pg_temp.mk(23, doc => true);
SELECT pg_temp.mk(24, docflag => true);
SELECT pg_temp.mk(25, sens => true);
SELECT pg_temp.mk(26, gate => 'rejected_personal');
SELECT pg_temp.mk(27, gate => 'pending');
SELECT pg_temp.mk(28, match => 'mismatch');
SELECT pg_temp.mk(29, match => 'unrelated');
SELECT pg_temp.mk(30, status => 'pending', meta => '{}');                                              -- not read yet
SELECT pg_temp.mk(31, dup => true);
SELECT pg_temp.mk(32, ext => true);
SELECT pg_temp.mk(33, usr => pg_temp.u2());                                              -- another user
SELECT pg_temp.mk(34); UPDATE public.vehicle_images SET is_superseded = true WHERE id = pg_temp.img(34);
SELECT pg_temp.mk(35, gate => NULL);                                                     -- no gate verdict: the intake treats it as approved
SELECT pg_temp.mk(36, match => 'pending');
SELECT pg_temp.mk(40);                                                                   -- deep_reading closed by a policy_skip receipt
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail) VALUES (pg_temp.img(40), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', '{"reason":"not_a_vehicle_photo"}');
SELECT pg_temp.mk(41, meta => pg_temp.reading(41)); SELECT pg_temp.parent(41);           -- keyed_values closed by a policy_skip receipt
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail) VALUES (pg_temp.img(41), 'keyed_values', 'ingest-observation-batch', 1, 'policy_skip', '{"reason":"no_known_scalar_values"}');
SELECT pg_temp.mk(42, meta => pg_temp.reading(42));                                      -- a reading, and a stale unavailable receipt that is due for retry
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, retry_after) VALUES (pg_temp.img(42), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'unavailable', 'reader_down', now() - interval '1 minute');
SELECT pg_temp.mk(43);                                                                   -- no reading and an unavailable receipt that is due: retryable
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, retry_after) VALUES (pg_temp.img(43), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'unavailable', 'reader_down', now() - interval '1 minute');
SELECT pg_temp.mk(44);                                                                   -- no reading, but a succeeded receipt
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (pg_temp.img(44), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded');
SELECT pg_temp.mk(45);                                                                   -- no reading, an unavailable receipt not yet due
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, retry_after) VALUES (pg_temp.img(45), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'rate_limited', 'rate_limited', now() + interval '1 hour');

-- a photo that already holds a deep reading is never a deep_reading gap (whatever its receipts say)
SELECT pg_temp.ok(NOT pg_temp.has_gap(n, 'deep_reading'), 'photo ' || n || ' holds a reading: never a deep_reading gap') FROM unnest(ARRAY[11, 12, 13, 14, 15, 16, 17, 18, 42]) n;
-- filed, approved, first-read, in scope, no reading: a gap
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(10)]) WHERE stage = 'deep_reading') = 'missing', 'photo 10: a deep_reading gap, reason missing');
SELECT pg_temp.ok(pg_temp.has_gap(35, 'deep_reading') AND pg_temp.has_gap(36, 'deep_reading'), 'a missing gate verdict and a pending match status are not refusals');
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'keyed_values'), 'no reading, so no keyed_values gap');
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(43)]) WHERE stage = 'deep_reading') = 'retryable_outcome', 'photo 43: an unavailable receipt that is due is a retryable gap');
-- the same photo out of scope, unfiled, a document, sensitive, with a rejected gate, ... is not
SELECT pg_temp.ok(NOT pg_temp.has_gap(n, 'deep_reading') AND NOT pg_temp.has_gap(n, 'keyed_values'),
  'photo ' || n || ' is not a gap of either reading stage') FROM unnest(ARRAY[20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]) n;
SELECT pg_temp.ok(pg_temp.has_gap(30, 'classifier'), 'photo 30 (not read yet) is still a classifier gap');
-- closed by a receipt
SELECT pg_temp.ok(NOT pg_temp.has_gap(40, 'deep_reading'), 'a policy_skip receipt closes deep_reading');
SELECT pg_temp.ok(NOT pg_temp.has_gap(41, 'keyed_values'), 'a policy_skip receipt closes keyed_values');
SELECT pg_temp.ok(NOT pg_temp.has_gap(44, 'deep_reading') AND NOT pg_temp.has_gap(45, 'deep_reading'), 'a succeeded receipt and a retry not yet due are not gaps');
-- keyed_values: a reading with a projectable parent and no child for it
SELECT pg_temp.ok(pg_temp.has_gap(11, 'keyed_values') AND (SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(11)]) WHERE stage = 'keyed_values') = 'missing',
  'photo 11: a reading and no projected child is a keyed_values gap');
SELECT pg_temp.ok(NOT pg_temp.has_gap(12, 'keyed_values'), 'photo 12: a child for the current reading satisfies keyed_values');
SELECT pg_temp.ok(pg_temp.has_gap(13, 'keyed_values'), 'photo 13: a child of an older reading does not');
SELECT pg_temp.ok(pg_temp.has_gap(14, 'keyed_values'), 'photo 14: a superseded child does not');
SELECT pg_temp.ok(NOT pg_temp.has_gap(15, 'keyed_values') AND NOT pg_temp.has_gap(16, 'keyed_values') AND NOT pg_temp.has_gap(17, 'keyed_values') AND NOT pg_temp.has_gap(18, 'keyed_values'),
  'no observation id, no such observation, another vehicle''s observation, a superseded observation: the projection has no parent, so no gap');
-- the gap stops being one when a child for the current reading lands
SELECT pg_temp.child(11);
SELECT pg_temp.ok(NOT pg_temp.has_gap(11, 'keyed_values'), 'photo 11: stops being a gap when a child for the current reading exists');
SELECT pg_temp.child(13, source_n => 13);
SELECT pg_temp.ok(NOT pg_temp.has_gap(13, 'keyed_values'), 'photo 13: and when the child of the current reading arrives');
-- a new reading (a new observation) makes the old child stale
UPDATE public.vehicle_images SET ai_scan_metadata = jsonb_set(ai_scan_metadata, '{byok_deep_analysis,observation_id}', to_jsonb(pg_temp.obs(112)::text)) WHERE id = pg_temp.img(11);
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data) VALUES (pg_temp.obs(112), pg_temp.v1(), 'condition',
  jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(11)));
SELECT pg_temp.ok(pg_temp.has_gap(11, 'keyed_values'), 'photo 11: a re-read photo is a keyed_values gap again until its new reading is projected');
-- a keyed_values receipt closes the stage for the reading it was written for, not for a later one
SELECT pg_temp.mk(46, meta => pg_temp.reading(46)); SELECT pg_temp.parent(46);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, observed_at) VALUES (pg_temp.img(46), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', now() + interval '1 minute');
SELECT pg_temp.mk(47, meta => pg_temp.reading(47)); SELECT pg_temp.parent(47);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, observed_at) VALUES (pg_temp.img(47), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', now() - interval '1 day');
SELECT pg_temp.mk(48, meta => pg_temp.reading(48)); SELECT pg_temp.parent(48);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail, observed_at) VALUES (pg_temp.img(48), 'keyed_values', 'ingest-observation-batch', 1, 'policy_skip', '{"reason":"no_known_scalar_values"}', now() - interval '1 day');
SELECT pg_temp.ok(NOT pg_temp.has_gap(46, 'keyed_values'), 'a receipt written after the reading closes keyed_values');
SELECT pg_temp.ok(pg_temp.has_gap(47, 'keyed_values') AND (SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(47)]) WHERE stage = 'keyed_values') = 'outdated',
  'a succeeded receipt that predates the current reading does not close keyed_values: outdated');
SELECT pg_temp.ok(pg_temp.has_gap(48, 'keyed_values'), 'nor does a policy_skip receipt that predates the current reading');
SELECT pg_temp.child(47);
SELECT pg_temp.ok(NOT pg_temp.has_gap(47, 'keyed_values'), 'a child for the current reading closes it whatever the receipts say');
-- A reading that exists as an observation is never read again, whether or not the photo's stamp says so (older readings carry
-- no observation id, and some photos hold the observation with no stamp at all). The observation is the evidence.
SELECT pg_temp.mk(200); SELECT pg_temp.parent(200);                                      -- the reading's observation, no stamp
SELECT pg_temp.mk(201, meta => '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true},"byok_deep_analysis":{"scene_type":"exterior"}}');
SELECT pg_temp.parent(201);                                                              -- a stamp with no observation id, and its observation
SELECT pg_temp.ok(NOT pg_temp.has_gap(200, 'deep_reading'), 'photo 200 holds a reading observation and no stamp: never read again');
SELECT pg_temp.ok(pg_temp.has_gap(200, 'keyed_values') AND (SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(200)]) WHERE stage = 'keyed_values') = 'missing',
  'photo 200: its reading is found by its observation, so keyed_values is a gap');
SELECT pg_temp.ok(NOT pg_temp.has_gap(201, 'deep_reading') AND pg_temp.has_gap(201, 'keyed_values'), 'photo 201: a stamp with no observation id still has its keyed_values found');
SELECT pg_temp.child(201);
SELECT pg_temp.ok(NOT pg_temp.has_gap(201, 'keyed_values'), 'photo 201: and a child of that reading closes it');
-- a photo whose stamp names another, superseded observation: the current one is used
SELECT pg_temp.mk(205, meta => pg_temp.reading(205)); SELECT pg_temp.parent(205);
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, is_superseded) VALUES (pg_temp.obs(215), pg_temp.v1(), 'condition',
  jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(205)), true);
UPDATE public.vehicle_images SET ai_scan_metadata = jsonb_set(ai_scan_metadata, '{byok_deep_analysis,observation_id}', to_jsonb(pg_temp.obs(215)::text)) WHERE id = pg_temp.img(205);
SELECT pg_temp.child(205);
SELECT pg_temp.ok(NOT pg_temp.has_gap(205, 'keyed_values'), 'photo 205: a stamp naming a superseded observation falls back to the current one');
-- a receipt that predates the reading reopens the stage once, not forever: a later receipt of the current reading answers
SELECT pg_temp.mk(203, meta => pg_temp.reading(203)); SELECT pg_temp.parent(203);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, observed_at) VALUES (pg_temp.img(203), 'keyed_values', 'ingest-observation-batch', 1, 'policy_skip', 1, now() - interval '1 day');
SELECT pg_temp.ok(pg_temp.has_gap(203, 'keyed_values'), 'photo 203: a policy_skip receipt older than the reading reopens keyed_values');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, error_class, observed_at) VALUES (pg_temp.img(203), 'keyed_values', 'ingest-observation-batch', 1, 'failed', 2, 'projection_error', now() + interval '1 minute');
SELECT pg_temp.ok(NOT pg_temp.has_gap(203, 'keyed_values'), 'photo 203: a failed receipt for the current reading closes it again (no loop)');
SELECT pg_temp.mk(204, meta => pg_temp.reading(204)); SELECT pg_temp.parent(204);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, observed_at) VALUES (pg_temp.img(204), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', 1, now() - interval '1 day');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, error_class, retry_after, observed_at) VALUES (pg_temp.img(204), 'keyed_values', 'ingest-observation-batch', 1, 'unavailable', 2, 'reader_down', now() + interval '1 hour', now() + interval '1 minute');
SELECT pg_temp.ok(NOT pg_temp.has_gap(204, 'keyed_values'), 'photo 204: an unavailable receipt for the current reading waits for its retry_after');
UPDATE image_stage_receipts SET retry_after = now() - interval '1 minute' WHERE image_id = pg_temp.img(204) AND outcome = 'unavailable';
SELECT pg_temp.ok(pg_temp.has_gap(204, 'keyed_values'), 'photo 204: and is retried once it is due');
UPDATE image_stage_receipts SET attempt = 6 WHERE image_id = pg_temp.img(204) AND outcome = 'unavailable';
SELECT pg_temp.ok(NOT pg_temp.has_gap(204, 'keyed_values'), 'photo 204: and not past max_attempts');
-- the photos of this block are not part of the later sections
DELETE FROM public.observation_witnesses WHERE image_id IN (SELECT pg_temp.img(n) FROM generate_series(200, 205) n);
DELETE FROM image_stage_receipts WHERE image_id IN (SELECT pg_temp.img(n) FROM generate_series(200, 205) n);
DELETE FROM public.vehicle_observations WHERE structured_data ->> 'image_id' IN (SELECT pg_temp.img(n)::text FROM generate_series(200, 205) n);
DELETE FROM public.vehicle_images WHERE id IN (SELECT pg_temp.img(n) FROM generate_series(200, 205) n);
-- scope variations
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "exclude_vehicle_ids": ["00000000-0000-4000-8000-0000000000bf"]}');
SELECT pg_temp.ok(pg_temp.has_gap(20, 'deep_reading') AND NOT pg_temp.has_gap(21, 'deep_reading') AND pg_temp.has_gap(10, 'deep_reading') AND NOT pg_temp.has_gap(33, 'deep_reading'),
  'no vehicle_ids: every vehicle of the user but the excluded one');
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "vehicle_ids": []}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'deep_reading'), 'an empty vehicle_ids array puts nothing in scope');
SELECT pg_temp.scope('{"enabled": true, "user_ids": [], "vehicle_ids": ["00000000-0000-4000-8000-0000000000b1"]}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'deep_reading'), 'no user in user_ids: nothing in scope');
SELECT pg_temp.scope('{"enabled": "true", "user_ids": ["00000000-0000-4000-8000-0000000000a1"]}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'deep_reading'), 'enabled must be the JSON boolean true');
SELECT pg_temp.scope('{"enabled": false, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "vehicle_ids": ["00000000-0000-4000-8000-0000000000b1"]}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'deep_reading') AND NOT pg_temp.has_gap(11, 'keyed_values'), 'switched off: no gap');
DELETE FROM platform_config WHERE config_key = 'image_stage_deep_reading';
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'deep_reading'), 'no scope row: no gap, and no error');
INSERT INTO platform_config (config_key, config_value) VALUES ('image_stage_deep_reading', '{}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(10, 'deep_reading'), 'an empty scope row: no gap');
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "vehicle_ids": ["00000000-0000-4000-8000-0000000000b1"],
  "exclude_vehicle_ids": ["00000000-0000-4000-8000-0000000000bf"]}');
-- the classifier stage is unchanged by any of it: a gap exactly when it was
SELECT pg_temp.ok(pg_temp.has_gap(30, 'classifier') AND NOT pg_temp.has_gap(10, 'classifier') AND NOT pg_temp.has_gap(11, 'classifier'), 'the classifier stage still judges first reads alone');

-- ===== 4. enqueue_image_stage_work
DELETE FROM image_stage_work; DELETE FROM land_calls;
CREATE TEMP TABLE all_ids AS SELECT array_agg(id) AS ids FROM public.vehicle_images;
-- the gaps now: deep_reading for 10, 35, 36, 43; keyed_values for 11 (re-read), 14 and 48 (receipt older than its reading)
SELECT pg_temp.ok((SELECT count(*) = 7 FROM image_stage_gaps((SELECT ids FROM all_ids)) g WHERE g.stage IN ('deep_reading', 'keyed_values')), 'precondition: seven gaps of the two reading stages');
SELECT public.enqueue_image_stage_work((SELECT ids FROM all_ids)) AS n \gset
SELECT pg_temp.ok(:n = 7 AND (SELECT count(*) FROM image_stage_work WHERE status = 'queued') = 7, 'exactly one open item per gap');
SELECT pg_temp.ok((SELECT count(*) = 7 AND bool_and(lane = 'live' AND target_version = 1 AND reason IN ('missing', 'retryable_outcome', 'outdated')) FROM image_stage_work), 'photos an hour old are the live lane');
SELECT pg_temp.ok(pg_temp.open_items(10, 'deep_reading') = 1 AND pg_temp.open_items(11, 'keyed_values') = 1 AND pg_temp.open_items(14, 'keyed_values') = 1
  AND pg_temp.open_items(20, 'deep_reading') = 0 AND pg_temp.open_items(30, 'deep_reading') = 0 AND pg_temp.open_items(30, 'classifier') = 0,
  'only the gaps of the two reading stages: nothing out of scope, nothing for the first read');
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0 AND (SELECT count(*) FROM image_stage_work) = 7, 'a second call queues nothing: the stage already has an open item');
UPDATE image_stage_work SET status = 'claimed', lease_until = now() + interval '5 minutes' WHERE image_id = pg_temp.img(10);
SELECT pg_temp.ok(public.enqueue_image_stage_work(ARRAY[pg_temp.img(10)]) = 0 AND pg_temp.open_items(10, 'deep_reading') = 1, 'a claimed item counts as open');
-- off switches
DELETE FROM image_stage_work;
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0 AND (SELECT count(*) FROM image_stage_work) = 0, 'the ledger switched off: nothing is queued');
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_reconciler';
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_deep_reading';
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0 AND (SELECT count(*) FROM image_stage_work) = 0, 'the reading scope switched off: nothing is queued');
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_deep_reading';
SELECT pg_temp.ok(public.enqueue_image_stage_work('{}') = 0 AND public.enqueue_image_stage_work(NULL) = 0, 'an empty or null list queues nothing');
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids), 'weekly') = 0 AND (SELECT count(*) FROM image_stage_work) = 0, 'an unknown lane queues nothing and does not raise');
-- a photo of a user the reconciler is not configured for is skipped even when the scope names the user
SELECT pg_temp.mk(37, usr => pg_temp.u2());
UPDATE platform_config SET config_value = jsonb_set(config_value, '{user_ids}', '["00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000a2"]') WHERE config_key = 'image_stage_deep_reading';
SELECT pg_temp.ok(public.enqueue_image_stage_work(ARRAY[pg_temp.img(37)]) = 0, 'no row belongs to a configured user: 0');
UPDATE platform_config SET config_value = jsonb_set(config_value, '{user_ids}', '["00000000-0000-4000-8000-0000000000a1"]') WHERE config_key = 'image_stage_deep_reading';
DELETE FROM public.vehicle_images WHERE id = pg_temp.img(37);
-- max_open
UPDATE platform_config SET config_value = config_value || '{"max_open": 4}' WHERE config_key = 'image_stage_reconciler';
SELECT public.enqueue_image_stage_work((SELECT ids FROM all_ids)) AS n \gset
SELECT pg_temp.ok(:n = 4 AND (SELECT count(*) FROM image_stage_work) = 4, 'the queue is filled to max_open and no further');
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0, 'a queue at max_open takes nothing');
UPDATE platform_config SET config_value = config_value || '{"max_open": 300}' WHERE config_key = 'image_stage_reconciler';
-- never raises
UPDATE platform_config SET config_value = config_value || '{"enabled": "abc"}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0, 'a config it cannot read: 0 with a warning, no error');
UPDATE platform_config SET config_value = config_value || '{"enabled": true, "max_open": "many"}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0, 'a max_open it cannot read: 0, no error');
UPDATE platform_config SET config_value = config_value || '{"max_open": 300}' WHERE config_key = 'image_stage_reconciler';
DELETE FROM image_stage_work;
-- the two reading stages have a room of their own in the queue, so they cannot fill it and stop the first read being queued
SELECT pg_temp.ok(image_stage_stage_room('deep_reading') = 100 AND image_stage_stage_room('keyed_values') = 100 AND image_stage_stage_room('classifier') IS NULL AND image_stage_stage_room('nope') IS NULL,
  'stage room: 100 per reading stage by default, none for the first read');
UPDATE platform_config SET config_value = config_value || '{"max_open": 3}' WHERE config_key = 'image_stage_deep_reading';
SELECT public.enqueue_image_stage_work((SELECT ids FROM all_ids)) AS n \gset
SELECT pg_temp.ok(:n = 6 AND (SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading') = 3 AND (SELECT count(*) FROM image_stage_work WHERE stage = 'keyed_values') = 3,
  'each reading stage stops at its own room (four deep_reading gaps queue three; keyed_values has three)');
SELECT pg_temp.ok(image_stage_stage_room('deep_reading') = 0 AND public.enqueue_image_stage_work((SELECT ids FROM all_ids)) = 0, 'a stage with no room takes nothing');
-- a classifier gap is still queued while the reading stages are full
INSERT INTO public.vehicle_images (id, user_id, vehicle_id, image_url, created_at, vision_gate_status, ai_processing_status, ai_scan_metadata)
  VALUES (pg_temp.img(57), pg_temp.u1(), pg_temp.v1(), 'https://example.test/57.jpg', now() - interval '1 hour', 'approved', 'pending', '{}');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work) = 6 AND pg_temp.has_gap(57, 'classifier'), 'the first read of a new photo is a gap while six reading items are open (the reconciler queues it: max_open 300)');
DELETE FROM image_stage_work;
SELECT reconcile_image_stages(100) IS NOT NULL AS r \gset
SELECT pg_temp.ok(pg_temp.open_items(57, 'classifier') = 1 AND (SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading') = 3 AND (SELECT count(*) FROM image_stage_work WHERE stage = 'keyed_values') = 3,
  'the reconciler queues the first read and holds each reading stage to its room of three');
UPDATE platform_config SET config_value = config_value - 'max_open' WHERE config_key = 'image_stage_deep_reading';
DELETE FROM image_stage_work; DELETE FROM public.vehicle_images WHERE id = pg_temp.img(57);

-- ===== 4b. lanes and the backfill cap
UPDATE image_pipeline_stages SET backfill_daily_cap = 2 WHERE stage = 'deep_reading';
SELECT pg_temp.mk(51, age => interval '10 days'); SELECT pg_temp.mk(52, age => interval '9 days'); SELECT pg_temp.mk(53, age => interval '8 days'); SELECT pg_temp.mk(54, age => interval '7 days');
SELECT pg_temp.ok(image_stage_backfill_cap_left('deep_reading') = 2 AND image_stage_backfill_cap_left('keyed_values') IS NULL AND image_stage_backfill_cap_left('classifier') IS NULL
  AND image_stage_backfill_cap_left('nope') IS NULL, 'cap left: the stage''s cap, null for an uncapped or unknown stage');
SELECT public.enqueue_image_stage_work(ARRAY[pg_temp.img(51), pg_temp.img(52), pg_temp.img(53), pg_temp.img(54)]) AS n \gset
SELECT pg_temp.ok(:n = 2 AND (SELECT array_agg(image_id ORDER BY image_id) FROM image_stage_work WHERE lane = 'backfill' AND stage = 'deep_reading') = ARRAY[pg_temp.img(51), pg_temp.img(52)],
  'old photos are the backfill lane and stop at the cap, oldest first');
SELECT pg_temp.ok(image_stage_backfill_cap_left('deep_reading') = 0 AND public.enqueue_image_stage_work(ARRAY[pg_temp.img(53), pg_temp.img(54)]) = 0, 'cap reached: nothing more today');
SELECT pg_temp.mk(55); SELECT pg_temp.mk(56);
SELECT public.enqueue_image_stage_work(ARRAY[pg_temp.img(55), pg_temp.img(56)]) AS n \gset
SELECT pg_temp.ok(:n = 2 AND (SELECT count(*) FROM image_stage_work WHERE lane = 'live' AND stage = 'deep_reading' AND image_id IN (pg_temp.img(55), pg_temp.img(56))) = 2,
  'the live lane is not capped');
UPDATE image_stage_work SET status = 'dropped', finished_at = now() WHERE image_id = pg_temp.img(51);
SELECT pg_temp.ok(image_stage_backfill_cap_left('deep_reading') = 1 AND public.enqueue_image_stage_work(ARRAY[pg_temp.img(53), pg_temp.img(54)]) = 1 AND pg_temp.open_items(53, 'deep_reading') = 1,
  'a dropped item does not count against the cap');
SELECT public.enqueue_image_stage_work(ARRAY[pg_temp.img(54)], 'live') AS n \gset
SELECT pg_temp.ok(:n = 1 AND (SELECT lane FROM image_stage_work WHERE image_id = pg_temp.img(54) AND status = 'queued') = 'live',
  'an explicit lane is used, and a live insert is not held to the cap');
UPDATE image_stage_work SET created_at = now() - interval '2 days' WHERE image_id IN (pg_temp.img(51), pg_temp.img(52), pg_temp.img(53));
SELECT pg_temp.ok(image_stage_backfill_cap_left('deep_reading') = 2, 'the cap counts a Los Angeles day: yesterday''s rows do not');
UPDATE image_pipeline_stages SET backfill_daily_cap = 150 WHERE stage = 'deep_reading';
DELETE FROM image_stage_work; DELETE FROM public.vehicle_images WHERE id IN (SELECT pg_temp.img(n) FROM generate_series(51, 56) n);

-- ===== 5. photo_land_trigger and record_image_stage_receipt
-- a photo's first read lands: the trigger lands the classification and queues the deep reading
UPDATE public.vehicle_images SET ai_scan_metadata = '{"classification":{"image_type":"engine_bay","confidence":0.7}}' WHERE id = pg_temp.img(10);
SELECT pg_temp.ok((SELECT count(*) FROM land_calls WHERE image_id = pg_temp.img(10)) = 1 AND pg_temp.open_items(10, 'deep_reading') = 1,
  'the trigger lands the classification and queues the deep reading in the same event');
-- the intake stamps the reading while the deep_reading item is claimed: keyed_values is queued, deep_reading is not duplicated
SELECT pg_temp.mk(60); UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"classification":{"image_type":"interior"}}' WHERE id = pg_temp.img(60);
UPDATE image_stage_work SET status = 'claimed', lease_until = now() + interval '5 minutes' WHERE image_id = pg_temp.img(60) AND stage = 'deep_reading';
SELECT pg_temp.parent(60);
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || jsonb_build_object('byok_deep_analysis', jsonb_build_object('scene_type', 'interior', 'observation_id', pg_temp.obs(60))) WHERE id = pg_temp.img(60);
SELECT pg_temp.ok(pg_temp.open_items(60, 'keyed_values') = 1 AND pg_temp.open_items(60, 'deep_reading') = 1
  AND (SELECT status FROM image_stage_work WHERE image_id = pg_temp.img(60) AND stage = 'deep_reading' AND status IN ('queued', 'claimed')) = 'claimed',
  'a reading landing under a claimed deep_reading item queues keyed_values and does not duplicate the claimed item');
SELECT record_image_stage_receipt(pg_temp.img(60), 'deep_reading', 1, 'succeeded') AS rid \gset
SELECT pg_temp.ok(:rid > 0 AND pg_temp.open_items(60, 'deep_reading') = 0 AND pg_temp.open_items(60, 'keyed_values') = 1
  AND (SELECT status FROM image_stage_work WHERE image_id = pg_temp.img(60) AND stage = 'deep_reading') = 'done', 'the receipt closes the deep item; keyed_values stays queued once');
-- a receipt can make the next stage due when no trigger fired
SELECT pg_temp.mk(61, meta => pg_temp.reading(61)); SELECT pg_temp.parent(61);
SELECT record_image_stage_receipt(pg_temp.img(61), 'deep_reading', 1, 'policy_skip', NULL, NULL, NULL, NULL, '{"reason":"test"}');
SELECT pg_temp.ok(pg_temp.open_items(61, 'keyed_values') = 1, 'a succeeded or closed receipt queues what became due');
SELECT pg_temp.mk(62, meta => pg_temp.reading(62)); SELECT pg_temp.parent(62);
SELECT record_image_stage_receipt(pg_temp.img(62), 'deep_reading', 1, 'failed', 'reader_error');
SELECT pg_temp.ok(pg_temp.open_items(62, 'keyed_values') = 0, 'a failed receipt queues nothing');
-- closing keyed_values with a value
SELECT pg_temp.child(60);
SELECT record_image_stage_receipt(pg_temp.img(60), 'keyed_values', 1, 'succeeded', NULL, NULL, NULL, NULL, '{"values":3}');
SELECT pg_temp.ok(pg_temp.open_items(60, 'keyed_values') = 0 AND NOT pg_temp.has_gap(60, 'keyed_values') AND NOT pg_temp.has_gap(60, 'deep_reading'), 'the chain is closed: no gap, no open item');
-- the first read's receipt is as before
SELECT pg_temp.mk(63, status => 'pending', meta => '{}');
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane) VALUES (pg_temp.img(63), 'classifier', 1, 'missing', 'live');
SELECT record_image_stage_receipt(pg_temp.img(63), 'classifier', 1, 'succeeded');
SELECT pg_temp.ok((SELECT status FROM image_stage_work WHERE image_id = pg_temp.img(63)) = 'done' AND (SELECT count(*) FROM image_stage_receipts WHERE image_id = pg_temp.img(63)) = 1, 'a classifier receipt closes its item');

-- a failing enqueue never undoes the landing: the function is missing, then it raises
DELETE FROM land_calls;
ALTER FUNCTION public.enqueue_image_stage_work(uuid[], text) RENAME TO enqueue_image_stage_work_real;
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"classification":{"image_type":"undercarriage","confidence":0.6}}' WHERE id = pg_temp.img(10);
SELECT pg_temp.ok((SELECT count(*) FROM land_calls WHERE image_id = pg_temp.img(10)) = 1, 'enqueue missing: the classification still lands and the update goes through');
CREATE FUNCTION public.enqueue_image_stage_work(p_image_ids uuid[], p_lane text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'enqueue is broken'; END $$;
UPDATE public.vehicle_images SET ai_scan_metadata = ai_scan_metadata || '{"classification":{"image_type":"wheel","confidence":0.6}}' WHERE id = pg_temp.img(10);
SELECT pg_temp.ok((SELECT count(*) FROM land_calls WHERE image_id = pg_temp.img(10)) = 2, 'enqueue raising: the classification still lands and the update goes through');
SELECT pg_temp.mk(64, meta => pg_temp.reading(64)); SELECT pg_temp.parent(64);
SELECT record_image_stage_receipt(pg_temp.img(64), 'deep_reading', 1, 'succeeded') AS rid \gset
SELECT pg_temp.ok(:rid > 0 AND (SELECT count(*) FROM image_stage_receipts WHERE image_id = pg_temp.img(64) AND stage = 'deep_reading') = 1, 'enqueue raising: the receipt is still written');
DROP FUNCTION public.enqueue_image_stage_work(uuid[], text);
ALTER FUNCTION public.enqueue_image_stage_work_real(uuid[], text) RENAME TO enqueue_image_stage_work;
SELECT pg_temp.ok(public.enqueue_image_stage_work(ARRAY[pg_temp.img(64)]) = 1 AND pg_temp.open_items(64, 'keyed_values') = 1, 'the real enqueue is back, and the event the broken one missed is found by the next call (the reconciler is the net)');
DELETE FROM image_stage_work; DELETE FROM land_calls;

-- ===== 6. the reconciler: the backfill cap, the cursor, the live lane
DELETE FROM image_stage_work; DELETE FROM land_calls; DELETE FROM public.observation_witnesses; DELETE FROM public.vehicle_observations;
DELETE FROM image_stage_receipts; DELETE FROM public.vehicle_images;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL, wrapped_at = NULL;
-- a library, oldest first: deep gaps 71..75 and classifier gaps 76, 77 (not yet read, so never a deep gap)
SELECT pg_temp.mk(71, age => interval '30 days'); SELECT pg_temp.mk(76, age => interval '29 days', status => 'pending', meta => '{}');
SELECT pg_temp.mk(72, age => interval '28 days'); SELECT pg_temp.mk(73, age => interval '27 days');
SELECT pg_temp.mk(77, age => interval '26 days', status => 'pending', meta => '{}'); SELECT pg_temp.mk(74, age => interval '25 days'); SELECT pg_temp.mk(75, age => interval '24 days');
UPDATE image_pipeline_stages SET backfill_daily_cap = 3 WHERE stage = 'deep_reading';
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT array_agg(image_id::text || ':' || stage ORDER BY image_id) FROM image_stage_work WHERE lane = 'backfill')
  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.img(71)::text || ':deep_reading', pg_temp.img(72)::text || ':deep_reading', pg_temp.img(73)::text || ':deep_reading',
       pg_temp.img(76)::text || ':classifier', pg_temp.img(77)::text || ':classifier']) x),
  'backfill: the capped stage stops at its cap (oldest first); the uncapped classifier stage is queued in full');
SELECT pg_temp.ok((SELECT cursor_id IS NULL AND wrapped_at IS NOT NULL AND last_scanned = 7 AND last_enqueued = 5 FROM image_stage_reconciler_state WHERE lane = 'backfill'),
  'a short scan with every counted gap queued ends the pass: the cap-skipped photos do not hold the cursor');
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading') = 3 AND (SELECT last_enqueued = 0 AND cursor_id IS NULL FROM image_stage_reconciler_state WHERE lane = 'backfill'),
  'cap reached: the next tick queues no deep reading, and starts a new pass instead of rescanning one forever');
-- a scan smaller than the library: the cursor passes the photos the cap skipped
DELETE FROM image_stage_work;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL, wrapped_at = NULL;
UPDATE platform_config SET config_value = config_value || '{"scan_per_lane": 3}' WHERE config_key = 'image_stage_reconciler';
UPDATE image_pipeline_stages SET backfill_daily_cap = 1 WHERE stage = 'deep_reading';
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT array_agg(image_id::text || ':' || stage ORDER BY image_id) FROM image_stage_work)
  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.img(71)::text || ':deep_reading', pg_temp.img(76)::text || ':classifier']) x), 'tick 1 (candidates 71, 76, 72): one deep reading and the classifier gap');
SELECT pg_temp.ok((SELECT cursor_id = pg_temp.img(72) FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'tick 1: the cursor passes 72, whose deep reading the cap skipped');
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading') = 1 AND pg_temp.open_items(77, 'classifier') = 1
  AND (SELECT cursor_id = pg_temp.img(74) FROM image_stage_reconciler_state WHERE lane = 'backfill'), 'tick 2 (73, 77, 74): only the classifier gap; the cursor moves on to 74');
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT cursor_id IS NULL AND wrapped_at IS NOT NULL FROM image_stage_reconciler_state WHERE lane = 'backfill') AND (SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading') = 1,
  'tick 3 (75): the pass ends; no tick rescanned a photo');
-- an uncapped stage moves the cursor exactly as before: more gaps than room stops at the last photo whose gaps were all queued
DELETE FROM image_stage_work;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL, wrapped_at = NULL;
UPDATE image_pipeline_stages SET backfill_daily_cap = NULL WHERE stage = 'deep_reading';
UPDATE platform_config SET config_value = config_value || '{"scan_per_lane": 200, "max_open": 300}' WHERE config_key = 'image_stage_reconciler';
-- budget 4: backfill share 2, and the live lane's unused 2 roll over: room for four gaps
SELECT reconcile_image_stages(4) AS r \gset
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work) = 4 AND (SELECT cursor_id = pg_temp.img(73) FROM image_stage_reconciler_state WHERE lane = 'backfill'),
  'no cap: room for four gaps stops the cursor at the last photo whose gaps all fit (73), as before');
-- the live lane is not capped
DELETE FROM image_stage_work; DELETE FROM public.vehicle_images WHERE id IN (SELECT pg_temp.img(n) FROM generate_series(71, 77) n);
UPDATE image_pipeline_stages SET backfill_daily_cap = 0 WHERE stage = 'deep_reading';
SELECT pg_temp.mk(81, age => interval '30 minutes'); SELECT pg_temp.mk(82, age => interval '40 minutes'); SELECT pg_temp.mk(83, age => interval '3 hours');
SELECT reconcile_image_stages(100) AS r \gset
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND lane = 'live') = 3, 'a cap of 0 holds the backfill and never the live lane');
UPDATE image_pipeline_stages SET backfill_daily_cap = 150 WHERE stage = 'deep_reading';
UPDATE platform_config SET config_value = config_value || '{"scan_per_lane": 200}' WHERE config_key = 'image_stage_reconciler';

-- ===== 7. claim: the ledger hands out the work, and re-checks the gap
SELECT count(*) AS claimed FROM claim_image_stage_work('deep_reading', 5, 300, pg_temp.u1()) \gset
SELECT pg_temp.ok(:claimed = 3 AND (SELECT count(*) FROM image_stage_work WHERE status = 'claimed') = 3,
  'claim_image_stage_work hands out deep_reading work for filed, approved photos');
UPDATE image_stage_work SET status = 'queued', lease_until = NULL WHERE stage = 'deep_reading';
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_deep_reading';
SELECT count(*) AS claimed FROM claim_image_stage_work('deep_reading', 5, 300, pg_temp.u1()) \gset
SELECT pg_temp.ok(:claimed = 0 AND (SELECT count(*) FROM image_stage_work WHERE status = 'dropped') = 3,
  'the scope switched off after queueing: the claim re-checks the gap and drops the work');
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_deep_reading';
DELETE FROM image_stage_work;

-- ===== 8. the levels
DELETE FROM image_stage_work; DELETE FROM land_calls; DELETE FROM public.observation_witnesses; DELETE FROM public.vehicle_observations;
DELETE FROM image_stage_receipts; DELETE FROM public.vehicle_images; DELETE FROM public.image_observations;
-- V1 (U1): 101 automatic deep and keyed; 102 a reading and a keyed value made by hand (its text says "automatic": the receipt decides);
--   103 a reading, keyed work queued; 104 deep claimed; 105 deep queued; 106 deep retrying; 107 deep closed with no value; 108 a gap nobody queued;
--   109 a document; 110 sensitive; 111 not first-read. 112 a duplicate and 113 a superseded photo are not counted.
SELECT pg_temp.mk(101, age => interval '3 hours', meta => pg_temp.reading(101)); SELECT pg_temp.parent(101); SELECT pg_temp.child(101); SELECT pg_temp.child(101);
SELECT pg_temp.mk(102, meta => pg_temp.reading(102) || '{"agent_tier":"subscription automatic"}'); SELECT pg_temp.parent(102); SELECT pg_temp.child(102);
SELECT pg_temp.mk(103, meta => pg_temp.reading(103)); SELECT pg_temp.parent(103);
SELECT pg_temp.mk(104); SELECT pg_temp.mk(105); SELECT pg_temp.mk(106); SELECT pg_temp.mk(107); SELECT pg_temp.mk(108);
SELECT pg_temp.mk(109, doc => true); SELECT pg_temp.mk(110, sens => true); SELECT pg_temp.mk(111, status => 'pending');
SELECT pg_temp.mk(112, dup => true); SELECT pg_temp.mk(113); UPDATE public.vehicle_images SET is_superseded = true WHERE id = pg_temp.img(113);
-- V2 is not in the scope's vehicle list: a reading and a keyed value by hand, and a photo with no reading
SELECT pg_temp.mk(120, veh => pg_temp.v2()); SELECT pg_temp.mk(121, veh => pg_temp.v2(), meta => pg_temp.reading(121)); SELECT pg_temp.parent(121, pg_temp.v2()); SELECT pg_temp.child(121, veh => pg_temp.v2());
-- unfiled
SELECT pg_temp.mk(130, unfiled => true, status => 'pending', meta => '{}'); SELECT pg_temp.mk(131, unfiled => true);
-- another user's photo on the excluded vehicle
SELECT pg_temp.mk(140, veh => pg_temp.vx(), usr => pg_temp.u2());
INSERT INTO public.image_observations (image_id, observed_by, is_active, embedding_clip_vitb32) VALUES (pg_temp.img(101), 'clip', true, '{0.1}'), (pg_temp.img(104), 'clip', true, '{0.2}'), (pg_temp.img(105), 'clip', false, '{0.3}'), (pg_temp.img(108), 'clip', true, NULL);
-- the ledger's rows
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, observed_at) VALUES
  (pg_temp.img(101), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded', now() - interval '170 minutes'),
  (pg_temp.img(101), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', now() - interval '105 minutes');
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, status, created_at, finished_at) VALUES (pg_temp.img(101), 'deep_reading', 1, 'missing', 'live', 'done', now() - interval '150 minutes', now() - interval '110 minutes');
UPDATE public.vehicle_observations SET ingested_at = now() - interval '120 minutes' WHERE structured_data ->> 'image_id' = pg_temp.img(101)::text AND property_id IS NOT NULL;
UPDATE public.vehicle_observations SET ingested_at = now() - interval '160 minutes' WHERE structured_data ->> 'image_id' = pg_temp.img(101)::text AND property_id IS NULL;   -- the reading is older than its receipts
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, retry_after) VALUES (pg_temp.img(106), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'unavailable', 'reader_down', now() + interval '1 hour');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail) VALUES (pg_temp.img(107), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', '{"reason":"not_a_vehicle_photo"}');
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, status, created_at) VALUES
  (pg_temp.img(103), 'keyed_values', 1, 'missing', 'live', 'queued', now() - interval '30 minutes'),
  (pg_temp.img(104), 'deep_reading', 1, 'missing', 'live', 'claimed', now() - interval '50 minutes'),
  (pg_temp.img(105), 'deep_reading', 1, 'missing', 'live', 'queued', now() - interval '20 minutes');

-- one photo per row, and what each says
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_photo_levels(NULL, pg_temp.v1())) = 11, 'V1: eleven photos (a duplicate and a superseded photo are not counted)');
SELECT image_stage_coverage(pg_temp.v1()) -> 'levels' AS lv \gset
SELECT pg_temp.ok((:'lv')::jsonb -> 'photos' = '11' AND (:'lv')::jsonb -> 'with_pixels' = '11' AND (:'lv')::jsonb -> 'first_read' = '10', 'levels: photos, with pixels, first read');
SELECT pg_temp.ok((:'lv')::jsonb -> 'deep_read' = '{"total": 3, "automatic": 1, "by_hand": 2}',
  'deep_read: three readings, one automatic (a succeeded receipt), two by hand (a text that says "automatic" is not a receipt)');
SELECT pg_temp.ok(((:'lv')::jsonb -> 'keyed') - 'basis' = '{"photos": 2, "automatic": 1, "by_hand": 1, "values": 3}', 'keyed: two photos, one automatic, one by hand, three values');
SELECT pg_temp.ok((:'lv')::jsonb #> '{waiting,deep_reading}' = '{"queued": 1, "claimed": 1, "unqueued": 1, "given_up": 0, "receipt_without_result": 0,
  "retrying": {"photos": 1, "commonest_error_class": "reader_down"}, "closed_no_value": {"photos": 1, "by_reason": {"not_a_vehicle_photo": 1}},
  "not_eligible": {"photos": 3, "by_condition": {"document": 1, "sensitive": 1, "no_first_read": 1}}, "out_of_scope": 0, "no_reading": 0}',
  'waiting deep_reading: by state, with the commonest error class, the closing reason and the failed condition');
SELECT pg_temp.ok((:'lv')::jsonb #> '{waiting,keyed_values,queued}' = '1' AND (:'lv')::jsonb #> '{waiting,keyed_values,no_reading}' = '8'
  AND (:'lv')::jsonb #> '{waiting,keyed_values,claimed}' = '0', 'waiting keyed_values: one queued; the photos with no reading yet are counted as such');
SELECT pg_temp.ok((:'lv')::jsonb #> '{timing,photos_measured}' = '1' AND (:'lv')::jsonb #> '{timing,photo_to_first_keyed_value_minutes,median}' = '60.0'
  AND (:'lv')::jsonb #> '{timing,photo_to_first_keyed_value_minutes,p90}' = '60.0' AND (:'lv')::jsonb #> '{timing,deep_reading_queued_to_keyed_receipt_minutes,median}' = '45.0',
  'timing: photo to first keyed value 60 min; deep-reading queued to keyed receipt 45 min (automatic rows only)');
SELECT pg_temp.ok((SELECT image_stage_coverage(pg_temp.v1()) ->> 'logic_version') = 'image_stage_coverage(vehicle)/20261120130000', 'logic_version is bumped');
SELECT pg_temp.ok((SELECT jsonb_typeof(image_stage_coverage(pg_temp.v1()) -> 'model_gain') = 'object' AND image_stage_coverage(pg_temp.v1()) -> 'model_gain' ? 'proven_basis'), 'model_gain is still there');
-- an empty vehicle: zeros, not nulls
SELECT pg_temp.ok(image_stage_coverage('00000000-0000-4000-8000-0000000000ee') #> '{levels,photos}' = '0' AND image_stage_coverage('00000000-0000-4000-8000-0000000000ee') #> '{levels,deep_read,total}' = '0'
  AND image_stage_coverage('00000000-0000-4000-8000-0000000000ee') #> '{levels,timing,photos_measured}' = '0', 'a vehicle with no photos: zeros');

-- the library, per vehicle: the same definitions, in table form
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_levels(pg_temp.u1())) = 3 AND (SELECT count(*) FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id IS NULL) = 1, 'levels(user): V1, V2 and one row for the unfiled photos');
SELECT pg_temp.ok((SELECT (landed, with_pixels, first_read, has_embedding, filed, gate_approved, deep_read_automatic, deep_read_by_hand, keyed_automatic, keyed_by_hand, waiting_deep, waiting_keyed)
  = (11, 11, 10, 2, 11, 11, 1, 2, 1, 1, 2, 1) FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = pg_temp.v1()), 'levels(user), V1 row: the counts');
SELECT pg_temp.ok((SELECT (landed, filed, gate_approved, first_read, deep_read_by_hand, keyed_by_hand, deep_read_automatic) = (2, 0, 0, 1, 0, 0, 0) FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id IS NULL),
  'levels(user), unfiled row: landed, none filed');
SELECT pg_temp.ok((SELECT (deep_read_by_hand, keyed_by_hand, deep_read_automatic, keyed_automatic) = (1, 1, 0, 0) FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = pg_temp.v2()), 'levels(user), V2 row: a reading and a keyed value by hand');
SELECT pg_temp.ok((SELECT oldest_waiting_at < now() - interval '45 minutes' AND newest_photo_at > now() - interval '3 hours' FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = pg_temp.v1()), 'oldest waiting and newest photo');
-- the two readers cannot disagree: coverage(V1).levels is the V1 row
SELECT pg_temp.ok((SELECT (lv #>> '{photos}')::int = r.landed AND (lv #>> '{with_pixels}')::int = r.with_pixels AND (lv #>> '{first_read}')::int = r.first_read
    AND (lv #>> '{deep_read,automatic}')::int = r.deep_read_automatic AND (lv #>> '{deep_read,by_hand}')::int = r.deep_read_by_hand
    AND (lv #>> '{keyed,automatic}')::int = r.keyed_automatic AND (lv #>> '{keyed,by_hand}')::int = r.keyed_by_hand
   FROM (SELECT image_stage_coverage(pg_temp.v1()) -> 'levels' AS lv) x, image_stage_levels(pg_temp.u1()) r WHERE r.vehicle_id = pg_temp.v1()), 'coverage(vehicle).levels and levels(user) agree on V1');
-- automatic and by hand add up to the totals, counted independently of the functions
SELECT pg_temp.ok((SELECT sum(deep_read_automatic + deep_read_by_hand) FROM image_stage_levels(pg_temp.u1()))
  = (SELECT count(*) FROM public.vehicle_images WHERE user_id = pg_temp.u1() AND is_duplicate IS NOT TRUE AND coalesce(is_superseded, false) = false AND ai_scan_metadata #>> '{byok_deep_analysis,scene_type}' IS NOT NULL),
  'deep: automatic + by hand = photos that hold a reading');
SELECT pg_temp.ok((SELECT sum(keyed_automatic + keyed_by_hand) FROM image_stage_levels(pg_temp.u1()))
  = (SELECT count(DISTINCT w.image_id) FROM public.observation_witnesses w JOIN public.vehicle_observations o ON o.id = w.observation_id JOIN public.vehicle_images v ON v.id = w.image_id
      WHERE v.user_id = pg_temp.u1() AND o.property_id IS NOT NULL AND o.is_superseded IS NOT TRUE), 'keyed: automatic + by hand = photos with a current keyed value');
SELECT pg_temp.ok((SELECT sum(landed) FROM image_stage_levels(pg_temp.u1())) = (SELECT count(*) FROM public.vehicle_images WHERE user_id = pg_temp.u1() AND is_duplicate IS NOT TRUE AND coalesce(is_superseded, false) = false),
  'landed = the user''s photos');
-- the out-of-scope and other-user photos
SELECT pg_temp.ok((SELECT (image_stage_coverage(pg_temp.vx()) #>> '{levels,photos}') = '1' AND image_stage_coverage(pg_temp.vx()) #>> '{levels,waiting,deep_reading,out_of_scope}' = '1'), 'a photo of another user on the excluded vehicle: counted on the vehicle, out of scope');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = pg_temp.vx()), 'and not in the first user''s library');
-- who may call it
CREATE FUNCTION pg_temp.as_count(r text, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE format('SET LOCAL ROLE %I', r); EXECUTE 'SELECT count(*) FROM (' || q || ') s' INTO n; RESET ROLE; RETURN n; END $$;
CREATE FUNCTION pg_temp.as_raises(r text, q text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', r); EXECUTE q;
  RAISE EXCEPTION 'FAILED: % (no error raised)', msg;
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAILED:%' THEN RAISE; END IF; END $$;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a1"}', false);
SELECT pg_temp.ok(pg_temp.as_count('authenticated', $q$SELECT * FROM image_stage_levels('00000000-0000-4000-8000-0000000000a1')$q$) = 3, 'the owner reads their own levels');
SELECT pg_temp.as_raises('authenticated', $q$SELECT * FROM image_stage_levels('00000000-0000-4000-8000-0000000000a2')$q$, 'another user''s levels are refused');
SELECT pg_temp.as_raises('authenticated', $q$SELECT * FROM image_stage_photo_levels('00000000-0000-4000-8000-0000000000a1', NULL)$q$, 'the per-photo rows are not callable by a user');
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT pg_temp.as_raises('anon', $q$SELECT * FROM image_stage_levels('00000000-0000-4000-8000-0000000000a1')$q$, 'anon cannot call it');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.ok(pg_temp.as_count('service_role', $q$SELECT * FROM image_stage_levels('00000000-0000-4000-8000-0000000000a2')$q$) = 1, 'the service role reads any user''s levels');
SELECT set_config('request.jwt.claims', '', false);

-- ===== 8b. one population, one state per photo: the two readers and the gap finder cannot disagree
-- V3 (U1): 160 holds a reading observation and no stamp; 161 has no owner; 162 a keyed value of an earlier reading and a receipt that
-- predates the current one; 163 has no gate verdict.
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"]}');
SELECT pg_temp.mk(160, veh => '00000000-0000-4000-8000-0000000000b3'); SELECT pg_temp.parent(160, '00000000-0000-4000-8000-0000000000b3');
SELECT pg_temp.mk(161, veh => '00000000-0000-4000-8000-0000000000b3'); UPDATE public.vehicle_images SET user_id = NULL WHERE id = pg_temp.img(161);
SELECT pg_temp.mk(162, veh => '00000000-0000-4000-8000-0000000000b3', meta => pg_temp.reading(162)); SELECT pg_temp.parent(162, '00000000-0000-4000-8000-0000000000b3');
SELECT pg_temp.child(162, source_n => 99, veh => '00000000-0000-4000-8000-0000000000b3');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, observed_at) VALUES (pg_temp.img(162), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', 1, now() - interval '1 day');
SELECT pg_temp.mk(163, veh => '00000000-0000-4000-8000-0000000000b3', gate => NULL);
-- the same population: every photo of the vehicle, whoever owns it
SELECT pg_temp.ok((SELECT landed FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = '00000000-0000-4000-8000-0000000000b3') = 4
  AND image_stage_coverage('00000000-0000-4000-8000-0000000000b3') #>> '{levels,photos}' = '4', 'levels(user) and coverage(vehicle) both count the ownerless photo: 4');
SELECT pg_temp.ok((SELECT (deep_state, deep_detail, keyed_state, keyed_detail) IS NOT DISTINCT FROM ('not_eligible', 'no_owner', 'no_reading', NULL) FROM image_stage_photo_levels(NULL, '00000000-0000-4000-8000-0000000000b3') WHERE image_id = pg_temp.img(161)),
  'an ownerless photo says so: not eligible, no_owner');
-- a reading found by its observation counts as a deep reading
SELECT pg_temp.ok((SELECT (deep_read, deep_state, keyed_state) = (true, 'done', 'unqueued') FROM image_stage_photo_levels(NULL, '00000000-0000-4000-8000-0000000000b3') WHERE image_id = pg_temp.img(160)),
  'photo 160 holds a reading (its observation, no stamp): deep_read, and its keyed_values is an unqueued gap');
-- a receipt for an earlier reading is not "automatic" for the current one
SELECT pg_temp.ok((SELECT (keyed, keyed_automatic, keyed_state) = (true, false, 'unqueued') FROM image_stage_photo_levels(NULL, '00000000-0000-4000-8000-0000000000b3') WHERE image_id = pg_temp.img(162)),
  'photo 162: keyed, but not automatic (the receipt predates the reading) and waiting as a gap');
SELECT pg_temp.ok((SELECT (gate_approved, gate_undecided) = (3, 1) FROM image_stage_level_counts(NULL, '00000000-0000-4000-8000-0000000000b3')), 'gate_approved counts approvals; photos with no verdict are counted apart');
-- the levels' unqueued photos are exactly the gap finder's gaps
SELECT pg_temp.ok((SELECT unqueued_deep + unqueued_keyed FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = '00000000-0000-4000-8000-0000000000b3')
  = (SELECT count(*) FROM image_stage_gaps(ARRAY(SELECT id FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-4000-8000-0000000000b3')) WHERE stage IN ('deep_reading', 'keyed_values'))
  AND (SELECT unqueued_deep + unqueued_keyed FROM image_stage_levels(pg_temp.u1()) WHERE vehicle_id = '00000000-0000-4000-8000-0000000000b3') = 3,
  'unqueued deep + keyed (levels) = gaps (gap finder): 163 deep; 160 and 162 keyed');
SELECT pg_temp.ok(image_stage_coverage('00000000-0000-4000-8000-0000000000b3') #> '{levels,waiting,keyed_values,unqueued}' = '2'
  AND image_stage_coverage('00000000-0000-4000-8000-0000000000b3') #> '{levels,waiting,deep_reading,unqueued}' = '1', 'coverage(vehicle).waiting shows the same unqueued counts');
-- states for receipts: a succeeded receipt with no result, a failed one
SELECT pg_temp.mk(164, veh => '00000000-0000-4000-8000-0000000000b3');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (pg_temp.img(164), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded');
SELECT pg_temp.mk(165, veh => '00000000-0000-4000-8000-0000000000b3');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class) VALUES (pg_temp.img(165), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'failed', 'bad_json');
SELECT pg_temp.ok((SELECT deep_state FROM image_stage_photo_levels(NULL, '00000000-0000-4000-8000-0000000000b3') WHERE image_id = pg_temp.img(164)) = 'receipt_without_result'
  AND (SELECT deep_state FROM image_stage_photo_levels(NULL, '00000000-0000-4000-8000-0000000000b3') WHERE image_id = pg_temp.img(165)) = 'given_up',
  'a succeeded receipt with no reading is receipt_without_result, a failed one is given_up (neither is "retrying")');
DELETE FROM public.observation_witnesses WHERE image_id IN (SELECT pg_temp.img(n) FROM generate_series(160, 165) n);
DELETE FROM image_stage_receipts WHERE image_id IN (SELECT pg_temp.img(n) FROM generate_series(160, 165) n);
DELETE FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-4000-8000-0000000000b3';
DELETE FROM public.vehicle_images WHERE id IN (SELECT pg_temp.img(n) FROM generate_series(160, 165) n);
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "vehicle_ids": ["00000000-0000-4000-8000-0000000000b1"],
  "exclude_vehicle_ids": ["00000000-0000-4000-8000-0000000000bf"]}');

-- ===== 9. the flow watch tells the truth
DELETE FROM image_stage_work; DELETE FROM public.observation_witnesses; DELETE FROM public.vehicle_observations;
DELETE FROM image_stage_receipts; DELETE FROM public.vehicle_images;
UPDATE image_stage_reconciler_state SET last_run_at = now();
SELECT public.assay_photo_reading_flow() AS a \gset
SELECT pg_temp.ok((:'a')::jsonb ->> 'status' = 'passed' AND (:'a')::jsonb ->> 'method' = 'assay_photo_reading_flow v3'
  AND (:'a')::jsonb #> '{stage_queue,stages,deep_reading,due_now}' = '0' AND (:'a')::jsonb #> '{stage_queue,stages,keyed_values,due_now}' = '0'
  AND (:'a')::jsonb #> '{stage_queue,due_now}' = '0' AND (:'a')::jsonb #> '{stage_queue,enabled}' = 'true',
  'quiet system: passes; the stage queue reports both reading stages beside the classifier''s own keys');
SELECT pg_temp.mk(201); SELECT pg_temp.mk(202, meta => pg_temp.reading(202)); SELECT pg_temp.parent(202);
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, status, not_before, created_at) VALUES
  (pg_temp.img(201), 'deep_reading', 1, 'missing', 'live', 'queued', now() - interval '8 hours', now() - interval '8 hours'),
  (pg_temp.img(202), 'keyed_values', 1, 'missing', 'live', 'queued', now() - interval '7 hours', now() - interval '7 hours');
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.ok((:'a')::jsonb ->> 'status' = 'failed' AND jsonb_array_length((:'a')::jsonb -> 'reasons') = 2
  AND (:'a')::jsonb -> 'reasons' ->> 0 LIKE 'deep_reading_stalled: 1 photos are due in the deep_reading stage queue (oldest queued %) and no receipt succeeded or closed one in 6 h'
  AND (:'a')::jsonb -> 'reasons' ->> 1 LIKE 'keyed_values_stalled: 1 photos are due in the keyed_values stage queue (oldest queued %) and no receipt succeeded or closed one in 6 h',
  'work due for over 6 h with nothing succeeded: each reading stage is named in its own reason');
SELECT pg_temp.raises($$SELECT public.assay_photo_reading_flow()$$, 'the raising form raises');
-- a reader that only fails does not count as the stage moving
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, retry_after, observed_at)
  VALUES (pg_temp.img(201), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'unavailable', 'reader_down', now() + interval '1 hour', now() - interval '1 hour');
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.ok(jsonb_array_length((:'a')::jsonb -> 'reasons') = 2 AND (:'a')::jsonb #> '{stage_queue,stages,deep_reading,receipts_6h}' = '1'
  AND (:'a')::jsonb #> '{stage_queue,stages,deep_reading,succeeded_or_closed_6h}' = '0', 'a failure receipt in the window is reported but is not the stage moving');
-- a succeeded or closed receipt in the window clears that stage only
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail, observed_at)
  VALUES (pg_temp.img(202), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded', '{}', now() - interval '30 minutes');
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.ok(jsonb_array_length((:'a')::jsonb -> 'reasons') = 1 AND (:'a')::jsonb -> 'reasons' ->> 0 LIKE 'keyed_values_stalled:%',
  'a succeeded deep_reading receipt in the window clears that stage''s reason only');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail, observed_at)
  VALUES (pg_temp.img(202), 'keyed_values', 'ingest-observation-batch', 1, 'policy_skip', '{"reason":"no_known_scalar_values"}', now() - interval '10 minutes');
SELECT public.assay_photo_reading_flow(false) AS a \gset
SELECT pg_temp.ok((:'a')::jsonb ->> 'status' = 'passed' AND (:'a')::jsonb #> '{stage_queue,stages,keyed_values,succeeded_or_closed_6h}' = '1', 'a policy_skip is a closed stage: quiet');
-- work due for less than 6 h, and a switched-off ledger, are not stalls
UPDATE image_stage_work SET created_at = now() - interval '2 hours', not_before = now() - interval '2 hours';
DELETE FROM image_stage_receipts;
SELECT pg_temp.ok(public.assay_photo_reading_flow(false) ->> 'status' = 'passed', 'due for 2 h: not a stall');
UPDATE image_stage_work SET created_at = now() - interval '9 hours', not_before = now() - interval '9 hours';
SELECT pg_temp.ok(public.assay_photo_reading_flow(false) ->> 'status' = 'failed', 'due for 9 h and no receipt: a stall');
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(public.assay_photo_reading_flow(false) ->> 'status' = 'passed', 'the ledger switched off: quiet');
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_reconciler';
DELETE FROM image_stage_work;
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.assay_photo_reading_flow(boolean)', 'execute') AND NOT has_function_privilege('anon', 'public.assay_photo_reading_flow(boolean)', 'execute'), 'the assay''s grants are as they were');

-- ===== 9b. reading tiers: a thin-tier (automatic) reading is closed by a receipt, a reviewed-tier reading by existing
-- 20261120140000 lists the tiers in platform_config 'image_reading_tiers'. This migration stands alone: with no such row only the
-- reader's own literal tier, 'subscription automatic', is thin; with the row, the tier it names as automatic.tier is thin and no other.
-- A thin reading is its observation alone: the intake stamps only a reading that is not thin and refuses a thin one over any stamp
-- (20261120140000). So a photo with a stamp is read, whatever tier the stamp names, and a thin reading is a photo with a current
-- automatic-tier observation and no stamp.
DELETE FROM image_stage_work; DELETE FROM image_stage_receipts; DELETE FROM public.observation_witnesses; DELETE FROM public.vehicle_observations;
DELETE FROM public.image_observations; DELETE FROM public.vehicle_images;
SELECT pg_temp.scope('{"enabled": true, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "vehicle_ids": ["00000000-0000-4000-8000-0000000000b1"]}');
-- a reading as the intake leaves it, by tier: the automatic tier is its observation alone (no stamp on the photo); any other tier is
-- stamped, and the stamp and the observation carry the tier the intake wrote
CREATE FUNCTION pg_temp.tiered(n int, tier text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF tier = 'subscription automatic' THEN PERFORM pg_temp.mk(n);
  ELSE PERFORM pg_temp.mk(n, meta => jsonb_set(pg_temp.reading(n), '{byok_deep_analysis,agent_tier}', to_jsonb(tier)));
  END IF;
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, agent_tier)
  VALUES (pg_temp.obs(n), pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(n)), tier);
END $$;
SELECT pg_temp.tiered(401, 'subscription automatic');          -- thin: an observation, no stamp
SELECT pg_temp.tiered(402, 'caller-byok subscription');        -- reviewed
SELECT pg_temp.tiered(403, 'a tier nobody listed');            -- unlisted
SELECT pg_temp.mk(404, meta => pg_temp.reading(404)); SELECT pg_temp.parent(404);   -- no tier at all: a legacy reading
SELECT pg_temp.tiered(405, 'subscription automatic');          -- thin, like 401 (it keeps only its version-1 receipt below)
SELECT pg_temp.mk(406, meta => '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true},"byok_deep_analysis":{"scene_type":"exterior"}}');  -- a legacy stamp, no observation
-- a stamp that names the automatic tier, without (407) and with (408, already keyed) an automatic-tier observation behind it. The
-- intake never writes one, so the stamp is someone's reading: the photo is read and is not offered to the automatic reader
SELECT pg_temp.mk(407, meta => jsonb_set(pg_temp.reading(407), '{byok_deep_analysis,agent_tier}', '"subscription automatic"'));
SELECT pg_temp.mk(408, meta => jsonb_set(pg_temp.reading(408), '{byok_deep_analysis,agent_tier}', '"subscription automatic"'));
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, agent_tier)
VALUES (pg_temp.obs(408), pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(408)), 'subscription automatic');
SELECT pg_temp.child(408);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'image_reading_tiers'), 'no tier row in this fixture: the migration stands alone');
SELECT pg_temp.ok(pg_temp.has_gap(401, 'deep_reading') AND NOT pg_temp.has_gap(402, 'deep_reading') AND NOT pg_temp.has_gap(403, 'deep_reading')
  AND NOT pg_temp.has_gap(404, 'deep_reading') AND pg_temp.has_gap(405, 'deep_reading') AND NOT pg_temp.has_gap(406, 'deep_reading')
  AND NOT pg_temp.has_gap(407, 'deep_reading') AND NOT pg_temp.has_gap(408, 'deep_reading'),
  'no tier row: only an unstamped reading of the literal automatic tier is thin (with no receipt it is a gap, whatever else is not)');
SELECT pg_temp.ok(image_stage_reading_is_thin('subscription automatic') AND NOT image_stage_reading_is_thin('caller-byok subscription')
  AND NOT image_stage_reading_is_thin(NULL) AND NOT image_stage_reading_is_thin(''), 'the stage helper: literal fallback, no tier = reviewed');
INSERT INTO platform_config (config_key, config_value) VALUES ('image_reading_tiers', '{"reviewed_tiers": ["caller-byok subscription"], "automatic": {"tier": "subscription automatic"}}');
SELECT pg_temp.ok(pg_temp.has_gap(401, 'deep_reading') AND NOT pg_temp.has_gap(402, 'deep_reading') AND NOT pg_temp.has_gap(403, 'deep_reading')
  AND NOT pg_temp.has_gap(404, 'deep_reading') AND pg_temp.has_gap(405, 'deep_reading') AND NOT pg_temp.has_gap(406, 'deep_reading')
  AND NOT pg_temp.has_gap(407, 'deep_reading') AND NOT pg_temp.has_gap(408, 'deep_reading'),
  'with the tier row: only an unstamped automatic-tier reading is thin; a listed tier, a tier nobody listed, no tier at all and any stamp are not (the intake never displaces them)');
-- keyed_values keeps its rule: the parent is the current reading, whatever its tier
SELECT pg_temp.ok(pg_temp.has_gap(401, 'keyed_values') AND pg_temp.has_gap(402, 'keyed_values') AND pg_temp.has_gap(403, 'keyed_values'),
  'keyed_values: a current reading of any tier is a parent');
-- levels follow the gap finder
SELECT pg_temp.ok((SELECT deep_state FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(401)) = 'unqueued'
  AND (SELECT deep_state FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(402)) = 'done'
  AND (SELECT deep_read FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(401))
  AND (SELECT bool_and(deep_state = 'done' AND deep_read) AND count(*) = 2 FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id IN (pg_temp.img(407), pg_temp.img(408))),
  'levels: an unstamped thin reading is a reading (deep_read) but not done for the stage; a reviewed one is done, and so is any stamped photo');
-- a succeeded deep_reading receipt at the stage's version closes a thin reading
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES
  (pg_temp.img(401), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded'), (pg_temp.img(402), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded'),
  (pg_temp.img(403), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded'), (pg_temp.img(405), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded');
SELECT pg_temp.ok(NOT pg_temp.has_gap(401, 'deep_reading') AND NOT pg_temp.has_gap(402, 'deep_reading') AND NOT pg_temp.has_gap(403, 'deep_reading')
  AND NOT pg_temp.has_gap(405, 'deep_reading'), 'a succeeded receipt at the current version closes a thin reading');
SELECT pg_temp.ok((SELECT deep_state FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(401)) = 'done', 'levels: done with the receipt');
-- raising the stage's version offers every thin-read photo again and none of the reviewed ones
UPDATE image_pipeline_stages SET required_version = 2 WHERE stage = 'deep_reading';
SELECT pg_temp.ok(pg_temp.has_gap(401, 'deep_reading') AND NOT pg_temp.has_gap(403, 'deep_reading') AND pg_temp.has_gap(405, 'deep_reading')
  AND NOT pg_temp.has_gap(402, 'deep_reading') AND NOT pg_temp.has_gap(404, 'deep_reading') AND NOT pg_temp.has_gap(406, 'deep_reading')
  AND NOT pg_temp.has_gap(407, 'deep_reading') AND NOT pg_temp.has_gap(408, 'deep_reading'),
  'raising the stage version: thin-read photos are offered again, reviewed and stamped ones are not');
SELECT pg_temp.ok((SELECT deep_state FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(401)) = 'unqueued'
  AND (SELECT deep_state FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(402)) = 'done', 'levels: the same after the raise');
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(401)]) WHERE stage = 'deep_reading') = 'outdated', 'the reason is outdated');
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (pg_temp.img(401), 'deep_reading', 'photo-pipeline-orchestrator', 2, 'succeeded');
SELECT pg_temp.ok(NOT pg_temp.has_gap(401, 'deep_reading') AND NOT pg_temp.has_gap(403, 'deep_reading'), 'a receipt at the new version closes it again');
UPDATE image_pipeline_stages SET required_version = 1 WHERE stage = 'deep_reading';
-- policy_skip reasons: detail.skipped first, then detail.reason
SELECT pg_temp.mk(410); SELECT pg_temp.mk(411); SELECT pg_temp.mk(412); SELECT pg_temp.mk(413);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail) VALUES
  (pg_temp.img(410), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', '{"skipped":"already_read"}'),
  (pg_temp.img(411), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', '{"reason":"not_a_vehicle_photo"}'),
  (pg_temp.img(412), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', '{"skipped":"already_read","reason":"other"}'),
  (pg_temp.img(413), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', '{}');
SELECT pg_temp.ok((SELECT array_agg(deep_detail ORDER BY image_id) FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id IN (SELECT pg_temp.img(n) FROM generate_series(410, 413) n))
  = ARRAY['already_read', 'not_a_vehicle_photo', 'already_read', 'unspecified'], 'levels read a policy_skip reason from detail.skipped first, then detail.reason');
-- A receipt made before a stage's version was raised is a gap again whatever its outcome (the gap finder's own rule), and the levels
-- say so: such a photo is unqueued, not given_up or closed. 420: a thin reading whose receipt failed. 421-423: no reading, closed without
-- a value, blocked, succeeded with no result.
SELECT pg_temp.tiered(420, 'subscription automatic'); SELECT pg_temp.mk(421); SELECT pg_temp.mk(422); SELECT pg_temp.mk(423);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, detail) VALUES
  (pg_temp.img(420), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'failed', 'two_reads_invalid', '{}'),
  (pg_temp.img(421), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'policy_skip', NULL, '{"skipped":"moved"}'),
  (pg_temp.img(422), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'blocked_input', 'image_http_error', '{}'),
  (pg_temp.img(423), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded', NULL, '{}');
CREATE FUNCTION pg_temp.deep_is(n int) RETURNS text LANGUAGE sql AS
  $$ SELECT deep_state || '/' || coalesce(deep_detail, '-') FROM public.image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(n) $$;
CREATE FUNCTION pg_temp.keyed_is(n int) RETURNS text LANGUAGE sql AS
  $$ SELECT keyed_state || '/' || coalesce(keyed_detail, '-') FROM public.image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(n) $$;
-- The photos of V1 the levels call unqueued for a stage are exactly the gap finder's gaps for it (nothing is queued at these points):
-- the number of gaps when the two sets are the same photos, -1 when they differ.
CREATE FUNCTION pg_temp.gaps_the_levels_agree_on(st text) RETURNS int LANGUAGE sql AS $$
  WITH l AS (SELECT image_id FROM public.image_stage_photo_levels(NULL, pg_temp.v1()) WHERE CASE st WHEN 'deep_reading' THEN deep_state ELSE keyed_state END = 'unqueued'),
       g AS (SELECT image_id FROM public.image_stage_gaps(ARRAY(SELECT id FROM public.vehicle_images WHERE vehicle_id = pg_temp.v1())) WHERE stage = st)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM l WHERE image_id NOT IN (SELECT image_id FROM g)) AND NOT EXISTS (SELECT 1 FROM g WHERE image_id NOT IN (SELECT image_id FROM l))
              THEN (SELECT count(*)::int FROM g) ELSE -1 END $$;
SELECT pg_temp.ok(NOT pg_temp.has_gap(420, 'deep_reading') AND NOT pg_temp.has_gap(421, 'deep_reading') AND NOT pg_temp.has_gap(422, 'deep_reading') AND NOT pg_temp.has_gap(423, 'deep_reading')
  AND ARRAY[pg_temp.deep_is(420), pg_temp.deep_is(421), pg_temp.deep_is(422), pg_temp.deep_is(423)]
      = ARRAY['given_up/two_reads_invalid', 'closed_no_value/moved', 'given_up/image_http_error', 'receipt_without_result/unspecified'],
  'at the stage''s version: a failed, closed, blocked or empty-handed receipt is final, and the levels name each');
SELECT pg_temp.ok(pg_temp.gaps_the_levels_agree_on('deep_reading') = 0, 'deep_reading at version 1: no gap, and no photo the levels call unqueued');
UPDATE image_pipeline_stages SET required_version = 2 WHERE stage = 'deep_reading';
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_gaps(ARRAY[pg_temp.img(420), pg_temp.img(421), pg_temp.img(422), pg_temp.img(423)]) WHERE stage = 'deep_reading' AND reason = 'outdated') = 4,
  'raising the stage version offers all four again, as outdated');
SELECT pg_temp.ok(ARRAY[pg_temp.deep_is(420), pg_temp.deep_is(421), pg_temp.deep_is(422), pg_temp.deep_is(423)] = ARRAY['unqueued/-', 'unqueued/-', 'unqueued/-', 'unqueued/-'],
  'levels: a receipt of any outcome from before the raise is an unqueued gap (not given_up, not closed_no_value)');
-- nine: the four above, the four closed without a value (410-413) and the thin reading whose receipt is version 1 (405); 401 holds a
-- version-2 receipt, and the stamped photos (402-404, 406-408) are never offered
SELECT pg_temp.ok(pg_temp.gaps_the_levels_agree_on('deep_reading') = 9, 'deep_reading after the raise: the levels'' unqueued photos are exactly the gap finder''s nine gaps');
UPDATE image_pipeline_stages SET required_version = 1 WHERE stage = 'deep_reading';
-- the same for keyed_values. 430: a reading with nothing to key (closed). 431: a reading whose projection failed.
SELECT pg_temp.mk(430, meta => pg_temp.reading(430)); SELECT pg_temp.parent(430);
SELECT pg_temp.mk(431, meta => pg_temp.reading(431)); SELECT pg_temp.parent(431);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, error_class, detail) VALUES
  (pg_temp.img(430), 'keyed_values', 'ingest-observation-batch', 1, 'policy_skip', NULL, '{"reason":"no_known_scalar_values"}'),
  (pg_temp.img(431), 'keyed_values', 'ingest-observation-batch', 1, 'failed', 'projection_failed', '{}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(430, 'keyed_values') AND NOT pg_temp.has_gap(431, 'keyed_values')
  AND ARRAY[pg_temp.keyed_is(430), pg_temp.keyed_is(431)] = ARRAY['closed_no_value/no_known_scalar_values', 'given_up/projection_failed'],
  'keyed_values at the stage''s version: closed and given up are final');
-- six readings nobody has keyed yet: 401-405 and 420 (408 is keyed; 406 and 407 hold no observation to key from)
SELECT pg_temp.ok(pg_temp.gaps_the_levels_agree_on('keyed_values') = 6, 'keyed_values at version 1: the levels'' unqueued photos are exactly the gap finder''s six gaps');
UPDATE image_pipeline_stages SET required_version = 2 WHERE stage = 'keyed_values';
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_gaps(ARRAY[pg_temp.img(430), pg_temp.img(431)]) WHERE stage = 'keyed_values' AND reason = 'outdated') = 2,
  'raising the keyed_values version offers both again, as outdated');
SELECT pg_temp.ok(ARRAY[pg_temp.keyed_is(430), pg_temp.keyed_is(431)] = ARRAY['unqueued/-', 'unqueued/-'], 'levels: the same for keyed_values after a raise');
SELECT pg_temp.ok(pg_temp.gaps_the_levels_agree_on('keyed_values') = 8, 'keyed_values after the raise: the same six and the two offered again');
UPDATE image_pipeline_stages SET required_version = 1 WHERE stage = 'keyed_values';
-- An automatic reading that was keyed is replaced by a reviewed reading that lands later. project_reviewed_image_analysis
-- (20261120140000, Rule 3) leaves exactly this: the automatic reading and its keyed children superseded, a new current reading, and
-- the photo stamped for the first time, the stamp pointing at the new reading with its tier (that migration's own contract proves it
-- writes this). keyed_values must then be due again for the new reading, whether the earlier receipt keyed a value (440) or closed
-- with nothing to key (441).
SELECT pg_temp.tiered(440, 'subscription automatic'); SELECT pg_temp.child(440); SELECT pg_temp.tiered(441, 'subscription automatic');
UPDATE public.vehicle_observations SET ingested_at = now() - interval '3 hours' WHERE id IN (pg_temp.obs(440), pg_temp.obs(441));
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail, observed_at) VALUES
  (pg_temp.img(440), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded', '{}', now() - interval '3 hours'),
  (pg_temp.img(441), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded', '{}', now() - interval '3 hours'),
  (pg_temp.img(440), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', '{}', now() - interval '2 hours'),
  (pg_temp.img(441), 'keyed_values', 'ingest-observation-batch', 1, 'policy_skip', '{"reason":"no_known_scalar_values"}', now() - interval '2 hours');
SELECT pg_temp.ok(NOT pg_temp.has_gap(440, 'deep_reading') AND NOT pg_temp.has_gap(441, 'deep_reading') AND NOT pg_temp.has_gap(440, 'keyed_values') AND NOT pg_temp.has_gap(441, 'keyed_values')
  AND ARRAY[pg_temp.deep_is(440), pg_temp.keyed_is(440), pg_temp.deep_is(441), pg_temp.keyed_is(441)] = ARRAY['done/-', 'done/-', 'done/-', 'closed_no_value/no_known_scalar_values']
  AND (SELECT (keyed, keyed_automatic) = (true, true) FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(440)),
  'an automatic reading, keyed or closed with nothing to key: both stages are closed, and 440 counts as keyed automatically');
CREATE FUNCTION pg_temp.replaced_by(n int, tier text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE nid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, agent_tier)
  VALUES (nid, pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(n)), tier);
  UPDATE public.vehicle_observations SET is_superseded = true
   WHERE id = pg_temp.obs(n)
      OR (structured_data ->> 'analysis_kind' = 'image_property_projection' AND structured_data ->> 'image_id' = pg_temp.img(n)::text
          AND structured_data ->> 'source_observation_id' = pg_temp.obs(n)::text);
  -- the stamp the reviewed landing writes (the automatic reading before it left none)
  UPDATE public.vehicle_images
     SET ai_scan_metadata = ai_scan_metadata || jsonb_build_object('byok_deep_analysis', jsonb_build_object('scene_type', 'exterior', 'observation_id', nid, 'agent_tier', tier))
   WHERE id = pg_temp.img(n);
  RETURN nid;
END $$;
SELECT pg_temp.replaced_by(440, 'caller-byok subscription') AS new440 \gset
SELECT pg_temp.replaced_by(441, 'caller-byok subscription') AS new441 \gset
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_gaps(ARRAY[pg_temp.img(440), pg_temp.img(441)]) WHERE stage = 'keyed_values' AND reason = 'outdated') = 2
  AND NOT pg_temp.has_gap(440, 'deep_reading') AND NOT pg_temp.has_gap(441, 'deep_reading'),
  'after the replacement keyed_values is due again for both photos (outdated); deep_reading stays closed by the reviewed reading');
-- A reviewed reading's stamp landing is the event that makes it due: the photo's own update (photo_land_trigger) queued keyed_values
-- in the same statement, with no wait for the reconciler's pass. Nothing was queued for deep_reading.
SELECT pg_temp.ok(pg_temp.open_items(440, 'keyed_values') = 1 AND pg_temp.open_items(441, 'keyed_values') = 1
  AND pg_temp.open_items(440, 'deep_reading') = 0 AND pg_temp.open_items(441, 'deep_reading') = 0,
  'the new reading''s stamp landing queued keyed_values for both photos at once, and nothing else');
SELECT pg_temp.ok(ARRAY[pg_temp.deep_is(440), pg_temp.keyed_is(440), pg_temp.deep_is(441), pg_temp.keyed_is(441)] = ARRAY['done/-', 'queued/-', 'done/-', 'queued/-']
  AND (SELECT (keyed, keyed_automatic, obs_id) = (false, false, :'new440'::uuid) FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(440)),
  'levels: both queued for keyed_values; the superseded keyed value no longer counts and the reading is the new one');
-- every keyed_values gap of the vehicle is either queued (these two) or unqueued (the six readings nobody has keyed) in the levels
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_gaps(ARRAY(SELECT id FROM public.vehicle_images WHERE vehicle_id = pg_temp.v1())) WHERE stage = 'keyed_values') = 8
  AND (SELECT (count(*) FILTER (WHERE keyed_state = 'unqueued'), count(*) FILTER (WHERE keyed_state = 'queued')) = (6, 2) FROM image_stage_photo_levels(NULL, pg_temp.v1())),
  'after the replacement: eight keyed_values gaps, six unqueued and these two queued');
-- asking again queues nothing more (one open item per gap), and a receipt for the new reading closes it
SELECT pg_temp.ok(public.enqueue_image_stage_work(ARRAY[pg_temp.img(440), pg_temp.img(441)]) = 0 AND pg_temp.open_items(440, 'keyed_values') = 1 AND pg_temp.open_items(441, 'keyed_values') = 1,
  'a second enqueue adds nothing');
DO $$ DECLARE cid uuid := gen_random_uuid(); BEGIN
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, property_id, extraction_method)
  VALUES (cid, pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_property_projection', 'image_id', pg_temp.img(440),
          'source_observation_id', (SELECT ai_scan_metadata #>> '{byok_deep_analysis,observation_id}' FROM public.vehicle_images WHERE id = pg_temp.img(440))),
          gen_random_uuid(), 'cached_byok_property_projection_v1');
  INSERT INTO public.observation_witnesses VALUES (cid, pg_temp.img(440), 'subject');
END $$;
SELECT public.record_image_stage_receipt(pg_temp.img(440), 'keyed_values', 1, 'succeeded');
SELECT public.record_image_stage_receipt(pg_temp.img(441), 'keyed_values', 1, 'policy_skip', p_detail => '{"reason":"no_known_scalar_values"}');
SELECT pg_temp.ok(NOT pg_temp.has_gap(440, 'keyed_values') AND NOT pg_temp.has_gap(441, 'keyed_values') AND pg_temp.open_items(440, 'keyed_values') = 0 AND pg_temp.open_items(441, 'keyed_values') = 0
  AND ARRAY[pg_temp.keyed_is(440), pg_temp.keyed_is(441)] = ARRAY['done/-', 'closed_no_value/no_known_scalar_values']
  AND (SELECT (keyed, keyed_automatic) = (true, true) FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(440)),
  'a receipt for the new reading closes keyed_values again: 440 keyed from the new reading, 441 closed with nothing to key');
-- An automatic reading's landing writes nothing on the photo (it is its observation alone), so the photo's update trigger never fires
-- for it. keyed_values comes due through the reader's deep_reading receipt: record_image_stage_receipt asks the gap finder about the
-- photo again in the same call. 450, in the reader's order of events: queued, read and posted, receipt.
SELECT pg_temp.mk(450);
SELECT pg_temp.ok(public.enqueue_image_stage_work(ARRAY[pg_temp.img(450)]) = 1 AND pg_temp.open_items(450, 'deep_reading') = 1 AND pg_temp.open_items(450, 'keyed_values') = 0,
  'a filed, first-read photo in scope with no reading: deep_reading is queued; keyed_values has no reading to key from');
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, agent_tier)
VALUES (pg_temp.obs(450), pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(450)), 'subscription automatic');
SELECT pg_temp.ok(pg_temp.open_items(450, 'keyed_values') = 0 AND pg_temp.has_gap(450, 'keyed_values') AND pg_temp.has_gap(450, 'deep_reading')
  AND ARRAY[pg_temp.deep_is(450), pg_temp.keyed_is(450)] = ARRAY['queued/-', 'unqueued/-'],
  'the reading is posted and nothing of the photo changed: nothing new is queued; keyed_values is a gap nobody has queued, deep_reading is open until its receipt');
SELECT public.record_image_stage_receipt(pg_temp.img(450), 'deep_reading', 1, 'succeeded');
SELECT pg_temp.ok(pg_temp.open_items(450, 'deep_reading') = 0 AND pg_temp.open_items(450, 'keyed_values') = 1 AND NOT pg_temp.has_gap(450, 'deep_reading'),
  'the deep_reading receipt closes its stage and queues keyed_values in the same call, with no wait for the reconciler''s pass');
SELECT pg_temp.ok(ARRAY[pg_temp.deep_is(450), pg_temp.keyed_is(450)] = ARRAY['done/-', 'queued/-']
  AND (SELECT (deep_read, deep_automatic, obs_id) = (true, true, pg_temp.obs(450)) FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(450)),
  'levels: read automatically, keyed_values queued, and the reading is the observation');
-- 451: an automatic reading keyed two hours ago is read again by the automatic reader (the stage's version was raised for a new
-- method). The new observation supersedes the old one and its keyed child (Rule 3) and nothing of the photo changes; the new
-- deep_reading receipt queues keyed_values for the new reading.
SELECT pg_temp.tiered(451, 'subscription automatic'); SELECT pg_temp.child(451);
UPDATE public.vehicle_observations SET ingested_at = now() - interval '3 hours' WHERE id = pg_temp.obs(451);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, detail, observed_at) VALUES
  (pg_temp.img(451), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded', '{}', now() - interval '3 hours'),
  (pg_temp.img(451), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded', '{}', now() - interval '2 hours');
SELECT pg_temp.ok(NOT pg_temp.has_gap(451, 'deep_reading') AND NOT pg_temp.has_gap(451, 'keyed_values') AND ARRAY[pg_temp.deep_is(451), pg_temp.keyed_is(451)] = ARRAY['done/-', 'done/-'],
  'an automatic reading, read and keyed: both stages closed');
UPDATE image_pipeline_stages SET required_version = 2 WHERE stage = 'deep_reading';
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(451)]) WHERE stage = 'deep_reading') = 'outdated' AND NOT pg_temp.has_gap(451, 'keyed_values'),
  'the stage version is raised: the photo is offered to the automatic reader again; its keyed value stands meanwhile');
DO $$ DECLARE nid uuid := gen_random_uuid(); BEGIN
  INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, agent_tier)
  VALUES (nid, pg_temp.v1(), 'condition', jsonb_build_object('analysis_kind', 'image_deep_byok', 'image_id', pg_temp.img(451)), 'subscription automatic');
  UPDATE public.vehicle_observations SET is_superseded = true
   WHERE id = pg_temp.obs(451)
      OR (structured_data ->> 'analysis_kind' = 'image_property_projection' AND structured_data ->> 'image_id' = pg_temp.img(451)::text
          AND structured_data ->> 'source_observation_id' = pg_temp.obs(451)::text);
END $$;
SELECT pg_temp.ok(pg_temp.open_items(451, 'keyed_values') = 0 AND pg_temp.open_items(451, 'deep_reading') = 0,
  'the new automatic reading landed and replaced the old one: no photo update, so nothing is queued by the landing itself');
SELECT public.record_image_stage_receipt(pg_temp.img(451), 'deep_reading', 2, 'succeeded');
SELECT pg_temp.ok(pg_temp.open_items(451, 'keyed_values') = 1 AND NOT pg_temp.has_gap(451, 'deep_reading')
  AND (SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(451)]) WHERE stage = 'keyed_values') = 'outdated'
  AND ARRAY[pg_temp.deep_is(451), pg_temp.keyed_is(451)] = ARRAY['done/-', 'queued/-']
  AND (SELECT (keyed, obs_id <> pg_temp.obs(451)) = (false, true) FROM image_stage_photo_levels(NULL, pg_temp.v1()) WHERE image_id = pg_temp.img(451)),
  'the new reading''s deep_reading receipt queues keyed_values for it; the superseded keyed value no longer counts');
UPDATE image_pipeline_stages SET required_version = 1 WHERE stage = 'deep_reading';
DELETE FROM image_stage_work; DELETE FROM image_stage_receipts; DELETE FROM public.observation_witnesses; DELETE FROM public.vehicle_observations;
DELETE FROM public.vehicle_images; DELETE FROM platform_config WHERE config_key = 'image_reading_tiers';

-- ===== 10. a replay changes nothing, and keeps a scope someone has switched on
UPDATE platform_config SET config_value = config_value || '{"enabled": true}' WHERE config_key = 'image_stage_deep_reading';
UPDATE image_pipeline_stages SET backfill_daily_cap = 99 WHERE stage = 'deep_reading';
SELECT md5(string_agg(md5(prosrc), ',' ORDER BY oid::regprocedure::text)) AS fns_before FROM pg_proc WHERE proname LIKE 'image_stage%' OR proname IN ('enqueue_image_stage_work', 'photo_land_trigger', 'record_image_stage_receipt', 'reconcile_image_stages', 'assay_photo_reading_flow') \gset
\ir ../migrations/20261120130000_photo_deep_reading_keyed_values_stages.sql
SELECT pg_temp.ok((SELECT config_value ->> 'enabled' = 'true' FROM platform_config WHERE config_key = 'image_stage_deep_reading'), 'replay: an enabled scope stays enabled');
SELECT pg_temp.ok((SELECT backfill_daily_cap = 150 FROM image_pipeline_stages WHERE stage = 'deep_reading'), 'replay: the registry row is the migration''s');
SELECT md5(string_agg(md5(prosrc), ',' ORDER BY oid::regprocedure::text)) AS fns_after FROM pg_proc WHERE proname LIKE 'image_stage%' OR proname IN ('enqueue_image_stage_work', 'photo_land_trigger', 'record_image_stage_receipt', 'reconcile_image_stages', 'assay_photo_reading_flow') \gset
SELECT pg_temp.ok(:'fns_before' = :'fns_after', 'replay: every function is byte for byte the same');

-- ===== 11. the revert: each replaced function is the body production held, what was added is gone
\ir revert_20261120130000_photo_deep_reading_keyed_values_stages.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_stage_gaps(uuid[])'::regprocedure) = '2190aee1bc568d23a95dcf5f4fd76687'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_stage_legacy_evidence(text,jsonb,jsonb,text)'::regprocedure) = '0ff666f6cc4fc8611737cf73e9c37b29'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_stage_legacy_version(text,jsonb)'::regprocedure) = 'f21e15d0a93aad124a1d078de9e8a053'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.photo_land_trigger()'::regprocedure) = '307261071b2aa3fef7a83297d63a9638'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)'::regprocedure) = '8209f1ce4dec11626d2ab8320bc97dac'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure) = 'ecc3d3ed7c93eff04c1febf6863d32db'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.image_stage_coverage(uuid)'::regprocedure) = 'e92ca8da307520efe9300e70d9ae80c4'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.assay_photo_reading_flow(boolean)'::regprocedure) = '343829ffb39b394fd302e455bdc86d68',
  'revert: all eight replaced functions are the bodies production held');
SELECT pg_temp.ok(to_regprocedure('public.enqueue_image_stage_work(uuid[],text)') IS NULL AND to_regprocedure('public.image_stage_levels(uuid)') IS NULL
  AND to_regprocedure('public.image_stage_photo_levels(uuid,uuid)') IS NULL AND to_regprocedure('public.image_stage_scope_ok(jsonb,uuid,uuid)') IS NULL
  AND to_regprocedure('public.image_stage_backfill_cap_left(text)') IS NULL AND to_regprocedure('public.image_stage_keyed_child_exists(uuid,uuid)') IS NULL
  AND to_regprocedure('public.image_stage_reading_is_thin(text)') IS NULL,
  'revert: the new functions are gone');
SELECT pg_temp.ok((SELECT count(*) FROM image_pipeline_stages) = 4 AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'image_pipeline_stages' AND column_name = 'backfill_daily_cap')
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'image_stage_deep_reading')
  AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'image_pipeline_stages_applies_when_check') NOT LIKE '%filed_for_reading%', 'revert: no registry rows, column, check or scope row left');
SELECT pg_temp.ok((SELECT proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.image_stage_coverage(uuid)'::regprocedure) AND NOT (image_stage_coverage(pg_temp.v1()) ? 'levels'), 'revert: coverage(uuid) has no levels');
-- with receipts of the new stages in the ledger the revert keeps their history
\ir ../migrations/20261120130000_photo_deep_reading_keyed_values_stages.sql
SELECT pg_temp.mk(301);
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome) VALUES (pg_temp.img(301), 'deep_reading', 'photo-pipeline-orchestrator', 1, 'succeeded');
\ir revert_20261120130000_photo_deep_reading_keyed_values_stages.sql
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_receipts WHERE stage = 'deep_reading') = 1 AND (SELECT NOT required FROM image_pipeline_stages WHERE stage = 'deep_reading')
  AND to_regprocedure('public.enqueue_image_stage_work(uuid[],text)') IS NULL, 'revert with receipts: the history stays, the stage is no longer required');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(301)]) WHERE stage <> 'classifier'), 'and the old gap finder ignores it');
\echo 'image stage keyed values contract passed'
