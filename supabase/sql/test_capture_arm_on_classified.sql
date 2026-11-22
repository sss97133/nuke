-- Contract: 20261122030000_capture_arm_on_classified. A day is scored after its photos are classified, not at upload;
-- classifier-"other" photos that a second reader also finds no vehicle in get a terminal non_vehicle verdict; days
-- planned before their photos were classified are re-queued by a producer; the status page shows metadata-only and
-- duplicate rows as finished and keeps a classified photo classified; the phone's duplicate re-sends close at insert.
-- Disposable PG17 only, synthetic rows only. The five replaced functions are installed as production's bodies by the
-- revert file (md5 checked against production's prosrc of 2026-11-21); capture_sets_enqueue,
-- capture_set_photo_admits, capture_upload_status_fn and capture_non_vehicle_review_revert_v1 are production's bodies;
-- capture_day_replan_state and capture_sets_landing_run are stubs that read a fixture table and record their calls.
-- Also checked: a replay is a no-op, a moved body is refused and not replaced, the revert restores the earlier bodies
-- and drops what the migration added, and a re-apply works.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== fixture tables: the columns the replaced and new functions read
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  taken_at timestamptz, created_at timestamptz DEFAULT now(), source text, vision_gate_status public.vision_gate_status DEFAULT 'pending',
  image_url text, file_name text, filename text, storage_path text, exif_data jsonb, file_hash text,
  is_duplicate boolean DEFAULT false, duplicate_of uuid, is_superseded boolean DEFAULT false, is_sensitive boolean DEFAULT false,
  is_document boolean, image_type text, ai_processing_status text DEFAULT 'pending', ai_processing_started_at timestamptz,
  ai_processing_completed_at timestamptz, ai_scan_metadata jsonb, ai_avg_confidence numeric, ai_detected_angle text,
  ai_detected_angle_confidence real, apple_ml_labels text[], vehicle_score real);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid NOT NULL, vehicle_id uuid,
  attached boolean NOT NULL DEFAULT false, filename text, storage_path text,
  stage text NOT NULL CHECK (stage IN ('uploaded','classifying','classified','failed','attached')),
  stage_detail jsonb NOT NULL DEFAULT '{}', error_class text, http_status integer, image_type text, confidence numeric,
  current_step text NOT NULL DEFAULT 'queued' CHECK (current_step IN ('queued','downloading','classifying','reading_text','extracting_fields','matching_vehicle','done','failed')),
  step_detail jsonb NOT NULL DEFAULT '{}', step_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.capture_analysis_events(id bigserial PRIMARY KEY, image_id uuid NOT NULL, user_id uuid NOT NULL,
  step text NOT NULL, detail jsonb NOT NULL, reported_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.capture_set_rescore_queue(user_id uuid NOT NULL, day date NOT NULL, requested_at timestamptz NOT NULL,
  not_before date NOT NULL, reasons jsonb NOT NULL, done_run_id uuid, done_at timestamptz, PRIMARY KEY (user_id, day));
CREATE TABLE public.capture_sets_arm_cursor(id boolean PRIMARY KEY DEFAULT true CHECK (id), last_scan timestamptz NOT NULL);
CREATE TABLE public.capture_landing_config(id integer PRIMARY KEY, user_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true,
  halted boolean NOT NULL DEFAULT false, min_score numeric NOT NULL DEFAULT 2.5, min_margin numeric NOT NULL DEFAULT 1);
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text, run_id uuid,
  t_from timestamptz, t_to timestamptz, dry boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], reason text, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_non_vehicle_log(run_id uuid NOT NULL, image_id uuid NOT NULL, user_id uuid NOT NULL,
  granted_by uuid NOT NULL, typ text, verdict text NOT NULL, reason text NOT NULL, day date, signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz, PRIMARY KEY (run_id, image_id));
CREATE TABLE public.capture_privacy_promote_exclude(image_id uuid PRIMARY KEY, reason text, granted_by uuid, added_at timestamptz DEFAULT now());
CREATE TABLE public.image_text_reads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, user_id uuid,
  vin_candidates jsonb, revoked_at timestamptz);
