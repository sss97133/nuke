-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Quote versions, supersession, the customer acceptance Sign and the party-gated quote reader.
-- Reader assertions here cover the 20261019094500 definition; 20261019124500 opens it (test_work_order_quotes_open_read.sql).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,customer_id uuid,organization_id uuid,request_source text,
 customer_name text,customer_phone text,customer_email text,title text,description text,scope_description text,
 quoted_at timestamptz,estimated_total numeric,estimated_cost_cents integer,approved_at timestamptz,scheduled_start timestamptz,
 scheduled_end timestamptz,started_at timestamptz,actual_start timestamptz,completed_at timestamptz,actual_end timestamptz,status text,
 deposit_cents integer,created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid);
CREATE TABLE public.business_ownership(business_id uuid,owner_id uuid,status text);
CREATE TABLE public.admin_users(user_id uuid,is_active boolean);
CREATE TABLE public.vehicle_access_grants(vehicle_id uuid,user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid,p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.vehicle_access_grants g WHERE g.vehicle_id=p_vehicle_id AND g.user_id=p_user_id) $$;
\ir helpers/work_order_is_accessible_live_20261014.sql
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text);
CREATE TABLE public.component_events(id uuid PRIMARY KEY,vehicle_id uuid,work_order_id uuid,metadata jsonb);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY,work_order_id uuid,part_name text,part_number text,brand text,quantity integer,
 status text,job_op_code text,unit_price numeric,total_price numeric);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
 line_number integer,task_type text NOT NULL CHECK (task_type IN ('replace','inspect','install','clean','paint','adjust','other')),
 task_description text,actor_id uuid REFERENCES actors(id),hours_labor numeric,total_cost_cents integer,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','complete','rework','skipped','cancelled')),
 component_event_id uuid,notes text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.work_order_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid NOT NULL,
 technician_id uuid,job_op_code text,role text DEFAULT 'lead' CHECK (role = ANY (ARRAY['lead','technician','helper'])),
 status text DEFAULT 'pending',
 offered_at timestamptz,accepted_at timestamptz,declined_at timestamptz,decline_reason text,started_at timestamptz,completed_at timestamptz,
 payout_type text DEFAULT 'flat' CHECK (payout_type = ANY (ARRAY['flat','hourly','percentage'])),payout_rate numeric,payout_percentage numeric,
 estimated_payout numeric,actual_payout numeric,payout_status text DEFAULT 'unpaid',
 paid_at timestamptz,notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE (work_order_id, technician_id, job_op_code));
CREATE TABLE public.work_order_labor(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,task_name text,task_category text,
 hours numeric,hourly_rate numeric,ai_estimated boolean,total_cost numeric,job_op_code text);
CREATE TABLE public.work_order_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid);
CREATE TABLE public.work_order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text);
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope_type text,scope_id uuid,is_superseded boolean);
CREATE TYPE public.observation_kind AS ENUM ('valuation','condition','specification','work_record','provenance');
CREATE TYPE public.confidence_level AS ENUM ('verified','high','medium','low','inferred');
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE,category text,
 supported_observations public.observation_kind[],updated_at timestamptz);
INSERT INTO observation_sources VALUES
 ('90000000-0000-0000-0000-000000000001','internal-inference','internal',ARRAY['valuation','condition','specification','work_record']::public.observation_kind[],now()),
 ('90000000-0000-0000-0000-000000000002','owner-input','owner',ARRAY['work_record','provenance']::public.observation_kind[],now()),
 ('90000000-0000-0000-0000-000000000003','fixture-provider-message','message',ARRAY['work_record']::public.observation_kind[],now());
