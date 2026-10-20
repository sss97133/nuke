-- Disposable PG17 only. Proves 20261020190000_anon_image_location_columns.sql: anon keeps SELECT on the ordinary image
-- columns but not on precise location, EXIF or device columns of vehicle_images; a SELECT * as anon
-- is refused; rows and RLS are unchanged; authenticated keeps every column; re-applying is a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, is_public boolean);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, image_url text, taken_at timestamptz, file_name text, storage_path text,
  latitude double precision, longitude double precision, location_name text, location_confidence numeric, exif_data jsonb,
  device_fingerprint text, documented_by_device text, is_sensitive boolean DEFAULT false, vision_gate_status text DEFAULT 'approved');
CREATE TABLE public.device_attributions(id uuid PRIMARY KEY, image_id uuid, camera_make text, camera_model text, camera_serial text,
  latitude double precision, longitude double precision, altitude double precision, gps_timestamp timestamptz, raw_exif jsonb,
  device_fingerprint text, attribution_source text);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_rows ON public.vehicle_images FOR SELECT USING (
  NOT is_sensitive AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.is_public));
ALTER TABLE public.device_attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_attributions_public_read ON public.device_attributions FOR SELECT USING (true);
GRANT SELECT ON public.vehicles, public.vehicle_images, public.device_attributions TO anon, authenticated, service_role;
INSERT INTO vehicles VALUES ('a0000000-0000-0000-0000-00000000000a', true), ('b0000000-0000-0000-0000-00000000000b', false);
INSERT INTO vehicle_images VALUES
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','https://x.invalid/1.jpg','2026-01-01','IMG_0001.JPG','p/1.jpg',
  40.1,-119.2,'Somewhere',0.9,'{"location":{"latitude":40.1,"longitude":-119.2}}','Apple-iPhone-X-1','iPhone',false,'approved'),
 ('10000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000b','https://x.invalid/2.jpg','2026-01-02','IMG_0002.JPG','p/2.jpg',
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,false,'approved');
INSERT INTO device_attributions VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Apple','iPhone','SN1',
  40.1,-119.2,1200,'2026-01-01','{"GPS":1}','Apple-iPhone-SN1-17','exif');
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated;

\ir ../migrations/20261020190000_anon_image_location_columns.sql
\ir ../migrations/20261020190000_anon_image_location_columns.sql

SELECT t_assert((SELECT bool_and(NOT has_column_privilege('anon','public.vehicle_images',c,'SELECT')) FROM unnest(ARRAY['latitude','longitude',
   'location_name','location_confidence','exif_data','device_fingerprint','documented_by_device']) c)
 AND (SELECT bool_and(has_column_privilege('anon','public.vehicle_images',c,'SELECT')) FROM unnest(ARRAY['id','vehicle_id','image_url','taken_at',
   'file_name','storage_path','is_sensitive','vision_gate_status']) c)
 AND NOT has_table_privilege('anon','public.vehicle_images','SELECT'),'vehicle_images: anon keeps ordinary columns, not precise location/EXIF/device');
SELECT t_assert(has_table_privilege('anon','public.device_attributions','SELECT'),'device_attributions grants untouched (rows limited elsewhere)');
SELECT t_assert(has_table_privilege('authenticated','public.vehicle_images','SELECT') AND has_table_privilege('authenticated','public.device_attributions','SELECT')
 AND has_table_privilege('service_role','public.vehicle_images','SELECT'),'authenticated and service_role unchanged');

SET ROLE anon;
SELECT t_assert(t_refused('SELECT * FROM public.vehicle_images') AND t_refused('SELECT latitude FROM public.vehicle_images')
  AND t_refused('SELECT exif_data FROM public.vehicle_images'),'anon: SELECT * and private columns refused');
SELECT t_assert((SELECT count(*) FROM public.vehicle_images) = 1 AND (SELECT image_url FROM public.vehicle_images) = 'https://x.invalid/1.jpg'
  AND (SELECT camera_make FROM public.device_attributions) = 'Apple','anon: ordinary columns and RLS rows as before');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert((SELECT latitude FROM public.vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001') = 40.1,'authenticated still reads its permitted rows in full');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM vehicle_images WHERE latitude IS NOT NULL) = 1 AND (SELECT count(*) FROM device_attributions WHERE raw_exif IS NOT NULL) = 1,
  'no data changed');
