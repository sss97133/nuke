-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Co-sign gate (cosign_provider): authenticated co-signs on offers, cut terms bound by accept_offer, readers.
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

-- Co-sign gate. P2 (..09) self_claim offers; O (..0e) owner of ORG1 co-signs for ORG1; T (..0b) owns tools and co-signs
-- for itself; S (..07) has neither; C (..0c) is the customer.
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000007');
UPDATE organizations SET name='Fixture Fab Shop', business_name='Fixture Fab Shop' WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO organizations VALUES ('20000000-0000-0000-0000-000000000002','Other Shop','Other Shop');
INSERT INTO user_tools VALUES ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b');
INSERT INTO profiles(id,username,full_name,is_public) VALUES ('10000000-0000-0000-0000-00000000000b','tool_owner','Private Toolowner Name',true);
CREATE FUNCTION public.cosign(p_offer uuid,p_kinds text[],p_scope text,p_cut jsonb DEFAULT NULL,
  p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT cosign_provider(p_wo,p_offer,p_kinds,p_scope,p_cut) $$;
CREATE FUNCTION public.res(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_resources_read(p_wo) $$;
CREATE FUNCTION public.asg() RETURNS SETOF public.work_order_assignments LANGUAGE sql SECURITY DEFINER AS $$
 SELECT * FROM work_order_assignments WHERE work_order_id='30000000-0000-0000-0000-000000000001' AND role='cosigner' $$;
GRANT EXECUTE ON FUNCTION public.cosign(uuid,text[],text,jsonb,uuid),public.res(uuid),public.asg() TO anon,authenticated,service_role;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT offer(:'rskill') AS o0 \gset
RESET ROLE;
SELECT (:'o0'::jsonb)->>'offer_id' AS f0 \gset
SELECT (:'o0'::jsonb)->>'offer_hash' AS h0 \gset
SET ROLE service_role;
SELECT t_assert(work_order_offer_terms_hash(:'f0')=:'h0' AND work_order_offer_cosigns(:'f0')='[]'::jsonb,'no co-signs: terms hash is the offer hash');
RESET ROLE;
-- A testimony-only attestation (not signed by the attestor) stays attributed, not authenticated.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('b0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000003','2026-01-04',
  'message_interpretation_v1',jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','attestation',
  'work_order_id','30000000-0000-0000-0000-000000000001','fulfillment_id',:'f0','attestor_organization_id','20000000-0000-0000-0000-000000000001',
  'attestation_kind','supervision','verdict','supports','scope','Message says the shop supervises')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('b0000000-0000-0000-0000-000000000001');
RESET ROLE;

-- Refusals.
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused($q$SELECT cosign(:'f0',ARRAY['supervision'],'Bay 2')$q$),'anon cannot co-sign');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-000000000007');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'')',:'f0'),'needs_facility_organization_or_owned_tools'),'no facility, no tools: refused');
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'')',:'f0'),'cannot_cosign_own_offer'),'offering account cannot co-sign itself');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'')',:'f0'),'customer_cannot_cosign'),'customer cannot co-sign');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'',''{"organization_id":"20000000-0000-0000-0000-000000000002"}'')',:'f0'),'not_organization_member'),'cannot co-sign for an organization one is not part of');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'',NULL,''30000000-0000-0000-0000-000000000003'')',:'f0'),'offer_not_on_this_work_order'),'offer must be on the named work order');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''skill''],''Bay 2'')',:'f0'),'Kinds must be')
 AND t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision'',''supervision''],''Bay 2'')',:'f0'),'Kinds must be')
 AND t_refused_with(format('SELECT cosign(%L,ARRAY[]::text[],''Bay 2'')',:'f0'),'Kinds must be'),'kinds: only supervision/suitability/permission/availability, distinct, nonempty');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''  '')',:'f0'),'Scope'),'scope required');
SELECT t_assert(t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'',''{"basis":"share_of_labor_line","percentage":150}'')',:'f0'),'Cut must be')
 AND t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'',''{"basis":"flat","amount":50}'')',:'f0'),'Cut must be')
 AND t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'',''{"basis":"day_rate","amount":50,"currency":"USD"}'')',:'f0'),'Cut must be')
 AND t_refused_with(format('SELECT cosign(%L,ARRAY[''supervision''],''Bay 2'',''{"basis":"bonus","amount":5,"currency":"USD"}'')',:'f0'),'Cut must be'),
 'cut: share in (0,100]; amounts carry a currency; day_rate per day; known bases only');

