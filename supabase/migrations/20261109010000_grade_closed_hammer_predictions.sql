-- grade_closed_hammer_predictions(): grade the live finish estimates every hour, as their lots close.
--
-- WHY. grade_hammer_predictions_by_lot (20261007170000) keys each prediction to its BaT lot and grades it, one heap block
-- range per call. Nothing schedules it (no cron, no script on 2026-11-08), so the 4,668 model 32/33 rows written since
-- 2026-11-07 stay ungraded and finish_track_record() (20261108213000) stops at lots closed 2026-10-24.
--
-- WHAT. Each run finds the rows a grade can now land on: no lot key yet, models 31 (live band), 32 and 33 (finish
-- estimates), made in the last 30 days, whose own recorded close (predicted_at + hours_remaining) has passed, and not
-- written for another house (notes.house; the grader keys BaT lot slugs only, so such rows would never resolve). It groups
-- their heap blocks into ranges (a gap of more than 16 blocks starts a new range, and no range spans more than 200: one
-- call costs ~150 ms however small, 200 blocks ~0.5 s, 2,000 blocks 27 s; the grader's read timed on prod 2026-11-08),
-- newest closes first, and calls the grader on each range
-- until the time budget is spent. A row the grader holds (lot not settled yet, ambiguous, no close clock) stays unkeyed and
-- is tried again next hour until it is 30 days old; a run that runs out of budget leaves the rest to the next. The first
-- run is the backfill of everything since 2026-11-07. Rows from the writer's 2026-11-07 21:24Z clock fault are graded
-- like the others; finish_track_record() holds them out.
-- The rows the grader writes are counted in write_receipts by the grader itself (writer grade-hammer-predictions-by-lot).
-- Contract: supabase/sql/test_grade_closed_hammer_predictions.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.grade_closed_hammer_predictions(p_budget_ms integer DEFAULT 40000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_gap constant bigint := 16;  -- blocks between two targets that one call scans rather than making a second call
  c_span constant bigint := 200;  -- most blocks one call scans (~0.5 s measured; 2,000 blocks took 27 s)
  v_start timestamptz := clock_timestamp();
  v_rpp numeric;
  v_res jsonb;
  r record;
  v_ranges integer := 0;
  v_calls integer := 0;
  v_blocks bigint := 0;
  v_targets bigint := 0;
  v_graded bigint := 0;
  v_held bigint := 0;
  v_written bigint := 0;
  v_lots bigint := 0;
  v_left integer := 0;
BEGIN
  IF p_budget_ms IS NULL OR p_budget_ms < 1000 OR p_budget_ms > 50000 THEN
    RAISE EXCEPTION 'grade_closed_hammer_predictions: p_budget_ms must be 1000..50000, got %', p_budget_ms;
  END IF;

  -- The grader turns p_batch into blocks with this same estimate; floor(blocks * rows per page) gives back the blocks.
  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 20 END
    INTO v_rpp FROM pg_catalog.pg_class WHERE oid = 'public.hammer_predictions'::regclass;

  FOR r IN
    WITH t AS (
      SELECT (h.ctid::text::point)[0]::bigint AS blk,
             h.predicted_at + h.hours_remaining * interval '1 hour' AS own_close
      FROM public.hammer_predictions h
      WHERE h.auction_event_id IS NULL
        AND h.model_version IN (31, 32, 33)
        AND h.predicted_at > now() - interval '30 days'
        AND h.hours_remaining IS NOT NULL
        AND h.predicted_at + h.hours_remaining * interval '1 hour' < now()
        AND NOT coalesce(CASE WHEN h.notes IS JSON OBJECT THEN h.notes::jsonb ? 'house' END, false)
    ), b AS (
      SELECT blk, count(*) AS n, max(own_close) AS last_close FROM t GROUP BY blk
    ), s AS (
      SELECT b.*, CASE WHEN blk - lag(blk) OVER (ORDER BY blk) <= c_gap THEN 0 ELSE 1 END AS starts FROM b
    ), g AS (
      SELECT s.*, sum(starts) OVER (ORDER BY blk) AS grp FROM s
    ), c AS (
      SELECT g.*, (blk - min(blk) OVER (PARTITION BY grp)) / c_span AS part FROM g
    )
    SELECT min(blk) AS from_blk, max(blk) AS to_blk, sum(n) AS n, max(last_close) AS last_close
    FROM c GROUP BY grp, part
    ORDER BY max(last_close) DESC, min(blk)
  LOOP
    v_ranges := v_ranges + 1;
    v_targets := v_targets + r.n;
    IF clock_timestamp() - v_start > p_budget_ms * interval '1 millisecond' THEN
      v_left := v_left + 1;
      CONTINUE;
    END IF;
    v_res := public.grade_hammer_predictions_by_lot(
      least(100000, greatest(1, floor((r.to_blk - r.from_blk + 1) * v_rpp)))::integer, r.from_blk);
    v_calls := v_calls + 1;
    v_blocks := v_blocks + coalesce((v_res->>'blocks_scanned')::bigint, 0);
    v_graded := v_graded + coalesce((v_res->>'graded')::bigint, 0);
    v_held := v_held + coalesce((v_res->>'held')::bigint, 0);
    v_written := v_written + coalesce((v_res->>'written')::bigint, 0);
    v_lots := v_lots + coalesce((v_res->>'lots')::bigint, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'target_rows', v_targets, 'ranges', v_ranges, 'calls', v_calls, 'blocks_scanned', v_blocks,
    'written', v_written, 'lots', v_lots, 'graded_sold', v_graded, 'graded_sold_inside_band', v_held,
    'ranges_left', v_left, 'ms', round(extract(epoch FROM clock_timestamp() - v_start) * 1000));
END
$fn$;

COMMENT ON FUNCTION public.grade_closed_hammer_predictions(integer) IS
  'Hourly: calls grade_hammer_predictions_by_lot on the heap block ranges that hold unkeyed model 31/32/33 rows from the '
  'last 30 days whose recorded close has passed (BaT only), newest closes first, within p_budget_ms. Returns counts.';

REVOKE ALL ON FUNCTION public.grade_closed_hammer_predictions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grade_closed_hammer_predictions(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grade_closed_hammer_predictions(integer) TO service_role;

-- The grader asks its caller for a statement_timeout of at most 60 s; the budget leaves 15 s for the last call.
DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'grade-closed-hammer-predictions' LOOP PERFORM cron.unschedule(j); END LOOP;
  PERFORM cron.schedule('grade-closed-hammer-predictions', '20 * * * *',
    $cmd$SET statement_timeout = '55s'; SELECT public.grade_closed_hammer_predictions(40000);$cmd$);
END $$;

COMMIT;
