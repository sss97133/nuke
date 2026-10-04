-- Actual migration in an EMPTY disposable database only; no live writes or model calls.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'dm_refinement_fresh_image_admission'
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_fresh_image_admission';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, created_at timestamptz, source text,
  platform_source text, is_public boolean DEFAULT true, status text DEFAULT 'active',
  deleted_at timestamptz, listing_kind text);
CREATE INDEX idx_vehicles_feed_main ON public.vehicles(created_at DESC)
  WHERE is_public=true AND status<>'pending';
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, source text,
  created_at timestamptz, ai_processing_status text, ai_scan_metadata jsonb,
  ai_processing_started_at timestamptz, ai_processing_completed_at timestamptz,
  fixture_gallery_eligible boolean DEFAULT true);
CREATE INDEX idx_vehicle_images_vehicle_created ON public.vehicle_images(vehicle_id,created_at DESC);
-- The existing computed gallery reader is not changed by this migration.
CREATE FUNCTION public.vehicle_image_gallery_eligible(i public.vehicle_images)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT i.fixture_gallery_eligible $$;
CREATE TABLE public.listing_feeds(id uuid,enabled boolean,last_polled_at timestamptz,last_error text);
CREATE TABLE public.import_queue(status text,updated_at timestamptz);
CREATE TABLE public.nuke_estimates(calculated_at timestamptz);
INSERT INTO public.listing_feeds VALUES('46b8373b-2454-4cbb-926c-7646c90e560d',true,now(),'fixture-error');
INSERT INTO public.import_queue VALUES('pending',now()),('processing',now()-interval '3 hours');
INSERT INTO public.nuke_estimates VALUES('2026-10-04T10:00Z');
CREATE FUNCTION public.get_pipeline_pulse_24h() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
REVOKE ALL ON FUNCTION public.get_pipeline_pulse_24h() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_pulse_24h() TO service_role;
CREATE TABLE public.fixture_acl AS
  SELECT proacl FROM pg_proc WHERE oid='public.get_pipeline_pulse_24h()'::regprocedure;
\ir ../migrations/20261004144946_report_fresh_image_admission_policy.sql

DO $$ DECLARE p jsonb:=public.get_pipeline_pulse_24h(); a jsonb:=p->'fresh_image_flow'; BEGIN
  IF a->'metrics'->>'sampled' IS DISTINCT FROM '0' OR a->>'vehicle_selected' IS DISTINCT FROM 'false'
    OR a->>'sample_truncated' IS DISTINCT FROM 'false' OR a->>'output_coverage' IS DISTINCT FROM 'not_measured' THEN
    RAISE EXCEPTION 'Empty scope must remain explicit'; END IF;
  IF p->'new_vehicles_24h_by_source' IS DISTINCT FROM '{}'::jsonb OR p->>'unknown_source_new_24h' IS DISTINCT FROM '0'
    OR p->>'feeds_enabled' IS DISTINCT FROM '1' OR p->>'feeds_polled_24h' IS DISTINCT FROM '1'
    OR p->>'vegas_feed_last_error' IS DISTINCT FROM 'fixture-error' OR p->>'import_queue_pending' IS DISTINCT FROM '1'
    OR p->>'import_queue_stuck_processing' IS DISTINCT FROM '1'
    OR (p->>'last_valuation_run')::timestamptz IS DISTINCT FROM '2026-10-04T10:00Z'::timestamptz
    OR p->>'last_valuation_run_method' IS NULL OR p->>'last_valuation_run_method' NOT LIKE 'approx: max(nuke_estimates.calculated_at)%'
    OR p->>'generated_at' IS NULL THEN RAISE EXCEPTION 'Existing pulse keys changed'; END IF;
  IF (SELECT proacl FROM pg_proc WHERE oid='public.get_pipeline_pulse_24h()'::regprocedure)
      IS DISTINCT FROM (SELECT proacl FROM public.fixture_acl)
    OR has_function_privilege('anon','public.get_pipeline_pulse_24h()','EXECUTE')
    OR has_function_privilege('authenticated','public.get_pipeline_pulse_24h()','EXECUTE')
    OR NOT has_function_privilege('service_role','public.get_pipeline_pulse_24h()','EXECUTE') THEN
    RAISE EXCEPTION 'Service-only grants changed'; END IF;
END $$;
INSERT INTO public.vehicles(id,created_at,source,platform_source) VALUES
  ('11111111-1111-1111-1111-111111111111',now(),'bat','bat');
INSERT INTO public.vehicle_images(id,vehicle_id,source,created_at,ai_processing_status,ai_scan_metadata) VALUES
  ('22222222-2222-2222-2222-000000000001','11111111-1111-1111-1111-111111111111','bat_import',now(),'skipped',
    '{"image_intake":{"version":1,"producer":"extract-bat-core","mode":"source_link_only","analysis_requested":false,"reason":"external_link_analysis_requires_explicit_request"}}'),
  ('22222222-2222-2222-2222-000000000002','11111111-1111-1111-1111-111111111111','bat_import',now(),'skipped',NULL);
DO $$ DECLARE a jsonb:=public.get_pipeline_pulse_24h()->'fresh_image_flow'; BEGIN
  IF a->'metrics'->>'sampled' IS DISTINCT FROM '2' OR a->'metrics'->>'gallery_eligible' IS DISTINCT FROM '2'
    OR a->'metrics'->>'source_policy_deferred' IS DISTINCT FROM '1' OR a->'metrics'->>'unexplained_skips' IS DISTINCT FROM '1'
    OR a->'metrics'->>'pipeline_receipts' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Known policy and legacy unknown skips must differ: %',a; END IF;
