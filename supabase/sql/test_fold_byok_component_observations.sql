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
  occurred_at timestamptz,
  exif_data jsonb,
  dhash text,
  phash text,
  filename text,
  storage_path text,
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
  observed_at_basis text,
  source_event_at timestamptz,
  source_event_date date,
  source_event_time_precision text,
  ingested_at timestamptz,
  is_superseded boolean DEFAULT false,
  superseded_by uuid,
  superseded_at timestamptz,
  subject_type text NOT NULL DEFAULT 'vehicle',
  analysis_deferred boolean NOT NULL DEFAULT false,
  rank text NOT NULL DEFAULT 'normal',
  CHECK ((observed_at_basis IS NULL) OR (observed_at_basis = ANY (ARRAY['event_time','source_capture_time','source_publication_time']))),
  CHECK ((source_event_time_precision IS NULL) OR (source_event_time_precision = ANY (ARRAY['exact','day','unknown']))),
  CHECK (
    ((source_event_time_precision IS NULL) AND (source_event_at IS NULL) AND (source_event_date IS NULL))
    OR ((source_event_time_precision IS NOT NULL) AND (observed_at_basis IS NOT NULL) AND (
      ((source_event_time_precision = 'exact') AND (source_event_at IS NOT NULL))
      OR ((source_event_time_precision = 'day') AND (source_event_date IS NOT NULL) AND (source_event_at IS NULL))
      OR ((source_event_time_precision = 'unknown') AND (source_event_at IS NULL) AND (source_event_date IS NULL))
    ))
  )
);

\ir ../migrations/20261122081000_replica_target_byok_component_fold.sql

INSERT INTO vehicles(id, make, model, year, vin, is_replica, replica_quote, is_public)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 'Firebird', 1973, '2S87D3N143591',
        true, 'Built as a Trans Am SD-455 clone', true);

-- Import-time taken_at differs across images; real capture clocks absent → groups must not key on import hour.
INSERT INTO vehicle_images(id, vehicle_id, taken_at, created_at, filename, dhash, ai_scan_metadata) VALUES
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
  '2026-10-01 12:00:00+00', '2026-10-01 12:00:00+00', 'IMG_0100.jpg', 'abcd1234',
  '{"byok_deep_analysis":{"scene_type":"body_exterior","build_phase_guess":"final_assembly","components_seen":[
     {"label":"Red shaker scoop","confidence":0.99},
     {"label":"Hood bird graphic","confidence":0.95},
     {"label":"Rear deck spoiler","confidence":0.97},
     {"label":"Left front wheel and white-letter tire","confidence":0.9},
     {"label":"Unrelated chrome trim bit","confidence":0.8}
   ]}}'::jsonb),
 ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1',
  '2026-10-02 18:00:00+00', '2026-10-02 18:00:00+00', 'IMG_0105.jpg', 'abcd9999',
  '{"byok_deep_analysis":{"scene_type":"engine_bay","build_phase_guess":"final_assembly","components_seen":[
     {"label":"Partial plated brake vacuum booster","confidence":0.99},
     {"label":"Blue-painted intake manifold","confidence":0.96},
     {"label":"Chrome valve cover","confidence":0.93},
     {"label":"Alternator","confidence":0.9}
   ]}}'::jsonb),
 ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1',
  '2026-10-03 09:00:00+00', '2026-10-03 09:00:00+00', 'printout_scan.jpg', 'ffff0001',
  '{"byok_deep_analysis":{"scene_type":"receipt_document","build_phase_guess":"unknown","text_regions":["a","b","c"],"components_seen":[
     {"label":"Build sheet printout","confidence":0.95}
   ]}}'::jsonb);

