-- Contract: 20261125133000. One call of capture_upload_status_resync_v1 finishes the owner's status rows that the
-- 20261122030000 terminal rule never reached, and touches nothing else:
--   M  metadata-only row (skipped, empty image_url) stuck 'queued'          -> done, terminal metadata_only
--   D  re-sent copy (is_duplicate) stuck 'queued'                           -> done, terminal duplicate
--   P  a pending pixel photo, 'queued'                                       -> stays queued (the classifier will take it)
--   A  a June row with the legacy status 'analyzed', 'queued'                -> stays queued (named, not guessed)
--   C  a classified photo, 'done'                                            -> unchanged
--   O  another user's stuck metadata-only row                                -> unchanged
--   a 'trigger' event row per change; no vehicle_images row written; replay changes nothing; a drifted writer stops it.
-- capture_upload_status_upsert and capture_upload_status_resync_v1 are production's bodies of 2026-11-25 (md5-checked).
-- Disposable PG17 only, synthetic rows in stand-in tables. -- ALLOW_RAW_TESTIMONY_WRITE (local fixture, never production)
\set ON_ERROR_STOP on
SET client_min_messages = notice;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database (dm_refinement_*)';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
CREATE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ===== stand-ins: the columns the resync and the upsert read
-- guardrail-allow(center-key-fk): vehicle_images: disposable PG17 stand-in of a live table; only the columns the writers read
-- guardrail-allow(center-key-fk): capture_upload_status: disposable PG17 stand-in of a live table; its live columns
-- guardrail-allow(center-key-fk): capture_analysis_events: disposable PG17 stand-in of a live table; its live columns
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text DEFAULT 'capture_relay_ios',
  created_at timestamptz NOT NULL DEFAULT now(), image_url text NOT NULL DEFAULT '', storage_path text, file_name text, filename text,
  is_duplicate boolean, duplicate_of uuid, is_document boolean, ai_processing_status text, ai_scan_metadata jsonb DEFAULT '{}',
  image_type text, ai_avg_confidence numeric, ai_detected_angle text, ai_detected_angle_confidence numeric);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, attached boolean DEFAULT false,
  filename text, storage_path text, stage text DEFAULT 'uploaded', stage_detail jsonb DEFAULT '{}'::jsonb, error_class text,
  http_status integer, image_type text, confidence numeric, current_step text DEFAULT 'queued', step_detail jsonb DEFAULT '{}'::jsonb,
  step_updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.capture_analysis_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, image_id uuid, user_id uuid, step text,
  detail jsonb, reported_by text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_config(id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), user_id uuid NOT NULL);

