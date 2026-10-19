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
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,request_source text,title text,description text,scope_description text,
 quoted_at timestamptz,estimated_total numeric,estimated_cost_cents integer,approved_at timestamptz,scheduled_start timestamptz,
 scheduled_end timestamptz,started_at timestamptz,actual_start timestamptz,completed_at timestamptz,actual_end timestamptz,status text,
 created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text);
CREATE TABLE public.component_events(id uuid PRIMARY KEY,vehicle_id uuid,work_order_id uuid,metadata jsonb);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY,work_order_id uuid,part_name text,status text,job_op_code text);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
 line_number integer,task_type text NOT NULL CHECK (task_type IN ('replace','inspect','install','clean','paint','adjust','other')),
 task_description text,actor_id uuid REFERENCES actors(id),hours_labor numeric,total_cost_cents integer,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','complete','rework','skipped','cancelled')),
 component_event_id uuid,notes text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.work_order_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text,
 accepted_at timestamptz,started_at timestamptz,completed_at timestamptz,actual_payout numeric,paid_at timestamptz,payout_status text);
CREATE TABLE public.work_order_labor(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,hours numeric,ai_estimated boolean);
CREATE TABLE public.work_order_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid);
CREATE TABLE public.work_order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text);
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope_type text,scope_id uuid,is_superseded boolean);
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
GRANT SELECT, UPDATE ON public.work_order_line_items TO authenticated;

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;

INSERT INTO work_orders(id,vehicle_id,title,description,status) VALUES
 ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Quote',
  E'SCOPE OF WORK:\n\nDRIVETRAIN:\n- Oil pan gasket replacement\n- U-joint inspection\n- Oil filter','quoted'),
 ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','Other',E'- Paint hood','quoted'),
 ('30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','Labor only','Shop duties','completed');
INSERT INTO work_order_labor(work_order_id,hours) VALUES ('30000000-0000-0000-0000-000000000003',3);

\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019045753_work_order_job_path.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql

-- Synthetic interpretations in the guarded disposable database only.
CREATE FUNCTION public.op_source(p_patch jsonb,p_vehicle uuid DEFAULT '40000000-0000-0000-0000-000000000001') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,confidence_score,structured_data)
 VALUES(k,p_vehicle,'work_record','90000000-0000-0000-0000-000000000001','2026-01-02','work_order_scope_operation_interpretation_v1',0.6,
 jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','operation',
 'work_order_id','30000000-0000-0000-0000-000000000001','line_number',1,'task_type','replace',
 'task_description','Oil pan gasket replacement','basis_field','description','basis_excerpt','Oil pan gasket replacement',
 'notes','Requested in work order scope text, section DRIVETRAIN')||p_patch));
 RETURN k; END $$;