-- O co-signs for ORG1 with a 15% share of the labor line; T co-signs for itself with a flat 50 USD cut.
SELECT n_obs() AS n_before \gset
SELECT cosign(:'f0',ARRAY['supervision','permission'],'Supervised TIG work in ORG1 bay 2',
  '{"basis":"share_of_labor_line","percentage":15}') AS cs1 \gset
SELECT t_assert((:'cs1'::jsonb) @> '{"kinds":["permission","supervision"],"cut":{"basis":"share_of_labor_line","percentage":15},"duplicate":false,
  "binding":"on_offer_acceptance","payment_authorized":false,"customer_notified":false}'
 AND (:'cs1'::jsonb)#>>'{co_signer,kind}'='organization' AND (:'cs1'::jsonb)#>>'{co_signer,organization_id}'='20000000-0000-0000-0000-000000000001'
 AND jsonb_array_length((:'cs1'::jsonb)->'attestation_ids')=2 AND n_obs()=(:'n_before')::int+3,'org owner co-signs for the organization: header plus one attestation per kind');
SELECT t_assert((cosign(:'f0',ARRAY['permission','supervision'],'Supervised TIG work in ORG1 bay 2','{"basis":"share_of_labor_line","percentage":15}')->>'duplicate')::boolean
 AND n_obs()=(:'n_before')::int+3,'repeat co-sign is a duplicate');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT cosign(:'f0',ARRAY['availability'],'TIG welder available on site 2099-01-02',
  '{"as":"self","basis":"flat","amount":50,"currency":"USD"}') AS cs2 \gset
SELECT t_assert((:'cs2'::jsonb)#>>'{co_signer,kind}'='user' AND (:'cs2'::jsonb)#>>'{co_signer,user_id}'='10000000-0000-0000-0000-00000000000b'
 AND (:'cs2'::jsonb)->'cut'='{"basis":"flat","amount":50,"currency":"USD"}'::jsonb,'tool owner co-signs for itself with a flat cut');
RESET ROLE;
SELECT (:'cs1'::jsonb)->>'cosign_id' AS c1 \gset
SELECT (:'cs2'::jsonb)->>'terms_hash' AS th1 \gset
SET ROLE service_role;
SELECT t_assert(:'th1' ~ '^[0-9a-f]{64}$' AND :'th1'<>:'h0' AND work_order_offer_terms_hash(:'f0')=:'th1'
 AND jsonb_array_length(work_order_offer_cosigns(:'f0'))=2,'co-signs change the terms hash');
RESET ROLE;

-- Readers: co-signs and cuts are open terms; co-signers by organization name or public handle; raw ids to parties.
SET ROLE anon;
SELECT as_user(NULL);
SELECT ofr() AS a1 \gset
SELECT res() AS r1 \gset
RESET ROLE;
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'a1'::jsonb)->'requirements') r, jsonb_array_elements(r->'offers') o
   WHERE o->>'offer_id'=:'f0' AND o->>'terms_hash'=:'th1' AND jsonb_array_length(o->'co_signs')=2
   AND o->'co_signs' @> '[{"co_signer":{"kind":"organization","name":"Fixture Fab Shop"},"kinds":["permission","supervision"],"cut":{"basis":"share_of_labor_line","percentage":15},
     "attribution":"authenticated_sign","binding":"on_offer_acceptance"}]'
   AND o->'co_signs' @> '[{"co_signer":{"handle":"tool_owner"},"cut":{"basis":"flat","amount":50,"currency":"USD"}}]')
 AND NOT :'a1' ~ '(Private Toolowner Name|"user_id": "10000000-0000-0000-0000-00000000000b")','anon: co-signs and cuts open; co-signers by name or public handle; no private names or raw user ids');
