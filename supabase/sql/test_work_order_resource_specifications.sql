-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid);
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text);
CREATE TABLE public.component_events(id uuid PRIMARY KEY,vehicle_id uuid,work_order_id uuid REFERENCES work_orders(id),
 event_type text,description text,metadata jsonb,updated_at timestamptz);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY,work_order_id uuid REFERENCES work_orders(id),line_number integer,
 actor_id uuid REFERENCES actors(id),task_description text,component_event_id uuid REFERENCES component_events(id),updated_at timestamptz);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY,work_order_id uuid REFERENCES work_orders(id),part_name text,
 status text,unit_price numeric,notes text,updated_at timestamptz);
CREATE TYPE public.observation_kind AS ENUM ('valuation','condition','specification','work_record');
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE,category text,
 supported_observations public.observation_kind[],updated_at timestamptz);
INSERT INTO observation_sources VALUES ('90000000-0000-0000-0000-000000000001','internal-inference','internal',
 ARRAY['valuation','condition','specification']::public.observation_kind[],now());
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

INSERT INTO work_orders VALUES
 ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');
INSERT INTO component_events VALUES
 ('c0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
  'installed','Synthetic exhaust operation','{"material":"16ga mild steel","welding_type":"mig","outlet_od_inches":3}','2026-01-03T12:00:00Z');
INSERT INTO work_order_line_items(id,work_order_id,task_description,component_event_id) VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Exhaust piping','c0000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Headers',NULL);
INSERT INTO work_order_parts VALUES
 ('d0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2.5in 304 SS Mandrel Elbow','installed',10,NULL,'2026-01-02'),
 ('d0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Hanger Rod SS 3/8in','installed',5,NULL,'2026-01-02'),
 ('d0000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','SS TIG Welding Rods ER308L','installed',20,NULL,'2026-01-02'),
 ('d0000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','2.5in SS T304 Straight Pipe','quoted',30,NULL,'2026-01-02'),
 ('d0000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','304 SS Step Bracket','cancelled',8,NULL,'2026-01-02'),
 ('d0000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000002','304 SS Elbow','installed',10,NULL,'2026-01-02');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,content_text,observed_at,structured_data) VALUES
 ('81000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record',NULL,
  'For the exhaust I would do 304 stainless custom exhaust tig welded.','2026-01-01','{}');

\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql
\ir ../migrations/20261019094500_work_order_quotes.sql
\ir ../migrations/20261019120000_work_order_quote_issue.sql
\ir ../migrations/20261019123000_work_order_job_path_quotes.sql
\ir ../migrations/20261019180000_work_order_offers.sql

-- Synthetic interpretations in the guarded disposable database only.
CREATE FUNCTION public.spec_source(p_envelope jsonb,p_observed timestamptz DEFAULT '2026-01-04') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,confidence_score,structured_data)
 VALUES(k,'40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',p_observed,
 'retained_work_specification_interpretation_v1',0.6,
 jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','specification',
 'work_order_id','30000000-0000-0000-0000-000000000001')||p_envelope));
 RETURN k; END $$;
