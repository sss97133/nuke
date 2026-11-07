-- get_capture_ledger, grouped once per day.
--
-- Measured live 2026-11-07 after 20261111170000 deployed: the owner's default window (7,425 frames, 232 days) cancelled at
-- the pooler's 10 s statement_timeout. The cause is the shape, not the frames: eleven correlated subqueries over the
-- materialised frame set, once per day (232 × 11 passes over 7,425 rows). The frame classifier alone reads in 143 ms.
-- This body groups the frames once per day and joins the per-day aggregates: the same window in 1.39 s (all-time frames
-- 2.06 s). Same signature, same JSON, same grants; test_capture_ledger.sql runs both migrations.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_capture_ledger(p_tz text DEFAULT 'America/Los_Angeles', p_from date DEFAULT (current_date - 365),
                                                     p_to date DEFAULT NULL, p_limit integer DEFAULT 180)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH uid AS (SELECT auth.uid() AS id),
  fr AS MATERIALIZED (SELECT f.* FROM uid, LATERAL public.capture_ledger_frames(uid.id, p_tz, p_from, p_to) f WHERE uid.id IS NOT NULL),
  arrived AS (SELECT DISTINCT asset_id FROM fr WHERE asset_id IS NOT NULL),
  sk AS MATERIALIZED (
    SELECT (COALESCE(k.taken_at, k.decided_at) AT TIME ZONE p_tz)::date AS day, k.reason
    FROM public.capture_skips k, uid
    WHERE k.user_id = uid.id AND uid.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM arrived a WHERE a.asset_id = k.asset_id)
      AND (p_from IS NULL OR COALESCE(k.taken_at, k.decided_at) >= (p_from::timestamp AT TIME ZONE p_tz))
      AND (p_to IS NULL OR COALESCE(k.taken_at, k.decided_at) < ((p_to + 1)::timestamp AT TIME ZONE p_tz))
  ),
  day_frames AS (
    SELECT day, count(*) AS taken,
           count(*) FILTER (WHERE state = 'on_vehicle') AS on_vehicle, count(*) FILTER (WHERE state = 'unverified') AS unverified,
           count(*) FILTER (WHERE state = 'waiting') AS waiting, count(*) FILTER (WHERE state = 'held') AS held,
           count(*) FILTER (WHERE state = 'pulled') AS pulled, count(*) FILTER (WHERE state = 'private') AS private,
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed
    FROM fr GROUP BY day
  ),
  day_skips AS (
    SELECT day, sum(n)::bigint AS skipped, jsonb_object_agg(reason, n) AS skip_reasons
    FROM (SELECT day, reason, count(*) AS n FROM sk GROUP BY 1, 2) x GROUP BY day
  ),
  day_vehicles AS (
    SELECT x.day, jsonb_agg(jsonb_build_object('vehicle_id', v.id, 'name', trim(concat_ws(' ', v.year::text, v.make, v.model)), 'n', x.n)
                            ORDER BY x.n DESC, v.year, v.make) AS vehicles
    FROM (SELECT day, vehicle_id, count(*) AS n FROM fr WHERE state IN ('on_vehicle', 'unverified') GROUP BY 1, 2) x
    JOIN public.vehicles v ON v.id = x.vehicle_id
    GROUP BY x.day
  ),
  day_held AS (
    SELECT day, jsonb_object_agg(reason, n) AS held_reasons
    FROM (SELECT day, reason, count(*) AS n FROM fr WHERE state = 'held' GROUP BY 1, 2) y GROUP BY day
  ),
  days AS (SELECT day FROM day_frames UNION SELECT day FROM day_skips),
  per_day AS (
    SELECT d.day, COALESCE(f.taken, 0) AS taken, COALESCE(f.on_vehicle, 0) AS on_vehicle, COALESCE(f.unverified, 0) AS unverified,
           COALESCE(f.waiting, 0) AS waiting, COALESCE(f.held, 0) AS held, COALESCE(f.pulled, 0) AS pulled, COALESCE(f.private, 0) AS private,
           COALESCE(f.unsorted, 0) AS unsorted, COALESCE(f.failed, 0) AS failed, COALESCE(s.skipped, 0) AS skipped,
           COALESCE(v.vehicles, '[]'::jsonb) AS vehicles, COALESCE(h.held_reasons, '{}'::jsonb) AS held_reasons, COALESCE(s.skip_reasons, '{}'::jsonb) AS skip_reasons
    FROM days d
    LEFT JOIN day_frames f USING (day) LEFT JOIN day_skips s USING (day) LEFT JOIN day_vehicles v USING (day) LEFT JOIN day_held h USING (day)
    ORDER BY d.day DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 180), 2000))
  ),
  tot AS (
    SELECT count(*) AS taken,
           count(*) FILTER (WHERE state = 'on_vehicle') AS on_vehicle, count(*) FILTER (WHERE state = 'unverified') AS unverified,
           count(*) FILTER (WHERE state = 'waiting') AS waiting, count(*) FILTER (WHERE state = 'held') AS held,
           count(*) FILTER (WHERE state = 'pulled') AS pulled, count(*) FILTER (WHERE state = 'private') AS private,
           count(*) FILTER (WHERE state = 'unsorted') AS unsorted, count(*) FILTER (WHERE state = 'failed') AS failed,
           (SELECT count(*) FROM sk) AS skipped
    FROM fr
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'tz', p_tz,
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day DESC) FROM per_day p), '[]'::jsonb),
    'days_total', (SELECT count(*) FROM days),
    'totals', (SELECT to_jsonb(t) FROM tot t),
    'rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                WHERE r.user_id = uid.id AND r.finished_at IS NULL ORDER BY r.requested_at DESC LIMIT 1),
    'last_rescan', (SELECT to_jsonb(r) FROM public.capture_rescan_requests r, uid
                     WHERE r.user_id = uid.id AND r.finished_at IS NOT NULL ORDER BY r.finished_at DESC LIMIT 1)
  )
$fn$;
REVOKE ALL ON FUNCTION public.get_capture_ledger(text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_capture_ledger(text, date, date, integer) TO authenticated, service_role;

DO $chk$
BEGIN
  IF position('day_frames' IN pg_get_functiondef('public.get_capture_ledger(text, date, date, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'capture ledger: grouped body not installed';
  END IF;
  IF has_function_privilege('anon', 'public.get_capture_ledger(text, date, date, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capture ledger: anon must not reach the ledger';
  END IF;
END $chk$;
