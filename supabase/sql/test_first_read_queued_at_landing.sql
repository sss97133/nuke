-- Contract for 20261120183500_first_read_queued_at_landing.sql, on a fresh disposable database: a photo whose user
-- has a stage reader is queued for that reader by the INSERT that lands it, and is not also posted to the provider
-- path; every other photo is posted exactly as before; a failed provider read queues the first read at once; a
-- reading a stage reader supplied does not close the provider's breaker; the drain leaves a queued photo to its
-- reader while the item is leased or fresh. Every landing here is a real INSERT with production's trigger attached
-- (the outgoing call is a recorder). With the switch off, or after the revert, behaviour is what it was.
-- The stage ledger's migrations are replayed with \ir; the fixture holds only the tables and columns they read.
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
\ir ../migrations/20261120130000_photo_deep_reading_keyed_values_stages.sql

-- ===== what this contract adds to the fixture: the columns the trigger reads, the outgoing call as a recorder, and the
-- four functions and the trigger exactly as production held them on 2026-11-20 (pg_get_functiondef, byte for byte)
ALTER TABLE public.vehicle_images ADD COLUMN vehicle_score real, ADD COLUMN apple_ml_labels text[], ADD COLUMN source text;
-- production's column defaults (information_schema, 2026-11-20)
ALTER TABLE public.vehicle_images ALTER COLUMN is_duplicate SET DEFAULT false, ALTER COLUMN is_external SET DEFAULT false,
  ALTER COLUMN is_sensitive SET DEFAULT false, ALTER COLUMN is_superseded SET DEFAULT false, ALTER COLUMN ai_processing_status SET DEFAULT 'pending';
