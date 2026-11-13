-- 20261115192000 capture_import_session_admit
-- Admit user_upload rows that sit in an import session with a clocked or filed
-- neighbour, without writing DateTimeOriginal or taken_at. Clocks of other files
-- never become theirs. The admit flag is import_session_admit in exif_data so
-- the existing capture_set_photo_admits predicate (and every caller) can see it
-- without a signature change. A signed log holds the prior exif for revert.
-- Dry-default, cap 50, granted_by required. Excludes empty image_url (276) and
-- capture_privacy_promote_exclude (452). After a write, arms each affected day
-- via capture_sets_enqueue. Does not call capture_landing_gate_check, does not file.
-- Session window: created_at within 15 minutes of a same-user neighbour that
-- has DateTimeOriginal or is already filed.
-- Revert: capture_import_session_admit_revert_v1 then
-- supabase/sql/revert_20261115192000_capture_import_session_admit.sql

CREATE TABLE IF NOT EXISTS public.capture_privacy_promote_exclude (
  image_id uuid PRIMARY KEY,
  reason text NOT NULL DEFAULT 'privacy_backup_union',
  granted_by uuid,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capture_session_admit_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  prior_exif jsonb,
  neighbor_id uuid,
  neighbor_kind text,
  day date,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);

CREATE INDEX IF NOT EXISTS capture_session_admit_log_image_idx
  ON public.capture_session_admit_log (image_id, applied_at DESC);

REVOKE ALL ON public.capture_session_admit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_session_admit_log TO service_role;

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

CREATE OR REPLACE FUNCTION public.capture_import_session_admit_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_elig int := 0;
  n_take int := 0;
  v_items jsonb := '[]';
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_import_session_admit_v1: user, run and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_import_session_admit_v1: cap must be 1..50';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_import_session_admit'));
  v_sig := 'capture_import_session_admit_v1/' || p_run::text;

  CREATE TEMP TABLE IF NOT EXISTS _sa_elig (
    image_id uuid PRIMARY KEY,
    prior_exif jsonb,
    neighbor_id uuid,
    neighbor_kind text,
    day date
  ) ON COMMIT DROP;
  TRUNCATE _sa_elig;

  INSERT INTO _sa_elig (image_id, prior_exif, neighbor_id, neighbor_kind, day)
  SELECT vi.id, vi.exif_data, n.neighbor_id, n.neighbor_kind,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE 'America/Los_Angeles')::date
  FROM public.vehicle_images vi
  CROSS JOIN LATERAL (
    SELECT n.id AS neighbor_id,
           CASE WHEN n.exif_data ? 'DateTimeOriginal' THEN 'clocked' ELSE 'filed' END AS neighbor_kind
    FROM public.vehicle_images n
    WHERE n.user_id = p_user
      AND n.id <> vi.id
      AND n.created_at BETWEEN vi.created_at - interval '15 minutes' AND vi.created_at + interval '15 minutes'
      AND (n.exif_data ? 'DateTimeOriginal' OR n.vehicle_id IS NOT NULL)
    ORDER BY n.created_at
    LIMIT 1
  ) n
  WHERE vi.user_id = p_user
    AND vi.source = 'user_upload'
    AND vi.vehicle_id IS NULL
    AND coalesce(vi.is_sensitive, false) IS NOT TRUE
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND NOT coalesce(vi.exif_data ? 'DateTimeOriginal', false)
    AND NOT coalesce((vi.exif_data->>'import_session_admit')::boolean, false)
    AND NOT EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
  ORDER BY vi.created_at, vi.id
  LIMIT p_cap;

  GET DIAGNOSTICS n_take = ROW_COUNT;
  SELECT count(*) INTO n_elig FROM public.vehicle_images vi
  WHERE vi.user_id = p_user
    AND vi.source = 'user_upload'
    AND vi.vehicle_id IS NULL
    AND coalesce(vi.is_sensitive, false) IS NOT TRUE
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND NOT coalesce(vi.exif_data ? 'DateTimeOriginal', false)
    AND NOT coalesce((vi.exif_data->>'import_session_admit')::boolean, false)
    AND NOT EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id)
    AND coalesce(vi.vision_gate_status::text, '') NOT IN ('rejected_personal', 'rejected_misattributed')
    AND EXISTS (
      SELECT 1 FROM public.vehicle_images n
      WHERE n.user_id = p_user AND n.id <> vi.id
        AND n.created_at BETWEEN vi.created_at - interval '15 minutes' AND vi.created_at + interval '15 minutes'
        AND (n.exif_data ? 'DateTimeOriginal' OR n.vehicle_id IS NOT NULL));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'image_id', image_id, 'neighbor_id', neighbor_id, 'neighbor_kind', neighbor_kind, 'day', day
         ) ORDER BY image_id), '[]'::jsonb)
    INTO v_items FROM _sa_elig;

  IF NOT p_dry THEN
    INSERT INTO public.capture_session_admit_log(run_id, image_id, user_id, granted_by, prior_exif, neighbor_id, neighbor_kind, day, signature)
    SELECT p_run, image_id, p_user, p_granted_by, prior_exif, neighbor_id, neighbor_kind, day, v_sig
    FROM _sa_elig
    ON CONFLICT (run_id, image_id) DO NOTHING;

    UPDATE public.vehicle_images vi
       SET exif_data = coalesce(vi.exif_data, '{}'::jsonb) || jsonb_build_object('import_session_admit', true)
    FROM _sa_elig e
    WHERE vi.id = e.image_id AND vi.user_id = p_user
      AND vi.taken_at IS NOT DISTINCT FROM vi.taken_at -- no-op guard kept for readability
      AND NOT coalesce((vi.exif_data->>'import_session_admit')::boolean, false);

    -- taken_at and DateTimeOriginal must be unchanged; the UPDATE only adds the flag.
    IF to_regprocedure('public.capture_sets_enqueue(uuid,date,jsonb)') IS NOT NULL THEN
      PERFORM public.capture_sets_enqueue(p_user, d, jsonb_build_object('session_admit', p_run))
      FROM (SELECT DISTINCT day d FROM _sa_elig WHERE day IS NOT NULL) q;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'run_id', p_run, 'dry', p_dry, 'cap', p_cap, 'granted_by', p_granted_by, 'signature', v_sig,
    'eligible', n_elig, 'taken', n_take, 'items', v_items);
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_import_session_admit_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_import_session_admit_revert_v1: user and run required';
  END IF;
  UPDATE public.vehicle_images vi
     SET exif_data = CASE
           WHEN l.prior_exif IS NULL THEN vi.exif_data - 'import_session_admit'
           ELSE l.prior_exif
         END
    FROM public.capture_session_admit_log l
   WHERE l.run_id = p_run AND l.user_id = p_user AND l.reverted_at IS NULL
     AND vi.id = l.image_id AND vi.user_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.capture_session_admit_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  RETURN jsonb_build_object('run_id', p_run, 'reverted', n);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_import_session_admit_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_import_session_admit_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_import_session_admit_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_import_session_admit_revert_v1(uuid, uuid) TO service_role;
