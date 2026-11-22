-- Disposable PG17: vehicle_labor_appraisal evidence-gated stage rules.
-- Covers: engine (paper + facet, paper above max), gearbox (statement grade),
-- paint (only photographed steps charged), reassembly per-piece match/gap,
-- and no-evidence when required proof is missing. Synthetic fixtures only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
SET TimeZone = 'UTC';

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.auth_role', true), ''), 'anon') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  year int, make text, model text, is_public boolean DEFAULT true, deleted_at timestamptz
);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.stage_transition_labor_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage text, to_stage text, zone_pattern text, category text, description text,
  estimated_hours_min numeric, estimated_hours_typical numeric, estimated_hours_max numeric,
  materials_cost_min numeric, materials_cost_max numeric, confidence text
);
INSERT INTO stage_transition_labor_map
  (from_stage, to_stage, zone_pattern, category, description,
   estimated_hours_min, estimated_hours_typical, estimated_hours_max, confidence) VALUES
  ('none', 'rebuilt_original', '*', 'powertrain', 'Rebuild matching-numbers engine', 20, 32, 50, 'low'),
  ('none', 'trans_rebuild', '*', 'powertrain', 'Transmission rebuild', 8, 12, 16, 'low'),
  ('stock', 'refreshed', '*', 'chassis', 'Chassis refresh', 8, 14, 24, 'low'),
  ('original', 'rewire', '*', 'electrical', 'Full rewire', 8, 14, 20, 'low'),
  ('stripped', 'fabricated', 'panel_*', 'body', 'Panel fabrication', 4, 6, 12, 'low'),
  ('fabricated', 'primed', '*', 'body', 'Full body prime', 4, 6, 8, 'low'),
  ('primed', 'blocked', '*', 'body', 'Full body block sand', 8, 16, 24, 'low'),
  ('blocked', 'basecoated', '*', 'body', 'Spray base coat', 3, 5, 8, 'low'),
  ('basecoated', 'clearcoated', '*', 'body', 'Clear coat', 2, 4, 6, 'low'),
  ('needs_work', 'recovered', '*', 'interior', 'Upholstery refresh', 16, 24, 40, 'low');

