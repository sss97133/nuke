-- 20261115232000 capture_typ_from_local_observation
-- Versioned, signed producer: map active local_image_analysis_v1 CLIP views
-- to classification.image_type on typ-empty frames only.
-- Conservative fixed mapping, high-confidence only (view_confidence >= 0.80):
--   exterior_* -> vehicle_exterior
--   interior   -> vehicle_interior
--   engine     -> engine_bay
--   document   -> receipt_document
--   screenshot -> other
-- Unmapped or low-confidence views are left typ-empty. Existing typ is never
-- overwritten (CAS on empty typ). Provenance is recorded next to typ as
-- classification.image_type_provenance {source=local_clip, run_id, ...}.
-- Before writing, the same mapping+threshold is scored against frames that
-- already have typ. Apply writes only when exact agreement is at least 90%.
-- Dry-default, cap 50, granted_by, revert-by-run. Excludes empty_url, the
-- privacy-exclude set, and is_sensitive. Does not invent clocks.
-- Revert: supabase/sql/revert_20261115232000_capture_typ_from_local_observation.sql

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_typ_from_local_observation_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  clip_view text NOT NULL,
  view_confidence numeric,
  mapped_typ text NOT NULL,
  prior_metadata jsonb,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE (run_id, image_id)
);
CREATE INDEX IF NOT EXISTS capture_typ_from_local_observation_log_live_idx
  ON public.capture_typ_from_local_observation_log (user_id, image_id)
  WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS capture_typ_from_local_observation_log_run_idx
  ON public.capture_typ_from_local_observation_log (run_id);

