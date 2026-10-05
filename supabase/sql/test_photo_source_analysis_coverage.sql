-- Synthetic fixtures only; exercises the actual reader migration on disposable PG17.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_photo_coverage%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 photo-coverage database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, organization_status text,
  ai_processing_status text, ai_detected_angle text, ai_detected_vehicle jsonb, file_size bigint,
  source text, file_hash text, is_duplicate boolean, superseded_at timestamptz, is_sensitive boolean,
  created_at timestamptz, taken_at timestamptz, ai_scan_metadata jsonb
);
CREATE TABLE public.vehicle_suggestions (user_id uuid,status text);
CREATE TABLE public.image_analysis_records (
  image_id uuid, superseded_at timestamptz, citation_count int,
  analyzed_by_model text, analyzed_at timestamptz, overall_confidence numeric
);
CREATE TABLE public.image_work_extractions (image_id uuid);
CREATE TABLE public.observation_witnesses (image_id uuid);
CREATE TABLE public.photo_sync_items (
  user_id uuid, classification_verified boolean, classification_category text,
  verified_category text, verified_by uuid, verified_at timestamptz
);
INSERT INTO public.vehicle_images
SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  CASE WHEN n=7 THEN '10000000-0000-0000-0000-000000000002' ELSE '10000000-0000-0000-0000-000000000001' END::uuid,
  CASE WHEN n>4 THEN '30000000-0000-0000-0000-000000000001'::uuid END,
  CASE WHEN n=1 THEN NULL WHEN n IN (2,4) THEN 'unorganized' ELSE 'organized' END,
  CASE n WHEN 1 THEN 'complete' WHEN 2 THEN 'completed' WHEN 3 THEN 'failed' WHEN 4 THEN 'pending' WHEN 5 THEN 'processing' END,
  'front',NULL,n*10,
  CASE WHEN n<=4 THEN 'image_library' WHEN n=5 THEN 'manual' WHEN n=7 THEN 'foreign-source' END,
  CASE WHEN n IN (1,2) THEN 'a' WHEN n=4 THEN 'b' WHEN n=6 THEN 'c' END,
  n=2,CASE WHEN n=2 THEN '2026-01-01'::timestamptz END,n=3,
  '2026-01-01'::timestamptz+n*interval '1 day','2025-12-01'::timestamptz+n*interval '1 day',
  CASE WHEN n=3 THEN '{"classifier_failed":true}'::jsonb ELSE '{}'::jsonb END
FROM generate_series(1,7) n;
INSERT INTO public.image_analysis_records VALUES
 ('20000000-0000-0000-0000-000000000001',NULL,1,'fixture-model','2026-01-02',0.8),
 ('20000000-0000-0000-0000-000000000001','2026-01-03',0,'fixture-model','2026-01-01',0.7),
 ('20000000-0000-0000-0000-000000000002',NULL,0,NULL,'2026-01-04',0.6),
 ('20000000-0000-0000-0000-000000000007',NULL,1,'foreign-model','2026-02-01',1);
INSERT INTO public.image_work_extractions VALUES
 ('20000000-0000-0000-0000-000000000002'),('20000000-0000-0000-0000-000000000002'),('20000000-0000-0000-0000-000000000003');
INSERT INTO public.observation_witnesses VALUES
 ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000003');
INSERT INTO public.photo_sync_items VALUES
 ('10000000-0000-0000-0000-000000000001',true,'work','work','10000000-0000-0000-0000-000000000001','2026-01-03'),
 ('10000000-0000-0000-0000-000000000001',true,'work','receipt','10000000-0000-0000-0000-000000000001','2026-01-04'),
 ('10000000-0000-0000-0000-000000000001',false,'work',NULL,NULL,NULL),
 ('10000000-0000-0000-0000-000000000002',true,'work','work',NULL,NULL);
CREATE FUNCTION public.get_photo_library_stats(p_user_id uuid) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN (SELECT json_build_object('total_photos',count(*)) FROM vehicle_images WHERE user_id=p_user_id); END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_photo_library_stats('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Fixture did not reproduce the empty-search-path failure';
  EXCEPTION WHEN undefined_table THEN NULL; END;
END $$;
\ir ../migrations/20261005021008_photo_library_source_analysis_coverage.sql
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.get_photo_library_stats('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Anonymous caller accessed photo coverage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
  BEGIN PERFORM public.get_photo_library_stats('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Stranger accessed photo coverage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE s jsonb; c jsonb; BEGIN
  s:=public.get_photo_library_stats(auth.uid())::jsonb; c:=s->'source_analysis';
  IF s->>'total_photos'<>'4' OR s->>'unorganized_photos'<>'3' OR s->>'organized_photos'<>'3'
     OR s->>'total_file_size'<>'100' OR s#>>'{ai_status_breakdown,complete}'<>'2' THEN
    RAISE EXCEPTION 'Legacy inbox grain changed: %',s;
  END IF;
  IF c->>'records'<>'6' OR c->>'distinct_hashed_files'<>'3' OR c->>'without_hash'<>'2'
     OR c->>'analysis_records'<>'3' OR c->>'images_with_analysis_records'<>'2'
     OR c->>'current_analysis_records'<>'2' OR c->>'images_with_current_analysis'<>'2'
     OR c->>'images_with_work_extractions'<>'2' OR c->>'images_with_witnesses'<>'2' OR c->>'witness_records'<>'3'
     OR c->>'cited_analysis_records'<>'1' OR c->>'analysis_records_missing_method'<>'1' THEN
    RAISE EXCEPTION 'Owner grain/fanout/source isolation failed: %',c;
  END IF;
  IF c#>>'{recent,sample_size}'<>'6' OR c#>>'{recent,failed}'<>'1' OR c#>>'{recent,classifier_failed}'<>'1'
     OR c#>>'{recent,with_analysis_records}'<>'2' OR c#>>'{reviewed_classifications,verified}'<>'2'
     OR c#>>'{reviewed_classifications,agrees}'<>'1' OR c#>>'{reviewed_classifications,differs}'<>'1'
     OR jsonb_array_length(c->'sources')<>3 OR c::text LIKE '%foreign-source%'
     OR c->'accuracy'<>'null'::jsonb OR c->'device_library_coverage'<>'null'::jsonb THEN
    RAISE EXCEPTION 'Recent/review/unknown-quality contract failed: %',c;
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',false);
DO $$ DECLARE c jsonb; BEGIN
  c:=public.get_photo_library_stats(auth.uid())::jsonb->'source_analysis';
  IF c->>'records'<>'0' OR c->'sources'<>'[]'::jsonb OR c->'latest_ingested_at'<>'null'::jsonb THEN
    RAISE EXCEPTION 'Empty owner cohort is not explicit: %',c;
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN
  BEGIN PERFORM public.get_photo_library_stats('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Missing user id accessed private coverage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
DO $$ BEGIN
  IF public.get_photo_library_stats('10000000-0000-0000-0000-000000000001')::jsonb#>>'{source_analysis,records}'<>'6' THEN
    RAISE EXCEPTION 'Service read failed';
  END IF;
END $$;
RESET ROLE;
