-- Actual reader on PG17, synthetic rows in an EMPTY disposable database only. Proves
-- 20261116003000_field_provenance_photo_location.sql: get_field_provenance(v, 'location') returns the admitted photo-GPS
-- areas (location_areas, photo_locations, and a cited observations entry) with area grain only for anonymous and
-- untied callers, a point only for a viewer tied to the vehicle, read-time withdrawal when a photo stops being
-- visible, no change for any other field, and nothing for a private vehicle.
-- And 20261116007000_vehicle_location_areas.sql: the fold moved into vehicle_location_fold leaves every
-- get_field_provenance answer byte-identical (anonymous, untied, owner, other fields); vehicle_location_areas returns
-- the same areas without point for every viewer (owner included), [] for a private vehicle; anon cannot call the fold.
-- 20261116012000 (both functions in PL/pgSQL) changes none of it; every assertion below runs against it.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
END $$;
-- The previous owner's fixture and its regression cases (applies 20261109203000).
\ir test_current_field_correction_citations.sql
ALTER TABLE public.vehicle_images ADD COLUMN taken_at timestamptz, ADD COLUMN latitude numeric, ADD COLUMN longitude numeric;
CREATE TABLE public.vehicle_location_observations(id uuid PRIMARY KEY, vehicle_id uuid NOT NULL, source_type text NOT NULL,
  source_platform text, observed_at timestamptz NOT NULL, location_text_clean text, country_code text, region_code text,
  city text, postal_code text, latitude double precision, longitude double precision, "precision" text, confidence real,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT '2026-11-11T00:00Z', county_fips text,
  county_name text, zcta text);

-- An 'engine_type' answer before the change, to prove other fields are unchanged.
CREATE TEMP TABLE before_engine AS SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type') AS p;
\ir ../migrations/20261116003000_field_provenance_photo_location.sql
\ir ../migrations/20261116003000_field_provenance_photo_location.sql
CREATE TABLE public.city_geocode_lookup(city text, state text, latitude numeric, longitude numeric, sample_size integer,
  source text, PRIMARY KEY (city, state));
\ir ../migrations/20261116004000_field_provenance_photo_location_ids.sql
\ir ../migrations/20261116004000_field_provenance_photo_location_ids.sql
\ir ../migrations/20261116006000_field_provenance_photo_location_centroid.sql
\ir ../migrations/20261116006000_field_provenance_photo_location_centroid.sql

-- Fixture (committed; the database is disposable). The owner is bbbb…; three GPS photos of the public fixture
-- vehicle: two on day 1, one on day 2, all in one area; one more photo, sensitive, listed on day 2 (the writer would
-- not have listed it; the reader must not count it either).
UPDATE public.vehicles SET owner_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE id='11111111-1111-1111-1111-111111111111';
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,source,vision_gate_status,taken_at,latitude,longitude) VALUES
 ('55555555-5555-5555-5555-000000000001','11111111-1111-1111-1111-111111111111','https://x.invalid/g1.jpg','user_upload',NULL,'2026-10-06T15:00Z',35.97261,-114.85575),
 ('55555555-5555-5555-5555-000000000002','11111111-1111-1111-1111-111111111111','https://x.invalid/g2.jpg','user_upload',NULL,'2026-10-06T18:00Z',35.97301,-114.85601),
 ('55555555-5555-5555-5555-000000000003','11111111-1111-1111-1111-111111111111','https://x.invalid/g3.jpg','user_upload',NULL,'2026-10-07T01:00Z',35.97261,-114.85575);
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,source,vision_gate_status,taken_at,latitude,longitude,is_sensitive) VALUES
 ('55555555-5555-5555-5555-000000000004','11111111-1111-1111-1111-111111111111','https://x.invalid/g4.jpg','user_upload',NULL,'2026-10-07T02:00Z',35.97261,-114.85575,true);