UPDATE public.photo_pipeline_provider_state SET consecutive_failures = 0 WHERE provider = 'classifier';
CREATE SCHEMA net;
CREATE TABLE net.posts (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.posts (url, headers, body) VALUES ($1, $4, $2) RETURNING id $$;
-- the two functions 20261120184500 patches, as stubs that carry its marker (the migration refuses to apply without it)
CREATE FUNCTION public.capture_sets_score() RETURNS int LANGUAGE sql AS $$ SELECT 1 /* (20261120184500) */ $$;
CREATE FUNCTION public.capture_landing_plan_step() RETURNS int LANGUAGE sql AS $$ SELECT 1 /* (20261120184500) */ $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'https://project.example.test'::text $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'not-a-key'::text $$;

CREATE OR REPLACE FUNCTION public.trigger_photo_pipeline_orchestrator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.ai_processing_status = 'pending' AND NEW.image_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := jsonb_build_object(
        'image_id', NEW.id,
        'image_url', NEW.image_url,
        'vehicle_id', NEW.vehicle_id,
        'user_id', NEW.user_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Non-blocking by design: the drain cron picks up anything this misses.
  RAISE WARNING 'photo-pipeline trigger failed (pg_net?): %', SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.photo_pipeline_note_failure(p_image_id uuid, p_error_class text, p_http_status integer DEFAULT NULL::integer, p_fallback_error_class text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_transient boolean; v_rl boolean; v_max int; v_att int; v_rl_att int; v_delay numeric; v_next timestamptz; v_terminal boolean; v_cf int; v_block numeric;
begin
  v_rl := p_error_class in ('classifier_rate_limited','provider_cooldown','classifier_usage_budget_exceeded')
          or p_http_status in (429, 402)
          or p_fallback_error_class = 'classifier_rate_limited';
  v_transient := v_rl or p_error_class in ('classifier_timeout','classifier_request_error','image_download_timeout','image_download_error','classifier_key_missing','pipeline_operation_failed','classifier_response_invalid','classifier_response_incomplete','classifier_response_empty','classifier_usage_missing')
    or (p_error_class in ('classifier_http_error','classifier_count_http_error','image_http_error') and (p_http_status in (408,425) or coalesce(p_http_status,0) >= 500));
  v_max := case when p_error_class like 'classifier_response_%' or p_error_class like 'classifier_usage_%' or p_error_class = 'pipeline_operation_failed' then 3 else 8 end;
  insert into public.photo_pipeline_retry_state as r (image_id, attempts, rate_limited_attempts, last_error_class, last_http_status, last_fallback_error_class, updated_at)
  values (p_image_id, 1, case when v_rl then 1 else 0 end, p_error_class, p_http_status, p_fallback_error_class, now())
  on conflict (image_id) do update set
    attempts = r.attempts + case when v_rl then 0 else 1 end,            -- provider-wide rate limits do not burn the per-image budget
    rate_limited_attempts = r.rate_limited_attempts + case when v_rl then 1 else 0 end,
    last_error_class = p_error_class, last_http_status = p_http_status, last_fallback_error_class = p_fallback_error_class, updated_at = now()
  returning r.attempts, r.rate_limited_attempts into v_att, v_rl_att;

  if v_rl then
    -- provider circuit breaker: exponential, jittered, capped at 6h; credit exhaustion (402) starts at 30 min
    update public.photo_pipeline_provider_state set consecutive_failures = consecutive_failures + 1, last_http_status = p_http_status,
           last_error_class = p_error_class, updated_at = now() where provider = 'classifier' returning consecutive_failures into v_cf;
    v_block := least(21600, (case when p_http_status = 402 then 1800 else 60 end) * power(2, least(v_cf, 8) - 1)) * (0.8 + random() * 0.4);
    update public.photo_pipeline_provider_state set blocked_until = greatest(coalesce(blocked_until, now()), now() + make_interval(secs => v_block)),
           note = case when p_http_status = 402 then 'provider returned 402 (credits exhausted?) - owner action needed' else 'rate limited' end
     where provider = 'classifier';
    v_terminal := v_rl_att >= 12;                                         -- ~days of spaced attempts before giving up on an image
    v_delay := least(21600, 300 * power(2, v_rl_att - 1)) * (0.8 + random() * 0.4);
  else
    v_terminal := not v_transient or v_att >= v_max;
    v_delay := least(7200, 120 * power(2, v_att - 1)) * (0.8 + random() * 0.4);
  end if;
  if v_terminal then
    update public.photo_pipeline_retry_state set terminal = true, next_attempt_at = null where image_id = p_image_id;
    return jsonb_build_object('status','failed','transient',v_transient,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',null);
  end if;
  v_next := now() + make_interval(secs => v_delay);
  update public.photo_pipeline_retry_state set next_attempt_at = v_next, terminal = false where image_id = p_image_id;
  return jsonb_build_object('status','pending','transient',true,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',v_next);
end $function$;

CREATE OR REPLACE FUNCTION public.photo_pipeline_clear_retry(p_image_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.photo_pipeline_retry_state where image_id = p_image_id;
  update public.photo_pipeline_provider_state set consecutive_failures = 0, blocked_until = null, note = 'healthy', updated_at = now()
   where provider = 'classifier' and (consecutive_failures > 0 or blocked_until is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.claim_photo_pipeline_batch(p_limit integer DEFAULT 8, p_lease_seconds integer DEFAULT 300)
 RETURNS TABLE(id uuid, image_url text, vehicle_id uuid, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb; v_cut timestamptz := '-infinity';
begin
  -- circuit breaker: while the provider is cooling down nobody claims (no hammering, no attempts burnt)
  if exists (select 1 from public.photo_pipeline_provider_state s where s.provider = 'classifier' and s.blocked_until > now()) then return; end if;
  select config_value into v_cfg from public.platform_config where config_key = 'photo_pipeline_backlog';
  if v_cfg is not null and coalesce((v_cfg->>'enabled')::boolean, true) = false then
    v_cut := now() - make_interval(days => coalesce((v_cfg->>'recent_days')::int, 14));
  end if;
  return query
  with cand as (
    select v.id from public.vehicle_images v
    where v.ai_processing_status = 'pending' and v.user_id is not null and v.is_duplicate = false and v.image_url is not null
      and v.created_at >= v_cut
      and not exists (select 1 from public.photo_pipeline_retry_state r
                       where r.image_id = v.id and (r.terminal or r.next_attempt_at is null or r.next_attempt_at > now()))
    order by v.created_at desc
    limit least(greatest(p_limit, 1), 25)
    for update of v skip locked
  ), lease as (
    insert into public.photo_pipeline_retry_state as r (image_id, attempts, next_attempt_at, updated_at)
    select c.id, 0, now() + make_interval(secs => p_lease_seconds), now() from cand c
    on conflict (image_id) do update set next_attempt_at = excluded.next_attempt_at, updated_at = now()   -- attempts preserved
    returning r.image_id
  )
  select v.id, v.image_url, v.vehicle_id, v.user_id from public.vehicle_images v join lease l on l.image_id = v.id;
end $function$;

-- production's grants on the three retry functions (service role only) and the trigger as production holds it
REVOKE ALL ON FUNCTION public.photo_pipeline_note_failure(uuid, text, integer, text), public.photo_pipeline_clear_retry(uuid),
  public.claim_photo_pipeline_batch(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.photo_pipeline_note_failure(uuid, text, integer, text), public.photo_pipeline_clear_retry(uuid),
  public.claim_photo_pipeline_batch(integer, integer) TO service_role;
CREATE TRIGGER trigger_photo_pipeline_on_image_insert AFTER INSERT ON public.vehicle_images FOR EACH ROW
  WHEN (((new.ai_processing_status = 'pending'::text) AND (new.is_duplicate IS NOT TRUE) AND (new.is_external IS NOT TRUE)))
  EXECUTE FUNCTION trigger_photo_pipeline_orchestrator();

-- U1 is the reader's user (named in image_stage_reconciler.user_ids); U2 is someone else
CREATE FUNCTION pg_temp.u1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE FUNCTION pg_temp.u2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-4000-8000-0000000000a2'::uuid $$;
-- a landing: a real INSERT, as the phone makes it (pending, unfiled, with pixels, metadata the column default '{}'), through the trigger
CREATE FUNCTION pg_temp.land(n int, usr uuid DEFAULT NULL, url text DEFAULT NULL, status text DEFAULT 'pending', score real DEFAULT NULL,
  labels text[] DEFAULT NULL, sens boolean DEFAULT NULL, gate text DEFAULT NULL, dup boolean DEFAULT NULL, ext boolean DEFAULT NULL,
  age interval DEFAULT interval '0', meta jsonb DEFAULT '{}'::jsonb, sup boolean DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (id, user_id, image_url, created_at, is_duplicate, is_sensitive, is_external, vision_gate_status,
    ai_processing_status, ai_scan_metadata, vehicle_score, apple_ml_labels, source, is_superseded)
  VALUES (pg_temp.img(n), coalesce(usr, pg_temp.u1()), coalesce(url, 'https://example.test/' || n || '.heic'), now() - age,
    coalesce(dup, false), coalesce(sens, false), coalesce(ext, false), gate, status, meta, score, labels, 'capture_relay_ios', coalesce(sup, false))
  RETURNING id $$;
-- open first-read items of a photo, and calls posted to the provider path for it
CREATE FUNCTION pg_temp.items(n int) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.image_stage_work WHERE image_id = pg_temp.img(n) AND stage = 'classifier' AND status IN ('queued', 'claimed') $$;
CREATE FUNCTION pg_temp.posts(n int) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM net.posts WHERE body ->> 'image_id' = pg_temp.img(n)::text $$;
CREATE FUNCTION pg_temp.cfg(patch jsonb) RETURNS void LANGUAGE sql AS
  $$ UPDATE public.platform_config SET config_value = config_value || patch WHERE config_key = 'image_stage_reconciler' $$;
CREATE FUNCTION pg_temp.md5_of(fn text) RETURNS text LANGUAGE sql AS $$ SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(fn) $$;
-- everything the migration and its revert touch, as one value: a refused run must leave it as it was
CREATE FUNCTION pg_temp.state() RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p
                        WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('enqueue_first_read', 'trigger_photo_pipeline_orchestrator',
                              'photo_pipeline_note_failure', 'photo_pipeline_clear_retry', 'claim_photo_pipeline_batch')), '')
          || coalesce((SELECT config_value::text FROM platform_config WHERE config_key = 'image_stage_reconciler'), '')) $$;
-- a function's definition with one comment line added at the end of its body: the same function, a different body text
CREATE FUNCTION pg_temp.drifted(fn text) RETURNS text LANGUAGE sql AS
  $$ SELECT regexp_replace(pg_get_functiondef(fn::regprocedure), '\$function\$\s*$', E'-- changed since\n$function$') $$;
CREATE FUNCTION pg_temp.breaker(failures int, blocked interval) RETURNS void LANGUAGE sql AS
  $$ UPDATE public.photo_pipeline_provider_state SET consecutive_failures = failures, blocked_until = now() + blocked, note = 'rate limited'
      WHERE provider = 'classifier' $$;

-- ===== 0. before the migration: the fixture is production's, and every landing is posted
SELECT pg_temp.ok(pg_temp.md5_of('public.trigger_photo_pipeline_orchestrator()') = '7f4ca0dd8c113e4ad3e0b598a309d9dd'
  AND pg_temp.md5_of('public.photo_pipeline_note_failure(uuid,text,integer,text)') = '67c780fd9014369409c30f632cd10756'
  AND pg_temp.md5_of('public.photo_pipeline_clear_retry(uuid)') = '224bf3fc0d48429dea2dbd802903342b'
  AND pg_temp.md5_of('public.claim_photo_pipeline_batch(integer,integer)') = 'fdc2cfcaa4afaa53c94f33b383224e22',
  'fixture: the four functions are the bodies production held on 2026-11-20');
SELECT pg_temp.land(1);
SELECT pg_temp.land(2, usr => pg_temp.u2());
SELECT pg_temp.ok(pg_temp.posts(1) = 1 AND pg_temp.posts(2) = 1 AND (SELECT count(*) FROM image_stage_work) = 0,
  'before: every landing is posted to the provider path and nothing is queued');
SELECT pg_temp.ok((SELECT body ->> 'image_url' = 'https://example.test/1.heic' AND body ->> 'user_id' = pg_temp.u1()::text AND body ? 'vehicle_id'
                          AND url = 'https://project.example.test/functions/v1/photo-pipeline-orchestrator' FROM net.posts WHERE body ->> 'image_id' = pg_temp.img(1)::text),
  'before: the post carries the photo, its url, its user and its vehicle');
-- before: what note_failure answers for three failures (compared with the new body's answers in section 5)
SELECT pg_temp.land(3, usr => pg_temp.u2());
SELECT pg_temp.land(4, usr => pg_temp.u2());
SELECT pg_temp.land(5, usr => pg_temp.u2());
CREATE TEMP TABLE nf_before AS
SELECT 1 AS k, photo_pipeline_note_failure(pg_temp.img(3), 'classifier_rate_limited', 429, NULL) - 'next_attempt_at' AS answer
UNION ALL SELECT 2, photo_pipeline_note_failure(pg_temp.img(4), 'image_http_error', 404, NULL) - 'next_attempt_at'
UNION ALL SELECT 3, photo_pipeline_note_failure(pg_temp.img(5), 'image_http_error', 404, 'none') - 'next_attempt_at';
SELECT pg_temp.ok((SELECT count(*) FROM nf_before WHERE answer ? 'status' AND answer ? 'attempts') = 3, 'before: note_failure answered three failures');
-- before: a reading supplied by a reader closes the provider's breaker (what section 6 changes)
SELECT pg_temp.breaker(7, interval '1 hour');
UPDATE public.vehicle_images SET ai_processing_status = 'completed',
       ai_scan_metadata = '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true},"photo_pipeline":{"receipt":{"outcome":"completed","classifier_model":"reader:claude-cli sonnet subscription"}}}'
 WHERE id = pg_temp.img(1);
SELECT photo_pipeline_clear_retry(pg_temp.img(1));
SELECT pg_temp.ok((SELECT consecutive_failures = 0 AND blocked_until IS NULL FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'before: a reader''s reading resets the provider''s breaker');

-- ===== 0b. the migration refuses to apply, and leaves everything as it was, in each of three states
-- (a) 20261120184500 is not live: one of its two functions lacks the marker
CREATE OR REPLACE FUNCTION public.capture_landing_plan_step() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
SELECT pg_temp.state() AS s_a \gset
\set ON_ERROR_STOP off
\ir ../migrations/20261120183500_first_read_queued_at_landing.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(pg_temp.state() = :'s_a' AND to_regprocedure('public.enqueue_first_read(uuid)') IS NULL,
  'refused: 20261120184500 is not live, and nothing changed');
CREATE OR REPLACE FUNCTION public.capture_landing_plan_step() RETURNS int LANGUAGE sql AS $$ SELECT 1 /* (20261120184500) */ $$;
-- (b) one of the four bodies it replaces was changed since it was read from production
CREATE TEMP TABLE kept_note_failure AS SELECT pg_get_functiondef('public.photo_pipeline_note_failure(uuid,text,integer,text)'::regprocedure) AS def;
DO $do$ BEGIN EXECUTE pg_temp.drifted('public.photo_pipeline_note_failure(uuid,text,integer,text)'); END $do$;
SELECT pg_temp.ok(pg_temp.md5_of('public.photo_pipeline_note_failure(uuid,text,integer,text)') <> '67c780fd9014369409c30f632cd10756', 'fixture: the body differs now');
SELECT pg_temp.state() AS s_b \gset
\set ON_ERROR_STOP off
\ir ../migrations/20261120183500_first_read_queued_at_landing.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(pg_temp.state() = :'s_b' AND to_regprocedure('public.enqueue_first_read(uuid)') IS NULL,
  'refused: a body someone changed is not overwritten, and nothing else changed');
DO $do$ BEGIN EXECUTE (SELECT def FROM kept_note_failure); END $do$;
-- (c) one of the four is missing
CREATE TEMP TABLE kept_clear_retry AS SELECT pg_get_functiondef('public.photo_pipeline_clear_retry(uuid)'::regprocedure) AS def;
DROP FUNCTION public.photo_pipeline_clear_retry(uuid);
SELECT pg_temp.state() AS s_c \gset
\set ON_ERROR_STOP off
\ir ../migrations/20261120183500_first_read_queued_at_landing.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(pg_temp.state() = :'s_c' AND to_regprocedure('public.enqueue_first_read(uuid)') IS NULL AND to_regprocedure('public.photo_pipeline_clear_retry(uuid)') IS NULL,
  'refused: a missing function is not recreated, and nothing else changed');
DO $do$ BEGIN EXECUTE (SELECT def FROM kept_clear_retry); END $do$;
REVOKE ALL ON FUNCTION public.photo_pipeline_clear_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.photo_pipeline_clear_retry(uuid) TO service_role;
SELECT pg_temp.ok(pg_temp.md5_of('public.trigger_photo_pipeline_orchestrator()') = '7f4ca0dd8c113e4ad3e0b598a309d9dd'
  AND pg_temp.md5_of('public.photo_pipeline_note_failure(uuid,text,integer,text)') = '67c780fd9014369409c30f632cd10756'
  AND pg_temp.md5_of('public.photo_pipeline_clear_retry(uuid)') = '224bf3fc0d48429dea2dbd802903342b'
  AND pg_temp.md5_of('public.claim_photo_pipeline_batch(integer,integer)') = 'fdc2cfcaa4afaa53c94f33b383224e22',
  'fixture: the four bodies are production''s again');

\ir ../migrations/20261120183500_first_read_queued_at_landing.sql

-- ===== 1. the switch is on the stage ledger's config row; grants and settings are as they were
SELECT pg_temp.ok((SELECT config_value -> 'first_read_at_landing' = 'true'::jsonb AND config_value -> 'provider_fallback_after_minutes' = '30'::jsonb
                          AND config_value ->> 'max_open' = '300' AND config_value ->> 'min_age_minutes' = '15' AND config_value ->> 'enabled' = 'true'
                          AND jsonb_array_length(config_value -> 'user_ids') = 1
                     FROM platform_config WHERE config_key = 'image_stage_reconciler'),
  'config: the switch and the hand-back time are added and every other key is kept');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.enqueue_first_read(uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.enqueue_first_read(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.enqueue_first_read(uuid)', 'execute'), 'enqueue_first_read: service role only');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.photo_pipeline_note_failure(uuid,text,integer,text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.photo_pipeline_clear_retry(uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.claim_photo_pipeline_batch(integer,integer)', 'execute')
  AND has_function_privilege('service_role', 'public.photo_pipeline_note_failure(uuid,text,integer,text)', 'execute')
  AND has_function_privilege('service_role', 'public.photo_pipeline_clear_retry(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.claim_photo_pipeline_batch(integer,integer)', 'execute'),
  'the three replaced retry functions keep their grants');
SELECT pg_temp.ok((SELECT prosecdef AND proconfig IS NULL FROM pg_proc WHERE oid = 'public.trigger_photo_pipeline_orchestrator()'::regprocedure)
  AND (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.claim_photo_pipeline_batch(integer,integer)'::regprocedure)
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_images'::regclass AND tgname = 'trigger_photo_pipeline_on_image_insert' AND tgenabled = 'O') = 1,
  'the trigger and the functions'' settings are untouched');
SELECT pg_temp.ok(pg_temp.md5_of('public.trigger_photo_pipeline_orchestrator()') = 'd1c9f863d032d4165bbcef4ab51cf87e'
  AND pg_temp.md5_of('public.photo_pipeline_note_failure(uuid,text,integer,text)') = 'cc355c2f54ef36a0200dbaa812e1f71a'
  AND pg_temp.md5_of('public.photo_pipeline_clear_retry(uuid)') = 'ea40463ac96e59b6613a454f34cffb69'
  AND pg_temp.md5_of('public.claim_photo_pipeline_batch(integer,integer)') = '0c3285789eed70d1a52315d719262df6',
  'the bodies are the ones the migration''s guard names as its own');

-- ===== 2. a landing of the reader's user is queued in the INSERT and not posted
SELECT pg_temp.land(10);
SELECT pg_temp.ok(pg_temp.items(10) = 1 AND pg_temp.posts(10) = 0, 'landing: queued for the reader, not posted to the provider path');
SELECT pg_temp.ok((SELECT lane = 'live' AND reason = 'missing' AND target_version = 1 AND status = 'queued' AND not_before <= now() AND lease_until IS NULL
                     FROM image_stage_work WHERE image_id = pg_temp.img(10)), 'landing: one live item, missing, due now');
SELECT pg_temp.ok((SELECT g.reason = w.reason AND g.target_version = w.target_version
                     FROM image_stage_gaps(ARRAY[pg_temp.img(10)]) g JOIN image_stage_work w ON w.image_id = g.image_id AND w.stage = g.stage
                    WHERE g.stage = 'classifier' AND w.status = 'queued'),
  'landing: the item is exactly the gap the finder reports for a photo nothing has processed');
SELECT pg_temp.ok((SELECT ai_processing_status = 'pending' AND ai_scan_metadata = '{}'::jsonb FROM vehicle_images WHERE id = pg_temp.img(10)), 'landing: the photo row itself is as it was inserted');
-- what the row holds decides nothing beyond the ledger's own rules: no metadata at all, and only the phone's own tags
SELECT pg_temp.land(140, meta => NULL);
SELECT pg_temp.land(141, meta => '{"on_device_vision":{"is_vehicle":true,"labels":["car"]}}');
SELECT pg_temp.ok(pg_temp.items(140) = 1 AND pg_temp.posts(140) = 0 AND pg_temp.items(141) = 1 AND pg_temp.posts(141) = 0,
  'landing: a row with no metadata, and one with only the phone''s tags, are queued the same way');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_gaps(ARRAY[pg_temp.img(140), pg_temp.img(141)]) g
                     JOIN image_stage_work w ON w.image_id = g.image_id AND w.stage = g.stage AND w.reason = g.reason AND w.target_version = g.target_version
                    WHERE g.stage = 'classifier' AND w.status = 'queued' AND w.not_before <= now()) = 2,
  'landing: each of those items is the finder''s own gap');
-- the landing path does not run the general finder for an unread photo: with the finder renamed away it is still queued,
-- while a photo whose metadata the ledger reads needs the finder (and, with it gone, is posted as before)
ALTER FUNCTION public.image_stage_gaps(uuid[]) RENAME TO image_stage_gaps_away;
SELECT pg_temp.land(142);
SELECT pg_temp.land(143, meta => '{"skipped":"junk_url"}');
SELECT pg_temp.ok(pg_temp.items(142) = 1 AND pg_temp.posts(142) = 0, 'landing: an unread photo is queued without the general gap finder');
SELECT pg_temp.ok(pg_temp.items(143) = 0 AND pg_temp.posts(143) = 1, 'landing: a photo the finder must judge is posted as before when the finder fails');
ALTER FUNCTION public.image_stage_gaps_away(uuid[]) RENAME TO image_stage_gaps;
SELECT pg_temp.land(144, meta => '{"skipped":"junk_url"}');
SELECT pg_temp.ok(pg_temp.items(144) = 0 AND pg_temp.posts(144) = 1, 'landing: a photo the ledger counts as settled is no gap, so it is posted as before');
-- the reader takes it at once: no grace period, no tick
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 5, 300, pg_temp.u1()) c WHERE c.image_id = pg_temp.img(10)) = 1,
  'landing: the reader''s claim returns the photo straight away');
-- what is not queued is posted exactly as before
SELECT pg_temp.land(11, usr => pg_temp.u2());
SELECT pg_temp.ok(pg_temp.items(11) = 0 AND pg_temp.posts(11) = 1, 'another user''s landing (no reader named): posted as before, nothing queued');
SELECT pg_temp.land(12, score => 0, labels => ARRAY['dog', 'grass']);
SELECT pg_temp.ok(pg_temp.items(12) = 0 AND pg_temp.posts(12) = 1, 'a photo the phone scored 0 and labelled: posted (the orchestrator settles it without a model), not queued');
SELECT pg_temp.land(13, score => 0);
SELECT pg_temp.land(14, score => 0.4, labels => ARRAY['car']);
SELECT pg_temp.ok(pg_temp.items(13) = 1 AND pg_temp.posts(13) = 0 AND pg_temp.items(14) = 1 AND pg_temp.posts(14) = 0,
  'score 0 without labels, or a score above 0: queued (the orchestrator would have read those)');
SELECT pg_temp.land(15, url => 'ph://asset/15');
SELECT pg_temp.land(16, sens => true);
SELECT pg_temp.land(17, gate => 'rejected_personal');
SELECT pg_temp.ok(pg_temp.items(15) = 0 AND pg_temp.posts(15) = 1 AND pg_temp.items(16) = 0 AND pg_temp.posts(16) = 1 AND pg_temp.items(17) = 0 AND pg_temp.posts(17) = 1,
  'not eligible for the reader (no pixels yet, sensitive, rejected as personal): posted as before, nothing queued');
SELECT pg_temp.land(24, sup => true);
SELECT pg_temp.ok(pg_temp.items(24) = 0 AND pg_temp.posts(24) = 1, 'a superseded photo is not the reader''s either: posted as before, nothing queued');
SELECT pg_temp.land(18, dup => true);
SELECT pg_temp.land(19, ext => true);
SELECT pg_temp.land(20, status => 'skipped');
SELECT pg_temp.ok(pg_temp.items(18) + pg_temp.items(19) + pg_temp.items(20) = 0 AND pg_temp.posts(18) + pg_temp.posts(19) + pg_temp.posts(20) = 0,
  'a duplicate, an external photo and a photo that is not pending: the trigger does not fire, as before');
SELECT pg_temp.land(21, age => interval '3 days');
SELECT pg_temp.ok((SELECT lane = 'backfill' FROM image_stage_work WHERE image_id = pg_temp.img(21) AND status = 'queued'), 'a photo older than the live window is queued in the backfill lane');
-- a photo with no user: posted as before
INSERT INTO public.vehicle_images (id, user_id, image_url, ai_processing_status) VALUES (pg_temp.img(22), NULL, 'https://example.test/22.heic', 'pending');
SELECT pg_temp.ok(pg_temp.items(22) = 0 AND pg_temp.posts(22) = 1, 'a photo with no user: posted as before');

-- ===== 3. the switch, the ledger and the reader list decide; anything else is the path before
SELECT pg_temp.cfg('{"first_read_at_landing": false}');
SELECT pg_temp.land(30);
SELECT pg_temp.cfg('{"first_read_at_landing": "true"}');   -- text, not the JSON boolean
SELECT pg_temp.land(31);
UPDATE platform_config SET config_value = config_value - 'first_read_at_landing' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.land(32);
SELECT pg_temp.ok(pg_temp.items(30) + pg_temp.items(31) + pg_temp.items(32) = 0 AND pg_temp.posts(30) = 1 AND pg_temp.posts(31) = 1 AND pg_temp.posts(32) = 1,
  'switch false, not a boolean, or absent: every landing is posted and nothing is queued');
SELECT pg_temp.cfg('{"first_read_at_landing": true, "enabled": false}');
SELECT pg_temp.land(33);
SELECT pg_temp.ok(pg_temp.items(33) = 0 AND pg_temp.posts(33) = 1, 'stage ledger disabled: posted');
SELECT pg_temp.cfg('{"enabled": true}');
UPDATE platform_config SET config_value = config_value - 'user_ids' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.land(34);
SELECT pg_temp.ok(pg_temp.items(34) = 0 AND pg_temp.posts(34) = 1, 'no reader list: nobody is named, so nothing is held back from the provider path');
SELECT pg_temp.cfg('{"user_ids": ["not-a-uuid"]}');
SELECT pg_temp.land(35);
SELECT pg_temp.ok(pg_temp.items(35) = 0 AND pg_temp.posts(35) = 1 AND EXISTS (SELECT 1 FROM vehicle_images WHERE id = pg_temp.img(35)),
  'a reader list that cannot be read: the upload lands and is posted');
SELECT pg_temp.cfg('{"user_ids": ["00000000-0000-4000-8000-0000000000A1"]}');   -- upper case, as an operator might type it
SELECT pg_temp.land(36);
SELECT pg_temp.ok(pg_temp.items(36) = 1 AND pg_temp.posts(36) = 0, 'the reader list is compared as uuids, not as text');
SELECT pg_temp.cfg('{"user_ids": ["00000000-0000-4000-8000-0000000000a1"]}');
DELETE FROM platform_config WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.land(37);
SELECT pg_temp.ok(pg_temp.items(37) = 0 AND pg_temp.posts(37) = 1, 'no config row at all: posted');
INSERT INTO platform_config (config_key, config_value) VALUES ('image_stage_reconciler',
  '{"enabled": true, "max_open": 300, "user_ids": ["00000000-0000-4000-8000-0000000000a1"], "live_days": 2, "refill_below": 100, "scan_per_lane": 200, "backfill_share": 0.5, "min_age_minutes": 15, "first_read_at_landing": true, "provider_fallback_after_minutes": 30}');
-- the cap is max_open open first reads
SELECT pg_temp.cfg(jsonb_build_object('max_open', (SELECT count(*) FROM image_stage_work WHERE stage = 'classifier' AND status IN ('queued', 'claimed'))));
SELECT pg_temp.land(38);
SELECT pg_temp.ok(pg_temp.items(38) = 0 AND pg_temp.posts(38) = 1, 'first reads at max_open: not queued, posted as before');
-- open items of another stage take none of that room (a reading backlog must not send new photos back to the provider)
SELECT pg_temp.cfg(jsonb_build_object('max_open', (SELECT count(*) + 1 FROM image_stage_work WHERE stage = 'classifier' AND status IN ('queued', 'claimed'))));
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, not_before)
SELECT pg_temp.img(g), s.stage, s.required_version, 'missing', 'live', now() FROM generate_series(1, 5) g, image_pipeline_stages s WHERE s.stage = 'deep_reading';
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND status = 'queued') = 5, 'fixture: five open reading items');
SELECT pg_temp.land(39);
SELECT pg_temp.ok(pg_temp.items(39) = 1 AND pg_temp.posts(39) = 0, 'five open items of another stage and room for one first read: queued');
UPDATE image_stage_work SET status = 'done', finished_at = now() WHERE stage = 'deep_reading' AND status = 'queued';
-- one statement that lands five photos with room for three: three queued, two posted
SELECT pg_temp.cfg(jsonb_build_object('max_open', (SELECT count(*) + 3 FROM image_stage_work WHERE stage = 'classifier' AND status IN ('queued', 'claimed'))));
INSERT INTO public.vehicle_images (id, user_id, image_url, ai_processing_status)
SELECT pg_temp.img(40 + g), pg_temp.u1(), 'https://example.test/' || (40 + g) || '.heic', 'pending' FROM generate_series(1, 5) g;
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work w WHERE w.image_id IN (SELECT pg_temp.img(40 + g) FROM generate_series(1, 5) g) AND w.status = 'queued') = 3
  AND (SELECT count(*) FROM net.posts p WHERE p.body ->> 'image_id' IN (SELECT pg_temp.img(40 + g)::text FROM generate_series(1, 5) g)) = 2
  AND (SELECT count(*) FROM vehicle_images v WHERE v.id IN (SELECT pg_temp.img(40 + g) FROM generate_series(1, 5) g)) = 5,
  'five landings in one statement with room for three: three queued, two posted, each photo exactly one of the two');
