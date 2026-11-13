-- 20261115230100 capture_review_reopen_uncovered_fast
-- Function-only. Replace capture_set_review_reopen_uncovered_v1 with a set-based
-- eligibility query. The 20261115230000 body computed an ARRAY subquery per
-- resolved review and timed out on the live library. Behaviour, grants, log
-- table, and revert-by-run are unchanged. Sweep and cron are unchanged.
-- Parent reopen prosrc md5 ac989c8c6bb6d8b8d8f0f1332ddfd8bf.
-- Revert: supabase/sql/revert_20261115230100_capture_review_reopen_uncovered_fast.sql

DO $$ BEGIN
  IF to_regprocedure('public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer)') IS NULL THEN
    RAISE EXCEPTION 'capture_set_review_reopen_uncovered_v1 missing; apply 20261115230000 first';
  END IF;
  IF md5((SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='capture_set_review_reopen_uncovered_v1'
            AND pg_get_function_identity_arguments(p.oid) = 'p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean, p_cap integer'))
     <> 'ac989c8c6bb6d8b8d8f0f1332ddfd8bf' THEN
    RAISE EXCEPTION 'capture_set_review_reopen_uncovered_v1 drifted from the 20261115230000 body; re-record before patching';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.capture_set_review_reopen_uncovered_v1(
  p_user uuid, p_run uuid, p_granted_by uuid, p_dry boolean DEFAULT true, p_cap integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_elig int := 0;
  n_take int := 0;
  v_items jsonb := '[]'::jsonb;
  v_sig text;
BEGIN
  IF p_user IS NULL OR p_run IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'capture_set_review_reopen_uncovered_v1: user, run, and granted_by required';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 OR p_cap > 50 THEN
    RAISE EXCEPTION 'capture_set_review_reopen_uncovered_v1: cap must be between 1 and 50';
  END IF;

  PERFORM set_config('lock_timeout', '2s', true);

  DROP TABLE IF EXISTS tmp_reopen_uncovered;
  CREATE TEMP TABLE tmp_reopen_uncovered (
    id uuid PRIMARY KEY,
    set_key text,
    image_ids uuid[],
    uncovered_ids uuid[],
    status text,
    evidence jsonb,
    created_at timestamptz,
    resolved_at timestamptz
  ) ON COMMIT DROP;

  WITH open_now AS MATERIALIZED (
    SELECT DISTINCT y.image_id
    FROM capture_set_review o
    CROSS JOIN LATERAL unnest(o.image_ids) AS y(image_id)
    WHERE o.user_id = p_user AND o.status = 'open'
  ), resolved AS MATERIALIZED (
    SELECT r.id, r.set_key, r.image_ids, r.status, r.evidence, r.created_at,
           (r.evidence#>>'{resolved,at}')::timestamptz AS resolved_at
    FROM capture_set_review r
    WHERE r.user_id = p_user
      AND r.status = 'resolved'
      AND r.evidence#>>'{resolved,how}' = 'superseded_by_newer_run'
      AND NOT EXISTS (
        SELECT 1 FROM capture_review_reopen_uncovered_log g
        WHERE g.review_id = r.id AND g.reverted_at IS NULL)
  ), uncovered AS MATERIALIZED (
    SELECT r.id, x.image_id
    FROM resolved r
    CROSS JOIN LATERAL unnest(r.image_ids) AS x(image_id)
    JOIN vehicle_images v ON v.id = x.image_id
    WHERE v.vehicle_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = x.image_id AND l.reverted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = x.image_id AND dp.revoked_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM open_now n WHERE n.image_id = x.image_id)
  ), elig AS MATERIALIZED (
    SELECT r.id, r.set_key, r.image_ids,
           array_agg(u.image_id ORDER BY u.image_id) AS uncovered_ids,
           r.status, r.evidence, r.created_at, r.resolved_at
    FROM resolved r
    JOIN uncovered u ON u.id = r.id
    GROUP BY r.id, r.set_key, r.image_ids, r.status, r.evidence, r.created_at, r.resolved_at
  ), ins AS (
    INSERT INTO tmp_reopen_uncovered
    SELECT id, set_key, image_ids, uncovered_ids, status, evidence, created_at, resolved_at
    FROM elig
    ORDER BY resolved_at NULLS LAST, created_at, id
    LIMIT p_cap
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM elig), (SELECT count(*) FROM ins)
    INTO n_elig, n_take;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'review_id', t.id, 'set_key', t.set_key,
           'uncovered_ids', to_jsonb(t.uncovered_ids),
           'n', array_length(t.uncovered_ids, 1))
         ORDER BY t.resolved_at NULLS LAST, t.created_at, t.id), '[]'::jsonb)
    INTO v_items
  FROM tmp_reopen_uncovered t;

  v_sig := 'capture_set_review_reopen_uncovered_v1 run=' || p_run::text || ' granted_by=' || p_granted_by::text;

  IF p_dry THEN
    RETURN jsonb_build_object(
      'run', p_run, 'dry_run', true, 'granted_by', p_granted_by,
      'eligible', n_elig, 'would_reopen', n_take, 'cap', p_cap,
      'items', v_items);
  END IF;

  INSERT INTO capture_review_reopen_uncovered_log(
      run_id, review_id, user_id, granted_by, set_key, image_ids, uncovered_ids,
      prior_status, prior_evidence, signature)
  SELECT p_run, t.id, p_user, p_granted_by, t.set_key, t.image_ids, t.uncovered_ids,
         t.status, t.evidence, v_sig
  FROM tmp_reopen_uncovered t;

  UPDATE capture_set_review r
     SET status = 'open',
         evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('reopened',
           jsonb_build_object('how', 'uncovered_not_in_newer_review',
                              'by', 'capture_set_review_reopen_uncovered_v1',
                              'at', now(), 'run', p_run))
  FROM tmp_reopen_uncovered t
  WHERE r.id = t.id;

  RETURN jsonb_build_object(
    'run', p_run, 'dry_run', false, 'granted_by', p_granted_by, 'applied', true,
    'eligible', n_elig, 'reopened', n_take, 'cap', p_cap,
    'items', v_items, 'signature', v_sig);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
