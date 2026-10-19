-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- Contract for 20261015021500_pulse_bat_platform_literal.sql: the service-only pulse's fresh_image_flow selects the
-- newest public BaT vehicle by platform_source. Writers stamp BaT as 'bringatrailer'; the previous body
-- (20261004144946) looked for 'bat' and could never select one. After the migration a 'bringatrailer' vehicle is
-- selected and its BaT image links are sampled; 'bat' still matches; a non-BaT vehicle is not selected.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- The columns the pulse reads, nothing else.
CREATE TABLE public.vehicles(
  id uuid PRIMARY KEY, platform_source text, source text, created_at timestamptz NOT NULL,
  is_public boolean, status text, deleted_at timestamptz, listing_kind text);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, vehicle_id uuid, source text, created_at timestamptz NOT NULL,
  ai_processing_status text, ai_scan_metadata jsonb,
  ai_processing_started_at timestamptz, ai_processing_completed_at timestamptz);
CREATE TABLE public.listing_feeds(id uuid PRIMARY KEY, enabled boolean, last_polled_at timestamptz, last_error text);
CREATE TABLE public.import_queue(status text, updated_at timestamptz);
CREATE TABLE public.nuke_estimates(calculated_at timestamptz);
-- Stand-in for the live gallery predicate; the pulse only counts it.
CREATE FUNCTION public.vehicle_image_gallery_eligible(i public.vehicle_images) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT i.ai_processing_status = 'completed' $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- One public BaT vehicle created a minute ago, as extract-bat-core stamps it, with two image links.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'bringatrailer', 'bat', now() - interval '1 minute', true, 'active', NULL, NULL);
INSERT INTO public.vehicle_images VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'bat_import', now() - interval '30 seconds',
   'completed', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'bat_import', now() - interval '20 seconds',
   'pending', '{}'::jsonb, NULL, NULL);

-- The previous body cannot select it.
\ir ../migrations/20261004144946_report_fresh_image_admission_policy.sql
SELECT pg_temp.ok('before: a bringatrailer vehicle is not selected',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,vehicle_selected}')::boolean IS FALSE);

\ir ../migrations/20261015021500_pulse_bat_platform_literal.sql
-- A second application is a no-op.
\ir ../migrations/20261015021500_pulse_bat_platform_literal.sql

SELECT pg_temp.ok('after: the bringatrailer vehicle is selected',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,vehicle_selected}')::boolean IS TRUE);
SELECT pg_temp.ok('after: its two BaT image links are sampled',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,metrics,sampled}')::int = 2);
SELECT pg_temp.ok('after: one completed, one pending',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,metrics,completed}')::int = 1
  AND (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,metrics,pending}')::int = 1);

-- 'bat' still matches; a newer non-BaT public vehicle does not displace the BaT one from selection.
UPDATE public.vehicles SET platform_source = 'bat' WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.ok('the legacy spelling bat still matches',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,vehicle_selected}')::boolean IS TRUE);
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'craigslist', 'craigslist', now(), true, 'active', NULL, NULL);
SELECT pg_temp.ok('a non-BaT vehicle is never the selected one',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,metrics,sampled}')::int = 2);
DELETE FROM public.vehicles WHERE platform_source IN ('bat', 'bringatrailer');
SELECT pg_temp.ok('with no BaT candidate nothing is selected',
  (public.get_pipeline_pulse_24h() #>> '{fresh_image_flow,vehicle_selected}')::boolean IS FALSE);
