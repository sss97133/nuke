-- vehicle_location_areas: the photo-GPS area fold as one function, read by the location popup and the vehicle header.
--
-- WHY. The header's facet reader (vehicle_facet_items, inside vehicle_profile_read) needs the vehicle's photo areas
-- on every profile read. Until now the fold lived only inside get_field_provenance(..., 'location') (20261116003000,
-- 004000, 006000), so a second reader would have had to copy it, and the popup and the header could disagree.
--
-- WHAT.
-- * public.vehicle_location_fold(p_vehicle_id) -> jsonb {row_count, areas, days}: internal, no anon/authenticated
--   EXECUTE, called only from the SECURITY DEFINER readers below. Reads the admitted rows (source_type 'exif',
--   metadata.method 'photo_gps_fold_v1', confidence >= 0.5; at most 1001), unnests their image ids once, and recounts
--   each row from the photos still visible (vehicle_images by primary key, same predicates as the reader's
--   visible_images). Areas group the days by (level, label, city, county, region, country, zcta), largest first.
--   A point (mean of visible photos, 4 decimals) appears only when auth.uid() is tied to the vehicle (user_id,
--   owner_id, uploaded_by); it is computed here, never stored. A vehicle that is neither public-and-live nor tied
--   to the caller returns NULL.
-- * public.vehicle_location_areas(p_vehicle_id) -> jsonb array: the fold's areas without point and without
--   ingested_at, for every viewer. Element keys: source_type, source_platform, method, level, label, city,
--   county_fips, county_name, region_code, country_code, zcta, photos, days, first_taken_at, last_taken_at,
--   confidence, latest_observation_id, observation_ids, centroid (city_geocode_lookup centre for a city-level area,
--   NULL for county-level). [] for an invisible vehicle or one with no photo areas.
-- * get_field_provenance's location branch reads the same fold; its output is unchanged (location_areas,
--   photo_locations, the photo_exif observations entries, the 1,000-row cap). Other fields never call the fold.
-- Contract: supabase/sql/test_field_provenance_photo_location.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure)) NOT IN ('dd604399932ffefa5d770f34c24995e3', '15d6906f9268a3cf11147d92ae5603a9') THEN
   RAISE EXCEPTION 'get_field_provenance owner drifted from 20261116006000; review current definition';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_location_fold(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.vehicle_location_fold(uuid) FROM PUBLIC;
DO $grants$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
   EXECUTE 'REVOKE ALL ON FUNCTION public.vehicle_location_fold(uuid) FROM anon, authenticated'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_location_fold(uuid) TO service_role'; END IF;
END $grants$;
COMMENT ON FUNCTION public.vehicle_location_fold(uuid) IS
  'Internal photo-GPS area fold {row_count, areas, days}; point only for a viewer tied to the vehicle. Read via vehicle_location_areas (public, no point) or get_field_provenance(v, ''location''). 20261116007000.';

CREATE OR REPLACE FUNCTION public.vehicle_location_areas(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Area grain for every viewer: the fold's areas without the tied viewer's point.
  select coalesce((select jsonb_agg(a.value - 'point' - 'ingested_at' order by a.ordinality)
    from jsonb_array_elements(coalesce(public.vehicle_location_fold(p_vehicle_id)->'areas', '[]'::jsonb))
      with ordinality a), '[]'::jsonb)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_location_areas(uuid) FROM PUBLIC;
DO $grants$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_location_areas(uuid) TO anon, authenticated'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_location_areas(uuid) TO service_role'; END IF;
END $grants$;
COMMENT ON FUNCTION public.vehicle_location_areas(uuid) IS
  'Photo-GPS areas of a vehicle at area grain (city or county; zcta when keyed), largest first, for every viewer; never a point. [] when the vehicle is not visible to the caller. Same fold as get_field_provenance(v, ''location''). 20261116007000.';

CREATE OR REPLACE FUNCTION public.get_field_provenance(p_vehicle_id uuid, p_field text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with gate as (
    select v.* from public.vehicles v
    where v.id = p_vehicle_id
      and ((v.is_public = true and v.deleted_at is null)
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  prov as (
    select primary_source, total_confidence
    from public.vehicle_field_provenance
    where vehicle_id = p_vehicle_id and field_name = p_field
    limit 1
  ), visible_images as materialized (
    select i.id, i.image_url
    from public.vehicle_images i
    where i.vehicle_id = p_vehicle_id and exists (select 1 from gate)
      and nullif(btrim(i.image_url), '') is not null
      and i.is_sensitive is not true and i.is_superseded is not true
      and i.is_duplicate is not true
      and (i.vision_gate_status is null or i.vision_gate_status::text = 'approved')
      and coalesce(i.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
  ), photo_location_fold as materialized (
    -- Photo GPS areas and days come from the one fold the header also reads (vehicle_location_fold,
    -- 20261116007000); only the location field calls it, so every other field pays nothing.
    select case when p_field = 'location' and exists (select 1 from gate)
                then public.vehicle_location_fold(p_vehicle_id) end as f
  ), photo_location_areas as (
    select a.value as area, a.ordinality as ord
    from photo_location_fold pf
    cross join lateral jsonb_array_elements(coalesce(pf.f->'areas', '[]'::jsonb)) with ordinality a
  ), latest_correction as materialized (
    -- Choose the latest exact-field correction first. A newer mismatch or
    -- restored correction must not revive an older matching source.
    select s.id,s.row_data,s.source,s.superseded_at,s.restored_at
    from public.superseded_rows s
    where s.source_table='vehicles' and s.row_id=p_vehicle_id
      and s.row_data->>'field'=p_field and s.row_data ? 'replacement'
      and p_field in ('body_style','series','trim','engine_type','engine_code')
      and exists(select 1 from gate)
    order by s.superseded_at desc,s.id desc limit 1
  ), current_correction as (
    select jsonb_build_object('correction_id',s.id,'value',s.row_data->>'replacement',
      'receipt_id',r.id,'document_id',r.source_document_id,'source_table',r.source_document_table,
      'page_date',l.page_date,'recorded_at',s.superseded_at) as citation
    from latest_correction s
    join public.receipts r on r.id=case when s.source->>'ref' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (s.source->>'ref')::uuid end
    join public.receipt_vehicle_links l on l.receipt_id=r.id and l.vehicle_id=p_vehicle_id
      and l.status='linked' and l.retired_at is null
    where s.restored_at is null and s.source->>'type'='receipt'
      and jsonb_typeof(s.row_data->'replacement')='string'
      and nullif(btrim(s.row_data->>'replacement'),'') is not null
      and s.row_data->>'replacement'=(select to_jsonb(g)->>p_field from gate g)
      and r.is_superseded is not true and r.duplicate_of is null
      and (r.vehicle_id=p_vehicle_id or (r.vehicle_id is null and r.scope_type='vehicle' and r.scope_id=p_vehicle_id::text))
      and ((r.source_document_table='vehicle_documents' and exists(
        select 1 from public.vehicle_documents d where d.id=r.source_document_id and d.vehicle_id=p_vehicle_id))
        or (r.source_document_table='vehicle_images' and exists(
          select 1 from visible_images i where i.id=r.source_document_id)))
      and l.page_date is not null
    order by l.page_date desc,l.id limit 1
  ), field_observations as materialized (
    select o.*, s.slug as source_slug, s.base_trust_score as source_trust,
           case when o.structured_data->>'image_id'
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (o.structured_data->>'image_id')::uuid end as legacy_image_id
    from public.vehicle_observations o
    left join public.observation_sources s on s.id = o.source_id
    -- One original-source PK lookup per cached claim. Do not expose an eligible
    -- sanitized child after its full original is restricted, superseded or moved.
    left join public.vehicle_observations a on a.id = case
      when o.structured_data->>'source_observation_id'
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (o.structured_data->>'source_observation_id')::uuid end
    where o.vehicle_id = p_vehicle_id and o.is_superseded is not true
      and o.structured_data ? p_field
      and (o.source_observation_id IS NULL OR o.structured_data->>'property_key'=p_field)
 AND (o.source_observation_id IS NULL OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND (public.retained_description_property_matches(dp,o) OR public.retained_listing_identity_matches(dp,o) OR public.retained_craigslist_odometer_matches(dp,o) OR public.retained_craigslist_year_matches(dp,o) OR public.retained_description_year_matches(dp,o) OR public.retained_description_identity_matches(dp,o))) OR EXISTS (
   SELECT 1 FROM public.vehicle_observations rp
   JOIN public.observation_sources rs ON rs.id=rp.source_id AND rs.slug='bat'
   JOIN public.vehicles rv ON rv.id=rp.vehicle_id AND rv.is_public IS TRUE
     AND rv.deleted_at IS NULL AND rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   JOIN public.observation_properties rk ON rk.id=o.property_id AND rk.property_key IN ('interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')
     AND rk.namespace='core' AND rk.deprecated_at IS NULL
   WHERE rp.id=o.source_observation_id AND rp.id<>o.id AND rp.vehicle_id=o.vehicle_id
     AND rp.source_id=o.source_id AND rp.source_url=o.source_url AND rp.kind::text='listing'
     AND rp.is_superseded IS FALSE AND rp.property_id IS NULL
     AND rp.subject_type='vehicle' AND rp.subject_id IS NULL AND rp.extraction_method='html_match'
     AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
     AND rp.confidence_score BETWEEN 0.6 AND 1 AND isfinite(rp.ingested_at)
     AND o.kind::text='specification' AND o.extraction_method='retained_listing_property_projection_v1'
     AND o.structured_data->>'source_observation_id'=rp.id::text
     AND o.structured_data->rk.property_key=CASE WHEN rk.property_key IN ('interior_color','exterior_color') THEN rp.structured_data->(CASE rk.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END)
 ELSE public.retained_powertrain_value(rk.property_key,rp.structured_data->(CASE rk.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)) END
 AND (rk.property_key IN ('interior_color','exterior_color') OR
  (o.structured_data->'source_value'=rp.structured_data->(CASE rk.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)
   AND o.structured_data->>'normalization_version'='retained_powertrain_v1'))
     AND o.structured_data->>'claim_role'='listing_claim'
     AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
     AND o.observed_at=rp.ingested_at AND o.confidence_score BETWEEN 0 AND 0.6
 ))

      and (not coalesce((o.extraction_method='cached_byok_property_projection_v1' OR o.structured_data->>'analysis_kind'='image_property_projection' OR o.structured_data->>'projection_version'='byok_image_properties_v1'),false) or coalesce(EXISTS(SELECT 1 FROM gate g WHERE g.is_public IS TRUE
          AND g.deleted_at IS NULL AND coalesce(g.listing_kind,'')<>'non_vehicle_item')
        AND a.id IS NOT NULL AND a.vehicle_id=o.vehicle_id AND a.kind::text='condition'
        AND a.is_superseded IS NOT TRUE AND public.observation_is_public(a.kind,a.structured_data)
        AND a.structured_data->>'analysis_kind'='image_deep_byok'
        AND a.structured_data->>'image_id'=o.structured_data->>'image_id'
        AND a.structured_data->>'scene_type' IS DISTINCT FROM 'receipt_document'
        AND a.structured_data->'needs_review' IS DISTINCT FROM 'true'::jsonb
        AND a.structured_data->'needs_clarification' IS DISTINCT FROM 'true'::jsonb
        AND (NOT a.structured_data ? 'attribution_doubt' OR a.structured_data->'attribution_doubt' IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))
        AND a.confidence::text IS DISTINCT FROM 'low' AND a.confidence_score BETWEEN 0.6 AND 1
        AND nullif(btrim(a.agent_model),'') IS NOT NULL AND nullif(btrim(a.extraction_method),'') IS NOT NULL
        AND isfinite(a.ingested_at) AND o.kind::text='condition'
        AND o.extraction_method='cached_byok_property_projection_v1'
        AND o.structured_data->>'analysis_kind'='image_property_projection'
        AND o.structured_data->>'projection_version'='byok_image_properties_v1'
        AND o.structured_data->>'property_key'=p_field
        AND p_field IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state')
        AND o.structured_data->p_field=a.structured_data->'state_observations'->
          CASE p_field WHEN 'image_visible_rust_severity' THEN 'rust_severity'
            WHEN 'image_visible_paint_stage' THEN 'paint_state' ELSE 'completeness' END
        AND o.confidence_score BETWEEN 0 AND 0.6
        AND o.structured_data->>'claim_role'='inferred'
        AND o.structured_data->>'source_family'='image:'||(o.structured_data->>'image_id')
        AND o.structured_data->'source_model_confidence'=to_jsonb(a.confidence_score)
        AND o.agent_model=a.agent_model
        AND o.structured_data->>'source_extraction_method'=a.extraction_method
        AND o.raw_source_ref='vehicle_observations:'||a.id::text
        AND o.structured_data->>'source_result_hash' ~ '^[0-9a-f]{64}$'
        AND o.source_identifier='byok_image_properties_v1:'||a.id::text||':'||
          (o.structured_data->>'source_result_hash')||':'||p_field
        AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
        AND o.structured_data->'capture_at'='null'::jsonb AND o.structured_data->'analyzed_at'='null'::jsonb
        AND o.observed_at=a.ingested_at
        AND CASE WHEN pg_catalog.pg_input_is_valid(o.structured_data->>'source_recorded_at','timestamptz')
          AND (o.structured_data->>'source_observed_at' IS NULL OR
            pg_catalog.pg_input_is_valid(o.structured_data->>'source_observed_at','timestamptz'))
          THEN (o.structured_data->>'source_recorded_at')::timestamptz=a.ingested_at
            AND (o.structured_data->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM a.observed_at
          ELSE false END, false))
      and (public.observation_is_public(o.kind,o.structured_data)
           or exists (select 1 from gate g where auth.uid() in (g.user_id,g.owner_id,g.uploaded_by)))
  ), image_observations as (
    -- Typed derived edges are authoritative when present. Visibility is checked
    -- again at read time; a hidden typed edge must not reopen a JSON fallback.
    select o.*, w.id as witness_id, w.witness_role,
           i.id as visible_image_id, i.image_url as visible_image_url
    from field_observations o
    join public.observation_witnesses w on w.observation_id = o.id and w.witness_role = 'derived'
      and (o.extraction_method is distinct from 'cached_byok_property_projection_v1'
        or w.image_id = o.legacy_image_id)
    join visible_images i on i.id = w.image_id
    union all
    select o.*, null::uuid as witness_id, null::text as witness_role,
           i.id as visible_image_id, i.image_url as visible_image_url
    from field_observations o
    join visible_images i on i.id = o.legacy_image_id
    where not exists (select 1 from public.observation_witnesses w
      where w.observation_id = o.id and w.witness_role = 'derived')
  ), readable_observations as (
    select o.* from field_observations o
    where (not (o.structured_data ? 'image_id') and not exists (
      select 1 from public.observation_witnesses w
      where w.observation_id = o.id and w.witness_role = 'derived'))
      or exists (select 1 from image_observations i where i.id = o.id)
  ), readable_observation_rows as materialized (
    select o.* from readable_observations o limit 1001
  ), readable_image_rows as materialized (
    select o.* from image_observations o limit 1001
  ), current_field_evidence as materialized (
    -- Resolve an explicit source once. A malformed/withdrawn ID must not fall
    -- through to a coincidentally matching URL or become an uncited claim.
    select fe.*,i.id as visible_image_id,i.image_url as visible_image_url
    from public.field_evidence fe
    left join lateral (
      select vi.* from visible_images vi
      where vi.id=case
        when fe.raw_extraction_data->>'photo_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (fe.raw_extraction_data->>'photo_id')::uuid
        when fe.raw_extraction_data->>'photo_id' is null
          and fe.raw_extraction_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (fe.raw_extraction_data->>'image_id')::uuid end
        or (fe.raw_extraction_data->>'photo_id' is null and fe.raw_extraction_data->>'image_id' is null
          and vi.image_url=fe.raw_extraction_data->>'image_url')
      order by vi.id limit 1
    ) i on true
    where fe.vehicle_id=p_vehicle_id and fe.field_name=p_field
      and coalesce(fe.proposed_value,'')<>'' and fe.status<>'superseded' and fe.status not like 'rejected%'
      and (nullif(btrim(fe.raw_extraction_data->>'image_url'),'') is null
        or fe.raw_extraction_data->>'image_url'=i.image_url)
      and (fe.raw_extraction_data->>'photo_id' is null or fe.raw_extraction_data->>'image_id' is null
        or lower(fe.raw_extraction_data->>'photo_id')=lower(fe.raw_extraction_data->>'image_id'))
      and (not (fe.raw_extraction_data->>'photo_id' is not null or fe.raw_extraction_data->>'image_id' is not null
        or nullif(btrim(fe.raw_extraction_data->>'image_url'),'') is not null) or i.id is not null)
  ), evidence_rows as materialized (
          select jsonb_build_object(
            'source','vehicle_field_sources','value',fs.field_value,
            'source_type',fs.source_type,'confidence',fs.confidence_score,
            'verified',fs.is_verified,'reasoning',fs.ai_reasoning,
            'image_id',i.id,'at',fs.created_at) as e
          from public.vehicle_field_sources fs
          left join visible_images i on i.id = fs.source_image_id
          where fs.vehicle_id = p_vehicle_id and fs.field_name = p_field
            and coalesce(fs.field_value,'') <> ''
            and (fs.source_image_id is null or i.id is not null)
          union all
          select jsonb_build_object(
            'source','field_evidence','value',fe.proposed_value,
            'source_type',fe.source_type,'confidence',fe.source_confidence,
            'verified',(fe.status='accepted'),'reasoning',fe.extraction_context,
            'image_id',fe.visible_image_id,'at',fe.created_at) as e
          from current_field_evidence fe
    limit 1001
  ), coverage as materialized (
    -- Count only the exact collections permitted by the original reader. Raw
    -- private/unrelated rows must not turn public coverage into a size oracle.
    select (select count(*) from readable_observation_rows)<=1000
       and (select count(*) from readable_image_rows)<=1000
       and (select count(*) from evidence_rows)<=1000
       and coalesce(((select f from photo_location_fold)->>'row_count')::int, 0)<=1000 as admitted
  ), coverage_receipt as (
    select jsonb_build_object('contract','field_provenance_aggregate_cap_v1',
      'status',case when admitted then 'complete_current_reader' else 'refused_input_limit' end,
      'collectionRowLimit',1000,'bound','returned_collection_cardinality_only',
      'scanRowsBounded',false,'responseBytesBounded',false) as receipt from coverage
  )
  select case when not exists (select 1 from gate) then null
    when not (select admitted from coverage) then jsonb_build_object(
      'field',p_field,'vehicle_id',p_vehicle_id,'value',null,
      'inline_source',null,'inline_confidence',null,'source_image_url',null,
      'evidence','[]'::jsonb,'observations','[]'::jsonb,'image_observations','[]'::jsonb,
      'coverage',(select receipt from coverage_receipt))
    else jsonb_build_object(
    'coverage',(select receipt from coverage_receipt),
    'field', p_field,
    'vehicle_id', p_vehicle_id,
    'value', coalesce(nullif(btrim((select to_jsonb(g)->>p_field from gate g)), ''),
      -- VIN: an empty column is not 'Unknown' when cited claims agree (identifier_consensus_v1)
      case when p_field = 'vin' then public.identifier_consensus(p_vehicle_id, 'vin')->>'canonical_value' end),
    'current_correction',(select citation from current_correction),
    'identifier_consensus', case when p_field = 'vin' then public.identifier_consensus(p_vehicle_id, 'vin') end,
    -- inline source falls back to the consensus primary_source (vehicle_field_provenance)
    'inline_source', coalesce(
        (select to_jsonb(g)->>(p_field||'_source')     from gate g),
        (select primary_source from prov)),
    'inline_confidence', coalesce(
        (select to_jsonb(g)->>(p_field||'_confidence') from gate g),
        (select total_confidence::text from prov)),
    -- source image falls back to the cited field_evidence row's photo
    'source_image_url', coalesce(
        (select i.image_url from visible_images i
          where i.id = case
            when (select to_jsonb(g)->>(p_field||'_source_image_id') from gate g)
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (select to_jsonb(g)->>(p_field||'_source_image_id') from gate g)::uuid end),
        (select fe.visible_image_url from current_field_evidence fe
          where fe.visible_image_id is not null
          order by fe.source_confidence desc nulls last,fe.created_at desc limit 1)),
    -- evidence = vehicle_field_sources ∪ field_evidence (the consensus pipeline), highest confidence first
    'evidence', coalesce((select jsonb_agg(e order by (e->>'confidence')::numeric desc nulls last)
      from evidence_rows), '[]'::jsonb),
    'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id',o.id,'content',left(o.content_text,400),
            'source_field',o.structured_data->>'source_field',
            'source_value',o.structured_data->'source_value',
            'normalization_version',o.structured_data->>'normalization_version',
            'source_witness_version',o.structured_data->>'source_witness_version',
            'source_reading_value',o.structured_data->'source_reading_value',
            'source_reading_unit',o.structured_data->>'source_reading_unit',
            'reported_precision_miles',o.structured_data->'reported_precision_miles',
            'value_is_approximate',o.structured_data->'value_is_approximate',
            'source_year_token',o.structured_data->>'source_year_token','source_subject_label',o.structured_data->>'source_subject_label','year_label_basis',o.structured_data->>'year_label_basis','reading_role',o.structured_data->>'reading_role','source_profile',o.structured_data->>'source_profile','reading_unit_basis',o.structured_data->>'reading_unit_basis','source_native_post_id',o.structured_data->>'source_native_post_id','odometer_broken',o.structured_data->'odometer_broken','odometer_rolled_over',o.structured_data->'odometer_rolled_over',
            'true_mileage_status',o.structured_data->>'true_mileage_status',
            'source_observed_at_basis',o.structured_data->>'source_observed_at_basis',
            'source_event_time_status',o.structured_data->>'source_event_time_status',
            'vin_identifier_namespace',o.structured_data->>'vin_identifier_namespace','vin_format_status',o.structured_data->>'vin_format_status','vin_checksum_status',o.structured_data->>'vin_checksum_status',
            'identity_role',o.structured_data->>'identity_role','identity_resolution_status',o.structured_data->>'identity_resolution_status',
            'source_capture_sha256',o.structured_data->>'source_capture_sha256',
            'claim_role',o.structured_data->>'claim_role',
            'independent_source',o.structured_data->'independent_source',
            'factory_configuration_status',o.structured_data->>'factory_configuration_status',
            'current_configuration_status',o.structured_data->>'current_configuration_status',
            'value',o.structured_data->>p_field,'confidence',o.confidence_score,
            'observed_at',o.observed_at,'ingested_at',o.ingested_at,
            'source_observation_id',o.structured_data->>'source_observation_id',
            'source_extraction_method',o.structured_data->>'source_extraction_method',
            'source_model_confidence',o.structured_data->'source_model_confidence',
            'source_recorded_at',o.structured_data->>'source_recorded_at',
            'source_observed_at',o.structured_data->>'source_observed_at',
            'observed_at_basis',o.structured_data->>'observed_at_basis',
            'capture_at',o.structured_data->'capture_at','analyzed_at',o.structured_data->'analyzed_at',
            'extraction_method',o.extraction_method,'agent_model',o.agent_model,'kind',o.kind::text,
            'source_slug',o.source_slug,'trust',o.source_trust,'source_url',o.source_url) || jsonb_build_object('identity_label_basis',o.structured_data->>'identity_label_basis','source_make_label',o.structured_data->>'source_make_label','model_label_scope',o.structured_data->>'model_label_scope')
            || CASE WHEN p_field='engine_family_label' THEN jsonb_build_object(
              'label_role',o.structured_data->>'label_role','engine_identity_status',o.structured_data->>'engine_identity_status',
              'source_capture_basis',o.structured_data->>'source_capture_basis','source_captured_at',o.structured_data->>'source_captured_at')
             ELSE '{}'::jsonb END
            order by o.confidence_score desc nulls last,o.observed_at desc nulls last,o.ingested_at desc,o.id)
        from readable_observation_rows o), '[]'::jsonb)
      -- Photo GPS areas cite their latest row; value is the area label, never a point.
      || coalesce((select jsonb_agg(jsonb_build_object(
            'id',a.area->'latest_observation_id','value',a.area->'label','source_value',a.area->'label',
            'source_slug','photo_exif','source_url',null,'kind','location',
            'extraction_method','photo_gps_fold_v1','claim_role','photo_gps_area',
            'confidence',a.area->'confidence','observed_at',a.area->'last_taken_at','ingested_at',a.area->'ingested_at',
            'source_observed_at',a.area->'last_taken_at','observed_at_basis','photo_taken_at')
          order by a.ord)
        from photo_location_areas a), '[]'::jsonb),
    'image_observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'observation_id',o.id,'image_id',o.visible_image_id,
            'witness_id',o.witness_id,'witness_role',o.witness_role,
            'image_url',o.visible_image_url,'value',o.structured_data->>p_field,
            'source_slug',o.source_slug,'source_url',o.source_url,
            'source_observation_id',o.structured_data->>'source_observation_id',
            'source_extraction_method',o.structured_data->>'source_extraction_method',
            'source_model_confidence',o.structured_data->'source_model_confidence',
            'source_recorded_at',o.structured_data->>'source_recorded_at',
            'source_observed_at',o.structured_data->>'source_observed_at',
            'observed_at_basis',o.structured_data->>'observed_at_basis',
            'capture_at',o.structured_data->'capture_at','analyzed_at',o.structured_data->'analyzed_at',
            'extraction_method',o.extraction_method,'agent_model',o.agent_model,
            'observed_at',o.observed_at,'ingested_at',o.ingested_at,
            'confidence',o.confidence_score,
            'claim_role',o.structured_data->>'claim_role',
            'image_region',o.structured_data->'image_region',
            'reference',o.structured_data->'reference',
            'source_family',o.structured_data->>'source_family',
            'visual_relation',o.structured_data->>'visual_relation',
            'limitation',coalesce(o.structured_data->>'limitation',o.extraction_metadata->>'limitation'),
            'is_inferred',coalesce(o.structured_data->'is_inferred',o.extraction_metadata->'is_inferred'))
            order by o.confidence_score desc nulls last, o.ingested_at desc, o.id)
        from readable_image_rows o), '[]'::jsonb)
  ) || case when p_field = 'location' then jsonb_build_object(
    -- The map's area for each place the photos put the vehicle: anonymous callers get area grain only.
    'location_areas', coalesce((select jsonb_agg(a.area - 'ingested_at' order by a.ord)
      from photo_location_areas a), '[]'::jsonb),
    'photo_locations', coalesce((select f->'days' from photo_location_fold), '[]'::jsonb)
  ) else '{}'::jsonb end end
$function$;
COMMIT;
