-- 20261115191000 capture_non_vehicle_reviewed
-- Reviewed non-vehicle terminal ledger state. typ=other / receipt_document is
-- not enough; each frame needs a second look. Confirmed non-vehicle documents
-- or scenes go to ledger state `non_vehicle` (not on a vehicle, not private).
-- Already-classified personal (is_sensitive) is routed to privacy_promote_v1.
-- A personal judgment that is only the reviewer's goes to the log, not private.
-- A frame that is actually a vehicle photo is enqueued for planning.
-- Excludes empty image_url (276) and capture_privacy_promote_exclude (452).
-- Dry-default, cap 50, backup in capture_non_vehicle_log, revert-by-run,
-- granted_by required. Does not write DTO, taken_at, image_url, or file bytes.
-- Does not call capture_landing_gate_check.
-- Ledger functions include the 20261115190000 timeout fix (MATERIALIZED CTEs
-- and force_custom_plan) plus the new state.
-- Revert: supabase/sql/revert_20261115191000_capture_non_vehicle_reviewed.sql

CREATE TABLE IF NOT EXISTS public.capture_privacy_promote_exclude (
  image_id uuid PRIMARY KEY,
  reason text NOT NULL DEFAULT 'privacy_backup_union',
  granted_by uuid,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capture_non_vehicle_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  typ text,
  verdict text NOT NULL,
  reason text NOT NULL,
  day date,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);

CREATE INDEX IF NOT EXISTS capture_non_vehicle_log_live_idx
  ON public.capture_non_vehicle_log (user_id, image_id)
  WHERE reverted_at IS NULL;

REVOKE ALL ON public.capture_non_vehicle_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_non_vehicle_log TO service_role;

