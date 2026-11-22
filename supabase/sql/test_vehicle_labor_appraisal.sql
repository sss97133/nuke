-- Disposable PG17: vehicle_labor_appraisal evidence-gated stage rules.
-- Covers: engine (machining paper wins over the book range), keyed line rules
-- (gearbox, chassis, electrical, body panels, interior), paint (only photographed
-- steps charged), reassembly per-piece match/gap, a negative car whose thin paper
-- must not open segments, a rule with no map row, and that no line text leaves
-- the reader. The line classifiers are copies of the live definitions
-- (receipt_line_system, receipt_line_labor_operation, read 2026-11-22), so the
-- rules are tested against the keys production assigns. Synthetic fixtures only.
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

CREATE OR REPLACE FUNCTION public.receipt_line_system(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN t ~ '\y(shop towels?|shop supplies|colormaxx|key ?chain|gloves|rags?|masking tape|sandpaper)\y' THEN 'supplies'
    WHEN t ~ '(brakefld|brake fluid)' THEN 'brakes'
    WHEN t ~ '(antifrez|antifreeze|stoplk|htr core|heater core)' THEN 'cooling'
    WHEN t ~ '\y(surface heads?|surfacing heads|resurfacing|surface block|hang pistons?|polish crank|valve job|valve grinding|springs and valve|block package|magnaflux|mag block|hot ?tank|bore cylinders?|bor(e|ing) (bar|stand)|hone|chamfer|grind block|deck(ing)? block|balanc(e|ing) (rotating|assembly)|press (pistons|pins)|cam bearings?)' THEN 'machining'
    WHEN t ~ '\y(decal|decl|dcl|deca|letters)\y' THEN 'trim'
    WHEN t ~ '\y(harness|hrns|hrness|wiring|grnd strps?|ground straps?)\y' THEN 'electrical'
    WHEN t ~ '\y(air cl(ea)?n(e)?r|shkr air)' THEN 'engine'
    WHEN t ~ '\y(rear ?end|ring (and |& ?)?pinion|posi(traction)?|differential|axle|axel|carrier bearing|pinion (seal|bearing))\y' THEN 'axle'
    WHEN t ~ '\y((tail|bdy|body|deck|cowl|shlf|shelf|quarter|qtr|floor|rocker|trunk|roof|fllr|filler) ?(/cowl )?(pnl|panel)|tail panel|rad(iator)? (core )?support|shaker hood|hood (assembly|hinge|panel)|fender|bump brace|bumper brace|door skin|patch panel|core support)' THEN 'body'
    WHEN t ~ '\y(glass|gls|wndshld|windshield (mou?lding|seal|gasket|trim)|back ?lite|window (regulator|channel|felt))' THEN 'glass'
    WHEN t ~ '\y(console|glove ?box|glv box|carpet|cpt|seat|uph|upholstery|headliner|sail panels?|door (panel|pnl|sill|lock)|dr pnl|lwr door pnl|sde pnl|shi?ft boot|shift (tunnel|knob)|grshft|knobs?|window crank|wndow crnk|sun ?visors?|snvsr|insulation|firewall pad|frwall|horn (cap|button)|hrn btn|radio|grab ha?ndle|grb hndl|innr hndl|inner (door )?handle|rear ?view|rr view|interi(or)?|trunk divider|package tray|seat shelf|strng col|steering column cover|htr ctrl|heater control|dash filler|instrument pnl emb|instrument panel emblem|mirror bezel|arm ?rest|kick panel|seat ?belt)' THEN 'interior'
    WHEN t ~ '\y(harness|hrns|hrness|wiring|bulbs?|sealed beam|headl(amp|ight)|battery|batt|starter|alternator|gauge|tach(ometer)?|speedo(meter)?|sending uni|printed circuit|mrkr lmp|marker lamp|dome|grnd strps?|ground straps?|neutral safety|turn signal|horn contact|cluster lens|light switch|lamp switch|fuse|relay|voltage regulator|ignition (switch|coil)|distributor|hei)\y' THEN 'electrical'
    WHEN t ~ '\y(radiator (hose|cap|drain|overflow)|radiator hose|rad overflw|radiator$|radiator \(|water pump|wp stud|thermostat|fan (clutch|shroud|blade)|water neck|antifre|anti-?freeze|coolant|petcock|stoplk|stop ?leak|heater (core|hose)|htr core)' THEN 'cooling'
    WHEN t ~ '\y(fuel|mech pump|carb(uretor)?|gas tank|tank (strap|sending)|choke|throttle (cable|linkage))' THEN 'fuel'
    WHEN t ~ '\y(brake|brakefld|semi-met pad|brake pads?|calipers?|non-brkt cal|rotor|bstr/mc|master cyl|whe?e?l (bearing|seal|cyl)|bearing set|drum|proportioning)' THEN 'brakes'
    WHEN t ~ '\y(power steering|p/s ?fluid|p/sfluid|pwr stg|steering (pump|box|gear|coupler)|tie rods?|idler arm|pitman|drag link|center link)' THEN 'steering'
    WHEN t ~ '\y(shocks?|caster shim|ball joints?|control[- ]arm|coil springs?|leaf springs?|suspension|alignment|sway bar|stabilizer|bushing kit|front end .*rebuild)' THEN 'suspension'
    WHEN t ~ '\y(exhaust|muffler|tail ?pipe|header|h-pipe|x-pipe)' THEN 'exhaust'
    WHEN t ~ '\y(clutch|flywhl|flywheel|rev(erse)? lock ?out|pivot ball|trans(mission)? mount|pedal pad|bellcrank|z-bar|shifter|shift (rod|linkage)|pressure plate|throw ?out|pilot bearing|speedometer gear|driveshaft|u-joint)' THEN 'transmission'
    WHEN t ~ '\y(decal|decl|dcl|deca|emblem|letters|spoiler|splr|bumper|weatherstrip|wstrps?|door handle|dr handle|dr hng|door hinge|mirror|wiper|fstnrs|fasteners|jacking|tail la?mp|tail light|tl lmp|grille|mou?ldings?|mldgs?|nameplate|badge|stripe)' THEN 'trim'
    WHEN t ~ '\y(engine|spark plugs?|plug wire|oil|pcv|air cl(ea)?n(e)?r|air filter|motor mount|mount bolt|dipstick|v-belt|belt|vac(uum)?|pistons?|rings|cam(shaft)?|lifters?|pushrods?|gasket|valve cover|timing|intake|crank|rod bearings?|main bearings?|freeze plugs?)' THEN 'engine'
    WHEN t ~ '\y(washers?|hex bolts?|bolts?|nuts?|screws?|clamps?|clips?|rivets?|studs?)\y' THEN 'hardware'
  END
  FROM (SELECT lower(coalesce(p_text, '')) AS t) s
$function$;
CREATE OR REPLACE FUNCTION public.receipt_line_labor_operation(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN t ~ '\y(harness|hrns|hrness)\y' THEN 'ELEC-WIRING-HARNESS'
    WHEN t ~ '\y(gauge|tach(ometer)?/clock|printed circuit|cluster lens)' THEN 'ELEC-GAUGES'
    WHEN t ~ '\y(sealed beam|headl(amp|ight))' THEN 'ELEC-HEADLIGHTS'
    WHEN t ~ '\y(tail la?mp (housing|lens)|tail light lens)' THEN 'ELEC-TAILLIGHTS'
    WHEN t ~ '\y(carpet|cpt/und)' THEN 'INT-CARPET-RR'
    WHEN t ~ '\yheadliner' THEN 'INT-HEADLINER-RR'
    WHEN t ~ '\y(door pa?ne?l kit|lwr door pnl|door panel \(pr\))' THEN 'INT-DOOR-PANELS'
    WHEN t ~ '\y(seat foam|f/s uph|seat uph|upholstery set)' THEN 'INT-SEATS-RR'
    WHEN t ~ '\y(dr glass|door glass)' THEN 'GLASS-DOOR'
    WHEN t ~ '\yradiator( assembly)?$' THEN 'MECH-RADIATOR-RR'
    WHEN t ~ '\y(brake rotor|non-brkt cal|calipers?|semi-met pad|brake pads?)' THEN 'MECH-BRAKES-FRONT'
    WHEN t ~ '\y(front end suspension rebuild|ball joints?|control[- ]arm shaft)' THEN 'MECH-SUSPENSION-FRONT'
    WHEN t ~ '\y(clutch (kit|disc)|pressure plate|flywhl|flywheel)' THEN 'MECH-TRANS-RR'
    WHEN t ~ '\yrear bumper\y' THEN 'TRIM-BUMPERS-REAR'
    WHEN t ~ '\yfro?nt bumper\y' THEN 'TRIM-BUMPERS-FRONT'
    WHEN t ~ '\ygrille' THEN 'TRIM-GRILLE'
    WHEN t ~ '\y(outer|outside|door) mirror' THEN 'TRIM-MIRRORS'
    WHEN t ~ '\y(shaker hood|hood assembly)' THEN 'BODY-REPLACE-HOOD'
    WHEN t ~ '\yfender( assembly)?$' THEN 'BODY-REPLACE-FENDER'
    WHEN t ~ '\y(tail panel|rr bdy pnl|deck fllr pnl|deck filler panel|dash/cowl pnl|cowl panel|shlf pnl|quarter panel|floor pan|trunk (floor|pan))' THEN 'BODY-RUST-PANEL'
  END
  FROM (SELECT lower(coalesce(p_text, '')) AS t) s
$function$;


CREATE TABLE public._fixture_receipt_lines (
  vehicle_id uuid, item_id uuid, line_kind text, description text, printed_hours numeric,
  part_number text
);
CREATE FUNCTION public.receipt_work_lines(p_vehicle_id uuid, p_window_days int DEFAULT 90, p_max_images int DEFAULT 8)
RETURNS TABLE (
  item_id uuid, receipt_id uuid, line_kind text, anchor_date date, vendor_name text,
  description text, part_number text, total_price numeric, printed_hours numeric, printed_performer text
) LANGUAGE sql STABLE AS $$
  SELECT f.item_id, NULL::uuid, f.line_kind, CURRENT_DATE, NULL::text,
         f.description, f.part_number, NULL::numeric, f.printed_hours, NULL::text
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
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'labor', 'valve job', 20),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'labor', 'polish crank', 10),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'part', 'clutch kit', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'part', 'ball joint', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'labor', 'front end suspension rebuild', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000012', 'part', 'front brake pads', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', 'part', 'wiring harness', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000013', 'part', 'dash harness', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000007', 'part', 'tail panel', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000014', 'part', 'deck filler panel', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000015', 'part', 'tail panel', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000008', 'part', 'rad support', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000009', 'part', 'seat foam', NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000016', 'part', 'carpet set', NULL);

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

