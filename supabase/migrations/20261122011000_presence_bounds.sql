-- Presence bounds from a user's whole photo stream: one reader of time blocks, one reader of a vehicle's floor and ceiling.
--
-- Why. Labor on a car is bounded by where its owner was. A photo of this car proves presence with it; a photo of another
-- car, or a record away from every site of his, proves he was elsewhere then; an unfiled photo at his site leaves the
-- subject open. That needs only the record's time, its vehicle, its first-read type and its distance to user_sites: every
-- record counts, filed or not, any subject, including records whose picture never uploaded (empty image_url). The
-- interior appraisal computed this in a scratch script; the owner asked that it live in code, not in written words.
--
-- What this adds.
--   user_presence_blocks(p_user, p_from, p_to, p_tz)  one row per time block of that user's records whose capture time
--     (taken_at, else created_at) falls on local days p_from..p_to in p_tz. A block is a run of records on one local day
--     with the same kind and vehicle; a gap over 3 hours starts a new block. kind is one of: on_vehicle (the record is
--     filed to vehicle_id), at_site_unknown_subject (unfiled, within radius_m of one of the user's sites), away (unfiled,
--     located, outside every site), no_location (unfiled, no latitude or longitude). Returns start, end, minutes, the
--     record count, how many have no image, and the first-read types (ai_scan_metadata.classification.image_type,
--     'unread' when absent) with counts. Never a coordinate, a site name or a picture.
--   vehicle_presence_bounds(p_vehicle, p_from, p_to, p_tz, p_user)  over the same blocks of one user's stream:
--     floor   = minutes inside blocks on this vehicle.
--     ceiling = on each day with a block on this vehicle or at a site with the subject unknown, the day span (first to
--               last record) minus the time that belongs to a block proven elsewhere (on another vehicle, or away). Each
--               moment of a day span belongs to its nearest record: inside a block to the block, between two blocks split
--               at the midpoint. So a single away or other-car record lowers the ceiling by the half-gaps around it.
--     with block, day and record counts behind each, and the minutes removed for other vehicles and for away.
--     p_user defaults to the caller; the service role may name any user and defaults to the vehicle's owner.
-- Access. Both readers are SECURITY DEFINER. user_presence_blocks serves only the user himself or the service role;
-- vehicle_presence_bounds serves a signed-in caller who may edit the vehicle (user_can_edit_vehicle) over his own stream,
-- or the service role. Anyone else gets SQLSTATE 42501. EXECUTE is revoked from PUBLIC and anon.
-- Performance. The range predicate is on coalesce(taken_at, created_at), served by
-- idx_vehicle_images_user_contrib_day (user_id, COALESCE(taken_at, created_at)); the guard refuses without it.
-- Measured 2026-11-21 on production with the same SQL run read-only (functions not created there): the owner's
-- interior window, 2024-09-11..2026-08-26, America/Los_Angeles, 11,128 records: cold 5,378 ms (9,501 blocks read from
-- disk), warm 327 ms, both through idx_vehicle_images_user_contrib_day.
-- Guard: refuses unless user_can_edit_vehicle(uuid,uuid), auth.uid(), auth.role(), the columns read here and the index exist.
-- Contract: supabase/sql/test_presence_bounds.sql
-- Revert: supabase/sql/revert_20261122011000_presence_bounds.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $do$
declare
  v_missing text;
begin
  SELECT string_agg(f, ', ') INTO v_missing FROM unnest(ARRAY[
      'public.user_can_edit_vehicle(uuid,uuid)', 'auth.uid()', 'auth.role()']) f
   WHERE to_regprocedure(f) IS NULL;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'helpers these readers call are not live: %', v_missing; END IF;
  SELECT string_agg(c, ', ') INTO v_missing FROM unnest(ARRAY[
      'vehicle_images.user_id', 'vehicle_images.vehicle_id', 'vehicle_images.taken_at', 'vehicle_images.created_at',
      'vehicle_images.image_url', 'vehicle_images.latitude', 'vehicle_images.longitude', 'vehicle_images.ai_scan_metadata',
      'user_sites.user_id', 'user_sites.lat', 'user_sites.lon', 'user_sites.radius_m',
      'vehicles.owner_id', 'vehicles.user_id', 'vehicles.uploaded_by']) c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public'
                      AND ic.table_name = split_part(c, '.', 1) AND ic.column_name = split_part(c, '.', 2));
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'columns these readers read are missing: %', v_missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vehicle_images'
                  AND indexdef ~* '\(user_id, COALESCE\(taken_at, created_at\)\)') THEN
    RAISE EXCEPTION 'vehicle_images has no index on (user_id, COALESCE(taken_at, created_at)); refusing';
  END IF;
end $do$;

