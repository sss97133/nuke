-- Empty disposable dm_refinement_* database only. SQL assay boundary fixtures.
-- Receipt observer is the real existing implementation; reader/privacy stubs
-- isolate assay decisions without fetching source material or changing prod.
\set ON_ERROR_STOP on
\ir test_comment_write_receipts.sql
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid, created_at timestamptz, image_url text,
  is_sensitive boolean, is_superseded boolean, is_duplicate boolean,
  vision_gate_status text, image_vehicle_match_status text
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, source_id uuid, kind text,
  structured_data jsonb, is_superseded boolean, ingested_at timestamptz
);
CREATE INDEX test_observations_vehicle ON public.vehicle_observations(vehicle_id);
CREATE TABLE public.observation_witnesses (
  id uuid PRIMARY KEY, observation_id uuid, image_id uuid, witness_role text, added_at timestamptz,
  UNIQUE (observation_id,image_id,witness_role)
);
CREATE TABLE public.test_reader (payload jsonb);
CREATE FUNCTION public.observation_is_public(text,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT coalesce($2->>'private','false') <> 'true' $$;
CREATE FUNCTION public.get_field_provenance(uuid,text) RETURNS jsonb LANGUAGE sql STABLE
AS $$ SELECT payload FROM public.test_reader $$;
\ir ../migrations/20261004052152_observe_image_observation_writes.sql

SET request.headers = '{"x-nuke-writer":"ingest-observation"}';
INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001',true);
INSERT INTO public.observation_sources VALUES
  ('20000000-0000-0000-0000-000000000001','photo_pipeline'),
  ('20000000-0000-0000-0000-000000000002','shop');
INSERT INTO public.vehicle_images VALUES (
  '30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  '2026-10-04T05:01:00Z','https://example.invalid/fixture.jpg',false,false,false,'approved',NULL);
INSERT INTO public.vehicle_observations VALUES (
  '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','specification',
  '{"image_id":"30000000-0000-0000-0000-000000000001","interior_color":"fixture"}',false,'2026-10-04T05:01:00Z');
INSERT INTO public.observation_witnesses VALUES (
  '50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','derived','2026-10-04T05:01:00Z');
INSERT INTO public.test_reader VALUES ('{"image_observations":[{
  "observation_id":"40000000-0000-0000-0000-000000000001",
  "image_id":"30000000-0000-0000-0000-000000000001",
  "witness_id":"50000000-0000-0000-0000-000000000001"}]}');