END $$;
-- Declarations cannot hide actual later work or be forged by string-valued booleans.
DO $$ DECLARE baseline jsonb; a jsonb; BEGIN
  SELECT ai_scan_metadata INTO baseline FROM public.vehicle_images WHERE id='22222222-2222-2222-2222-000000000001';
  UPDATE public.vehicle_images SET ai_scan_metadata=jsonb_set(baseline,'{image_intake,analysis_requested}','"false"')
    WHERE id='22222222-2222-2222-2222-000000000001';
  a:=public.get_pipeline_pulse_24h()->'fresh_image_flow';
  IF a->'metrics'->>'source_policy_deferred' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Malformed policy accepted'; END IF;
  UPDATE public.vehicle_images SET ai_scan_metadata=baseline||'{"photo_pipeline":{"outcome":"failed"}}'
    WHERE id='22222222-2222-2222-2222-000000000001';
  a:=public.get_pipeline_pulse_24h()->'fresh_image_flow';
  IF a->'metrics'->>'source_policy_deferred' IS DISTINCT FROM '0' OR a->'metrics'->>'pipeline_receipts' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Initial policy hid later receipt'; END IF;
  UPDATE public.vehicle_images SET ai_scan_metadata=baseline,ai_processing_started_at=now()
    WHERE id='22222222-2222-2222-2222-000000000001';
  IF public.get_pipeline_pulse_24h()->'fresh_image_flow'->'metrics'->>'source_policy_deferred' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Initial policy hid later processing clock'; END IF;
  UPDATE public.vehicle_images SET ai_scan_metadata=baseline,ai_processing_started_at=NULL,ai_processing_status='failed'
    WHERE id='22222222-2222-2222-2222-000000000001';
  a:=public.get_pipeline_pulse_24h()->'fresh_image_flow';
  IF a->'metrics'->>'failed' IS DISTINCT FROM '1' OR a->'metrics'->>'source_policy_deferred' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Policy hid failed processing status'; END IF;
  UPDATE public.vehicle_images SET ai_processing_status='completed',fixture_gallery_eligible=false
    WHERE id='22222222-2222-2222-2222-000000000001';
  a:=public.get_pipeline_pulse_24h()->'fresh_image_flow';
  IF a->'metrics'->>'completed' IS DISTINCT FROM '1' OR a->'metrics'->>'gallery_eligible' IS DISTINCT FROM '1'
    OR a->>'output_coverage' IS DISTINCT FROM 'not_measured' THEN RAISE EXCEPTION 'Completed status certified output'; END IF;
END $$;
INSERT INTO public.vehicle_images(id,vehicle_id,source,created_at,ai_processing_status)
SELECT ('22222222-2222-2222-2222-'||lpad(n::text,12,'0'))::uuid,
  '11111111-1111-1111-1111-111111111111','bat_import',now(),'pending' FROM generate_series(3,22) n;
DO $$ DECLARE a jsonb:=public.get_pipeline_pulse_24h()->'fresh_image_flow'; BEGIN
  IF a->'metrics'->>'sampled' IS DISTINCT FROM '20' OR a->>'sample_truncated' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Image sentinel cap not retained'; END IF;
END $$;
-- New private/deleted/pending/non-vehicle records never replace the public sample.
INSERT INTO public.vehicles(id,created_at,platform_source,is_public,deleted_at,status,listing_kind) VALUES
  ('33333333-3333-3333-3333-000000000001',now()+interval '1 minute','bat',false,NULL,'active',NULL),
  ('33333333-3333-3333-3333-000000000002',now()+interval '1 minute','bat',true,now(),'active',NULL),
  ('33333333-3333-3333-3333-000000000003',now()+interval '1 minute','bat',true,NULL,'pending',NULL),
  ('33333333-3333-3333-3333-000000000004',now()+interval '1 minute','bat',true,NULL,'active','non_vehicle_item');
DO $$ BEGIN
  IF public.get_pipeline_pulse_24h()->'fresh_image_flow'->'metrics'->>'sampled' IS DISTINCT FROM '20' THEN
    RAISE EXCEPTION 'Excluded vehicle displaced selected scope'; END IF;
END $$;
UPDATE public.vehicle_images SET created_at=now()-interval '25 hours';
DO $$ BEGIN
  IF public.get_pipeline_pulse_24h()->'fresh_image_flow'->'metrics'->>'sampled' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Old image arrivals included'; END IF;
END $$;
UPDATE public.vehicles SET created_at=now()-interval '25 hours'
  WHERE id='11111111-1111-1111-1111-111111111111';
DO $$ BEGIN
  IF public.get_pipeline_pulse_24h()->'fresh_image_flow'->>'vehicle_selected' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Old vehicle arrivals included'; END IF;
END $$;
UPDATE public.vehicles SET created_at=now()
  WHERE id='11111111-1111-1111-1111-111111111111';
INSERT INTO public.vehicles(id,created_at,platform_source)
SELECT ('44444444-4444-4444-4444-'||lpad(n::text,12,'0'))::uuid,
  now()+interval '1 minute','craigslist' FROM generate_series(1,5) n;
DO $$ DECLARE a jsonb:=public.get_pipeline_pulse_24h()->'fresh_image_flow'; BEGIN
  IF a->>'vehicle_selected' IS DISTINCT FROM 'false' OR a->'metrics'->>'sampled' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Candidate cap broadened into a BaT corpus search'; END IF;
END $$;
SELECT 'fresh image admission, scope, old pulse keys and service-only ACL verified' AS result;
