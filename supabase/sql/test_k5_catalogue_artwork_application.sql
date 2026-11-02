\set ON_ERROR_STOP on
-- Reuse the real mark table and retained broad rows; this migration must not overwrite them.
\i supabase/sql/test_identity_marks_record_live_wave3.sql
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
GRANT SELECT ON public.vehicle_identity_marks TO anon, authenticated, service_role;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, year integer, trim text, body_style text, is_public boolean, deleted_at timestamptz);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicles ON public.vehicles FOR SELECT TO anon,authenticated USING (is_public AND deleted_at IS NULL);
GRANT SELECT ON public.vehicles TO anon,authenticated,service_role;
\i supabase/migrations/20261018230000_identity_marks_series_label_fallback.sql
\i supabase/migrations/20261031034021_vehicle_identity_mark_assets.sql
CREATE TEMP TABLE before_marks AS SELECT * FROM public.vehicle_identity_marks;
CREATE TEMP TABLE before_assets AS SELECT * FROM public.vehicle_identity_mark_assets;
\i supabase/migrations/20261101013500_k5_catalogue_artwork_application.sql
\i supabase/migrations/20261101013500_k5_catalogue_artwork_application.sql
SELECT pg_temp.check(NOT EXISTS(SELECT * FROM before_marks EXCEPT SELECT * FROM public.vehicle_identity_marks),'existing marks unchanged');
SELECT pg_temp.check(NOT EXISTS(SELECT * FROM before_assets EXCEPT SELECT * FROM public.vehicle_identity_mark_assets),'original assets unchanged');
SELECT pg_temp.check((SELECT count(*) FROM public.vehicle_identity_mark_assets)=14,'two new scoped registrations, replay idempotent');
SELECT pg_temp.check((SELECT count(*) FROM public.vehicle_identity_marks)=31,'one narrow mark, replay idempotent');
INSERT INTO public.vehicles VALUES
 ('10000000-0000-4000-8000-000000000001','Chevrolet','K5 Blazer',1977,'Cheyenne',NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000002','Chevrolet','K5 Blazer',1974,'Cheyenne',NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000003','Chevrolet','K5 Blazer',1981,'Cheyenne',NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000004','Chevrolet','C10',1977,'Cheyenne',NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000005','Chevrolet','K5 Blazer',NULL,'Cheyenne',NULL,true,NULL),
 ('10000000-0000-4000-8000-000000000006','Chevrolet','K5 Blazer',1977,NULL,NULL,false,NULL),
 ('10000000-0000-4000-8000-000000000007','Chevrolet','K5 Blazer',1977,NULL,NULL,true,now());
SET ROLE anon;
DO $$ DECLARE answer jsonb; rejected uuid; BEGIN
 answer:=public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000001');
 IF jsonb_array_length(answer->'marks')<>1 OR answer->'marks'->0->>'label'<>'K5 Blazer'
 OR jsonb_array_length(answer->'marks'->0->'assets')<>2 THEN RAISE EXCEPTION '1977K5 source/vector binding missing or polluted'; END IF;
 FOREACH rejected IN ARRAY ARRAY['10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005'] LOOP
 IF jsonb_array_length(public.vehicle_identity_artwork(rejected)->'marks')<>0 THEN RAISE EXCEPTION 'Wrong era/model or unknown year inherited badge'; END IF;
 END LOOP;
 IF public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000006') IS NOT NULL
 OR public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000007') IS NOT NULL THEN RAISE EXCEPTION 'Private/deleted vehicle leaked'; END IF;
END $$;
RESET ROLE;
SELECT 'Exact K5 reproduction catalogue application PASS' AS result;
