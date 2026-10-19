-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- The job path's terms stage reads quotes and their acceptance (read_work_order_job_path).
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
 deposit_cents integer,lead_actor_id uuid,created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid);
CREATE TABLE public.business_ownership(business_id uuid,owner_id uuid,status text);
CREATE TABLE public.admin_users(user_id uuid,is_active boolean);
CREATE TABLE public.vehicle_access_grants(vehicle_id uuid,user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid,p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.vehicle_access_grants g WHERE g.vehicle_id=p_vehicle_id AND g.user_id=p_user_id) $$;
\ir helpers/work_order_is_accessible_live_20261014.sql
CREATE TABLE public.account_link_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,actor_id uuid,status text,verification_method text);
\ir helpers/viewer_identity_bridge_live_20261019.sql
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text);
CREATE TABLE public.component_events(id uuid PRIMARY KEY,vehicle_id uuid,work_order_id uuid,metadata jsonb);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY,work_order_id uuid,part_name text,part_number text,brand text,quantity integer,
 status text,job_op_code text,unit_price numeric,total_price numeric);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
 line_number integer,task_type text NOT NULL CHECK (task_type IN ('replace','inspect','install','clean','paint','adjust','other')),
 task_description text,actor_id uuid REFERENCES actors(id),hours_labor numeric,total_cost_cents integer,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','complete','rework','skipped','cancelled')),
 component_event_id uuid,notes text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.work_order_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text,
 accepted_at timestamptz,started_at timestamptz,completed_at timestamptz,actual_payout numeric,paid_at timestamptz,payout_status text);
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
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000009'),('10000000-0000-0000-0000-000000000008');
INSERT INTO actors VALUES ('60000000-0000-0000-0000-000000000001','Fixture Fabricator','person'),('60000000-0000-0000-0000-000000000002','Fixture Lead','mechanic');
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


-- P (..0f) performer with an approved work_evidence bridge to the operation actor; P2 (..09) self_claim only;
-- L (..08) evidenced bridge to WO3's lead actor; O (..0e) owner of WO1's organization.
INSERT INTO work_orders(id,vehicle_id,organization_id,title,description,status) VALUES
 ('30000000-0000-0000-0000-000000000004',NULL,'20000000-0000-0000-0000-000000000001','Unbound','- Inspect','pending');
UPDATE work_orders SET lead_actor_id='60000000-0000-0000-0000-000000000002' WHERE id='30000000-0000-0000-0000-000000000003';
INSERT INTO account_link_claims(user_id,actor_id,status,verification_method) VALUES
 ('10000000-0000-0000-0000-00000000000f','60000000-0000-0000-0000-000000000001','approved','work_evidence'),
 ('10000000-0000-0000-0000-000000000009','60000000-0000-0000-0000-000000000001','pending','self_claim'),
 ('10000000-0000-0000-0000-000000000008','60000000-0000-0000-0000-000000000002','approved','co_sign');
CREATE FUNCTION public.op_src(p_n integer,p_text text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data)
 VALUES(k,'40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-02','scope_operation_v1',
 jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','operation','work_order_id','30000000-0000-0000-0000-000000000001',
 'line_number',p_n,'task_type','other','task_description',p_text,'basis_field','description','basis_excerpt',p_text)));
 RETURN k; END $$;
SELECT op_src(1,'Fabricate stainless exhaust') AS op1 \gset
SELECT op_src(2,'TIG weld flanges') AS op2 \gset
SET ROLE service_role;
SELECT project_work_order_resource_observation(:'op1'); SELECT project_work_order_resource_observation(:'op2');
RESET ROLE;
UPDATE work_order_line_items SET actor_id='60000000-0000-0000-0000-000000000001' WHERE id=:'op1';

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
CREATE FUNCTION public.lines(p_amount numeric DEFAULT 150,p_currency text DEFAULT 'USD') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(
  jsonb_build_object('ref_kind','labor','ref_id','e0000000-0000-0000-0000-000000000001','description','Fabrication labor',
   'pricing_basis','day_rate','amount',p_amount,'currency',p_currency,'unit','day','quantity',2),
  jsonb_build_object('ref_kind','fee','ref_id',NULL,'description','Inspection fee','pricing_basis','flat','amount',90,'currency','USD',
   'unit',NULL,'quantity',NULL)) $$;
