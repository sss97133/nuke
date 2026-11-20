-- Contract for 20261120020000_vehicle_part_installation_evidence (empty disposable database; dependencies stubbed here,
-- the earlier build-reconstruction migrations and this one applied with \ir). Asserts: a receipt part line is seen only by
-- a reading that names that same part (a component label, or a part key); a same-system reading that names another part
-- leaves the line empty; upper/lower and left/right words are respected; a part no rule names is "not photographed"; a
-- sensitive, gallery-ineligible or not-assembled photograph never counts; a photograph before the receipt day does not
-- count; a print counts apart and carries no day; a part-keyed statement that merely mentions another part does not match;
-- shop work is not a part line; no caller gets an amount or a supplier list price; a hidden vehicle returns null.
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
CREATE TABLE public.fixture_lines(vehicle_id uuid, item_id uuid, receipt_id uuid, line_kind text, anchor_date date, vendor_name text,
  description text, part_number text, total_price numeric, printed_hours numeric, printed_performer text);
CREATE FUNCTION public.receipt_work_lines(p_vehicle_id uuid) RETURNS SETOF public.fixture_lines LANGUAGE sql STABLE AS
  $$ SELECT * FROM public.fixture_lines WHERE vehicle_id = p_vehicle_id $$;
CREATE TABLE public.fixture_photos(id uuid PRIMARY KEY, vehicle_id uuid, image_url text, taken_at timestamptz, is_sensitive boolean,
  is_duplicate boolean, is_superseded boolean, eligible boolean DEFAULT true);
CREATE VIEW public.vehicle_images AS SELECT * FROM public.fixture_photos;
CREATE FUNCTION public.vehicle_image_gallery_eligible(i public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT i.eligible $$;
CREATE TABLE public.fixture_readings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, extraction_method text,
  is_superseded boolean, structured_data jsonb);
CREATE VIEW public.vehicle_observations AS SELECT * FROM public.fixture_readings;
CREATE TABLE public.stage_transition_labor_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_stage text, to_stage text, zone_pattern text,
  description text, estimated_hours_min numeric, estimated_hours_max numeric, estimated_hours_typical numeric, confidence text);
\ir ../migrations/20261119200000_vehicle_build_reconstruction.sql
\ir ../migrations/20261119213000_build_reconstruction_photos.sql
\ir ../migrations/20261119230000_build_reconstruction_stages.sql
\ir ../migrations/20261120020000_vehicle_part_installation_evidence.sql

-- the word readers and the rule table
DO $$ BEGIN
  ASSERT public.part_text_side('70-73 FBRD TAIL LAMP BEZEL LH') = 'left' AND public.part_text_side('Right tail lamp lens') = 'right';
  ASSERT public.part_text_side('Passenger door glass') = 'right' AND public.part_text_side('driver sill plate') = 'left';
  ASSERT public.part_text_side('image-left round headlamp and bezel') IS NULL, 'a side of the picture is not a side of the car';
  ASSERT public.part_text_side('left and right sill plates') IS NULL AND public.part_text_side('Black headliner') IS NULL;
  ASSERT public.part_text_level('CAM/FB/FS DR HNG-UPPR-LH') = 'upper' AND public.part_text_level('MOLDED RADIATOR HOSE, LOWER') = 'lower';
  ASSERT public.part_text_level('lower control arm and upper arm') IS NULL;
  ASSERT (SELECT count(*) = count(DISTINCT rule) AND count(*) = count(DISTINCT ord) FROM public.part_installation_rules()), 'rule ids and order are unique';
  ASSERT NOT EXISTS (SELECT 1 FROM public.part_installation_rules()
                      WHERE '' ~ line_re IS NULL OR '' ~ coalesce(key_re, 'x') IS NULL OR '' ~ coalesce(label_re, 'x') IS NULL OR '' ~ coalesce(label_not_re, 'x') IS NULL),
         'every rule pattern compiles';
  ASSERT NOT EXISTS (SELECT 1 FROM public.part_installation_rules() WHERE key_re IS NULL AND label_re IS NULL), 'a rule must name some evidence';
  ASSERT NOT EXISTS (SELECT 1 FROM public.part_installation_rules() WHERE key_re ~ '^(engine\.bay|undercarriage|engine\.cooling|trim\.molding)\$'),
         'no coarse key names a single part';
END $$;

INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1973, '00000000-0000-0000-0000-0000000000c1', NULL, NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000000a2', 1973, '00000000-0000-0000-0000-0000000000c1', NULL, NULL, false, NULL);
INSERT INTO public.fixture_lines VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', 'MOLDED RADIATOR HOSE, UPPER; list 12.34', 'H1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', 'MOLDED RADIATOR HOSE, LOWER', 'H2', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', 'THERMOSTAT (MCS) 1Y', 'T1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', 'FAN CLUTCH (MTC) LT', 'F1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', '70-73 FBRD TAIL LAMP BEZEL LH', 'B1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', '70-73 FBRD TAIL LAMP BEZEL RH', 'B2', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', '70-79 FBIRD CONSOLE-MAN TRANS', 'C1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', '73-75 TRANS/AM HOOD DECAL ORNG', 'D1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-0000000000b1', 'part', '2026-12-01', 'Supplier', '73-74 HEADLINER BOARD-BLACK', 'L1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000010a', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', 'STARTER (ULT) LT', 'S1', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000010b', '00000000-0000-0000-0000-0000000000b1', 'part', '2025-01-02', 'Supplier', 'SEALED BEAM (SYL) 1Y', 'S2', 4321, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000010c', '00000000-0000-0000-0000-0000000000b2', 'part', '2024-10-07', 'Machine Shop', 'Valve Job', NULL, 500, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000010d', '00000000-0000-0000-0000-0000000000b2', 'charge', '2024-10-07', 'Supplier', 'Shipping', NULL, 20, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a2', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b4', 'part', '2025-01-03', 'Supplier', 'STD RADIATOR CAP', 'R1', 9, NULL, NULL);

INSERT INTO public.fixture_photos VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/1.jpg', '2026-10-28T17:00:00Z', false, false, false, true),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/2.jpg', '2026-10-28T17:05:00Z', true,  false, false, true),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/3.jpg', '2026-10-28T17:06:00Z', false, false, false, false),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/4.jpg', '2026-10-28T17:07:00Z', false, false, false, true),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/5.jpg', '2026-10-28T17:08:00Z', false, false, false, true),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/6.jpg', '2026-10-28T17:09:00Z', false, false, false, true),
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000a1', 'https://x.test/7.jpg', '2026-10-28T17:10:00Z', false, false, false, true);
-- reviewed readings: what each photograph shows (completeness is part of the reading)
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d1","build_phase_guess":"final_assembly","narrative_one_line":"Engine bay.","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Upper radiator hose with worm-drive clamp"},{"label":"Black fan shroud"},{"label":"Left tail lamp lens and bright bezel"},{"label":"Black headliner"},{"label":"Round headlamp and bezel"}]}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d2","build_phase_guess":"final_assembly","narrative_one_line":"Sensitive.","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Fan-clutch cooling fins"}]}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d3","build_phase_guess":"final_assembly","narrative_one_line":"Ineligible.","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Fan-clutch cooling fins"}]}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d4","build_phase_guess":"final_assembly","narrative_one_line":"Console.","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Right tail lamp lens and bezel"}]}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d5","build_phase_guess":"final_assembly","narrative_one_line":"A printed sheet of build photographs.","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Hood bird graphic"}]}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d6","build_phase_guess":"final_assembly","narrative_one_line":"Engine bay mid-build.","state_observations":{"completeness":"partial"},"components_seen":[{"label":"Starter motor"}]}'),
  ('00000000-0000-0000-0000-0000000000a1', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-0000000000d7","build_phase_guess":"final_assembly","narrative_one_line":"Nose.","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Front nose"}]}');
-- part-keyed readings: a key counts alone; the statement is not searched for other parts
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"interior.center.console","image_id":"00000000-0000-0000-0000-0000000000d4","source_text":"Light marks on the console lid."}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"trim.bumper.front","image_id":"00000000-0000-0000-0000-0000000000d7","source_text":"Dark edge at the nose beside the headlamp."}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', false, '{"part_key":"engine.cooling","image_id":"00000000-0000-0000-0000-0000000000d1","source_text":"Thermostat housing and coolant neck show scuffs."}'),
  ('00000000-0000-0000-0000-0000000000a1', 'photo_map_harvest_v1', true,  '{"part_key":"interior.center.console","image_id":"00000000-0000-0000-0000-0000000000d1","source_text":"Superseded."}');