SELECT pg_temp.cfg('{"max_open": 300}');

-- ===== 4. the function on its own: one open item, only for a gap
SELECT pg_temp.ok(enqueue_first_read(pg_temp.img(10)) = 0 AND pg_temp.items(10) = 1, 'a photo that holds an open item gets no second one');
SELECT pg_temp.ok(enqueue_first_read(NULL) = 0 AND enqueue_first_read(gen_random_uuid()) = 0, 'no photo, or an unknown one: nothing');
SELECT pg_temp.land(50, status => 'completed', meta => '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true}}');
SELECT pg_temp.ok(enqueue_first_read(pg_temp.img(50)) = 0 AND pg_temp.items(50) = 0, 'a photo that has its first read: no gap, nothing queued');
-- the stand-in the orchestrator writes after a refused provider read, as production holds it
SELECT pg_temp.land(51, status => 'failed', meta => '{"pipeline_version":"v2","classifier_failed":true,"classification":{"image_type":"other","confidence":0,"classifier_ok":false,"classifier_receipt":{"model":"openai:gpt-4.1-mini","error_class":"classifier_rate_limited"}},"photo_pipeline":{"receipt":{"outcome":"failed","classifier_model":"openai:gpt-4.1-mini"}}}');
SELECT pg_temp.ok(enqueue_first_read(pg_temp.img(51)) = 1, 'a photo that holds only the provider''s stand-in answer: queued');
SELECT pg_temp.ok((SELECT w.reason = g.reason AND w.target_version = g.target_version AND w.not_before <= now() FROM image_stage_work w
         JOIN image_stage_gaps(ARRAY[pg_temp.img(51)]) g ON g.image_id = w.image_id AND g.stage = w.stage WHERE w.image_id = pg_temp.img(51) AND w.status = 'queued'),
  'with the finder''s own reason and version, due now');