CREATE FUNCTION public.issue(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001',p_lines jsonb DEFAULT lines(),
  p_deposit jsonb DEFAULT NULL,p_valid timestamptz DEFAULT NULL,p_supersedes uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT issue_work_order_quote(p_wo,p_lines,p_deposit,p_valid,p_supersedes) $$;
CREATE FUNCTION public.n_obs() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*) FROM vehicle_observations $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid),public.lines(numeric,text),public.issue(uuid,jsonb,jsonb,timestamptz,uuid),public.n_obs(),
 public.t_assert(boolean,text),public.t_refused(text),public.t_refused_with(text,text) TO authenticated, anon, service_role;

CREATE FUNCTION public.terms(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT read_work_order_job_path(p_wo)#>'{stages,terms}' $$;
GRANT EXECUTE ON FUNCTION public.terms(uuid) TO authenticated;
SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(work_order_job_path_scoreboard()) k)::text AS board_keys \gset

SELECT t_assert(terms() @> '{"state":"absent","quote_clock":null,"quote_clock_basis":null,"current_quote":null,"quote_versions":0,
 "approval_clock":null,"approval_clock_basis":null,"approval_signer":null,"customer_acceptance":"not_established"}'
 AND terms()->'gaps' @> '["no_approval_clock"]','no quote: terms unchanged apart from null quote fields');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT issue() AS i1 \gset
RESET ROLE;
SELECT (:'i1'::jsonb)->>'quote_id' AS q1 \gset
SELECT (:'i1'::jsonb)->>'quote_hash' AS h1 \gset
SELECT t_assert(terms() @> jsonb_build_object('state','partial','quote_clock_basis','current_quote','quote_versions',1,
 'current_quote',jsonb_build_object('quote_id',:'q1','version',1,'quote_hash',:'h1'),'customer_acceptance','not_established')
 AND (terms()->>'quote_clock')::timestamptz=(SELECT observed_at FROM vehicle_observations WHERE id=:'q1')
 AND terms()->'gaps' @> '["no_approval_clock"]','current quote: terms partial with the quote clock');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(:'q1',:'h1') AS a1 \gset
RESET ROLE;
SELECT t_assert(terms() @> jsonb_build_object('state','recorded','approval_clock_basis','quote_acceptance_sign','customer_acceptance','signed',
 'approval_signer',jsonb_build_object('role','customer','acceptance_id',(:'a1'::jsonb)->>'acceptance_id','basis','authenticated_sign'),
 'stored_approval_clock',NULL)
 AND (terms()->>'approval_clock')::timestamptz=((:'a1'::jsonb)->>'signed_at')::timestamptz
 AND NOT terms()->'gaps' @> '["no_approval_clock"]','current acceptance: approval clock is the sign clock, attributed, gap dropped');
SELECT t_assert((SELECT approved_at IS NULL AND status='quoted' FROM work_orders WHERE id='30000000-0000-0000-0000-000000000001'),'nothing written to the work order');
SELECT t_assert(NOT read_work_order_job_path('30000000-0000-0000-0000-000000000001')::text ~ '("amount"|"total"|Fixture Customer|15550100|fixture@example|10000000-0000-0000-0000-00000000000c)',
 'job path carries no amounts, contact fields or the signer''s raw user id');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue(p_supersedes=>:'q1',p_valid=>'2099-01-01') AS i2 \gset
