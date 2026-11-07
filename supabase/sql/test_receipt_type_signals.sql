-- receipt_type_signals after 20261111110000 (which captures the live hot-patch on top of 20261109130000): fulfilment words no longer read as trucks, Pontiac F-bodies read as cars,
-- a MOPAR make word on a Pontiac still fails, a printed CATEGORY header is not fitment, and a Blazer slip still passes on a truck.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_type_signals%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_type_signals* database';
  END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, body_style text);
CREATE TABLE public.receipts(id uuid PRIMARY KEY, vendor_name text, raw_extraction jsonb, raw_json jsonb);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, description text, category text);
CREATE FUNCTION public.receipt_vehicle_class(v vehicles) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  select case when lower(concat_ws(' ',v.body_style,v.model)) ~ '(truck|pickup|suv|wagon|suburban|blazer|bronco|wrangler|\mk[0-9]|\mc[0-9]|\mr[0-9]|\mv[0-9]|lx|land|cruiser|jimmy|scout)' then 'truck'
    when v.body_style is null and v.model is null then 'unknown' else 'car' end $$;
\ir gate_sv_stand_in.sql
\ir ../migrations/20261109130000_receipt_type_signals_fulfilment.sql
\ir ../migrations/20261111110000_receipt_type_signals_category_chrome.sql

CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'ok: %', label; END $$;
CREATE FUNCTION pg_temp.gate(p_receipt uuid, p_vehicle uuid) RETURNS text LANGUAGE sql AS $$
  SELECT public.receipt_type_gate_sv(public.receipt_type_signals(r), v) FROM public.receipts r, public.vehicles v WHERE r.id = p_receipt AND v.id = p_vehicle $$;

INSERT INTO public.vehicles VALUES ('10000000-0000-4000-8000-000000000001', 'Pontiac', 'Firebird', 'FS87 N'),
                                   ('10000000-0000-4000-8000-000000000002', 'Chevrolet', 'K5 Blazer', 'SUV');
INSERT INTO public.receipts VALUES
  ('20000000-0000-4000-8000-000000000001', 'O''Reilly Auto Parts', '{"data":{"notes":"Items ordered from hub/DC for pickup. Counter 456643."}}', '{"data_v2":{"vehicle_hint":"1973 Pontiac Firebird"}}'),
  ('20000000-0000-4000-8000-000000000002', 'Classic Industries', '{"data":{"notes":"stamp TRUCK FREIGHT; CUST ACK T/F"}}', '{"data_v2":{"vehicle_hint":"MULTIPLE"}}'),
  ('20000000-0000-4000-8000-000000000003', 'Classic Industries', '{"data":{"notes":"DROP SHIP eBay order; category CA, MOPAR."}}', '{}'),
  ('20000000-0000-4000-8000-000000000004', 'Offroad Design', '{"data":{"notes":"order note 77 K5"}}', '{"data_v2":{"vehicle_hint":"1977 Blazer"}}'),
  ('20000000-0000-4000-8000-000000000005', 'LMC Truck', '{}', '{"data_v2":{"vehicle_hint":"1985 K10 pickup"}}'),
  ('20000000-0000-4000-8000-000000000006', 'Classic Industries', '{"data":{"notes":"Mopar replacement part"}}', '{}'),
  -- the six synthetic cases of the 2026-11-07 ingestion test report (single-text receipts)
  ('21000000-0000-4000-8000-000000000001', 'Parts', '{"data":{"notes":"DC or Hub Pickup TRUCK FREIGHT"}}', '{}'),
  ('21000000-0000-4000-8000-000000000002', 'Parts', '{"data":{"notes":"CATEGORY: CA MOPAR Trans Am"}}', '{"data_v2":{"vehicle_hint":"Pontiac Firebird"}}'),
  ('21000000-0000-4000-8000-000000000003', 'Parts', '{"data":{"notes":"LMC Truck K10"}}', '{"data_v2":{"vehicle_hint":"Pontiac Firebird"}}'),
  ('21000000-0000-4000-8000-000000000004', 'Parts', '{"data":{"notes":"LMC Truck Chevrolet K10"}}', '{}'),
  ('21000000-0000-4000-8000-000000000005', 'Parts', '{"data":{"notes":"Pontiac Firebird"}}', '{}'),
  ('21000000-0000-4000-8000-000000000006', 'Parts', '{"data":{"notes":"Ford Mustang"}}', '{}');