CREATE FUNCTION public.estimate_labor_from_delta(
  p_vehicle_id uuid, p_zone text, p_from_stage text, p_to_stage text
) RETURNS TABLE (
  labor_operation_codes text[], description text,
  hours_min numeric, hours_max numeric, hours_typical numeric,
  materials_min numeric, materials_max numeric, match_type text
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT ARRAY[]::text[], m.description, m.estimated_hours_min, m.estimated_hours_max,
         m.estimated_hours_typical, m.materials_cost_min, m.materials_cost_max, 'exact'::text
    FROM stage_transition_labor_map m
   WHERE m.from_stage = p_from_stage AND m.to_stage = p_to_stage
     AND (m.zone_pattern = p_zone OR m.zone_pattern = '*' OR m.zone_pattern LIKE replace(p_zone, '_', '') || '%'
          OR (p_zone LIKE 'panel_%' AND m.zone_pattern = 'panel_*'))
   ORDER BY CASE WHEN m.zone_pattern = p_zone THEN 0 WHEN m.zone_pattern = 'panel_*' THEN 1 ELSE 2 END
   LIMIT 1;
END $$;

CREATE TABLE public.labor_operations (
  code text PRIMARY KEY, name text, base_hours numeric, system text,
  model_year_min int, model_year_max int, notes text
);
INSERT INTO labor_operations(code, name, base_hours, system) VALUES
  ('MECH-BRAKES-FRONT', 'Front brakes', 2.5, 'mechanical'),
  ('INT-SEATS-RR', 'Seat recover', 4.0, 'interior');

CREATE FUNCTION public.receipt_line_labor_operation(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(coalesce(p_text,'')) ~ 'brake|caliper|pad' THEN 'MECH-BRAKES-FRONT'
    WHEN lower(coalesce(p_text,'')) ~ 'seat foam|seat uph' THEN 'INT-SEATS-RR'
    ELSE NULL
  END
$$;

CREATE FUNCTION public.receipt_line_system(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(coalesce(p_text,'')) ~ 'machine|crank|valve job' THEN 'machining'
    WHEN lower(coalesce(p_text,'')) ~ 'clutch|flywheel' THEN 'transmission'
    WHEN lower(coalesce(p_text,'')) ~ 'ball joint|shock|bushing' THEN 'suspension'
    WHEN lower(coalesce(p_text,'')) ~ 'steering' THEN 'steering'
    WHEN lower(coalesce(p_text,'')) ~ 'brake' THEN 'brakes'
    WHEN lower(coalesce(p_text,'')) ~ 'harness' THEN 'electrical'
    WHEN lower(coalesce(p_text,'')) ~ 'tail panel|radiator support' THEN 'body'
    WHEN lower(coalesce(p_text,'')) ~ 'seat|carpet|headliner' THEN 'interior'
    ELSE 'unplaced'
  END
$$;

CREATE TABLE public._fixture_receipt_lines (
  vehicle_id uuid, item_id uuid, line_kind text, description text, printed_hours numeric
);
CREATE FUNCTION public.receipt_work_lines(p_vehicle_id uuid, p_window_days int DEFAULT 90, p_max_images int DEFAULT 8)
RETURNS TABLE (
  item_id uuid, receipt_id uuid, line_kind text, anchor_date date, vendor_name text,
  description text, part_number text, total_price numeric, printed_hours numeric, printed_performer text
) LANGUAGE sql STABLE AS $$
  SELECT f.item_id, NULL::uuid, f.line_kind, CURRENT_DATE, NULL::text,
         f.description, NULL::text, NULL::numeric, f.printed_hours, NULL::text
    FROM public._fixture_receipt_lines f WHERE f.vehicle_id = p_vehicle_id
$$;

CREATE TABLE public.evidence_judgment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, question_kind text, status text, subject_id uuid,
  params jsonb, answer jsonb, superseded_by uuid
);

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, ai_scan_metadata jsonb,
  is_superseded boolean DEFAULT false, is_duplicate boolean DEFAULT false,
  is_sensitive boolean DEFAULT false, is_document boolean DEFAULT false,
  image_url text DEFAULT 'https://example.test/img.jpg',
  vision_gate_status text DEFAULT 'approved',
  source text, image_vehicle_match_status text
);
-- Mirror the public-frame predicates sibling readers use.
CREATE FUNCTION public.vehicle_image_gallery_eligible(vi public.vehicle_images)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(($1).is_document, false) = false
     AND coalesce(($1).is_duplicate, false) = false
     AND coalesce(($1).is_superseded, false) = false
     AND nullif(btrim(($1).image_url), '') IS NOT NULL
     AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
     AND coalesce(($1).image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
     AND (($1).vision_gate_status IS NULL OR ($1).vision_gate_status = 'approved')
$$;

-- Stubs filled per vehicle below.
CREATE FUNCTION public.vehicle_build_reconstruction(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE j jsonb;
BEGIN
  SELECT payload INTO j FROM public._fixture_recon WHERE vehicle_id = p_vehicle_id;
  RETURN j;
END $$;
CREATE TABLE public._fixture_recon (vehicle_id uuid PRIMARY KEY, payload jsonb);

CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE j jsonb;
BEGIN
  SELECT payload INTO j FROM public._fixture_facets WHERE vehicle_id = p_vehicle_id;
  RETURN coalesce(j, '{}'::jsonb);
END $$;
CREATE TABLE public._fixture_facets (vehicle_id uuid PRIMARY KEY, payload jsonb);

CREATE FUNCTION public.vehicle_statements(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE j jsonb;
BEGIN
  SELECT payload INTO j FROM public._fixture_statements WHERE vehicle_id = p_vehicle_id;
  RETURN coalesce(j, jsonb_build_object('statements', '[]'::jsonb, 'tied', true));
END $$;
CREATE TABLE public._fixture_statements (vehicle_id uuid PRIMARY KEY, payload jsonb);

\ir ../migrations/20261122120000_vehicle_labor_appraisal.sql

-- Public car with full evidence for five rules.
INSERT INTO vehicles(id, year, make, model, is_public)
VALUES ('10000000-0000-0000-0000-000000000001', 1973, 'Pontiac', 'Firebird', true);

INSERT INTO _fixture_recon(vehicle_id, payload) VALUES ('10000000-0000-0000-0000-000000000001', jsonb_build_object(
  'systems', jsonb_build_array(
    jsonb_build_object('system_key','machining','paper',jsonb_build_object('lines',3,'hours',53.75),'part_lines',0),
    jsonb_build_object('system_key','paint','part_lines',0,'stages', jsonb_build_array(
      jsonb_build_object('phase','paint_prep','images',2,'sample',jsonb_build_array(
        jsonb_build_object('image_id','a0000000-0000-0000-0000-000000000001'))),
      jsonb_build_object('phase','paint_application','images',1,'sample',jsonb_build_array(
        jsonb_build_object('image_id','a0000000-0000-0000-0000-000000000002')))
    )),
    jsonb_build_object('system_key','interior','part_lines',2)
  )
));

INSERT INTO _fixture_facets(vehicle_id, payload) VALUES ('10000000-0000-0000-0000-000000000001',
  '{"engine":[{"key":"engine.derived.changed","value":true,"status":"established"}]}'::jsonb);

INSERT INTO _fixture_statements(vehicle_id, payload) VALUES ('10000000-0000-0000-0000-000000000001',
  jsonb_build_object('tied', true, 'statements', jsonb_build_array(
    jsonb_build_object('statement_id','b0000000-0000-0000-0000-000000000001','statement_kind','assertion')
  )));

INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description, printed_hours) VALUES
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'labor', 'machine work valve job', 20),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'labor', 'polish crank', 10),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'part', 'clutch kit', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'part', 'ball joint', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'labor', 'front end rebuild', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', 'part', 'wiring harness', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000007', 'part', 'tail panel', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000008', 'part', 'rad support', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000009', 'part', 'seat foam', NULL);

