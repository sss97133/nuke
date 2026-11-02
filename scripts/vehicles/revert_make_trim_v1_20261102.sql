-- Revert for supabase/migrations/20261108110000_vehicles_trim_make_guard.sql and
-- 20261108110100_vehicles_trim_make_backfill.sql (run make_trim_v1_20261102). No transaction control in this file:
-- run it inside your own transaction and check the counts before you finish it.
--
-- 1) The guard has to go first, otherwise it trims the restored values again.
DROP TRIGGER IF EXISTS trg_00_trim_make ON public.vehicles;

-- 2) Restore the exact original make for every row the run trimmed (only if it still holds the trimmed value).
UPDATE public.vehicles v
SET make = l.make_before
FROM public.vehicle_make_trim_log l
WHERE l.run_id = 'make_trim_v1_20261102'
  AND l.action = 'trimmed'
  AND l.reverted_at IS NULL
  AND v.id = l.vehicle_id
  AND v.make = l.make_after;

-- 3) Mark the log rows as reverted (the log itself is kept).
UPDATE public.vehicle_make_trim_log l
SET reverted_at = now()
FROM public.vehicles v
WHERE l.run_id = 'make_trim_v1_20261102'
  AND l.action = 'trimmed'
  AND l.reverted_at IS NULL
  AND v.id = l.vehicle_id
  AND v.make = l.make_before;

-- 4) Drop the guard function (nothing else uses it).
DROP FUNCTION IF EXISTS public.trim_vehicle_make();