-- stubs: the re-plan state comes from t_replan; landing runs are recorded in t_runs
CREATE TABLE public.t_replan(user_id uuid, day date, state jsonb);
CREATE TABLE public.t_runs(user_id uuid, t_from timestamptz, run_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT state FROM t_replan WHERE user_id = p_user AND day = p_day), '{"blocked": false, "reason": "never_planned"}') $$;
CREATE FUNCTION public.capture_sets_landing_run(p_user uuid, p_from timestamptz, p_to timestamptz, p_run uuid, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO t_runs (user_id, t_from, run_id) VALUES (p_user, p_from, p_run);
  SELECT jsonb_build_object('sets_scored', 0, 'review_sets', 0) $$;
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['capture_relay_ios'] $$;
CREATE FUNCTION public.vehicle_image_holds_wrong_bytes(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- ===== production bodies the replaced functions call
CREATE OR REPLACE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT x FROM jsonb_array_elements(q.reasons || jsonb_build_array(p_reason)) x
                   OFFSET greatest(0, jsonb_array_length(q.reasons) + 1 - 20)) t)
$f$;

CREATE OR REPLACE FUNCTION public.capture_non_vehicle_review_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_non_vehicle_review_revert_v1: user and run required';
  END IF;
  UPDATE public.capture_non_vehicle_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Privacy promotions made under the same run id, if any, have their own revert.
  RETURN jsonb_build_object('run_id', p_run, 'reverted', n);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder', 'image_intake']) OR p_source LIKE 'direct\_pull_%' ESCAPE '\')
          AND (coalesce(p_exif ? 'DateTimeOriginal', false)
               OR coalesce((p_exif->>'import_session_admit')::boolean, false)))
$function$;

CREATE OR REPLACE FUNCTION public.capture_upload_status_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.capture_upload_status_upsert(NEW, case when TG_OP = 'UPDATE' then OLD.ai_processing_status else null end, TG_OP);
  exception when others then
    raise warning 'capture_upload_status_fn failed for %: %', NEW.id, sqlerrm;
  end;
  return null;
end;
$function$;

-- triggers as production has them on vehicle_images
CREATE TRIGGER z_trg_capture_upload_status_ins AFTER INSERT ON public.vehicle_images FOR EACH ROW
  WHEN (new.source = 'capture_relay_ios') EXECUTE FUNCTION capture_upload_status_fn();
CREATE TRIGGER z_trg_capture_upload_status_upd AFTER UPDATE OF ai_processing_status, vehicle_id, image_type, ai_scan_metadata,
  ai_processing_started_at, ai_processing_completed_at, ai_avg_confidence, ai_detected_angle, file_name ON public.vehicle_images
  FOR EACH ROW WHEN (new.source = 'capture_relay_ios') EXECUTE FUNCTION capture_upload_status_fn();
INSERT INTO capture_sets_arm_cursor VALUES (true, now() - interval '1 minute');

\set u '''00000000-0000-4000-8000-000000000001'''
\set g '''00000000-0000-4000-8000-000000000002'''
\set u2 '''00000000-0000-4000-8000-000000000003'''