CREATE TABLE public.user_tools(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.tool_inventory(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.equipment(id uuid PRIMARY KEY,shop_id uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,kind public.observation_kind,source_id uuid,
  source_identifier text,content_text text,content_hash text,extraction_method text,confidence public.confidence_level,confidence_score numeric,
  structured_data jsonb,observed_at timestamptz,observed_at_basis text,source_event_at timestamptz,source_event_time_precision text,
  ingested_at timestamptz DEFAULT now(),is_superseded boolean DEFAULT false,submitted_by_user_id uuid,observer_raw jsonb,
  UNIQUE (source_id,source_identifier,kind,content_hash));
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(),table_name text,column_name text,owned_by text,
  description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, UPDATE ON public.work_order_line_items TO authenticated;

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE FUNCTION public.t_refused_with(q text,needle text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN strpos(SQLERRM,needle)>0; END $$;

-- Parties: C customer, P quoting provider user, O shop owner of the work order's organization, V vehicle owner,
-- S signed-in stranger, A platform admin. WO1 quoted job; WO2 no customer; WO3 expired quote.
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-00000000000c'),('10000000-0000-0000-0000-00000000000f'),
 ('10000000-0000-0000-0000-00000000000e'),('10000000-0000-0000-0000-00000000000d'),('10000000-0000-0000-0000-00000000000b'),
 ('10000000-0000-0000-0000-00000000000a');
INSERT INTO organizations VALUES ('20000000-0000-0000-0000-000000000001');
INSERT INTO actors VALUES ('60000000-0000-0000-0000-000000000001','Fixture Fabricator','person');
INSERT INTO business_ownership VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000e','active');
INSERT INTO admin_users VALUES ('10000000-0000-0000-0000-00000000000a',true);
INSERT INTO vehicles(id,owner_id) VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000d'),('40000000-0000-0000-0000-000000000003',NULL);
INSERT INTO work_orders(id,vehicle_id,customer_id,organization_id,customer_name,customer_phone,customer_email,title,description,status,approved_at) VALUES
 ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c',
  '20000000-0000-0000-0000-000000000001','Fixture Customer','+15550100','fixture@example.invalid','Exhaust',
  E'SCOPE:\n- Fabricate stainless exhaust\n- TIG weld flanges','quoted',NULL),
 ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002',NULL,NULL,NULL,NULL,NULL,'Paint',E'- Paint hood','pending',NULL),
 ('30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000c',NULL,NULL,NULL,NULL,'Brakes',E'- Bleed brakes','quoted',NULL);
INSERT INTO work_order_parts(id,work_order_id,part_name,part_number,brand,quantity,status,unit_price,total_price) VALUES
 ('d0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','304 stainless mandrel bend','MB-304','FixtureCo',4,'quoted',31.25,125);
INSERT INTO work_order_labor(id,work_order_id,task_name,task_category,hours,hourly_rate) VALUES
 ('e0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Fabrication','fabrication',6,150);

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
\ir ../migrations/20261019180000_work_order_offers.sql
\ir ../migrations/20261019182000_work_order_offer_acceptance.sql

-- Synthetic sources in the guarded disposable database only.
CREATE FUNCTION public.src(p_envelope jsonb,p_vehicle uuid DEFAULT '40000000-0000-0000-0000-000000000001',
  p_source uuid DEFAULT '90000000-0000-0000-0000-000000000003',p_observed timestamptz DEFAULT '2026-01-02') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,confidence_score,structured_data,content_text)
 VALUES(k,p_vehicle,'work_record',p_source,p_observed,'provider_quote_message_v1',0.8,
 jsonb_build_object('work_order_resource',jsonb_build_object('version',1)||p_envelope),'fixture provider quote');
 RETURN k; END $$;
CREATE FUNCTION public.project(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT project_work_order_resource_observation(p_id) $$;
CREATE FUNCTION public.refused(p_id uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT t_refused(format('SELECT project_work_order_resource_observation(%L)',p_id)) $$;
CREATE FUNCTION public.quote_env(p_patch jsonb,p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('event_type','quote','work_order_id',p_wo,'quote_version',1,'supersedes_quote_id',NULL,
  'quoting_party',jsonb_build_object('kind','user','id','10000000-0000-0000-0000-00000000000f'),
  'scope_snapshot',work_order_quote_scope_snapshot(p_wo),
  'lines',jsonb_build_array(
    jsonb_build_object('ref_kind','labor','ref_id','e0000000-0000-0000-0000-000000000001','description','Fabrication labor',
      'pricing_basis','hourly','amount',150,'currency','USD','unit','hour','quantity',6),
    jsonb_build_object('ref_kind','part','ref_id','d0000000-0000-0000-0000-000000000001','description','Mandrel bends',
      'pricing_basis','flat','amount',125,'currency','USD','unit',NULL,'quantity',NULL),
    jsonb_build_object('ref_kind','fee','ref_id',NULL,'description','Shop supplies','pricing_basis','flat','amount',NULL,
      'currency',NULL,'unit',NULL,'quantity',NULL)),
  'deposit_requested',jsonb_build_object('amount',500,'currency','USD'),'valid_until','2099-01-01T00:00:00Z')||p_patch $$;
CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
CREATE FUNCTION public.rd(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT work_order_quotes_read(p_wo) $$;
GRANT EXECUTE ON FUNCTION public.rd(uuid),public.as_user(uuid),public.t_assert(boolean,text),public.t_refused(text),
 public.t_refused_with(text,text) TO authenticated, anon;

-- Two requested operations from the scope text, so the snapshot carries sourced operations.
SELECT src(jsonb_build_object('event_type','operation','work_order_id','30000000-0000-0000-0000-000000000001','line_number',1,
 'task_type','other','task_description','Fabricate stainless exhaust','basis_field','description','basis_excerpt','Fabricate stainless exhaust'),
 p_source=>'90000000-0000-0000-0000-000000000001') AS op1 \gset
SELECT src(jsonb_build_object('event_type','operation','work_order_id','30000000-0000-0000-0000-000000000001','line_number',2,
 'task_type','other','task_description','TIG weld flanges','basis_field','description','basis_excerpt','TIG weld flanges'),
 p_source=>'90000000-0000-0000-0000-000000000001') AS op2 \gset
SET ROLE service_role;
SELECT project(:'op1'); SELECT project(:'op2');
RESET ROLE;
SELECT src(jsonb_build_object('event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001','line_item_id',:'op2',
 'requirement_kind','tool','description','TIG welder','quantity',NULL,'unit',NULL),p_source=>'90000000-0000-0000-0000-000000000001') AS req1 \gset
SET ROLE service_role;
SELECT project(:'req1');
RESET ROLE;
SELECT t_assert(jsonb_array_length(work_order_quote_scope_snapshot('30000000-0000-0000-0000-000000000001')->'operations')=2
 AND work_order_quote_scope_snapshot('30000000-0000-0000-0000-000000000001')#>>'{requirements,0,description}'='TIG welder'
 AND NOT work_order_quote_scope_snapshot('30000000-0000-0000-0000-000000000001')::text ~ '(unit_price|total_price|hourly_rate|"status"|"hours")',
 'scope snapshot carries operations, parts and labor without amounts or progress fields');

-- Version 1.
SELECT src(quote_env('{}')) AS q1 \gset
SET ROLE anon;
SELECT t_assert(refused(:'q1'),'anonymous projection refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(refused(:'q1'),'signed-in projection refused');
RESET ROLE;
SET ROLE service_role;
SELECT t_assert(project(:'q1')->>'duplicate'='false','quote version 1 projects');
SELECT t_assert((project(:'q1')->>'duplicate')::boolean,'quote replay is idempotent');
SELECT t_assert(t_refused($q$INSERT INTO work_order_quotes(id,work_order_id,version,quoting_party_kind,scope_snapshot,lines,quote_hash)
 VALUES (gen_random_uuid(),'30000000-0000-0000-0000-000000000001',9,'unknown','{}','[{}]',repeat('a',64))$q$),'service role cannot write quotes directly');
SELECT t_assert(t_refused('SELECT project_work_order_quote_event(gen_random_uuid())'),'internal quote branch has no direct grant');
RESET ROLE;
SELECT t_assert((SELECT version=1 AND supersedes_quote_id IS NULL AND quoting_party_kind='user' AND quoting_user_id='10000000-0000-0000-0000-00000000000f'
 AND deposit_requested_amount=500 AND deposit_requested_currency='USD' AND quote_hash ~ '^[0-9a-f]{64}$' AND jsonb_array_length(lines)=3
 FROM work_order_quotes WHERE id=:'q1'),'quote row records version, party, lines, deposit and hash');
SELECT t_assert(t_refused(format($q$UPDATE work_order_quotes SET valid_until=now() WHERE id=%L$q$,:'q1')),'quote rows are immutable');
SELECT t_assert(t_refused(format($q$DELETE FROM work_order_quotes WHERE id=%L$q$,:'q1')),'quote rows cannot be deleted');

-- Revision rules and line validation.
SELECT t_assert(refused(src(quote_env('{"quote_version":1}'))),'duplicate version 1 refused');
SELECT t_assert(refused(src(quote_env('{"quote_version":3}'))),'skipped version refused');
SELECT t_assert(refused(src(quote_env('{"quote_version":2}'))),'revision without supersedes refused');
SELECT t_assert(refused(src(quote_env(jsonb_build_object('quote_version',2,'supersedes_quote_id',gen_random_uuid())))),'revision naming another quote refused');
SELECT t_assert(refused(src(quote_env(jsonb_build_object('quote_version',2,'supersedes_quote_id',:'q1')||'{"scope_snapshot":{"snapshot_version":1}}'))),'stale scope snapshot refused');
CREATE FUNCTION public.v2(p_patch jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT quote_env(jsonb_build_object('quote_version',2,'supersedes_quote_id',(SELECT id FROM work_order_quotes WHERE version=1
  AND work_order_id='30000000-0000-0000-0000-000000000001'))||p_patch) $$;
CREATE FUNCTION public.qline(p jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('ref_kind','fee','ref_id',NULL,'description','Fee',
  'pricing_basis','flat','amount',10,'currency','USD','unit',NULL,'quantity',NULL)||p)) $$;
SELECT t_assert(refused(src(v2(qline('{"currency":null}')))),'amount without currency refused');
SELECT t_assert(refused(src(v2(qline('{"amount":null}')))),'currency without amount refused');
SELECT t_assert(refused(src(v2(qline('{"currency":"usd"}')))),'non-ISO currency refused');
SELECT t_assert(refused(src(v2(qline('{"amount":-1}')))),'negative amount refused');
SELECT t_assert(refused(src(v2(qline('{"amount":"10"}')))),'string amount refused');
SELECT t_assert(refused(src(v2(qline('{"pricing_basis":"percentage"}')))),'pricing basis outside flat/hourly/day_rate/per_operation refused');
SELECT t_assert(refused(src(v2(qline('{"pricing_basis":"hourly","unit":"day"}')))),'hourly line with a day unit refused');
SELECT t_assert(refused(src(v2(qline('{"quantity":2}')))),'flat line with a quantity refused');
SELECT t_assert(refused(src(v2(qline('{"ref_id":"d0000000-0000-0000-0000-000000000001"}')))),'fee line with a reference refused');
SELECT t_assert(refused(src(v2(qline('{"ref_kind":"part","ref_id":"d0000000-0000-0000-0000-0000000000ff"}')))),'reference outside the scope snapshot refused');
SELECT t_assert(refused(src(v2(qline('{"discount":5}')))),'unknown line key refused');
SELECT t_assert(refused(src(v2(qline('{"description":""}')))),'empty line description refused');
SELECT t_assert(refused(src(v2(qline('{"amount":null,"currency":null}')))),'all-unpriced scope (an estimate) refused as a quote');
SELECT t_assert(refused(src(v2('{"quoting_party":{"kind":"unknown","id":"10000000-0000-0000-0000-00000000000f"}}'))),'unknown party with an id refused');
SELECT t_assert(refused(src(v2('{"quoting_party":{"kind":"name","id":null}}'))),'party kind outside actor/user/organization/unknown refused');
SELECT t_assert(refused(src(v2('{"quoting_party":{"kind":"actor","id":"60000000-0000-0000-0000-0000000000ff"}}'))),'nonexistent actor refused');
SELECT t_assert(refused(src(v2('{"deposit_requested":{"amount":500}}'))),'deposit without currency refused');
SELECT t_assert(refused(src(v2('{"deposit_requested":{"amount":0,"currency":"USD"}}'))),'zero deposit refused');
SELECT t_assert(refused(src(v2('{"valid_until":"2026-01-01T00:00:00Z"}'))),'validity ending before the quote clock refused');
SELECT t_assert(refused(src(v2('{}'),'40000000-0000-0000-0000-000000000002')),'source on another vehicle refused');
SELECT src(v2('{}')) AS withdrawn_src \gset
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'withdrawn_src';
SELECT t_assert(refused(:'withdrawn_src'),'withdrawn source refused');

-- Version 2 supersedes version 1; actor party, unknown is allowed elsewhere.
SELECT src(v2('{"quoting_party":{"kind":"actor","id":"60000000-0000-0000-0000-000000000001"}}')) AS q2 \gset
SET ROLE service_role;
SELECT t_assert(project(:'q2')->>'duplicate'='false','quote version 2 projects as a revision');
RESET ROLE;
SELECT t_assert((SELECT version=2 AND supersedes_quote_id=:'q1' AND quoting_actor_id='60000000-0000-0000-0000-000000000001'
 FROM work_order_quotes WHERE id=:'q2'),'revision names the version it supersedes');
SELECT t_assert((SELECT count(*) FROM work_order_quotes WHERE id=:'q1')=1,'superseded version is retained');
SELECT quote_hash AS h1 FROM work_order_quotes WHERE id=:'q1' \gset
SELECT quote_hash AS h2 FROM work_order_quotes WHERE id=:'q2' \gset

-- Reader gates.
SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT work_order_quotes_read('30000000-0000-0000-0000-000000000001')$q$),'anonymous reader refused');
SELECT t_assert(t_refused(format($q$SELECT accept_work_order_quote(%L,'x')$q$,:'q2')),'anonymous accept refused');
RESET ROLE;
SET ROLE service_role;
SELECT t_assert(t_refused($q$SELECT work_order_quotes_read('30000000-0000-0000-0000-000000000001')$q$),'service role has no reader grant');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user(NULL);
SELECT t_assert(t_refused($q$SELECT rd()$q$),'authenticated role without auth.uid() refused');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT rd()$q$,'Work order unavailable'),'signed-in stranger refused');
SELECT t_assert(t_refused_with($q$SELECT rd('30000000-0000-0000-0000-0000000000ff')$q$,'Work order unavailable'),'missing work order looks the same as a refused one');

SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT rd() AS c1 \gset
SELECT t_assert((:'c1'::jsonb)#>>'{current_quote,quote_id}'=:'q2' AND (:'c1'::jsonb)#>>'{current_quote,version}'='2'
 AND (:'c1'::jsonb)#>>'{viewer,context}'='customer' AND ((:'c1'::jsonb)#>>'{viewer,money_visible}')::boolean
 AND (:'c1'::jsonb)#>>'{viewer,decided_from}'='auth.uid()' AND (:'c1'::jsonb)#>>'{viewer,contact_visible}'='false',
 'customer reads the current quote with money');
SELECT t_assert((:'c1'::jsonb)#>'{current_quote,totals_by_currency}'='[{"currency":"USD","total":1025,"complete":true}]'::jsonb
 AND (:'c1'::jsonb)#>>'{current_quote,unpriced_lines}'='1' AND (:'c1'::jsonb)#>'{current_quote,deposit_requested}'='{"amount":500,"currency":"USD"}'::jsonb,
 'totals extend hourly rate by stated quantity; unpriced lines counted, not invented');
SELECT t_assert((:'c1'::jsonb)#>'{history}' @> jsonb_build_array(jsonb_build_object('quote_id',:'q1','state','superseded','withheld_reason','superseded_by_newer_version'),
 jsonb_build_object('quote_id',:'q2','state','current')) AND jsonb_array_length((:'c1'::jsonb)->'history')=2,'history keeps both versions, newer withholds older');
SELECT t_assert((:'c1'::jsonb)#>'{viewer,actions}'=jsonb_build_array(jsonb_build_object('action','accept_quote','rpc','accept_work_order_quote',
 'args',jsonb_build_object('p_quote_id',:'q2','p_quote_hash',:'h2'))),
 'customer is offered accept_quote for the current version and hash');