DO $$
DECLARE r jsonb; l jsonb;
BEGIN
  SET LOCAL ROLE anon;
  r := public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a1');
  -- the population: the receipt parts, not shop work or charges
  ASSERT (r #>> '{totals,part_lines}')::int = 11, 'eleven part lines (shop work and charges are not parts): ' || (r -> 'totals')::text;
  -- a specific match, with the rule and the reading's own words
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000101';
  ASSERT l ->> 'status' = 'seen' AND l ->> 'rule' = 'radiator_hose' AND l #>> '{seen,0,reading}' = 'Upper radiator hose with worm-drive clamp'
     AND l #>> '{seen,0,day}' = '2026-10-28' AND l #>> '{seen,0,image_id}' = '00000000-0000-0000-0000-0000000000d1'
     AND l ->> 'match_basis' ~ 'radiator_hose' AND l ->> 'system_key' = 'cooling', 'upper hose matched by its label: ' || l::text;
  -- same system, other part: the lower hose is not the upper hose; the thermostat has no rule even though cooling photos exist
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000102';
  ASSERT l ->> 'status' = 'not_photographed' AND l -> 'seen' = '[]'::jsonb AND l ->> 'reason' = 'rule found no qualifying photograph reading', 'lower hose stays empty: ' || l::text;
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000103';
  ASSERT l ->> 'status' = 'not_photographed' AND l ->> 'rule' IS NULL AND l ->> 'reason' = 'no rule names this part' AND l -> 'seen' = '[]'::jsonb,
    'a cooling photo and a cooling part key do not show the thermostat: ' || l::text;
  -- a sensitive or ineligible photograph never counts
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000104';
  ASSERT l ->> 'status' = 'not_photographed' AND l -> 'seen' = '[]'::jsonb, 'hidden photos do not count: ' || l::text;
  ASSERT r::text !~ '/(2|3)\.jpg' AND r::text !~ '000000d2' AND r::text !~ '000000d3', 'hidden photographs never leave the reader';
  -- side words: the left bezel is seen by the left reading, the right bezel only by the right one
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000105';
  ASSERT l ->> 'status' = 'seen' AND l ->> 'seen_images' = '1' AND l #>> '{seen,0,reading}' = 'Left tail lamp lens and bright bezel', 'left bezel: ' || l::text;
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000106';
  ASSERT l ->> 'status' = 'seen' AND l ->> 'seen_images' = '1' AND l #>> '{seen,0,image_id}' = '00000000-0000-0000-0000-0000000000d4', 'right bezel is not shown by the left reading: ' || l::text;
  -- a part key counts alone; the superseded reading does not
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000107';
  ASSERT l ->> 'status' = 'seen' AND l #>> '{seen,0,matched_on}' = 'part_key' AND l ->> 'seen_images' = '1', 'console by its key: ' || l::text;
  -- a print counts apart, with no day
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000108';
  ASSERT l ->> 'status' = 'seen_in_prints_only' AND l #> '{seen,0,day}' = 'null'::jsonb AND (l #>> '{seen,0,is_print}')::boolean, 'print only: ' || l::text;
  -- a photograph before the receipt day cannot show that purchase
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-000000000109';
  ASSERT l ->> 'status' = 'not_photographed', 'the receipt is dated after the photograph: ' || l::text;
  -- a photograph that does not show the assembled car does not count
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-00000000010a';
  ASSERT l ->> 'status' = 'not_photographed', 'a partial build photo does not count: ' || l::text;
  -- a part-keyed statement that only mentions a headlamp does not show the headlamp; the label does
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'item_id' = '00000000-0000-0000-0000-00000000010b';
  ASSERT l ->> 'status' = 'seen' AND l ->> 'seen_images' = '1' AND l #>> '{seen,0,image_id}' = '00000000-0000-0000-0000-0000000000d1', 'headlamp by its label only: ' || l::text;
  -- totals
  ASSERT (r #>> '{totals,lines_seen}')::int = 5 AND (r #>> '{totals,lines_seen_in_prints_only}')::int = 1 AND (r #>> '{totals,lines_not_photographed}')::int = 5
     AND (r #>> '{totals,lines_without_rule}')::int = 1, 'totals: ' || (r -> 'totals')::text;
  SELECT e INTO l FROM jsonb_array_elements(r -> 'by_system') e WHERE e ->> 'system_key' = 'cooling';
  ASSERT (l ->> 'part_lines')::int = 4 AND (l ->> 'lines_seen')::int = 1 AND (l ->> 'lines_not_photographed')::int = 3, 'by system: ' || l::text;
  ASSERT r ->> 'limitation' ~ 'does not prove that the unit on the receipt is the unit fitted', 'the limitation is carried as text';
  -- no amounts to anyone, and the supplier list price is dropped from the words
  ASSERT r::text !~ '4321' AND r::text !~ '12\.34' AND r::text !~ '"(amount|total_price|recorded_amount)"', 'anon sees no amounts: ' || r::text;
  ASSERT public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a2') IS NULL, 'hidden vehicle';
  RESET ROLE;
  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  r := public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a1');
  ASSERT r::text !~ '4321' AND r::text !~ '12\.34', 'the owner sees no amounts here either';
  ASSERT (public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a2') #>> '{totals,part_lines}')::int = 1, 'owner reads a private vehicle';
END $$;


-- Rules 2 (20261120050000): applied on top, with its own vehicle so the totals above stay as they were.
\ir ../migrations/20261120050000_part_installation_rules_2.sql
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a3', 1973, '00000000-0000-0000-0000-0000000000c1', NULL, NULL, true, NULL);
INSERT INTO public.fixture_lines
  SELECT '00000000-0000-0000-0000-0000000000a3', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b5', 'part', '2025-01-02', 'Supplier', d, 'P', 1, NULL, NULL
    FROM unnest(ARRAY['70-73 FBRD TAIL LAMP LENS-LH','70-73 TAIL LAMP HOUSING LH','70-81 F-BODY DR GLASS-CLEAR-RH','73-74 SD455 HOOD DECAL BLACK',
      '73-75 TRANS/AM HOOD DECAL ORNG','71-75 FB STD F/S UPH BLACK (SET)','POWER STEERING PUMP PULLEY','66-81 WATER NECK PONTIAC V8',
      '71-72 AIR CLNR VENT TUBE','TRANS MOUNT (ENS) 1Y','70-81 INNER CONSOLE GLOVE BOX','72-77 CAM/FB LWR DOOR PNL KIT',
      '68-81 STD REMOTE MIRROR BEZEL (SET)','70-81 DASH FILLER PLATE DELETE','70-73 F-BODY RR SPKR SHLF PNL','BEARING SET']) d;
INSERT INTO public.fixture_photos
  SELECT ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-0000000000a3', 'https://x.test/r2-' || n || '.jpg',
         '2026-10-28T18:00:00Z', false, false, false, true FROM generate_series(1, 14) n;
-- image 1 = what must NOT count (every label names a neighbour, a denial, a hedge or a glimpse); image 14 = what must count (new rules)
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data)
  SELECT '00000000-0000-0000-0000-0000000000a3', 'reviewed_image_analysis_v1', false,
         jsonb_build_object('image_id', '00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'), 'build_phase_guess', 'final_assembly',
           'state_observations', jsonb_build_object('completeness', 'assembled'),
           'components_seen', (SELECT jsonb_agg(jsonb_build_object('label', x)) FROM unnest(labels) x))
    FROM (VALUES
      (1, ARRAY['Driver-side round headlamp lens','Left rear lamp assembly','Upper door glass belt molding','Shaker scoop with SD-455 lettering',
                'Red hood with shaker opening and no visible bird graphic','Passenger floor mat with bird graphic',
                'Black front bucket seat visible through windshield','Black accessory pulley hub, possibly power-steering pulley',
                'Bright metal hose connection, possibly coolant outlet','Right exhaust outlet','Transmission mounting bracket with partly enclosed apparent isolator',
                'Transmission crossmember','Closed console armrest and storage body','Red outer door panel','Black rear package-shelf bracket']),
      (2, ARRAY['Left tail lamp lens and bezel']),
      (3, ARRAY['Partial left tail lamp housing']),
      (4, ARRAY['Right door glass']),
      (5, ARRAY['Hood scoop with SD-455 lettering']),
      (6, ARRAY['Hood bird graphic and shaker scoop']),
      (7, ARRAY['Black pleated front seat cushion']),
      (8, ARRAY['Water outlet neck with mounting fastener','Bent metal air-cleaner vent tube']),
      (9, ARRAY['Transmission crossmember and mount','Empty console storage liner']),
      (10, ARRAY['Black molded lower door panel with armrest and storage recess','Remote mirror control and square bezel']),
      (11, ARRAY['Rectangular engine-turned filler plate','Rear parcel shelf covering'])) v(n, labels);
-- a part-keyed reading on the front seat must not stand for the upholstery any more (a key names the seat, not its covering)
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000a3', 'photo_map_harvest_v1', false, '{"part_key":"interior.seat.front","image_id":"00000000-0000-0000-0000-000000000112","source_text":"Front upholstery has creases."}');
INSERT INTO public.fixture_readings(vehicle_id, extraction_method, is_superseded, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000a3', 'reviewed_image_analysis_v1', false, '{"image_id":"00000000-0000-0000-0000-000000000112","build_phase_guess":"final_assembly","state_observations":{"completeness":"assembled"},"components_seen":[{"label":"Dashboard"}]}');

DO $$
DECLARE r jsonb; l jsonb;
  n text[] := ARRAY['70-73 FBRD TAIL LAMP LENS-LH','70-73 TAIL LAMP HOUSING LH','70-81 F-BODY DR GLASS-CLEAR-RH','73-74 SD455 HOOD DECAL BLACK',
      '73-75 TRANS/AM HOOD DECAL ORNG','71-75 FB STD F/S UPH BLACK (SET)','POWER STEERING PUMP PULLEY','66-81 WATER NECK PONTIAC V8',
      '71-72 AIR CLNR VENT TUBE','TRANS MOUNT (ENS) 1Y','70-81 INNER CONSOLE GLOVE BOX','72-77 CAM/FB LWR DOOR PNL KIT',
      '68-81 STD REMOTE MIRROR BEZEL (SET)','70-81 DASH FILLER PLATE DELETE','70-73 F-BODY RR SPKR SHLF PNL'];
  -- the one image each line must be seen in (image 1, the negatives, never counts); null = not photographed
  img int[] := ARRAY[2, 3, 4, 5, 6, 7, NULL, 8, 8, 9, 9, 10, 10, 11, 11];
  i int;
BEGIN
  SET LOCAL ROLE anon;
  r := public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a3');
  ASSERT (r #>> '{totals,part_lines}')::int = 16, 'sixteen part lines: ' || (r -> 'totals')::text;
  FOR i IN 1..array_length(n, 1) LOOP
    SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'description' = n[i];
    IF img[i] IS NULL THEN
      ASSERT l ->> 'status' = 'not_photographed' AND l ->> 'seen_images' = '0', 'hedged or neighbour readings do not show ' || n[i] || ': ' || l::text;
    ELSE
      ASSERT l ->> 'status' = 'seen' AND l ->> 'seen_images' = '1' AND l #>> '{seen,0,image_id}' = '00000000-0000-0000-0000-0000000001' || lpad(img[i]::text, 2, '0'),
        'only the reading that names ' || n[i] || ' counts: ' || l::text;
    END IF;
  END LOOP;
  -- the rule that owns a new line, and a part that cannot be seen still has no rule
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'description' = '66-81 WATER NECK PONTIAC V8';
  ASSERT l ->> 'rule' = 'water_outlet_neck', 'new rule owns the line: ' || l::text;
  SELECT e INTO l FROM jsonb_array_elements(r -> 'lines') e WHERE e ->> 'description' = 'BEARING SET';
  ASSERT l ->> 'status' = 'not_photographed' AND l ->> 'rule' IS NULL AND l ->> 'reason' = 'no rule names this part', 'a bearing set is never matched: ' || l::text;
  ASSERT (r #>> '{totals,lines_seen}')::int = 14 AND (r #>> '{totals,lines_not_photographed}')::int = 2, 'totals: ' || (r -> 'totals')::text;
  RESET ROLE;
  ASSERT (SELECT count(*) FROM public.part_installation_rules()) = 100 AND (SELECT count(*) = count(DISTINCT ord) FROM public.part_installation_rules()), 'seven rules added, ords unique';
END $$;

\ir ../sql/revert_20261120050000_part_installation_rules_2.sql
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.part_installation_rules()) = 93 AND public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a3') IS NOT NULL, 'revert restores the first rule table'; END $$;

\ir ../sql/revert_20261120020000_vehicle_part_installation_evidence.sql
DO $$ BEGIN ASSERT to_regprocedure('public.vehicle_part_installation_evidence(uuid)') IS NULL AND to_regprocedure('public.part_installation_rules()') IS NULL; END $$;
