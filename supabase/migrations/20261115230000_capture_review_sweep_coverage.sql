-- 20261115230000 capture_review_sweep_coverage
-- Function patch plus a signed reopen producer. No photo / link / testimony writes
-- in the sweep itself.
--
-- capture_set_review_sweep: superseded_by_newer_run only resolves an older open
-- review when every still-unfiled photo is already in the newer open review or
-- another open review. Otherwise the older review stays open and the uncovered
-- ids are recorded on evidence.uncovered_after_newer_run (updated only when the
-- set changes). The 20261113120600 re-arm logic is unchanged. Cron is unchanged.
--
-- capture_set_review_reopen_uncovered_v1: signed, dry-default, cap 50, granted_by,
-- revert-by-run. Reopens resolved superseded_by_newer_run reviews that still have
-- still-unfiled photos not in any open review. Restores held without hand edits.
--
-- Parent: live sweep prosrc md5 f021b75c81be85388884d9c16d42ca49 (20261113120600).
-- Revert: supabase/sql/revert_20261115230000_capture_review_sweep_coverage.sql

DO $$ BEGIN
  IF to_regprocedure('public.capture_set_review_sweep(uuid, integer)') IS NULL THEN
    RAISE EXCEPTION 'capture_set_review_sweep missing; apply the live 20261113120600 body first';
  END IF;
  IF md5((SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='capture_set_review_sweep')) <> 'f021b75c81be85388884d9c16d42ca49' THEN
    RAISE EXCEPTION 'capture_set_review_sweep drifted from the live 20261113120600 body; re-record before patching';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.capture_set_review_sweep(p_user uuid DEFAULT NULL::uuid, p_rearm_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n_sup integer := 0; n_done integer := 0; n_arm integer := 0; n_uncovered integer := 0; n_uncovered_images integer := 0; rec record;
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  -- 1. superseded: a newer row for the same set exists (the day was re-landed),
  --    but only when every still-unfiled photo is already in that newer open
  --    review or another open review (20261115230000). A still-unfiled photo is
  --    one with no vehicle_id, no active capture_set_link, and no active
  --    document page (is_duplicate / is_superseded do not exempt it). Otherwise
  --    leave the older row open and record the uncovered image_ids on evidence
  --    when that set changes.
  WITH candidates AS (
    SELECT r.id, r.user_id, r.image_ids
    FROM capture_set_review r
    WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
      AND EXISTS (SELECT 1 FROM capture_set_review n
                  WHERE n.user_id = r.user_id AND n.set_key = r.set_key AND n.created_at > r.created_at)
  ), still_unfiled AS (
    SELECT c.id AS review_id, x.image_id
    FROM candidates c
    CROSS JOIN LATERAL unnest(c.image_ids) AS x(image_id)
    JOIN vehicle_images v ON v.id = x.image_id
    WHERE v.vehicle_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = x.image_id AND l.reverted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = x.image_id AND dp.revoked_at IS NULL)
  ), uncovered AS (
    SELECT s.review_id, s.image_id
    FROM still_unfiled s
    JOIN candidates c ON c.id = s.review_id
    WHERE NOT EXISTS (
      SELECT 1 FROM capture_set_review o
      CROSS JOIN LATERAL unnest(o.image_ids) AS y(image_id)
      WHERE o.status = 'open' AND o.user_id = c.user_id AND o.id <> c.id AND y.image_id = s.image_id
    )
  ), uncovered_agg AS (
    SELECT review_id, jsonb_agg(image_id ORDER BY image_id) AS image_ids, count(*)::integer AS n
    FROM uncovered
    GROUP BY review_id
  ), sup AS (
    SELECT c.id FROM candidates c
    WHERE NOT EXISTS (SELECT 1 FROM uncovered u WHERE u.review_id = c.id)
  ), u AS (
    UPDATE capture_set_review r SET status = 'resolved',
      evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('resolved',
        jsonb_build_object('how', 'superseded_by_newer_run', 'by', 'capture_set_review_sweep', 'at', now()))
    FROM sup WHERE r.id = sup.id RETURNING 1
  ), noted AS (
    UPDATE capture_set_review r SET
      evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('uncovered_after_newer_run',
        jsonb_build_object('image_ids', a.image_ids, 'n', a.n, 'by', 'capture_set_review_sweep', 'at', now()))
    FROM uncovered_agg a
    WHERE r.id = a.review_id
      AND coalesce(r.evidence#>'{uncovered_after_newer_run,image_ids}', 'null'::jsonb) IS DISTINCT FROM a.image_ids
    RETURNING r.id
  )
  SELECT (SELECT count(*) FROM u),
         (SELECT count(*) FROM uncovered_agg),
         (SELECT coalesce(sum(n), 0) FROM uncovered_agg)
    INTO n_sup, n_uncovered, n_uncovered_images;
  -- 2. nothing left unfiled: every photo of the set is filed, duplicate/superseded, or landed as a document page
  WITH done AS (
    SELECT r.id FROM capture_set_review r
    WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(r.image_ids) i JOIN vehicle_images v ON v.id = i
        WHERE v.vehicle_id IS NULL AND NOT coalesce(v.is_duplicate, false) AND NOT coalesce(v.is_superseded, false)
          AND NOT EXISTS (SELECT 1 FROM capture_set_links l WHERE l.image_id = i AND l.reverted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = i AND dp.revoked_at IS NULL))
  ), u AS (
    UPDATE capture_set_review r SET status = 'resolved',
      evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('resolved',
        jsonb_build_object('how', 'nothing_left_unfiled', 'by', 'capture_set_review_sweep', 'at', now()))
    FROM done WHERE r.id = done.id RETURNING 1)
  SELECT count(*) INTO n_done FROM u;
  -- 3. re-arm a day only on new evidence for THAT day: a gate-passed filing, newer than the day's newest open row,
  --    onto a vehicle the day's open rows propose, or in the same capture session (set_key) or capture day (20261113120100;
  --    before, any filing re-armed every day whose rows propose no vehicle: 200 days per filing). A day whose plan is still
  --    waiting on the gate, or whose last plan the gate refused with no new evidence since, is not re-armed
  --    (capture_day_replan_state, 20261113120000). Before: any filing anywhere re-armed up to 200 days every hour.
  --    The filing must also be newer than the day's last completed plan (20261113120600): a re-plan that wrote no new
  --    open row left the watermark at the old row, so every later filing on a proposed vehicle re-armed the day again
  --    (2026-10-28: 10 re-arms since 11-07, no new row since 11-04; 1,780 re-plans on 11-09, 15 filed).
  FOR rec IN
    WITH open_rows AS (
      SELECT r.user_id, r.created_at, r.to_vehicle_id, r.set_key,
             (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) d
      FROM capture_set_review r
      WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
    ), per_day AS (
      SELECT o.user_id, o.d, max(o.created_at) newest_row,
             array_agg(DISTINCT o.to_vehicle_id) FILTER (WHERE o.to_vehicle_id IS NOT NULL) vehs,
             array_agg(DISTINCT o.set_key) sets
      FROM open_rows o WHERE o.d IS NOT NULL
      GROUP BY o.user_id, o.d
    )
    SELECT p.user_id, p.d
    FROM per_day p
    WHERE EXISTS (
            SELECT 1 FROM capture_set_links l
            JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
            JOIN vehicle_images vi ON vi.id = l.image_id
            WHERE l.reverted_at IS NULL AND vi.user_id = p.user_id AND l.created_at > greatest(p.newest_row, coalesce((SELECT q2.done_at FROM capture_set_rescore_queue q2
                                                                WHERE q2.user_id = p.user_id AND q2.day = p.d), '-infinity'::timestamptz))
              AND (l.vehicle_id = ANY (coalesce(p.vehs, '{}'::uuid[])) OR l.set_key = ANY (coalesce(p.sets, '{}'::text[]))
                   OR (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date = p.d))
      AND NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue q WHERE q.user_id = p.user_id AND q.day = p.d AND q.done_at IS NULL)
      AND NOT coalesce((capture_day_replan_state(p.user_id, p.d)->>'blocked')::boolean, false)
    ORDER BY p.d
    LIMIT greatest(0, p_rearm_limit)
  LOOP
    PERFORM capture_sets_enqueue(rec.user_id, rec.d, jsonb_build_object('new_anchors', now()));
    n_arm := n_arm + 1;
  END LOOP;
  RETURN jsonb_build_object('superseded', n_sup, 'nothing_left_unfiled', n_done, 'rearmed', n_arm,
                            'uncovered_left_open', n_uncovered, 'uncovered_images', n_uncovered_images, 'at', now());
END $function$;

REVOKE ALL ON FUNCTION public.capture_set_review_sweep(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_review_sweep(uuid, integer) TO service_role;


CREATE TABLE IF NOT EXISTS public.capture_review_reopen_uncovered_log (
  run_id uuid NOT NULL,
  review_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  set_key text,
  image_ids uuid[] NOT NULL,
  uncovered_ids uuid[] NOT NULL,
  prior_status text NOT NULL,
  prior_evidence jsonb,
  signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, review_id)
);
CREATE INDEX IF NOT EXISTS capture_review_reopen_uncovered_log_review_idx
  ON public.capture_review_reopen_uncovered_log (review_id, applied_at DESC);
REVOKE ALL ON public.capture_review_reopen_uncovered_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.capture_review_reopen_uncovered_log TO service_role;

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