SELECT t_assert((SELECT count(*) FROM jsonb_array_elements((:'r1'::jsonb)->'attestations') a
   WHERE a->>'attestor_basis'='authenticated_sign')=3
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'r1'::jsonb)->'attestations') a
   WHERE a->>'id'='b0000000-0000-0000-0000-000000000001' AND a->>'attestor_basis'='attributed_by_source_testimony'),
 'resources reader: signed co-sign attestations authenticated; testimony stays attributed');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(ofr()#>'{viewer,actions}' @> jsonb_build_array(jsonb_build_object('action','cosign_provider',
  'args',jsonb_build_object('p_offer_id',:'f0'),'as',jsonb_build_object('attestor_kind','organization'))),'org owner: cosign_provider action for the organization');
SELECT as_user('10000000-0000-0000-0000-000000000007');
SELECT t_assert(NOT ofr()#>'{viewer,actions}' @> '[{"action":"cosign_provider"}]','stranger without facility or tools: no cosign action');

-- Acceptance pins the offer and its current co-signs.
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT ofr() AS cr1 \gset
SELECT t_assert((:'cr1'::jsonb)#>'{viewer,actions}' @> jsonb_build_array(jsonb_build_object('action','accept_offer','args',jsonb_build_object('p_offer_id',:'f0','p_offer_hash',:'th1')))
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'cr1'::jsonb)->'requirements') r, jsonb_array_elements(r->'offers') o, jsonb_array_elements(o->'co_signs') c
   WHERE o->>'offer_id'=:'f0' AND c#>>'{co_signer,user_id}'='10000000-0000-0000-0000-00000000000b'),'customer: accept action carries the terms hash; parties see raw co-signer ids');
SELECT t_assert(t_refused_with(format('SELECT accept_offer(%L,%L)',:'f0',:'h0'),'current co-signs'),'the bare offer hash no longer accepts a co-signed offer');
SELECT accept_offer(:'f0',:'th1') AS acc1 \gset
SELECT t_assert((:'acc1'::jsonb)->>'terms_hash'=:'th1' AND (:'acc1'::jsonb)->>'cosigner_terms'='2','acceptance binds both cosigner terms');
SELECT t_assert((accept_offer(:'f0',:'th1')->>'duplicate')::boolean,'repeat acceptance is a duplicate');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM asg())=2
 AND EXISTS (SELECT 1 FROM asg() a WHERE a.cosigner_organization_id='20000000-0000-0000-0000-000000000001' AND a.payout_type='percentage'
   AND a.payout_percentage=15 AND a.payout_rate IS NULL AND a.cosign_observation_id=:'c1' AND a.status='accepted' AND a.payout_status='unpaid')
 AND EXISTS (SELECT 1 FROM asg() a WHERE a.cosigner_user_id='10000000-0000-0000-0000-00000000000b' AND a.payout_type='flat' AND a.payout_rate=50
   AND a.payout_currency='USD')
 AND EXISTS (SELECT 1 FROM work_order_assignments a WHERE a.fulfillment_id=:'f0' AND a.offer_hash=:'h0' AND a.accepted_terms_hash=:'th1'),
 'cosigner rows: separate unpaid compensation terms; provider row pins offer and terms hashes');
SET ROLE service_role;
SELECT t_assert((SELECT count(*) FROM work_order_accepted_providers('30000000-0000-0000-0000-000000000001') WHERE offer_id=:'f0')=1
 AND (SELECT count(*) FROM work_order_accepted_cosigners('30000000-0000-0000-0000-000000000001'))=2,'accepted provider and both cosigner terms current');
RESET ROLE;
SELECT t_assert(t_refused_with($q$UPDATE work_order_assignments SET payout_percentage=30 WHERE role='cosigner'$q$,'immutable')
 AND t_refused_with($q$DELETE FROM work_order_assignments WHERE role='cosigner'$q$,'retained')
 AND t_refused_with(format($q$INSERT INTO work_order_assignments(work_order_id,role,status,accepted_at,cosigner_user_id,cosign_observation_id,cosign_acceptance_observation_id)
   VALUES ('30000000-0000-0000-0000-000000000001','cosigner','accepted',now(),'10000000-0000-0000-0000-000000000007',%L,%L)$q$,:'c1',(:'acc1'::jsonb)->>'acceptance_observation_id'),'only by accept_offer'),
 'cosigner terms are immutable, retained and written only by accept_offer');
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(ofr()->'accepted_cosigners' @> '[{"co_signer":{"kind":"organization","name":"Fixture Fab Shop"},"cut":{"pricing_basis":"percentage","percentage":15}},
  {"co_signer":{"handle":"tool_owner"},"cut":{"pricing_basis":"flat","amount":50,"currency":"USD"}}]'
 AND NOT (ofr()->'accepted_cosigners')::text ~ '("user_id"|Private Toolowner Name)','anon: accepted cosigner terms open, no raw user ids');
