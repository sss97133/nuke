-- compute_active_minutes_burst_total: one pass over the vehicle's photos instead of one query per photo day.
--
-- The total looped over every distinct photo day and called compute_active_minutes_burst for each, and each
-- call read all of the vehicle's images again (taken_at::date = p_date cannot use an index), so the work was
-- days x images, every image checked against the caller's row policies each time. K5 Blazer: 138 photo days x
-- 3,716 images. It is the dominant cost of vehicle_full_picture, which the Worth panel calls on every profile:
-- pg_stat_statements since 2026-09-29, anon 606 calls, mean 2,272 ms, max 14,977 ms. The function is also read by
-- get_vehicle_documented_investment, compute_vehicle_investment_proof, get_user_reconciliation and
-- backfill_work_sessions_from_photos.
--
-- Measured 2026-10-14, K5 Blazer, as anon, warm:
--   compute_active_minutes_burst_total(K5, 30)   6,208-6,259 ms before   59.6-60.2 ms after (the same statement, one pass)
--   vehicle_full_picture(K5)                      6.84 s measured; the rest of it adds about 0.8 s warm
--     (observation count 0.61-0.75 s, images 0.06-0.08 s), so expect about 0.9 s after.
--
-- After: one window-function pass partitioned by photo day, with the per-day rule untouched (bursts split where
-- two photos are more than the gap apart; credit per burst = max(span in minutes, 5 x photos) + 10; each day rounded
-- to an integer and capped at 480; days summed). It stays SECURITY INVOKER and STABLE, so the caller's row
-- policies still decide which photos count. The answer is identical: 10 vehicles compared against the live function
-- on 2026-10-14 (K5 17,575; Mustang 10,977; four capped at 480; four with no dated photos, 0), 0 differ.
-- compute_active_minutes_burst (one day) is untouched; the total no longer calls it.
--
-- Pure replacement of one function body; the signature, default gap of 30, return type and grants are unchanged.
-- No table, policy, row or cron change. Source guard: replaced only from the 2026-10-14 definition (md5 below);
-- a re-run is a no-op.
-- Contract: supabase/sql/test_burst_total_one_pass.sql (CI job burst-total-one-pass-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.compute_active_minutes_burst_total(uuid,integer)'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.compute_active_minutes_burst_total(uuid,integer) is missing; this migration replaces it';
  END IF;
  IF md5(v_def) <> '7c2d2f3d8bf6196b9a5c6b46de945f23'  -- gitleaks:allow (md5 checksum of the 2026-10-14 function definition, not a secret)
     AND v_def NOT LIKE '%burst_total_one_pass_v1%' THEN
    RAISE EXCEPTION 'compute_active_minutes_burst_total is not the 2026-10-14 definition this migration was written from (md5 %); re-read it', md5(v_def);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.compute_active_minutes_burst_total(p_vehicle_id uuid, p_burst_gap_minutes integer DEFAULT 30)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  -- burst_total_one_pass_v1
  -- Same rule as compute_active_minutes_burst, for every photo day at once.
  WITH photos AS (
    SELECT taken_at, taken_at::date AS d,
           lag(taken_at) OVER (PARTITION BY taken_at::date ORDER BY taken_at) AS prev_taken
      FROM vehicle_images
     WHERE vehicle_id = p_vehicle_id AND taken_at IS NOT NULL
  ),
  bursts AS (
    SELECT d, taken_at,
           CASE WHEN prev_taken IS NULL OR taken_at - prev_taken > (p_burst_gap_minutes || ' min')::interval
                THEN 1 ELSE 0 END AS is_new_burst
      FROM photos
  ),
  burst_groups AS (
    SELECT d, taken_at, sum(is_new_burst) OVER (PARTITION BY d ORDER BY taken_at) AS burst_id
      FROM bursts
  ),
  burst_stats AS (
    SELECT d, burst_id, min(taken_at) AS burst_start, max(taken_at) AS burst_end, count(*) AS photos_in_burst
      FROM burst_groups
     GROUP BY d, burst_id
  ),
  per_day AS (
    -- per-burst credit = max(actual span, 5 min x photo count) + 10 min trailing; a day is rounded, then capped at 8 h
    SELECT d, COALESCE(sum(GREATEST(EXTRACT(EPOCH FROM (burst_end - burst_start)) / 60, photos_in_burst * 5) + 10)::int, 0) AS day_total
      FROM burst_stats
     GROUP BY d
  )
  SELECT COALESCE(sum(LEAST(day_total, 480)), 0)::bigint FROM per_day;
$function$;

COMMIT;

-- Live verification (after apply), as anon through PostgREST, K5 Blazer e08bf694-970f-4cbe-8a74-8715158a0f2e:
--   POST /rest/v1/rpc/compute_active_minutes_burst_total {"p_vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e"}  -- 10860, well under 0.5 s (before: 10860 in about 6.3 s)
--   POST /rest/v1/rpc/vehicle_full_picture {"p_vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e"}               -- same document as before, about 1 s warm (before: 6.8 s)