SELECT pg_temp.land(52, status => 'failed');
SELECT record_image_stage_receipt(pg_temp.img(52), 'classifier', 1, 'failed', 'reader_error');
SELECT pg_temp.ok(enqueue_first_read(pg_temp.img(52)) = 0, 'a photo nothing wrote to, whose first read a receipt closed: not a gap, nothing queued');
SELECT pg_temp.land(53, usr => pg_temp.u2(), status => 'failed');
SELECT pg_temp.ok(enqueue_first_read(pg_temp.img(53)) = 0, 'another user''s photo: nothing');

-- ===== 5. a failed provider read queues the first read at once
SELECT pg_temp.cfg('{"first_read_at_landing": false}');
SELECT pg_temp.land(60);
SELECT pg_temp.land(61, usr => pg_temp.u2());
SELECT pg_temp.land(62);
SELECT pg_temp.cfg('{"first_read_at_landing": true}');
SELECT pg_temp.ok(pg_temp.posts(60) = 1 AND pg_temp.items(60) = 0, 'a photo that took the provider path (posted, not queued)');
UPDATE photo_pipeline_provider_state SET consecutive_failures = 0, blocked_until = NULL WHERE provider = 'classifier';
-- the orchestrator's run holds the photo when it notes the failure
UPDATE public.vehicle_images SET ai_processing_status = 'processing', ai_processing_started_at = now() WHERE id IN (pg_temp.img(60), pg_temp.img(61), pg_temp.img(62));
SELECT photo_pipeline_note_failure(pg_temp.img(60), 'classifier_rate_limited', 429, NULL) AS nf \gset
SELECT pg_temp.ok(:'nf'::jsonb ->> 'status' = 'pending' AND :'nf'::jsonb -> 'transient' = 'true'::jsonb AND (:'nf'::jsonb ->> 'next_attempt_at')::timestamptz > now()
  AND :'nf'::jsonb ->> 'attempts' = '1' AND :'nf'::jsonb ->> 'rate_limited_attempts' = '1'
  AND (SELECT count(*) FROM jsonb_object_keys(:'nf'::jsonb)) = 5, 'note_failure answers as before (a rate limit: pending, with the next attempt)');