-- ===== production's bodies
CREATE OR REPLACE FUNCTION public.capture_upload_status_upsert(p_row vehicle_images, p_old_status text, p_op text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text := coalesce(p_row.ai_processing_status, 'pending');
  v_cls jsonb := p_row.ai_scan_metadata -> 'classification';
  v_rcpt jsonb := p_row.ai_scan_metadata -> 'classification' -> 'classifier_receipt';
  v_flag boolean := coalesce(p_row.ai_scan_metadata ->> 'classifier_failed', 'false') = 'true';
  v_stage text;
  v_step text;
  v_detail jsonb := '{}'::jsonb;
  v_stepdetail jsonb := '{}'::jsonb;
  v_type text;
  v_conf numeric;
  v_err text;
  v_http integer;
  v_fname text;
  v_old public.capture_upload_status%rowtype;
  v_have boolean;
  v_terminal text;
begin
  if p_row.user_id is null then return; end if;
  if v_status = 'failed' or (v_status in ('completed','complete','done') and v_flag) then
    v_stage := 'failed';
  elsif v_status in ('completed','complete','done') then
    v_stage := case when p_row.vehicle_id is not null then 'attached' else 'classified' end;
  elsif v_status in ('processing','in_progress','running','classifying','started') then
    v_stage := 'classifying';
  else
    v_stage := 'uploaded';
  end if;

  select * into v_old from public.capture_upload_status where image_id = p_row.id;
  v_have := found;
  if v_stage = 'uploaded' and v_have and v_old.stage = 'classifying' and p_op = 'UPDATE' and p_old_status is not distinct from p_row.ai_processing_status then
    v_stage := 'classifying';
  end if;

  v_fname := coalesce(nullif(p_row.file_name,''), nullif(p_row.filename,''), nullif(regexp_replace(coalesce(p_row.storage_path,''), '^.*/', ''), ''));

  if v_stage = 'failed' then
    v_err := coalesce(v_rcpt ->> 'error_class', p_row.ai_scan_metadata -> 'photo_pipeline' -> 'receipt' ->> 'error_class', 'unknown');
    v_http := nullif(coalesce(v_rcpt ->> 'http_status', p_row.ai_scan_metadata -> 'photo_pipeline' -> 'receipt' ->> 'http_status'), '')::integer;
    v_detail := jsonb_strip_nulls(jsonb_build_object('error_class', v_err, 'http_status', v_http, 'failure_phase', coalesce(v_rcpt ->> 'failure_phase', p_row.ai_scan_metadata -> 'photo_pipeline' -> 'receipt' ->> 'failure_phase'), 'model', v_rcpt ->> 'model'));
    v_step := 'failed'; v_stepdetail := v_detail;
  elsif v_stage in ('classified','attached') then
    v_type := coalesce(v_cls ->> 'image_type', p_row.image_type);
    v_conf := coalesce(nullif(v_cls ->> 'confidence','')::numeric, p_row.ai_avg_confidence, p_row.ai_detected_angle_confidence);
    v_detail := jsonb_strip_nulls(jsonb_build_object('image_type', v_type, 'confidence', v_conf, 'description', v_cls ->> 'description', 'angle', p_row.ai_detected_angle, 'is_document', p_row.is_document, 'vehicle_id', p_row.vehicle_id));
    v_step := 'done'; v_stepdetail := v_detail;
  elsif v_stage = 'classifying' then
    v_step := 'classifying';
  else
    v_step := 'queued';
  end if;

  -- 20261122030000: a row the classifier will never pick up is finished, not queued: a metadata-only record (the
  -- picture stayed on the phone, empty image_url) or a re-sent copy of a photo already uploaded (is_duplicate).
  if v_stage = 'uploaded' then
    if nullif(btrim(coalesce(p_row.image_url, '')), '') is null then
      v_terminal := 'metadata_only';
    elsif coalesce(p_row.is_duplicate, false) then
      v_terminal := 'duplicate';
    end if;
  end if;
  if v_terminal is not null then
    v_detail := jsonb_strip_nulls(jsonb_build_object('terminal', v_terminal,
                  'duplicate_of', case when v_terminal = 'duplicate' then p_row.duplicate_of end));
    v_step := 'done'; v_stepdetail := v_detail;
  end if;

  if not v_have then
    insert into public.capture_upload_status (image_id, user_id, vehicle_id, attached, filename, storage_path, stage, stage_detail, error_class, http_status, image_type, confidence, current_step, step_detail, step_updated_at, created_at, updated_at)
    values (p_row.id, p_row.user_id, p_row.vehicle_id, p_row.vehicle_id is not null, v_fname, p_row.storage_path, v_stage, v_detail, v_err, v_http, v_type, v_conf, v_step, v_stepdetail, now(), coalesce(p_row.created_at, now()), now())
    on conflict (image_id) do nothing;
    insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_row.id, p_row.user_id, v_step, v_stepdetail, 'trigger');
  elsif (v_old.stage, v_old.vehicle_id, v_old.stage_detail, v_old.filename) is distinct from (v_stage, p_row.vehicle_id, v_detail, v_fname)
        or (v_terminal is not null and v_old.current_step is distinct from 'done')
        or (v_stage in ('classified','attached') and v_old.current_step = 'failed') then
    if v_terminal is not null or (v_stage in ('classified','attached') and v_old.current_step = 'failed') then
      -- 20261122030000: a finished row shows done; a classified photo whose later step failed stays classified
      null;
    elsif v_old.stage is distinct from v_stage then
      if v_stage = 'classifying' and v_old.current_step in ('downloading','reading_text','extracting_fields','matching_vehicle') then
        v_step := v_old.current_step; v_stepdetail := v_old.step_detail;
      end if;
    else
      v_step := v_old.current_step; v_stepdetail := v_old.step_detail;
    end if;
    update public.capture_upload_status set
      vehicle_id = p_row.vehicle_id, attached = p_row.vehicle_id is not null, filename = v_fname, storage_path = p_row.storage_path,
      stage = v_stage, stage_detail = v_detail, error_class = v_err, http_status = v_http, image_type = v_type, confidence = v_conf,
      current_step = v_step, step_detail = v_stepdetail,
      step_updated_at = case when v_step is distinct from v_old.current_step or v_stepdetail is distinct from v_old.step_detail then now() else step_updated_at end,
      updated_at = now()
    where image_id = p_row.id;
    if v_step is distinct from v_old.current_step then
      insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_row.id, p_row.user_id, v_step, v_stepdetail, 'trigger');
    end if;
  end if;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.capture_upload_status_resync_v1(p_user uuid, p_since timestamp with time zone, p_dry boolean DEFAULT true, p_cap integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.vehicle_images%rowtype; n integer := 0; v_before text; v_after text; v_changed jsonb := '{}';
BEGIN
  IF p_user IS NULL OR p_since IS NULL THEN RAISE EXCEPTION 'capture_upload_status_resync_v1: user and since required'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 2000 THEN RAISE EXCEPTION 'capture_upload_status_resync_v1: cap must be 1..2000'; END IF;
  FOR r IN SELECT v.* FROM vehicle_images v JOIN capture_upload_status s ON s.image_id = v.id
           WHERE v.user_id = p_user AND v.source = 'capture_relay_ios' AND v.created_at >= p_since
             AND s.current_step IN ('queued', 'failed')
           ORDER BY v.created_at LIMIT p_cap LOOP
    n := n + 1;
    IF NOT p_dry THEN
      SELECT current_step INTO v_before FROM capture_upload_status WHERE image_id = r.id;
      PERFORM capture_upload_status_upsert(r, r.ai_processing_status, 'UPDATE');
      SELECT current_step INTO v_after FROM capture_upload_status WHERE image_id = r.id;
      IF v_after IS DISTINCT FROM v_before THEN
        v_changed := jsonb_set(v_changed, ARRAY[v_before || '->' || v_after],
                               to_jsonb(coalesce((v_changed ->> (v_before || '->' || v_after))::integer, 0) + 1));
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry', p_dry, 'rows', n, 'changed', v_changed);
END
$function$

;

SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_upload_status_upsert') = 'f0102125210bb45a793631ed254c4bdf'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_upload_status_resync_v1') = '11dbc094aeca4b22e239d3aa8c44d2b7',
  'capture_upload_status_upsert and capture_upload_status_resync_v1 are production''s bodies (md5)');

