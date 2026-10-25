-- Disposable PG17 only. Synthetic fixtures; exercises the actual migration 20261028200000_photo_work_ledger.sql.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Live shapes (subset of columns).
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, image_url text, taken_at timestamptz,
  latitude numeric, longitude numeric, vision_gate_status text, is_sensitive boolean);
CREATE TABLE public.image_analysis_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL REFERENCES public.vehicle_images(id),
  vehicle_id uuid, analysis_tier integer NOT NULL, analyzed_at timestamptz DEFAULT now(), analyzed_by_model text, confirmed_findings jsonb,
  inferred_findings jsonb, unknown_items jsonb, handoff_notes text, supersedes uuid, superseded_by uuid, superseded_at timestamptz,
  superseded_reason text, overall_confidence numeric, citation_count integer DEFAULT 0, inference_count integer DEFAULT 0,
  unknown_count integer DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE public.assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_type text NOT NULL, title text, description text,
  creator_id uuid, owner_id uuid, organization_id uuid, status text DEFAULT 'active', visibility text DEFAULT 'private', vehicle_id uuid,
  attributes jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT assets_asset_type_check CHECK (asset_type = ANY (ARRAY['image','vehicle','garment','publication','issue','article','shoot'])));
CREATE TABLE public.asset_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  source_id uuid, kind text, observed_at timestamptz, content_text text, structured_data jsonb DEFAULT '{}'::jsonb, content_hash text,
  confidence numeric DEFAULT 0.5, source_url text, source_identifier text, extraction_method text, agent_model text, superseded_by uuid,
  supersedes uuid, created_at timestamptz DEFAULT now());
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_observations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.assets, public.asset_observations TO anon, authenticated;
CREATE TABLE public.user_tools(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, brand text, description text, category text,
  first_purchase_date date, transaction_date date);
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vendor_name text, part_number text, raw_extraction jsonb,
  receipt_date date, transaction_date date, purchase_date date, is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.v_financial_accounting_records(owner_id uuid, local_id text, section text, record_date text, description text, decision text);
CREATE TABLE public.tool_requirement_key_map(source_kind text, source_key text, requirement_key text, note text);
INSERT INTO tool_requirement_key_map VALUES ('tool_term','tig welder','welding.tig',NULL),('tool_term','engine hoist','equipment.lift.engine_hoist',NULL);

CREATE FUNCTION t_assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

\ir ../migrations/20261028200000_photo_work_ledger.sql

-- Person A (…0a) owns photos at a recurring shop cell (36.000,-115.000) on 6 days; person B (…0b) owns one photo.
INSERT INTO vehicle_images(id, vehicle_id, user_id, image_url, taken_at, latitude, longitude, vision_gate_status, is_sensitive)
SELECT ('50000000-0000-0000-0000-00000000000' || n)::uuid, CASE WHEN n IN (1,2) THEN '40000000-0000-0000-0000-000000000001'::uuid END,
  '10000000-0000-0000-0000-00000000000a', 'https://img.example/' || n, ts::timestamptz, 36.0001, -115.0001, 'approved', false
FROM (VALUES (1,'2023-03-01 18:00Z'),(2,'2023-03-01 21:00Z'),(3,'2023-04-10 18:00Z'),(4,'2023-05-20 18:00Z'),(5,'2023-06-01 18:00Z'),
  (6,'2023-07-01 18:00Z')) v(n, ts);
INSERT INTO vehicle_images VALUES
 ('50000000-0000-0000-0000-000000000007',NULL,'10000000-0000-0000-0000-00000000000a','https://img.example/7','2024-10-05 19:00Z',35.5,-114.5,'approved',false),
 ('50000000-0000-0000-0000-000000000008',NULL,'10000000-0000-0000-0000-00000000000a','https://img.example/8','2024-10-06 19:00Z',NULL,NULL,'rejected_personal',false),
 ('50000000-0000-0000-0000-000000000009',NULL,'10000000-0000-0000-0000-00000000000b','https://img.example/9','2024-10-06 19:00Z',NULL,NULL,'approved',false),
 ('50000000-0000-0000-0000-000000000010',NULL,'10000000-0000-0000-0000-00000000000a','https://img.example/10','2024-11-01 19:00Z',36.0001,-115.0001,'approved',false),
 ('50000000-0000-0000-0000-000000000011',NULL,'10000000-0000-0000-0000-00000000000a','https://img.example/11','2024-11-02 19:00Z',NULL,NULL,'approved',false);
