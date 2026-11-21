-- retire_duplicate_vehicle_image: one sanctioned writer that retires a second copy of a photo row, one row at a time,
-- with an audit row (before-image, kept id, matched key, reason, run, actor) and a per-run revert.
--
-- Why. Two populations of copies have no sanctioned path (read-only garage pass, 2026-11-21; ids in the private run log):
--   A. one vehicle holds 504 listing image URLs imported 8 times each on 2026-02-04: 3,528 extra rows, every one a
--      same-vehicle row with the same image_url as its earliest row, all 3,528 gallery-eligible today (live read).
--   B. about 906 rows sit on the wrong vehicle while the same frame already sits on the right one; moving them would
--      duplicate the frame (attribute_testimony refuses file_hash_exists_on_target), so the wrong-profile copy is retired.
-- Nothing deletes or moves: the copy keeps its vehicle_id and gains the existing marker.
--
-- The marker is the one the live writers already use: is_duplicate = true, duplicate_of = the kept row
-- (capture_exact_copy_v1, flag_image_burst_duplicates, flag_cross_sweep_moment_duplicates, mark_duplicates_by_url_pattern;
-- attribute_image_session sets the flag alone when the hash already sits on the target). Live readers that honour it,
-- read 2026-11-21: vehicle_image_gallery_eligible (both overloads) and fetchVehicleImages (garage card reel and profile
-- gallery), get_first_image_batch (garage cover), vehicles.image_count through update_vehicle_image_count (fires on
-- UPDATE OF is_duplicate), vehicles.primary_image_url through sync_vehicle_primary_image -> recompute_vehicle_primary_image,
-- get_vehicle_contribution_days_batch, get_vehicle_day_depth, compute_vehicle_activity. Not honoured (follow-ups, outside
-- the garage reel/count/cover): vehicle_card_images (organisation inventory cards), get_image_bundles_for_vehicle (legacy
-- gallery bundles, which ignore every marker), get_user_garage's owner-only fallback cover when primary_image_url is null.
-- So no reader changes here.
--
-- Same picture, proven by a hard key only: the same non-empty file_hash (neither row on vehicle_image_byte_mismatches),
-- the same non-empty image_url, or a shared Apple asset id in exif_data (ssd_uuid, uuid, original_uuid, photos_uuid;
-- the leading 36-character id, compared upper-case). A capture second alone, at any source offset, is refused.
--
-- Derived values: image_count and the cover follow from the existing triggers on is_duplicate. vehicle_activity's
-- update trigger only bumps forward, so the writer recomputes it (compute_vehicle_activity) when the copy could have
-- counted (filed, with a user and a capture time). The revert does the same.
-- Known limit: trg_withdraw_reviewed_image_analysis withdraws a reviewed_image_analysis_v1 reading on a row that becomes
-- a duplicate and strips its byok_deep_analysis; the revert does not re-add it (the before-image keeps ai_scan_metadata).
--
-- The audit store is the existing exact-copy revert log (capture_exact_copy_log, 20261113120500, keyed by run and
-- image; same question: which photo was marked a duplicate of which). It gains the columns this writer needs; its two
-- NOT NULLs (user_id, file_hash) are dropped because listing rows have neither. Existing rows read writer
-- 'capture_exact_copy_v1'. capture_exact_copy_revert_v1 run on one of these run ids would also restore the marker.
--
-- Service role only. Contract: supabase/sql/test_retire_duplicate_vehicle_image.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.capture_exact_copy_log') IS NULL
     OR to_regprocedure('public.compute_vehicle_activity(uuid)') IS NULL
     OR to_regprocedure('public.vehicle_image_holds_wrong_bytes(uuid)') IS NULL THEN
    RAISE EXCEPTION 'retire_duplicate_vehicle_image: capture_exact_copy_log, compute_vehicle_activity(uuid) or vehicle_image_holds_wrong_bytes(uuid) is missing';
  END IF;
  -- the log's shape as read 2026-11-21 (run_id, image_id, original_id, user_id, file_hash, prior, signature, created_at, reverted_at)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'capture_exact_copy_log'
        AND column_name IN ('run_id', 'image_id', 'original_id', 'user_id', 'file_hash', 'prior', 'signature', 'created_at', 'reverted_at')) <> 9 THEN
    RAISE EXCEPTION 'retire_duplicate_vehicle_image: capture_exact_copy_log drifted from the shape read 2026-11-21';
  END IF;
