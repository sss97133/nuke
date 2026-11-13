-- vehicle_location_fold and vehicle_location_areas: PL/pgSQL, so a pooled session reuses the fold's plan.
--
-- WHY. Measured on prod after 20261116007000 deployed (2026-11-12, EXPLAIN ANALYZE of a top-level call, warm):
-- vehicle_location_areas took 17 ms for a vehicle with no photo areas, 31 ms on 20d21fb0 and 77 ms on the largest
-- (043c6d8b, 2,476 photos), of which about 8 ms per SQL function body is planning: a LANGUAGE sql function that is
-- not inlined parses and plans its body on every top-level call. PL/pgSQL prepares the statement once per session
-- and reuses it, and PostgREST sessions are pooled. Local PG17, pgbench 300 top-level calls on the contract fixture:
-- fold 0.414 -> 0.107 ms (fixture vehicle), 0.294 -> 0.050 ms (absent vehicle).
-- WHAT. Same bodies, same signatures, grants, owners and output; only LANGUAGE changes (sql -> plpgsql, RETURN of
-- the same query). The header reader calls vehicle_location_areas on every profile read; get_field_provenance's
-- location branch calls the fold. Contract: supabase/sql/test_field_provenance_photo_location.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.vehicle_location_fold(uuid)'::regprocedure)) <> '2e95f10d48c232bbdf8603a9063802a3'
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = 'public.vehicle_location_fold(uuid)'::regprocedure AND l.lanname = 'plpgsql') THEN
   RAISE EXCEPTION 'vehicle_location_fold drifted from 20261116007000; review current definition';
 END IF;
 IF md5(pg_get_functiondef('public.vehicle_location_areas(uuid)'::regprocedure)) <> '705fd02dec27cd4e40e6a74ef48813ab'
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = 'public.vehicle_location_areas(uuid)'::regprocedure AND l.lanname = 'plpgsql') THEN
   RAISE EXCEPTION 'vehicle_location_areas drifted from 20261116007000; review current definition';
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
    select p.row_id, i.taken_at, i.latitude, i.longitude
    from ids p
    join public.vehicle_images i on i.id = p.image_id and i.vehicle_id = p_vehicle_id
    where nullif(btrim(i.image_url), '') is not null
      and i.is_sensitive is not true and i.is_superseded is not true
      and i.is_duplicate is not true
      and (i.vision_gate_status is null or i.vision_gate_status::text = 'approved')
      and coalesce(i.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
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
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_location_areas(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Area grain for every viewer: the fold's areas without the tied viewer's point.
  RETURN (
  select coalesce((select jsonb_agg(a.value - 'point' - 'ingested_at' order by a.ordinality)
    from jsonb_array_elements(coalesce(public.vehicle_location_fold(p_vehicle_id)->'areas', '[]'::jsonb))
      with ordinality a), '[]'::jsonb)
  );
END
$function$;
COMMIT;
