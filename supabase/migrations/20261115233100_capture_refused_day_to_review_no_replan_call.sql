-- 20261115233100 capture_refused_day_to_review_no_replan_call
-- Function-only plus log reshape. The 233000 body applied live called
-- capture_day_replan_state and timed out; it also created a per-photo
-- image_id log. Refusal_reason is the last plan state (gate_failed).
-- The audit log is one row per review with image_ids[] (empty on live
-- so far; refuse if any rows exist). Grants and revert-by-run unchanged.
-- Revert: supabase/sql/revert_20261115233100_capture_refused_day_to_review_no_replan_call.sql

SET statement_timeout = '30s';
SET lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.capture_refused_day_to_review_log') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='capture_refused_day_to_review_log'
         AND column_name='image_id')
  THEN
    IF EXISTS (SELECT 1 FROM public.capture_refused_day_to_review_log) THEN
      RAISE EXCEPTION 'capture_refused_day_to_review_log has rows; revert those runs before reshaping';
    END IF;
    DROP TABLE public.capture_refused_day_to_review_log;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.capture_refused_day_to_review_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  review_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  day date NOT NULL,
  chunk_id uuid,
  refusal_reason text,
  set_key text NOT NULL,
  image_ids uuid[] NOT NULL,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE (run_id, review_id)
);
CREATE INDEX IF NOT EXISTS capture_refused_day_to_review_log_live_idx
  ON public.capture_refused_day_to_review_log (user_id, run_id)
  WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS capture_refused_day_to_review_log_run_idx
  ON public.capture_refused_day_to_review_log (run_id);

