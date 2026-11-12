-- vehicle_location_fold: one index probe per photo, not a rescan of the vehicle's photos for each one.
--
-- WHY. 20261116026000 (live 2026-11-12 06:18Z) added the point test, so the fold can read idx_vehicle_images_gps_cover.
-- The planner estimates one row for the ids CTE. With a plain join it chose an index-only scan on vehicle_id alone,
-- rescanned once per photo, with id as a join filter. On 043c6d8b (2,476 photos, 1,238 cover entries) that is 3.06M
-- rows filtered and 3.2M buffer hits: vehicle_location_areas took 2.2 s warm in-DB and 2.7-3.9 s for anon. It was
-- 61 ms warm on the primary key before 026000.
-- WHAT. The photos CTE reads each photo through a LATERAL subquery with OFFSET 0 (marker photo_gps_cover_v2). The
-- subquery is not flattened, so p.image_id is an index condition: one index-only probe on (vehicle_id, id) per photo.
-- Same predicates, columns, signature, language, grants and owner.
-- Measured on prod read-only (the photos query standalone, 043c6d8b, 2026-11-12 06:2xZ): Index Only Scan using
-- idx_vehicle_images_gps_cover, Index Cond (vehicle_id, id = p.image_id), 2,476 loops, 95 heap fetches, 10,026 buffers,
-- 27 ms (vs 2,238 ms and 3,229,550 buffers for the 026000 form).
-- Contract: supabase/sql/test_field_provenance_photo_location.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.vehicle_location_fold(uuid)'::regprocedure)) <> '1055b8fed97e6c1cbcfb36a32479d07b'
    AND position('photo_gps_cover_v2' in pg_get_functiondef('public.vehicle_location_fold(uuid)'::regprocedure)) = 0 THEN
   RAISE EXCEPTION 'vehicle_location_fold drifted from 20261116026000; review current definition';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_location_fold(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (
  with gate as (
    select v.user_id, v.owner_id, v.uploaded_by,
           auth.uid() in (v.user_id, v.owner_id, v.uploaded_by) as tied
    from public.vehicles v
    where v.id = p_vehicle_id
      and ((v.is_public = true and v.deleted_at is null)
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ), rows_ as materialized (
    -- Photo GPS admitted at area grain (admit_photo_gps_locations, 20261116001000). The row holds no point.
    select o.id, o.observed_at, o.created_at, o.confidence, o."precision" as level, o.city, o.county_fips,
           o.county_name, o.region_code, o.country_code, o.zcta, o.location_text_clean as label,
           o.metadata->>'utc_day' as utc_day, o.metadata->'image_ids' as image_ids
    from public.vehicle_location_observations o
    where exists (select 1 from gate)
      and o.vehicle_id = p_vehicle_id and o.source_type = 'exif'
      and o.metadata->>'method' = 'photo_gps_fold_v1' and o.confidence >= 0.5
    order by o.observed_at desc, o.id
    limit 1001
  ), ids as materialized (
    select l.id as row_id, x.image_id::uuid as image_id
    from rows_ l
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(l.image_ids) = 'array'
      then l.image_ids else '[]'::jsonb end) x(image_id)
    where x.image_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), photos as materialized (
    -- A row counts only while one of its photos is visible: the reader's visible_images predicates, by primary key.
    -- photo_gps_cover_v1: the photo must still hold its point. With the image_url test this is the predicate of
    -- idx_vehicle_images_gps_cover, so each photo is one index-only probe on (vehicle_id, id).
    -- photo_gps_cover_v2: one probe per photo, forced. The planner estimates one row for ids, and joined plainly it
    -- rescans every cover entry of the vehicle per photo (043c6d8b: 2,476 x 1,238, 2.2 s). OFFSET 0 keeps the
    -- lateral subquery from being flattened, so p.image_id is an index condition.
    select p.row_id, i.taken_at, i.latitude, i.longitude
    from ids p
    cross join lateral (
      select i.taken_at, i.latitude, i.longitude
      from public.vehicle_images i
      where i.id = p.image_id and i.vehicle_id = p_vehicle_id
        and i.latitude is not null and i.longitude is not null
        and nullif(btrim(i.image_url), '') is not null
        and i.is_sensitive is not true and i.is_superseded is not true
        and i.is_duplicate is not true
        and (i.vision_gate_status is null or i.vision_gate_status::text = 'approved')
        and coalesce(i.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
      offset 0
    ) i
  ), tied as (
    -- The exact place is the owner's: only a viewer tied to the vehicle gets a point.
    select coalesce((select g.tied from gate g), false) as tied
  ), current_ as materialized (
    select l.*, p.photos, p.first_taken_at, p.last_taken_at,
           case when (select tied from tied) then jsonb_build_object(
             'lat', round(p.lat::numeric, 4), 'lng', round(p.lng::numeric, 4), 'photos', p.photos) end as point
    from rows_ l
    join (select row_id, count(*) as photos, min(taken_at) as first_taken_at, max(taken_at) as last_taken_at,
                 avg(latitude) as lat, avg(longitude) as lng
          from photos group by row_id) p on p.row_id = l.id
  ), areas as materialized (
    select c.level, c.label, c.city, c.county_fips, c.county_name, c.region_code, c.country_code, c.zcta,
           sum(c.photos) as photos, count(*) as days, min(c.first_taken_at) as first_taken_at,
           max(c.last_taken_at) as last_taken_at, max(c.confidence) as confidence,
           (array_agg(c.id order by c.observed_at desc, c.id))[1] as latest_observation_id,
           max(c.created_at) as ingested_at,
           -- Where to centre a city-level area: the city's published centroid (city_geocode_lookup, built from
           -- listings), never the photos. County-level areas have none; draw the county's shape.
           case when c.city is not null then (
             select jsonb_build_object('lat', round(g.latitude::numeric, 4), 'lng', round(g.longitude::numeric, 4),
                                       'source', 'city_geocode_lookup', 'basis', 'city_centroid')
             from public.city_geocode_lookup g
             where lower(g.city) = lower(c.city) and g.state = c.region_code
               and g.latitude is not null and g.longitude is not null
             order by g.sample_size desc nulls last, g.city
             limit 1) end as centroid,
           jsonb_agg(c.id order by c.observed_at desc, c.id) as observation_ids,
           case when (select tied from tied) then (
             select jsonb_build_object('lat', round(avg(pp.latitude)::numeric, 4),
                                       'lng', round(avg(pp.longitude)::numeric, 4), 'photos', count(*))
             from photos pp
             join current_ c2 on c2.id = pp.row_id
             where c2.county_fips is not distinct from c.county_fips and c2.city is not distinct from c.city) end as point
    from current_ c
    group by c.level, c.label, c.city, c.county_fips, c.county_name, c.region_code, c.country_code, c.zcta
  )
  select case when exists (select 1 from gate) then jsonb_build_object(
    'row_count', (select count(*) from rows_),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
        'source_type','exif','source_platform','photo_exif','method','photo_gps_fold_v1',
        'level',a.level,'label',a.label,'city',a.city,'county_fips',a.county_fips,'county_name',a.county_name,
        'region_code',a.region_code,'country_code',a.country_code,'zcta',a.zcta,
        'photos',a.photos,'days',a.days,'first_taken_at',a.first_taken_at,'last_taken_at',a.last_taken_at,
        'confidence',a.confidence,'latest_observation_id',a.latest_observation_id,
        'observation_ids',a.observation_ids,'centroid',a.centroid,'point',a.point,'ingested_at',a.ingested_at)
      order by a.photos desc, a.last_taken_at desc, a.label) from areas a), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'observation_id',c.id,'utc_day',c.utc_day,'observed_at',c.observed_at,'level',c.level,'label',c.label,
        'city',c.city,'county_fips',c.county_fips,'county_name',c.county_name,'region_code',c.region_code,
        'zcta',c.zcta,'photos',c.photos,'first_taken_at',c.first_taken_at,'last_taken_at',c.last_taken_at,
        'confidence',c.confidence,'point',c.point)
      order by c.observed_at desc, c.id) from current_ c), '[]'::jsonb)) end
  );
END
$function$

;

DO $check$
BEGIN
 IF position('photo_gps_cover_v2' in pg_get_functiondef('public.vehicle_location_fold(uuid)'::regprocedure)) = 0 THEN
   RAISE EXCEPTION 'vehicle_location_fold lacks the photo_gps_cover_v2 lookup';
 END IF;
END $check$;
COMMIT;