INSERT INTO user_tools(user_id, brand, description, category, first_purchase_date) VALUES
 ('10000000-0000-0000-0000-00000000000a','Snap-on','1/2 drive impact wrench brushless','power_tool','2023-01-10');
INSERT INTO v_financial_accounting_records VALUES
 ('10000000-0000-0000-0000-00000000000a','2024-EXP-1','Expense','2024-10-20','Hypertherm plasma cutter','shop tools');

\set tig '{"kind":"equipment","key":"welding.tig","label":"red Lincoln TIG welder","brand":"Lincoln","model":"Square Wave 200","text_read":"Lincoln Square Wave 200","role":"in_use","count":1,"confidence":0.9}'
\set hoist '{"kind":"equipment","key":"equipment.lift.engine_hoist","label":"orange engine hoist","brand":null,"model":null,"text_read":null,"role":"present","count":1,"confidence":0.8}'
\set impact '{"kind":"tool","key":"tool.power.impact_wrench","label":"Snap-on impact wrench","brand":"Snap-on","model":null,"text_read":"snap-on","role":"present","count":1,"confidence":0.8}'
\set seat '{"kind":"part","key":"part.seat","label":"tan bench seat","brand":"Ford","model":null,"text_read":null,"role":"for_sale","count":1,"confidence":0.8}'
\set axle_installed '{"kind":"part","key":"part.axle.rear","label":"rear axle","brand":null,"model":null,"text_read":null,"role":"installed","count":1,"confidence":0.9}'
\set pedal '{"kind":"equipment","key":"cutting.plasma","label":"plasma cutter","brand":"Hypertherm","model":null,"text_read":"HYPERTHERM","role":"present","count":1,"confidence":0.7}'
\set low '{"kind":"tool","key":"tool.hand","label":"something","brand":null,"model":null,"text_read":null,"role":"present","count":1,"confidence":0.3}'
\set work '{"activity":"welding","skill_keys":["welding.tig"],"in_progress":true,"performer_visible":"own_hands"}'
\set nowork '{"activity":"none","skill_keys":[],"in_progress":false,"performer_visible":"none"}'
\set nocom '{"context":"none","amount":null,"currency":null,"item_text":null,"counterparty_present":false}'
\set sale '{"context":"listing_screenshot","amount":1200,"currency":"USD","item_text":"bench seat","counterparty_present":true}'

