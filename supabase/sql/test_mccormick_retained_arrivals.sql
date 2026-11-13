-- Disposable PG17 schema/dispatch contract. The testimony table stays empty.
-- Actual migration DDL is applied there; its resulting predicate/callback is
-- exercised on a separate synthetic arrival table. Source admission and privacy
-- are tested separately against the actual qualifier and deployed canaries.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required';END IF;END $$;
CREATE TYPE public.observation_kind AS ENUM('listing','sale_result','specification');
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,source_id uuid,kind public.observation_kind,
 property_id uuid,ingested_at timestamptz,extraction_method text,is_superseded boolean DEFAULT false,
 subject_type text DEFAULT 'vehicle',subject_id uuid,source_url text,observed_at timestamptz,content_text text,structured_data jsonb);
CREATE TABLE public.vehicles(id uuid,is_public boolean,deleted_at timestamptz,listing_kind text);
CREATE TABLE public.observation_sources(id uuid,slug text);
CREATE TABLE public.retained_listing_property_work(source_observation_id uuid,status text);
CREATE TABLE public.retained_listing_property_replay(id boolean PRIMARY KEY,record_replay jsonb,scan_completed_at timestamptz,native_identity_completed_at timestamptz);
CREATE TABLE public.fixture_requests(source_observation_id uuid PRIMARY KEY);
CREATE TABLE public.fixture_arrivals(LIKE public.vehicle_observations INCLUDING DEFAULTS);
CREATE FUNCTION public.observation_is_public(public.observation_kind,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE FUNCTION public.enqueue_retained_listing_properties(p_source uuid) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.fixture_requests VALUES(p_source) ON CONFLICT DO NOTHING;RETURN 1;END $$;
CREATE FUNCTION public.enqueue_retained_listing_properties(p_sources uuid[]) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
\ir fixtures/mccormick_replay_baseline.sql
\ir fixtures/mccormick_arrival_baseline.sql
\ir ../migrations/20261111041200_mccormick_retained_replay.sql
\ir ../migrations/20261111041200_mccormick_retained_replay.sql
DO $adapter$
DECLARE t text;
BEGIN
 SELECT pg_get_triggerdef(oid) INTO t FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake';
 IF position('mccormick_html_v1' IN t)=0 OR position(' ON public.vehicle_observations ' IN t)=0 THEN RAISE EXCEPTION 'actual arrival migration not installed';END IF;
 -- Only the test relation/name change; predicate and real callback stay intact.
 t:=replace(t,'CREATE TRIGGER retained_listing_property_intake ','CREATE TRIGGER fixture_arrival_dispatch ');
 t:=replace(t,' ON public.vehicle_observations ',' ON public.fixture_arrivals ');
 EXECUTE t;
END $adapter$;
INSERT INTO public.fixture_arrivals(id,source_id,kind,extraction_method) VALUES
 ('00000000-0000-4000-8000-000000000001','006f01c3-e5fb-44f5-ab40-e55b0654de1c','listing','mccormick_html_v1'),
 ('00000000-0000-4000-8000-000000000002','006f01c3-e5fb-44f5-ab40-e55b0654de1c','specification','mccormick_html_v1'),
 ('00000000-0000-4000-8000-000000000003','006f01c3-e5fb-44f5-ab40-e55b0654de1c','listing','mccormick_catalog_v1'),
 ('00000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','listing','mccormick_html_v1'),
 ('00000000-0000-4000-8000-000000000005','006f01c3-e5fb-44f5-ab40-e55b0654de1c','listing','other'),
 ('00000000-0000-4000-8000-000000000006','4cdc735c-f117-42f2-889f-ba33805639a5','listing','html_match');
DO $contract$
BEGIN
 IF (SELECT count(*) FROM public.fixture_requests)<>2
  OR NOT EXISTS(SELECT FROM public.fixture_requests WHERE source_observation_id='00000000-0000-4000-8000-000000000001')
  OR NOT EXISTS(SELECT FROM public.fixture_requests WHERE source_observation_id='00000000-0000-4000-8000-000000000006') THEN
  RAISE EXCEPTION 'new or existing arrival route changed';END IF;
 IF EXISTS(SELECT FROM public.vehicle_observations) THEN RAISE EXCEPTION 'testimony table must stay empty';END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake')<>1 THEN RAISE EXCEPTION 'migration replay duplicated trigger';END IF;
 RAISE NOTICE 'PASS: actual arrival DDL, unchanged callback, new source gate, existing route and empty testimony table';
END $contract$;
