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
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,request_source text,customer_name text,customer_phone text,
 title text,description text,scope_description text,quoted_at timestamptz,estimated_total numeric,estimated_cost_cents integer,
 approved_at timestamptz,scheduled_start timestamptz,scheduled_end timestamptz,started_at timestamptz,actual_start timestamptz,
 completed_at timestamptz,actual_end timestamptz,status text,created_at timestamptz DEFAULT '2026-01-01',scope_category text);
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text);
CREATE TABLE public.component_events(id uuid PRIMARY KEY,vehicle_id uuid,work_order_id uuid,metadata jsonb);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY,work_order_id uuid,part_name text,status text,job_op_code text,unit_price numeric);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY,work_order_id uuid REFERENCES work_orders(id),line_number integer,
 actor_id uuid REFERENCES actors(id),task_description text,component_event_id uuid,status text,updated_at timestamptz);
CREATE TABLE public.work_order_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text,
 accepted_at timestamptz,started_at timestamptz,completed_at timestamptz,actual_payout numeric,paid_at timestamptz,payout_status text);
CREATE TABLE public.work_order_labor(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,hours numeric,ai_estimated boolean,total_cost numeric);
CREATE TABLE public.work_order_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,new_status text);
CREATE TABLE public.work_order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,amount numeric,status text);
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope_type text,scope_id uuid,amount_usd numeric,is_superseded boolean);
CREATE TYPE public.observation_kind AS ENUM ('valuation','condition','specification','work_record');
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE,category text,
 supported_observations public.observation_kind[],updated_at timestamptz);
INSERT INTO observation_sources VALUES ('90000000-0000-0000-0000-000000000001','internal-inference','internal',
 ARRAY['valuation','condition','specification']::public.observation_kind[],now());
CREATE TABLE public.user_tools(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.tool_inventory(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.equipment(id uuid PRIMARY KEY,shop_id uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind text,source_id uuid,
  content_text text,extraction_method text,confidence_score numeric,structured_data jsonb,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),is_superseded boolean DEFAULT false,source_identifier text);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(),table_name text,column_name text,owned_by text,
  description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;

-- A: vehicle job with inspection, unlinked part, unclocked acceptance, paid status but no payment record.
-- B: no vehicle, payments recorded. C: approved, accepted with clock, started and completed with clocks.
INSERT INTO work_orders(id,vehicle_id,request_source,customer_name,customer_phone,title,estimated_total,status) VALUES
 ('30000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','sms','Fixture Customer','+15550100','Brake job',100,'paid'),
 ('30000000-0000-0000-0000-00000000000b',NULL,'walk_in','Other Customer',NULL,'Paint',NULL,'completed');
INSERT INTO work_orders(id,vehicle_id,title,quoted_at,approved_at,scheduled_start,scheduled_end,started_at,completed_at,status) VALUES
 ('30000000-0000-0000-0000-00000000000c','40000000-0000-0000-0000-000000000002','Exhaust','2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-03','2026-01-04','completed');
INSERT INTO work_order_line_items(id,work_order_id,status) VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-00000000000a','complete'),
 ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-00000000000a',NULL),
 ('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-00000000000c','complete');
INSERT INTO component_events VALUES ('c0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-00000000000c','{}');
INSERT INTO work_order_parts VALUES
 ('d0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-00000000000a','Pads','installed',NULL,40),
 ('d0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-00000000000a','Fluid','installed','BRAKE-1',10),
 ('d0000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-00000000000a','Rotor','quoted',NULL,90);
INSERT INTO work_order_assignments(work_order_id,status,accepted_at,started_at,completed_at,payout_status) VALUES
 ('30000000-0000-0000-0000-00000000000a','accepted',NULL,NULL,NULL,'pending_client_payment'),
 ('30000000-0000-0000-0000-00000000000a','completed',NULL,NULL,NULL,'pending_client_payment'),
 ('30000000-0000-0000-0000-00000000000c','completed','2026-01-02','2026-01-03','2026-01-04','pending');
INSERT INTO work_order_labor(work_order_id,hours,ai_estimated,total_cost) VALUES
 ('30000000-0000-0000-0000-00000000000a',2,true,300),('30000000-0000-0000-0000-00000000000a',NULL,false,NULL);
INSERT INTO work_order_status_history(work_order_id,new_status) VALUES ('30000000-0000-0000-0000-00000000000c','completed');
INSERT INTO work_order_payments(work_order_id,amount,status) VALUES
 ('30000000-0000-0000-0000-00000000000b',50,'completed'),('30000000-0000-0000-0000-00000000000b',25,'completed');
INSERT INTO payment_events(scope_type,scope_id,amount_usd,is_superseded) VALUES
 ('vehicle','40000000-0000-0000-0000-000000000001',100,false),('vehicle','40000000-0000-0000-0000-000000000001',100,true);
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,structured_data) VALUES
 ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-01',
 '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-00000000000a","line_item_id":"50000000-0000-0000-0000-000000000001","requirement_kind":"inspection","description":"Road test after brake bleed","quantity":null,"unit":null}}');

\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019045753_work_order_job_path.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql
\ir ../migrations/20261019094500_work_order_quotes.sql
\ir ../migrations/20261019120000_work_order_quote_issue.sql
\ir ../migrations/20261019123000_work_order_job_path_quotes.sql
\ir ../migrations/20261019150000_inspection_request.sql
\ir ../migrations/20261019153000_job_path_inspection.sql

