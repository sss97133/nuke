-- Capture landing: a day is scored when its photos finish classifying, not when they arrive.
--
-- Why. Nothing landed on a vehicle after 2026-11-10 00:21 UTC. capture_sets_arm_new_photos armed a day when a photo
-- arrived (created_at), and capture_sets_drain scored the day 10 minutes later whether or not its photos had been
-- classified. With the classifier rate-limited, 64 of 100 unscored uploads had their day scored before they were read;
-- the scorer skips unread photos, so they stayed unsorted and nothing re-armed the day. Photos the classifier called
-- "other" had no terminal state. The status page showed metadata-only and duplicate rows as queued forever and a
-- classified photo as failed when a later step was rate-limited.
--
-- Changes (all bodies below are production's live bodies of 2026-11-21 with the marked additions):
--   1. flag_duplicate_image (BEFORE INSERT): a phone (capture_relay_ios) row flagged is_duplicate at insert and still
--      pending is marked skipped, tagged ai_scan_metadata.skipped = duplicate_at_insert (the classifier never claims a
--      duplicate). Other sources are unchanged.
--   2. capture_upload_status_upsert: a row with no stored picture (metadata only) or a duplicate shows done with
--      step_detail.terminal = metadata_only | duplicate; a classified photo whose step showed failed shows done.
--   3. report_capture_step: a failed step reported for a photo already classified keeps its step; the error is kept
--      in step_detail.post_classification_error and in capture_analysis_events.
--   4. capture_sets_arm_new_photos: also arms the day of each unfiled admitted photo whose classification completed in
--      the cursor window (photos uploaded in the last 14 days), reason {classified: n}.
--      capture_sets_drain: defers a day (requested_at moves, nothing is planned) while one of its admitted, stored,
--      non-duplicate photos uploaded in the last 6 hours is still pending or processing; a classified or
--      read_after_scoring reason re-plans a day the gate refused (never a plan still pending); and, when
--      capture_landing_config.auto_non_vehicle_granted_by is set (new column, null = off), runs
--      capture_non_vehicle_auto_v1 for the day under the day's run id.
--   5. capture_vehicle_label_profile + capture_non_vehicle_auto_v1: a terminal non_vehicle verdict (capture_non_vehicle_log;
--      the photo row and its metadata are untouched) for classifier-"other" photos that a second reader also finds no
--      vehicle in, using vehicle labels learned per owner from the owner's own decided photos. Dry by default.
--   6. capture_sets_rearm_read_after_scoring_v1 (+ _revert_v1): re-queue days that were planned before their photos were
--      classified. Dry by default, at most 50 days a call.
--   7. capture_upload_status_resync_v1: re-derives the status rows of recent phone uploads through the new upsert.
-- No producer runs here; nothing is backfilled by this file.
-- Contract: supabase/sql/test_capture_arm_on_classified.sql
-- Revert: supabase/sql/revert_20261122030000_capture_arm_on_classified.sql (live bodies back, new objects dropped);
--   verdicts by run: capture_non_vehicle_review_revert_v1(user, run); queued days: capture_sets_rearm_read_after_scoring_revert_v1.

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
    if v_md5 is null then raise exception '% is not live', v_sig; end if;
    if v_md5 <> all (case v_sig
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

-- 1. The phone's duplicate re-sends are closed at insert (BEFORE INSERT trigger trg_flag_duplicate_image's function).
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
  -- 20261122030000: a phone re-send of a photo already uploaded is closed at insert. The classifier never claims a
  -- duplicate, so it would sit pending forever; it is marked skipped and tagged (ai_scan_metadata.skipped).
  IF NEW.is_duplicate IS TRUE AND NEW.source = 'capture_relay_ios' AND coalesce(NEW.ai_processing_status, 'pending') = 'pending' THEN
    NEW.ai_processing_status := 'skipped';
    NEW.ai_scan_metadata := coalesce(NEW.ai_scan_metadata, '{}'::jsonb)
                            || jsonb_build_object('skipped', 'duplicate_at_insert', 'duplicate_of', NEW.duplicate_of);
  END IF;
  RETURN NEW;
END; $function$;

-- 2. The status page: metadata-only and duplicate rows finish; a classified photo is never shown failed.
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
$function$;

-- 3. A failure reported after classification keeps the classified step.
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
  -- 20261122030000: a failure reported after the photo was classified (e.g. a rate limit on a later step) does not
  -- turn a classified photo into a failed one: the step stays, and the error is kept as post_classification_error.
  if p_step = 'failed' and v_row.stage in ('classified','attached') then
    update public.capture_upload_status set
      step_detail = step_detail || jsonb_build_object('post_classification_error', v_detail), updated_at = now()
    where image_id = p_image_id
    returning * into v_row;
    insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by)
    values (p_image_id, v_row.user_id, p_step, v_detail || jsonb_build_object('kept_step', v_row.current_step), 'orchestrator');
    return jsonb_build_object('ok', true, 'image_id', v_row.image_id, 'step', v_row.current_step, 'stage', v_row.stage,
                              'step_updated_at', v_row.step_updated_at, 'kept', 'post_classification_error');
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

