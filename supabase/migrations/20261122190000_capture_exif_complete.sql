-- Camera fields and the handset session onto the photo row, from the file the system already stores.
--
-- Why. The landing scorer has little evidence on backfilled history partly because the camera's own account of a photo
-- is in the stored file but not in vehicle_images.exif_data: about 24,700 of the owner's photos carry make, model,
-- lens, software and Apple's RunTime (uptime since boot) in the file only. derive-image-exif only picked rows with a
-- null taken_at, so a row that already had a clock was never completed.
--
-- Change: capture_exif_complete_v1(user, run, granted_by, items, dry) takes what derive-image-exif (mode "complete")
-- read from each file and adds it to the row's existing exif_data column. Only these keys: Make, Model, Software,
-- LensMake, LensModel, ContentIdentifier, BurstUUID, RunTimeFlags, RunTimeValue, RunTimeEpoch, RunTimeScale and
-- capture_session ({anchor_at, uptime_s, basis}: the file's capture clock minus the phone's uptime; RunTime pauses
-- while the phone sleeps, so within one boot the uptime only grows and a reboot resets it). A key the row already has is never overwritten. taken_at, DateTimeOriginal, offsets, capture_clock and
-- any GPS key are never written (admission and capture clocks are other producers' work). Every row it examines gets
-- exif_data.exif_completeness = {run, granted_by, at, keys, signature}, so a row is examined once and a run can be
-- reverted. Skipped, never written: another owner's row, a row without a stored picture (empty image_url, the privacy
-- holds), privacy-excluded ids, sensitive rows and rows rejected as personal. Dry by default; at most 50 items a call.
-- No new table, no new column: the fields go to the existing exif_data column.
-- Revert a run: capture_exif_complete_revert_v1(user, run) removes exactly the keys that run added and its marker.
-- Contract: supabase/sql/test_capture_exif_complete.sql
-- Revert of this file: supabase/sql/revert_20261122190000_capture_exif_complete.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.capture_exif_complete_v1(p_user uuid, p_run uuid, p_granted_by uuid, p_items jsonb,
  p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_allowed constant text[] := ARRAY['Make','Model','Software','LensMake','LensModel','ContentIdentifier','BurstUUID',
                                     'RunTimeFlags','RunTimeValue','RunTimeEpoch','RunTimeScale','capture_session'];
  it jsonb; v_id uuid; v_row record; v_add jsonb; v_keys text[]; k text; v jsonb;
  n_written int := 0; n_examined_only int := 0; v_skip jsonb := '{}'; v_keycount jsonb := '{}'; v_reason text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_exif_complete_v1: user and run required'; END IF;
  IF NOT p_dry AND p_granted_by IS NULL THEN RAISE EXCEPTION 'capture_exif_complete_v1: granted_by required for a live run'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'capture_exif_complete_v1: items must be an array of at most 50';
  END IF;
  FOR it IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    v_reason := NULL; v_id := NULL;
    BEGIN v_id := (it ->> 'image_id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
    SELECT vi.id, vi.user_id, vi.image_url, vi.exif_data, vi.is_sensitive, vi.vision_gate_status::text AS gate
      INTO v_row FROM vehicle_images vi WHERE vi.id = v_id;
    IF v_id IS NULL OR v_row.id IS NULL THEN v_reason := 'no_such_photo';
    ELSIF v_row.user_id IS DISTINCT FROM p_user THEN v_reason := 'other_owner';
    ELSIF nullif(btrim(coalesce(v_row.image_url, '')), '') IS NULL THEN v_reason := 'no_stored_picture';
    ELSIF EXISTS (SELECT 1 FROM capture_privacy_promote_exclude e WHERE e.image_id = v_id) THEN v_reason := 'privacy_excluded';
    ELSIF coalesce(v_row.is_sensitive, false) OR v_row.gate = 'rejected_personal' THEN v_reason := 'private';
    ELSIF coalesce(v_row.exif_data, '{}'::jsonb) ? 'exif_completeness' THEN v_reason := 'already_examined';
    ELSIF jsonb_typeof(coalesce(it -> 'fields', '{}'::jsonb)) <> 'object' THEN v_reason := 'bad_fields';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_skip := jsonb_set(v_skip, ARRAY[v_reason], to_jsonb(coalesce((v_skip ->> v_reason)::int, 0) + 1));
      CONTINUE;
    END IF;
    v_add := '{}'; v_keys := '{}';
    FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(it -> 'fields', '{}'::jsonb)) LOOP
      CONTINUE WHEN NOT k = ANY (v_allowed) OR coalesce(v_row.exif_data, '{}'::jsonb) ? k;
      CONTINUE WHEN k = 'capture_session' AND (jsonb_typeof(v) <> 'object' OR (v ->> 'anchor_at') IS NULL
                                              OR (v - 'anchor_at' - 'uptime_s' - 'basis') <> '{}'::jsonb);
      CONTINUE WHEN k <> 'capture_session' AND (jsonb_typeof(v) NOT IN ('string', 'number') OR length(v #>> '{}') > 200);
      v_add := v_add || jsonb_build_object(k, v);
      v_keys := v_keys || k;
      v_keycount := jsonb_set(v_keycount, ARRAY[k], to_jsonb(coalesce((v_keycount ->> k)::int, 0) + 1));
    END LOOP;
    IF cardinality(v_keys) > 0 THEN n_written := n_written + 1; ELSE n_examined_only := n_examined_only + 1; END IF;
    IF NOT p_dry THEN
      UPDATE vehicle_images SET exif_data = coalesce(exif_data, '{}'::jsonb) || v_add
             || jsonb_build_object('exif_completeness', jsonb_build_object('run', p_run, 'granted_by', p_granted_by, 'at', now(),
                  'keys', to_jsonb(v_keys), 'was_null', exif_data IS NULL, 'signature', 'capture_exif_complete_v1/' || p_run))
       WHERE id = v_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'items', jsonb_array_length(p_items), 'with_new_keys', n_written,
                            'examined_nothing_new', n_examined_only, 'skipped', v_skip, 'keys_added', v_keycount);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_exif_complete_revert_v1(p_user uuid, p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN RAISE EXCEPTION 'capture_exif_complete_revert_v1: user and run required'; END IF;
  UPDATE vehicle_images vi
     SET exif_data = CASE WHEN vi.exif_data #>> '{exif_completeness,was_null}' = 'true'
                               AND (vi.exif_data - ARRAY(SELECT jsonb_array_elements_text(vi.exif_data #> '{exif_completeness,keys}'))) - 'exif_completeness' = '{}'::jsonb
                          THEN NULL
                          ELSE (vi.exif_data - ARRAY(SELECT jsonb_array_elements_text(vi.exif_data #> '{exif_completeness,keys}'))) - 'exif_completeness' END
   WHERE vi.user_id = p_user AND vi.exif_data #>> '{exif_completeness,run}' = p_run::text;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'reverted', n);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_exif_complete_v1(uuid, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_exif_complete_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_exif_complete_v1(uuid, uuid, uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_exif_complete_revert_v1(uuid, uuid) TO service_role;

commit;