SELECT pg_temp.ok(pg_temp.items(60) = 1 AND (SELECT consecutive_failures = 1 AND blocked_until > now() FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'the failed read is queued for the reader at once, and the breaker opens as before');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 25, 300, pg_temp.u1()) c WHERE c.image_id = pg_temp.img(60)) = 0 AND pg_temp.items(60) = 1,
  'the reader leaves it queued while the failed run still holds the photo');
UPDATE public.vehicle_images SET ai_processing_status = 'pending' WHERE id = pg_temp.img(60);   -- what the orchestrator writes next
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 25, 300, pg_temp.u1()) c WHERE c.image_id = pg_temp.img(60)) = 1,
  'and takes it as soon as the run lets go');
SELECT pg_temp.ok(photo_pipeline_note_failure(pg_temp.img(60), 'classifier_rate_limited', 429, NULL) ->> 'rate_limited_attempts' = '2' AND pg_temp.items(60) = 1,
  'a second failure of the same photo adds no second item');
SELECT photo_pipeline_note_failure(pg_temp.img(61), 'classifier_rate_limited', 429, NULL);
SELECT pg_temp.ok(pg_temp.items(61) = 0, 'another user''s failed read: nothing queued');
SELECT pg_temp.ok(photo_pipeline_note_failure(pg_temp.img(62), 'image_http_error', 404, 'none') ->> 'status' = 'failed', 'a failure the provider path gives up on answers failed, as before');
SELECT pg_temp.ok(pg_temp.items(62) = 1 AND (SELECT terminal AND next_attempt_at IS NULL FROM photo_pipeline_retry_state WHERE image_id = pg_temp.img(62)),
  'and is queued for the reader too');