CREATE OR REPLACE FUNCTION public.user_presence_blocks(p_user uuid, p_from date, p_to date, p_tz text)
RETURNS TABLE(day date, block_start timestamptz, block_end timestamptz, minutes numeric, photo_count integer,
              no_image_count integer, kind text, vehicle_id uuid, first_read_types jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR (auth.uid() IS NOT NULL AND auth.uid() = p_user)) THEN
    RAISE EXCEPTION 'user_presence_blocks: only the user or the service role reads this photo stream' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL OR p_from IS NULL OR p_to IS NULL OR p_tz IS NULL THEN
    RAISE EXCEPTION 'user_presence_blocks: user, from, to and time zone are required' USING ERRCODE = '22004';
  END IF;
  PERFORM now() AT TIME ZONE p_tz;  -- an unknown zone fails here, before any read
  RETURN QUERY
  -- presence-blocks:begin
  WITH s AS MATERIALIZED (
    SELECT us.lat::float8 AS lat, us.lon::float8 AS lon, us.radius_m::float8 AS radius_m
      FROM public.user_sites us
     WHERE us.user_id = p_user AND us.lat IS NOT NULL AND us.lon IS NOT NULL AND us.radius_m IS NOT NULL
  ), r AS MATERIALIZED (
    SELECT coalesce(vi.taken_at, vi.created_at) AS ts, vi.vehicle_id AS v,
           coalesce(nullif(vi.ai_scan_metadata -> 'classification' ->> 'image_type', ''), 'unread') AS t,
           (vi.image_url IS NULL OR vi.image_url = '') AS no_image,
           vi.latitude::float8 AS la, vi.longitude::float8 AS lo
      FROM public.vehicle_images vi
     WHERE vi.user_id = p_user
       AND coalesce(vi.taken_at, vi.created_at) >= (p_from::timestamp AT TIME ZONE p_tz)
       AND coalesce(vi.taken_at, vi.created_at) < ((p_to + 1)::timestamp AT TIME ZONE p_tz)
  ), k AS (
    SELECT r.ts, (r.ts AT TIME ZONE p_tz)::date AS d, r.v, r.t, r.no_image,
           CASE WHEN r.v IS NOT NULL THEN 'on_vehicle'
                WHEN r.la IS NULL OR r.lo IS NULL THEN 'no_location'
                WHEN EXISTS (SELECT 1 FROM s WHERE 2 * 6371008.8 * asin(least(1, sqrt(
                       power(sin(radians(r.la - s.lat) / 2), 2)
                       + cos(radians(s.lat)) * cos(radians(r.la)) * power(sin(radians(r.lo - s.lon) / 2), 2)))) <= s.radius_m)
                  THEN 'at_site_unknown_subject'
                ELSE 'away' END AS kd
      FROM r
  ), o AS (
    SELECT k.*, lag(k.ts) OVER w AS prev_ts, lag(k.kd) OVER w AS prev_kd, lag(k.v) OVER w AS prev_v
      FROM k WINDOW w AS (PARTITION BY k.d ORDER BY k.ts, k.kd, k.v)
  ), g AS (
    SELECT o.*, sum(CASE WHEN o.prev_ts IS NULL OR o.kd <> o.prev_kd OR o.v IS DISTINCT FROM o.prev_v
                          OR o.ts - o.prev_ts > interval '3 hours' THEN 1 ELSE 0 END)
                  OVER (PARTITION BY o.d ORDER BY o.ts, o.kd, o.v ROWS UNBOUNDED PRECEDING) AS blk
      FROM o
  ), tc AS (
    SELECT g.d, g.blk, jsonb_object_agg(g.t, g.n ORDER BY g.t) AS types
      FROM (SELECT g.d, g.blk, g.t, count(*)::int AS n FROM g GROUP BY g.d, g.blk, g.t) g
     GROUP BY g.d, g.blk
  )
  SELECT g.d, min(g.ts), max(g.ts), round((extract(epoch FROM max(g.ts) - min(g.ts)) / 60)::numeric, 2),
         count(*)::int, (count(*) FILTER (WHERE g.no_image))::int, min(g.kd), (array_agg(g.v))[1], min(tc.types::text)::jsonb
    FROM g JOIN tc ON tc.d = g.d AND tc.blk = g.blk
   GROUP BY g.d, g.blk
   ORDER BY min(g.ts), g.d, g.blk
  -- presence-blocks:end
  ;
END
$fn$;

