-- 20261115231000 capture_non_vehicle_vehicle_to_review
-- Tiny companion to capture_non_vehicle_review_v1 (#3302). typ=other /
-- receipt_document frames that a second look already judged as vehicle were
-- only enqueued. typ-aware scoring keeps those typ values out of clear sets
-- and can also leave them out of review sets, so they stayed in limbo.
-- This producer puts those already-logged vehicle frames into an open
-- capture_set_review (held) for Skylar. It does not mark them non_vehicle,
-- does not re-arm refused days, does not invent clocks, and does not touch
-- empty_url or the privacy-exclude set. CAS: skip frames already in an open
-- review, already filed, or already logged in an unreverted run of this
-- producer. Dry-default, cap 50 photos, granted_by, revert-by-run.
-- Revert: supabase/sql/revert_20261115231000_capture_non_vehicle_vehicle_to_review.sql

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_non_vehicle_vehicle_to_review_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  day date,
  typ text,
  review_id uuid,
  set_key text NOT NULL,
  prior_log_run uuid,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE (run_id, image_id)
);
CREATE INDEX IF NOT EXISTS capture_nv_vehicle_to_review_log_live_idx
  ON public.capture_non_vehicle_vehicle_to_review_log (user_id, image_id)
  WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS capture_nv_vehicle_to_review_log_run_idx
  ON public.capture_non_vehicle_vehicle_to_review_log (run_id);

