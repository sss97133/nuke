-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Change orders (issue_change_order): amendments of an accepted quote as new versions with an explicit diff; job path terms.
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
CREATE TABLE public.organizations(id uuid PRIMARY KEY,name text,business_name text);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,customer_id uuid,organization_id uuid,request_source text,
 customer_name text,customer_phone text,customer_email text,title text,description text,scope_description text,
 quoted_at timestamptz,estimated_total numeric,estimated_cost_cents integer,approved_at timestamptz,scheduled_start timestamptz,
 scheduled_end timestamptz,started_at timestamptz,actual_start timestamptz,completed_at timestamptz,actual_end timestamptz,status text,
 deposit_cents integer,lead_actor_id uuid,scope_category text,created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,year integer,make text,model text,trim text,is_public boolean,merged_into_vehicle_id uuid);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,username text,full_name text,is_public boolean,avatar_url text,bio text,city text,state text,
 user_type text,role text,profession text,expertise_areas text[],member_since timestamptz,email text,phone text,phone_number text,address text,zip text);
CREATE TABLE public.organization_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,role text,status text,
 start_date date,end_date date,verification_method text,verified_by uuid,verified_at timestamptz,notes text);
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),platform text,handle text);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY,user_id uuid,vehicle_id uuid,session_date date,start_time timestamptz,
 end_time timestamptz,duration_minutes integer,image_count integer,owner_confirmed_at timestamptz,owner_confirmed_by uuid,total_labor_cost numeric);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,taken_at timestamptz,is_external boolean);
CREATE TABLE public.business_ownership(business_id uuid,owner_id uuid,status text);
CREATE TABLE public.admin_users(user_id uuid,is_active boolean);
CREATE TABLE public.vehicle_access_grants(vehicle_id uuid,user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid,p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.vehicle_access_grants g WHERE g.vehicle_id=p_vehicle_id AND g.user_id=p_user_id) $$;
\ir helpers/work_order_is_accessible_live_20261014.sql
CREATE TABLE public.account_link_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,actor_id uuid,status text,verification_method text,
 platform text DEFAULT 'nuke_actor',handle text,external_identity_id uuid,claim_confidence integer,proof_type text,proof_url text,notes text,
 reviewed_by_user_id uuid,reviewed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),rung_evidence jsonb);
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
 technician_id uuid NOT NULL,job_op_code text,role text DEFAULT 'lead' CHECK (role = ANY (ARRAY['lead','technician','helper'])),
 status text DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','offered','accepted','declined','in_progress','proof_submitted','verified','completed','paid_out'])),
 offered_at timestamptz,accepted_at timestamptz,declined_at timestamptz,decline_reason text,started_at timestamptz,completed_at timestamptz,
 payout_type text DEFAULT 'flat' CHECK (payout_type = ANY (ARRAY['flat','hourly','percentage'])),payout_rate numeric,payout_percentage numeric,
 estimated_payout numeric,actual_payout numeric,payout_status text DEFAULT 'unpaid' CHECK (payout_status = ANY (ARRAY['unpaid','pending_proof','pending_client_payment','ready','processing','paid'])),
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
  UNIQUE (source_id,source_identifier,kind,content_hash),
  superseded_by uuid,superseded_at timestamptz,lineage_chain uuid[]);
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

-- A legacy technician-keyed row as live: accepted status without a clock (kept; reported, not repaired).
INSERT INTO work_order_assignments(work_order_id,technician_id,role,status,payout_type) VALUES
 ('30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000aa','helper','accepted','flat');
\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019045753_work_order_job_path.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql
\ir ../migrations/20261019093000_job_readers_authenticated.sql
\ir ../migrations/20261019094500_work_order_quotes.sql
\ir ../migrations/20261019120000_work_order_quote_issue.sql
\ir ../migrations/20261019121500_open_job_readers.sql
\ir ../migrations/20261019123000_work_order_job_path_quotes.sql
\ir ../migrations/20261019124500_work_order_quotes_open_read.sql
\ir ../migrations/20261019150000_inspection_request.sql
\ir ../migrations/20261019152500_inspection_findings.sql
\ir ../migrations/20261019153000_job_path_inspection.sql
\ir ../migrations/20261019180000_work_order_offers.sql
\ir ../migrations/20261019182000_work_order_offer_acceptance.sql
\ir ../migrations/20261019183000_work_order_offers_read.sql
\ir ../migrations/20261019184500_inspection_access.sql
\ir ../migrations/20261019210000_work_order_cosign.sql
\ir ../migrations/20261019213000_work_order_change_orders.sql


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