-- Thin-paper car: one brake pad, one harness, a fan clutch, one seat line and
-- no paper. None of these may open a segment.
INSERT INTO vehicles(id, year, make, model, is_public)
VALUES ('10000000-0000-0000-0000-000000000003', 1966, 'Ford', 'Mustang', true);
INSERT INTO _fixture_recon(vehicle_id, payload) VALUES
  ('10000000-0000-0000-0000-000000000003', '{"systems":[]}'::jsonb);
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description) VALUES
  ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000091', 'part', 'brake pads'),
  ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000092', 'part', 'tail light harness'),
  ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000093', 'part', 'fan clutch'),
  ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000094', 'part', 'seat foam');

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
  PERFORM public.assert((eng#>>'{book_hours,hours_min}')::numeric = 20, 'engine book min kept beside');
  PERFORM public.assert((eng#>>'{book_hours,hours_max}')::numeric = 50, 'engine book max kept beside');
  PERFORM public.assert((eng->>'paper_hours')::numeric = 53.75, 'engine paper hours');
  PERFORM public.assert((eng->>'range_below_paper')::boolean IS TRUE, 'paper above max flagged');
  PERFORM public.assert((eng->>'hours_min')::numeric = 53.75 AND (eng->>'hours_max')::numeric = 53.75,
    format('paper wins, never clipped; got %s', eng));
  PERFORM public.assert(eng->>'hours_basis' = 'shop_paper', 'engine basis is shop paper');
  PERFORM public.assert((eng->>'evidence_count')::int = 2, 'engine cites the two machining lines');

  SELECT value INTO gear FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'gearbox';
  PERFORM public.assert(gear->>'status' = 'ok', format('gearbox ok; got %s', gear));
  PERFORM public.assert((gear->>'hours_typical')::numeric = 12, 'gearbox typical');
  PERFORM public.assert(gear->'evidence_ids' = '["c0000000-0000-0000-0000-000000000003"]'::jsonb, 'gearbox cites the clutch line only');

  SELECT value INTO miss FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'chassis';
  PERFORM public.assert(miss->>'status' = 'ok', format('chassis ok; got %s', miss));
  PERFORM public.assert((miss->>'evidence_count')::int = 3, 'chassis cites three lines over two systems');

  SELECT value INTO miss FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'electrical';
  PERFORM public.assert(miss->>'status' = 'ok', format('electrical ok; got %s', miss));

  SELECT value INTO miss FROM jsonb_array_elements(j->'segments') s WHERE s->>'segment' = 'body_metal';
  PERFORM public.assert(miss->>'status' = 'ok', format('body ok; got %s', miss));
  PERFORM public.assert((miss#>>'{stage_steps,0,panel_count}')::int = 2,
    format('two distinct panel lines (repeat tail panel counted once, rad support has no panel op); got %s', miss));
  PERFORM public.assert((miss->>'hours_typical')::numeric = 12, 'panel book 6 x 2');

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

  -- No receipt line text leaves the reader.
  PERFORM public.assert(j::text !~* 'valve job|crank|clutch|ball joint|harness|tail panel|deck filler|rad support|seat foam|carpet|brake pads',
    'no line descriptions in output');

  -- Thin paper opens nothing.
  j := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000003');
  PERFORM public.assert(
    (SELECT count(*) FROM jsonb_array_elements(j->'segments') s
      WHERE s->>'segment' IN ('engine','gearbox','chassis','electrical','body_metal','interior')
        AND s->>'status' = 'no evidence' AND s->>'hours_min' IS NULL) = 6,
    format('thin-paper car opens no line segment; got %s', j->'segments'));
  PERFORM public.assert((j#>>'{totals,hours_typical}')::numeric = 0, 'thin-paper car totals zero');

  -- Private car hidden from anon.
  PERFORM public.assert(
    public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000002') IS NULL,
    'private car returns null to anon');
END $$;

RESET ROLE;

-- A rule whose transition has no map row returns null hours and says why.
INSERT INTO labor_stage_rules(segment_key, category, from_stage, to_stage, evidence_requirements, citation, sort_order)
VALUES ('test_unmapped', 'powertrain', 'none', 'unmapped_stage',
        '{"all":[{"type":"part_line_operation","operations":["MECH-TRANS-RR"],"min":1}]}'::jsonb, 'test', 999);
DO $$
DECLARE seg jsonb;
BEGIN
  SELECT value INTO seg
    FROM jsonb_array_elements(public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001')->'segments') s
   WHERE s->>'segment' = 'test_unmapped';
  PERFORM public.assert(seg->>'status' = 'no book hours', format('unmapped rule says no book hours; got %s', seg));
  PERFORM public.assert(seg->>'hours_typical' IS NULL, 'unmapped rule has no hours');
END $$;
DELETE FROM labor_stage_rules WHERE segment_key = 'test_unmapped';

-- The rules table has row level security on.
DO $$ BEGIN
  PERFORM public.assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.labor_stage_rules'::regclass), 'rls on');
END $$;
\echo vehicle_labor_appraisal: ok