SELECT format($j$[
 {"image_id":"50000000-0000-0000-0000-000000000001","model":"m-small","reading":{"objects":[%1$s,%2$s,%3$s,%5$s,%7$s],"work":%8$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000002","model":"m-small","reading":{"objects":[%1$s],"work":%8$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000003","model":"m-small","reading":{"objects":[%1$s,%2$s],"work":%9$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000004","model":"m-small","reading":{"objects":[%1$s],"work":%8$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000005","model":"m-small","reading":{"objects":[%2$s],"work":%9$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000007","model":"m-small","reading":{"objects":[%4$s],"work":%9$s,"commerce":%11$s,"scene":"s","place_kind":"screen"}},
 {"image_id":"50000000-0000-0000-0000-000000000008","model":"m-small","reading":{"objects":[%1$s],"work":%9$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000009","model":"m-small","reading":{"objects":[%1$s],"work":%9$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000010","model":"m-small","reading":{"objects":[%6$s],"work":%9$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000006","model":"m-small","reading":{"objects":[%1$s],"work":%9$s,"commerce":%10$s,"scene":"s","place_kind":"shop"}},
 {"image_id":"50000000-0000-0000-0000-000000000011","model":"m-small","reading":{"objects":"not an array","work":%9$s,"commerce":%10$s}}
]$j$, :'tig', :'hoist', :'impact', :'seat', :'axle_installed', :'pedal', :'low', :'work', :'nowork', :'nocom', :'sale') AS batch \gset

-- Writer refusals for non-service callers.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
DO $$ BEGIN
  PERFORM record_photo_work_readings('10000000-0000-0000-0000-00000000000a', '[]'::jsonb);
  RAISE EXCEPTION 'expected refusal';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: owner cannot call the writer'; END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT record_photo_work_readings('10000000-0000-0000-0000-00000000000a', :'batch'::jsonb) AS w1 \gset
SELECT record_photo_work_readings('10000000-0000-0000-0000-00000000000a', :'batch'::jsonb) AS w2 \gset
SELECT t_assert((:'w1'::jsonb) @> '{"received":11,"recorded":8,"refused":3}', 'writer: 8 recorded; personal-gated, other person and malformed refused: ' || :'w1');
SELECT t_assert((:'w1'::jsonb)->'refused_ids' @> '["50000000-0000-0000-0000-000000000008","50000000-0000-0000-0000-000000000009","50000000-0000-0000-0000-000000000011"]', 'refused ids reported');
SELECT t_assert((:'w2'::jsonb) @> '{"recorded":0,"already_recorded":8,"assets_created":0,"sightings_recorded":0}', 'replay is idempotent: ' || :'w2');
SELECT t_assert((SELECT count(*) FROM image_analysis_records WHERE vehicle_id IS NOT NULL) = 0, 'readings keep vehicle_id NULL (owner-private)');
SELECT t_assert((SELECT count(*) FROM assets) = 5
  AND (SELECT count(*) FROM assets WHERE owner_id IS NOT NULL OR status <> 'pending' OR visibility <> 'private') = 0,
  'five assets (tig, hoist, impact, seat, plasma), all pending/private with no owner');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM assets WHERE attributes->>'key' IN ('part.axle.rear','tool.hand')), 'installed parts and low-confidence objects do not fold');
SELECT t_assert((SELECT count(*) FROM asset_observations a JOIN assets s ON s.id = a.asset_id WHERE s.attributes->>'fold_key' = 'welding.tig|lincoln') = 5,
  'Lincoln TIG folds five photos into one asset');

-- A higher-tier reading of photo 3 supersedes the lower one and replaces its sightings.
SELECT record_photo_work_readings('10000000-0000-0000-0000-00000000000a', format('[{"image_id":"50000000-0000-0000-0000-000000000003","model":"m-large","tier":2,"reading":{"objects":[%s],"work":%s,"commerce":%s,"scene":"s","place_kind":"shop"}}]', :'hoist', :'nowork', :'nocom')::jsonb) AS w3 \gset
SELECT t_assert((:'w3'::jsonb) @> '{"recorded":1}' AND (SELECT count(*) FROM image_analysis_records WHERE image_id = '50000000-0000-0000-0000-000000000003' AND superseded_by IS NULL) = 1
  AND (SELECT analysis_tier FROM image_analysis_records WHERE image_id = '50000000-0000-0000-0000-000000000003' AND superseded_by IS NULL) = 2, 'tier 2 supersedes tier 1');

-- Readers: the person, then another signed-in person, then anon.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
SELECT photo_assets_read('10000000-0000-0000-0000-00000000000a') AS own \gset
SELECT photo_footprint_traces('10000000-0000-0000-0000-00000000000a', 2023) AS tr23 \gset
SELECT photo_footprint_traces('10000000-0000-0000-0000-00000000000a', 2024) AS tr24 \gset
SELECT photo_work_proof_read('10000000-0000-0000-0000-00000000000a') AS proof \gset
RESET ROLE;

SELECT t_assert((:'own'::jsonb)->>'assets_total' = '5' AND (:'own'::jsonb)->>'readings_total' = '8', 'own read totals: ' || ((:'own'::jsonb) - 'assets')::text);
SELECT t_assert((SELECT a FROM jsonb_array_elements((:'own'::jsonb)->'assets') a WHERE a->>'key' = 'welding.tig')
  @> '{"photos":4,"sighting_days":3,"holding":"held","citation":"uncited","brand":"Lincoln","models_read":["Square Wave 200"],"first_image_id":"50000000-0000-0000-0000-000000000001"}',
  'TIG: tier-1 photo 3 sighting withdrawn; 4 photos on 3 days over months at the recurring shop = held, no expense names it');
SELECT t_assert((SELECT a FROM jsonb_array_elements((:'own'::jsonb)->'assets') a WHERE a->>'key' = 'equipment.lift.engine_hoist')
  @> '{"photos":3,"holding":"held","citation":"uncited"}', 'hoist: tier-2 sighting replaces tier-1 sighting');
SELECT t_assert((SELECT a FROM jsonb_array_elements((:'own'::jsonb)->'assets') a WHERE a->>'key' = 'tool.power.impact_wrench')
  @> '{"citation":"user_tools","holding":"seen"}', 'impact wrench is cited by the receipt-derived tool ledger');
SELECT t_assert((SELECT a FROM jsonb_array_elements((:'own'::jsonb)->'assets') a WHERE a->>'key' = 'part.seat')
  @> '{"holding":"in_transaction","amount":1200,"amount_basis":"document","citation":"uncited"}', 'seat: listing screenshot amount is a document amount');
SELECT t_assert((SELECT a FROM jsonb_array_elements((:'own'::jsonb)->'assets') a WHERE a->>'key' = 'cutting.plasma')
  @> '{"citation":"book"}', 'plasma cutter: a book Expense record naming it within the window cites it');
SELECT t_assert(jsonb_array_length(:'tr23'::jsonb) = 2 AND (:'tr23'::jsonb) @> '[{"kind":"photo_asset","date":"2023-03-01","vendor":"Lincoln"}]'
  AND NOT :'tr23' ~ 'impact', '2023 traces: TIG and hoist, uncited and held; the cited wrench is absent');
SELECT t_assert((:'tr24'::jsonb) @> '[{"kind":"photo_asset","date":"2024-10-05","amount":1200}]' AND jsonb_array_length(:'tr24'::jsonb) = 1,
  '2024 traces: the seat with its printed amount; the cited plasma cutter is absent');
SELECT t_assert((SELECT s FROM jsonb_array_elements((:'proof'::jsonb)->'skills') s WHERE s->>'skill' = 'welding.tig')
  @> '{"days":2,"photos":3,"own_hands_days":2,"vehicles":1}' AND (SELECT (s->>'photo_span_hours')::numeric FROM jsonb_array_elements((:'proof'::jsonb)->'skills') s WHERE s->>'skill' = 'welding.tig') = 3.0,
  'work proof: TIG welding on 2 days, 3 h photo span on the first day: ' || ((:'proof'::jsonb)->'skills')::text);
SELECT t_assert((:'proof'::jsonb)->'work_days_by_month' = '{"2023-03":1,"2023-05":1}'::jsonb, 'documented work days per month');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-00000000000b","role":"authenticated"}',false);
DO $$ BEGIN
  PERFORM photo_assets_read('10000000-0000-0000-0000-00000000000a');
  RAISE EXCEPTION 'expected refusal';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: another person cannot read the assets'; END $$;
DO $$ BEGIN
  PERFORM photo_work_proof_read('10000000-0000-0000-0000-00000000000a');
  RAISE EXCEPTION 'expected refusal';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: another person cannot read the work proof'; END $$;
SELECT t_assert((SELECT count(*) FROM assets) = 0 AND (SELECT count(*) FROM asset_observations) = 0, 'no table rows reach a signed-in caller directly');
RESET ROLE;

SELECT t_assert(NOT has_function_privilege('anon','photo_assets_read(uuid,text,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','photo_footprint_traces(uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','photo_work_proof_read(uuid,date,date)','EXECUTE')
  AND NOT has_function_privilege('anon','photo_asset_fold(uuid,text,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','photo_asset_fold(uuid,text,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','record_photo_work_readings(uuid,jsonb)','EXECUTE'), 'anon executes nothing; the fold and writer are service-only');
SELECT 'ALL PHOTO WORK LEDGER ASSERTIONS PASSED' AS result;