INSERT INTO vehicle_images(id, vehicle_id, ai_scan_metadata, is_sensitive, vision_gate_status) VALUES
  -- Eligible interior scenes (satisfy image_scene min=2).
  ('a0000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001',
   '{"byok_deep_analysis":{"scene_type":"body_interior"}}'::jsonb, false, 'approved'),
  ('a0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
   '{"byok_deep_analysis":{"scene_type":"body_interior"}}'::jsonb, false, 'approved'),
  -- Sensitive / review-held frames must not count or leak as evidence ids.
  ('a0000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001',
   '{"byok_deep_analysis":{"scene_type":"body_interior"}}'::jsonb, true, 'approved'),
  ('a0000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001',
   '{"byok_deep_analysis":{"scene_type":"body_interior"}}'::jsonb, false, 'review_needed'),
  -- Paint stage samples referenced by recon.
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '{}'::jsonb, false, 'approved'),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '{}'::jsonb, false, 'approved'),
  -- Reassembly witness frames: one eligible, one sensitive.
  ('a0000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001',
   '{}'::jsonb, false, 'approved'),
  ('a0000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001',
   '{}'::jsonb, true, 'approved');

INSERT INTO evidence_judgment_requests(id, vehicle_id, question_kind, status, params, answer) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'receipt_part_visible', 'answered',
   '{"description":"front brake pads","item_id":"c0000000-0000-0000-0000-000000000010"}'::jsonb,
   '{"installed":"yes","image_id":"a0000000-0000-0000-0000-000000000020"}'::jsonb),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'receipt_part_visible', 'answered',
   '{"description":"console lid black","item_id":"c0000000-0000-0000-0000-000000000011"}'::jsonb,
   '{"installed":"yes","image_id":"a0000000-0000-0000-0000-000000000021"}'::jsonb);

