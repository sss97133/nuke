-- Disposable PG17 only. Synthetic fixtures; exercises the actual migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY,work_order_id uuid REFERENCES work_orders(id));
CREATE TABLE public.user_tools(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.tool_inventory(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.equipment(id uuid PRIMARY KEY,shop_id uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind text,source_id uuid,
  content_text text,extraction_method text,confidence_score numeric,structured_data jsonb,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),is_superseded boolean DEFAULT false);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(),table_name text,column_name text,owned_by text,
  description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;

INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
INSERT INTO organizations VALUES ('20000000-0000-0000-0000-000000000001');
INSERT INTO work_orders VALUES
 ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');
INSERT INTO work_order_line_items VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
INSERT INTO user_tools VALUES ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO equipment VALUES ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,structured_data) VALUES
 ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-01',
 '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-000000000001","line_item_id":"50000000-0000-0000-0000-000000000001","requirement_kind":"tool","description":"Torque tool in the specified range","quantity":1,"unit":"tool"}}'),
 ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-02',
 '{"work_order_resource":{"version":1,"event_type":"fulfillment","work_order_id":"30000000-0000-0000-0000-000000000001","requirement_id":"80000000-0000-0000-0000-000000000001","supplier_user_id":"10000000-0000-0000-0000-000000000001","user_tool_id":"60000000-0000-0000-0000-000000000001"}}'),
 ('80000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-03',
 '{"work_order_resource":{"version":1,"event_type":"attestation","work_order_id":"30000000-0000-0000-0000-000000000001","fulfillment_id":"80000000-0000-0000-0000-000000000002","attestor_user_id":"10000000-0000-0000-0000-000000000002","attestation_kind":"suitability","verdict":"supports","scope":"Reported inspection of tool range and condition"}}'),
 ('80000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-04',
 '{"work_order_resource":{"version":1,"event_type":"fulfillment","work_order_id":"30000000-0000-0000-0000-000000000001","requirement_id":"80000000-0000-0000-0000-000000000001","supplier_organization_id":"20000000-0000-0000-0000-000000000001","equipment_id":"70000000-0000-0000-0000-000000000001","available_from":"2026-01-05T09:00:00Z","available_until":"2026-01-05T10:00:00Z"}}');

\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
SET ROLE service_role;
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->>'booking_readiness'='not_assessed','empty graph never means ready');
SELECT t_assert(t_refused($q$SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000002')$q$),'fulfillment before requirement refused');
SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000001');
SELECT t_assert((project_work_order_resource_observation('80000000-0000-0000-0000-000000000001')->>'duplicate')::boolean,'idempotent replay');
SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000002');
SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000003');
SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000004');
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'fulfillments')=2,'personal tool and shop alternative coexist');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->>'permission_authority'='not_assessed','third party suitability does not grant permission');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->>'capacity_reserved'='false','offers do not reserve resources');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->>'payment_authorized'='false','claims do not authorize payment');
SELECT t_assert((SELECT count(*) FROM work_order_resource_requirements)=1,'one row per source');
SELECT t_assert(t_refused($q$INSERT INTO work_order_resource_requirements SELECT * FROM work_order_resource_requirements LIMIT 1$q$),'service cannot bypass projection');
SELECT t_assert(t_refused($q$UPDATE work_order_resource_requirements SET description='changed'$q$),'service cannot overwrite');
RESET ROLE;