END $guard$;

ALTER TABLE public.capture_exact_copy_log
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN file_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS writer text NOT NULL DEFAULT 'capture_exact_copy_v1',
  ADD COLUMN IF NOT EXISTS vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS kept_vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS matched_on text,
  ADD COLUMN IF NOT EXISTS match_value text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS actor uuid,
  ADD COLUMN IF NOT EXISTS before_image jsonb,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS revert_note text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capture_exact_copy_log_retire_fields'
                   AND conrelid = 'public.capture_exact_copy_log'::regclass) THEN
    ALTER TABLE public.capture_exact_copy_log ADD CONSTRAINT capture_exact_copy_log_retire_fields CHECK (
      writer = 'capture_exact_copy_v1'
      OR (writer = 'retire_duplicate_vehicle_image'
          AND matched_on IS NOT NULL AND matched_on IN ('file_hash', 'image_url', 'asset_uuid') AND match_value IS NOT NULL
          AND reason IS NOT NULL AND btrim(reason) <> '' AND actor IS NOT NULL AND before_image IS NOT NULL));
  END IF;
END $c$;

COMMENT ON TABLE public.capture_exact_copy_log IS
  'Revert log of photo rows marked is_duplicate of another row, one row per (run, photo). Writers: capture_exact_copy_v1 '
  '(unfiled byte-identical copies; revert capture_exact_copy_revert_v1) and retire_duplicate_vehicle_image (a second copy '
  'proven by file_hash, image_url or asset id; before_image = the row as it was; revert revert_duplicate_image_run). '
  'Holds no reading.';

-- The asset ids a row carries (upper-case, leading 36-character id only).
CREATE OR REPLACE FUNCTION public.vehicle_image_asset_ids(p_exif jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT upper(m[1])), '{}'::text[])
  FROM unnest(CASE WHEN jsonb_typeof(p_exif) = 'object'
                   THEN ARRAY[p_exif->>'ssd_uuid', p_exif->>'uuid', p_exif->>'original_uuid', p_exif->>'photos_uuid']
                   ELSE '{}'::text[] END) AS x(v)
  CROSS JOIN LATERAL regexp_match(x.v, '^([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})') AS m
  WHERE upper(m[1]) <> '00000000-0000-0000-0000-000000000000'
$function$;