CREATE FUNCTION public.refused(p_id uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT t_refused(format('SELECT project_work_order_resource_observation(%L)',p_id)) $$;
CREATE FUNCTION public.plan(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_work_order_job_path(p_wo)#>'{stages,plan}' $$;

SELECT op_source('{}') AS op1 \gset
SELECT op_source('{"line_number":2,"task_type":"inspect","task_description":"U-joint inspection","basis_excerpt":"U-joint inspection"}') AS op2 \gset
SELECT op_source('{"line_number":3,"task_type":"other","task_description":"Oil filter","basis_excerpt":"Oil filter"}') AS op3 \gset
SET ROLE service_role;
SELECT t_assert(plan()->'gaps' @> '["no_operations"]','unitemized quote has no operations');
SELECT project_work_order_resource_observation(:'op1');
SELECT t_assert((project_work_order_resource_observation(:'op1')->>'duplicate')::boolean,'operation replay is idempotent');
SELECT project_work_order_resource_observation(:'op2');
SELECT project_work_order_resource_observation(:'op3');
RESET ROLE;
SELECT t_assert((SELECT id=source_observation_id AND status='pending' AND actor_id IS NULL AND hours_labor IS NULL AND total_cost_cents IS NULL
 AND task_type='replace' AND task_description=basis_excerpt AND basis_field='description' AND line_number=1
 FROM work_order_line_items WHERE id=:'op1'),'requested operation is pending, unpriced, unassigned and verbatim');
SELECT t_assert((SELECT count(*) FROM work_order_line_items WHERE work_order_id='30000000-0000-0000-0000-000000000001')=3,'each quoted item becomes one operation');
SET ROLE service_role;
SELECT t_assert(plan() @> '{"state":"partial","operations":3,"operations_from_scope_text":3,"operations_pending":3,"inconsistencies":[]}'
 AND NOT plan()->'gaps' @> '["no_operations"]' AND plan()->'gaps' @> '["operations_without_requirements"]','job path counts sourced operations and their missing requirements');
RESET ROLE;

SELECT t_assert(refused(op_source('{"line_number":4,"task_description":"Transmission rebuild","basis_excerpt":"Transmission rebuild"}')),'item absent from the scope text refused');
SELECT t_assert(refused(op_source('{"line_number":4,"task_description":"Oil pan gasket"}')),'paraphrased operation text refused');
SELECT t_assert(refused(op_source('{"line_number":4,"basis_field":"notes"}')),'unknown scope field refused');
SELECT t_assert(refused(op_source('{"line_number":0}')),'non-positive line number refused');
SELECT t_assert(refused(op_source('{"line_number":1,"task_description":"U-joint inspection","basis_excerpt":"U-joint inspection"}')),'second source cannot take an existing line number');
SELECT t_assert(refused(op_source('{"line_number":4,"task_type":"teleport"}')),'task type outside the owner vocabulary refused');
SELECT t_assert(refused(op_source('{"line_number":4}','40000000-0000-0000-0000-000000000002')),'source for another vehicle refused');
SELECT t_assert(refused(op_source('{"line_number":4,"work_order_id":"30000000-0000-0000-0000-000000000002","task_description":"Paint hood","basis_excerpt":"Paint hood"}')),'work order on another vehicle refused');
SELECT op_source('{"line_number":5,"task_description":"U-joint inspection","basis_excerpt":"U-joint inspection"}') AS withdrawn \gset
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'withdrawn';
SELECT t_assert(refused(:'withdrawn'),'withdrawn source refused');

SELECT t_assert(t_refused($q$INSERT INTO work_order_line_items(id,work_order_id,task_type,task_description,source_observation_id,basis_field,basis_excerpt)
 VALUES ('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','other','Oil filter','70000000-0000-0000-0000-000000000001','description','Oil filter')$q$),'direct sourced insert without its observation refused');
SELECT op_source('{"line_number":9,"task_type":"other","task_description":"Oil filter","basis_excerpt":"Oil filter"}') AS direct \gset
SELECT t_assert(t_refused(format($q$INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,source_observation_id,basis_field,basis_excerpt)
 VALUES (%L,'30000000-0000-0000-0000-000000000001',9,'other','Oil filter',%L,'description','Oil pan gasket replacement')$q$,:'direct',:'direct')),'sourced insert must match its envelope');
INSERT INTO work_order_line_items(work_order_id,task_type,task_description) VALUES ('30000000-0000-0000-0000-000000000002','paint','Legacy hood paint');
UPDATE work_order_line_items SET task_description='Legacy hood paint and clear' WHERE work_order_id='30000000-0000-0000-0000-000000000002';
SELECT t_assert((SELECT task_description='Legacy hood paint and clear' FROM work_order_line_items WHERE work_order_id='30000000-0000-0000-0000-000000000002'),'unsourced legacy rows keep their existing behavior');

SET ROLE authenticated;
UPDATE work_order_line_items SET status='complete',updated_at=now() WHERE id=:'op2';
SELECT t_assert(t_refused(format($q$UPDATE work_order_line_items SET task_description='Rebuilt U-joints' WHERE id=%L$q$,:'op2')),'party cannot rewrite quoted operation text');
SELECT t_assert(t_refused(format($q$UPDATE work_order_line_items SET source_observation_id=NULL,basis_field=NULL,basis_excerpt=NULL WHERE id=%L$q$,:'op2')),'party cannot strip provenance');
RESET ROLE;
SELECT t_assert((SELECT status='complete' FROM work_order_line_items WHERE id=:'op2'),'party can still record progress on a sourced operation');
SELECT t_assert(t_refused(format($q$UPDATE work_order_line_items SET line_number=7 WHERE id=%L$q$,:'op1')),'sourced line number is immutable');

UPDATE vehicle_observations SET is_superseded=true WHERE id=:'op1';
UPDATE work_orders SET description=E'SCOPE OF WORK:\n- Oil pan gasket replacement\n- U-joint inspection' WHERE id='30000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT t_assert(plan()->'inconsistencies' @> '["operation_source_withdrawn","operation_excerpt_missing_from_scope"]','withdrawn source and edited scope text are reported');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'op3')),'replay refused once the excerpt left the scope text');
SELECT t_assert(plan('30000000-0000-0000-0000-000000000003')->'gaps' @> '["operations_only_in_labor_rows"]'
 AND NOT plan('30000000-0000-0000-0000-000000000003')->'gaps' @> '["no_operations"]','labor-task rows count as operations evidence');
SELECT t_assert((work_order_job_path_scoreboard()->>'work_orders')::int=3,'scoreboard still covers every work order');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM work_order_line_items WHERE source_observation_id IS NOT NULL)=3,'reported inconsistencies do not delete operations');
SET ROLE anon;
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'op2')),'anonymous projection refused');
RESET ROLE;
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('project_work_order_resource_observation','read_work_order_job_path','work_order_line_item_provenance_guard');