-- the same failures as in section 0, on another user's photos (nothing to queue): the answers are the ones the old body gave
SELECT pg_temp.land(64, usr => pg_temp.u2());
SELECT pg_temp.land(65, usr => pg_temp.u2());
SELECT pg_temp.land(66, usr => pg_temp.u2());
CREATE TEMP TABLE nf_after AS
SELECT 1 AS k, photo_pipeline_note_failure(pg_temp.img(64), 'classifier_rate_limited', 429, NULL) - 'next_attempt_at' AS answer
UNION ALL SELECT 2, photo_pipeline_note_failure(pg_temp.img(65), 'image_http_error', 404, NULL) - 'next_attempt_at'
UNION ALL SELECT 3, photo_pipeline_note_failure(pg_temp.img(66), 'image_http_error', 404, 'none') - 'next_attempt_at';
SELECT pg_temp.ok((SELECT count(*) FROM nf_before b JOIN nf_after a USING (k) WHERE a.answer = b.answer) = 3
  AND pg_temp.items(64) + pg_temp.items(65) + pg_temp.items(66) = 0,
  'note_failure gives the old body''s answers for the same failures (rate limit, not transient with and without a fallback class)');
SELECT pg_temp.cfg('{"first_read_at_landing": false}');
SELECT pg_temp.land(63);
UPDATE public.vehicle_images SET ai_processing_status = 'processing', ai_processing_started_at = now() WHERE id = pg_temp.img(63);
SELECT pg_temp.ok(photo_pipeline_note_failure(pg_temp.img(63), 'classifier_rate_limited', 429, NULL) ->> 'status' = 'pending' AND pg_temp.items(63) = 0,
  'switch off: a failed read is noted as before and nothing is queued');
SELECT pg_temp.cfg('{"first_read_at_landing": true}');

-- ===== 6. only a provider's reading closes the provider's breaker
SELECT pg_temp.breaker(7, interval '1 hour');
SELECT pg_temp.land(70, status => 'completed', meta => '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true,"classifier_receipt":{"model":"reader:claude-cli claude-sonnet-5-5 subscription"}},"photo_pipeline":{"receipt":{"outcome":"completed","classifier_model":"reader:claude-cli claude-sonnet-5-5 subscription"}}}');
INSERT INTO photo_pipeline_retry_state (image_id, attempts, next_attempt_at) VALUES (pg_temp.img(70), 2, now() + interval '5 minutes');
SELECT photo_pipeline_clear_retry(pg_temp.img(70));
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM photo_pipeline_retry_state WHERE image_id = pg_temp.img(70))
  AND (SELECT consecutive_failures = 7 AND blocked_until > now() + interval '50 minutes' AND note = 'rate limited' FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'a reader''s reading clears the photo''s retry row and leaves the provider''s breaker exactly as it was');