SELECT t_assert((:'c1'::jsonb)#>>'{acceptance,state}'='not_accepted' AND (:'c1'::jsonb)#>>'{approved_at,derived}' IS NULL,'nothing accepted yet');
SELECT t_assert(NOT :'c1' ~ '(Fixture Customer|15550100|fixture@example)','reader never returns customer contact');

SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT rd() AS v1 \gset
SELECT t_assert((:'v1'::jsonb)#>>'{viewer,context}'='vehicle_access' AND NOT ((:'v1'::jsonb)#>>'{viewer,money_visible}')::boolean
 AND (:'v1'::jsonb)#>'{viewer,actions}'='[]'::jsonb AND (:'v1'::jsonb)#>'{current_quote,totals_by_currency}'='null'::jsonb
 AND (:'v1'::jsonb)#>'{current_quote,deposit_requested}'='null'::jsonb
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'v1'::jsonb)#>'{current_quote,lines}') l WHERE l->'amount'<>'null' OR l->'currency'<>'null')
 AND (:'v1'::jsonb)#>>'{coverage,money}'='withheld_for_viewer','vehicle-access viewer sees the quote but no money and no action');
SELECT t_assert((:'v1'::jsonb)#>'{current_quote,scope_snapshot}'='null'::jsonb
 AND (:'v1'::jsonb)#>'{current_quote,scope_counts}'='{"operations":2,"requirements":1,"specifications":0,"parts":1,"labor":1}'::jsonb
 AND (:'c1'::jsonb)#>'{current_quote,scope_snapshot,operations}' IS NOT NULL,'scope snapshot only for parties; others get counts');
SELECT t_assert(NOT :'v1' ~ '("(amount|total)": [0-9]|USD)','no amounts or currency for a non-party');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(rd()#>>'{viewer,context}'='provider' AND (rd()#>>'{viewer,money_visible}')::boolean AND rd()#>'{viewer,actions}'='[]'::jsonb
 AND rd()#>'{viewer,slots}'='["work_order_organization_owner"]'::jsonb,'shop owner reads money as provider, no accept action');
SELECT as_user('10000000-0000-0000-0000-00000000000a');
SELECT t_assert(rd()#>>'{viewer,context}'='platform_admin' AND NOT (rd()#>>'{viewer,money_visible}')::boolean,'admin reads without money');

-- Acceptance Sign.
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2'),'Quote unavailable'),'stranger cannot accept');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2'),'Quote unavailable'),'vehicle owner who is not the customer cannot accept');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2'),'Quote unavailable'),'shop owner cannot accept for the customer');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h1'),'hash does not match'),'hash of another version refused');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',repeat('0',64)),'hash does not match'),'wrong hash refused');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,NULL)$q$,:'q2'),'hash does not match'),'missing hash refused');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q1',:'h1'),'quote_superseded'),'superseded version cannot be accepted');
SELECT accept_work_order_quote(:'q2',:'h2') AS a2 \gset
SELECT t_assert((:'a2'::jsonb)->>'duplicate'='false' AND (:'a2'::jsonb)->>'quote_hash'=:'h2' AND (:'a2'::jsonb)->>'work_order_status_changed'='false'
 AND (:'a2'::jsonb)->>'payment_authorized'='false','customer accepts the exact current version');
