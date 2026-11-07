-- A drain for capture_set_review: the pile of photo sets the landing pipeline could not place.
--
-- Why (owner, 2026-11-07): capture_landing_finalize_plan writes one capture_set_review row per held set per run and nothing
-- ever closes one. Measured: 1,258 open rows for 1,061 sets over 445 user-days (2017-02-07 .. 2026-11-03); 195 of them
-- were superseded by a newer row for the same set (the day was re-landed), 40 have no unfiled photo left (every frame was
-- filed, revoked or landed as a document page since). The rest wait for evidence that changes the score, and the one
-- evidence change that reaches every set is a new batch of visual anchors: a landing run whose viewed gate sample passed
-- (20261111130000 makes those filings anchors), after which nothing re-scores the days scored before it.
--
-- Change (one migration):
--   capture_set_review_sweep(p_user, p_rearm_limit) -- service_role only, hourly cron 'capture-review-sweep':
--     1. resolves open rows superseded by a newer row for the same (user_id, set_key);
--     2. resolves open rows with no unfiled photo left (filed through capture_set_links, duplicate/superseded, or a
--        capture_document_pages row);
--     3. re-arms (capture_sets_enqueue, reason new_anchors) up to p_rearm_limit user-days, oldest first, whose newest
--        open row is older than the user's newest gate-passed filing and that are not already pending in
--        capture_set_rescore_queue (a re-armed day never starves the arrival queue: it joins it once).
--     Resolution is recorded on the row: status 'resolved' (the table's check allows open/resolved/dismissed) and
--     evidence.resolved = {how, by, at}. The function never touches vehicle_images, capture_set_links or any testimony.
--   v_capture_review_backlog -- what remains, per user: open rows, sets, unfiled frames, days, oldest/newest day, reasons.
-- Revert: supabase/sql/revert_20261111140000_capture_review_drain.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.capture_set_review_sweep(p_user uuid DEFAULT NULL, p_rearm_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE n_sup integer := 0; n_done integer := 0; n_arm integer := 0; rec record;
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  -- 1. superseded: a newer row for the same set exists (the day was re-landed)
  WITH sup AS (
    SELECT r.id FROM capture_set_review r
    WHERE r.status = 'open' AND (p_user IS NULL OR r.user_id = p_user)
      AND EXISTS (SELECT 1 FROM capture_set_review n WHERE n.user_id = r.user_id AND n.set_key = r.set_key AND n.created_at > r.created_at)
  ), u AS (
    UPDATE capture_set_review r SET status = 'resolved',
      evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object('resolved',
        jsonb_build_object('how', 'superseded_by_newer_run', 'by', 'capture_set_review_sweep', 'at', now()))
    FROM sup WHERE r.id = sup.id RETURNING 1)
  SELECT count(*) INTO n_sup FROM u;
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
  -- 3. re-arm: days whose newest open row predates the user's newest gate-passed filing (new visual anchors)
  FOR rec IN
    WITH anchors AS (
      SELECT vi.user_id, max(l.created_at) last_link
      FROM capture_set_links l JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
      JOIN vehicle_images vi ON vi.id = l.image_id
      WHERE l.reverted_at IS NULL AND (p_user IS NULL OR vi.user_id = p_user)
      GROUP BY vi.user_id
    ), days AS (
      SELECT r.user_id,
             (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) d,
             max(r.created_at) newest_row
      FROM capture_set_review r JOIN anchors a ON a.user_id = r.user_id
      WHERE r.status = 'open'
      GROUP BY r.user_id, r.image_ids
    )
    SELECT d.user_id, d.d
    FROM days d JOIN anchors a ON a.user_id = d.user_id
    WHERE d.d IS NOT NULL
    GROUP BY d.user_id, d.d, a.last_link
    HAVING max(d.newest_row) < a.last_link
       AND NOT EXISTS (SELECT 1 FROM capture_set_rescore_queue q WHERE q.user_id = d.user_id AND q.day = d.d AND q.done_at IS NULL)
    ORDER BY d.d
    LIMIT greatest(0, p_rearm_limit)
  LOOP
    PERFORM capture_sets_enqueue(rec.user_id, rec.d, jsonb_build_object('new_anchors', now()));
    n_arm := n_arm + 1;
  END LOOP;
  RETURN jsonb_build_object('superseded', n_sup, 'nothing_left_unfiled', n_done, 'rearmed', n_arm, 'at', now());
END $fn$;

REVOKE ALL ON FUNCTION public.capture_set_review_sweep(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_review_sweep(uuid, integer) TO service_role;

CREATE OR REPLACE VIEW public.v_capture_review_backlog AS
WITH o AS (
  SELECT r.user_id, r.id, r.set_key, r.reason, r.created_at,
         (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) d,
         (SELECT count(*) FROM unnest(r.image_ids) i JOIN vehicle_images v ON v.id = i
           WHERE v.vehicle_id IS NULL AND NOT coalesce(v.is_duplicate, false) AND NOT coalesce(v.is_superseded, false)) unfiled
  FROM capture_set_review r WHERE r.status = 'open')
SELECT user_id, count(*) open_rows, count(DISTINCT set_key) open_sets, sum(unfiled)::bigint unfiled_frames,
       count(DISTINCT d) days, min(d) oldest_day, max(d) newest_day, min(created_at) oldest_row, max(created_at) newest_row,
       (SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) n FROM o o2 WHERE o2.user_id = o.user_id GROUP BY reason) x) reasons
FROM o GROUP BY user_id;
REVOKE ALL ON public.v_capture_review_backlog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_capture_review_backlog TO service_role;

DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'capture-review-sweep' LOOP PERFORM cron.unschedule(j); END LOOP;
  PERFORM cron.schedule('capture-review-sweep', '17 * * * *',
    $cmd$SET statement_timeout = '55s'; SELECT public.capture_set_review_sweep(NULL, 200);$cmd$);
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.capture_set_review_sweep(uuid, integer)') IS NULL THEN RAISE EXCEPTION 'capture_set_review_sweep missing'; END IF;
  IF to_regclass('public.v_capture_review_backlog') IS NULL THEN RAISE EXCEPTION 'v_capture_review_backlog missing'; END IF;
  IF has_function_privilege('anon', 'public.capture_set_review_sweep(uuid, integer)', 'EXECUTE') THEN RAISE EXCEPTION 'sweep is executable by anon'; END IF;
END $$;