SELECT pg_temp.land(71, status => 'completed', meta => '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true,"classifier_receipt":{"model":"reader:some other reader"}}}');
SELECT photo_pipeline_clear_retry(pg_temp.img(71));
SELECT pg_temp.ok((SELECT consecutive_failures = 7 FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'the reader''s label on the classification alone is enough');
SELECT pg_temp.land(72, status => 'completed', meta => '{"classification":{"image_type":"exterior","confidence":0.9,"classifier_ok":true,"classifier_receipt":{"model":"openai:gpt-4.1-mini"}},"photo_pipeline":{"receipt":{"outcome":"completed","classifier_model":"openai:gpt-4.1-mini"}}}');
SELECT photo_pipeline_clear_retry(pg_temp.img(72));
SELECT pg_temp.ok((SELECT consecutive_failures = 0 AND blocked_until IS NULL AND note = 'healthy' FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'a provider''s reading closes the breaker, as before');
SELECT pg_temp.breaker(3, interval '10 minutes');
SELECT pg_temp.land(73, status => 'completed');
SELECT photo_pipeline_clear_retry(pg_temp.img(73));
SELECT pg_temp.ok((SELECT consecutive_failures = 0 AND blocked_until IS NULL FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'a photo with no receipt at all: the breaker closes, as before');
SELECT pg_temp.breaker(3, interval '10 minutes');
SELECT photo_pipeline_clear_retry(gen_random_uuid());
SELECT pg_temp.ok((SELECT consecutive_failures = 0 AND blocked_until IS NULL FROM photo_pipeline_provider_state WHERE provider = 'classifier'),
  'an unknown photo: the breaker closes, as before');

-- ===== 7. the drain leaves a queued photo to its reader while the item is leased or fresh
UPDATE public.vehicle_images SET ai_processing_status = 'skipped' WHERE ai_processing_status IN ('pending', 'processing', 'failed');
DELETE FROM photo_pipeline_retry_state;
UPDATE image_stage_work SET status = 'done', finished_at = now(), lease_until = NULL WHERE status IN ('queued', 'claimed');
SELECT pg_temp.land(80);                               -- queued at landing, fresh
SELECT pg_temp.land(81, usr => pg_temp.u2());          -- another user's: posted, no item
SELECT pg_temp.land(82);                               -- queued, past the hand-back time
UPDATE image_stage_work SET created_at = now() - interval '31 minutes' WHERE image_id = pg_temp.img(82) AND status = 'queued';
SELECT pg_temp.land(83);                               -- past the hand-back time, but a reader holds it now
UPDATE image_stage_work SET created_at = now() - interval '31 minutes', status = 'claimed', lease_until = now() + interval '4 minutes' WHERE image_id = pg_temp.img(83) AND status = 'queued';
SELECT pg_temp.land(84);                               -- past the hand-back time, and the reader's lease ran out
UPDATE image_stage_work SET created_at = now() - interval '31 minutes', status = 'claimed', lease_until = now() - interval '1 minute' WHERE image_id = pg_temp.img(84) AND status = 'queued';
SELECT pg_temp.land(89);                               -- a young item whose reader's lease ran out: still inside the hand-back time
UPDATE image_stage_work SET created_at = now() - interval '5 minutes', status = 'claimed', lease_until = now() - interval '1 minute' WHERE image_id = pg_temp.img(89) AND status = 'queued';
SELECT pg_temp.land(85);                               -- its item was finished
UPDATE image_stage_work SET status = 'done', finished_at = now() WHERE image_id = pg_temp.img(85) AND status = 'queued';
SELECT pg_temp.land(86);                               -- its item was dropped
UPDATE image_stage_work SET status = 'dropped', finished_at = now() WHERE image_id = pg_temp.img(86) AND status = 'queued';
CREATE TEMP TABLE drained AS SELECT id FROM claim_photo_pipeline_batch(25, 300);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM drained WHERE id = pg_temp.img(80)), 'drain: a photo with a fresh queued item is left to the reader');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM drained WHERE id = pg_temp.img(81)), 'drain: a photo with no item is claimed as before');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM drained WHERE id = pg_temp.img(82)), 'drain: an item past the hand-back time no longer holds the photo');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM drained WHERE id = pg_temp.img(83)), 'drain: a photo a reader holds a lease on is left alone, however old the item');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM drained WHERE id = pg_temp.img(84)), 'drain: an old item whose lease ran out no longer holds the photo');
SELECT pg_temp.ok((SELECT count(*) FROM drained WHERE id IN (pg_temp.img(85), pg_temp.img(86))) = 2, 'drain: a finished or dropped item holds nothing');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM drained WHERE id = pg_temp.img(89)), 'drain: a young item whose lease ran out still holds its photo until the hand-back time');
SELECT pg_temp.ok((SELECT count(*) FROM drained) = 5, 'drain: exactly those five');
-- the hand-back time is the config row's; 0 hands a queued photo back at once, a lease still holds
SELECT pg_temp.cfg('{"provider_fallback_after_minutes": 0}');
CREATE TEMP TABLE drained0 AS SELECT id FROM claim_photo_pipeline_batch(25, 300);
SELECT pg_temp.ok((SELECT count(*) FROM drained0) = 2 AND (SELECT count(*) FROM drained0 WHERE id IN (pg_temp.img(80), pg_temp.img(89))) = 2,
  'drain: hand-back time 0 gives a queued photo, and one whose lease ran out, to the provider path at once; the leased one stays the reader''s');
SELECT pg_temp.land(87);
SELECT pg_temp.cfg('{"provider_fallback_after_minutes": "soon"}');
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300)) = 0, 'drain: a hand-back time that is not a number is read as 30');
SELECT pg_temp.cfg('{"provider_fallback_after_minutes": -5}');
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300)) = 0, 'drain: a negative hand-back time is read as 30');
UPDATE platform_config SET config_value = config_value - 'provider_fallback_after_minutes' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300)) = 0, 'drain: an absent hand-back time is read as 30');
SELECT pg_temp.land(150);
UPDATE image_stage_work SET created_at = now() - interval '29 minutes' WHERE image_id = pg_temp.img(150) AND status = 'queued';
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300)) = 0, 'drain: with no hand-back time set, an item 29 minutes old still holds its photo');
UPDATE image_stage_work SET created_at = now() - interval '31 minutes' WHERE image_id = pg_temp.img(150) AND status = 'queued';
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300) WHERE id = pg_temp.img(150)) = 1, 'drain: and one 31 minutes old does not (the default is 30, not more)');
SELECT pg_temp.cfg('{"provider_fallback_after_minutes": 2.9}');
UPDATE image_stage_work SET created_at = now() - interval '150 seconds' WHERE image_id = pg_temp.img(87) AND status = 'queued';
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300) WHERE id = pg_temp.img(87)) = 1, 'drain: a fractional hand-back time is floored (2.9 -> 2 minutes)');
SELECT pg_temp.cfg('{"provider_fallback_after_minutes": 30}');
-- the breaker still stops every claim
SELECT pg_temp.land(88, usr => pg_temp.u2());
SELECT pg_temp.breaker(2, interval '5 minutes');
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300)) = 0, 'drain: nothing is claimed while the breaker is open, as before');
UPDATE photo_pipeline_provider_state SET consecutive_failures = 0, blocked_until = NULL WHERE provider = 'classifier';
SELECT pg_temp.ok((SELECT count(*) FROM claim_photo_pipeline_batch(25, 300) WHERE id = pg_temp.img(88)) = 1, 'drain: and claimed again once it closes');