-- 4. Arm a day when its photos finish classifying; the drain waits while a photo of the day is still being read.
CREATE OR REPLACE FUNCTION public.capture_sets_arm_new_photos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$DECLARE v_from timestamptz; v_to timestamptz := now(); n integer := 0; r record;
BEGIN
  SELECT last_scan INTO v_from FROM capture_sets_arm_cursor WHERE id FOR UPDATE;
  -- 20261122030000: a day is armed when a photo of it arrives (as before) and again when a photo of it finishes
  -- classification (ai_processing_completed_at in the same cursor window), so the day is scored on the classifier's
  -- answer. Classification is looked for among photos uploaded in the last 14 days (idx_vehicle_images_unorganized).
  FOR r IN SELECT u.user_id, (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date d,
                  count(*) FILTER (WHERE vi.arrived) c, count(*) FILTER (WHERE vi.read) k
           FROM (SELECT DISTINCT user_id FROM capture_upload_status WHERE user_id IS NOT NULL) u
           JOIN LATERAL (SELECT v.taken_at, (v.created_at > v_from) arrived,
                                coalesce(v.ai_processing_status = 'completed' AND v.ai_processing_completed_at > v_from
                                         AND v.ai_processing_completed_at <= v_to, false) read
                         FROM vehicle_images v
                         WHERE v.user_id = u.user_id AND v.vehicle_id IS NULL
                           AND v.created_at > least(v_from, v_to - interval '14 days') AND v.created_at <= v_to
                           AND (v.created_at > v_from
                                OR (v.ai_processing_status = 'completed' AND v.ai_processing_completed_at > v_from
                                    AND v.ai_processing_completed_at <= v_to))
                           AND public.capture_set_photo_admits(v.source, v.vehicle_id, v.exif_data) AND v.taken_at IS NOT NULL) vi ON true
           GROUP BY 1, 2 LOOP
    PERFORM capture_sets_enqueue(r.user_id, r.d,
              CASE WHEN r.c > 0 THEN jsonb_build_object('arrival', r.c) ELSE '{}'::jsonb END
              || CASE WHEN r.k > 0 THEN jsonb_build_object('classified', r.k) ELSE '{}'::jsonb END);
    n := n + 1;
  END LOOP;
  UPDATE capture_sets_arm_cursor SET last_scan = v_to WHERE id;
  RETURN n;
END 
$function$;

CREATE OR REPLACE FUNCTION public.capture_sets_drain(p_max integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q record; v_run uuid; v_res jsonb; v_out jsonb := '[]'; v_armed integer; v_state jsonb; v_pending integer;
        v_last jsonb; v_nv_by uuid; v_nv jsonb;
BEGIN
  v_armed := capture_sets_arm_new_photos();
  FOR q IN SELECT * FROM capture_set_rescore_queue
           WHERE done_at IS NULL AND not_before <= current_date AND requested_at < now() - interval '10 minutes'
           ORDER BY requested_at LIMIT greatest(1, least(p_max, 5)) FOR UPDATE SKIP LOCKED LOOP
    -- 20261122030000: a day waits while one of its photos is still being classified, so it is scored on the
    -- classifier's answer and not before it. A photo uploaded more than 6 hours ago no longer holds the day back.
    SELECT count(*) INTO v_pending FROM vehicle_images v
     WHERE v.user_id = q.user_id AND v.vehicle_id IS NULL
       AND v.taken_at >= (q.day::timestamp AT TIME ZONE 'America/Los_Angeles')
       AND v.taken_at < ((q.day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')
       AND v.created_at > now() - interval '6 hours'
       AND coalesce(v.ai_processing_status, 'pending') IN ('pending', 'processing', 'in_progress', 'running', 'classifying', 'started')
       AND v.is_duplicate IS NOT TRUE AND nullif(btrim(coalesce(v.image_url, '')), '') IS NOT NULL
       AND public.capture_set_photo_admits(v.source, v.vehicle_id, v.exif_data);
    IF v_pending > 0 THEN
      UPDATE capture_set_rescore_queue SET requested_at = now()
       WHERE user_id = q.user_id AND day = q.day AND requested_at = q.requested_at;
      v_out := v_out || jsonb_build_object('day', q.day, 'deferred', 'awaiting_classification', 'pending', v_pending);
      CONTINUE;
    END IF;
    -- Dedupe and back off (20261113120000): no second plan while one waits on the gate, and no re-plan of a day the gate
    -- refused until new evidence arrives. New photos (arrival) or a new text read always re-plan. A finished
    -- classification (classified, read_after_scoring; 20261122030000) re-plans a refused day, never a pending plan.
    v_state := capture_day_replan_state(q.user_id, q.day);
    v_last := jsonb_path_query_first(q.reasons, '$[last]');
    IF coalesce((v_state->>'blocked')::boolean, false)
       AND NOT coalesce(v_last ?| ARRAY['arrival', 'text_read'], false)
       AND NOT (v_state->>'reason' = 'refused_no_new_evidence'
                AND coalesce(v_last ?| ARRAY['classified', 'read_after_scoring'], false)) THEN
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
      CONTINUE;
    END;
    -- 20261122030000: when the owner's landing config names a grantor, the day's classifier-"other" photos that the
    -- second reader also finds no vehicle in become non_vehicle under the same run id (revert:
    -- capture_non_vehicle_review_revert_v1(user, run)). Off while auto_non_vehicle_granted_by is null.
    v_nv_by := NULL;
    SELECT c.auto_non_vehicle_granted_by INTO v_nv_by FROM capture_landing_config c
     WHERE c.user_id = q.user_id AND c.enabled AND NOT c.halted ORDER BY c.id LIMIT 1;
    IF v_nv_by IS NOT NULL THEN
      BEGIN
        v_nv := capture_non_vehicle_auto_v1(q.user_id, v_run, v_nv_by, false, 200, q.day, false);
        v_out := jsonb_set(v_out, ARRAY[(jsonb_array_length(v_out) - 1)::text, 'non_vehicle'], coalesce(v_nv->'taken', '0'));
      EXCEPTION WHEN OTHERS THEN
        v_out := jsonb_set(v_out, ARRAY[(jsonb_array_length(v_out) - 1)::text, 'non_vehicle_error'], to_jsonb(left(SQLERRM, 200)));
      END;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('armed_days', v_armed, 'runs', v_out);
END 
$function$;

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
      when 'public.flag_duplicate_image()' then 'bca6ff27c1f32655bf4b3e48dea2ab7d'
      when 'public.capture_upload_status_upsert(vehicle_images,text,text)' then 'f0102125210bb45a793631ed254c4bdf'
      when 'public.report_capture_step(uuid,text,jsonb)' then '47969c0897f6056561821c73db299c82'
      when 'public.capture_sets_arm_new_photos()' then '333c837b7be332340e163a37027ffdd6'
      when 'public.capture_sets_drain(integer)' then 'e7780a1c38b3373e83a5f42c011ea3a7'
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

-- Grantor for the drain's automatic non-vehicle pass; null (the default) keeps it off.
alter table public.capture_landing_config add column if not exists auto_non_vehicle_granted_by uuid;

-- 5. The second reader for classifier-"other" photos, learned from the owner's own decided photos.
-- capture_vehicle_label_profile(user): the Apple Vision labels that mark a vehicle photo for this owner. A label counts
-- when it is on at least 2% of the owner's gate-approved filed photos and at least twice as frequent there as on the
-- photos the owner decided are not vehicle photos (private, or a non_vehicle verdict given by a person; the automatic
-- verdicts below are left out so the profile does not feed on itself; add-one smoothing on the negative side).
-- Null when the owner has fewer than 200 approved or 50 non-vehicle labelled photos: nothing is learned from too little.
CREATE OR REPLACE FUNCTION public.capture_vehicle_label_profile(p_user uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH dec AS MATERIALIZED (
    SELECT v.id, v.apple_ml_labels,
           (v.vehicle_id IS NOT NULL AND v.vision_gate_status::text = 'approved') AS pos,
           (v.vehicle_id IS NULL AND (v.vision_gate_status::text = 'rejected_personal'
             OR EXISTS (SELECT 1 FROM capture_non_vehicle_log l
                        WHERE l.user_id = p_user AND l.image_id = v.id AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle'
                          AND l.signature NOT LIKE 'capture_non_vehicle_auto_v1/%'))) AS neg
    FROM vehicle_images v
    WHERE v.user_id = p_user AND coalesce(cardinality(v.apple_ml_labels), 0) > 0
      AND v.is_duplicate IS NOT TRUE AND v.is_superseded IS NOT TRUE),
  tot AS (SELECT count(*) FILTER (WHERE pos) AS np, count(*) FILTER (WHERE neg) AS nn FROM dec),
  lab AS (SELECT lower(btrim(x)) AS l, count(DISTINCT d.id) FILTER (WHERE d.pos) AS kp, count(DISTINCT d.id) FILTER (WHERE d.neg) AS kn
          FROM dec d CROSS JOIN LATERAL unnest(d.apple_ml_labels) x WHERE d.pos OR d.neg GROUP BY 1)
  SELECT CASE WHEN t.np >= 200 AND t.nn >= 50 THEN
           coalesce((SELECT array_agg(lab.l ORDER BY lab.l) FROM lab
                     WHERE lab.kp::numeric / t.np >= 0.02
                       AND lab.kp::numeric / t.np >= 2 * ((lab.kn + 1)::numeric / (t.nn + 2))), '{}'::text[])
         END
  FROM tot t
$function$;

-- capture_non_vehicle_auto_v1: an unfiled photo the classifier called "other" becomes non_vehicle (capture_non_vehicle_log,
-- verdict non_vehicle; the photo row and its metadata are not touched) when the second reader agrees: it has Apple Vision
-- labels, none of them in the owner's learned vehicle-label profile, no vehicle score, and no VIN candidate in a text
-- read. Never: a photo without a stored picture (empty image_url, privacy holds included), a privacy-excluded id,
-- sensitive, duplicate, superseded or rejected rows, a classifier failure, or a photo with any live verdict already.
-- Photos on an open review are left alone unless p_include_held. Dry by default; at most p_cap rows per call.
-- Revert: capture_non_vehicle_review_revert_v1(p_user, p_run).
CREATE OR REPLACE FUNCTION public.capture_non_vehicle_auto_v1(p_user uuid, p_run uuid, p_granted_by uuid,
  p_dry boolean DEFAULT true, p_cap integer DEFAULT 50, p_day date DEFAULT NULL, p_include_held boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_prof text[]; v_ids uuid[]; v_days jsonb; n integer := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_non_vehicle_auto_v1: user, run and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 200 THEN
    RAISE EXCEPTION 'capture_non_vehicle_auto_v1: cap must be 1..200';
  END IF;
  v_prof := capture_vehicle_label_profile(p_user);
  IF v_prof IS NULL THEN
    RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'taken', 0, 'skipped', 'too_few_decided_photos_to_learn_from');
  END IF;
  SELECT coalesce(array_agg(c.id ORDER BY c.taken_at, c.id), '{}'),
         coalesce(jsonb_object_agg(c.d, c.n2) FILTER (WHERE c.rn = 1), '{}')
    INTO v_ids, v_days
  FROM (
    SELECT v.id, v.taken_at, (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date AS d,
           count(*) OVER (PARTITION BY (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date) AS n2,
           row_number() OVER (PARTITION BY (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date ORDER BY v.id) AS rn
    FROM vehicle_images v
    WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at IS NOT NULL
      AND (p_day IS NULL OR (v.taken_at >= (p_day::timestamp AT TIME ZONE 'America/Los_Angeles')
                             AND v.taken_at < ((p_day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')))
      AND v.ai_processing_status = 'completed'
      AND coalesce(v.ai_scan_metadata ->> 'classifier_failed', 'false') <> 'true'
      AND v.ai_scan_metadata #>> '{classification,image_type}' = 'other'
      AND nullif(btrim(coalesce(v.image_url, '')), '') IS NOT NULL
      AND v.is_sensitive IS NOT TRUE AND v.is_duplicate IS NOT TRUE AND v.is_superseded IS NOT TRUE
      AND coalesce(v.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed', 'rejected')
      AND coalesce(cardinality(v.apple_ml_labels), 0) > 0
      AND NOT EXISTS (SELECT 1 FROM unnest(v.apple_ml_labels) x WHERE lower(btrim(x)) = ANY (v_prof))
      AND coalesce(v.vehicle_score, 0) <= 0
      AND NOT EXISTS (SELECT 1 FROM image_text_reads t WHERE t.image_id = v.id AND t.revoked_at IS NULL
                        AND jsonb_typeof(t.vin_candidates) = 'array' AND jsonb_array_length(t.vin_candidates) > 0)
      AND NOT EXISTS (SELECT 1 FROM capture_privacy_promote_exclude e WHERE e.image_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM capture_non_vehicle_log l WHERE l.user_id = p_user AND l.image_id = v.id AND l.reverted_at IS NULL)
      AND (p_include_held OR NOT EXISTS (SELECT 1 FROM capture_set_review r
                                         WHERE r.user_id = p_user AND r.status = 'open' AND v.id = ANY (r.image_ids)))
    ORDER BY v.taken_at, v.id
    LIMIT p_cap) c;
  IF NOT p_dry AND cardinality(v_ids) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('capture_non_vehicle_auto_v1:' || p_user::text));
    INSERT INTO capture_non_vehicle_log (run_id, image_id, user_id, granted_by, typ, verdict, reason, day, signature)
    SELECT p_run, v.id, p_user, p_granted_by, 'other', 'non_vehicle',
           'auto: classifier other; no learned vehicle label among Apple Vision labels; no vehicle score; no VIN read',
           (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date, 'capture_non_vehicle_auto_v1/' || p_run
    FROM vehicle_images v
    WHERE v.id = ANY (v_ids)
      AND NOT EXISTS (SELECT 1 FROM capture_non_vehicle_log l WHERE l.user_id = p_user AND l.image_id = v.id AND l.reverted_at IS NULL)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'eligible', cardinality(v_ids), 'taken', CASE WHEN p_dry THEN 0 ELSE n END,
                            'days', v_days, 'profile_labels', cardinality(v_prof),
                            'image_ids', CASE WHEN p_dry THEN to_jsonb(v_ids) END);
END
$function$;

-- 6. Re-queue days that were scored before their photos were classified.
-- A day qualifies when it holds an unfiled photo the planner can use (admitted, stored picture, classified as a vehicle
-- kind, not on an open review, no live non-vehicle verdict, not duplicate/superseded/sensitive/rejected) that was
-- classified after the day's last plan, or the day was never planned. Days already waiting in the queue or whose plan
-- waits on the gate are left out.
-- Each day is enqueued through capture_sets_enqueue with reason {read_after_scoring: run}. Dry by default; p_cap days.
-- Revert (before the drain takes them): capture_sets_rearm_read_after_scoring_revert_v1(user, run).
CREATE OR REPLACE FUNCTION public.capture_sets_rearm_read_after_scoring_v1(p_user uuid, p_run uuid,
  p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE r record; v_days jsonb := '[]'; n integer := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_sets_rearm_read_after_scoring_v1: user and run required'; END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN RAISE EXCEPTION 'capture_sets_rearm_read_after_scoring_v1: cap must be 1..50'; END IF;
  FOR r IN
    SELECT d.day, d.photos FROM (
      SELECT (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date AS day, count(*) AS photos,
             max(v.ai_processing_completed_at) AS read_at
      FROM vehicle_images v
      WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at IS NOT NULL
        AND public.capture_set_photo_admits(v.source, v.vehicle_id, v.exif_data)
        AND nullif(btrim(coalesce(v.image_url, '')), '') IS NOT NULL
        AND v.is_sensitive IS NOT TRUE AND v.is_duplicate IS NOT TRUE AND v.is_superseded IS NOT TRUE
        AND coalesce(v.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed', 'rejected')
        AND v.ai_processing_status = 'completed'
        AND coalesce(v.ai_scan_metadata ->> 'classifier_failed', 'false') <> 'true'
        AND coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') NOT IN ('', 'other', 'receipt_document')
        AND NOT EXISTS (SELECT 1 FROM capture_set_review rv WHERE rv.user_id = p_user AND rv.status = 'open' AND v.id = ANY (rv.image_ids))
        AND NOT EXISTS (SELECT 1 FROM capture_non_vehicle_log l WHERE l.user_id = p_user AND l.image_id = v.id AND l.reverted_at IS NULL)
      GROUP BY 1) d
    -- the day's last real plan (any non-dry chunk whose window covers the day: drain or forward tick)
    LEFT JOIN LATERAL (SELECT c.created_at AS at, c.state FROM capture_landing_chunks c
                       WHERE c.user_id = p_user AND NOT coalesce(c.dry, false)
                         AND c.t_from <= (d.day::timestamp AT TIME ZONE 'America/Los_Angeles')
                         AND c.t_to > (d.day::timestamp AT TIME ZONE 'America/Los_Angeles')
                       ORDER BY c.created_at DESC LIMIT 1) lp ON true
    WHERE (lp.at IS NULL OR d.read_at > lp.at)
      AND coalesce(lp.state, '') NOT IN ('planned', 'awaiting_gate')
      AND NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue q WHERE q.user_id = p_user AND q.day = d.day AND q.done_at IS NULL)
    ORDER BY d.day LIMIT p_cap
  LOOP
    v_days := v_days || jsonb_build_object('day', r.day, 'photos', r.photos);
    IF NOT p_dry THEN
      PERFORM capture_sets_enqueue(p_user, r.day, jsonb_build_object('read_after_scoring', p_run, 'photos', r.photos));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'days', v_days, 'enqueued', n);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_sets_rearm_read_after_scoring_revert_v1(p_user uuid, p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n integer := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_sets_rearm_read_after_scoring_revert_v1: user and run required'; END IF;
  -- Only rows still waiting whose latest reason is this run; a day the drain already planned is reverted with
  -- capture_sets_revert(run) for any filing and is otherwise left as planned.
  UPDATE capture_set_rescore_queue q
     SET done_at = now(), done_run_id = NULL,
         reasons = q.reasons || jsonb_build_array(jsonb_build_object('reverted', p_run, 'at', now()))
   WHERE q.user_id = p_user AND q.done_at IS NULL
     AND jsonb_path_query_first(q.reasons, '$[last]') ->> 'read_after_scoring' = p_run::text;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'reverted', n);
END
$function$;

-- 7. Re-derive capture_upload_status for the owner's phone uploads since p_since through the new
-- capture_upload_status_upsert (rows showing queued or failed only). The status table is derived; no photo row changes.
CREATE OR REPLACE FUNCTION public.capture_upload_status_resync_v1(p_user uuid, p_since timestamptz,
  p_dry boolean DEFAULT true, p_cap integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
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
$function$;

revoke all on function public.capture_vehicle_label_profile(uuid) from public, anon, authenticated;
revoke all on function public.capture_non_vehicle_auto_v1(uuid, uuid, uuid, boolean, integer, date, boolean) from public, anon, authenticated;
revoke all on function public.capture_sets_rearm_read_after_scoring_v1(uuid, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.capture_sets_rearm_read_after_scoring_revert_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.capture_upload_status_resync_v1(uuid, timestamptz, boolean, integer) from public, anon, authenticated;
grant execute on function public.capture_vehicle_label_profile(uuid) to service_role;
grant execute on function public.capture_non_vehicle_auto_v1(uuid, uuid, uuid, boolean, integer, date, boolean) to service_role;
grant execute on function public.capture_sets_rearm_read_after_scoring_v1(uuid, uuid, boolean, integer) to service_role;
grant execute on function public.capture_sets_rearm_read_after_scoring_revert_v1(uuid, uuid) to service_role;
grant execute on function public.capture_upload_status_resync_v1(uuid, timestamptz, boolean, integer) to service_role;

commit;
