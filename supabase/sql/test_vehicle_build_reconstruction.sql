-- Contract for 20261119200000_vehicle_build_reconstruction (empty disposable database; dependencies stubbed here, the
-- migration applied with \ir). Asserts: lines land in the system their words name; a priced line whose words are work
-- becomes shop work, not a part; paper hours and reference hours stay separate; a stored operation counts once per
-- vehicle however many parts point at it; machine-shop work implies one engine removal; a part with no stored operation
-- is counted as a gap; amounts are null for anon and present for the owner; a hidden vehicle returns null.
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year int, user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean, deleted_at timestamptz);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.text_redact_contact(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p $$;
CREATE TABLE public.labor_operations(code text PRIMARY KEY, name text, base_hours numeric, system text, model_year_min int, model_year_max int);
INSERT INTO public.labor_operations VALUES
  ('ELEC-WIRING-HARNESS','Wiring harness R&R',8.0,'electrical',NULL,NULL),
  ('MECH-ENGINE-RR','Engine R&R',12.0,'mechanical',NULL,NULL),
  ('INT-CARPET-RR','Carpet R&R',2.0,'interior',1990,2000);
CREATE TABLE public.fixture_lines(vehicle_id uuid, item_id uuid, receipt_id uuid, line_kind text, anchor_date date, vendor_name text,
  description text, part_number text, total_price numeric, printed_hours numeric, printed_performer text);
CREATE FUNCTION public.receipt_work_lines(p_vehicle_id uuid) RETURNS SETOF public.fixture_lines LANGUAGE sql STABLE AS
  $$ SELECT * FROM public.fixture_lines WHERE vehicle_id = p_vehicle_id $$;

\ir ../migrations/20261119200000_vehicle_build_reconstruction.sql

-- slice 2 dependencies, as views over fixture tables: photo readings keyed to a part, and the photos they cite
CREATE TABLE public.fixture_photos(id uuid PRIMARY KEY, vehicle_id uuid, image_url text, taken_at timestamptz, is_sensitive boolean,
  is_duplicate boolean, is_superseded boolean, eligible boolean DEFAULT true);
CREATE VIEW public.vehicle_images AS SELECT * FROM public.fixture_photos;
CREATE FUNCTION public.vehicle_image_gallery_eligible(i public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT i.eligible $$;
CREATE TABLE public.fixture_readings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, extraction_method text,
  is_superseded boolean, structured_data jsonb);
CREATE VIEW public.vehicle_observations AS SELECT * FROM public.fixture_readings;
\ir ../migrations/20261119213000_build_reconstruction_photos.sql

-- slice 3 dependency: the stored hour range per build stage
CREATE TABLE public.stage_transition_labor_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_stage text, to_stage text, zone_pattern text,
  description text, estimated_hours_min numeric, estimated_hours_max numeric, estimated_hours_typical numeric, confidence text);
\ir ../migrations/20261119230000_build_reconstruction_stages.sql

DO $$ BEGIN
  ASSERT public.photo_reading_is_print('{"narrative_one_line":"Two printed photographs show rear-quarter surface preparation."}');
  ASSERT public.photo_reading_is_print('{"narrative_one_line":"A sheet.","components_seen":[{"label":"paper sheet containing two printed engine photographs"}]}');
  ASSERT NOT public.photo_reading_is_print('{"narrative_one_line":"A printed ignition lead crosses the distributor area."}');
  ASSERT NOT public.photo_reading_is_print('{}');
  ASSERT public.build_phase_system('paint_prep') = 'paint' AND public.build_phase_system('final_assembly') IS NULL;
END $$;

DO $$ BEGIN
  ASSERT public.photo_part_key_system('undercarriage.steering.linkage') = 'steering';
  ASSERT public.photo_part_key_system('engine.brake.master.cylinder') = 'brakes';
  ASSERT public.photo_part_key_system('engine.bay') = 'engine';
  ASSERT public.photo_part_key_system('wheel') = 'tires';
  ASSERT public.photo_part_key_system('trim.bumper.front') = 'trim';
  ASSERT public.photo_part_key_system('undercarriage') IS NULL AND public.photo_part_key_system('document.data.plate') IS NULL;
END $$;