-- Private car.
INSERT INTO vehicles(id, year, make, model, is_public)
VALUES ('10000000-0000-0000-0000-000000000002', 1973, 'Pontiac', 'Firebird', false);
INSERT INTO _fixture_recon(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000002', '{"systems":[]}'::jsonb);

-- Car missing gearbox statement.
INSERT INTO vehicles(id, year, make, model, is_public)
VALUES ('10000000-0000-0000-0000-000000000003', 1973, 'Pontiac', 'Firebird', true);
INSERT INTO _fixture_recon(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000003', '{"systems":[]}'::jsonb);
INSERT INTO _fixture_facets(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000003', '{"engine":[]}'::jsonb);
INSERT INTO _fixture_statements(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000003', '{"tied":true,"statements":[]}'::jsonb);
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description) VALUES
  ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000099', 'part', 'clutch kit');

-- Untied viewer shape: statement rows present, statement_id null (anon public read).
INSERT INTO vehicles(id, year, make, model, is_public)
VALUES ('10000000-0000-0000-0000-000000000004', 1973, 'Pontiac', 'Firebird', true);
INSERT INTO _fixture_recon(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000004', '{"systems":[]}'::jsonb);
INSERT INTO _fixture_facets(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000004', '{"engine":[]}'::jsonb);
INSERT INTO _fixture_statements(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000004',
   jsonb_build_object('tied', false, 'statements', jsonb_build_array(
     jsonb_build_object('statement_id', NULL, 'statement_kind', 'assertion', 'speaker_role', 'shop')
   )));
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description) VALUES
  ('10000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000098', 'part', 'clutch kit');

SET ROLE anon;
SET test.auth_role = 'anon';

DO $$
DECLARE
  j jsonb;
  eng jsonb;
  gear jsonb;
  paint jsonb;
  reass jsonb;
  miss jsonb;
BEGIN
  j := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert(j->>'applicable' = 'true', 'public car applicable');

  SELECT value INTO eng FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'engine';
  PERFORM public.assert(eng->>'status' = 'ok', format('engine ok; got %s', eng));
  PERFORM public.assert((eng->>'hours_min')::numeric = 20, 'engine book min');
  PERFORM public.assert((eng->>'hours_max')::numeric = 50, 'engine book max');
  PERFORM public.assert((eng->>'paper_hours')::numeric = 53.75, 'engine paper hours');
  PERFORM public.assert((eng->>'range_below_paper')::boolean IS TRUE, 'paper above max flagged');
  PERFORM public.assert((eng->>'evidence_count')::int > 0, 'engine has evidence ids');

  SELECT value INTO gear FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'gearbox';
  PERFORM public.assert(gear->>'status' = 'ok', 'gearbox ok');
  PERFORM public.assert(gear->>'evidence_grade' = 'statement', 'gearbox statement grade');
  PERFORM public.assert((gear->>'hours_typical')::numeric = 12, 'gearbox typical');
  PERFORM public.assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(gear->'evidence_ids') x
       WHERE x = 'b0000000-0000-0000-0000-000000000001'
    ),
    'gearbox cites statement_id from vehicle_statements');

  SELECT value INTO paint FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'paint';
  PERFORM public.assert(paint->>'status' = 'ok', 'paint ok');
  PERFORM public.assert((paint->>'hours_min')::numeric = 11, 'paint supported min 8+3');
  PERFORM public.assert((paint->>'hours_typical')::numeric = 21, 'paint supported typical 16+5');
  PERFORM public.assert((paint->>'hours_max')::numeric = 32, 'paint supported max 24+8');
  PERFORM public.assert(jsonb_array_length(paint->'unsupported_steps') = 2, 'two unsupported paint steps');
  PERFORM public.assert(
    (SELECT count(*) FROM jsonb_array_elements_text(paint->'evidence_ids') x
      WHERE x IN ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002')) = 2,
    'paint evidence_ids keep both photographed stage samples');

  SELECT value INTO reass FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'reassembly';
  PERFORM public.assert((reass#>>'{reassembly,matched_count}')::int = 1, 'one matched piece');
  PERFORM public.assert((reass#>>'{reassembly,unmatched_count}')::int = 1, 'one unmatched piece');
  PERFORM public.assert((reass->>'hours_typical')::numeric = 2.5, 'matched book hours only');
  PERFORM public.assert(reass#>>'{reassembly,unmatched,0,reason}' = 'no book operation', 'unmatched reason');
  -- Eligible witness image id is returned; sensitive witness is nulled.
  PERFORM public.assert(
    reass#>>'{reassembly,matched,0,image_id}' = 'a0000000-0000-0000-0000-000000000020',
    'matched piece keeps gallery-eligible image_id');
  PERFORM public.assert(
    reass#>>'{reassembly,unmatched,0,image_id}' IS NULL,
    'sensitive reassembly image_id is gated to null');

  -- Interior evidence ids must not include sensitive / review-held frames.
  SELECT value INTO miss FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'interior';
  PERFORM public.assert(miss->>'status' = 'ok', 'interior ok with two eligible scenes');
  PERFORM public.assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(miss->'evidence_ids') x
       WHERE x IN (
         'a0000000-0000-0000-0000-000000000012',
         'a0000000-0000-0000-0000-000000000013'
       )
    ),
    'interior evidence_ids omit gated frames');
  PERFORM public.assert(
    (SELECT count(*) FROM jsonb_array_elements_text(miss->'evidence_ids') x
      WHERE x IN ('a0000000-0000-0000-0000-000000000010','a0000000-0000-0000-0000-000000000011')) = 2,
    'interior cites the two eligible scene images');

  -- Totals equal segment sums (non-null hours only).
  PERFORM public.assert(
    (j#>>'{totals,hours_min}')::numeric =
      (SELECT sum((s->>'hours_min')::numeric) FROM jsonb_array_elements(j->'segments') s
        WHERE s->>'hours_min' IS NOT NULL),
    'totals min equals segment sum');

  -- No dollar figures.
  PERFORM public.assert(j::text !~ 'materials|\$|dollars?', 'no dollar figures in reader');

  -- Missing statement → gearbox no evidence.
  j := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000003');
  SELECT value INTO miss FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'gearbox';
  PERFORM public.assert(miss->>'status' = 'no evidence', 'gearbox without statement is no evidence');
  PERFORM public.assert(miss->>'hours_min' IS NULL, 'no hours without evidence');

  -- Untied statement presence (null statement_id) still grades gearbox via part-line evidence ids.
  j := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000004');
  SELECT value INTO gear FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'gearbox';
  PERFORM public.assert(gear->>'status' = 'ok', 'untied statement presence still ok');
  PERFORM public.assert(gear->>'evidence_grade' = 'statement', 'untied grade remains statement');
  PERFORM public.assert((gear->>'hours_typical')::numeric = 12, 'untied gearbox hours');
  PERFORM public.assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(gear->'evidence_ids') x
       WHERE x = 'null' OR x = ''
    ),
    'untied path does not invent a statement evidence id');

  -- Private car hidden from anon.
  PERFORM public.assert(
    public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000002') IS NULL,
    'private car returns null to anon');
END $$;

RESET ROLE;
\echo vehicle_labor_appraisal: ok
