-- Contract for 20261123121500_project_photo_keys_from_readings.sql, on a fresh disposable
-- database: automatic.admits gains the registered rust and paint lists; the planner
-- maps only those registered enums (plus stored assembly state) from filed, eligible
-- deep readings; unmapped findings stay unwritten; 9cf5b7a4, empty URL, unfiled,
-- sensitive, rejected_personal, low confidence, picture-of-picture, and
-- not-intent-only clarification are skipped; already-projected keys are not
-- repeated; GPS does not appear on a claim; a recorded run can be reverted by
-- superseding its observations. The planner itself never writes observations.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'needs an empty disposable database';
  END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);
INSERT INTO public.platform_config (config_key, config_value) VALUES (
  'image_reading_tiers',
  '{"automatic":{"admits":{"scene_type":["undercarriage","engine_bay","body_exterior","body_interior","wheel_assembly"],"rust_severity":["surface"],"paint_state":[]}}}'::jsonb
);

CREATE TABLE public.observation_properties (
  id uuid PRIMARY KEY, property_key text UNIQUE NOT NULL, data_type text
);
INSERT INTO public.observation_properties (id, property_key, data_type) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'image_visible_rust_severity', 'enum'),
  ('a1000000-0000-0000-0000-000000000002', 'image_visible_paint_stage', 'enum'),
  ('a1000000-0000-0000-0000-000000000003', 'image_visible_assembly_state', 'enum'),
  ('a1000000-0000-0000-0000-000000000004', 'exterior_color', 'string');

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean, is_sensitive boolean, is_superseded boolean, is_document boolean,
  vision_gate_status text
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, kind text, extraction_method text,
  structured_data jsonb, is_superseded boolean DEFAULT false,
  property_id uuid, observed_at timestamptz, ingested_at timestamptz,
  agent_tier text, agent_model text, confidence text, confidence_score numeric,
  source_identifier text
);
CREATE TABLE public.observation_witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid REFERENCES public.vehicle_observations(id),
  image_id uuid, witness_role text
);

\ir ../migrations/20261123121500_project_photo_keys_from_readings.sql

DO $$
DECLARE
  admits jsonb;
BEGIN
  SELECT config_value->'automatic'->'admits' INTO admits
  FROM public.platform_config WHERE config_key = 'image_reading_tiers';
  IF admits->'rust_severity' IS DISTINCT FROM '["none","surface","pitting","perforation"]'::jsonb THEN
    RAISE EXCEPTION 'rust admits not widened: %', admits->'rust_severity';
  END IF;
  IF admits->'paint_state' IS DISTINCT FROM '["bare_metal","primer","sealer","base","clear","aged"]'::jsonb THEN
    RAISE EXCEPTION 'paint admits not widened: %', admits->'paint_state';
  END IF;
  IF admits->'scene_type' IS DISTINCT FROM '["undercarriage","engine_bay","body_exterior","body_interior","wheel_assembly"]'::jsonb THEN
    RAISE EXCEPTION 'scene admits changed: %', admits->'scene_type';
  END IF;
END $$;

