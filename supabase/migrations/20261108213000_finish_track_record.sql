-- finish_track_record(): how often the live board's finish estimates have been right, for anyone to read.
--
-- The board shows each live lot's likely finish and its 80% range (live_finish_estimates, models 32 and 33). The graded
-- record behind it sat in v_prediction_lot_grades, which anon cannot read, so a logged-out buyer saw a range with no
-- way to judge it. This reader returns aggregates only: per model and per window of hours before the close, the lots
-- graded, how many finished inside / below / above the range, how many sold, the median miss and the close dates.
-- No lot, vehicle, price or prediction row leaves it.
--
-- The grade. Rows the lot grader (grade_hammer_predictions_by_lot) keyed to their lot (auction_event_id, lot_outcome,
-- lot_close_at), made before the close. The final bid is the hammer when the lot sold and the high bid when the
-- reserve was not met: the estimate is where bidding finishes, and its ranges were calibrated on both (contract:
-- docs/market/MARKET_MEASUREMENT_UI_CONTRACT.md, "Where a live lot should finish"). Cancelled and no-sale lots have no
-- final bid and are left out. A lot counts once per window, by its last estimate in that window, so a lot the writer
-- touched every hour weighs the same as one it touched once. Windows: under 1 h, 1-6 h, 6-24 h, 24-72 h, 72 h and more.
--
-- Held out. predicted_at is the Mac writer's clock. The 2,355 model 32/33 rows of the run stamped 2026-11-07 21:24Z
-- were written while that clock ran 3 h 35 min slow (the run happened about 00:59Z on 11-08), so each row's hours to
-- close are overstated by that much and it would be graded in the wrong window. They are excluded by their stamp
-- window, and the payload names the window, its row count and why ('held_out').
--
-- Measured on prod before writing (2026-11-08 16:14Z, read-only): 5,578 graded lot-windows; e.g. model 33, 24-72 h:
-- 448 of 555 lots inside the range, median miss 16.6%, closes 2026-10-17..10-20. Every graded row was written
-- 2026-10-14..10-18 PT; nothing schedules the grader, so later runs are not graded yet.
-- Definer, read-only, pinned path; executable by anon. Contract: supabase/sql/test_finish_track_record.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.finish_track_record()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH fault AS (
    SELECT f.from_at, f.to_at, f.reason
    FROM (VALUES (timestamptz '2026-11-07 21:24:00+00', timestamptz '2026-11-07 21:25:00+00',
                  'written by the Mac writer while its clock ran 3 h 35 min slow, so hours to close are overstated')) f(from_at, to_at, reason)
  ), g AS (
    SELECT p.model_version AS model, p.auction_event_id AS lot, p.predicted_at, p.lot_close_at AS close_at, p.lot_outcome,
           p.predicted_low AS lo, p.predicted_hammer AS est, p.predicted_high AS hi,
           CASE WHEN p.lot_outcome = 'sold' AND ae.winning_bid > 0 THEN ae.winning_bid
                WHEN p.lot_outcome = 'reserve_not_met' AND ae.high_bid > 0 THEN ae.high_bid END AS final,
           extract(epoch FROM p.lot_close_at - p.predicted_at) / 3600.0 AS hours
    FROM public.hammer_predictions p
    JOIN public.auction_events ae ON ae.id = p.auction_event_id
    WHERE p.model_version IN (32, 33)
      AND p.lot_outcome IN ('sold', 'reserve_not_met')
      AND p.predicted_at <= p.lot_close_at
      AND p.predicted_low IS NOT NULL AND p.predicted_hammer IS NOT NULL AND p.predicted_high IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM fault f WHERE p.predicted_at >= f.from_at AND p.predicted_at < f.to_at)
  ), b AS (
    SELECT g.*, hz.from_hours, hz.to_hours
    FROM g
    JOIN (VALUES (0, 1), (1, 6), (6, 24), (24, 72), (72, NULL)) hz(from_hours, to_hours)
      ON g.hours >= hz.from_hours AND (hz.to_hours IS NULL OR g.hours < hz.to_hours)
    WHERE g.final IS NOT NULL
  ), one AS (
    -- one call per lot and horizon: the last estimate the lot had in that window
    SELECT DISTINCT ON (b.model, b.lot, b.from_hours) b.*
    FROM b ORDER BY b.model, b.lot, b.from_hours, b.predicted_at DESC
  ), agg AS (
    SELECT o.model, o.from_hours, o.to_hours, count(*) AS lots,
           count(*) FILTER (WHERE o.final BETWEEN o.lo AND o.hi) AS inside,
           count(*) FILTER (WHERE o.final < o.lo) AS below,
           count(*) FILTER (WHERE o.final > o.hi) AS above,
           count(*) FILTER (WHERE o.lot_outcome = 'sold') AS sold,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(o.est - o.final) / o.final))::numeric * 100, 1) AS median_miss_pct,
           min(o.close_at) AS first_close, max(o.close_at) AS last_close
    FROM one o GROUP BY o.model, o.from_hours, o.to_hours
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'rule', 'Each lot counts once per window: its last estimate made that many hours before the close, against the final bid '
            || '(the hammer when it sold, the high bid when the reserve was not met). Inside = the final bid fell in the 80% range.',
    'columns', jsonb_build_array('model', 'from_hours', 'to_hours', 'lots', 'inside', 'below', 'above', 'sold',
                                 'median_miss_pct', 'first_close', 'last_close'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_array(a.model, a.from_hours, a.to_hours, a.lots, a.inside, a.below, a.above,
                                                          a.sold, a.median_miss_pct, a.first_close, a.last_close)
                                       ORDER BY a.model, a.from_hours) FROM agg a), '[]'::jsonb),
    'held_out', (SELECT jsonb_agg(jsonb_build_object('from', f.from_at, 'to', f.to_at, 'reason', f.reason,
                         'rows', (SELECT count(*) FROM public.hammer_predictions p
                                  WHERE p.model_version IN (32, 33) AND p.predicted_at >= f.from_at AND p.predicted_at < f.to_at)))
                 FROM fault f)
  );
$$;

COMMENT ON FUNCTION public.finish_track_record() IS
  'How often the live finish estimates (models 32, 33) were right: per model and window of hours before the close, '
  'lots graded, final bids inside / below / above the 80% range, sold, median miss %, first and last close. '
  'Aggregates only. Rows from a known writer clock fault are held out and named in held_out.';

REVOKE ALL ON FUNCTION public.finish_track_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_track_record() TO anon, authenticated, service_role;

COMMIT;
