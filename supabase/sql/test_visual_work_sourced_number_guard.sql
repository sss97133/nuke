-- Empty local fixture only. The four guard migrations against synthetic records shaped like the
-- priced lines read on the proof vehicle on 2026-11-12. No production observation is imported.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE subject_taxonomy(subject_key text PRIMARY KEY,category text,is_active boolean DEFAULT true);
INSERT INTO subject_taxonomy VALUES ('engine.block','engine',true);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,kind text,extraction_method text,
 structured_data jsonb,is_superseded boolean DEFAULT false,descriptor_id uuid,property_id uuid);
CREATE TABLE observation_witnesses(observation_id uuid REFERENCES vehicle_observations(id),image_id uuid,witness_role text);
CREATE TABLE catalog_parts(id uuid PRIMARY KEY,part_number text,price_current numeric,currency text,supplier_url text);
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,listing_url text);
INSERT INTO catalog_parts VALUES ('d1000000-0000-0000-0000-000000000001','14-4164',309.99,'USD','https://supplier.example/14-4164'),
 ('d1000000-0000-0000-0000-000000000002','NOPRICE',NULL,'USD',NULL);
INSERT INTO listing_page_snapshots VALUES ('e1000000-0000-0000-0000-000000000001','https://supplier.example/kit');
\ir ../migrations/20261113170000_visual_work_system_key_guard.sql
\ir ../migrations/20261114101000_visual_work_part_key_guard.sql
\ir ../migrations/20261116011000_visual_work_keyed_claim_citation_guard.sql
-- Before the fourth guard: a typed price, typed hours and a typed rate land, which is the gap.
INSERT INTO vehicle_observations(kind,extraction_method,structured_data) VALUES ('work_record','visual_work_v1',
 '{"rate_basis":{"kind":"explicit_assumption","rate":150,"currency":"USD","derivation":"x"},
   "materials":[{"system_key":"engine","part_key":"engine.block","pricing":{"kind":"analyst_range","currency":"USD","unit_price":{"min":309.99,"typical":309.99,"max":309.99},"derivation":"https://supplier.example/14-4164"}}],
   "operations":[{"system_key":"engine","part_key":"engine.block","reference":{"type":"analyst_range","hours":{"min":4,"typical":6,"max":10},"derivation":"x"}}]}');