-- ===== 8. nothing here can stop an upload
ALTER TABLE public.image_stage_work RENAME TO image_stage_work_away;
SELECT pg_temp.land(90);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM vehicle_images WHERE id = pg_temp.img(90)) AND pg_temp.posts(90) = 1,
  'a queue that cannot be written: the photo still lands and takes the provider path');
ALTER TABLE public.image_stage_work_away RENAME TO image_stage_work;
ALTER FUNCTION net.http_post(text, jsonb, jsonb, jsonb, integer) RENAME TO http_post_away;
SELECT pg_temp.land(91);
SELECT pg_temp.land(92, usr => pg_temp.u2());
SELECT pg_temp.ok(pg_temp.items(91) = 1 AND EXISTS (SELECT 1 FROM vehicle_images WHERE id = pg_temp.img(92)) AND pg_temp.items(92) = 0,
  'an outgoing call that fails: the reader''s photo is queued all the same, and the other still lands (the drain is its net, as before)');
ALTER FUNCTION net.http_post_away(text, jsonb, jsonb, jsonb, integer) RENAME TO http_post;
-- the phone uploads as the signed-in user, who cannot call the function but whose INSERT runs the trigger
GRANT INSERT ON public.vehicle_images TO authenticated;
SET ROLE authenticated;
INSERT INTO public.vehicle_images (id, user_id, image_url, ai_processing_status, source)
VALUES ('00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-0000000000a1', 'https://example.test/93.heic', 'pending', 'capture_relay_ios');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.items(93) = 1 AND pg_temp.posts(93) = 0, 'an upload made as the signed-in user is queued by the trigger');

-- ===== 9. a replay changes nothing and keeps an operator's values
SELECT pg_temp.cfg('{"first_read_at_landing": false, "provider_fallback_after_minutes": 5}');
SELECT md5(string_agg(md5(prosrc), ',' ORDER BY oid::regprocedure::text)) AS fns_before FROM pg_proc
 WHERE proname IN ('enqueue_first_read', 'trigger_photo_pipeline_orchestrator', 'photo_pipeline_note_failure', 'photo_pipeline_clear_retry', 'claim_photo_pipeline_batch') \gset
\ir ../migrations/20261120183500_first_read_queued_at_landing.sql
SELECT md5(string_agg(md5(prosrc), ',' ORDER BY oid::regprocedure::text)) AS fns_after FROM pg_proc
 WHERE proname IN ('enqueue_first_read', 'trigger_photo_pipeline_orchestrator', 'photo_pipeline_note_failure', 'photo_pipeline_clear_retry', 'claim_photo_pipeline_batch') \gset
SELECT pg_temp.ok(:'fns_before' = :'fns_after', 'replay: every function is byte for byte the same');
SELECT pg_temp.ok((SELECT config_value -> 'first_read_at_landing' = 'false'::jsonb AND config_value -> 'provider_fallback_after_minutes' = '5'::jsonb
                     FROM platform_config WHERE config_key = 'image_stage_reconciler'), 'replay: a switch someone turned off stays off, and their hand-back time stays');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.enqueue_first_read(uuid)', 'execute'), 'replay: grants as they were');

-- ===== 10. the revert: the four functions are the bodies production held, what was added is gone
\ir revert_20261120183500_first_read_queued_at_landing.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.trigger_photo_pipeline_orchestrator()') = '7f4ca0dd8c113e4ad3e0b598a309d9dd'
  AND pg_temp.md5_of('public.photo_pipeline_note_failure(uuid,text,integer,text)') = '67c780fd9014369409c30f632cd10756'
  AND pg_temp.md5_of('public.photo_pipeline_clear_retry(uuid)') = '224bf3fc0d48429dea2dbd802903342b'
  AND pg_temp.md5_of('public.claim_photo_pipeline_batch(integer,integer)') = 'fdc2cfcaa4afaa53c94f33b383224e22',
  'revert: the four replaced functions are the bodies production held');
SELECT pg_temp.ok(to_regprocedure('public.enqueue_first_read(uuid)') IS NULL
  AND (SELECT NOT (config_value ? 'first_read_at_landing') AND NOT (config_value ? 'provider_fallback_after_minutes') AND config_value ->> 'max_open' = '300'
         FROM platform_config WHERE config_key = 'image_stage_reconciler'), 'revert: the function and the two config keys are gone, the rest of the row stays');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.photo_pipeline_note_failure(uuid,text,integer,text)', 'execute')
  AND has_function_privilege('service_role', 'public.claim_photo_pipeline_batch(integer,integer)', 'execute'), 'revert: grants as they were');
SELECT pg_temp.land(100);
SELECT pg_temp.ok(pg_temp.items(100) = 0 AND pg_temp.posts(100) = 1, 'revert: a landing is posted again and nothing is queued');
SELECT pg_temp.ok(pg_temp.items(93) = 1, 'revert: items already queued stay for the reader');
-- and the migration applies again over the revert, with the switch on
\ir ../migrations/20261120183500_first_read_queued_at_landing.sql
SELECT pg_temp.land(101);
SELECT pg_temp.ok(pg_temp.items(101) = 1 AND pg_temp.posts(101) = 0, 'applied again after a revert: a landing is queued');

-- ===== 11. the revert refuses to discard a body someone changed after this migration
CREATE TEMP TABLE kept_claim AS SELECT pg_get_functiondef('public.claim_photo_pipeline_batch(integer,integer)'::regprocedure) AS def;
DO $do$ BEGIN EXECUTE pg_temp.drifted('public.claim_photo_pipeline_batch(integer,integer)'); END $do$;
SELECT pg_temp.state() AS s_r \gset
\set ON_ERROR_STOP off
\ir revert_20261120183500_first_read_queued_at_landing.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok(pg_temp.state() = :'s_r' AND to_regprocedure('public.enqueue_first_read(uuid)') IS NOT NULL,
  'revert refused: a body changed after the migration is not put back to 2026-11-20, and nothing else changed');
DO $do$ BEGIN EXECUTE (SELECT def FROM kept_claim); END $do$;
SELECT pg_temp.ok(pg_temp.md5_of('public.claim_photo_pipeline_batch(integer,integer)') = '0c3285789eed70d1a52315d719262df6', 'fixture: the migration''s body again');
\echo 'first read queued at landing contract passed'
