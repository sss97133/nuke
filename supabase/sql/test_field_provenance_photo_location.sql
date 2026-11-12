-- Actual reader on PG17, synthetic rows in an EMPTY disposable database only. Proves
-- 20261116003000_field_provenance_photo_location.sql: get_field_provenance(v, 'location') returns the admitted photo-GPS
-- areas (location_areas, photo_locations, and a cited observations entry) with area grain only for anonymous and
-- untied callers, a point only for a viewer tied to the vehicle, read-time withdrawal when a photo stops being
-- visible, no change for any other field, and nothing for a private vehicle.
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
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')
   = (SELECT p FROM before_engine), 'other fields unchanged';
END $$;

BEGIN;
UPDATE public.vehicles SET owner_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE id='11111111-1111-1111-1111-111111111111';
-- Three GPS photos of the public fixture vehicle: two on day 1, one on day 2, all in one area; one more photo,
-- sensitive, listed on day 2 (the writer would not have listed it; the reader must not count it either).
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
 ASSERT jsonb_array_length(p->'photo_locations') = 2 AND (SELECT bool_and(e->'point' = 'null'::jsonb) FROM jsonb_array_elements(p->'photo_locations') e),
   'anonymous: per-day rows without points';
 ASSERT p::text !~ '35\.97|114\.85', 'anonymous: no coordinate anywhere in the response';
 ASSERT p->'observations' @> '[{"source_slug":"photo_exif","extraction_method":"photo_gps_fold_v1","value":"Boulder City, NV","kind":"location"}]'::jsonb,
   'observations cite the photo source';
 ASSERT p::text !~ 'Henderson|Reno', 'withdrawn and listing rows are not photo areas';
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'location_areas' IS NULL, 'other fields: no location keys';
END $$;
RESET ROLE;

-- An untied signed-in viewer: area grain only.
SET LOCAL ROLE authenticated;
SET LOCAL test.auth_uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','location');
 ASSERT p->'location_areas'->0->'point' = 'null'::jsonb AND p::text !~ '35\.97|114\.85', 'untied viewer: no point';
END $$;
-- The owner: a point, the mean of the visible photos rounded to 4 decimals.
SET LOCAL test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','location');
 ASSERT p->'location_areas'->0->'point' = '{"lat":35.9727,"lng":-114.8558,"photos":3}'::jsonb, p->'location_areas'->0->>'point';
 ASSERT (SELECT count(*) FROM jsonb_array_elements(p->'photo_locations') e WHERE e->'point' <> 'null'::jsonb) = 2, 'owner: per-day points';
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
END $$;
RESET ROLE;

-- A private vehicle: nothing for anon.
UPDATE public.vehicles SET is_public = false WHERE id = '11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location') IS NULL, 'private vehicle: NULL';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: photo-GPS location areas, area grain for anonymous callers, point only for the tied viewer' AS result;