UPDATE vehicles SET is_public=(id<>'40000000-0000-0000-0000-000000000003');
-- Requirements on WO1 (vehicle 1, public, customer C, organization ORG1 owned by O): skill on op1, facility and tool on op2.
CREATE FUNCTION public.req_src(p_line uuid,p_kind text,p_desc text,p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001',
  p_vehicle uuid DEFAULT '40000000-0000-0000-0000-000000000001') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data)
 VALUES(k,p_vehicle,'work_record','90000000-0000-0000-0000-000000000001','2026-01-03','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id',p_wo,'line_item_id',p_line,
  'requirement_kind',p_kind,'description',p_desc,'quantity',NULL,'unit',NULL)));
 PERFORM project_work_order_resource_observation(k); RETURN k; END $$;
SELECT req_src(:'op1','skill','TIG welding of stainless flanges') AS rskill \gset
SELECT req_src(:'op2','facility','Lift bay for exhaust fitting') AS rfac \gset
SELECT req_src(:'op2','tool','TIG welder') AS rtool \gset
CREATE FUNCTION public.terms(p_amount numeric DEFAULT 400,p_currency text DEFAULT 'USD') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('description','Day of TIG fabrication','pricing_basis','day_rate',
  'amount',p_amount,'currency',p_currency,'unit','day','quantity',2))) $$;