CREATE OR REPLACE FUNCTION public.retire_duplicate_vehicle_image(p_image_id uuid, p_duplicate_of uuid, p_reason text,
  p_run_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c public.vehicle_images%ROWTYPE;
  k public.vehicle_images%ROWTYPE;
  v_on text;
  v_val text;
  v_activity boolean := false;
BEGIN
  IF p_image_id IS NULL OR p_duplicate_of IS NULL OR p_run_id IS NULL OR p_actor IS NULL OR nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'retire_duplicate_vehicle_image: image, kept image, reason, run and actor are required' USING ERRCODE = '22004';
  END IF;
  IF p_image_id = p_duplicate_of THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'same_row', 'image_id', p_image_id);
  END IF;

  -- both rows by primary key, locked in id order
  PERFORM 1 FROM public.vehicle_images WHERE id IN (p_image_id, p_duplicate_of) ORDER BY id FOR UPDATE;
  SELECT * INTO c FROM public.vehicle_images WHERE id = p_image_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'copy_not_found', 'image_id', p_image_id);
  END IF;
  SELECT * INTO k FROM public.vehicle_images WHERE id = p_duplicate_of;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'kept_not_found', 'image_id', p_image_id, 'duplicate_of', p_duplicate_of);
  END IF;

  IF EXISTS (SELECT 1 FROM public.capture_exact_copy_log l WHERE l.run_id = p_run_id AND l.image_id = p_image_id) THEN
    RETURN jsonb_build_object('status', 'already_in_run', 'image_id', p_image_id, 'run_id', p_run_id);
  END IF;
  IF coalesce(c.is_duplicate, false) OR coalesce(c.is_superseded, false) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'copy_already_retired', 'image_id', p_image_id,
      'is_duplicate', c.is_duplicate, 'duplicate_of', c.duplicate_of, 'is_superseded', c.is_superseded);
  END IF;
  IF coalesce(k.is_duplicate, false) OR coalesce(k.is_superseded, false) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'kept_is_retired', 'image_id', p_image_id, 'duplicate_of', p_duplicate_of);
  END IF;
  IF k.vehicle_id IS NULL THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'kept_not_filed', 'image_id', p_image_id, 'duplicate_of', p_duplicate_of);
  END IF;
  IF public.vehicle_image_holds_wrong_bytes(c.id) OR public.vehicle_image_holds_wrong_bytes(k.id) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'holds_wrong_bytes', 'image_id', p_image_id, 'duplicate_of', p_duplicate_of);
  END IF;

  -- the hard key: same bytes, same stored picture, or the same camera-roll asset
  IF nullif(btrim(c.file_hash), '') IS NOT NULL AND c.file_hash = k.file_hash THEN
    v_on := 'file_hash'; v_val := c.file_hash;
  ELSIF nullif(btrim(c.image_url), '') IS NOT NULL AND c.image_url = k.image_url THEN
    v_on := 'image_url'; v_val := c.image_url;
  ELSE
    SELECT min(a) INTO v_val
    FROM unnest(public.vehicle_image_asset_ids(c.exif_data)) a
    WHERE a = ANY (public.vehicle_image_asset_ids(k.exif_data));
    IF v_val IS NOT NULL THEN v_on := 'asset_uuid'; END IF;
  END IF;
  IF v_on IS NULL THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'no_hard_key', 'image_id', p_image_id, 'duplicate_of', p_duplicate_of);
  END IF;

  INSERT INTO public.capture_exact_copy_log (run_id, image_id, original_id, user_id, file_hash, prior, signature, writer,
    vehicle_id, kept_vehicle_id, matched_on, match_value, reason, actor, before_image)
  VALUES (p_run_id, c.id, k.id, c.user_id, c.file_hash,
    jsonb_build_object('is_duplicate', c.is_duplicate, 'duplicate_of', c.duplicate_of, 'is_primary', c.is_primary),
    encode(sha256(convert_to(concat_ws('|', 'retire_duplicate_vehicle_image', p_run_id, c.id, k.id, v_on, v_val), 'UTF8')), 'hex'),
    'retire_duplicate_vehicle_image', c.vehicle_id, k.vehicle_id, v_on, v_val, p_reason, p_actor, to_jsonb(c));

  UPDATE public.vehicle_images
     SET is_duplicate = true, duplicate_of = k.id, is_primary = false, updated_at = now()
   WHERE id = c.id;

  IF c.vehicle_id IS NOT NULL AND c.user_id IS NOT NULL AND c.taken_at IS NOT NULL THEN
    PERFORM public.compute_vehicle_activity(c.vehicle_id);
    v_activity := true;
  END IF;

  RETURN jsonb_build_object('status', 'retired', 'image_id', c.id, 'duplicate_of', k.id, 'vehicle_id', c.vehicle_id,
    'kept_vehicle_id', k.vehicle_id, 'matched_on', v_on, 'was_primary', coalesce(c.is_primary, false),
    'activity_recomputed', v_activity, 'run_id', p_run_id);
END $function$;

