-- Revert of 20261122030000_capture_arm_on_classified: puts production's earlier bodies of flag_duplicate_image,
-- capture_upload_status_upsert, report_capture_step, capture_sets_arm_new_photos and capture_sets_drain back, drops the
-- functions the migration added and capture_landing_config.auto_non_vehicle_granted_by. No rows are written here:
-- revert verdicts written by capture_non_vehicle_auto_v1 first with capture_non_vehicle_review_revert_v1(user, run), and
-- queued days with capture_sets_rearm_read_after_scoring_revert_v1(user, run).
-- A body that is neither the earlier one nor the one the migration installed is left alone and the revert refuses.
-- A function that does not exist is created with the earlier body (the contract uses this to install it in an empty
-- database); otherwise CREATE OR REPLACE keeps owner and grants, which the post-check confirms.
-- Run as the function owner, e.g. psql -X -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261122030000_capture_arm_on_classified.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Refuse unless each function's live body is the one this file was written from or the one it installs (md5 of
-- prosrc); remember owner, grants, security, volatility, language, SET clause, arguments and result to check after.
do $do$
declare
  v_md5 text;
  v_sig text;
  v_attrs jsonb := '{}';
begin
  foreach v_sig in array array['public.flag_duplicate_image()', 'public.capture_upload_status_upsert(vehicle_images,text,text)', 'public.report_capture_step(uuid,text,jsonb)', 'public.capture_sets_arm_new_photos()', 'public.capture_sets_drain(integer)'] loop
    select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_sig);
    if v_md5 is not null and v_md5 <> all (case v_sig
      when 'public.flag_duplicate_image()' then array['42a2a884f0dc65a8354ec3eb7f1761e3', 'bca6ff27c1f32655bf4b3e48dea2ab7d']
      when 'public.capture_upload_status_upsert(vehicle_images,text,text)' then array['66e22e6a6acec64344dc453f8202c642', 'f0102125210bb45a793631ed254c4bdf']
      when 'public.report_capture_step(uuid,text,jsonb)' then array['3923d10f373562209d57b68b203edc76', '47969c0897f6056561821c73db299c82']
      when 'public.capture_sets_arm_new_photos()' then array['e5f1d11216b96d78a8bcdf36bf75969e', '333c837b7be332340e163a37027ffdd6']
      when 'public.capture_sets_drain(integer)' then array['196499501328ced3d6c99fbfadd83a1f', 'e7780a1c38b3373e83a5f42c011ea3a7']
      end) then
      raise exception '% is not the body this migration was written against (md5 %); refusing to replace it', v_sig, v_md5;
    end if;
    v_attrs := v_attrs || jsonb_build_object(v_sig, (select concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname,
                         p.proconfig::text, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
               from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure(v_sig)));
  end loop;
  perform set_config('capture_arm_on_classified.attrs', v_attrs::text, true);
end $do$;

CREATE OR REPLACE FUNCTION public.flag_duplicate_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE existing uuid;
BEGIN
  IF NEW.file_hash IS NOT NULL AND NEW.is_duplicate IS NOT TRUE THEN
    -- A row held for pointing at another photo's bytes is never the original (hold_wrong_byte_images).
    SELECT id INTO existing
      FROM vehicle_images
      WHERE user_id = NEW.user_id AND file_hash = NEW.file_hash
        AND NOT public.vehicle_image_holds_wrong_bytes(id)
      LIMIT 1;
    IF existing IS NOT NULL THEN
      NEW.is_duplicate := true;
      NEW.duplicate_of := existing;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

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

  if not v_have then
    insert into public.capture_upload_status (image_id, user_id, vehicle_id, attached, filename, storage_path, stage, stage_detail, error_class, http_status, image_type, confidence, current_step, step_detail, step_updated_at, created_at, updated_at)
    values (p_row.id, p_row.user_id, p_row.vehicle_id, p_row.vehicle_id is not null, v_fname, p_row.storage_path, v_stage, v_detail, v_err, v_http, v_type, v_conf, v_step, v_stepdetail, now(), coalesce(p_row.created_at, now()), now())
    on conflict (image_id) do nothing;
    insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_row.id, p_row.user_id, v_step, v_stepdetail, 'trigger');
  elsif (v_old.stage, v_old.vehicle_id, v_old.stage_detail, v_old.filename) is distinct from (v_stage, p_row.vehicle_id, v_detail, v_fname) then
    if v_old.stage is distinct from v_stage then
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
$function$;

