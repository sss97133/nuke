-- Empty local fixture only. The four guard migrations and the report against synthetic records
-- shaped like the proof vehicle's. No production observation is imported.
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
 structured_data jsonb,is_superseded boolean DEFAULT false,descriptor_id uuid,property_id uuid,ingested_at timestamptz DEFAULT now());
CREATE TABLE observation_witnesses(observation_id uuid REFERENCES vehicle_observations(id),image_id uuid,witness_role text);
CREATE TABLE catalog_parts(id uuid PRIMARY KEY,part_number text,price_current numeric,currency text,supplier_url text);
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,listing_url text,success boolean NOT NULL DEFAULT false,html_sha256 text);
-- Vehicle a1: one keyed claim on photo b1. Records written before the gate existed:
--   r1 clean and connected; r2 fails all four; r3 superseded; r4 another vehicle's; r5 declares a draft.
INSERT INTO vehicle_observations(id,vehicle_id,kind,extraction_method,descriptor_id) VALUES
 ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1',gen_random_uuid());
INSERT INTO observation_witnesses VALUES ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','derived');
INSERT INTO vehicle_observations(id,vehicle_id,kind,extraction_method,is_superseded,structured_data) VALUES
 ('d1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',false,
  '{"title":"Clean","visual_sources":[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000001"]}],
    "rate_basis":{"kind":"resolved_default","currency":"USD","derivation":"d"},
    "materials":[{"system_key":"engine","part_key":"engine.block","pricing":{"kind":"unpriced"}}]}'),
 ('d1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',false,
  '{"title":"Brakes cost basis","visual_sources":[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c"}],
    "rate_basis":{"kind":"explicit_assumption","rate":150,"currency":"USD","derivation":"d"},
    "materials":[{"system_key":"brakes","pricing":{"kind":"analyst_range","currency":"USD","unit_price":{"min":1,"typical":1,"max":1},"derivation":"d"}}],
    "operations":[{"system_key":"brakes","reference":{"type":"analyst_range","hours":{"min":1,"typical":2,"max":3},"derivation":"d"}}]}'),
 ('d1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',true,
  '{"title":"Superseded","materials":[{"system_key":"brakes"}]}'),
 ('d1000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000002','work_record','visual_work_v1',false,
  '{"title":"Other vehicle","materials":[{"system_key":"brakes"}]}'),
 ('d1000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',false,
  '{"title":"Draft declared","materials":[{"system_key":"cooling","part_key":"engine.radiator","pricing":{"kind":"unpriced"}}],
    "key_proposals":[{"kind":"system","key":"cooling","nearest_existing":"engine","reason":"r"},{"kind":"part","key":"engine.radiator","nearest_existing":"none","reason":"r"}]}');
\ir ../migrations/20261113170000_visual_work_system_key_guard.sql
\ir ../migrations/20261114101000_visual_work_part_key_guard.sql
\ir ../migrations/20261116011000_visual_work_keyed_claim_citation_guard.sql
\ir ../migrations/20261116020000_visual_work_sourced_number_guard.sql
\ir ../migrations/20261116040000_visual_work_gate_report.sql
DO $$ DECLARE j jsonb; f jsonb; BEGIN
 j:=public.visual_work_gate_report('a1000000-0000-0000-0000-000000000001');
 -- Current records of this vehicle only: three, of which one fails.
 ASSERT (j->>'records')::int=3 AND (j->>'passing')::int=2 AND (j->>'failing')::int=1,j::text;
 ASSERT j->'failing_by_check'='{"unregistered_system_key":1,"unregistered_part_key":1,"uncited_keyed_claim":1,"unsourced_number":1}'::jsonb,j::text;
 -- A declared draft passes the gate and is still counted as a wait.
 ASSERT (j->>'declared_drafts')::int=2,j::text;
 ASSERT j->>'logic_version'='visual_work_gate_report/20261116040000' AND j->>'vehicle_id'='a1000000-0000-0000-0000-000000000001';
 -- The failing record names exactly what the trigger would name.
 ASSERT jsonb_array_length(j->'failing_records')=1;
 f:=j#>'{failing_records,0}';
 ASSERT f->>'observation_id'='d1000000-0000-0000-0000-000000000002' AND f->>'title'='Brakes cost basis',f::text;
 ASSERT f->'unregistered_system_key'='["brakes"]'::jsonb AND f->'unregistered_part_key'='["(no part_key on 2 cost lines)"]'::jsonb,f::text;
 ASSERT f->'uncited_keyed_claim'='["b1000000-0000-0000-0000-000000000001"]'::jsonb,f::text;
 ASSERT f->'unsourced_number'='["1 material prices with no stored source","1 labor hour ranges typed as analyst_range","a typed hourly rate (rate_basis explicit_assumption)"]'::jsonb,f::text;
 -- The report and the gate agree: the failing record is refused on insert, the passing ones admitted.
 BEGIN
  INSERT INTO vehicle_observations(vehicle_id,kind,extraction_method,structured_data)
   SELECT vehicle_id,kind,extraction_method,structured_data FROM vehicle_observations WHERE id='d1000000-0000-0000-0000-000000000002';
  ASSERT false,'the gate should refuse what the report calls failing';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO vehicle_observations(vehicle_id,kind,extraction_method,structured_data,is_superseded)
  SELECT vehicle_id,kind,extraction_method,structured_data,true FROM vehicle_observations WHERE id IN ('d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000005');
 -- A vehicle with no work record: zeros and an empty list, not null.
 j:=public.visual_work_gate_report('a9000000-0000-0000-0000-000000000009');
 ASSERT (j->>'records')::int=0 AND (j->>'passing')::int=0 AND j->'failing_records'='[]'::jsonb AND (j->>'declared_drafts')::int=0,j::text;
 ASSERT NOT has_function_privilege('anon','public.visual_work_gate_report(uuid)','execute')
  AND NOT has_function_privilege('authenticated','public.visual_work_gate_report(uuid)','execute')
  AND has_function_privilege('service_role','public.visual_work_gate_report(uuid)','execute');
END $$;
\echo visual work gate report: ok