-- Undo one run, p_limit rows per call (each row recounts its vehicle's photos); call again while 'remaining' > 0.
-- A row restores only if it still carries this run's marker; otherwise it is left as it is and the log says so.
CREATE OR REPLACE FUNCTION public.revert_duplicate_image_run(p_run_id uuid, p_actor uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  l record;
  v record;
  n_restored int := 0;
  n_changed int := 0;
  n_left int;
  vehicles uuid[] := '{}';
  vid uuid;
BEGIN
  IF p_run_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'revert_duplicate_image_run: run and actor are required' USING ERRCODE = '22004';
  END IF;
  FOR l IN
    SELECT * FROM public.capture_exact_copy_log
    WHERE run_id = p_run_id AND writer = 'retire_duplicate_vehicle_image' AND reverted_at IS NULL
    ORDER BY image_id
    LIMIT greatest(coalesce(p_limit, 200), 1)
    FOR UPDATE
  LOOP
    UPDATE public.vehicle_images vi
       SET is_duplicate = (l.prior->>'is_duplicate')::boolean,
           duplicate_of = (l.prior->>'duplicate_of')::uuid,
           updated_at = now()
     WHERE vi.id = l.image_id AND vi.is_duplicate IS TRUE AND vi.duplicate_of = l.original_id
    RETURNING vi.vehicle_id, vi.user_id, vi.taken_at INTO v;
    IF FOUND THEN
      n_restored := n_restored + 1;
      -- the cover flag comes back only when no other photo on that vehicle took it meanwhile
      IF (l.prior->>'is_primary')::boolean IS TRUE AND v.vehicle_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.vehicle_images o WHERE o.vehicle_id = v.vehicle_id AND o.is_primary AND o.id <> l.image_id) THEN
        UPDATE public.vehicle_images SET is_primary = true WHERE id = l.image_id;
      END IF;
      IF v.vehicle_id IS NOT NULL AND v.user_id IS NOT NULL AND v.taken_at IS NOT NULL AND NOT (v.vehicle_id = ANY (vehicles)) THEN
        vehicles := vehicles || v.vehicle_id;
      END IF;
      UPDATE public.capture_exact_copy_log SET reverted_at = now(), reverted_by = p_actor
       WHERE run_id = l.run_id AND image_id = l.image_id;
    ELSE
      n_changed := n_changed + 1;
      UPDATE public.capture_exact_copy_log SET reverted_at = now(), reverted_by = p_actor,
             revert_note = 'row no longer carried this run''s marker; left as it was'
       WHERE run_id = l.run_id AND image_id = l.image_id;
    END IF;
  END LOOP;
  FOREACH vid IN ARRAY vehicles LOOP
    PERFORM public.compute_vehicle_activity(vid);
  END LOOP;
  SELECT count(*) INTO n_left FROM public.capture_exact_copy_log
   WHERE run_id = p_run_id AND writer = 'retire_duplicate_vehicle_image' AND reverted_at IS NULL;
  RETURN jsonb_build_object('run_id', p_run_id, 'restored', n_restored, 'left_as_changed', n_changed, 'remaining', n_left);
END $function$;

COMMENT ON FUNCTION public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid) IS
  'Marks p_image_id is_duplicate of p_duplicate_of when a hard key (file_hash, image_url, asset id) proves the same picture; '
  'one capture_exact_copy_log row with the before-image; refusals return status refused with a reason. Service role only.';
COMMENT ON FUNCTION public.revert_duplicate_image_run(uuid, uuid, integer) IS
  'Undoes one retire_duplicate_vehicle_image run, p_limit rows per call; returns restored, left_as_changed and remaining.';

REVOKE ALL ON FUNCTION public.vehicle_image_asset_ids(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_duplicate_image_run(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_image_asset_ids(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.retire_duplicate_vehicle_image(uuid, uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_duplicate_image_run(uuid, uuid, integer) TO service_role;

COMMIT;