RESET ROLE;

-- A changed co-sign withholds the acceptance and its cosigner terms until the customer accepts again.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT cosign(:'f0',ARRAY['supervision'],'Supervised TIG work in ORG1 bay 2','{"basis":"share_of_labor_line","percentage":20}') AS cs3 \gset
RESET ROLE;
SELECT t_assert((:'cs3'::jsonb)->>'supersedes_cosign_id'=:'c1' AND (:'cs3'::jsonb)->>'terms_hash'<>:'th1'
 AND (SELECT bool_and(is_superseded) FROM vehicle_observations WHERE id=:'c1' OR source_identifier='work_order_cosign_attestation:'||:'c1')
 AND (SELECT superseded_by::text FROM vehicle_observations WHERE id=:'c1')=(:'cs3'::jsonb)->>'cosign_id','re-co-sign supersedes the earlier header and attestations');
SELECT (:'cs3'::jsonb)->>'terms_hash' AS th2 \gset
SET ROLE service_role;
SELECT t_assert((SELECT count(*) FROM work_order_accepted_providers('30000000-0000-0000-0000-000000000001') WHERE offer_id=:'f0')=0
 AND (SELECT count(*) FROM work_order_accepted_cosigners('30000000-0000-0000-0000-000000000001'))=0
 AND NOT work_order_attestation_authenticated(((:'cs1'::jsonb)#>>'{attestation_ids,0}')::uuid),'co-sign change withholds acceptance and cosigner terms');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(ofr()->'requirements') r, jsonb_array_elements(r->'offers') o
   WHERE o->>'offer_id'=:'f0' AND o#>>'{acceptance,state}'='withheld' AND o->>'terms_hash'=:'th2' AND jsonb_array_length(o->'co_signs')=2)
 AND ofr()->'accepted_cosigners'='[]'::jsonb,'anon: offer acceptance withheld; no binding cosigner terms');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(ofr()#>'{viewer,actions}' @> jsonb_build_array(jsonb_build_object('action','accept_offer','args',jsonb_build_object('p_offer_id',:'f0','p_offer_hash',:'th2')))
 AND t_refused(format('SELECT accept_offer(%L,%L)',:'f0',:'th1')),'customer: stale terms hash refused; new one offered');
SELECT accept_offer(:'f0',:'th2') AS acc2 \gset
RESET ROLE;
SET ROLE service_role;
SELECT t_assert((SELECT count(*) FROM work_order_accepted_providers('30000000-0000-0000-0000-000000000001') WHERE offer_id=:'f0')=1
 AND (SELECT count(*) FROM work_order_accepted_cosigners('30000000-0000-0000-0000-000000000001'))=2
 AND EXISTS (SELECT 1 FROM work_order_accepted_cosigners('30000000-0000-0000-0000-000000000001') WHERE payout_percentage=20),
 're-acceptance binds the current co-signs only');
RESET ROLE;

-- Prior behaviour: an offer without co-signs keeps its offer hash as terms hash (offers_read contract above unchanged).
SELECT t_assert(has_function_privilege('authenticated','cosign_provider(uuid,uuid,text[],text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','cosign_provider(uuid,uuid,text[],text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','cosign_provider(uuid,uuid,text[],text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_offer_cosigns(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_offer_terms_hash(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_cosign_eligibility(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_accepted_cosigners(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','work_order_attestation_authenticated(uuid)','EXECUTE')
 AND has_function_privilege('anon','work_order_offers_read(uuid)','EXECUTE') AND has_function_privilege('anon','work_order_resources_read(uuid)','EXECUTE'),
 'grants: cosign Sign authenticated-only; helpers internal; readers open');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('cosign_provider','work_order_offer_cosigns','work_order_offer_terms_hash',
 'work_order_cosign_eligibility','work_order_cosign_cut_normalize','work_order_accepted_cosigners','work_order_attestation_authenticated',
 'work_order_org_member','project_work_order_offer_event','work_order_assignment_guard','work_order_accepted_providers','accept_offer',
 'work_order_offers_read','work_order_resources_read');