REVOKE ALL ON public.capture_refused_day_to_review_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_refused_day_to_review_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.capture_refused_day_to_review_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.capture_refused_day_to_review_v1(
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
    RAISE EXCEPTION 'capture_refused_day_to_review_v1: user, run, and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_refused_day_to_review_v1: cap must be between 1 and 50';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('capture_refused_day_to_review'));
  PERFORM set_config('lock_timeout', '2s', true);

  DROP TABLE IF EXISTS tmp_refused_day_to_review;
  CREATE TEMP TABLE tmp_refused_day_to_review (
    image_id uuid PRIMARY KEY,
    day date NOT NULL,
    chunk_id uuid,
    last_plan text,
    refusal_reason text
  ) ON COMMIT DROP;

  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON ((c.t_from AT TIME ZONE 'America/Los_Angeles')::date)
           (c.t_from AT TIME ZONE 'America/Los_Angeles')::date AS day,
           c.state, c.id AS chunk_id
    FROM public.capture_landing_chunks c
    WHERE c.user_id = p_user AND c.dry IS FALSE
    ORDER BY 1, c.created_at DESC
  ), open_now AS MATERIALIZED (
    SELECT DISTINCT y.image_id
    FROM public.capture_set_review o
    CROSS JOIN LATERAL unnest(o.image_ids) AS y(image_id)
    WHERE o.user_id = p_user AND o.status = 'open'
  ), elig AS MATERIALIZED (
    SELECT v.id AS image_id,
           (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date AS day,
           l.chunk_id, l.state AS last_plan
    FROM public.vehicle_images v
    JOIN latest l ON l.day = (v.taken_at AT TIME ZONE 'America/Los_Angeles')::date
    WHERE v.user_id = p_user
      AND l.state = 'gate_failed'
      AND v.vehicle_id IS NULL
      AND v.taken_at IS NOT NULL
      AND nullif(btrim(v.image_url), '') IS NOT NULL
      AND coalesce(v.is_sensitive, false) IS NOT TRUE
      AND coalesce(v.vision_gate_status::text, '') NOT IN ('rejected_personal','rejected_misattributed')
      AND NOT (coalesce(v.is_duplicate, false) AND v.duplicate_of IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log j
        WHERE j.image_id = v.id AND j.reverted_at IS NULL AND j.verdict = 'judgment_personal')
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_privacy_promote_exclude e WHERE e.image_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_refused_day_to_review_log g
        WHERE g.reverted_at IS NULL AND v.id = ANY (g.image_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_non_vehicle_log nv
        WHERE nv.image_id = v.id AND nv.reverted_at IS NULL AND nv.verdict = 'non_vehicle')
      AND NOT EXISTS (SELECT 1 FROM open_now o WHERE o.image_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_set_review rr
        WHERE rr.user_id = p_user AND rr.reason = 'refused_day'
          AND v.id = ANY (rr.image_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_set_links sl
        WHERE sl.image_id = v.id AND sl.reverted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.capture_document_pages dp
        WHERE dp.image_id = v.id AND dp.revoked_at IS NULL)
  ), day_n AS MATERIALIZED (
    SELECT day, chunk_id, last_plan, count(*)::int AS n
    FROM elig GROUP BY day, chunk_id, last_plan
  ), ordered AS MATERIALIZED (
    SELECT day, chunk_id, last_plan, n,
           sum(n) OVER (ORDER BY day, chunk_id) AS running
    FROM day_n
  ), first_day AS MATERIALIZED (
    SELECT day, n FROM ordered ORDER BY day, chunk_id LIMIT 1
  ), take_days AS MATERIALIZED (
    SELECT o.day, o.chunk_id, o.last_plan, o.n
    FROM ordered o, first_day f
    WHERE (f.n <= p_cap AND o.running <= p_cap)
       OR (f.n > p_cap AND o.day = f.day)
  ), ranked AS MATERIALIZED (
    SELECT e.image_id, e.day, e.chunk_id, e.last_plan,
           row_number() OVER (PARTITION BY e.day ORDER BY e.image_id) AS rn,
           (SELECT n FROM first_day) AS first_n
    FROM elig e
    JOIN take_days d ON d.day = e.day
  ), ins AS (
    INSERT INTO tmp_refused_day_to_review (image_id, day, chunk_id, last_plan, refusal_reason)
    SELECT r.image_id, r.day, r.chunk_id, r.last_plan, r.last_plan
    FROM ranked r
    WHERE CASE WHEN r.first_n > p_cap THEN r.rn <= p_cap ELSE true END
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM elig), (SELECT count(*) FROM ins)
    INTO n_elig, n_take;

  SELECT count(DISTINCT day) INTO n_days FROM tmp_refused_day_to_review;

  -- Do not call capture_day_replan_state here: it times out on the live
  -- library. refusal_reason is the last plan state (gate_failed). The failed
  -- chunk id is recorded alongside it.

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'image_id', t.image_id, 'day', t.day, 'chunk_id', t.chunk_id,
           'refusal_reason', t.refusal_reason)
         ORDER BY t.day, t.image_id), '[]'::jsonb)
    INTO v_items
  FROM tmp_refused_day_to_review t;

  v_sig := 'capture_refused_day_to_review_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text;

  IF p_dry THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', true, 'granted_by', p_granted_by, 'signature', v_sig,
      'eligible', n_elig, 'would_route', n_take, 'days', n_days, 'cap', p_cap,
      'items', v_items);
  END IF;

  WITH days AS (
    SELECT day, chunk_id, refusal_reason, last_plan,
           array_agg(image_id ORDER BY image_id) AS image_ids
    FROM tmp_refused_day_to_review
    GROUP BY day, chunk_id, refusal_reason, last_plan
  ), ins_rev AS (
    INSERT INTO public.capture_set_review (
      run_id, user_id, set_key, image_ids, confidence, basis, evidence, reason, status)
    SELECT p_run, p_user,
           'refused_day_review:' || d.day::text || ':' || p_run::text,
           d.image_ids, 0, 'refused_day_to_review',
           jsonb_build_object(
             'producer', 'capture_refused_day_to_review_v1',
             'run', p_run, 'granted_by', p_granted_by, 'day', d.day,
             'n', cardinality(d.image_ids),
             'refusal_reason', d.refusal_reason,
             'chunk_id', d.chunk_id,
             'chunk_state', d.last_plan),
           'refused_day', 'open'
    FROM days d
    RETURNING id, set_key, image_ids
  )
  INSERT INTO public.capture_refused_day_to_review_log(
      run_id, review_id, user_id, granted_by, day, chunk_id, refusal_reason,
      set_key, image_ids, signature)
  SELECT p_run, r.id, p_user, p_granted_by, d.day, d.chunk_id, d.refusal_reason,
         r.set_key, r.image_ids, v_sig
  FROM days d
  JOIN ins_rev r ON r.image_ids = d.image_ids;


  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'signature', v_sig,
    'eligible', n_elig, 'routed', n_take, 'days', n_days, 'cap', p_cap,
    'reviews', (SELECT count(DISTINCT review_id)
                FROM public.capture_refused_day_to_review_log
                WHERE run_id = p_run AND reverted_at IS NULL),
    'items', v_items,
    'revert', 'select capture_refused_day_to_review_revert_v1('
              || quote_literal(p_user::text) || ', ' || quote_literal(p_run::text) || ')');
END
$function$;

CREATE OR REPLACE FUNCTION public.capture_refused_day_to_review_revert_v1(p_user uuid, p_run uuid)
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
    RAISE EXCEPTION 'capture_refused_day_to_review_revert_v1: user and run required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('capture_refused_day_to_review'));

  DELETE FROM public.capture_set_review r
  WHERE r.user_id = p_user
    AND r.run_id = p_run
    AND r.reason = 'refused_day'
    AND r.evidence->>'producer' = 'capture_refused_day_to_review_v1'
    AND r.evidence->>'run' = p_run::text
    AND r.status = 'open'
    AND EXISTS (
      SELECT 1 FROM public.capture_refused_day_to_review_log g
      WHERE g.review_id = r.id AND g.run_id = p_run AND g.user_id = p_user AND g.reverted_at IS NULL);
  GET DIAGNOSTICS n_rev = ROW_COUNT;

  UPDATE public.capture_refused_day_to_review_log
     SET reverted_at = now()
   WHERE user_id = p_user AND run_id = p_run AND reverted_at IS NULL;
  GET DIAGNOSTICS n_log = ROW_COUNT;

  RETURN jsonb_build_object('run_id', p_run, 'reverted_log', n_log, 'deleted_open_reviews', n_rev);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_refused_day_to_review_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_refused_day_to_review_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_refused_day_to_review_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_refused_day_to_review_revert_v1(uuid, uuid) TO service_role;