SELECT t_assert((accept_work_order_quote(:'q2',:'h2')->>'duplicate')::boolean,'repeat Sign is idempotent');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM work_order_quote_acceptances WHERE quote_id=:'q2')=1,'one acceptance row');
SELECT t_assert((SELECT a.signer_user_id='10000000-0000-0000-0000-00000000000c' AND a.signer_role='customer' AND a.quote_hash=:'h2'
 AND o.submitted_by_user_id=a.signer_user_id AND o.source_id='90000000-0000-0000-0000-000000000002' AND o.kind='work_record'
 AND o.extraction_method='work_order_quote_acceptance_sign_v1' AND o.observed_at=a.signed_at AND o.source_event_at=a.signed_at
 FROM work_order_quote_acceptances a JOIN vehicle_observations o ON o.id=a.id WHERE a.quote_id=:'q2'),
 'acceptance records signer, sign clock and quote hash on an owner-input work record');
SELECT t_assert((SELECT status='quoted' AND approved_at IS NULL FROM work_orders WHERE id='30000000-0000-0000-0000-000000000001'),
 'work order status and approved_at are not written');
SELECT t_assert(t_refused(format($q$UPDATE work_order_quote_acceptances SET signed_at=now() WHERE quote_id=%L$q$,:'q2')),'acceptance rows are immutable');
-- A service-written acceptance observation cannot project outside the Sign.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data,submitted_by_user_id)
 VALUES ('80000000-0000-0000-0000-0000000000f1','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',now(),
 'work_order_quote_acceptance_sign_v1',jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','quote_acceptance',
 'work_order_id','30000000-0000-0000-0000-000000000001','quote_id',:'q2','quote_hash',:'h2','signer_user_id','10000000-0000-0000-0000-00000000000c',
 'signer_role','customer')),'10000000-0000-0000-0000-00000000000c');