INSERT INTO public.vehicle_location_observations(id,vehicle_id,source_type,source_platform,observed_at,location_text_clean,
  country_code,region_code,city,county_fips,county_name,"precision",confidence,metadata) VALUES
 ('66666666-6666-6666-6666-000000000001','11111111-1111-1111-1111-111111111111','exif','photo_exif','2026-10-06T18:00Z',
  'Boulder City, NV','US','NV','Boulder City','32003','Clark','city',0.7,
  '{"method":"photo_gps_fold_v1","utc_day":"2026-10-06","photos":2,"image_ids":["55555555-5555-5555-5555-000000000001","55555555-5555-5555-5555-000000000002"]}'),
 ('66666666-6666-6666-6666-000000000002','11111111-1111-1111-1111-111111111111','exif','photo_exif','2026-10-07T01:00Z',
  'Boulder City, NV','US','NV','Boulder City','32003','Clark','city',0.7,
  '{"method":"photo_gps_fold_v1","utc_day":"2026-10-07","photos":1,"image_ids":["55555555-5555-5555-5555-000000000003","55555555-5555-5555-5555-000000000004"]}'),
 -- A withdrawn row and a listing row: neither is a photo area.
 ('66666666-6666-6666-6666-000000000003','11111111-1111-1111-1111-111111111111','exif','photo_exif','2026-10-08T01:00Z',
  'Henderson, NV','US','NV','Henderson','32003','Clark','city',0,
  '{"method":"photo_gps_fold_v1","utc_day":"2026-10-08","image_ids":["55555555-5555-5555-5555-000000000001"],"withdrawn_at":"2026-11-11"}'),
 ('66666666-6666-6666-6666-000000000004','11111111-1111-1111-1111-111111111111','listing','bat','2026-09-01T00:00Z',
  'Reno, NV','US','NV','Reno',NULL,NULL,'city',0.8,'{}');
-- The city's published centre (two spellings; the larger sample wins).
INSERT INTO public.city_geocode_lookup VALUES ('Boulder City','NV',35.96001,-114.84002,40,'bat_listing'),
  ('BOULDER CITY','NV',35.5,-114.5,3,'bat_listing');

-- Answers under 20261116006000, for each viewer, to prove 007000 changes none of them.
BEGIN; SET LOCAL ROLE anon;
SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')::text AS base_anon \gset
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.auth_uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')::text AS base_untied \gset
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')::text AS base_owner \gset
ROLLBACK;
CREATE TABLE public.base_location(viewer text PRIMARY KEY, p jsonb NOT NULL);
INSERT INTO public.base_location VALUES ('anon', :'base_anon'::jsonb), ('untied', :'base_untied'::jsonb),
  ('owner', :'base_owner'::jsonb);
GRANT SELECT ON public.base_location TO anon, authenticated;