RESET ROLE;
SELECT (:'i2'::jsonb)->>'quote_id' AS q2 \gset
SELECT (:'i2'::jsonb)->>'quote_hash' AS h2 \gset
SELECT t_assert(terms() @> '{"state":"partial","customer_acceptance":"withheld","approval_clock":null,"approval_signer":null}'
 AND terms()->'gaps' @> '["no_approval_clock","acceptance_withheld_quote_superseded"]'
 AND terms()#>>'{current_quote,version}'='2','revision withholds the acceptance and says why');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(:'q2',:'h2');
RESET ROLE;
SELECT t_assert(terms()->>'state'='recorded' AND terms()->>'customer_acceptance'='signed','signed revision records terms again');

UPDATE work_order_line_items SET status='complete' WHERE id=:'op1';
SELECT t_assert(terms()->>'customer_acceptance'='signed','progress does not withhold');
INSERT INTO work_order_parts(id,work_order_id,part_name,quantity,status) VALUES
 ('d0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','V-band clamp',2,'quoted');
SELECT t_assert(terms()->'gaps' @> '["acceptance_withheld_scope_changed_since_quote","no_approval_clock"]' AND terms()->>'state'='partial',
 'scope change withholds the acceptance');
SELECT t_assert((work_order_job_path_scoreboard()#>>'{gaps,acceptance_withheld_scope_changed_since_quote}')::int=1,'scoreboard counts the withheld acceptance');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue(p_supersedes=>:'q2',p_valid=>'2099-01-01') AS i3 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(((:'i3'::jsonb)->>'quote_id')::uuid,(:'i3'::jsonb)->>'quote_hash');
RESET ROLE;
UPDATE work_orders SET customer_id='10000000-0000-0000-0000-00000000000b' WHERE id='30000000-0000-0000-0000-000000000001';
SELECT t_assert(terms()->'gaps' @> '["acceptance_withheld_signer_no_longer_customer"]','customer change withholds the acceptance');
UPDATE work_orders SET customer_id='10000000-0000-0000-0000-00000000000c' WHERE id='30000000-0000-0000-0000-000000000001';
UPDATE vehicle_observations SET is_superseded=true WHERE id=((:'i3'::jsonb)->>'quote_id')::uuid;
SELECT t_assert(terms()#>>'{current_quote,version}'='2' AND terms()->'gaps' @> '["acceptance_withheld_scope_changed_since_quote"]',
 'withdrawn revision: prior version current, its acceptance still withheld by the scope change');

UPDATE work_orders SET approved_at='2026-02-01' WHERE id='30000000-0000-0000-0000-000000000002';
SELECT t_assert(terms('30000000-0000-0000-0000-000000000002') @> '{"state":"recorded","approval_clock_basis":"work_orders.approved_at","current_quote":null}'
 AND (terms('30000000-0000-0000-0000-000000000002')->>'approval_clock')::timestamptz='2026-02-01','stored approval clock still records terms');
SET ROLE service_role;
SELECT t_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(work_order_job_path_scoreboard()) k)::text=:'board_keys'
 AND (work_order_job_path_scoreboard()->>'work_orders')::int=4,'scoreboard shape unchanged; covers every work order');
SELECT t_assert(read_work_order_job_path('30000000-0000-0000-0000-000000000001')#>>'{stages,terms,current_quote,version}'='2','service role reads the job path');
SELECT t_assert(work_order_quote_state('30000000-0000-0000-0000-000000000001')#>>'{acceptance,state}'='withheld','service role reads quote state');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused($q$SELECT work_order_quote_state('30000000-0000-0000-0000-000000000001')$q$),'quote state is service-only');
SELECT t_assert(t_refused($q$SELECT read_work_order_job_path('30000000-0000-0000-0000-000000000001')$q$),'job path stays service-only');
RESET ROLE;
SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT work_order_quote_state('30000000-0000-0000-0000-000000000001')$q$),'anon cannot read quote state');
RESET ROLE;
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('read_work_order_job_path','work_order_quote_state','work_order_job_path_scoreboard');