-- Real EXIF capture on a fourth image (same scene/area/phase/dhash4/seq as d1 would diverge on capture hour).
INSERT INTO vehicle_images(id, vehicle_id, taken_at, created_at, filename, dhash, exif_data, ai_scan_metadata) VALUES
 ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1',
  '2026-10-01 12:00:00+00', '2026-10-01 12:00:00+00', 'IMG_0110.jpg', 'abcd5678',
  '{"DateTimeOriginal":"2024:05:15 14:30:00"}'::jsonb,
  '{"byok_deep_analysis":{"scene_type":"body_exterior","build_phase_guess":"final_assembly","components_seen":[
     {"label":"Bumper","confidence":0.9}
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
SELECT public.assert(
  (public.normalize_byok_component_label('Chrome valve cover')->>'property_key') = 'image_visible_valve_cover',
  'valve cover maps to engine internals');
SELECT public.assert(
  (public.normalize_byok_component_label('Build sheet printout')->>'property_key') = 'image_visible_reference_document',
  'printout maps to reference document');
SELECT public.assert(
  public.byok_normalize_build_phase('receipt_document', 'unknown', NULL) = 'document_printout',
  'receipt scene becomes document_printout phase');
SELECT public.assert(
  public.byok_real_capture_at('{"DateTimeOriginal":"2024:05:15 14:30:00"}'::jsonb, NULL) IS NOT NULL,
  'EXIF DateTimeOriginal parses');
SELECT public.assert(
  public.byok_real_capture_at('{"DateTime":"2024:05:15 14:30:00"}'::jsonb, NULL) IS NULL,
  'EXIF DateTime (mtime) is not a capture clock');
SELECT public.assert(
  public.byok_real_capture_at(
    '{"DateTimeOriginal":"2024:05:15 14:30:00","OffsetTimeOriginal":"-07:00"}'::jsonb, NULL
  ) = '2024-05-15 21:30:00+00'::timestamptz,
  'OffsetTimeOriginal pins the instant');
SELECT public.assert(
  public.byok_real_capture_at(NULL, NULL) IS NULL,
  'no real capture when EXIF and occurred_at absent');
SELECT public.assert(
  public.byok_img_seq_bucket('IMG20241122143000.jpg') IS NOT NULL
  AND public.byok_img_seq_bucket('IMG20241122143000.jpg') <> 'noseq',
  'datetime-style IMG digit runs use bigint seq bucket');

-- Dry-run proposes claims without writing.
SELECT public.assert(
  (public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', true)
    ->>'claims_proposed')::int >= 8,
  'dry-run proposes keyed claims from parsed labels');
SELECT public.assert(
  (SELECT count(*) FROM vehicle_observations) = 0,
  'dry-run writes no observations');

-- Grouping ignores import taken_at: d1 and d2 have different import hours but different scenes → ≥2 groups;
-- neither group_key embeds an import YYYY-MM hour from taken_at.
SELECT public.assert(
  (public.group_vehicle_images_for_reading('00000000-0000-0000-0000-0000000000a1', true)
    ->>'group_count')::int >= 3,
  'grouping returns multiple scene/area/phase groups');
SELECT public.assert(
  NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        public.group_vehicle_images_for_reading('00000000-0000-0000-0000-0000000000a1', true)->'groups'
      ) g
     WHERE g.value->>'capture_hour_key' LIKE '2026-10-%'
  ),
  'grouping does not key on Oct-2026 import taken_at');
SELECT public.assert(
  EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        public.group_vehicle_images_for_reading('00000000-0000-0000-0000-0000000000a1', true)->'groups'
      ) g
     WHERE g.value->>'build_phase' = 'document_printout'
  ),
  'document_printout phase appears in groups');
SELECT public.assert(
  EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        public.vehicle_build_phase_windows('00000000-0000-0000-0000-0000000000a1')->'phases'
      ) p
     WHERE p.value->>'phase' = 'document_printout'
  ),
  'phase windows include document_printout');
SELECT public.assert(
  EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        public.vehicle_build_phase_windows('00000000-0000-0000-0000-0000000000a1')->'phases'
      ) p
     WHERE p.value->>'phase' = 'final_assembly'
       AND (p.value->>'dated_count')::int >= 1
       AND p.value->>'earliest' IS NOT NULL
  ),
  'phase windows carry earliest from real EXIF when present');

