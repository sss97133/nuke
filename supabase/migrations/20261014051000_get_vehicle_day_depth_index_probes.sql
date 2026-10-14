-- get_vehicle_day_depth: index probes instead of a nested aggregate, and no rows for a vehicle the caller cannot see.
--
-- 1. Speed. BarcodeTimeline calls this on every vehicle profile. Measured 2026-10-14 (pg_stat_statements since 2026-09-29):
-- anon 1,361 calls, mean 1,451 ms, max 14,956 ms. Cause, from EXPLAIN ANALYZE of the function's own statement:
--   * the planner sees the vehicle's images as one row (the parameter is unknown inside a SQL function and the
--     is_external / is_duplicate / is_superseded / coalesce(date) filters multiply the estimate down), so it joins
--     the images to the per-observation aggregate with a nested loop that runs the aggregate again for every
--     image: K5 Blazer, 1,641 images x 1,791 grouped rows, 2,937,712 rows removed by the join filter;
--   * ai_scan_metadata (about 2 KB of jsonb per image, toasted) is detoasted about seven times per image, once for each
--     place the scoring formula reads it.
-- K5 Blazer (3,716 images, 1,641 counted), the shipped statement as a forced generic plan, EXPLAIN ANALYZE on production,
-- warm, 2026-10-14:
--   before 1,657-1,780 ms   after 147-151 ms for anon, a stranger, the owner and the service role (143 ms without the visibility check)
-- The function itself, anon and deploy role, warm: 1,165-1,191 ms before. Cold it was 4,237 ms with 5,364 buffers read; after, two
-- first runs on cold pages took 2.2 s and 6.5 s. Cold time is the heap reads of the vehicle's own image rows, which this does
-- not change, and it moves with the cache and the load on the machine, so the claim is the warm number.
-- After: the images are read once into a materialized set that extracts byok_deep_analysis one time and hands the
-- scoring formula only that key; "placed" and "clip" are two EXISTS probes of idx_image_obs_image (image_id),
-- one per image. The output is identical: on production 2026-10-14 the shipped statement and the live function were compared
-- with EXCEPT in both directions over 20 vehicles (public ones as anon, a private one as its owner, a private one as the
-- service role): 321 rows, 0 differ.
-- nuke_image_depth_score is untouched: every use of p_meta in it sits behind p_seen, and p_seen is unchanged.
--
-- 2. Visibility. The function is SECURITY DEFINER, so it ignored the row policies and answered for any vehicle id.
-- Checked on production 2026-10-14: anon received per-day photo counts for 6 of 14 private vehicles sampled (21 to 50 photos
-- a vehicle), vehicles whose row anon cannot read. Counts and depth only, no money, but a private vehicle is private.
-- Now it returns no rows unless the caller may see the vehicle, resolved once:
--   * the vehicle is public (is_public true) and not deleted; or
--   * the caller is its user, owner or uploader (auth.uid()), or vehicle_user_has_access(vehicle, auth.uid()) holds; or
--   * the caller is the service role.
-- That is the vehicles select policies with one difference. The policies never read deleted_at, so a deleted public vehicle is
-- selectable by anyone; here a deleted vehicle is not public, and only its own people and the service role read its days.
-- In a 2% page sample of vehicles on 2026-10-14, 1,059 of 19,823 (5%) were public and deleted. A vehicle that does not exist
-- reaches nobody.
-- The gate is a materialized CTE read once; the image scan sits behind a one-time filter on it, so a caller who cannot see the
-- vehicle reads no image rows. On production, the shipped statement: anon on a private vehicle 0 rows in 0.5 ms (4 buffers);
-- a signed-in stranger 0 rows in 6 ms (about 1,080 buffers, the cost of vehicle_user_has_access); its owner 34 rows in 11 ms.
--
-- Return shape, SECURITY DEFINER, STABLE, search_path and grants are as they were. No table, policy, row or cron change.
-- Source guard: replaced only from the 2026-10-14 definition (md5 below), and only where vehicle_user_has_access and
-- auth.uid / auth.role exist; a re-run is a no-op.
-- Contract: supabase/sql/test_get_vehicle_day_depth_perf.sql (CI job get-vehicle-day-depth-contract).
-- definer-grants: default reviewed get_vehicle_day_depth: a public reader of the vehicle profile that now checks the vehicle's visibility itself; CREATE OR REPLACE keeps its grants (anon, authenticated, service_role) and none are changed here
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
  IF to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'vehicle_user_has_access(uuid,uuid), auth.uid() and auth.role() are needed for the visibility check and one is missing';
  END IF;
  IF md5(v_def) <> 'e8347b640d968eeee98af6511f8ca657'  -- gitleaks:allow (md5 checksum of the 2026-10-14 function definition, not a secret)
     AND v_def NOT LIKE '%day_depth_visibility_v1%' THEN
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
  -- day_depth_visibility_v1 (and the index probes, 20261014)
  with me as materialized (
    -- the caller, resolved once
    select auth.uid() as uid, auth.role() as role
  ),
  gate as materialized (
    -- the vehicle, only if this caller may see it
    select v.id
      from vehicles v cross join me
     where v.id = p_vehicle_id
       and ((v.is_public is true and v.deleted_at is null)
            or me.role = 'service_role'
            or (me.uid is not null
                and (v.user_id = me.uid or v.owner_id = me.uid or v.uploaded_by = me.uid
                     or vehicle_user_has_access(v.id, me.uid))))
  ),
  imgs as materialized (
    -- one pass over the vehicle's images; the jsonb key the score reads is pulled out once
    select i.id,
           coalesce(i.stale, false) as stale,
           (i.vision_gate_status = 'approved') as gated,
           (i.ai_scan_metadata ? 'byok_deep_analysis') as seen,
           i.ai_scan_metadata -> 'byok_deep_analysis' as deep,
           coalesce(i.taken_at::date, i.created_at::date) as d
      from vehicle_images i
     where exists (select 1 from gate)
       and i.vehicle_id = p_vehicle_id and i.is_external = false
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

-- Live verification (after apply), through PostgREST, K5 Blazer e08bf694-970f-4cbe-8a74-8715158a0f2e:
--   anon POST /rest/v1/rpc/get_vehicle_day_depth {"p_vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e"}  -- 138 rows, warm well under 0.5 s
--   (before: 138 rows, 1.2 s warm, 4.2 s cold)
--   anon, a private vehicle that returned days before (88ca807e-77de-431b-818c-52a0c9440db0, 50 photos on one day): no rows