-- Malformed and adversarial source fixtures are confined to the disposable database.
CREATE FUNCTION public.bad_source(p_patch jsonb,p_kind text DEFAULT 'work_record',p_vehicle uuid DEFAULT '40000000-0000-0000-0000-000000000001')
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,structured_data)
 SELECT k,p_vehicle,p_kind,source_id,jsonb_build_object('work_order_resource',(structured_data->'work_order_resource')||p_patch)
 FROM vehicle_observations WHERE id='80000000-0000-0000-0000-000000000001'; RETURN k; END $$;
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"quantity":0}'))),'zero quantity refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"quantity":"NaN"}'))),'NaN quantity refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"version":2}'))),'unknown version refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"event_type":"book"}'))),'unknown event refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"line_item_id":"50000000-0000-0000-0000-000000000002"}'))),'cross order operation refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{}','comment'))),'non work source refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{}','work_record','40000000-0000-0000-0000-000000000002'))),'wrong vehicle refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"event_type":"fulfillment","requirement_id":"80000000-0000-0000-0000-000000000001","supplier_user_id":"10000000-0000-0000-0000-000000000001","user_tool_id":"60000000-0000-0000-0000-000000000001","equipment_id":"70000000-0000-0000-0000-000000000001"}'))),'multiple resource identity refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"event_type":"fulfillment","requirement_id":"80000000-0000-0000-0000-000000000001","supplier_user_id":"10000000-0000-0000-0000-000000000001","user_tool_id":"60000000-0000-0000-0000-000000000001","available_from":"2026-01-10","available_until":"2026-01-09"}'))),'reversed availability refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"event_type":"fulfillment","requirement_id":"80000000-0000-0000-0000-000000000001","supplier_organization_id":"20000000-0000-0000-0000-000000000001","facility_organization_id":"20000000-0000-0000-0000-000000000001"}'))),'a facility cannot stand in for a tool requirement');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"event_type":"fulfillment","requirement_id":"80000000-0000-0000-0000-000000000001","supplier_user_id":"10000000-0000-0000-0000-000000000001","user_tool_id":"60000000-0000-0000-0000-000000000099"}'))),'nonexistent inventory reference refused');
SELECT t_assert(t_refused($q$DELETE FROM work_order_resource_requirements$q$),'even owner cannot delete projection');
SELECT t_assert(t_refused($q$TRUNCATE work_order_resource_attestations$q$),'truncate refused');

