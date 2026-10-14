-- get_vehicle_day_depth: per-image placement and clip flags become index probes; same rows, same answer.
--
-- BarcodeTimeline calls this on every vehicle profile. Measured 2026-10-14 (pg_stat_statements since 2026-09-29):
-- anon 1,361 calls, mean 1,451 ms, max 14,956 ms. Cause, from EXPLAIN ANALYZE of the function's own statement:
--   * the planner sees the vehicle's images as one row (the parameter is unknown inside a SQL function and the
--     is_external / is_duplicate / is_superseded / coalesce(date) filters multiply the estimate down), so it joins
--     the images to the per-observation aggregate with a nested loop that runs the aggregate again for every
--     image: K5 Blazer, 1,641 images x 1,791 grouped rows, 2,937,712 rows removed by the join filter;
--   * ai_scan_metadata (about 2 KB of jsonb per image, toasted) is detoasted about seven times per image, once for each
--     place the scoring formula reads it.
-- K5 Blazer (3,716 images, 1,641 counted), the function's statement as a forced generic plan, warm:
--   before 1,657-1,780 ms   after 148-151 ms
-- The function itself, anon and deploy role, warm: 1,165-1,191 ms before. Cold it is 4,237 ms, 5,364 buffers read:
-- the vehicle's image rows still have to be read from the heap, which this does not change.
--
-- After: the images are read once into a materialized set that extracts byok_deep_analysis one time and hands the
-- scoring formula only that key; "placed" and "clip" are two EXISTS probes of idx_image_obs_image (image_id),
-- one per image. The output is identical: 236 rows over six vehicles (K5 Blazer, Mustang, a live BaT lot, three
-- smaller ones, one with no images) compared with EXCEPT in both directions on 2026-10-14, 0 rows differ.
-- nuke_image_depth_score is untouched: every use of p_meta in it sits behind p_seen, and p_seen is unchanged.
--
-- Not changed here: the function is SECURITY DEFINER and does not check that the vehicle is public, as before;
-- it returns per-day photo counts and depth for any id it is given. Reported to the lead for its own change.
-- Return shape, SECURITY DEFINER, STABLE, search_path and grants are as they were. No table, policy, row or cron change.
-- Source guard: replaced only from the 2026-10-14 definition (md5 below); a re-run is a no-op.
-- Contract: supabase/sql/test_get_vehicle_day_depth_perf.sql (CI job get-vehicle-day-depth-contract).
-- definer-grants: default reviewed get_vehicle_day_depth: an existing public reader of the vehicle profile; CREATE OR REPLACE keeps its grants (anon, authenticated, service_role) and none are changed here
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.get_vehicle_day_depth(uuid)'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.get_vehicle_day_depth(uuid) is missing; this migration replaces it';
  END IF;
  IF to_regprocedure('public.nuke_image_depth_score(boolean,boolean,jsonb,boolean,boolean,boolean,boolean,boolean)') IS NULL THEN
    RAISE EXCEPTION 'public.nuke_image_depth_score is missing; get_vehicle_day_depth scores with it';
  END IF;
  IF md5(v_def) <> 'e8347b640d968eeee98af6511f8ca657'  -- gitleaks:allow (md5 checksum of the 2026-10-14 function definition, not a secret)
     AND v_def NOT LIKE '%day_depth_index_probes_v1%' THEN
    RAISE EXCEPTION 'get_vehicle_day_depth is not the 2026-10-14 definition this migration was written from (md5 %); re-read it', md5(v_def);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_vehicle_day_depth(p_vehicle_id uuid)
 RETURNS TABLE(day date, photos integer, seen integer, placed integer, depth numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- day_depth_index_probes_v1
  with imgs as materialized (
    -- one pass over the vehicle's images; the jsonb key the score reads is pulled out once
    select i.id,
           coalesce(i.stale, false) as stale,
           (i.vision_gate_status = 'approved') as gated,
           (i.ai_scan_metadata ? 'byok_deep_analysis') as seen,
           i.ai_scan_metadata -> 'byok_deep_analysis' as deep,
           coalesce(i.taken_at::date, i.created_at::date) as d
      from vehicle_images i
     where i.vehicle_id = p_vehicle_id and i.is_external = false
       and coalesce(i.is_duplicate, false) = false and coalesce(i.is_superseded, false) = false
       and coalesce(i.taken_at::date, i.created_at::date) is not null
  ),
  confirmed_days as (
    select distinct session_date from work_sessions
     where vehicle_id = p_vehicle_id and owner_confirmed_at is not null
  ),
  j as (
    -- placed / clip: an active observation of this vehicle on the image, with or without a CLIP embedding,
    -- as an index probe per image instead of a join to a per-observation aggregate
    select i.d, i.gated, i.seen, i.stale,
           case when i.seen then jsonb_build_object('byok_deep_analysis', i.deep) end as meta,
           exists (select 1 from image_observations o
                    where o.image_id = i.id and o.vehicle_id = p_vehicle_id and coalesce(o.is_active, true)) as placed,
           exists (select 1 from image_observations o
                    where o.image_id = i.id and o.vehicle_id = p_vehicle_id and coalesce(o.is_active, true)
                      and o.embedding_clip_vitb32 is not null) as clip,
           (cd.session_date is not null) as confirmed
      from imgs i
      left join confirmed_days cd on cd.session_date = i.d
  )
  select d,
    count(*)::int,
    count(*) filter (where seen)::int,
    count(*) filter (where placed)::int,
    coalesce(round(avg(nuke_image_depth_score(gated, seen, meta, placed, clip, false, confirmed, stale)), 4), 0)
  from j group by d order by d;
$function$;

COMMIT;

-- Live verification (after apply), as anon through PostgREST, K5 Blazer e08bf694-970f-4cbe-8a74-8715158a0f2e:
--   POST /rest/v1/rpc/get_vehicle_day_depth {"p_vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e"}  -- 138 rows, warm well under 0.5 s
--   (before: 138 rows, 1.2 s warm, 4.2 s cold)