-- Fixture photos and readings.
-- 111...1 filed, eligible: rust=none, paint=primer, completeness=partial, plus unmapped flaking-adjacent? also color in narrative only.
-- 111...2 unfiled
-- 111...3 sensitive
-- 111...4 rejected_personal
-- 111...5 empty URL
-- 111...6 hold-out prefix 9cf5b7a4
-- 111...7 rust=flaking (unmapped), completeness=assembled
-- 111...8 already has a rust child
-- 111...9 confidence 0.5
-- 111...a clarification with confirmed intent (not released)
-- 111...b clarification intent=unknown (released)
-- 111...c picture of a picture
-- 111...d GPS in the source payload must not appear on the claim
INSERT INTO public.vehicle_images (id, user_id, vehicle_id, image_url, is_duplicate, is_sensitive, is_superseded, is_document, vision_gate_status) VALUES
  ('11111111-0000-0000-0000-000000000001', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/ok.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-000000000002', '0b9f107a-d124-49de-9ded-94698f63c1c4', NULL, 'https://example.invalid/unfiled.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-000000000003', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/sens.jpg', false, true, false, false, 'approved'),
  ('11111111-0000-0000-0000-000000000004', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/rej.jpg', false, false, false, false, 'rejected_personal'),
  ('11111111-0000-0000-0000-000000000005', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', '', false, false, false, false, 'approved'),
  ('9cf5b7a4-0000-0000-0000-000000000006', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/hold.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-000000000007', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/unmap.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-000000000008', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/have.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-000000000009', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/low.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-00000000000a', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/intent.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-00000000000b', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/clar.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-00000000000c', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/print.jpg', false, false, false, false, 'approved'),
  ('11111111-0000-0000-0000-00000000000d', '0b9f107a-d124-49de-9ded-94698f63c1c4', '22222222-0000-0000-0000-000000000001', 'https://example.invalid/gps.jpg', false, false, false, false, 'approved');

INSERT INTO public.vehicle_observations
  (id, vehicle_id, kind, extraction_method, structured_data, is_superseded, observed_at, ingested_at,
   agent_tier, agent_model, confidence, confidence_score)
VALUES
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000001","intent":"unknown","needs_clarification":false,
     "state_observations":{"rust_severity":"none","paint_state":"primer","completeness":"partial"},
     "narrative_one_line":"Primered shell, no rust in frame."}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:01Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000002","intent":"unknown",
     "state_observations":{"rust_severity":"none","paint_state":"primer","completeness":"partial"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:02Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000003","intent":"unknown",
     "state_observations":{"rust_severity":"none"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:03Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000004","intent":"unknown",
     "state_observations":{"rust_severity":"none"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:04Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000005","intent":"unknown",
     "state_observations":{"rust_severity":"none"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:05Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"9cf5b7a4-0000-0000-0000-000000000006","intent":"unknown",
     "state_observations":{"rust_severity":"none"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:06Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000007', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000007","intent":"unknown",
     "state_observations":{"rust_severity":"flaking","paint_state":"unknown","completeness":"assembled"},
     "narrative_one_line":"Flaking rust, car looks assembled."}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:07Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000008', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000008","intent":"unknown",
     "state_observations":{"rust_severity":"surface","paint_state":"clear"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:08Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-000000000009","intent":"unknown",
     "state_observations":{"rust_severity":"none"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:09Z', 'reviewed', 'fixture-model', 'medium', 0.50),
  ('33333333-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-00000000000a","intent":"restore","intent_confidence":0.9,"needs_clarification":true,
     "state_observations":{"rust_severity":"pitting"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:10Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-00000000000b","intent":"unknown","needs_clarification":true,
     "state_observations":{"rust_severity":"pitting"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:11Z', 'subscription automatic', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-00000000000c', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-00000000000c","intent":"unknown",
     "narrative_one_line":"A printed photograph of the car sits on the bench.",
     "state_observations":{"rust_severity":"none","completeness":"assembled"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:12Z', 'reviewed', 'fixture-model', 'medium', 0.82),
  ('33333333-0000-0000-0000-00000000000d', '22222222-0000-0000-0000-000000000001', 'condition', 'reviewed_image_analysis_v1',
   '{"analysis_kind":"image_deep_byok","image_id":"11111111-0000-0000-0000-00000000000d","intent":"unknown",
     "gps":{"lat":34.0,"lon":-118.0},"exif_gps":"34,118",
     "state_observations":{"rust_severity":"perforation"}}'::jsonb,
   false, '2026-11-01T00:00:00Z', '2026-11-01T00:00:13Z', 'reviewed', 'fixture-model', 'medium', 0.82);

-- Existing rust projection for photo 8; paint should still be planned.
INSERT INTO public.vehicle_observations
  (id, vehicle_id, kind, extraction_method, structured_data, is_superseded, property_id,
   observed_at, ingested_at, agent_tier, agent_model, confidence, confidence_score, source_identifier)
VALUES
  ('44444444-0000-0000-0000-000000000008', '22222222-0000-0000-0000-000000000001', 'condition',
   'cached_byok_property_projection_v1',
   '{"analysis_kind":"image_property_projection","image_id":"11111111-0000-0000-0000-000000000008",
     "property_key":"image_visible_rust_severity","image_visible_rust_severity":"surface",
     "source_observation_id":"33333333-0000-0000-0000-000000000008"}'::jsonb,
   false, 'a1000000-0000-0000-0000-000000000001',
   '2026-11-01T00:00:00Z', '2026-11-01T00:00:14Z', 'reviewed', 'fixture-model', 'medium', 0.6,
   'byok_image_properties_v1:33333333-0000-0000-0000-000000000008:hash:image_visible_rust_severity');
INSERT INTO public.observation_witnesses (observation_id, image_id, witness_role)
VALUES ('44444444-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000008', 'derived');

DO $$
DECLARE
  plan jsonb;
  keys text[];
  item jsonb;
  run uuid := '55555555-0000-0000-0000-000000000001';
  actor uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
BEGIN
  BEGIN
    PERFORM public.project_photo_keys_v1(run, actor, NULL);
    RAISE EXCEPTION 'expected granted_by required';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%p_granted_by%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.project_photo_keys_v1(run, actor, actor, true, 51);
    RAISE EXCEPTION 'expected cap refused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%p_cap%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.project_photo_keys_v1(run, actor, actor, false, 50);
    RAISE EXCEPTION 'expected apply refused on the planner';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%does not write observations%' THEN RAISE; END IF;
  END;

  plan := public.project_photo_keys_v1(run, actor, actor, true, 50);

  IF (plan->>'dry_run')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'dry_run should default true: %', plan;
  END IF;
  IF plan->>'signature' IS DISTINCT FROM public.project_photo_keys_signature_v1() THEN
    RAISE EXCEPTION 'signature mismatch';
  END IF;

  -- Eligible: photo 1 (3 keys), 7 (assembly only), 8 (paint only), b (rust, automatic), d (rust). = 5 photos, 7 claims.
  IF (plan->>'photos')::int IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'expected 5 photos, got % %', plan->>'photos', plan->'items';
  END IF;
  IF (plan->>'claims')::int IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'expected 7 claims, got % %', plan->>'claims', plan->'items';
  END IF;
  IF (plan->>'unmapped')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected 1 unmapped finding (flaking), got % %', plan->>'unmapped', plan->'unmapped_items';
  END IF;

  SELECT array_agg(x->>'property_key' || '=' || (x->>'value') ORDER BY x->>'image_id', x->>'property_key')
  INTO keys FROM jsonb_array_elements(plan->'items') x;

  IF keys IS DISTINCT FROM ARRAY[
    'image_visible_assembly_state=partial',
    'image_visible_paint_stage=primer',
    'image_visible_rust_severity=none',
    'image_visible_assembly_state=assembled',
    'image_visible_paint_stage=clear',
    'image_visible_rust_severity=pitting',
    'image_visible_rust_severity=perforation'
  ] THEN
    RAISE EXCEPTION 'unexpected claim set: %', keys;
  END IF;

  -- Automatic source stays automatic. GPS must not appear on any claim.
  FOR item IN SELECT * FROM jsonb_array_elements(plan->'items') LOOP
    IF item->>'image_id' = '11111111-0000-0000-0000-00000000000b'
       AND item->>'agent_tier' IS DISTINCT FROM 'subscription automatic' THEN
      RAISE EXCEPTION 'automatic tier was not copied: %', item;
    END IF;
    IF item::text ILIKE '%gps%' OR item::text ILIKE '%34.0%' OR item::text ILIKE '%-118%' THEN
      RAISE EXCEPTION 'GPS leaked onto a claim: %', item;
    END IF;
    IF (item->>'confidence_score')::numeric > 0.6 THEN
      RAISE EXCEPTION 'child confidence above cap: %', item;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.vehicle_observations WHERE extraction_method = 'cached_byok_property_projection_v1') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'planner wrote observations';
  END IF;
END $$;

-- Record a pretend apply of photo 1 rust, then revert it.
DO $$
DECLARE
  run uuid := '55555555-0000-0000-0000-000000000002';
  actor uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  child uuid := '44444444-0000-0000-0000-000000000001';
  rec jsonb;
  rev jsonb;
BEGIN
  INSERT INTO public.vehicle_observations
    (id, vehicle_id, kind, extraction_method, structured_data, is_superseded, property_id,
     observed_at, ingested_at, agent_tier, agent_model, confidence, confidence_score, source_identifier)
  VALUES
    (child, '22222222-0000-0000-0000-000000000001', 'condition', 'cached_byok_property_projection_v1',
     '{"analysis_kind":"image_property_projection","image_id":"11111111-0000-0000-0000-000000000001",
       "property_key":"image_visible_rust_severity","image_visible_rust_severity":"none",
       "source_observation_id":"33333333-0000-0000-0000-000000000001"}'::jsonb,
     false, 'a1000000-0000-0000-0000-000000000001',
     '2026-11-01T00:00:00Z', '2026-11-01T00:00:20Z', 'reviewed', 'fixture-model', 'medium', 0.6,
     'byok_image_properties_v1:33333333-0000-0000-0000-000000000001:hash:image_visible_rust_severity');
  INSERT INTO public.observation_witnesses (observation_id, image_id, witness_role)
  VALUES (child, '11111111-0000-0000-0000-000000000001', 'derived');

  rec := public.record_project_photo_keys_v1(
    run, actor, actor,
    jsonb_build_array(jsonb_build_object(
      'image_id', '11111111-0000-0000-0000-000000000001',
      'vehicle_id', '22222222-0000-0000-0000-000000000001',
      'source_observation_id', '33333333-0000-0000-0000-000000000001',
      'property_key', 'image_visible_rust_severity',
      'value', 'none',
      'confidence_score', 0.6,
      'observation_id', child,
      'witness_id', (SELECT id::text FROM public.observation_witnesses WHERE observation_id = child)
    ))
  );
  IF (rec->>'recorded')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'record failed: %', rec;
  END IF;

  rev := public.revert_project_photo_keys_v1(run, actor, actor);
  IF (rev->>'reverted_observations')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'revert count: %', rev;
  END IF;
  IF NOT (SELECT is_superseded FROM public.vehicle_observations WHERE id = child) THEN
    RAISE EXCEPTION 'child was not superseded';
  END IF;
  IF (SELECT count(*) FROM public.observation_witnesses WHERE observation_id = child) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'revert deleted a witness';
  END IF;

  BEGIN
    PERFORM public.revert_project_photo_keys_v1(run, actor, actor);
    RAISE EXCEPTION 'expected second revert to fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%already reverted%' THEN RAISE; END IF;
  END;
END $$;

-- Revert migration restores the original admits and drops the planner.
\ir ../migrations/20261123121501_project_photo_keys_from_readings_revert.sql

DO $$
DECLARE
  admits jsonb;
BEGIN
  SELECT config_value->'automatic'->'admits' INTO admits
  FROM public.platform_config WHERE config_key = 'image_reading_tiers';
  IF admits->'rust_severity' IS DISTINCT FROM '["surface"]'::jsonb THEN
    RAISE EXCEPTION 'rust admits not restored: %', admits->'rust_severity';
  END IF;
  IF admits->'paint_state' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'paint admits not restored: %', admits->'paint_state';
  END IF;
  IF to_regprocedure('public.project_photo_keys_v1(uuid,uuid,uuid,boolean,integer,uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'planner function still present after revert';
  END IF;
  IF to_regclass('public.photo_key_projection_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'run table still present after revert';
  END IF;
END $$;