-- ===== fixture: owner U; the status rows as a pre-20261122030000 upsert left them
INSERT INTO public.capture_landing_config VALUES (1, '00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.vehicle_images(id, user_id, created_at, image_url, storage_path, is_duplicate, ai_processing_status, ai_scan_metadata) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', '2026-11-13', '', NULL, NULL, 'skipped', '{}'),                  -- M
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000aa', '2026-10-20', 'x.jpg', 'u/x.jpg', true, 'skipped', '{}'),       -- D
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000aa', '2026-11-24', 'y.jpg', 'u/y.jpg', NULL, 'pending', '{}'),       -- P
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-0000000000aa', '2026-06-12', 'z.jpg', 'u/z.jpg', NULL, 'analyzed', '{}'),      -- A
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-0000000000aa', '2026-11-20', 'w.jpg', 'u/w.jpg', NULL, 'completed',
     '{"classification":{"image_type":"vehicle_exterior","confidence":0.9}}'),                                                                    -- C
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-0000000000bb', '2026-11-13', '', NULL, NULL, 'skipped', '{}');                  -- O
INSERT INTO public.capture_upload_status(image_id, user_id, stage, current_step, created_at)
SELECT id, user_id, 'uploaded', 'queued', created_at FROM public.vehicle_images WHERE id <> '00000000-0000-4000-8000-00000000000e';
SELECT public.capture_upload_status_upsert(v, v.ai_processing_status, 'INSERT') FROM public.vehicle_images v WHERE v.id = '00000000-0000-4000-8000-00000000000e';
CREATE TEMP TABLE vi_before AS SELECT * FROM public.vehicle_images;
CREATE TEMP TABLE c_before AS SELECT * FROM public.capture_upload_status WHERE image_id = '00000000-0000-4000-8000-00000000000e';
CREATE TEMP TABLE ev0 AS SELECT count(*) n FROM public.capture_analysis_events;
CREATE FUNCTION pg_temp.st(k text) RETURNS text LANGUAGE sql AS $$
  SELECT current_step || '/' || coalesce(step_detail ->> 'terminal', '-') FROM public.capture_upload_status
   WHERE image_id = ('00000000-0000-4000-8000-00000000000' || k)::uuid $$;