INSERT INTO public.receipt_items(receipt_id, description) VALUES
  ('20000000-0000-4000-8000-000000000001', 'STARTER (ULT) LT; DC or Hub Pickup; ordered 1 from Store 3565'),
  ('20000000-0000-4000-8000-000000000001', 'HEX BOLT (DOR) LT BP; list 7.78'),
  ('20000000-0000-4000-8000-000000000002', '70-76 SHAKER HOOD'),
  ('20000000-0000-4000-8000-000000000002', '73-76 FIREBIRD RAD SUPPORT'),
  ('20000000-0000-4000-8000-000000000003', '71-72 AIR CLNR VENT TUBE'),
  ('20000000-0000-4000-8000-000000000004', 'Dana 44 crossover steering kit, 73-80 GM trucks');

SELECT pg_temp.assert_true((SELECT (public.receipt_type_signals(r)->>'truck')::boolean = false FROM public.receipts r WHERE r.id = '20000000-0000-4000-8000-000000000001'), 'hub pickup is not a truck');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') = 'pass', 'O''Reilly page with a Firebird hint passes on the Firebird');
SELECT pg_temp.assert_true((SELECT (public.receipt_type_signals(r)->>'truck')::boolean = false AND (public.receipt_type_signals(r)->>'car')::boolean FROM public.receipts r WHERE r.id = '20000000-0000-4000-8000-000000000002'), 'truck freight is not a truck; FIREBIRD is a car word');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') = 'pass', 'Firebird parts page passes on the Firebird');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001') = 'unknown', 'a printed CATEGORY: CA MOPAR header is form chrome: no Dodge, so unknown on a Pontiac (live hot-patch, 2026-11-06)');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001') = 'fail', 'a real MOPAR line item still fails on a Pontiac');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002') = 'pass', 'a Blazer slip still passes on the K5');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001') = 'fail', 'an LMC Truck K10 page still fails on the Firebird');
SELECT pg_temp.assert_true(pg_temp.gate('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002') = 'fail', 'a Firebird parts page fails on the K5');
INSERT INTO public.vehicles VALUES ('10000000-0000-4000-8000-000000000003', 'Chevrolet', 'K10', 'Pickup'),
                                   ('10000000-0000-4000-8000-000000000004', 'Chevrolet', 'Corvette', 'Coupe');
SELECT pg_temp.assert_true(pg_temp.gate('21000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') = 'unknown', 'report 1: hub pickup + truck freight is no vehicle signal: unknown on a Firebird');
SELECT pg_temp.assert_true(pg_temp.gate('21000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') = 'pass', 'report 2: CATEGORY: CA MOPAR Trans Am on a Pontiac Firebird passes');
SELECT pg_temp.assert_true(pg_temp.gate('21000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001') = 'fail', 'report 3: LMC Truck K10 on a Firebird fails');
SELECT pg_temp.assert_true(pg_temp.gate('21000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003') = 'pass', 'report 4: LMC Truck Chevrolet K10 on a Chevrolet K10 passes');
SELECT pg_temp.assert_true(pg_temp.gate('21000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001') = 'pass', 'report 5: Pontiac Firebird on a Pontiac Firebird passes');
SELECT pg_temp.assert_true(pg_temp.gate('21000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000004') = 'fail', 'report 6: Ford Mustang on a Chevrolet Corvette fails');
SELECT 'receipt type signals contract passed' AS result;