DO $$ BEGIN
  ASSERT public.receipt_line_system('72-73 UNDERDASH WIRING HRNS') = 'electrical';
  ASSERT public.receipt_line_system('70-73 FIREBIRD TAIL PANEL STEE[L]') = 'body';
  ASSERT public.receipt_line_system('73-75 T/A FENDER DCL ORANGE') = 'trim';
  ASSERT public.receipt_line_system('75-76 FBIRD POS BATT CABLE V8') = 'electrical', 'positive is not posi';
  ASSERT public.receipt_line_system('32OZBRAKEFLD') = 'brakes';
  ASSERT public.receipt_line_system('Bore cylinders .060') = 'machining';
  ASSERT public.receipt_line_system('CHECK AND REPAIR REAR END POSI RING PINION BEARING AND AXELS') = 'axle';
  ASSERT public.receipt_line_system('BUDDY BRA (BBI) 3D PR') IS NULL, 'unknown words stay unplaced';
  ASSERT public.receipt_line_labor_operation('74 8CYL W/HEI DIST ENG HARNESS') = 'ELEC-WIRING-HARNESS';
  ASSERT public.receipt_line_labor_operation('HOSE CLAMPS (MHC)') IS NULL, 'no default operation';
END $$;

INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1973, '00000000-0000-0000-0000-0000000000c1', NULL, NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000000a2', 1973, '00000000-0000-0000-0000-0000000000c1', NULL, NULL, false, NULL);
INSERT INTO public.fixture_lines VALUES
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', '72-73 UNDERDASH WIRING HRNS', 'W1', 300, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-03', 'Supplier', '70-73 RR LIGHT HRNESS', 'W2', 100, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-03', 'Supplier', '70-73 LOOP CARPET SET', 'C1', 200, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'labor', '2024-10-07', 'Machine Shop', 'Bore cylinders .060', NULL, NULL, 4.0, 'Tech A'),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'part', '2024-10-07', 'Machine Shop', 'Valve Job', NULL, 500, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b3', 'charge', '2025-01-03', 'Supplier', 'Shipping', NULL, 20, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a2', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b4', 'part', '2025-01-03', 'Supplier', 'OIL FILTER', 'F1', 9, NULL, NULL);

INSERT INTO public.fixture_photos VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/1.jpg', '2026-10-28T17:00:00Z', false, false, false, true),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/2.jpg', '2026-10-28T17:05:00Z', false, false, false, true),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/3.jpg', '2026-10-28T17:06:00Z', true, false, false, true),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/4.jpg', '2026-10-28T17:07:00Z', false, false, false, false);
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"electrical.harness","image_id":"00000000-0000-0000-0000-0000000000d1"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"wheel","image_id":"00000000-0000-0000-0000-0000000000d2"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"wheel","image_id":"00000000-0000-0000-0000-0000000000d2"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"wheel","image_id":"00000000-0000-0000-0000-0000000000d3"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"wheel","image_id":"00000000-0000-0000-0000-0000000000d4"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', true,  '{"part_key":"glass.rear","image_id":"00000000-0000-0000-0000-0000000000d1"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"undercarriage","image_id":"00000000-0000-0000-0000-0000000000d1"}');

INSERT INTO public.stage_transition_labor_map(from_stage, to_stage, zone_pattern, description, estimated_hours_min, estimated_hours_max, estimated_hours_typical, confidence) VALUES
  ('primed', 'blocked', '*', 'Full body block sand', 8, 24, 16, 'medium'), ('primed', 'blocked', 'panel_*', 'Block sand single panel', 2, 6, 3, 'high');
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d1","build_phase_guess":"paint_prep","narrative_one_line":"Two printed photographs show surface preparation."}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d2","build_phase_guess":"final_assembly","narrative_one_line":"A wheel."}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d3","build_phase_guess":"paint_prep","narrative_one_line":"A sensitive photo."}');
GRANT SELECT ON public.stage_transition_labor_map TO anon;

