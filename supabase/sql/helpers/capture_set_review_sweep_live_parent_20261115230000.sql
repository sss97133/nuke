-- Parent body this migration is written against: live capture_set_review_sweep
-- (20261113120600, prosrc md5 f021b75c81be85388884d9c16d42ca49).
CREATE OR REPLACE FUNCTION public.capture_set_review_sweep(p_user uuid DEFAULT NULL::uuid, p_rearm_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  RETURN jsonb_build_object('superseded', n_sup, 'nothing_left_unfiled', n_done, 'rearmed', n_arm, 'at', now());
END $function$;

REVOKE ALL ON FUNCTION public.capture_set_review_sweep(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_review_sweep(uuid, integer) TO service_role;
