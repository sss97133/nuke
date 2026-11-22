-- Disposable PG17 contract: raw byok components_seen → keyed observations (idempotent).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
SET TimeZone = 'UTC';

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  make text, model text, year int, vin text, is_replica boolean, replica_quote text,
  is_public boolean DEFAULT true, deleted_at timestamptz
);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.observation_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_key text UNIQUE NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'enum',
  namespace text NOT NULL DEFAULT 'core',
  category text,
  applies_to_kinds text[],
  cardinality text NOT NULL DEFAULT 'multi',
  description text,
  discriminator_key text,
  verification_scope text,
  ratified_at timestamptz
);

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  taken_at timestamptz,
  created_at timestamptz DEFAULT now(),
  ai_scan_metadata jsonb,
  is_superseded boolean DEFAULT false,
  is_duplicate boolean DEFAULT false
);

CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  kind text NOT NULL,
  property_id uuid,
  extraction_method text,
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_text text,
  confidence_score numeric,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz,
  is_superseded boolean DEFAULT false,
  subject_type text NOT NULL DEFAULT 'vehicle',
  analysis_deferred boolean NOT NULL DEFAULT false,
  rank text NOT NULL DEFAULT 'normal'
);

\ir ../migrations/20261122081000_replica_target_byok_component_fold.sql

INSERT INTO vehicles(id, make, model, year, vin, is_replica, replica_quote, is_public)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 'Firebird', 1973, '2S87D3N143591',
        true, 'Built as a Trans Am SD-455 clone', true);

INSERT INTO vehicle_images(id, vehicle_id, taken_at, ai_scan_metadata) VALUES
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '2024-06-01 12:00:00+00',
  '{"byok_deep_analysis":{"scene_type":"body_exterior","build_phase_guess":"final_assembly","components_seen":[
     {"label":"Red shaker scoop","confidence":0.99},
     {"label":"Hood bird graphic","confidence":0.95},
     {"label":"Rear deck spoiler","confidence":0.97},
     {"label":"Left front wheel and white-letter tire","confidence":0.9},
     {"label":"Unrelated chrome trim bit","confidence":0.8}
   ]}}'::jsonb),
 ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', '2024-06-01 12:05:00+00',
  '{"byok_deep_analysis":{"scene_type":"engine_bay","build_phase_guess":"final_assembly","components_seen":[
     {"label":"Partial plated brake vacuum booster","confidence":0.99},
     {"label":"Blue-painted intake manifold","confidence":0.96}
   ]}}'::jsonb);

-- Normalizer unit checks.
SELECT public.assert(
  (public.normalize_byok_component_label('Red shaker scoop')->>'value') = 'shaker',
  'shaker label maps');
SELECT public.assert(
  public.normalize_byok_component_label('Unrelated chrome trim bit') IS NULL,
  'unknown label stays null (never invent)');
SELECT public.assert(
  public.normalize_byok_component_label('Exposed flywheel teeth') IS NULL,
  'flywheel does not map to road wheel');
SELECT public.assert(
  public.normalize_byok_component_label('Steering wheel') IS NULL,
  'steering wheel does not map to road wheel');
SELECT public.assert(
  (public.normalize_byok_component_label('Left front wheel and white-letter tire')->>'value') = 'rally',
  'road wheel + white-letter maps to rally');
SELECT public.assert(
  (public.normalize_byok_component_label('Rally II wheels')->>'value') = 'rally',
  'rally ii (lowercased) maps after lower()');

-- Dry-run proposes claims without writing.
SELECT public.assert(
  (public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', true)
    ->>'claims_proposed')::int >= 6,
  'dry-run proposes keyed claims from parsed labels');
SELECT public.assert(
  (SELECT count(*) FROM vehicle_observations) = 0,
  'dry-run writes no observations');

-- Apply once.
SELECT public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false);
SELECT public.assert(
  (SELECT count(*) FROM vehicle_observations WHERE property_id IS NOT NULL) >= 6,
  'apply lands keyed observations');
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
    WHERE op.property_key = 'image_visible_hood_scoop_style'
      AND vo.structured_data->>'image_visible_hood_scoop_style' = 'shaker'
  ), 'shaker scoop keyed');

-- Idempotent re-apply.
SELECT public.assert(
  (public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false)
    ->>'claims_inserted')::int = 0,
  'second apply inserts nothing');
SELECT public.assert(
  (public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false)
    ->>'claims_unchanged')::int >= 6,
  'second apply reports unchanged');

SELECT public.assert(
  (public.group_vehicle_images_for_reading('00000000-0000-0000-0000-0000000000a1', true)
    ->>'group_count')::int >= 1,
  'grouping returns at least one group');

SELECT public.assert(true, 'fold_byok_component_observations contract complete');