CREATE FUNCTION public.offer(p_req uuid,p_terms jsonb DEFAULT terms(),p_from timestamptz DEFAULT '2099-01-01',p_until timestamptz DEFAULT '2099-01-10',
  p_note text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT offer_on_requirement(p_req,p_terms,p_from,p_until,p_note) $$;
GRANT EXECUTE ON FUNCTION public.terms(numeric,text),public.offer(uuid,jsonb,timestamptz,timestamptz,text) TO anon,authenticated,service_role;
CREATE FUNCTION public.fulfillment_ids(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT COALESCE(jsonb_agg(f->>'id' ORDER BY f->>'id'),'[]') FROM jsonb_array_elements(read_work_order_resources(p_wo)->'fulfillments') f $$;


INSERT INTO profiles(id,username,full_name,is_public) VALUES
 ('10000000-0000-0000-0000-00000000000f','fab_pro','Private Fabricator Name',true),
 ('10000000-0000-0000-0000-000000000009','quiet_one','Private Selfclaim Name',false),
 ('10000000-0000-0000-0000-00000000000c','cust_handle','Fixture Customer',true);
CREATE FUNCTION public.ofr(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_offers_read(p_wo) $$;
CREATE FUNCTION public.jp(p_stage text,p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT read_work_order_job_path(p_wo)->'stages'->p_stage $$;
GRANT EXECUTE ON FUNCTION public.ofr(uuid),public.jp(text,uuid) TO anon,authenticated,service_role;

-- Change orders. O (..0e) owns ORG1 and issues quotes; C (..0c) is the customer; S (..0b) a signed-in stranger.
-- A requested specification on op1 (304 stainless, TIG) is part of the quoted scope.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,content_text) VALUES
 ('81000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000003','2026-01-01',
  'message_capture_v1','Customer wants a 304 stainless custom exhaust tig welded');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('82000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-01-01',
  'retained_work_specification_interpretation_v1',jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','specification',
  'work_order_id','30000000-0000-0000-0000-000000000001','specification_stage','requested','line_item_id',:'op1',
  'material_role','workpiece','material_label','304 stainless','material_key','stainless_steel.304','process_label','tig','process_key','welding.tig',
  'basis_observation_id','81000000-0000-0000-0000-000000000001','basis_excerpt','304 stainless custom exhaust tig welded')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('82000000-0000-0000-0000-000000000001');
RESET ROLE;
CREATE FUNCTION public.qstate(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT work_order_quote_state(p_wo) $$;
CREATE FUNCTION public.co(p_changes jsonb,p_reason text DEFAULT 'Customer asked for a change',p_base uuid DEFAULT NULL,
  p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT issue_change_order(p_wo,COALESCE(p_base,(SELECT (qstate(p_wo)#>>'{current_quote,quote_id}')::uuid)),p_changes,p_reason) $$;
CREATE FUNCTION public.qread(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_quotes_read(p_wo) $$;
GRANT EXECUTE ON FUNCTION public.co(jsonb,text,uuid,uuid),public.qstate(uuid),public.qread(uuid) TO anon,authenticated,service_role;
SET ROLE service_role;
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(work_order_quote_scope_snapshot('30000000-0000-0000-0000-000000000001')->'specifications') s
  WHERE s->>'id'='82000000-0000-0000-0000-000000000001' AND s->>'material_key'='stainless_steel.304'),'specification is part of the quoted scope');
RESET ROLE;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue() AS i1 \gset
SELECT (:'i1'::jsonb)->>'quote_id' AS q1 \gset
SELECT (:'i1'::jsonb)->>'quote_hash' AS h1 \gset
SELECT t_assert(t_refused_with($q$SELECT co('[{"action":"remove","line_index":1}]')$q$,'amends an accepted quote'),'no change order before the quote is accepted');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(:'q1',:'h1');
SELECT t_assert(t_refused_with($q$SELECT co('[{"action":"remove","line_index":1}]')$q$,'customer cannot'),'the customer cannot issue a change order');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT co('[{"action":"remove","line_index":1}]')$q$,'unavailable for change orders'),'a stranger cannot issue a change order');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(qread()#>'{viewer,issuer_actions}' @> jsonb_build_array(jsonb_build_object('action','issue_change_order','args',jsonb_build_object('p_base_quote_id',:'q1'))),
  'issuer: issue_change_order action on the accepted quote');
SELECT t_assert(t_refused_with(format('SELECT co(%L,%L,%L)','[{"action":"remove","line_index":1}]','x','30000000-0000-0000-0000-000000000009'),'current quote')
 AND t_refused_with($q$SELECT co('[{"action":"remove","line_index":2}]')$q$,'line_index')
 AND t_refused_with($q$SELECT co('[{"action":"remove","line_index":1},{"action":"modify","line_index":1,"line":{}}]')$q$,'changed once')
 AND t_refused_with($q$SELECT co('[]')$q$,'1 to 100')
 AND t_refused_with($q$SELECT co('[{"action":"rename","line_index":0}]')$q$,'Invalid change')
 AND t_refused_with($q$SELECT co('[{"action":"substitute","specification_id":"82000000-0000-0000-0000-000000000001","field":"material","from_key":"mild_steel","to_key":"stainless_steel.321"}]')$q$,'substitution')
 AND t_refused_with($q$SELECT co('[{"action":"substitute","specification_id":"82000000-0000-0000-0000-0000000000ff","field":"material","from_key":"stainless_steel.304","to_key":"stainless_steel.321"}]')$q$,'substitution')
 AND t_refused_with($q$SELECT co('[{"action":"remove","line_index":1}]','  ')$q$,'reason')
 AND t_refused_with(format('SELECT co(%L)',jsonb_build_array(jsonb_build_object('action','modify','line_index',0,'line',(SELECT lines()->0)))),'changes something')
 AND t_refused_with($q$SELECT co('[{"action":"add","line":{"ref_kind":"fee","ref_id":null,"description":"x","pricing_basis":"bogus"}}]')$q$,'Invalid quote line'),
 'base, indexes, actions, substitution keys, reason, no-op and line validity checked');

SELECT co(jsonb_build_array(
  jsonb_build_object('action','modify','line_index',0,'line',(SELECT lines(175)->0)),
  jsonb_build_object('action','remove','line_index',1),
  jsonb_build_object('action','add','line',jsonb_build_object('ref_kind','fee','ref_id',NULL,'description','Extra flange gaskets','pricing_basis','flat',
    'amount',25,'currency','USD','unit',NULL,'quantity',NULL)),
  jsonb_build_object('action','substitute','specification_id','82000000-0000-0000-0000-000000000001','field','material',
    'from_key','stainless_steel.304','to_key','stainless_steel.321','to_label','321 stainless')),
  'Switch to 321 stainless; inspection fee dropped') AS c2 \gset
SELECT (:'c2'::jsonb)->>'quote_id' AS q2 \gset
SELECT (:'c2'::jsonb)->>'quote_hash' AS h2 \gset
SELECT t_assert((:'c2'::jsonb) @> jsonb_build_object('version',2,'base_quote_id',:'q1','duplicate',false,'payment_authorized',false,
   'accept_with',jsonb_build_object('rpc','accept_work_order_quote','p_quote_id',:'q2','p_quote_hash',:'h2'))
 AND (:'c2'::jsonb)#>'{change_order,changes}' @> '[{"action":"modify","base_line_index":0,"new_line_index":0},{"action":"remove","base_line_index":1},
   {"action":"add","new_line_index":1},{"action":"substitute","specification":{"field":"material","from_key":"stainless_steel.304","to_key":"stainless_steel.321",
   "from_label":"304 stainless","to_label":"321 stainless","specification_id":"82000000-0000-0000-0000-000000000001"}}]'
 AND (:'c2'::jsonb)#>>'{change_order,changes,0,from_line,amount}'='150' AND (:'c2'::jsonb)#>>'{change_order,changes,0,to_line,amount}'='175'
 AND NOT (:'c2'::jsonb)#>'{change_order,changes,1}' ? 'new_line_index'
 AND jsonb_array_length((:'c2'::jsonb)->'lines')=2 AND (:'c2'::jsonb)#>>'{lines,1,description}'='Extra flange gaskets'
 AND (:'c2'::jsonb)#>>'{change_order,base_quote_hash}'=:'h1','change order: new version with an explicit diff against the accepted quote');
SELECT t_assert((co(jsonb_build_array(
  jsonb_build_object('action','modify','line_index',0,'line',(SELECT lines(175)->0)),
  jsonb_build_object('action','remove','line_index',1),
  jsonb_build_object('action','add','line',jsonb_build_object('ref_kind','fee','ref_id',NULL,'description','Extra flange gaskets','pricing_basis','flat',
    'amount',25,'currency','USD','unit',NULL,'quantity',NULL)),
  jsonb_build_object('action','substitute','specification_id','82000000-0000-0000-0000-000000000001','field','material',
    'from_key','stainless_steel.304','to_key','stainless_steel.321','to_label','321 stainless')),
  'Switch to 321 stainless; inspection fee dropped',:'q1')->>'duplicate')::boolean,'repeat is a duplicate');
RESET ROLE;

SELECT t_assert(work_order_change_orders_live() AND work_order_quote_is_change_order(:'q2') AND NOT work_order_quote_is_change_order(:'q1'),
  'signature-queue hooks: change orders live; v2 is one, v1 is not');
SELECT t_assert(qstate() @> jsonb_build_object('current_quote',jsonb_build_object('quote_id',:'q2','is_change_order',true),
   'change_order',jsonb_build_object('state','pending','base_quote_id',:'q1','base_version',1,'changes',4),
   'acceptance',jsonb_build_object('state','withheld','withheld_reason','quote_superseded')),'quote state: change order pending; base acceptance superseded');
SELECT t_assert(jp('terms')->'gaps' @> '["change_order_pending"]' AND jp('terms') @> '{"change_order":{"state":"pending","version":2}}',
  'job path: change_order_pending gap and terms');
SET ROLE anon;
SELECT as_user(NULL);
SELECT qread() AS a2 \gset
RESET ROLE;
SELECT t_assert((:'a2'::jsonb) @> jsonb_build_object('current_quote',jsonb_build_object('quote_id',:'q2','is_change_order',true,
   'change_order',jsonb_build_object('reason','Switch to 321 stainless; inspection fee dropped')),'change_order',jsonb_build_object('state','pending'))
 AND (:'a2'::jsonb)#>'{history}' @> jsonb_build_array(jsonb_build_object('quote_id',:'q1','is_change_order',false,'state','superseded'))
 AND (:'a2'::jsonb)#>'{viewer,actions}'='[]'::jsonb AND (:'a2'::jsonb)#>>'{current_quote,quoting_party,attribution}'='authenticated_sign',
 'anon: change order open with its diff, reason and authenticated issuer; base in history');

-- Only the Sign records a change order.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('83000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000003',now(),
  'message_interpretation_v1',jsonb_build_object('work_order_resource',(SELECT structured_data->'work_order_resource' FROM vehicle_observations WHERE id=:'q2')
   || jsonb_build_object('quote_version',3,'supersedes_quote_id',:'q2','quoting_party',jsonb_build_object('kind','unknown','id',NULL))));
SET ROLE service_role;
SELECT t_assert(t_refused_with($q$SELECT project_work_order_resource_observation('83000000-0000-0000-0000-000000000001')$q$,'only by issue_change_order'),
  'a change-order envelope from any other source is refused');
RESET ROLE;

-- The customer accepts the change order through the quote acceptance path.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(qread()#>'{viewer,actions}' @> jsonb_build_array(jsonb_build_object('action','accept_quote','args',jsonb_build_object('p_quote_id',:'q2','p_quote_hash',:'h2')))
 AND qread()#>'{viewer,issuer_actions}'='[]'::jsonb,'customer: accept_quote on the change order, no issue action');
SELECT t_assert(t_refused(format('SELECT accept_work_order_quote(%L,%L)',:'q1',:'h1')),'the superseded base cannot be re-accepted');
SELECT accept_work_order_quote(:'q2',:'h2');
RESET ROLE;
SELECT t_assert(qstate() @> jsonb_build_object('change_order',jsonb_build_object('state','accepted'),'acceptance',jsonb_build_object('state','accepted','quote_id',:'q2'))
 AND NOT jp('terms')->'gaps' @> '["change_order_pending"]' AND jp('terms') @> '{"customer_acceptance":"signed","change_order":{"state":"accepted"}}',
 'accepted change order: terms signed, no pending gap');

-- A change order on an accepted change order; a personal reason is withheld from non-parties.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT co('[{"action":"remove","line_index":1}]','Fixture Customer called: no gaskets') AS c3 \gset
RESET ROLE;
SELECT t_assert((:'c3'::jsonb) @> jsonb_build_object('version',3,'base_quote_id',:'q2') AND jsonb_array_length((:'c3'::jsonb)->'lines')=1,'change order on a change order');
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(qread()#>'{current_quote,change_order}' @> '{"reason":null,"reason_visibility":"withheld_personal"}'
 AND NOT qread()::text ~ 'Fixture Customer','anon: personal change-order reason withheld');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(qread()#>>'{current_quote,change_order,reason}'='Fixture Customer called: no gaskets','customer (party) sees the reason');
RESET ROLE;

-- Accept clocks count cosigner terms only while binding.
SELECT jp('terms')->>'assignments_with_accept_clock' AS clk0 \gset
INSERT INTO user_tools VALUES ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT offer(:'rskill') AS o0 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT cosign_provider('30000000-0000-0000-0000-000000000001',((:'o0'::jsonb)->>'offer_id')::uuid,ARRAY['availability'],'TIG welder on site',
  '{"basis":"flat","amount":50,"currency":"USD"}') AS cs \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_offer(((:'o0'::jsonb)->>'offer_id')::uuid,(:'cs'::jsonb)->>'terms_hash');
RESET ROLE;
SELECT t_assert((jp('terms')->>'assignments_with_accept_clock')::int=(:'clk0')::int+2,'provider and binding cosigner terms are accept clocks');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT cosign_provider('30000000-0000-0000-0000-000000000001',((:'o0'::jsonb)->>'offer_id')::uuid,ARRAY['availability'],'TIG welder on site',
  '{"basis":"flat","amount":60,"currency":"USD"}');
RESET ROLE;
SELECT t_assert((jp('terms')->>'assignments_with_accept_clock')::int=(:'clk0')::int AND jp('terms')->'gaps' @> '["provider_acceptance_withheld"]',
  'a changed co-sign withdraws both accept clocks');

SELECT t_assert(has_function_privilege('authenticated','issue_change_order(uuid,uuid,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('anon','issue_change_order(uuid,uuid,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','issue_change_order(uuid,uuid,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_change_order_apply(jsonb,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_quote_issuer_role(uuid,uuid)','EXECUTE')
 AND has_function_privilege('anon','work_order_quotes_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','read_work_order_job_path(uuid)','EXECUTE'),'grants: change-order Sign authenticated-only; helpers internal; reader open');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('issue_change_order','work_order_change_order_apply','work_order_quote_issuer_role',
 'project_work_order_quote_event','work_order_quote_for_viewer','work_order_quote_state','work_order_quotes_read','read_work_order_job_path');