-- ===== production's earlier bodies (installed by the revert, which creates what is absent)
\ir revert_20261122030000_capture_arm_on_classified.sql
CREATE TRIGGER trg_flag_duplicate_image BEFORE INSERT ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION flag_duplicate_image();
SELECT t_assert((SELECT string_agg(md5(prosrc), ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
  ('flag_duplicate_image','capture_upload_status_upsert','report_capture_step','capture_sets_arm_new_photos','capture_sets_drain'))
  = 'e5f1d11216b96d78a8bcdf36bf75969e,196499501328ced3d6c99fbfadd83a1f,66e22e6a6acec64344dc453f8202c642,42a2a884f0dc65a8354ec3eb7f1761e3,3923d10f373562209d57b68b203edc76',
  'fixture: the five functions are production''s bodies of 2026-11-21');
REVOKE ALL ON FUNCTION public.capture_sets_drain(integer), public.capture_sets_arm_new_photos(),
  public.capture_upload_status_upsert(vehicle_images, text, text), public.report_capture_step(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_sets_drain(integer), public.capture_sets_arm_new_photos(),
  public.capture_upload_status_upsert(vehicle_images, text, text), public.report_capture_step(uuid, text, jsonb) TO service_role;

-- before: the defects this migration removes
INSERT INTO vehicle_images (id, user_id, source, image_url, file_hash, taken_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', :u, 'capture_relay_ios', 'https://x/1.jpg', 'h1', '2026-11-15 18:00Z'),
  ('a0000000-0000-4000-8000-000000000002', :u, 'capture_relay_ios', 'https://x/1b.jpg', 'h1', '2026-11-15 18:00Z'),
  ('a0000000-0000-4000-8000-000000000003', :u, 'capture_relay_ios', '', NULL, '2026-11-15 18:01Z');
UPDATE vehicle_images SET ai_processing_status = 'skipped' WHERE id = 'a0000000-0000-4000-8000-000000000003';
SELECT t_assert((SELECT ai_processing_status FROM vehicle_images WHERE id = 'a0000000-0000-4000-8000-000000000002') = 'pending',
  'before: a duplicate re-send stays pending');
SELECT t_assert((SELECT string_agg(current_step, ',' ORDER BY image_id) FROM capture_upload_status
  WHERE image_id IN ('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003')) = 'queued,queued',
  'before: duplicate and metadata-only rows show queued');
DELETE FROM capture_analysis_events; DELETE FROM capture_upload_status; DELETE FROM vehicle_images;

-- ===== apply
\ir ../migrations/20261122030000_capture_arm_on_classified.sql
SELECT t_assert((SELECT string_agg(md5(prosrc), ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
  ('flag_duplicate_image','capture_upload_status_upsert','report_capture_step','capture_sets_arm_new_photos','capture_sets_drain'))
  = '333c837b7be332340e163a37027ffdd6,e7780a1c38b3373e83a5f42c011ea3a7,f0102125210bb45a793631ed254c4bdf,bca6ff27c1f32655bf4b3e48dea2ab7d,47969c0897f6056561821c73db299c82',
  'apply: the five bodies are the migration''s');
SELECT t_assert(NOT has_function_privilege('authenticated', 'public.capture_non_vehicle_auto_v1(uuid,uuid,uuid,boolean,integer,date,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.capture_non_vehicle_auto_v1(uuid,uuid,uuid,boolean,integer,date,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_sets_rearm_read_after_scoring_v1(uuid,uuid,boolean,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.capture_sets_drain(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_sets_drain(integer)', 'EXECUTE'),
  'apply: new producers are service_role only; replaced functions keep their grants');
SELECT t_assert((SELECT auto_non_vehicle_granted_by IS NULL FROM (SELECT NULL::uuid AS auto_non_vehicle_granted_by) x)
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'capture_landing_config' AND column_name = 'auto_non_vehicle_granted_by'),
  'apply: capture_landing_config.auto_non_vehicle_granted_by exists (null = off)');

-- ===== 1. duplicate re-sends close at insert; status page
INSERT INTO vehicle_images (id, user_id, source, image_url, file_hash, taken_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', :u, 'capture_relay_ios', 'https://x/1.jpg', 'h1', '2026-11-15 18:00Z');
INSERT INTO vehicle_images (id, user_id, source, image_url, file_hash, taken_at) VALUES
  ('a0000000-0000-4000-8000-000000000002', :u, 'capture_relay_ios', 'https://x/1b.jpg', 'h1', '2026-11-15 18:00Z'),
  ('a0000000-0000-4000-8000-000000000004', :u, 'user_upload', 'https://x/1c.jpg', 'h1', '2026-11-15 18:00Z'),
  ('a0000000-0000-4000-8000-000000000003', :u, 'capture_relay_ios', '', NULL, '2026-11-15 18:01Z');
UPDATE vehicle_images SET ai_processing_status = 'skipped' WHERE id = 'a0000000-0000-4000-8000-000000000003';
SELECT t_assert((SELECT is_duplicate AND ai_processing_status = 'skipped' AND ai_scan_metadata ->> 'skipped' = 'duplicate_at_insert'
                 AND (ai_scan_metadata ->> 'duplicate_of')::uuid = 'a0000000-0000-4000-8000-000000000001'
                 FROM vehicle_images WHERE id = 'a0000000-0000-4000-8000-000000000002'), '1: a phone duplicate re-send is skipped at insert, tagged');
SELECT t_assert((SELECT is_duplicate AND ai_processing_status = 'pending' FROM vehicle_images WHERE id = 'a0000000-0000-4000-8000-000000000004'),
  '1: a duplicate from another source is unchanged');
SELECT t_assert((SELECT current_step = 'done' AND step_detail ->> 'terminal' = 'duplicate' AND stage = 'uploaded'
                 FROM capture_upload_status WHERE image_id = 'a0000000-0000-4000-8000-000000000002'), '1: status shows the duplicate finished');
SELECT t_assert((SELECT current_step = 'done' AND step_detail ->> 'terminal' = 'metadata_only'
                 FROM capture_upload_status WHERE image_id = 'a0000000-0000-4000-8000-000000000003'), '1: status shows the metadata-only row finished');
SELECT t_assert((SELECT current_step FROM capture_upload_status WHERE image_id = 'a0000000-0000-4000-8000-000000000001') = 'queued',
  '1: a real upload waiting for the classifier still shows queued');

-- ===== 2. a classified photo stays classified when a later step fails
UPDATE vehicle_images SET ai_processing_status = 'completed', ai_processing_completed_at = clock_timestamp(),
  ai_scan_metadata = '{"classification": {"image_type": "vehicle_exterior"}}' WHERE id = 'a0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT stage = 'classified' AND current_step = 'done' FROM capture_upload_status WHERE image_id = 'a0000000-0000-4000-8000-000000000001'),
  '2: classified photo shows done');
SELECT t_assert((SELECT (r ->> 'kept') = 'post_classification_error' AND (r ->> 'step') = 'done'
                 FROM report_capture_step('a0000000-0000-4000-8000-000000000001', 'failed', '{"error_class": "classifier_rate_limited"}') r),
  '2: report_capture_step(failed) after classification keeps the step');
SELECT t_assert((SELECT current_step = 'done' AND step_detail #>> '{post_classification_error,error_class}' = 'classifier_rate_limited'
                 FROM capture_upload_status WHERE image_id = 'a0000000-0000-4000-8000-000000000001'), '2: the error is kept as post_classification_error');
SELECT t_assert((SELECT count(*) FROM capture_analysis_events WHERE image_id = 'a0000000-0000-4000-8000-000000000001' AND step = 'failed'
                 AND detail ->> 'kept_step' = 'done') = 1, '2: the failure is still recorded as an event');
SELECT t_assert((SELECT (r ->> 'step') = 'failed' FROM report_capture_step('a0000000-0000-4000-8000-000000000003', 'failed', '{}') r),
  '2: a failure before classification is still recorded as failed');
-- a status row left failed by the earlier body is re-derived by the resync producer
UPDATE capture_upload_status SET current_step = 'failed' WHERE image_id = 'a0000000-0000-4000-8000-000000000001';
UPDATE capture_upload_status SET current_step = 'queued', step_detail = '{}' WHERE image_id = 'a0000000-0000-4000-8000-000000000003';
CREATE TEMP TABLE t_r2 AS SELECT capture_upload_status_resync_v1(:u, now() - interval '1 day') AS r;
SELECT t_assert((SELECT (r ->> 'rows')::int = 2 AND (r -> 'changed') = '{}'::jsonb FROM t_r2)
  AND (SELECT current_step FROM capture_upload_status WHERE image_id = 'a0000000-0000-4000-8000-000000000001') = 'failed',
  '2: resync dry run counts and writes nothing');
SELECT t_assert((SELECT r -> 'changed' = '{"failed->done": 1, "queued->done": 1}'::jsonb FROM capture_upload_status_resync_v1(:u, now() - interval '1 day', false) r),
  '2: resync moves the failed and queued rows to done');
DELETE FROM capture_analysis_events; DELETE FROM capture_upload_status; DELETE FROM vehicle_images;

-- ===== 3. arm on classification; the drain waits while a photo of the day is still being read
UPDATE capture_sets_arm_cursor SET last_scan = clock_timestamp();
INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', :u, 'capture_relay_ios', 'https://x/b1.jpg', '2026-11-10 18:00Z');
SELECT capture_sets_drain(3);
SELECT t_assert((SELECT reasons = '[{"arrival": 1}]' AND done_at IS NULL FROM capture_set_rescore_queue WHERE user_id = :u AND day = '2026-11-10'),
  '3: arrival arms the day');
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '20 minutes' WHERE user_id = :u AND day = '2026-11-10';
SELECT t_assert((SELECT r -> 'runs' -> 0 ->> 'deferred' = 'awaiting_classification' AND (r -> 'runs' -> 0 ->> 'pending')::int = 1
                 FROM capture_sets_drain(3) r), '3: the drain defers the day while its photo is unread');
SELECT t_assert((SELECT count(*) FROM t_runs) = 0 AND (SELECT requested_at > now() - interval '1 minute' AND done_at IS NULL
                 FROM capture_set_rescore_queue WHERE user_id = :u AND day = '2026-11-10'), '3: nothing was planned; the day stays queued');
UPDATE vehicle_images SET ai_processing_status = 'completed', ai_processing_completed_at = clock_timestamp(),
  ai_scan_metadata = '{"classification": {"image_type": "vehicle_exterior"}}' WHERE id = 'b0000000-0000-4000-8000-000000000001';
SELECT capture_sets_drain(3);
SELECT t_assert((SELECT reasons -> -1 = '{"classified": 1}' FROM capture_set_rescore_queue WHERE user_id = :u AND day = '2026-11-10'),
  '3: classification re-arms the day (reason classified)');
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '20 minutes' WHERE user_id = :u AND day = '2026-11-10';
SELECT capture_sets_drain(3);
SELECT t_assert((SELECT count(*) FROM t_runs WHERE t_from = '2026-11-10'::timestamp AT TIME ZONE 'America/Los_Angeles') = 1
  AND (SELECT done_run_id = (SELECT run_id FROM t_runs) FROM capture_set_rescore_queue WHERE user_id = :u AND day = '2026-11-10'),
  '3: after classification the day is planned once');
-- a photo uploaded more than 6 hours ago no longer holds its day
INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000002', :u, 'capture_relay_ios', 'https://x/b2.jpg', '2026-11-11 18:00Z', now() - interval '7 hours');
SELECT capture_sets_enqueue(:u, '2026-11-11', '{"arrival": 1}');
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '20 minutes' WHERE user_id = :u AND day = '2026-11-11';
SELECT capture_sets_drain(3);
SELECT t_assert((SELECT count(*) FROM t_runs WHERE t_from = '2026-11-11'::timestamp AT TIME ZONE 'America/Los_Angeles') = 1,
  '3: a photo stuck unread for 6 hours does not hold the day');
-- re-plan rules: classified re-plans a refused day, never a pending plan; other reasons stay blocked
INSERT INTO t_replan VALUES (:u, '2026-11-12', '{"blocked": true, "reason": "refused_no_new_evidence"}'),
  (:u, '2026-11-13', '{"blocked": true, "reason": "plan_pending"}'), (:u, '2026-11-14', '{"blocked": true, "reason": "refused_no_new_evidence"}');
SELECT capture_sets_enqueue(:u, '2026-11-12', '{"classified": 2}');
SELECT capture_sets_enqueue(:u, '2026-11-13', '{"classified": 2}');
SELECT capture_sets_enqueue(:u, '2026-11-14', '{"new_anchors": 1}');
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '20 minutes' WHERE user_id = :u AND day BETWEEN '2026-11-12' AND '2026-11-14';
SELECT capture_sets_drain(5);
SELECT t_assert((SELECT string_agg(day::text || '=' || coalesce(CASE WHEN done_run_id IS NOT NULL THEN 'planned' END, reasons -> -1 ->> 'skipped'), ',' ORDER BY day)
                 FROM capture_set_rescore_queue WHERE user_id = :u AND day BETWEEN '2026-11-12' AND '2026-11-14')
  = '2026-11-12=planned,2026-11-13=plan_pending,2026-11-14=refused_no_new_evidence',
  '3: classified re-plans a refused day only; a pending plan and other reasons stay blocked');
DELETE FROM t_runs; DELETE FROM t_replan; DELETE FROM capture_set_rescore_queue; DELETE FROM capture_analysis_events; DELETE FROM capture_upload_status; DELETE FROM vehicle_images;

-- ===== 4. terminal non_vehicle for classifier-"other" photos, learned per owner
-- decided photos: 220 approved on a vehicle (labels wheel, tire, outdoor), 60 private (labels document, outdoor)
INSERT INTO vehicle_images (user_id, vehicle_id, source, image_url, taken_at, vision_gate_status, apple_ml_labels)
SELECT :u, gen_random_uuid(), 'capture_relay_ios', 'https://x/p.jpg', '2026-10-01', 'approved', ARRAY['wheel','Tire','outdoor'] FROM generate_series(1, 220);
INSERT INTO vehicle_images (user_id, source, image_url, taken_at, vision_gate_status, apple_ml_labels)
SELECT :u, 'capture_relay_ios', 'https://x/n.jpg', '2026-10-01', 'rejected_personal', ARRAY['document','outdoor'] FROM generate_series(1, 60);
SELECT t_assert(capture_vehicle_label_profile(:u) = ARRAY['tire','wheel'], '4: the profile is learned from the owner''s decided photos');
SELECT t_assert(capture_vehicle_label_profile(:u2) IS NULL, '4: an owner with too few decided photos has no profile');
-- candidates (all typ other, classified, unfiled, 2026-11-16 Los Angeles)
INSERT INTO vehicle_images (id, user_id, source, image_url, taken_at, ai_processing_status, ai_scan_metadata, apple_ml_labels, is_sensitive, vehicle_score)
SELECT ('c0000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, :u, 'capture_relay_ios',
       CASE WHEN i = 3 THEN '' ELSE 'https://x/c.jpg' END, '2026-11-16 18:00Z'::timestamptz + i * interval '1 minute', 'completed',
       '{"classification": {"image_type": "other"}}', CASE WHEN i = 2 THEN ARRAY['paper','Wheel'] WHEN i = 9 THEN NULL ELSE ARRAY['document','paper'] END,
       i = 4, CASE WHEN i = 10 THEN 0.4 END
FROM generate_series(1, 11) i;
-- 1 eligible; 2 vehicle label; 3 no stored picture; 4 sensitive; 5 VIN read; 6 held; 7 privacy-excluded; 8 already decided;
-- 9 no labels; 10 vehicle score; 11 eligible
INSERT INTO image_text_reads (image_id, user_id, vin_candidates) VALUES ('c0000000-0000-4000-8000-000000000005', :u, '["1GCGC34N0KE000000"]');
INSERT INTO capture_set_review (user_id, image_ids) VALUES (:u, ARRAY['c0000000-0000-4000-8000-000000000006'::uuid]);
INSERT INTO capture_privacy_promote_exclude (image_id, reason) VALUES ('c0000000-0000-4000-8000-000000000007', 'fixture');
INSERT INTO capture_non_vehicle_log (run_id, image_id, user_id, granted_by, verdict, reason, signature)
  VALUES (gen_random_uuid(), 'c0000000-0000-4000-8000-000000000008', :u, :g, 'judgment_personal', 'fixture', 'fixture');
SELECT t_assert((SELECT r ->> 'image_ids' = '["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000011"]' AND (r ->> 'taken')::int = 0
                 FROM capture_non_vehicle_auto_v1(:u, gen_random_uuid(), :g) r)
  AND (SELECT count(*) FROM capture_non_vehicle_log) = 1, '4: dry run names the two eligible photos and writes nothing');
SELECT t_assert((SELECT (r ->> 'eligible')::int = 3 FROM capture_non_vehicle_auto_v1(:u, gen_random_uuid(), :g, true, 50, NULL, true) r),
  '4: include_held adds the photo on an open review');
DO $$ BEGIN
  PERFORM capture_non_vehicle_auto_v1('00000000-0000-4000-8000-000000000001', gen_random_uuid(), NULL, false);
  RAISE EXCEPTION 'no refusal';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%granted_by required%' THEN RAISE; END IF;
END $$;
SELECT t_assert(true, '4: a live run without granted_by is refused');
CREATE TEMP TABLE t_r4 AS SELECT capture_non_vehicle_auto_v1(:u, 'd0000000-0000-4000-8000-000000000001', :g, false) AS r;
SELECT t_assert((SELECT (r ->> 'taken')::int = 2 FROM t_r4)
  AND (SELECT count(*) FROM capture_non_vehicle_log WHERE run_id = 'd0000000-0000-4000-8000-000000000001' AND verdict = 'non_vehicle'
       AND granted_by = :g AND signature = 'capture_non_vehicle_auto_v1/d0000000-0000-4000-8000-000000000001' AND day = '2026-11-16') = 2,
  '4: a live run writes two signed non_vehicle verdicts');
SELECT t_assert((SELECT count(*) FROM vehicle_images WHERE id::text LIKE 'c0000000-%' AND vehicle_id IS NULL AND vision_gate_status = 'pending'
                 AND ai_processing_status = 'completed' AND ai_scan_metadata = '{"classification": {"image_type": "other"}}') = 11,
  '4: the photo rows are not touched');
SELECT t_assert((SELECT (r ->> 'taken')::int = 0 FROM capture_non_vehicle_auto_v1(:u, gen_random_uuid(), :g, false) r), '4: a second run takes nothing');
SELECT t_assert(capture_vehicle_label_profile(:u) = ARRAY['tire','wheel'], '4: automatic verdicts do not feed the profile');
SELECT t_assert((SELECT (r ->> 'reverted')::int = 2 FROM capture_non_vehicle_review_revert_v1(:u, 'd0000000-0000-4000-8000-000000000001') r),
  '4: revert by run');
-- the drain runs it for the drained day when the owner's config names a grantor
INSERT INTO capture_landing_config (id, user_id) VALUES (1, :u);
UPDATE capture_sets_arm_cursor SET last_scan = clock_timestamp();
SELECT capture_sets_enqueue(:u, '2026-11-16', '{"arrival": 1}');
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '20 minutes';
SELECT capture_sets_drain(1);
SELECT t_assert((SELECT count(*) FROM capture_non_vehicle_log WHERE reverted_at IS NULL AND verdict = 'non_vehicle') = 0,
  '4: off while auto_non_vehicle_granted_by is null');
UPDATE capture_landing_config SET auto_non_vehicle_granted_by = :g;
SELECT capture_sets_enqueue(:u, '2026-11-16', '{"arrival": 1}');
UPDATE capture_set_rescore_queue SET requested_at = now() - interval '20 minutes';
CREATE TEMP TABLE t_r4d AS SELECT capture_sets_drain(1) AS r;
SELECT t_assert((SELECT (r -> 'runs' -> 0 ->> 'non_vehicle')::int = 2 FROM t_r4d)
  AND (SELECT count(*) FROM capture_non_vehicle_log l JOIN capture_set_rescore_queue q ON q.done_run_id = l.run_id WHERE l.reverted_at IS NULL) = 2,
  '4: the drain writes the day''s verdicts under the day''s run id');
DELETE FROM capture_landing_config; DELETE FROM capture_non_vehicle_log; DELETE FROM capture_set_review; DELETE FROM capture_set_rescore_queue;
DELETE FROM image_text_reads; DELETE FROM capture_privacy_promote_exclude; DELETE FROM t_runs;
DELETE FROM capture_analysis_events; DELETE FROM capture_upload_status; DELETE FROM vehicle_images;

-- ===== 5. re-queue days planned before their photos were classified
-- day E: planned, photo classified later -> re-queued; F: classified before the plan -> no; G: plan awaiting the gate -> no;
-- H: already waiting in the queue -> no; I: never planned -> re-queued; J: typ other -> no
INSERT INTO capture_landing_chunks (user_id, state, t_from, t_to, created_at)
SELECT :u, s, d::timestamp AT TIME ZONE 'America/Los_Angeles', (d + 1)::timestamp AT TIME ZONE 'America/Los_Angeles', now() - interval '2 days'
FROM (VALUES ('2026-09-01'::date, 'applied'), ('2026-09-02', 'applied'), ('2026-09-03', 'awaiting_gate'), ('2026-09-04', 'applied'), ('2026-09-06', 'applied')) v(d, s);
INSERT INTO vehicle_images (user_id, source, image_url, taken_at, ai_processing_status, ai_processing_completed_at, ai_scan_metadata)
SELECT :u, 'capture_relay_ios', 'https://x/e.jpg', (d::timestamp + interval '10 hours') AT TIME ZONE 'America/Los_Angeles', 'completed',
       now() - c * interval '1 day', jsonb_build_object('classification', jsonb_build_object('image_type', t))
FROM (VALUES ('2026-09-01'::date, 1, 'vehicle_exterior'), ('2026-09-02', 3, 'vehicle_exterior'), ('2026-09-03', 1, 'vehicle_exterior'),
             ('2026-09-04', 1, 'vehicle_exterior'), ('2026-09-05', 1, 'engine_bay'), ('2026-09-06', 1, 'other')) v(d, c, t);
SELECT capture_sets_enqueue(:u, '2026-09-04', '{"arrival": 1}');
SELECT t_assert((SELECT r -> 'days' = '[{"day": "2026-09-01", "photos": 1}, {"day": "2026-09-05", "photos": 1}]' AND (r ->> 'enqueued')::int = 0
                 FROM capture_sets_rearm_read_after_scoring_v1(:u, gen_random_uuid()) r)
  AND (SELECT count(*) FROM capture_set_rescore_queue) = 1, '5: dry run names the two days and enqueues nothing');
CREATE TEMP TABLE t_r5 AS SELECT capture_sets_rearm_read_after_scoring_v1(:u, 'e0000000-0000-4000-8000-000000000001', false) AS r;
SELECT t_assert((SELECT (r ->> 'enqueued')::int = 2 FROM t_r5)
  AND (SELECT string_agg(day::text, ',' ORDER BY day) FROM capture_set_rescore_queue
       WHERE reasons -> -1 ->> 'read_after_scoring' = 'e0000000-0000-4000-8000-000000000001' AND done_at IS NULL) = '2026-09-01,2026-09-05',
  '5: a live run enqueues them with reason read_after_scoring');
SELECT t_assert((SELECT jsonb_array_length(r -> 'days') = 0 FROM capture_sets_rearm_read_after_scoring_v1(:u, gen_random_uuid()) r),
  '5: a second run finds nothing (the days are queued)');
CREATE TEMP TABLE t_r5r AS SELECT capture_sets_rearm_read_after_scoring_revert_v1(:u, 'e0000000-0000-4000-8000-000000000001') AS r;
SELECT t_assert((SELECT (r ->> 'reverted')::int = 2 FROM t_r5r)
  AND (SELECT count(*) FROM capture_set_rescore_queue WHERE done_at IS NULL) = 1, '5: revert closes the run''s queued days only');

-- ===== replay, refusal, revert, re-apply
\ir ../migrations/20261122030000_capture_arm_on_classified.sql
SELECT t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.capture_sets_drain(integer)'::regprocedure) = 'e7780a1c38b3373e83a5f42c011ea3a7',
  'replay: a no-op');
CREATE TEMP TABLE t_saved AS SELECT pg_get_functiondef('public.capture_sets_arm_new_photos()'::regprocedure) AS d;
CREATE OR REPLACE FUNCTION public.capture_sets_arm_new_photos() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$ BEGIN RETURN 0; END $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261122030000_capture_arm_on_classified.sql
ROLLBACK;
\ir revert_20261122030000_capture_arm_on_classified.sql
ROLLBACK;
\set ON_ERROR_STOP on
SELECT t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.capture_sets_arm_new_photos()'::regprocedure) = md5(' BEGIN RETURN 0; END ')
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.capture_sets_drain(integer)'::regprocedure) = 'e7780a1c38b3373e83a5f42c011ea3a7'
  AND to_regprocedure('public.capture_non_vehicle_auto_v1(uuid,uuid,uuid,boolean,integer,date,boolean)') IS NOT NULL,
  'refusal: a moved body is not replaced, and neither file changes anything');
DO $$ BEGIN EXECUTE (SELECT d FROM t_saved); END $$;
\ir revert_20261122030000_capture_arm_on_classified.sql
SELECT t_assert((SELECT string_agg(md5(prosrc), ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
  ('flag_duplicate_image','capture_upload_status_upsert','report_capture_step','capture_sets_arm_new_photos','capture_sets_drain'))
  = 'e5f1d11216b96d78a8bcdf36bf75969e,196499501328ced3d6c99fbfadd83a1f,66e22e6a6acec64344dc453f8202c642,42a2a884f0dc65a8354ec3eb7f1761e3,3923d10f373562209d57b68b203edc76'
  AND to_regprocedure('public.capture_non_vehicle_auto_v1(uuid,uuid,uuid,boolean,integer,date,boolean)') IS NULL
  AND to_regprocedure('public.capture_vehicle_label_profile(uuid)') IS NULL
  AND to_regprocedure('public.capture_sets_rearm_read_after_scoring_v1(uuid,uuid,boolean,integer)') IS NULL
  AND to_regprocedure('public.capture_upload_status_resync_v1(uuid,timestamp with time zone,boolean,integer)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'capture_landing_config' AND column_name = 'auto_non_vehicle_granted_by')
  AND has_function_privilege('service_role', 'public.capture_sets_drain(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_sets_drain(integer)', 'EXECUTE'),
  'revert: production''s bodies are back with their grants; new objects are gone');
\ir revert_20261122030000_capture_arm_on_classified.sql
SELECT t_assert(true, 'revert: a second revert is a no-op');
\ir ../migrations/20261122030000_capture_arm_on_classified.sql
SELECT t_assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.capture_sets_drain(integer)'::regprocedure) = 'e7780a1c38b3373e83a5f42c011ea3a7'
  AND to_regprocedure('public.capture_non_vehicle_auto_v1(uuid,uuid,uuid,boolean,integer,date,boolean)') IS NOT NULL, 're-apply: works');