DO $$
DECLARE r jsonb; s jsonb;
BEGIN
  SET LOCAL ROLE anon;
  r := public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1');
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'paint';
  ASSERT jsonb_array_length(s -> 'stages') = 1 AND (s #>> '{stages,0,images}')::int = 1 AND (s #>> '{stages,0,prints}')::int = 1
     AND s #> '{stages,0,last_day}' = 'null'::jsonb AND (s #>> '{stages,0,reference,hours_typical}')::numeric = 16
     AND s #>> '{stages,0,reference,description}' = 'Full body block sand',
    'a photographed stage has a row with the whole-car stored range, no day for a print, hidden photos not counted: ' || coalesce(s::text, 'no paint row');
  ASSERT (r #>> '{totals,stage_hours,typical}')::numeric = 16 AND (r #>> '{totals,stage_hours,min}')::numeric = 8 AND (r #>> '{totals,stage_images}')::int = 1;
  ASSERT (r #>> '{totals,reference_hours}')::numeric = 20.0, 'stage hours are not added to reference hours';
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'electrical';
  ASSERT s #> '{photos,last_day}' = 'null'::jsonb, 'a part reading on a print carries no day: ' || (s -> 'photos')::text;
  RESET ROLE;
END $$;

DO $$
DECLARE r jsonb; s jsonb;
BEGIN
  SET LOCAL ROLE anon;
  r := public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1');
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'tires';
  ASSERT (s #>> '{photos,images}')::int = 1 AND (s #>> '{photos,readings}')::int = 2 AND (s ->> 'part_lines')::int = 0 AND s -> 'lines' = 'null'::jsonb,
    'a system seen only in photos has a row; sensitive and gallery-ineligible photos are not counted: ' || s::text;
  ASSERT r::text !~ '(3|4)\.jpg', 'hidden photos never leave the reader';
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'electrical';
  ASSERT (s #>> '{photos,images}')::int = 1 AND (s #>> '{reference,hours}')::numeric = 8.0, 'photos sit beside the paper figures, which do not change';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'glass'), 'superseded readings are not current';
  ASSERT (r #>> '{totals,photo_images}')::int = 2;
  RESET ROLE;
END $$;

DO $$
DECLARE r jsonb; s jsonb;
BEGIN
  SET LOCAL ROLE anon;
  r := public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1');
  ASSERT (r #>> '{totals,lines}')::int = 5, 'charges are not build lines: ' || r::text;
  ASSERT (r #>> '{totals,part_lines}')::int = 3, 'a priced line whose words are work is shop work';
  ASSERT (r #>> '{totals,paper_hours}')::numeric = 4.0;
  ASSERT (r #>> '{totals,reference_hours}')::numeric = 20.0, 'harness once (8) + implied engine removal (12); the 1990-2000 carpet operation does not apply to a 1973';
  ASSERT (r #>> '{totals,parts_without_reference}')::int = 1;
  ASSERT r #>> '{totals,recorded_amount}' IS NULL AND r ->> 'amounts_visible' = 'false', 'anon sees no amounts';
  ASSERT r::text !~ '"amount": ?[0-9]', 'no line amount for anon';
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'electrical';
  ASSERT (s #>> '{reference,hours}')::numeric = 8.0 AND (s #>> '{reference,operations,0,part_lines}')::int = 2, 'one operation, two parts';
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'machining';
  ASSERT (s #>> '{paper,lines}')::int = 2 AND (s #>> '{paper,lines_without_hours}')::int = 1 AND s #>> '{reference,hours}' IS NULL;
  SELECT e INTO s FROM jsonb_array_elements(r -> 'systems') e WHERE e ->> 'system_key' = 'engine';
  ASSERT s IS NULL, 'the implied operation does not invent a system row without lines';
  ASSERT r -> 'systems_without_paper' ? 'paint';
  ASSERT public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a2') IS NULL, 'hidden vehicle';
  RESET ROLE;
  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  r := public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1');
  ASSERT (r #>> '{totals,recorded_amount}')::numeric = 1100 AND r ->> 'amounts_visible' = 'true', 'owner sees amounts';
  ASSERT public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a2') IS NOT NULL, 'owner sees a private vehicle';
END $$;

DROP FUNCTION public.photo_reading_is_print(jsonb); DROP FUNCTION public.build_phase_system(text);
DROP FUNCTION public.photo_part_key_system(text);
\ir revert_20261119200000_vehicle_build_reconstruction.sql
DO $$ BEGIN ASSERT to_regprocedure('public.vehicle_build_reconstruction(uuid)') IS NULL; END $$;