REVOKE ALL ON public.capture_typ_from_local_observation_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_typ_from_local_observation_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.capture_typ_from_local_observation_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.capture_typ_from_local_observation_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_min_conf numeric := 0.80;
  c_min_agree numeric := 90.0;
  n_comparable int := 0;
  n_agree int := 0;
  n_disagree int := 0;
  v_agree_pct numeric := NULL;
  n_elig int := 0;
  n_take int := 0;
  n_written int := 0;
  v_items jsonb := '[]'::jsonb;
  v_sig text;
  v_ok boolean := false;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_typ_from_local_observation_v1: user, run, and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_typ_from_local_observation_v1: cap must be between 1 and 50';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('capture_typ_from_local_observation'));
  PERFORM set_config('lock_timeout', '2s', true);

  DROP TABLE IF EXISTS tmp_typ_from_clip;
  CREATE TEMP TABLE tmp_typ_from_clip (
    image_id uuid PRIMARY KEY,
    clip_view text,
    view_confidence numeric,
    mapped_typ text,
    prior_metadata jsonb
  ) ON COMMIT DROP;

  WITH obs AS MATERIALIZED (
    SELECT DISTINCT ON (o.image_id)
           o.image_id,
           o.confidence_basis#>>'{local_image_analysis_v1,reading,view}' AS clip_view,
           (o.confidence_basis#>>'{local_image_analysis_v1,reading,view_confidence}')::numeric AS view_conf
    FROM public.image_observations o
    JOIN public.vehicle_images v ON v.id = o.image_id
    WHERE o.observed_by = 'local_image_analysis_v1' AND o.is_active
      AND v.user_id = p_user
    ORDER BY o.image_id, o.observed_at DESC NULLS LAST
  ), mapped AS MATERIALIZED (
    SELECT o.image_id, o.clip_view, o.view_conf,
           CASE
             WHEN o.clip_view LIKE 'exterior_%' THEN 'vehicle_exterior'
             WHEN o.clip_view = 'interior' THEN 'vehicle_interior'
             WHEN o.clip_view = 'engine' THEN 'engine_bay'
             WHEN o.clip_view = 'document' THEN 'receipt_document'
             WHEN o.clip_view = 'screenshot' THEN 'other'
           END AS mapped_typ,
           v.ai_scan_metadata#>>'{classification,image_type}' AS typ,
           v.ai_scan_metadata AS prior_metadata,
           (v.image_url IS NULL OR btrim(v.image_url) = '') AS empty_url,
           coalesce(v.is_sensitive, false) AS is_sensitive
    FROM obs o
    JOIN public.vehicle_images v ON v.id = o.image_id
    WHERE o.view_conf IS NOT NULL AND o.view_conf >= 0.80
  ), scored AS MATERIALIZED (
    SELECT count(*) FILTER (WHERE typ IS NOT NULL AND btrim(typ) <> '' AND mapped_typ IS NOT NULL) AS comparable,
           count(*) FILTER (WHERE typ IS NOT NULL AND btrim(typ) <> '' AND mapped_typ IS NOT NULL AND typ = mapped_typ) AS agree,
           count(*) FILTER (WHERE typ IS NOT NULL AND btrim(typ) <> '' AND mapped_typ IS NOT NULL AND typ <> mapped_typ) AS disagree
    FROM mapped
  ), elig AS MATERIALIZED (
    SELECT m.image_id, m.clip_view, m.view_conf, m.mapped_typ, m.prior_metadata
    FROM mapped m
    WHERE m.mapped_typ IS NOT NULL
      AND nullif(btrim(m.typ), '') IS NULL
      AND NOT m.empty_url
      AND NOT m.is_sensitive
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = m.image_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_typ_from_local_observation_log g
        WHERE g.image_id = m.image_id AND g.reverted_at IS NULL)
  ), ins AS (
    INSERT INTO tmp_typ_from_clip (image_id, clip_view, view_confidence, mapped_typ, prior_metadata)
    SELECT image_id, clip_view, view_conf, mapped_typ, prior_metadata
    FROM elig
    ORDER BY image_id
    LIMIT p_cap
    RETURNING 1
  )
  SELECT s.comparable, s.agree, s.disagree,
         CASE WHEN s.comparable > 0
              THEN round(100.0 * s.agree / s.comparable, 1)
              ELSE NULL END,
         (SELECT count(*) FROM elig),
         (SELECT count(*) FROM ins)
    INTO n_comparable, n_agree, n_disagree, v_agree_pct, n_elig, n_take
  FROM scored s;

  v_ok := n_comparable > 0 AND v_agree_pct >= c_min_agree;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'image_id', t.image_id, 'view', t.clip_view,
           'view_confidence', t.view_confidence, 'mapped_typ', t.mapped_typ)
         ORDER BY t.image_id), '[]'::jsonb)
    INTO v_items
  FROM tmp_typ_from_clip t;

  v_sig := 'capture_typ_from_local_observation_v1 run=' || p_run::text
        || ' granted_by=' || p_granted_by::text
        || ' min_view_conf=' || c_min_conf::text;

  IF p_dry OR NOT v_ok THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', p_dry, 'granted_by', p_granted_by, 'signature', v_sig,
      'min_view_conf', c_min_conf, 'min_agree_pct', c_min_agree,
      'comparable', n_comparable, 'agree', n_agree, 'disagree', n_disagree,
      'agree_pct', v_agree_pct, 'agreement_ok', v_ok,
      'eligible', n_elig, 'would_write', CASE WHEN v_ok THEN n_take ELSE 0 END,
      'written', 0, 'cap', p_cap,
      'refused_low_agreement', (NOT p_dry AND NOT v_ok),
      'items', CASE WHEN v_ok THEN v_items ELSE '[]'::jsonb END);
  END IF;

  INSERT INTO public.capture_typ_from_local_observation_log(
      run_id, image_id, user_id, granted_by, clip_view, view_confidence,
      mapped_typ, prior_metadata, signature)
  SELECT p_run, t.image_id, p_user, p_granted_by, t.clip_view, t.view_confidence,
         t.mapped_typ, t.prior_metadata, v_sig
  FROM tmp_typ_from_clip t;

  UPDATE public.vehicle_images v
     SET ai_scan_metadata = coalesce(v.ai_scan_metadata, '{}'::jsonb)
       || jsonb_build_object(
            'classification',
            coalesce(v.ai_scan_metadata->'classification', '{}'::jsonb)
            || jsonb_build_object(
                 'image_type', t.mapped_typ,
                 'image_type_provenance', jsonb_build_object(
                   'source', 'local_clip',
                   'run_id', p_run,
                   'observer', 'local_image_analysis_v1',
                   'view', t.clip_view,
                   'view_confidence', t.view_confidence)))
    FROM tmp_typ_from_clip t
   WHERE v.id = t.image_id
     AND v.user_id = p_user
     AND nullif(btrim(v.ai_scan_metadata#>>'{classification,image_type}'), '') IS NULL;
  GET DIAGNOSTICS n_written = ROW_COUNT;

  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'signature', v_sig,
    'min_view_conf', c_min_conf, 'min_agree_pct', c_min_agree,
    'comparable', n_comparable, 'agree', n_agree, 'disagree', n_disagree,
    'agree_pct', v_agree_pct, 'agreement_ok', true,
    'eligible', n_elig, 'written', n_written, 'cap', p_cap,
    'items', v_items,
    'revert', 'select capture_typ_from_local_observation_revert_v1('
              || quote_literal(p_user::text) || ', ' || quote_literal(p_run::text) || ')');
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_typ_from_local_observation_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_restored int := 0;
  n_log int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_typ_from_local_observation_revert_v1: user and run required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_typ_from_local_observation'));

  UPDATE public.vehicle_images v
     SET ai_scan_metadata = l.prior_metadata
    FROM public.capture_typ_from_local_observation_log l
   WHERE l.user_id = p_user AND l.run_id = p_run AND l.reverted_at IS NULL
     AND v.id = l.image_id AND v.user_id = p_user
     AND v.ai_scan_metadata#>>'{classification,image_type_provenance,run_id}' = p_run::text
     AND v.ai_scan_metadata#>>'{classification,image_type_provenance,source}' = 'local_clip';
  GET DIAGNOSTICS n_restored = ROW_COUNT;

  UPDATE public.capture_typ_from_local_observation_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  GET DIAGNOSTICS n_log = ROW_COUNT;

  RETURN jsonb_build_object('run_id', p_run, 'restored', n_restored, 'reverted_log', n_log);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_typ_from_local_observation_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_typ_from_local_observation_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_typ_from_local_observation_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_typ_from_local_observation_revert_v1(uuid, uuid) TO service_role;