CREATE OR REPLACE FUNCTION public.capture_ledger_states(p_uid uuid, p_tz text, p_from date, p_to date)
 RETURNS TABLE(image_id uuid, day date, state text, reason text, vehicle_id uuid, set_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  WITH held AS MATERIALIZED (
    SELECT DISTINCT ON (x.image_id) x.image_id, r.reason, r.set_key
    FROM public.capture_set_review r CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    WHERE r.user_id = p_uid AND r.status = 'open'
    ORDER BY x.image_id, r.created_at DESC
  ), waiting AS MATERIALIZED (
    SELECT DISTINCT x.image_id
    FROM public.capture_landing_chunks c
    JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
    CROSS JOIN LATERAL unnest(s.image_ids) AS x(image_id)
    WHERE c.user_id = p_uid AND c.state = 'awaiting_gate'
  ), failed AS MATERIALIZED (
    SELECT u.image_id, u.error_class FROM public.capture_upload_status u WHERE u.user_id = p_uid AND u.stage = 'failed'
  ), non_vehicle AS MATERIALIZED (
    SELECT l.image_id, l.reason
    FROM public.capture_non_vehicle_log l
    WHERE l.user_id = p_uid AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle'
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log l2
        WHERE l2.image_id = l.image_id AND l2.reverted_at IS NULL AND l2.verdict = 'non_vehicle' AND l2.applied_at > l.applied_at
      )
  ), dupmap AS MATERIALIZED (
    -- scoped to this user's unfiled duplicates; joining vehicle_images directly in the main query
    -- made the live ledger hit statement_timeout (2026-11-09)
    SELECT c.id AS image_id, d.id, d.vehicle_id,
           CASE
             WHEN d.vision_gate_status::text = 'rejected_personal' THEN 'copy_of_private'
             WHEN d.vision_gate_status::text = 'rejected_misattributed' THEN 'copy_of_pulled'
             WHEN d.vehicle_id IS NOT NULL THEN 'copy_of_filed'
             WHEN h_orig.image_id IS NOT NULL THEN 'copy_of_held'
           END AS reason
    FROM public.vehicle_images c
    JOIN public.vehicle_images d ON d.id = c.duplicate_of
    LEFT JOIN held h_orig ON h_orig.image_id = d.id
    WHERE c.user_id = p_uid AND c.vehicle_id IS NULL AND c.is_duplicate IS TRUE AND c.duplicate_of IS NOT NULL
      AND (
        d.vehicle_id IS NOT NULL
        OR d.vision_gate_status::text IN ('rejected_personal', 'rejected_misattributed')
        OR h_orig.image_id IS NOT NULL
      )
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN nv.image_id IS NOT NULL THEN 'non_vehicle'
           WHEN dup.id IS NOT NULL THEN 'duplicate'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN nv.image_id IS NOT NULL THEN COALESCE(nv.reason, 'reviewed_non_vehicle')
           WHEN dup.id IS NOT NULL THEN COALESCE(dup.reason, 'copy_of_filed')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         COALESCE(vi.vehicle_id, dup.vehicle_id),
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN non_vehicle nv ON nv.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  -- 20261113120500 / 20261115180000: a byte-identical copy of a filed, held, private, or pulled photo is a duplicate; a missing original is not
  LEFT JOIN dupmap dup ON dup.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$function$;

CREATE OR REPLACE FUNCTION public.capture_ledger_frames(p_uid uuid, p_tz text, p_from date, p_to date)
 RETURNS TABLE(image_id uuid, day date, taken_at timestamp with time zone, state text, reason text, vehicle_id uuid, source text, file_name text, thumb text, asset_id text, set_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  WITH held AS MATERIALIZED (
    SELECT DISTINCT ON (x.image_id) x.image_id, r.reason, r.set_key
    FROM public.capture_set_review r CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    WHERE r.user_id = p_uid AND r.status = 'open'
    ORDER BY x.image_id, r.created_at DESC
  ), waiting AS MATERIALIZED (
    SELECT DISTINCT x.image_id
    FROM public.capture_landing_chunks c
    JOIN public.capture_landing_sets s ON s.chunk_id = c.id AND s.decision = 'clear'
    CROSS JOIN LATERAL unnest(s.image_ids) AS x(image_id)
    WHERE c.user_id = p_uid AND c.state = 'awaiting_gate'
  ), failed AS MATERIALIZED (
    SELECT u.image_id, u.error_class FROM public.capture_upload_status u WHERE u.user_id = p_uid AND u.stage = 'failed'
  ), non_vehicle AS MATERIALIZED (
    SELECT l.image_id, l.reason
    FROM public.capture_non_vehicle_log l
    WHERE l.user_id = p_uid AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle'
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log l2
        WHERE l2.image_id = l.image_id AND l2.reverted_at IS NULL AND l2.verdict = 'non_vehicle' AND l2.applied_at > l.applied_at
      )
  ), dupmap AS MATERIALIZED (
    -- scoped to this user's unfiled duplicates; joining vehicle_images directly in the main query
    -- made the live ledger hit statement_timeout (2026-11-09)
    SELECT c.id AS image_id, d.id, d.vehicle_id,
           CASE
             WHEN d.vision_gate_status::text = 'rejected_personal' THEN 'copy_of_private'
             WHEN d.vision_gate_status::text = 'rejected_misattributed' THEN 'copy_of_pulled'
             WHEN d.vehicle_id IS NOT NULL THEN 'copy_of_filed'
             WHEN h_orig.image_id IS NOT NULL THEN 'copy_of_held'
           END AS reason
    FROM public.vehicle_images c
    JOIN public.vehicle_images d ON d.id = c.duplicate_of
    LEFT JOIN held h_orig ON h_orig.image_id = d.id
    WHERE c.user_id = p_uid AND c.vehicle_id IS NULL AND c.is_duplicate IS TRUE AND c.duplicate_of IS NOT NULL
      AND (
        d.vehicle_id IS NOT NULL
        OR d.vision_gate_status::text IN ('rejected_personal', 'rejected_misattributed')
        OR h_orig.image_id IS NOT NULL
      )
  )
  SELECT vi.id,
         (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE p_tz)::date,
         COALESCE(vi.taken_at, vi.created_at),
         CASE
           WHEN vi.vision_gate_status::text = 'rejected_personal' THEN 'private'
           WHEN vi.vision_gate_status::text = 'rejected_misattributed' THEN 'pulled'
           WHEN vi.vehicle_id IS NOT NULL AND vi.vision_gate_status::text = 'approved' THEN 'on_vehicle'
           WHEN vi.vehicle_id IS NOT NULL THEN 'unverified'
           WHEN nv.image_id IS NOT NULL THEN 'non_vehicle'
           WHEN dup.id IS NOT NULL THEN 'duplicate'
           WHEN f.image_id IS NOT NULL THEN 'failed'
           WHEN w.image_id IS NOT NULL THEN 'waiting'
           WHEN h.image_id IS NOT NULL THEN 'held'
           ELSE 'unsorted'
         END,
         CASE
           WHEN vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed') THEN vi.vision_gate_status::text
           WHEN vi.vehicle_id IS NOT NULL THEN COALESCE(vi.vision_gate_status::text, 'ungated')
           WHEN nv.image_id IS NOT NULL THEN COALESCE(nv.reason, 'reviewed_non_vehicle')
           WHEN dup.id IS NOT NULL THEN COALESCE(dup.reason, 'copy_of_filed')
           WHEN f.image_id IS NOT NULL THEN COALESCE(f.error_class, 'failed')
           WHEN w.image_id IS NOT NULL THEN 'awaiting_gate'
           WHEN h.image_id IS NOT NULL THEN COALESCE(h.reason, 'held')
           ELSE 'not_scored'
         END,
         COALESCE(vi.vehicle_id, dup.vehicle_id), vi.source, vi.file_name,
         CASE WHEN vi.vision_gate_status::text = 'rejected_personal' THEN NULL ELSE COALESCE(vi.thumbnail_url, vi.image_url) END,
         vi.exif_data->>'uuid',
         h.set_key
  FROM public.vehicle_images vi
  LEFT JOIN held h ON h.image_id = vi.id
  LEFT JOIN non_vehicle nv ON nv.image_id = vi.id
  LEFT JOIN waiting w ON w.image_id = vi.id
  LEFT JOIN failed f ON f.image_id = vi.id
  -- 20261113120500 / 20261115180000: a byte-identical copy of a filed, held, private, or pulled photo is a duplicate; a missing original is not
  LEFT JOIN dupmap dup ON dup.image_id = vi.id
  WHERE vi.user_id = p_uid
    AND COALESCE(vi.taken_at, vi.created_at) >= COALESCE(p_from::timestamp AT TIME ZONE p_tz, '-infinity'::timestamptz)
    AND COALESCE(vi.taken_at, vi.created_at) < COALESCE((p_to + 1)::timestamp AT TIME ZONE p_tz, 'infinity'::timestamptz)
$function$;

CREATE OR REPLACE FUNCTION public.capture_non_vehicle_review_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_items jsonb, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_take int := 0;
  n_non int := 0;
  n_priv int := 0;
  n_judg int := 0;
  n_veh int := 0;
  n_skip int := 0;
  v_items jsonb := '[]';
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_non_vehicle_review_v1: user, run and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_non_vehicle_review_v1: cap must be 1..50';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'capture_non_vehicle_review_v1: items must be a JSON array';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_non_vehicle_review'));
  v_sig := 'capture_non_vehicle_review_v1/' || p_run::text;

  CREATE TEMP TABLE IF NOT EXISTS _nv_out (
    image_id uuid PRIMARY KEY,
    typ text,
    verdict text NOT NULL,
    reason text NOT NULL,
    day date,
    accepted boolean NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _nv_out;

  INSERT INTO _nv_out (image_id, typ, verdict, reason, day, accepted)
  SELECT s.image_id, s.typ, s.out_verdict, s.reason, s.day, s.accepted
  FROM (
    SELECT x.image_id,
           vi.ai_scan_metadata#>>'{classification,image_type}' AS typ,
           (COALESCE(vi.taken_at, vi.created_at) AT TIME ZONE 'America/Los_Angeles')::date AS day,
           CASE
             WHEN vi.id IS NULL THEN 'not_found'
             WHEN nullif(btrim(vi.image_url), '') IS NULL THEN 'empty_url'
             WHEN EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id) THEN 'privacy_exclude'
             WHEN vi.vehicle_id IS NOT NULL THEN 'already_filed'
             WHEN coalesce(vi.vision_gate_status::text, '') IN ('rejected_personal', 'rejected_misattributed') THEN 'already_rejected'
             WHEN x.verdict IS NULL OR x.verdict NOT IN ('non_vehicle','already_classified_personal','judgment_personal','vehicle') THEN 'bad_verdict'
             WHEN x.verdict = 'already_classified_personal' AND coalesce(vi.is_sensitive, false) IS NOT TRUE THEN 'not_already_classified'
             WHEN x.verdict IN ('non_vehicle','already_classified_personal','vehicle')
                  AND coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') NOT IN ('other','receipt_document') THEN 'typ_not_eligible'
             WHEN x.verdict = 'non_vehicle' AND coalesce(vi.is_sensitive, false) IS TRUE THEN 'sensitive_not_non_vehicle'
             WHEN x.verdict = 'non_vehicle' AND EXISTS (
               SELECT 1 FROM public.capture_non_vehicle_log l
               WHERE l.image_id = vi.id AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle') THEN 'already_non_vehicle'
             ELSE 'ok'
           END AS reason,
           CASE
             WHEN x.verdict = 'already_classified_personal' AND coalesce(vi.is_sensitive, false) IS NOT TRUE THEN 'judgment_personal'
             ELSE x.verdict
           END AS out_verdict,
           (CASE
             WHEN vi.id IS NULL THEN false
             WHEN nullif(btrim(vi.image_url), '') IS NULL THEN false
             WHEN EXISTS (SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = vi.id) THEN false
             WHEN vi.vehicle_id IS NOT NULL THEN false
             WHEN coalesce(vi.vision_gate_status::text, '') IN ('rejected_personal', 'rejected_misattributed') THEN false
             WHEN x.verdict IS NULL OR x.verdict NOT IN ('non_vehicle','already_classified_personal','judgment_personal','vehicle') THEN false
             WHEN x.verdict = 'already_classified_personal' AND coalesce(vi.is_sensitive, false) IS NOT TRUE THEN true -- logged as judgment, accepted as log
             WHEN x.verdict IN ('non_vehicle','already_classified_personal','vehicle')
                  AND coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') NOT IN ('other','receipt_document') THEN false
             WHEN x.verdict = 'non_vehicle' AND coalesce(vi.is_sensitive, false) IS TRUE THEN false
             WHEN x.verdict = 'non_vehicle' AND EXISTS (
               SELECT 1 FROM public.capture_non_vehicle_log l
               WHERE l.image_id = vi.id AND l.reverted_at IS NULL AND l.verdict = 'non_vehicle') THEN false
             ELSE true
           END) AS accepted
    FROM (
      SELECT DISTINCT ON ((e->>'image_id')::uuid)
        (e->>'image_id')::uuid AS image_id,
        nullif(btrim(e->>'verdict'), '') AS verdict
      FROM jsonb_array_elements(p_items) e
      WHERE e ? 'image_id' AND nullif(btrim(e->>'image_id'), '') IS NOT NULL
      ORDER BY (e->>'image_id')::uuid
      LIMIT p_cap
    ) x
    LEFT JOIN public.vehicle_images vi ON vi.id = x.image_id AND vi.user_id = p_user
  ) s;

  SELECT count(*),
         count(*) FILTER (WHERE accepted AND verdict = 'non_vehicle'),
         count(*) FILTER (WHERE accepted AND verdict = 'already_classified_personal'),
         count(*) FILTER (WHERE accepted AND verdict = 'judgment_personal'),
         count(*) FILTER (WHERE accepted AND verdict = 'vehicle'),
         count(*) FILTER (WHERE NOT accepted)
    INTO n_take, n_non, n_priv, n_judg, n_veh, n_skip
  FROM _nv_out;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'image_id', image_id, 'typ', typ, 'verdict', verdict, 'reason', reason, 'day', day, 'accepted', accepted
         ) ORDER BY image_id), '[]'::jsonb)
    INTO v_items FROM _nv_out;

  IF NOT p_dry THEN
    INSERT INTO public.capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, reason, day, signature)
    SELECT p_run, image_id, p_user, p_granted_by, typ, verdict, reason, day, v_sig
    FROM _nv_out
    WHERE accepted
    ON CONFLICT (run_id, image_id) DO NOTHING;

    -- already-classified personal: reuse privacy_promote on those exact ids only when the function exists
    -- The reviewer listed them; is_sensitive was required. privacy_promote_v1 itself caps and
    -- selects is_sensitive rows; we call it only when at least one such accepted id exists,
    -- and only if the function is installed. It is still dry-safe because this branch is
    -- already in the write path. If the function is missing, the log row remains the record.
    IF n_priv > 0 AND to_regprocedure('public.capture_privacy_promote_v1(uuid,uuid,uuid,boolean,integer)') IS NOT NULL THEN
      PERFORM public.capture_privacy_promote_v1(p_user, p_run, p_granted_by, false, least(n_priv, 50));
    END IF;

    IF n_veh > 0 AND to_regprocedure('public.capture_sets_enqueue(uuid,date,jsonb)') IS NOT NULL THEN
      PERFORM public.capture_sets_enqueue(p_user, d, jsonb_build_object('non_vehicle_review', p_run, 'vehicle_photo', true))
      FROM (SELECT DISTINCT day d FROM _nv_out WHERE accepted AND verdict = 'vehicle' AND day IS NOT NULL) q;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'run_id', p_run, 'dry', p_dry, 'cap', p_cap, 'granted_by', p_granted_by, 'signature', v_sig,
    'submitted', jsonb_array_length(p_items), 'taken', n_take,
    'non_vehicle', n_non, 'already_classified_personal', n_priv,
    'judgment_personal', n_judg, 'vehicle', n_veh, 'skipped', n_skip,
    'items', v_items);
END
$function$;

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

REVOKE ALL ON FUNCTION public.capture_non_vehicle_review_v1(uuid, uuid, uuid, jsonb, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_non_vehicle_review_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_non_vehicle_review_v1(uuid, uuid, uuid, jsonb, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_non_vehicle_review_revert_v1(uuid, uuid) TO service_role;