CREATE FUNCTION public.requested(p_patch jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql AS $$
 SELECT spec_source(jsonb_build_object('specification_stage','requested','line_item_id','50000000-0000-0000-0000-000000000001',
 'material_role','workpiece','material_label','304 stainless','material_key','stainless_steel.304',
 'process_label','tig','process_key','welding.tig','basis_observation_id','81000000-0000-0000-0000-000000000001',
 'basis_excerpt','304 stainless custom exhaust tig welded')||p_patch,'2026-01-01') $$;
CREATE FUNCTION public.performed(p_patch jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql AS $$
 SELECT spec_source(jsonb_build_object('specification_stage','reported_performed','line_item_id','50000000-0000-0000-0000-000000000001',
 'material_role','workpiece','material_label','16ga mild steel','material_key','mild_steel',
 'process_label','mig','process_key','welding.mig','basis_component_event_id',ce.id,'basis_snapshot',to_jsonb(ce))||p_patch)
 FROM component_events ce WHERE ce.id='c0000000-0000-0000-0000-000000000001' $$;
CREATE FUNCTION public.part_spec(p_part uuid,p_patch jsonb) RETURNS uuid LANGUAGE sql AS $$
 SELECT spec_source(jsonb_build_object('specification_stage','supplied','basis_work_order_part_id',p.id,'basis_snapshot',to_jsonb(p))||p_patch)
 FROM work_order_parts p WHERE p.id=p_part $$;
CREATE FUNCTION public.spec(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM jsonb_array_elements(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'specifications') x WHERE x->>'id'=p_id::text $$;
CREATE FUNCTION public.cmp(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM jsonb_array_elements(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'specification_comparisons') x WHERE x->>'compared_id'=p_id::text $$;
CREATE FUNCTION public.summary() RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_work_order_resources('30000000-0000-0000-0000-000000000001')->'specification_summaries'->0 $$;

SELECT requested() AS req \gset
SELECT performed() AS perf \gset
SELECT part_spec('d0000000-0000-0000-0000-000000000001','{"material_role":"workpiece","material_label":"304 SS","material_key":"stainless_steel.304"}') AS graded \gset
SELECT part_spec('d0000000-0000-0000-0000-000000000002','{"material_role":"workpiece","material_label":"SS","material_key":"stainless_steel"}') AS ungraded \gset
SELECT part_spec('d0000000-0000-0000-0000-000000000003','{"material_role":"filler","material_label":"ER308L","material_key":"stainless_filler.er308l","process_label":"TIG","process_key":"welding.tig"}') AS filler \gset
SELECT part_spec('d0000000-0000-0000-0000-000000000004','{"specification_stage":"proposed","material_role":"workpiece","material_label":"T304","material_key":"stainless_steel.304"}') AS quoted \gset
SET ROLE service_role;
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'specifications'='[]'::jsonb,'no projection means no specification claim');
SELECT project_work_order_resource_observation(:'req');
SELECT t_assert((project_work_order_resource_observation(:'req')->>'duplicate')::boolean,'specification replay is idempotent');
SELECT project_work_order_resource_observation(:'perf');
SELECT project_work_order_resource_observation(:'graded');
SELECT project_work_order_resource_observation(:'ungraded');
SELECT project_work_order_resource_observation(:'filler');
SELECT project_work_order_resource_observation(:'quoted');
SELECT t_assert(jsonb_array_length(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'specifications')=6,'every supported claim is retained, including repeats of one material');
SELECT t_assert(spec(:'req') @> '{"specification_stage":"requested","basis_kind":"retained_excerpt","scope":"operation","basis_observation_id":"81000000-0000-0000-0000-000000000001"}'::jsonb
 AND (spec(:'req')->>'confidence_score')::numeric=0.6 AND spec(:'req')->>'extraction_method'='retained_work_specification_interpretation_v1','requested pair keeps quote, method and confidence');
SELECT t_assert(spec(:'graded') @> '{"basis_kind":"work_order_part_record","scope":"work_order_scope"}'::jsonb AND spec(:'graded')->>'line_item_id' IS NULL,'part supply stays work-order scoped');
SELECT t_assert(NOT (spec(:'graded') ? 'basis_snapshot') AND NOT (spec(:'graded') ? 'unit_price'),'reader does not republish part record amounts');
SELECT t_assert(cmp(:'perf') @> '{"operation_link":"same_operation","material_relation":"different","process_relation":"different"}'::jsonb,'reported mild steel/MIG differs from requested 304/TIG as a pair');
SELECT t_assert(cmp(:'graded') @> '{"operation_link":"work_order_scope_unallocated","material_relation":"same","process_relation":"not_stated"}'::jsonb,'graded part matches material without asserting process');
SELECT t_assert(cmp(:'ungraded')->>'material_relation'='unresolved_specificity','ungraded stainless is not called a different material');
SELECT t_assert(cmp(:'filler') @> '{"material_relation":"different_role_not_compared","process_relation":"same"}'::jsonb,'filler is not compared with workpiece material');
SELECT t_assert(cmp(:'quoted') @> '{"compared_stage":"proposed","material_relation":"same"}'::jsonb,'quoted part is a proposal, not supply');
SELECT t_assert(summary() @> '{"status":"conflicting_evidence","compared_claims":5,"substitution_approval":"not_established","scope_change_accepted":"not_established","qualification":"not_assessed","completion":"not_established"}'::jsonb,'conflict is reported without adjudicating competence or substitution');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->'coverage' @> '{"recorded_specifications":6,"requested_specifications":1,"requested_specifications_compared":1,"specification_population":"not_assessed"}'::jsonb,'coverage names its scope');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001') @> '{"booking_readiness":"not_assessed","capacity_reserved":false,"payment_authorized":false}'::jsonb,'specifications do not book or authorize payment');
SET TimeZone = 'America/Los_Angeles';
SELECT t_assert(spec(:'perf') IS NOT NULL AND (project_work_order_resource_observation(:'perf')->>'duplicate')::boolean,'snapshot custody does not depend on the caller time zone');
SET TimeZone = 'UTC';
SELECT t_assert(t_refused($q$UPDATE work_order_resource_specifications SET material_key='mild_steel'$q$),'service cannot overwrite a specification');
SELECT t_assert(t_refused($q$INSERT INTO work_order_resource_specifications SELECT * FROM work_order_resource_specifications LIMIT 1$q$),'service cannot bypass projection');
RESET ROLE;
SELECT t_assert(t_refused($q$DELETE FROM work_order_resource_specifications$q$),'even owner cannot delete specification');
SELECT t_assert(t_refused($q$TRUNCATE work_order_resource_specifications$q$),'truncate refused');

CREATE FUNCTION public.refused(p_id uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT t_refused(format('SELECT project_work_order_resource_observation(%L)',p_id)) $$;
SELECT t_assert(refused(requested('{"material_label":"mild steel","material_key":"mild_steel"}')),'requested label absent from the quote refused');
SELECT t_assert(refused(requested('{"basis_excerpt":"316 stainless"}')),'invented excerpt refused');
SELECT t_assert(refused(spec_source('{"specification_stage":"requested","material_role":"workpiece","material_label":"304 stainless","material_key":"stainless_steel.304","basis_observation_id":"81000000-0000-0000-0000-000000000001","basis_excerpt":"304 stainless"}')),'requested claim with a later clock refused');
SELECT t_assert(refused(requested('{"basis_snapshot":{}}')),'excerpt basis with record snapshot refused');
SELECT t_assert(refused(requested('{"basis_work_order_part_id":"d0000000-0000-0000-0000-000000000001"}')),'two bases refused');
SELECT t_assert(refused(spec_source('{"specification_stage":"supplied","material_role":"workpiece","material_label":"SS","material_key":"stainless_steel"}')),'claim without basis refused');
SELECT t_assert(refused(requested('{"material_role":null}')),'material without role refused');
SELECT t_assert(refused(requested('{"material_key":"Stainless Steel"}')),'unnormalized key refused');
SELECT t_assert(refused(requested('{"material_label":null,"material_key":null,"material_role":null,"process_label":null,"process_key":null}')),'empty specification refused');
SELECT t_assert(refused(requested('{"specification_stage":"approved"}')),'unknown stage refused');
SELECT t_assert(refused(requested('{"line_item_id":"50000000-0000-0000-0000-000000000099"}')),'operation outside the order refused');
SELECT t_assert(refused(performed('{"material_label":"mild steel"}')),'partial event value is not a recorded label');
SELECT t_assert(refused(performed('{"process_label":"tig"}')),'process absent from the event refused');
SELECT t_assert(refused(performed('{"line_item_id":"50000000-0000-0000-0000-000000000002"}')),'event cannot describe a different operation');
SELECT t_assert(refused(performed('{"basis_snapshot":{"id":"c0000000-0000-0000-0000-000000000001"}}')),'changed event snapshot refused');
SELECT t_assert(refused(performed('{"specification_stage":"supplied","line_item_id":null}')),'event basis records performance only');
SELECT t_assert(refused(part_spec('d0000000-0000-0000-0000-000000000001','{"line_item_id":"50000000-0000-0000-0000-000000000001","material_role":"workpiece","material_label":"304 SS","material_key":"stainless_steel.304"}')),'part cannot be assigned to an operation by inference');
SELECT t_assert(refused(part_spec('d0000000-0000-0000-0000-000000000005','{"material_role":"workpiece","material_label":"304 SS","material_key":"stainless_steel.304"}')),'cancelled part is not supply');
SELECT t_assert(refused(part_spec('d0000000-0000-0000-0000-000000000001','{"specification_stage":"proposed","material_role":"workpiece","material_label":"304 SS","material_key":"stainless_steel.304"}')),'installed part is not a proposal');
SELECT t_assert(refused(part_spec('d0000000-0000-0000-0000-000000000006','{"material_role":"workpiece","material_label":"304 SS","material_key":"stainless_steel.304"}')),'part from another work order refused');
SELECT t_assert(refused(part_spec('d0000000-0000-0000-0000-000000000002','{"material_role":"workpiece","material_label":"304","material_key":"stainless_steel.304"}')),'grade absent from part record refused');
SELECT t_assert(refused(part_spec('d0000000-0000-0000-0000-000000000001','{"specification_stage":"requested","material_role":"workpiece","material_label":"304 SS","material_key":"stainless_steel.304"}')),'part record cannot state a request');

-- Changed or withdrawn bases withhold derived claims; history remains.
UPDATE work_order_parts SET notes='edited' WHERE id='d0000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT t_assert(spec(:'graded') IS NULL AND cmp(:'graded') IS NULL,'changed part record withholds its claim');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'graded')),'duplicate cannot restore stale part claim');
SELECT t_assert(spec(:'ungraded') IS NOT NULL,'independent part claims survive');
RESET ROLE;
UPDATE component_events SET description='revised' WHERE id='c0000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT t_assert(spec(:'perf') IS NULL,'revised operation record withholds reported pair');
SELECT t_assert(summary()->>'status'='consistent' AND (summary()->>'compared_claims')::int=3,'summary follows current evidence only');
RESET ROLE;
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'filler';
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'quoted';
SET ROLE service_role;
SELECT t_assert(summary()->>'status'='unresolved','only ungraded evidence leaves the comparison unresolved');
RESET ROLE;
UPDATE vehicle_observations SET is_superseded=true WHERE id='81000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT t_assert(spec(:'req') IS NULL AND read_work_order_resources('30000000-0000-0000-0000-000000000001')->'specification_summaries'='[]'::jsonb,'withdrawn original hides requested pair and its comparison');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'req')),'withdrawn original blocks replay');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM work_order_resource_specifications)=6,'withheld claims are retained');
UPDATE vehicle_observations SET is_superseded=false WHERE id='81000000-0000-0000-0000-000000000001';
UPDATE vehicle_observations SET vehicle_id='40000000-0000-0000-0000-000000000002' WHERE id=:'ungraded';
SET ROLE service_role;
SELECT t_assert(spec(:'ungraded') IS NULL,'reattributed source excluded');
RESET ROLE;

SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_resource_specifications$q$),'anonymous specifications inaccessible');
SELECT t_assert(t_refused($q$SELECT read_work_order_resources('30000000-0000-0000-0000-000000000001')$q$),'anonymous reader refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_resource_specifications$q$),'signed-in stranger cannot read specifications');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'req')),'signed-in stranger cannot project');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM pipeline_registry WHERE owned_by='project_work_order_resource_observation')=4,'specification owner registered');
SELECT t_assert((SELECT count(*) FROM information_schema.columns c JOIN pg_class t ON t.relname=c.table_name
 WHERE c.table_name='work_order_resource_specifications' AND col_description(t.oid,c.ordinal_position::int) IS NULL)=0,'every column described');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('project_work_order_resource_observation','read_work_order_resources');