SET ROLE service_role;
SELECT t_assert(t_refused_with($q$SELECT project('80000000-0000-0000-0000-0000000000f1')$q$,'only by accept_work_order_quote'),'acceptance projects only inside the Sign RPC');
SELECT t_assert(t_refused($q$SELECT set_config('nuke.work_order_quote_sign','80000000-0000-0000-0000-0000000000f1',true),accept_work_order_quote(gen_random_uuid(),'x')$q$),'service role cannot call the Sign');
RESET ROLE;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT rd() AS c2 \gset
SELECT t_assert((:'c2'::jsonb)#>>'{acceptance,state}'='accepted' AND ((:'c2'::jsonb)#>>'{acceptance,accepted_by_viewer}')::boolean
 AND (:'c2'::jsonb)#>>'{acceptance,quote_hash}'=:'h2' AND (:'c2'::jsonb)#>>'{acceptance,signed_at}' IS NOT NULL
 AND (:'c2'::jsonb)#>>'{acceptance,withheld_reason}' IS NULL AND (:'c2'::jsonb)#>>'{approved_at,derived}'=(:'c2'::jsonb)#>>'{acceptance,signed_at}'
 AND (:'c2'::jsonb)#>'{viewer,actions}'='[]'::jsonb,'reader shows the acceptance and derives approved_at; no second accept action');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(rd()#>>'{acceptance,state}'='accepted' AND NOT (rd()#>>'{acceptance,accepted_by_viewer}')::boolean,'other party sees accepted, not by them');
RESET ROLE;

-- Progress on an operation does not withhold the acceptance.
UPDATE work_order_line_items SET status='complete' WHERE id=:'op1';
UPDATE work_order_parts SET status='installed' WHERE id='d0000000-0000-0000-0000-000000000001';
UPDATE work_order_labor SET hours=7 WHERE id='e0000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(rd()#>>'{acceptance,state}'='accepted' AND rd()#>>'{current_quote,scope_status}'='matches_current','progress fields do not invalidate the quote');
RESET ROLE;

-- A revision after acceptance withholds the earlier acceptance until the customer signs the new version.
SELECT src(quote_env(jsonb_build_object('quote_version',3,'supersedes_quote_id',:'q2','quoting_party',jsonb_build_object('kind','unknown','id',NULL)))) AS q3 \gset
SET ROLE service_role;
SELECT project(:'q3');
RESET ROLE;
SELECT quote_hash AS h3 FROM work_order_quotes WHERE id=:'q3' \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT rd() AS c3 \gset
SELECT t_assert((:'c3'::jsonb)#>>'{acceptance,state}'='withheld' AND (:'c3'::jsonb)#>>'{acceptance,withheld_reason}'='quote_superseded'
 AND (:'c3'::jsonb)#>>'{acceptance,quote_id}'=:'q2' AND (:'c3'::jsonb)#>>'{approved_at,derived}' IS NULL
 AND (:'c3'::jsonb)#>>'{current_quote,quoting_party,kind}'='unknown'
 AND (:'c3'::jsonb)#>'{viewer,actions,0,args,p_quote_id}'=to_jsonb(:'q3'::text),'superseded quote withholds its acceptance; new version offered');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2'),'quote_superseded'),'cannot re-sign the superseded version');
SELECT t_assert(accept_work_order_quote(:'q3',:'h3')->>'duplicate'='false','customer signs the revision');
SELECT t_assert(rd()#>>'{acceptance,state}'='accepted' AND rd()#>>'{acceptance,quote_id}'=:'q3','revision acceptance is current');
RESET ROLE;

-- Withdrawing the revision's source restores the prior version and its acceptance; history keeps all three.
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'q3';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT rd() AS c4 \gset
SELECT t_assert((:'c4'::jsonb)#>>'{current_quote,quote_id}'=:'q2' AND (:'c4'::jsonb)#>'{history}' @> jsonb_build_array(
 jsonb_build_object('quote_id',:'q3','state','withdrawn','withheld_reason','source_withdrawn'))
 AND (:'c4'::jsonb)#>>'{acceptance,quote_id}'=:'q2' AND (:'c4'::jsonb)#>>'{acceptance,state}'='accepted'
 AND (:'c4'::jsonb)#>>'{coverage,quote_versions}'='3' AND (:'c4'::jsonb)#>>'{coverage,acceptances_recorded}'='2','withdrawn revision is withheld; prior acceptance current again');
RESET ROLE;

-- A scope change (new part) withholds the acceptance and blocks signing until a revised quote.
INSERT INTO work_order_parts(id,work_order_id,part_name,quantity,status) VALUES
 ('d0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','V-band clamp',2,'quoted');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT rd() AS c5 \gset
SELECT t_assert((:'c5'::jsonb)#>>'{acceptance,state}'='withheld' AND (:'c5'::jsonb)#>>'{acceptance,withheld_reason}'='scope_changed_since_quote'
 AND (:'c5'::jsonb)#>>'{current_quote,scope_status}'='changed_since_quote' AND (:'c5'::jsonb)#>'{viewer,actions}'='[]'::jsonb,
 'scope change withholds acceptance and removes the action');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2'),'scope_changed_since_quote'),'scope-changed quote cannot be signed');
RESET ROLE;
SELECT t_assert(refused(src(quote_env(jsonb_build_object('quote_version',4,'supersedes_quote_id',:'q2','scope_snapshot',
 (SELECT scope_snapshot FROM work_order_quotes WHERE id=:'q2'))))),'revision must carry the new scope');
SELECT src(quote_env(jsonb_build_object('quote_version',4,'supersedes_quote_id',:'q2'))) AS q4 \gset
SET ROLE service_role;
SELECT t_assert(project(:'q4')->>'duplicate'='false','revision over the changed scope projects as version 4');
RESET ROLE;

-- Changing the customer withholds the earlier acceptance.
SELECT quote_hash AS h4 FROM work_order_quotes WHERE id=:'q4' \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(:'q4',:'h4');
RESET ROLE;
UPDATE work_orders SET customer_id='10000000-0000-0000-0000-00000000000b' WHERE id='30000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(rd()#>>'{acceptance,state}'='withheld' AND rd()#>>'{acceptance,withheld_reason}'='signer_no_longer_customer'
 AND NOT (rd()#>>'{acceptance,accepted_by_viewer}')::boolean,'acceptance by a former customer is withheld');
RESET ROLE;
UPDATE work_orders SET customer_id='10000000-0000-0000-0000-00000000000c' WHERE id='30000000-0000-0000-0000-000000000001';

-- No customer: nobody can sign. Expired quote: no action, Sign refused.
SELECT src(quote_env('{"lines":[{"ref_kind":"fee","ref_id":null,"description":"Paint","pricing_basis":"day_rate","amount":400,"currency":"USD","unit":"day","quantity":null}],"deposit_requested":null}',
 '30000000-0000-0000-0000-000000000002'),'40000000-0000-0000-0000-000000000002') AS q5 \gset
SELECT src(quote_env('{"lines":[{"ref_kind":"fee","ref_id":null,"description":"Bleed","pricing_basis":"per_operation","amount":80,"currency":"USD","unit":"operation","quantity":1}],"valid_until":"2026-01-03T00:00:00Z"}',
 '30000000-0000-0000-0000-000000000003'),'40000000-0000-0000-0000-000000000003') AS q6 \gset
SET ROLE service_role;
SELECT project(:'q5'); SELECT project(:'q6');
RESET ROLE;
SELECT quote_hash AS h5 FROM work_order_quotes WHERE id=:'q5' \gset
SELECT quote_hash AS h6 FROM work_order_quotes WHERE id=:'q6' \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(rd('30000000-0000-0000-0000-000000000002')#>'{viewer,actions}'='[]'::jsonb
 AND rd('30000000-0000-0000-0000-000000000002')#>'{current_quote,totals_by_currency}'='null'::jsonb,'no customer: no accept action and no money for the vehicle owner');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q5',:'h5'),'Quote unavailable'),'no customer: vehicle owner cannot sign');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert((rd('30000000-0000-0000-0000-000000000003')#>>'{current_quote,expired}')::boolean
 AND rd('30000000-0000-0000-0000-000000000003')#>'{viewer,actions}'='[]'::jsonb
 AND rd('30000000-0000-0000-0000-000000000003')#>'{current_quote,totals_by_currency}'='[{"currency":"USD","total":80,"complete":true}]'::jsonb,
 'expired quote: no action; per-operation total extends by quantity');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q6',:'h6'),'quote_expired'),'expired quote cannot be signed');
RESET ROLE;

-- Existing readers keep their behavior over a work order that now has quotes.
SET ROLE service_role;
SELECT t_assert(read_work_order_job_path('30000000-0000-0000-0000-000000000001')#>>'{stages,plan,operations}'='2'
 AND (work_order_job_path_scoreboard()->>'work_orders')::int=3,'job path and scoreboard unchanged');
SELECT t_assert(read_work_order_resources('30000000-0000-0000-0000-000000000001')->>'payment_authorized'='false','resource reader unchanged');
RESET ROLE;
SELECT t_assert((SELECT bool_and(NOT has_function_privilege(r,f,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated']) r,
 unnest(ARRAY['project_work_order_resource_observation(uuid)','work_order_quote_scope_snapshot(uuid)','project_work_order_quote_event(uuid)',
 'work_order_quote_acceptance_refusal(uuid,uuid,timestamptz)']) f),'service and internal functions are not callable by anon or authenticated');
SELECT t_assert(has_function_privilege('authenticated','work_order_quotes_read(uuid)','EXECUTE')
 AND has_function_privilege('authenticated','accept_work_order_quote(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','work_order_quotes_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','accept_work_order_quote(uuid,text)','EXECUTE'),'reader and Sign: authenticated only');
SELECT t_assert(NOT has_table_privilege('authenticated','work_order_quotes','SELECT') AND NOT has_table_privilege('anon','work_order_quote_acceptances','SELECT')
 AND NOT has_table_privilege('service_role','work_order_quotes','INSERT'),'quote tables: service read only');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('project_work_order_resource_observation','project_work_order_quote_event','work_order_quote_scope_snapshot',
 'work_order_quote_acceptance_refusal','accept_work_order_quote','work_order_quotes_read');
