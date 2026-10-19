-- claim_metric_queue_ids: an attempt makes a row 20 minutes younger in the order, not last.
--
-- MEASURED (prod, 2026-10-15 11:23Z, after #1509 deployed 10:24:40Z): the oldest queue row sat at queued_at 09:54:44 for over 45 minutes.
-- It is not heavy (222 observations, index-only count plan); it has attempts = 1, a mark left by a cancelled run it shared a chunk
-- with. The queue holds 13,889 rows with attempts 0 (oldest 10:26:30) and 85 with attempts 1 (oldest 09:54:44). The fast lane orders by
-- attempts first, so while fresh rows keep arriving (Mecum, about 12 thousand an hour) an attempts-1 row is never reached; the slow
-- lane takes only attempts of 2 or more. drain-metric-slow ran every 5 minutes and succeeded (0.1 to 1.6 s each), with nothing to do.
--
-- WHAT. ORDER BY queued_at + attempts * 20 minutes, then vehicle_id. A row that was marked once waits behind rows queued up to 20
-- minutes after it, no longer behind every fresh row; a vehicle that really is heavy still reaches attempts 2 after two cancelled
-- runs and moves to the slow lane. Same rows, same writes, a different order.
CREATE OR REPLACE FUNCTION public.claim_metric_queue_ids(p_min_attempts integer, p_max_attempts integer, p_limit integer)
RETURNS uuid[]
LANGUAGE sql
AS $$
  WITH c AS (
    SELECT vehicle_id FROM public.vehicle_metric_recompute_queue
    WHERE coalesce(attempts, 0) BETWEEN p_min_attempts AND p_max_attempts
    ORDER BY queued_at + coalesce(attempts, 0) * interval '20 minutes', vehicle_id
    LIMIT least(greatest(p_limit, 1), 50) FOR UPDATE SKIP LOCKED),
  u AS (
    UPDATE public.vehicle_metric_recompute_queue q SET attempts = coalesce(q.attempts, 0) + 1
    FROM c WHERE q.vehicle_id = c.vehicle_id RETURNING q.vehicle_id)
  SELECT coalesce(array_agg(vehicle_id), '{}'::uuid[]) FROM u
$$;