UPDATE vehicle_observations SET is_superseded=true WHERE id='80000000-0000-0000-0000-000000000002';
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'fulfillments')=1,'withdrawn source hides its offer');
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'attestations')=0,'withdrawn offer hides dependent attestation');
SELECT t_assert(t_refused($q$SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000002')$q$),'duplicate cannot restore withdrawn source');
UPDATE vehicle_observations SET is_superseded=true WHERE id='80000000-0000-0000-0000-000000000001';
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'fulfillments')=0,'withdrawn requirement hides all alternatives');
SELECT t_assert((SELECT count(*) FROM work_order_resource_fulfillments)=2,'original projections retained');
SELECT t_assert(t_refused($q$SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000004')$q$),'duplicate cannot bypass withdrawn parent requirement');
UPDATE vehicle_observations SET is_superseded=false WHERE id='80000000-0000-0000-0000-000000000001';
UPDATE vehicle_observations SET vehicle_id='40000000-0000-0000-0000-000000000002' WHERE id='80000000-0000-0000-0000-000000000001';
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'requirements')=0,'reattributed requirement excluded');
SELECT t_assert(t_refused($q$SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000004')$q$),'reattributed parent prevents replay');

SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_resource_requirements$q$),'anonymous inventory graph inaccessible');
SELECT t_assert(t_refused($q$SELECT read_work_order_resources('30000000-0000-0000-0000-000000000001')$q$),'anonymous reader refused');
SELECT t_assert(t_refused($q$SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000001')$q$),'anonymous writer refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_resource_attestations$q$),'signed-in stranger cannot read attestations');
SELECT t_assert(t_refused($q$SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000001')$q$),'signed-in stranger cannot project');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM pipeline_registry WHERE owned_by='project_work_order_resource_observation')=3,'all three projection owners registered');

-- Synthetic fixtures only in the disposable PG17 database guarded above.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,content_text,observed_at,structured_data)
VALUES ('81000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record',NULL,
 'Need a calibrated torque tool before assembly.','2026-01-01','{}');
SELECT bad_source('{"quantity":null,"unit":null,"basis_observation_id":"81000000-0000-0000-0000-000000000001","basis_excerpt":"Need a calibrated torque tool before assembly."}') AS retained_req \gset
UPDATE vehicle_observations SET observed_at='2026-01-01',extraction_method='retained_work_resource_interpretation_v1',confidence_score=0.6 WHERE id=:'retained_req';
SET ROLE service_role;
SELECT project_work_order_resource_observation(:'retained_req');
SELECT t_assert((SELECT quantity IS NULL AND unit IS NULL FROM work_order_resource_requirements WHERE id=:'retained_req'),'unstated quantity remains unknown');
SELECT t_assert((read_work_order_resources('30000000-0000-0000-0000-000000000001')->'requirements'->0->>'basis_observation_id')='81000000-0000-0000-0000-000000000001','reader exposes exact retained basis');
SELECT t_assert((read_work_order_resources('30000000-0000-0000-0000-000000000001')->'requirements'->0->>'confidence_score')::numeric=0.6,'interpretation confidence exposed');
RESET ROLE;
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"quantity":null}'))),'unknown quantity with asserted unit refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"unit":null}'))),'asserted quantity with unknown unit refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"basis_observation_id":"81000000-0000-0000-0000-000000000001"}'))),'unquoted retained pointer refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_source('{"basis_excerpt":"Need a tool"}'))),'unattributed quote refused');
CREATE FUNCTION public.bad_retained_source(p_patch jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,structured_data)
 VALUES(k,'40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-01',
 jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement',
 'work_order_id','30000000-0000-0000-0000-000000000001','line_item_id','50000000-0000-0000-0000-000000000001',
 'requirement_kind','tool','description','Reported need for a torque tool','quantity',NULL,'unit',NULL,
 'basis_observation_id','81000000-0000-0000-0000-000000000001','basis_excerpt','Need a calibrated torque tool before assembly.')||p_patch));
 RETURN k; END $$;
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_retained_source('{"basis_excerpt":"A different statement"}'))),'invented quotation refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_retained_source('{"basis_excerpt":" "}'))),'blank quotation refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_retained_source('{"basis_observation_id":"81000000-0000-0000-0000-000000000099"}'))),'missing original refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',bad_retained_source(jsonb_build_object('basis_observation_id',:'retained_req')))),'nested resource interpretation refused');
SELECT bad_retained_source('{}') AS bad_clock \gset
UPDATE vehicle_observations SET observed_at='2026-01-02' WHERE id=:'bad_clock';
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'bad_clock')),'replacement clock refused');
SELECT bad_retained_source('{}') AS self_basis \gset
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{work_order_resource,basis_observation_id}',to_jsonb(id::text)) WHERE id=:'self_basis';
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'self_basis')),'self citation refused');
SELECT bad_source(jsonb_build_object('event_type','fulfillment','requirement_id',:'retained_req',
 'supplier_user_id','10000000-0000-0000-0000-000000000001','user_tool_id','60000000-0000-0000-0000-000000000001')) AS retained_offer \gset
SELECT project_work_order_resource_observation(:'retained_offer');
SELECT bad_source(jsonb_build_object('event_type','attestation','fulfillment_id',:'retained_offer',
 'attestor_user_id','10000000-0000-0000-0000-000000000002','attestation_kind','suitability','verdict','supports','scope','Reported tool range check')) AS retained_attest \gset
SELECT project_work_order_resource_observation(:'retained_attest');
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'attestations')=1,'retained-source requirement supports full evidence chain');
UPDATE vehicle_observations SET is_superseded=true WHERE id='81000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'requirements'='[]'::jsonb,'original withdrawal hides derived requirement');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'fulfillments'='[]'::jsonb,'original withdrawal hides derived offer');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'attestations'='[]'::jsonb,'original withdrawal hides derived attestation');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'retained_req')),'withdrawn original blocks requirement replay');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'retained_offer')),'withdrawn original blocks offer replay');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'retained_attest')),'withdrawn original blocks attestation replay');
SELECT t_assert((SELECT count(*) FROM work_order_resource_requirements WHERE id=:'retained_req')=1,'withdrawal preserves historical projection');
UPDATE vehicle_observations SET is_superseded=false,vehicle_id='40000000-0000-0000-0000-000000000002' WHERE id='81000000-0000-0000-0000-000000000001';
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'requirements'='[]'::jsonb,'original reattribution hides derived graph');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'retained_offer')),'cross-vehicle original blocks dependent replay');