-- Apply once.
SELECT public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false);
SELECT public.assert(
  (SELECT count(*) FROM vehicle_observations WHERE property_id IS NOT NULL) >= 8,
  'apply lands keyed observations');
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
    WHERE op.property_key = 'image_visible_hood_scoop_style'
      AND vo.structured_data->>'image_visible_hood_scoop_style' = 'shaker'
  ), 'shaker scoop keyed');
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
    WHERE op.property_key = 'image_visible_valve_cover'
  ), 'valve cover keyed');
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM vehicle_observations vo
    WHERE vo.structured_data->>'image_id' = '00000000-0000-0000-0000-0000000000d1'
      AND vo.source_event_time_precision = 'unknown'
      AND vo.source_event_at IS NULL
      AND vo.observed_at_basis = 'source_capture_time'
  ), 'no-EXIF fold writes precision unknown with allowed basis');
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM vehicle_observations vo
    WHERE vo.structured_data->>'image_id' = '00000000-0000-0000-0000-0000000000d4'
      AND vo.source_event_time_precision = 'exact'
      AND vo.source_event_at IS NOT NULL
      AND vo.observed_at_basis = 'event_time'
      AND vo.structured_data->>'capture_clock_source' = 'exif_DateTimeOriginal'
  ), 'EXIF fold writes source_event_at exact with event_time basis');

-- Idempotent re-apply.
SELECT public.assert(
  (public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false)
    ->>'claims_inserted')::int = 0,
  'second apply inserts nothing');
SELECT public.assert(
  (public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false)
    ->>'claims_unchanged')::int >= 8,
  'second apply reports unchanged');

-- Value change for same image+property supersedes prior current row.
-- Mutate after capturing parsed_claims so null-filter assertion still sees original labels.
SELECT public.assert(
  NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        public.read_vehicle_image_group('00000000-0000-0000-0000-0000000000a1')->'groups'
      ) g
      CROSS JOIN LATERAL jsonb_array_elements(g.value->'parsed_claims') c
     WHERE c.value->>'property_key' IS NULL
  ),
  'parsed_claims exclude unparsed null normalizations');

UPDATE vehicle_images
   SET ai_scan_metadata = jsonb_set(
     ai_scan_metadata,
     '{byok_deep_analysis,components_seen}',
     '[{"label":"Plain steel road wheel and tire","confidence":0.9}]'::jsonb
   )
 WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false);
SELECT public.assert(
  (SELECT count(*) FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE op.property_key = 'image_visible_wheel_style'
     AND vo.structured_data->>'image_id' = '00000000-0000-0000-0000-0000000000d1'
     AND coalesce(vo.is_superseded, false) IS NOT TRUE) = 1
  AND EXISTS (
    SELECT 1 FROM vehicle_observations vo
    JOIN observation_properties op ON op.id = vo.property_id
   WHERE op.property_key = 'image_visible_wheel_style'
     AND vo.structured_data->>'image_id' = '00000000-0000-0000-0000-0000000000d1'
     AND vo.is_superseded IS TRUE
     AND vo.superseded_by IS NOT NULL
  ),
  'changed wheel value supersedes prior current claim');

SELECT public.assert(
  (public.group_vehicle_images_for_reading('00000000-0000-0000-0000-0000000000a1', true)
    ->>'group_count')::int >= 1,
  'grouping returns at least one group');
SELECT public.assert(
  (public.read_vehicle_image_group('00000000-0000-0000-0000-0000000000a1')
    ->>'group_count')::int >= 1,
  'group-level read returns combined labels');
SELECT public.assert(
  (public.gap_vs_build_replica_components('00000000-0000-0000-0000-0000000000a1', true)
    ->>'gap_count')::int >= 1
  OR (public.gap_vs_build_replica_components('00000000-0000-0000-0000-0000000000a1', true)
    ->>'build_count')::int >= 1,
  'gap_vs_build classifies target components');

SELECT public.assert(true, 'fold_byok_component_observations contract complete');
