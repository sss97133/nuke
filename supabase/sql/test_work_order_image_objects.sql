\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int/10000<>17
 OR to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Empty disposable PG17 required'; END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE work_orders(id uuid PRIMARY KEY,vehicle_id uuid);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,is_external boolean,vision_gate_status text,taken_at timestamptz);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind text,is_superseded boolean,source_id uuid,
 observed_at timestamptz,ingested_at timestamptz,extraction_method text,confidence_score numeric,structured_data jsonb);
CREATE TABLE equipment(id uuid PRIMARY KEY,name text,manufacturer text,model text,serial_number text,purchase_cost numeric,current_value_computed numeric,source text);
CREATE TABLE equipment_usage_evidence(id uuid PRIMARY KEY,equipment_id uuid,derived_from_image_id uuid,vehicle_id uuid,
 source_method text,confidence numeric,visible_state text,estimated_use_minutes integer);
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
CREATE FUNCTION t_assert(b boolean,n text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',n; END IF; RAISE NOTICE 'PASS: %',n; END $$;
CREATE FUNCTION t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
 BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
INSERT INTO work_orders VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO vehicle_images VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',false,'approved','2026-01-01'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',false,'approved',NULL);
INSERT INTO vehicle_observations VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','condition',false,'50000000-0000-0000-0000-000000000001',
 '2026-01-02','2026-01-03','fixture_vision',0.6,'{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000001","intent":"documentation","workshop_signals":{"tools_visible":["welder","welder"]},"components_seen":[{"label":"gas cylinder","bbox":[1,2,3,4],"confidence":0.7},42]}'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','condition',false,'50000000-0000-0000-0000-000000000001',
 '2026-01-04','2026-01-05','fixture_vision',0.6,'{"analysis_kind":"image_deep_byok","image_id":"30000000-0000-0000-0000-000000000002","workshop_signals":{"tools_visible":["welder"]},"components_seen":[]}');
INSERT INTO equipment VALUES ('60000000-0000-0000-0000-000000000001','Fixture welder',NULL,NULL,NULL,800,760,'photo_evidence_inferred');
INSERT INTO equipment_usage_evidence VALUES ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','legacy_cascade',0.7,'in_use',60);
\ir ../migrations/20261019031934_work_order_image_objects.sql
SET ROLE service_role;
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='5','all retained occurrences survive including repeated labels and malformed atoms');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')->>'job_attribution'='vehicle_context_only','vehicle match is not job usage');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')->>'physical_identity_resolution'='not_performed','same label is not a physical identity merge');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>'{frames,0,sightings,0,raw_claim}'='{"label":"gas cylinder","bbox":[1,2,3,4],"confidence":0.7}'::jsonb,'raw observation and coordinates retained');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>'{frames,0,sightings,1,label}'='null'::jsonb,'unlabelled atom is not invented or silently dropped');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{frames,0,sightings,2,sighting_key}'=
 '40000000-0000-0000-0000-000000000001:/workshop_signals/tools_visible/0','source and pointer form stable occurrence identity');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>'{frames,1,image_capture_at}'='null'::jsonb,'unknown capture clock stays unknown');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{frames,0,existing_equipment_associations,0,equipment_id}'='60000000-0000-0000-0000-000000000001','existing asset endpoint is connected');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>'{frames,0,existing_equipment_associations,0,amounts}'=
 '{"recorded_purchase_cost":800,"purchase_basis":"photo_evidence_inferred","computed_asset_value":760,"computed_value_basis":"existing_ledger_depreciation_formula","currency":"not_recorded_by_equipment_ledger","market_value":null,"job_cost":null,"labor_value":null}'::jsonb,'purchase cost computed asset value market value and labor value remain separate');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{frames,0,existing_equipment_associations,0,usage_accepted}'='false','legacy cascade minutes are qualified not adopted');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001') @> '{"cost_allocated":false,"labor_value_calculated":false,"payment_authorized":false}'::jsonb,'sightings accrue no cost labor or payment');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001',NULL,1)->>'next_after_observation_id'='40000000-0000-0000-0000-000000000001','bounded page exposes cursor');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1)#>>'{frames,0,observation_id}'='40000000-0000-0000-0000-000000000002','next page has no repeated observation');
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',1)#>>'{coverage,observations_returned}'='0','empty page does not invent sightings');
SELECT t_assert(t_refused($q$SELECT read_work_order_image_objects('10000000-0000-0000-0000-000000000001',NULL,101)$q$),'oversize pages refused');
SELECT t_assert(t_refused($q$SELECT read_work_order_image_objects('10000000-0000-0000-0000-000000000001',NULL,NULL)$q$),'null page size refused');
SELECT t_assert(t_refused($q$SELECT read_work_order_image_objects('10000000-0000-0000-0000-000000000099')$q$),'missing work order refused');
RESET ROLE;
UPDATE vehicle_observations SET is_superseded=true WHERE id='40000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','withdrawn analysis excludes its objects and associations');
UPDATE vehicle_observations SET is_superseded=false,vehicle_id='20000000-0000-0000-0000-000000000002' WHERE id='40000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','reattributed analysis excluded');
UPDATE vehicle_observations SET vehicle_id='20000000-0000-0000-0000-000000000001' WHERE id='40000000-0000-0000-0000-000000000001';
UPDATE vehicle_images SET vision_gate_status='pending' WHERE id='30000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','unapproved image excludes analysis');
UPDATE vehicle_images SET vision_gate_status='approved',is_external=true WHERE id='30000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','external image outside private shop evidence scope');
UPDATE vehicle_images SET is_external=false,vehicle_id='20000000-0000-0000-0000-000000000002' WHERE id='30000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','cross vehicle image cannot establish context');
UPDATE vehicle_images SET vehicle_id='20000000-0000-0000-0000-000000000001' WHERE id='30000000-0000-0000-0000-000000000001';
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{witness_image_id}','"30000000-0000-0000-0000-000000000002"') WHERE id='40000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','conflicting witness image refused');
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data-'witness_image_id','{image_id}','"invalid uuid"') WHERE id='40000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{coverage,sightings_returned}'='1','malformed image identifier cannot break page');
UPDATE vehicle_observations SET structured_data=jsonb_set(jsonb_set(structured_data,'{image_id}','"30000000-0000-0000-0000-000000000001"'),'{workshop_signals,tools_visible}','"bad shape"') WHERE id='40000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>>'{frames,0,retained_array_types,tools}'='string','malformed array shape remains visible without throwing');
UPDATE equipment_usage_evidence SET vehicle_id='20000000-0000-0000-0000-000000000002';
SELECT t_assert(read_work_order_image_objects('10000000-0000-0000-0000-000000000001')#>'{frames,0,existing_equipment_associations}'='[]'::jsonb,'cross vehicle equipment association excluded');
SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT read_work_order_image_objects('10000000-0000-0000-0000-000000000001')$q$),'anonymous reader refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused($q$SELECT read_work_order_image_objects('10000000-0000-0000-0000-000000000001')$q$),'unscoped authenticated reader refused');
RESET ROLE;
SELECT jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) AS implementation_hash
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_work_order_image_objects';