CREATE OR REPLACE FUNCTION public.vehicle_presence_bounds(p_vehicle uuid, p_from date, p_to date, p_tz text, p_user uuid DEFAULT NULL)
RETURNS TABLE(floor_minutes numeric, ceiling_minutes numeric, floor_blocks integer, floor_days integer, ceiling_days integer,
              days_in_range integer, days_with_record integer, records integer, records_no_image integer,
              records_on_vehicle integer, records_other_vehicle integer, records_at_site_unknown integer, records_away integer,
              records_no_location integer, blocks_on_vehicle integer, blocks_other_vehicle integer, blocks_at_site_unknown integer,
              blocks_away integer, blocks_no_location integer, minutes_removed_other_vehicle numeric, minutes_removed_away numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_user uuid;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    v_user := coalesce(p_user, (SELECT coalesce(v.owner_id, v.user_id, v.uploaded_by) FROM public.vehicles v WHERE v.id = p_vehicle));
  ELSIF v_uid IS NOT NULL AND (p_user IS NULL OR p_user = v_uid) AND public.user_can_edit_vehicle(p_vehicle, v_uid) THEN
    v_user := v_uid;
  ELSE
    RAISE EXCEPTION 'vehicle_presence_bounds: only someone who may edit this vehicle, over his own photo stream, or the service role'
      USING ERRCODE = '42501';
  END IF;
  IF p_vehicle IS NULL OR p_from IS NULL OR p_to IS NULL OR p_tz IS NULL THEN
    RAISE EXCEPTION 'vehicle_presence_bounds: vehicle, from, to and time zone are required' USING ERRCODE = '22004';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'vehicle_presence_bounds: no user stream to read for this vehicle' USING ERRCODE = '22004';
  END IF;
  RETURN QUERY
  -- presence-bounds:begin
  WITH b AS MATERIALIZED (
    SELECT * FROM public.user_presence_blocks(v_user, p_from, p_to, p_tz)
  ), c AS (
    SELECT b.*, CASE WHEN b.kind = 'on_vehicle' AND b.vehicle_id = p_vehicle THEN 'this'
                     WHEN b.kind = 'on_vehicle' THEN 'other' ELSE b.kind END AS st,
           lag(b.block_end) OVER w AS prev_end, lead(b.block_start) OVER w AS next_start
      FROM b WINDOW w AS (PARTITION BY b.day ORDER BY b.block_start, b.block_end)
  ), a AS (
    SELECT c.*, extract(epoch FROM coalesce(c.block_end + (c.next_start - c.block_end) / 2, c.block_end)
                                - coalesce(c.prev_end + (c.block_start - c.prev_end) / 2, c.block_start)) / 60 AS owned
      FROM c
  ), q AS (
    SELECT a.day FROM a GROUP BY a.day HAVING bool_or(a.st IN ('this', 'at_site_unknown_subject'))
  )
  SELECT round(coalesce(sum(a.minutes) FILTER (WHERE a.st = 'this'), 0), 1),
         round(coalesce(sum(a.owned) FILTER (WHERE a.st NOT IN ('other', 'away') AND a.day IN (SELECT q.day FROM q)), 0)::numeric, 1),
         (count(*) FILTER (WHERE a.st = 'this'))::int,
         (count(DISTINCT a.day) FILTER (WHERE a.st = 'this'))::int,
         (SELECT count(*) FROM q)::int,
         greatest(p_to - p_from + 1, 0),
         (count(DISTINCT a.day))::int,
         coalesce(sum(a.photo_count), 0)::int,
         coalesce(sum(a.no_image_count), 0)::int,
         coalesce(sum(a.photo_count) FILTER (WHERE a.st = 'this'), 0)::int,
         coalesce(sum(a.photo_count) FILTER (WHERE a.st = 'other'), 0)::int,
         coalesce(sum(a.photo_count) FILTER (WHERE a.st = 'at_site_unknown_subject'), 0)::int,
         coalesce(sum(a.photo_count) FILTER (WHERE a.st = 'away'), 0)::int,
         coalesce(sum(a.photo_count) FILTER (WHERE a.st = 'no_location'), 0)::int,
         (count(*) FILTER (WHERE a.st = 'this'))::int,
         (count(*) FILTER (WHERE a.st = 'other'))::int,
         (count(*) FILTER (WHERE a.st = 'at_site_unknown_subject'))::int,
         (count(*) FILTER (WHERE a.st = 'away'))::int,
         (count(*) FILTER (WHERE a.st = 'no_location'))::int,
         round(coalesce(sum(a.owned) FILTER (WHERE a.st = 'other' AND a.day IN (SELECT q.day FROM q)), 0)::numeric, 1),
         round(coalesce(sum(a.owned) FILTER (WHERE a.st = 'away' AND a.day IN (SELECT q.day FROM q)), 0)::numeric, 1)
    FROM a
  -- presence-bounds:end
  ;
END
$fn$;

REVOKE ALL ON FUNCTION public.user_presence_blocks(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vehicle_presence_bounds(uuid, date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_presence_blocks(uuid, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_presence_bounds(uuid, date, date, text, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.user_presence_blocks(uuid, date, date, text) IS
  'Time blocks of one user''s whole photo stream on local days p_from..p_to in p_tz: every vehicle_images record, filed or '
  'not, with or without a picture; a gap over 3 h starts a block; kind on_vehicle | at_site_unknown_subject | away | '
  'no_location from vehicle_id, distance to user_sites and location presence. No coordinates. The user or the service role '
  'only. Created by 20261122011000.';
COMMENT ON FUNCTION public.vehicle_presence_bounds(uuid, date, date, text, uuid) IS
  'Floor (minutes in blocks on this vehicle) and ceiling (day spans with this vehicle or an unknown-subject site block, '
  'minus time nearest a block on another vehicle or away) from user_presence_blocks, with the counts behind each. A caller '
  'who may edit the vehicle over his own stream, or the service role. Created by 20261122011000.';

commit;