\ir ../migrations/20261116020000_visual_work_sourced_number_guard.sql
CREATE FUNCTION pg_temp.try(p_doc jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.vehicle_observations(kind,extraction_method,structured_data) VALUES ('work_record','visual_work_v1',p_doc);
 RETURN 'admitted';
EXCEPTION WHEN check_violation THEN RETURN SQLERRM;
END $$;
CREATE FUNCTION pg_temp.mat(p_pricing jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('materials',jsonb_build_array(jsonb_build_object('system_key','engine','part_key','engine.block','pricing',p_pricing))) $$;
CREATE FUNCTION pg_temp.op(p_reference jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('operations',jsonb_build_array(jsonb_build_object('system_key','engine','part_key','engine.block','reference',p_reference))) $$;
DO $$ DECLARE r text; BEGIN
 ASSERT (SELECT count(*) FROM vehicle_observations)=1,'the stored row is left alone';
 -- The same record is refused, all three kinds named, with the legal moves in the message.
 r:=pg_temp.try((SELECT structured_data FROM vehicle_observations LIMIT 1));
 ASSERT r LIKE 'unsourced_number: 1 material prices with no stored source; 1 labor hour ranges typed as analyst_range; a typed hourly rate (rate_basis explicit_assumption).%'
  AND r LIKE '%catalog_part_id%' AND r LIKE '%resolved_default%',r;
 -- A material price that cites a catalog row with the same price and currency passes; so does a retained page.
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":309.99,"typical":309.99,"max":309.99},"derivation":"d","catalog_part_id":"d1000000-0000-0000-0000-000000000001"}'))='admitted';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":300,"typical":329.99,"max":350},"derivation":"d","source_snapshot_id":"e1000000-0000-0000-0000-000000000001"}'))='admitted';
 -- Not a citation: a different price, a range around the catalog price, another currency, a row with
 -- no price, an id no table holds, a text price, a URL alone.
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":299,"typical":299,"max":299},"derivation":"d","catalog_part_id":"d1000000-0000-0000-0000-000000000001"}')) LIKE 'unsourced_number: 1 material%';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":300,"typical":309.99,"max":320},"derivation":"d","catalog_part_id":"d1000000-0000-0000-0000-000000000001"}')) LIKE 'unsourced_number: 1 material%';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"EUR","unit_price":{"min":309.99,"typical":309.99,"max":309.99},"derivation":"d","catalog_part_id":"d1000000-0000-0000-0000-000000000001"}')) LIKE 'unsourced_number: 1 material%';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":1,"typical":1,"max":1},"derivation":"d","catalog_part_id":"d1000000-0000-0000-0000-000000000002"}')) LIKE 'unsourced_number: 1 material%';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":1,"typical":1,"max":1},"derivation":"d","source_snapshot_id":"e9000000-0000-0000-0000-000000000009"}')) LIKE 'unsourced_number: 1 material%';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":"309.99","typical":"309.99","max":"309.99"},"derivation":"d","catalog_part_id":"d1000000-0000-0000-0000-000000000001"}')) LIKE 'unsourced_number: 1 material%';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"analyst_range","currency":"USD","unit_price":{"min":1,"typical":1,"max":1},"derivation":"https://supplier.example/kit","catalog_part_id":"not-an-id"}')) LIKE 'unsourced_number: 1 material%';
 -- Kinds the check does not name are the cost fold's business: catalog, unpriced, and one not yet defined.
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"catalog","receipt_item_id":"f1000000-0000-0000-0000-000000000001"}'))='admitted';
 ASSERT pg_temp.try(pg_temp.mat('{"kind":"unpriced"}'))='admitted';
 ASSERT pg_temp.try(pg_temp.op('{"type":"labor_operation","operation_id":"x"}'))='admitted';
 ASSERT pg_temp.try(pg_temp.op('{"type":"stage_row","stage_map_id":"x"}'))='admitted';
 ASSERT pg_temp.try(pg_temp.op('{"type":"unpriced"}'))='admitted';
 ASSERT pg_temp.try(pg_temp.op('{"type":"fixed_service_fee","unit_fee":{"min":30,"typical":30,"max":30}}'))='admitted';
 -- Typed hours are refused whatever sentence stands behind them, and counted.
 ASSERT pg_temp.try('{"operations":[{"system_key":"engine","part_key":"engine.block","reference":{"type":"analyst_range","hours":{"min":1,"typical":2,"max":3},"derivation":"d"}},
   {"system_key":"engine","part_key":"engine.block","reference":{"type":"analyst_range","hours":{"min":1,"typical":2,"max":3},"derivation":"d"}}]}') LIKE 'unsourced_number: 2 labor hour ranges%';
 -- The rate: the owner's resolved answer or a report passes, a typed one does not.
 ASSERT pg_temp.try('{"rate_basis":{"kind":"resolved_default","currency":"USD","derivation":"d"}}')='admitted';
 ASSERT pg_temp.try('{"rate_basis":{"kind":"reported"}}')='admitted';
 ASSERT pg_temp.try('{"rate_basis":{"kind":"explicit_assumption","rate":150,"currency":"USD","derivation":"d"}}') LIKE 'unsourced_number: a typed hourly rate%';
 -- The earlier guards still speak first; other observations are not touched.
 ASSERT pg_temp.try('{"rate_basis":{"kind":"explicit_assumption"},"materials":[{"system_key":"brakes"}]}') LIKE 'unregistered_system_key: brakes.%';
 INSERT INTO vehicle_observations(kind,extraction_method,structured_data) VALUES ('media','reviewed_image_analysis_v1','{"rate_basis":{"kind":"explicit_assumption"}}');
 ASSERT NOT has_function_privilege('anon','public.visual_work_unsourced_numbers(jsonb)','execute');
END $$;
\echo visual work sourced number guard: ok