CREATE OR REPLACE FUNCTION public.report_capture_step(p_image_id uuid, p_step text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.capture_upload_status%rowtype;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_new_stage text;
begin
  if p_step is null or p_step not in ('queued','downloading','classifying','reading_text','extracting_fields','matching_vehicle','done','failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_step', 'image_id', p_image_id, 'step', p_step);
  end if;
  select * into v_row from public.capture_upload_status where image_id = p_image_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_tracked', 'image_id', p_image_id, 'step', p_step);
  end if;
  v_new_stage := v_row.stage;
  if v_row.stage = 'uploaded' and p_step in ('downloading','classifying','reading_text','extracting_fields','matching_vehicle') then
    v_new_stage := 'classifying';
  end if;
  update public.capture_upload_status set
    current_step = p_step,
    step_detail = case when p_step in ('queued','downloading') then v_detail else step_detail || v_detail end,
    step_updated_at = now(), stage = v_new_stage, updated_at = now()
  where image_id = p_image_id
  returning * into v_row;
  insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_image_id, v_row.user_id, p_step, v_detail, 'orchestrator');
  return jsonb_build_object('ok', true, 'image_id', v_row.image_id, 'step', v_row.current_step, 'stage', v_row.stage, 'step_updated_at', v_row.step_updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.capture_sets_arm_new_photos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_from timestamptz; v_to timestamptz := now(); n integer := 0; r record;
BEGIN
  SELECT last_scan INTO v_from FROM capture_sets_arm_cursor WHERE id FOR UPDATE;
  FOR r IN SELECT u.user_id, (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date d, count(*) c
           FROM (SELECT DISTINCT user_id FROM capture_upload_status WHERE user_id IS NOT NULL) u
           JOIN LATERAL (SELECT taken_at FROM vehicle_images v
                         WHERE v.user_id = u.user_id AND v.vehicle_id IS NULL AND v.created_at > v_from AND v.created_at <= v_to
                           AND public.capture_set_photo_admits(v.source, v.vehicle_id, v.exif_data) AND v.taken_at IS NOT NULL) vi ON true
           GROUP BY 1, 2 LOOP
    PERFORM capture_sets_enqueue(r.user_id, r.d, jsonb_build_object('arrival', r.c));
    n := n + 1;
  END LOOP;
  UPDATE capture_sets_arm_cursor SET last_scan = v_to WHERE id;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.capture_sets_drain(p_max integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q record; v_run uuid; v_res jsonb; v_out jsonb := '[]'; v_armed integer; v_state jsonb;
BEGIN
  v_armed := capture_sets_arm_new_photos();
  FOR q IN SELECT * FROM capture_set_rescore_queue
           WHERE done_at IS NULL AND not_before <= current_date AND requested_at < now() - interval '10 minutes'
           ORDER BY requested_at LIMIT greatest(1, least(p_max, 5)) FOR UPDATE SKIP LOCKED LOOP
    -- Dedupe and back off (20261113120000): no second plan while one waits on the gate, and no re-plan of a day the gate
    -- refused until new evidence arrives. New photos (arrival) or a new text read always re-plan.
    v_state := capture_day_replan_state(q.user_id, q.day);
    IF coalesce((v_state->>'blocked')::boolean, false)
       AND NOT coalesce(jsonb_path_query_first(q.reasons, '$[last]') ?| ARRAY['arrival', 'text_read'], false) THEN
      UPDATE capture_set_rescore_queue SET done_at = now(), done_run_id = NULL,
             reasons = reasons || jsonb_build_array(jsonb_build_object('skipped', v_state->>'reason', 'chunk', v_state->'chunk', 'at', now()))
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'skipped', v_state->>'reason', 'chunk', v_state->'chunk');
      CONTINUE;
    END IF;
    v_run := gen_random_uuid();
    BEGIN
      v_res := capture_sets_landing_run(q.user_id, (q.day::timestamp AT TIME ZONE 'America/Los_Angeles'),
                                        ((q.day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'), v_run, false);
      UPDATE capture_set_rescore_queue SET done_run_id = v_run, done_at = now()
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'run_id', v_run, 'sets', v_res->'sets_scored',
                 'filed', v_res#>'{apply,photos_filed}', 'review_sets', v_res->'review_sets');
    EXCEPTION WHEN OTHERS THEN
      UPDATE capture_set_rescore_queue SET not_before = current_date + 1,
             reasons = reasons || jsonb_build_array(jsonb_build_object('error', left(SQLERRM, 200), 'at', now()))
       WHERE user_id = q.user_id AND day = q.day;
      v_out := v_out || jsonb_build_object('day', q.day, 'error', left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('armed_days', v_armed, 'runs', v_out);
END $function$;

-- Check: each body is the one this file names, and no attribute moved (a function created here has none to keep).
do $do$
declare
  v_md5 text;
  v_sig text;
  v_was jsonb := current_setting('capture_arm_on_classified.attrs', true)::jsonb;
  v_now text;
begin
  foreach v_sig in array array['public.flag_duplicate_image()', 'public.capture_upload_status_upsert(vehicle_images,text,text)', 'public.report_capture_step(uuid,text,jsonb)', 'public.capture_sets_arm_new_photos()', 'public.capture_sets_drain(integer)'] loop
    select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_sig);
    if v_md5 is distinct from (case v_sig
      when 'public.flag_duplicate_image()' then '42a2a884f0dc65a8354ec3eb7f1761e3'
      when 'public.capture_upload_status_upsert(vehicle_images,text,text)' then '66e22e6a6acec64344dc453f8202c642'
      when 'public.report_capture_step(uuid,text,jsonb)' then '3923d10f373562209d57b68b203edc76'
      when 'public.capture_sets_arm_new_photos()' then 'e5f1d11216b96d78a8bcdf36bf75969e'
      when 'public.capture_sets_drain(integer)' then '196499501328ced3d6c99fbfadd83a1f'
      end) then
      raise exception '% did not become the body this file names (md5 %)', v_sig, coalesce(v_md5, 'null');
    end if;
    v_now := (select concat_ws(' | ', pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.provolatile, l.lanname,
                         p.proconfig::text, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
               from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure(v_sig));
    if v_was ->> v_sig is not null and v_now is distinct from v_was ->> v_sig then
      raise exception '% attributes moved: % became %', v_sig, v_was ->> v_sig, v_now;
    end if;
  end loop;
end $do$;

drop function if exists public.capture_upload_status_resync_v1(uuid, timestamptz, boolean, integer);
drop function if exists public.capture_sets_rearm_read_after_scoring_revert_v1(uuid, uuid);
drop function if exists public.capture_sets_rearm_read_after_scoring_v1(uuid, uuid, boolean, integer);
drop function if exists public.capture_non_vehicle_auto_v1(uuid, uuid, uuid, boolean, integer, date, boolean);
drop function if exists public.capture_vehicle_label_profile(uuid);
alter table public.capture_landing_config drop column if exists auto_non_vehicle_granted_by;

commit;
