\set ON_ERROR_STOP on
\i supabase/sql/test_k5_catalogue_artwork_application.sql
ALTER TABLE public.vehicles ADD COLUMN normalized_model text, ADD COLUMN series text;
-- Exact public 1977 profile identity at 2026-11-01: legacy Blazer, normalized K5 Blazer, series K5.
UPDATE public.vehicles SET model='Blazer', normalized_model='K5 Blazer', series='K5'
 WHERE id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.check(jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000001')->'marks')=0,'reproduces deployed raw-model mismatch');
\i supabase/migrations/20261101021000_artwork_read_profile_identity.sql
SET ROLE anon;
SELECT pg_temp.check(jsonb_array_length(public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000001')->'marks')=1,'anonymous recorded normalized identity reaches scoped artwork');
RESET ROLE;
-- A normalized different model must win over misleading raw text; a bare Blazer must not infer K5.
UPDATE public.vehicles SET normalized_model='C10' WHERE id='10000000-0000-4000-8000-000000000004';
UPDATE public.vehicles SET model='K5 Blazer' WHERE id='10000000-0000-4000-8000-000000000004';
INSERT INTO public.vehicles(id,make,model,year,is_public) VALUES ('10000000-0000-4000-8000-000000000008','Chevrolet','Blazer',1977,true);
SET ROLE anon;
DO $$ DECLARE rejected uuid; BEGIN
 FOREACH rejected IN ARRAY ARRAY['10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000008'] LOOP
 IF jsonb_array_length(public.vehicle_identity_artwork(rejected)->'marks')<>0 THEN RAISE EXCEPTION 'Unsupported identity inherited artwork'; END IF;
 END LOOP;
 IF public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000006') IS NOT NULL OR public.vehicle_identity_artwork('10000000-0000-4000-8000-000000000007') IS NOT NULL THEN RAISE EXCEPTION 'Private/deleted vehicle leaked'; END IF;
END $$;
RESET ROLE;
SELECT 'Recorded profile identity artwork reader PASS' AS result;