-- ===== a drifted writer stops the migration
ALTER FUNCTION public.capture_upload_status_resync_v1(uuid, timestamptz, boolean, integer) RENAME TO resync_held;
CREATE FUNCTION public.capture_upload_status_resync_v1(p_user uuid, p_since timestamptz, p_dry boolean, p_cap integer)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261125133000_capture_upload_status_resync_terminal.sql
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.ok(pg_temp.st('a') = 'queued/-' AND pg_temp.st('b') = 'queued/-', 'a drifted resync: the guard stops the migration, nothing changes');
DROP FUNCTION public.capture_upload_status_resync_v1(uuid, timestamptz, boolean, integer);
ALTER FUNCTION public.resync_held(uuid, timestamptz, boolean, integer) RENAME TO capture_upload_status_resync_v1;

-- ===== apply
\ir ../migrations/20261125133000_capture_upload_status_resync_terminal.sql
SELECT pg_temp.ok(pg_temp.st('a') = 'done/metadata_only', 'M: a metadata-only row shows done, terminal metadata_only');
SELECT pg_temp.ok(pg_temp.st('b') = 'done/duplicate', 'D: a re-sent copy shows done, terminal duplicate');
SELECT pg_temp.ok(pg_temp.st('c') = 'queued/-', 'P: a pending pixel photo stays queued for the classifier');
SELECT pg_temp.ok(pg_temp.st('d') = 'queued/-', 'A: the legacy analyzed row stays queued');
SELECT pg_temp.ok((SELECT row(c.*)::text FROM public.capture_upload_status c WHERE image_id = '00000000-0000-4000-8000-00000000000e')
                  = (SELECT row(c.*)::text FROM c_before c), 'C: a classified row is unchanged');
SELECT pg_temp.ok(pg_temp.st('f') = 'queued/-', 'O: another user''s row is unchanged');
SELECT pg_temp.ok((SELECT count(*) FROM public.capture_analysis_events) - (SELECT n FROM ev0) = 2
  AND NOT EXISTS (SELECT 1 FROM public.capture_analysis_events WHERE reported_by <> 'trigger' AND id > (SELECT n FROM ev0)),
  'one trigger event row per change (2)');
SELECT pg_temp.ok(NOT EXISTS (SELECT * FROM public.vehicle_images EXCEPT SELECT * FROM vi_before)
  AND (SELECT count(*) FROM public.vehicle_images) = (SELECT count(*) FROM vi_before), 'no vehicle_images row is written');

-- ===== replay
CREATE TEMP TABLE s_after AS SELECT * FROM public.capture_upload_status;
CREATE TEMP TABLE ev1 AS SELECT count(*) n FROM public.capture_analysis_events;
\ir ../migrations/20261125133000_capture_upload_status_resync_terminal.sql
SELECT pg_temp.ok(NOT EXISTS (SELECT image_id, current_step, step_detail, stage FROM public.capture_upload_status
                              EXCEPT SELECT image_id, current_step, step_detail, stage FROM s_after)
  AND (SELECT count(*) FROM public.capture_analysis_events) = (SELECT n FROM ev1), 'replay changes nothing and writes no event');

SELECT 'test_capture_upload_status_resync_terminal: all contracts passed' AS result;