\ir ../migrations/20261116007000_vehicle_location_areas.sql
\ir ../migrations/20261116007000_vehicle_location_areas.sql
\ir ../migrations/20261116012000_vehicle_location_fold_plpgsql.sql
\ir ../migrations/20261116012000_vehicle_location_fold_plpgsql.sql
DO $$ BEGIN
 ASSERT (SELECT array_agg(l.lanname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.proname IN ('vehicle_location_fold','vehicle_location_areas')) = ARRAY['plpgsql','plpgsql'], '012000: plpgsql';
 ASSERT has_function_privilege('anon','public.vehicle_location_areas(uuid)','execute')
   AND NOT has_function_privilege('anon','public.vehicle_location_fold(uuid)','execute')
   AND NOT has_function_privilege('authenticated','public.vehicle_location_fold(uuid)','execute'), '012000: grants kept';
END $$;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')
   = (SELECT p FROM before_engine), 'other fields unchanged';
 ASSERT (SELECT p FROM public.base_location WHERE viewer = 'anon') ? 'location_areas', 'baseline holds the location keys';
END $$;

BEGIN;
-- The fold in its own function answers exactly as the inline fold did, for every viewer.
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')
   = (SELECT p FROM public.base_location WHERE viewer = 'anon'), 'anon: unchanged by 007000';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL test.auth_uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')
   = (SELECT p FROM public.base_location WHERE viewer = 'untied'), 'untied: unchanged by 007000';
END $$;
SET LOCAL test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')
   = (SELECT p FROM public.base_location WHERE viewer = 'owner'), 'owner: unchanged by 007000';
END $$;
RESET ROLE;
SET LOCAL test.auth_uid = '';

SET LOCAL ROLE anon;
DO $$ DECLARE p jsonb; a jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','location');
 ASSERT jsonb_array_length(p->'location_areas') = 1, p::text;
 a := p->'location_areas'->0;
 ASSERT a->>'label' = 'Boulder City, NV' AND a->>'level' = 'city' AND a->>'county_fips' = '32003' AND a->>'county_name' = 'Clark'
   AND a->>'region_code' = 'NV' AND a->'zcta' = 'null'::jsonb, a::text;
 ASSERT (a->>'photos')::int = 3 AND (a->>'days')::int = 2, 'sensitive photo not counted; two days';
 ASSERT (a->>'first_taken_at')::timestamptz = '2026-10-06T15:00Z' AND (a->>'last_taken_at')::timestamptz = '2026-10-07T01:00Z', a::text;
 ASSERT a->>'latest_observation_id' = '66666666-6666-6666-6666-000000000002' AND jsonb_array_length(a->'observation_ids') = 2, a::text;
 ASSERT a->'point' = 'null'::jsonb, 'anonymous: no point';
 ASSERT NOT (a ? 'ingested_at'), 'location_areas keeps its shape';
 ASSERT a->'centroid' = '{"lat":35.9600,"lng":-114.8400,"source":"city_geocode_lookup","basis":"city_centroid"}'::jsonb, a->>'centroid';
 ASSERT jsonb_array_length(p->'photo_locations') = 2 AND (SELECT bool_and(e->'point' = 'null'::jsonb) FROM jsonb_array_elements(p->'photo_locations') e),
   'anonymous: per-day rows without points';
 ASSERT p::text !~ '35\.97|114\.85', 'anonymous: no coordinate anywhere in the response';
 ASSERT p->'observations' @> '[{"source_slug":"photo_exif","extraction_method":"photo_gps_fold_v1","value":"Boulder City, NV","kind":"location"}]'::jsonb,
   'observations cite the photo source';
 ASSERT p::text !~ 'Henderson|Reno', 'withdrawn and listing rows are not photo areas';
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'location_areas' IS NULL, 'other fields: no location keys';
 -- The header's reader: the same areas, without point.
 ASSERT public.vehicle_location_areas('11111111-1111-1111-1111-111111111111')
   = (SELECT jsonb_agg(e.value - 'point' ORDER BY e.ordinality) FROM jsonb_array_elements(p->'location_areas') WITH ORDINALITY e),
   public.vehicle_location_areas('11111111-1111-1111-1111-111111111111')::text;
 ASSERT public.vehicle_location_areas('99999999-9999-9999-9999-999999999999') = '[]'::jsonb, 'unknown vehicle: []';
END $$;
-- Anon cannot call the internal fold.
DO $$ BEGIN
 PERFORM public.vehicle_location_fold('11111111-1111-1111-1111-111111111111');
 RAISE EXCEPTION 'anon executed vehicle_location_fold';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

-- An untied signed-in viewer: area grain only.
SET LOCAL ROLE authenticated;
SET LOCAL test.auth_uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','location');
 ASSERT p->'location_areas'->0->'point' = 'null'::jsonb AND p::text !~ '35\.97|114\.85', 'untied viewer: no point';
END $$;
-- The owner: a point, the mean of the visible photos rounded to 4 decimals; the header reader still has none.
SET LOCAL test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ DECLARE p jsonb; h jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','location');
 ASSERT p->'location_areas'->0->'point' = '{"lat":35.9727,"lng":-114.8558,"photos":3}'::jsonb, p->'location_areas'->0->>'point';
 ASSERT (SELECT count(*) FROM jsonb_array_elements(p->'photo_locations') e WHERE e->'point' <> 'null'::jsonb) = 2, 'owner: per-day points';
 h := public.vehicle_location_areas('11111111-1111-1111-1111-111111111111');
 ASSERT jsonb_array_length(h) = 1 AND NOT (h->0 ? 'point') AND h::text !~ '35\.97|114\.85', 'header reader: never a point';
END $$;
RESET ROLE;
SET LOCAL test.auth_uid = '';

-- Read-time withdrawal: day 2's only visible photo becomes sensitive; that day drops before any writer runs.
UPDATE public.vehicle_images SET is_sensitive = true WHERE id = '55555555-5555-5555-5555-000000000003';
SET LOCAL ROLE anon;
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','location');
 ASSERT (p->'location_areas'->0->>'photos')::int = 2 AND (p->'location_areas'->0->>'days')::int = 1
   AND jsonb_array_length(p->'photo_locations') = 1, p::text;
 ASSERT (public.vehicle_location_areas('11111111-1111-1111-1111-111111111111')->0->>'photos')::int = 2, 'header reader withdraws too';
END $$;
RESET ROLE;

-- A private vehicle: nothing for anon.
UPDATE public.vehicles SET is_public = false WHERE id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location') IS NULL, 'private vehicle: NULL';
 ASSERT public.vehicle_location_areas('11111111-1111-1111-1111-111111111111') = '[]'::jsonb, 'private vehicle: []';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: photo-GPS location areas, area grain for anonymous callers, point only for the tied viewer; vehicle_location_areas matches' AS result;
