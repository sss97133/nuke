-- Revert 20261115230100: restore capture_set_review_reopen_uncovered_v1 to the 20261115230000 body.
-- The log table and revert helper are left in place. Refuses nothing; no row writes.

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

  WITH open_now AS (
    SELECT DISTINCT y.image_id
    FROM capture_set_review o
    CROSS JOIN LATERAL unnest(o.image_ids) AS y(image_id)
    WHERE o.user_id = p_user AND o.status = 'open'
  ), cand AS (
    SELECT r.id, r.set_key, r.image_ids, r.status, r.evidence, r.created_at,
           (r.evidence#>>'{resolved,at}')::timestamptz AS resolved_at,
           ARRAY(
             SELECT x.image_id
             FROM unnest(r.image_ids) AS x(image_id)
             JOIN vehicle_images v ON v.id = x.image_id
             WHERE v.vehicle_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = x.image_id AND l.reverted_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = x.image_id AND dp.revoked_at IS NULL)
               AND NOT EXISTS (SELECT 1 FROM open_now n WHERE n.image_id = x.image_id)
             ORDER BY x.image_id
           ) AS uncovered_ids
    FROM capture_set_review r
    WHERE r.user_id = p_user
      AND r.status = 'resolved'
      AND r.evidence#>>'{resolved,how}' = 'superseded_by_newer_run'
      AND NOT EXISTS (
        SELECT 1 FROM capture_review_reopen_uncovered_log g
        WHERE g.review_id = r.id AND g.reverted_at IS NULL)
  ), elig AS (
    SELECT * FROM cand WHERE coalesce(array_length(uncovered_ids, 1), 0) > 0
  )
  SELECT count(*) INTO n_elig FROM elig;

  INSERT INTO tmp_reopen_uncovered
  SELECT id, set_key, image_ids, uncovered_ids, status, evidence, created_at, resolved_at
  FROM (
    WITH open_now AS (
      SELECT DISTINCT y.image_id
      FROM capture_set_review o
      CROSS JOIN LATERAL unnest(o.image_ids) AS y(image_id)
      WHERE o.user_id = p_user AND o.status = 'open'
    ), cand AS (
      SELECT r.id, r.set_key, r.image_ids, r.status, r.evidence, r.created_at,
             (r.evidence#>>'{resolved,at}')::timestamptz AS resolved_at,
             ARRAY(
               SELECT x.image_id
               FROM unnest(r.image_ids) AS x(image_id)
               JOIN vehicle_images v ON v.id = x.image_id
               WHERE v.vehicle_id IS NULL
                 AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = x.image_id AND l.reverted_at IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = x.image_id AND dp.revoked_at IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM open_now n WHERE n.image_id = x.image_id)
               ORDER BY x.image_id
             ) AS uncovered_ids
      FROM capture_set_review r
      WHERE r.user_id = p_user
        AND r.status = 'resolved'
        AND r.evidence#>>'{resolved,how}' = 'superseded_by_newer_run'
        AND NOT EXISTS (
          SELECT 1 FROM capture_review_reopen_uncovered_log g
          WHERE g.review_id = r.id AND g.reverted_at IS NULL)
    )
    SELECT * FROM cand
    WHERE coalesce(array_length(uncovered_ids, 1), 0) > 0
    ORDER BY resolved_at NULLS LAST, created_at, id
    LIMIT p_cap
  ) s;

  SELECT count(*) INTO n_take FROM tmp_reopen_uncovered;

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

CREATE OR REPLACE FUNCTION public.capture_set_review_reopen_uncovered_revert_v1(p_user uuid, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int := 0;
BEGIN
  IF p_user IS NULL OR p_run IS NULL THEN
    RAISE EXCEPTION 'capture_set_review_reopen_uncovered_revert_v1: user and run required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM capture_review_reopen_uncovered_log
    WHERE run_id = p_run AND user_id = p_user AND reverted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'capture_set_review_reopen_uncovered_revert_v1: run already reverted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM capture_review_reopen_uncovered_log
    WHERE run_id = p_run AND user_id = p_user AND reverted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('run', p_run, 'reverted', 0);
  END IF;

  UPDATE capture_set_review r
     SET status = g.prior_status,
         evidence = g.prior_evidence
  FROM capture_review_reopen_uncovered_log g
  WHERE g.run_id = p_run AND g.user_id = p_user AND g.reverted_at IS NULL
    AND r.id = g.review_id
    AND r.status = 'open'
    AND r.evidence#>>'{reopened,run}' = p_run::text;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE capture_review_reopen_uncovered_log
     SET reverted_at = now()
   WHERE run_id = p_run AND user_id = p_user AND reverted_at IS NULL;

  RETURN jsonb_build_object('run', p_run, 'reverted', n);
END
$function$;

REVOKE ALL ON FUNCTION public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_set_review_reopen_uncovered_revert_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_review_reopen_uncovered_v1(uuid, uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_set_review_reopen_uncovered_revert_v1(uuid, uuid) TO service_role;
