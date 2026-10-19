-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Provider quote Sign (issue_work_order_quote): eligibility, write path, idempotency, refusals.
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
\ir ../migrations/20261019150000_inspection_request.sql
\ir ../migrations/20261019180000_work_order_offers.sql
\ir ../migrations/20261019182000_work_order_offer_acceptance.sql
\ir ../migrations/20261019183000_work_order_offers_read.sql
\ir ../migrations/20261019184500_inspection_access.sql


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

SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT issue()$q$),'anonymous issue refused');
RESET ROLE;
SET ROLE service_role;
SELECT t_assert(t_refused($q$SELECT issue()$q$),'service role cannot sign a quote');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user(NULL);
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'Authentication required'),'no auth.uid() refused');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'unavailable for quoting'),'stranger refused');
SELECT t_assert(t_refused_with($q$SELECT issue('30000000-0000-0000-0000-0000000000ff')$q$,'unavailable for quoting'),'missing work order looks the same');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'unavailable for quoting'),'vehicle owner is not a provider');
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'unavailable for quoting'),'self_claim actor link is not enough');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'customer cannot quote'),'customer cannot quote their own job');

SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT n_obs() AS obs_before \gset
SELECT t_assert(t_refused_with($q$SELECT issue(p_lines=>lines(150,NULL))$q$,'Invalid quote line'),'amount without currency refused');
SELECT t_assert(t_refused_with($q$SELECT issue(p_valid=>'2026-01-01')$q$,'validity must end after'),'validity in the past refused');
SELECT t_assert(t_refused($q$SELECT issue(p_supersedes=>gen_random_uuid())$q$),'first quote cannot name a superseded quote');
SELECT t_assert(n_obs()=:obs_before,'refused issues leave no observation behind');
SELECT issue() AS i1 \gset
SELECT t_assert((:'i1'::jsonb)->>'version'='1' AND (:'i1'::jsonb)->>'duplicate'='false' AND (:'i1'::jsonb)->>'issued_by_role'='performer'
 AND (:'i1'::jsonb)#>>'{quoting_party,id}'='10000000-0000-0000-0000-00000000000f' AND (:'i1'::jsonb)->>'quote_hash' ~ '^[0-9a-f]{64}$'
 AND (:'i1'::jsonb)->>'payment_authorized'='false' AND (:'i1'::jsonb)->>'customer_notified'='false','evidenced performer issues version 1');
SELECT t_assert((issue()->>'duplicate')::boolean AND issue()->>'quote_id'=(:'i1'::jsonb)->>'quote_id','repeat request returns the same quote');
RESET ROLE;
SELECT (:'i1'::jsonb)->>'quote_id' AS q1 \gset
SELECT t_assert((SELECT x.quote_hash=(:'i1'::jsonb)->>'quote_hash' AND x.quoting_party_kind='user' AND x.quoting_user_id='10000000-0000-0000-0000-00000000000f'
 AND o.submitted_by_user_id=x.quoting_user_id AND o.source_id='90000000-0000-0000-0000-000000000002' AND o.kind='work_record'
 AND o.extraction_method='work_order_quote_issue_sign_v1' AND o.observed_at=o.source_event_at
 AND o.structured_data#>>'{work_order_resource,issued_by_role}'='performer'
 FROM work_order_quotes x JOIN vehicle_observations o ON o.id=x.id WHERE x.id=:'q1'),'quote row and owner-input source record the signer as quoting party');
SELECT t_assert((SELECT count(*) FROM work_order_quotes WHERE work_order_id='30000000-0000-0000-0000-000000000001')=1,'one quote after the repeat');
SELECT t_assert((SELECT status='quoted' AND quoted_at IS NULL AND approved_at IS NULL FROM work_orders WHERE id='30000000-0000-0000-0000-000000000001'),
 'work order status and clocks are not written');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'current quote version'),'revision must name the current version');
SELECT issue(p_deposit=>'{"amount":200,"currency":"USD"}',p_valid=>'2099-01-01',p_supersedes=>:'q1') AS i2 \gset
SELECT t_assert((:'i2'::jsonb)->>'version'='2' AND (:'i2'::jsonb)->>'supersedes_quote_id'=:'q1' AND (:'i2'::jsonb)->>'issued_by_role'='organization_owner',
 'organization owner issues a revision');
SELECT t_assert(t_refused_with($q$SELECT issue('30000000-0000-0000-0000-000000000004')$q$,'vehicle-bound'),'work order without a vehicle cannot be quoted');
SELECT as_user('10000000-0000-0000-0000-000000000008');
SELECT t_assert(issue('30000000-0000-0000-0000-000000000003',p_lines=>'[{"ref_kind":"fee","ref_id":null,"description":"Bleed","pricing_basis":"per_operation","amount":80,"currency":"USD","unit":"operation","quantity":1}]')->>'issued_by_role'='performer',
 'evidenced bridge to the lead actor qualifies');
SELECT t_assert(t_refused_with($q$SELECT issue()$q$,'unavailable for quoting'),'a bridge to another job''s actor does not qualify');
RESET ROLE;
SELECT (:'i2'::jsonb)->>'quote_id' AS q2 \gset
SELECT (:'i2'::jsonb)->>'quote_hash' AS h2 \gset
SELECT t_assert((SELECT deposit_requested_amount=200 AND valid_until='2099-01-01' AND quoting_user_id='10000000-0000-0000-0000-00000000000e'
 FROM work_order_quotes WHERE id=:'q2') AND (SELECT structured_data#>>'{work_order_resource,issuer_organization_id}'='20000000-0000-0000-0000-000000000001'
 FROM vehicle_observations WHERE id=:'q2'),'revision records deposit term, validity and the organization the owner signed for');

-- The issued quote flows into the customer's acceptance and the reader.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(accept_work_order_quote(:'q2',:'h2')->>'duplicate'='false','customer accepts the issued revision');
SELECT t_assert(work_order_quotes_read('30000000-0000-0000-0000-000000000001')#>>'{acceptance,state}'='accepted'
 AND work_order_quotes_read('30000000-0000-0000-0000-000000000001')#>>'{current_quote,version}'='2','reader shows the issued, accepted version');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2'),'Quote unavailable'),'issuer cannot accept their own quote');
RESET ROLE;

-- Losing the bridge removes eligibility.
UPDATE account_link_claims SET status='expired' WHERE user_id='10000000-0000-0000-0000-00000000000f';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(t_refused_with(format($q$SELECT issue(p_supersedes=>%L)$q$,:'q2'),'unavailable for quoting'),'expired bridge no longer qualifies');
RESET ROLE;
SELECT t_assert(has_function_privilege('authenticated','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)','EXECUTE'),'issue: authenticated only');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('issue_work_order_quote');