SET ROLE service_role;
SELECT project_work_order_resource_observation('80000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE pa AS SELECT read_work_order_job_path('30000000-0000-0000-0000-00000000000a') p;
CREATE TEMP TABLE pb AS SELECT read_work_order_job_path('30000000-0000-0000-0000-00000000000b') p;
CREATE TEMP TABLE pc AS SELECT read_work_order_job_path('30000000-0000-0000-0000-00000000000c') p;
SELECT t_assert((SELECT p#>>'{stages,intake,state}'='recorded' FROM pa),'vehicle and scope make intake recorded');
SELECT t_assert((SELECT p#>'{stages,intake}' @> '{"state":"partial","gaps":["no_vehicle"]}' FROM pb),'missing vehicle leaves intake partial');
SELECT t_assert((SELECT p#>'{stages,inspection}' @> '{"state":"recorded","inspection_requirements":1,"with_performer_candidate":0,"gaps":["inspection_performer_unresolved"]}' FROM pa),'inspection requirement recorded with unresolved performer');
SELECT t_assert((SELECT p#>'{stages,plan}' @> '{"state":"partial","operations":2,"operations_with_requirements":1,"parts":3,"parts_with_operation_code":1,"parts_by_status":{"installed":2,"quoted":1},"labor_rows":2,"labor_rows_with_hours":1,"labor_rows_ai_estimated":1,"executable":"not_assessed"}' FROM pa),'plan counts existing owners without inferring executability');
SELECT t_assert((SELECT p#>'{stages,plan,gaps}' @> '["operations_without_requirements","parts_without_operation_link"]' FROM pa),'plan names its gaps');
SELECT t_assert((SELECT p#>'{stages,terms}' @> '{"state":"partial","assignments":2,"assignments_with_accept_clock":0,"customer_acceptance":"not_established","inconsistencies":["assignment_accepted_status_without_clock"]}' FROM pa),'accepted status without clock is reported, not adopted');
SELECT t_assert((SELECT p#>'{stages,terms}' @> '{"state":"recorded","schedule_window_recorded":true,"gaps":[]}' FROM pc),'approval and accept clocks record terms');
SELECT t_assert((SELECT p#>'{stages,execution}' @> '{"state":"partial","operations_complete_status":1,"measured_usage":"not_established"}' FROM pa),'complete operation status alone is partial execution');
SELECT t_assert((SELECT p#>'{stages,execution}' @> '{"state":"recorded","component_events":1}' FROM pc),'start clock and operation record make execution recorded');
SELECT t_assert((SELECT p#>'{stages,completion}' @> '{"state":"status_only","inconsistencies":["done_status_without_completion_clock","assignment_completed_status_without_clock"]}' FROM pa),'paid status without completion clock is status only');
SELECT t_assert((SELECT p#>'{stages,completion}' @> '{"state":"recorded","status_history_rows":1,"gaps":[],"inconsistencies":[]}' FROM pc),'clocked completion recorded');
SELECT t_assert((SELECT p#>'{stages,accounting}' @> '{"state":"absent","payment_records":0,"vehicle_scoped_payment_events":1,"vehicle_payment_job_attribution":"not_established","inconsistencies":["paid_status_without_payment_record"]}' FROM pa),'vehicle payment is not attributed to the job and superseded events are excluded');
SELECT t_assert((SELECT p#>'{stages,accounting}' @> '{"state":"recorded","payment_records":2,"payment_records_by_status":{"completed":2},"inconsistencies":["payments_without_vehicle"]}' FROM pb),'payments without a vehicle are flagged');
SELECT t_assert((SELECT p#>'{stages,accounting}' @> '{"labor_value_calculated":false,"cost_allocated":false,"disbursement":"not_performed"}' FROM pa),'accounting never computes labor value or disburses');
SELECT t_assert((SELECT p @> '{"booking_readiness":"not_assessed","payment_authorized":false}' FROM pa),'job path does not book or authorize payment');
SELECT t_assert((SELECT p::text !~ '(Fixture Customer|5550100|"amount"|unit_price|total_cost|estimated_total": 1)' FROM pa),'no customer contact fields or amounts in output');
CREATE TEMP TABLE sb AS SELECT work_order_job_path_scoreboard() s;
SELECT t_assert((SELECT s @> '{"population":"all work_orders rows","work_orders":3}' FROM sb),'scoreboard denominator is every work order');
SELECT t_assert((SELECT s#>'{stages,completion}' @> '{"recorded":1,"status_only":2}' FROM sb),'scoreboard counts stage states');
SELECT t_assert((SELECT s->'inconsistencies' @> '{"done_status_without_completion_clock":2,"paid_status_without_payment_record":1,"payments_without_vehicle":1,"assignment_accepted_status_without_clock":1}' FROM sb),'scoreboard counts inconsistencies');
SELECT t_assert((SELECT (s#>>'{gaps,no_payment_record}')::int=2 FROM sb),'scoreboard counts gaps');
SELECT t_assert(t_refused($q$SELECT read_work_order_job_path('30000000-0000-0000-0000-000000000099')$q$),'unknown work order refused');
RESET ROLE;
SELECT t_assert((SELECT bool_and(provolatile='s' AND NOT prosecdef) FROM pg_proc WHERE proname IN ('read_work_order_job_path','work_order_job_path_scoreboard')),'readers are stable and run as the caller');
SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT read_work_order_job_path('30000000-0000-0000-0000-00000000000a')$q$),'anonymous job path refused');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_scoreboard()$q$),'anonymous scoreboard refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused($q$SELECT work_order_job_path_scoreboard()$q$),'signed-in stranger cannot read scoreboard');
RESET ROLE;
