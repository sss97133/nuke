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

\ir revert_20261119200000_vehicle_build_reconstruction.sql
DO $$ BEGIN ASSERT to_regprocedure('public.vehicle_build_reconstruction(uuid)') IS NULL; END $$;