REVOKE ALL ON public.capture_non_vehicle_vehicle_to_review_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_non_vehicle_vehicle_to_review_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.capture_non_vehicle_vehicle_to_review_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.capture_non_vehicle_vehicle_to_review_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_elig int := 0;
  n_take int := 0;
  n_days int := 0;
  v_items jsonb := '[]'::jsonb;
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_non_vehicle_vehicle_to_review_v1: user, run, and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_non_vehicle_vehicle_to_review_v1: cap must be between 1 and 50';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('capture_non_vehicle_vehicle_to_review'));
  PERFORM set_config('lock_timeout', '2s', true);

  DROP TABLE IF EXISTS tmp_nv_vehicle_to_review;
  CREATE TEMP TABLE tmp_nv_vehicle_to_review (
    image_id uuid PRIMARY KEY,
    day date,
    typ text,
    prior_log_run uuid
  ) ON COMMIT DROP;

  WITH latest_nv AS MATERIALIZED (
    SELECT DISTINCT ON (l.image_id) l.image_id, l.run_id, l.verdict, l.day
    FROM public.capture_non_vehicle_log l
    WHERE l.user_id = p_user AND l.reverted_at IS NULL
    ORDER BY l.image_id, l.applied_at DESC
  ), open_now AS MATERIALIZED (
    SELECT DISTINCT y.image_id
    FROM public.capture_set_review o
    CROSS JOIN LATERAL unnest(o.image_ids) AS y(image_id)
    WHERE o.user_id = p_user AND o.status = 'open'
  ), elig AS MATERIALIZED (
    SELECT v.id AS image_id,
           coalesce(n.day, (coalesce(v.taken_at, v.created_at) AT TIME ZONE 'America/Los_Angeles')::date) AS day,
           v.ai_scan_metadata#>>'{classification,image_type}' AS typ,
           n.run_id AS prior_log_run
    FROM public.vehicle_images v
    JOIN latest_nv n ON n.image_id = v.id
    WHERE v.user_id = p_user
      AND n.verdict = 'vehicle'
      AND coalesce(v.ai_scan_metadata#>>'{classification,image_type}','') IN ('other','receipt_document')
      AND v.vehicle_id IS NULL
      AND nullif(btrim(v.image_url), '') IS NOT NULL
      AND coalesce(v.vision_gate_status::text, '') NOT IN ('rejected_personal','rejected_misattributed')
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_vehicle_to_review_log g
        WHERE g.image_id = v.id AND g.reverted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log nv
        WHERE nv.image_id = v.id AND nv.reverted_at IS NULL AND nv.verdict = 'non_vehicle')
      AND NOT EXISTS (SELECT 1 FROM open_now o WHERE o.image_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_set_links sl
        WHERE sl.image_id = v.id AND sl.reverted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_document_pages dp
        WHERE dp.image_id = v.id AND dp.revoked_at IS NULL)
  ), ins AS (
    INSERT INTO tmp_nv_vehicle_to_review (image_id, day, typ, prior_log_run)
    SELECT image_id, day, typ, prior_log_run
    FROM elig
    ORDER BY day NULLS LAST, image_id
    LIMIT p_cap
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM elig), (SELECT count(*) FROM ins),
         (SELECT count(DISTINCT day) FROM tmp_nv_vehicle_to_review)
    INTO n_elig, n_take, n_days;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'image_id', t.image_id, 'day', t.day, 'typ', t.typ,
           'prior_log_run', t.prior_log_run)
         ORDER BY t.day NULLS LAST, t.image_id), '[]'::jsonb)
    INTO v_items
  FROM tmp_nv_vehicle_to_review t;

  v_sig := 'capture_non_vehicle_vehicle_to_review_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text;

  IF p_dry THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', true, 'granted_by', p_granted_by, 'signature', v_sig,
      'eligible', n_elig, 'would_route', n_take, 'days', n_days, 'cap', p_cap,
      'items', v_items);
  END IF;

  WITH days AS (
    SELECT day, array_agg(image_id ORDER BY image_id) AS image_ids
    FROM tmp_nv_vehicle_to_review
    GROUP BY day
  ), ins_rev AS (
    INSERT INTO public.capture_set_review (
      run_id, user_id, set_key, image_ids, confidence, basis, evidence, reason, status)
    SELECT p_run, p_user,
           'nv_vehicle_review:' || coalesce(d.day::text, 'nodate'),
           d.image_ids, NULL, 'non_vehicle_review_vehicle',
           jsonb_build_object(
             'producer', 'capture_non_vehicle_vehicle_to_review_v1',
             'run', p_run, 'granted_by', p_granted_by, 'day', d.day,
             'n', cardinality(d.image_ids)),
           'typ_other_vehicle', 'open'
    FROM days d
    RETURNING id, set_key, image_ids
  )
  INSERT INTO public.capture_non_vehicle_vehicle_to_review_log(
      run_id, image_id, user_id, granted_by, day, typ, review_id, set_key, prior_log_run, signature)
  SELECT p_run, t.image_id, p_user, p_granted_by, t.day, t.typ, r.id, r.set_key, t.prior_log_run, v_sig
  FROM tmp_nv_vehicle_to_review t
  JOIN ins_rev r ON t.image_id = ANY (r.image_ids);

  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'signature', v_sig,
    'eligible', n_elig, 'routed', n_take, 'days', n_days, 'cap', p_cap,
    'reviews', (SELECT count(DISTINCT review_id)
                FROM public.capture_non_vehicle_vehicle_to_review_log
                WHERE run_id = p_run AND reverted_at IS NULL),
    'items', v_items,
    'revert', 'select capture_non_vehicle_vehicle_to_review_revert_v1('
              || quote_literal(p_user::text) || ', ' || quote_literal(p_run::text) || ')');
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_non_vehicle_vehicle_to_review_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_log int := 0;
  n_rev int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_non_vehicle_vehicle_to_review_revert_v1: user and run required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_non_vehicle_vehicle_to_review'));

  DELETE FROM public.capture_set_review r
  WHERE r.user_id = p_user
    AND r.run_id = p_run
    AND r.reason = 'typ_other_vehicle'
    AND r.evidence->>'producer' = 'capture_non_vehicle_vehicle_to_review_v1'
    AND r.evidence->>'run' = p_run::text
    AND r.status = 'open'
    AND EXISTS (
      SELECT 1 FROM public.capture_non_vehicle_vehicle_to_review_log g
      WHERE g.review_id = r.id AND g.run_id = p_run AND g.user_id = p_user AND g.reverted_at IS NULL);
  GET DIAGNOSTICS n_rev = ROW_COUNT;

  UPDATE public.capture_non_vehicle_vehicle_to_review_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  GET DIAGNOSTICS n_log = ROW_COUNT;

  RETURN jsonb_build_object('run_id', p_run, 'reverted_log', n_log, 'deleted_open_reviews', n_rev);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_non_vehicle_vehicle_to_review_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_non_vehicle_vehicle_to_review_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_non_vehicle_vehicle_to_review_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_non_vehicle_vehicle_to_review_revert_v1(uuid, uuid) TO service_role;
