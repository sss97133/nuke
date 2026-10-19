-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- The open quote reader (work_order_quotes_read) under the privacy doctrine: anon and authenticated faces.
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
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,year integer,make text,model text,trim text,is_public boolean);
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
\ir ../migrations/20261019093000_job_readers_authenticated.sql
\ir ../migrations/20261019094500_work_order_quotes.sql
\ir ../migrations/20261019120000_work_order_quote_issue.sql
\ir ../migrations/20261019121500_open_job_readers.sql
\ir ../migrations/20261019123000_work_order_job_path_quotes.sql
\ir ../migrations/20261019124500_work_order_quotes_open_read.sql


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

-- Vehicles 1 and 2 public, 3 private. Profiles: customer and performer public with handles; shop owner private.
UPDATE vehicles SET is_public=(id<>'40000000-0000-0000-0000-000000000003'),year=1972,make='Chevrolet',model='K10',trim='Cheyenne';
INSERT INTO profiles(id,username,full_name,is_public,email,phone) VALUES
 ('10000000-0000-0000-0000-00000000000c','cust_handle','Fixture Customer',true,'fixture@example.invalid','+15550100'),
 ('10000000-0000-0000-0000-00000000000f','fab_pro','Private Fabricator Name',true,NULL,NULL),
 ('10000000-0000-0000-0000-00000000000e','shop_owner','Private Owner Name',false,NULL,NULL);
UPDATE organizations SET business_name='Fixture Fab Shop' WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE work_orders SET request_source='sms' WHERE id='30000000-0000-0000-0000-000000000001';
INSERT INTO work_order_parts(id,work_order_id,part_name,quantity,status) VALUES
 ('d0000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000001','Fixture spare tire',1,'quoted');
CREATE FUNCTION public.rd(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_quotes_read(p_wo) $$;
GRANT EXECUTE ON FUNCTION public.rd(uuid) TO anon, authenticated, service_role;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT issue(p_lines=>lines()||'[{"ref_kind":"part","ref_id":"d0000000-0000-0000-0000-000000000009","description":"Call 555-010-1234 before mounting","pricing_basis":"flat","amount":40,"currency":"USD","unit":null,"quantity":null}]'::jsonb) AS i1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue(p_deposit=>'{"amount":200,"currency":"USD"}',p_valid=>'2099-01-01',p_supersedes=>((:'i1'::jsonb)->>'quote_id')::uuid) AS i2 \gset
RESET ROLE;
SELECT (:'i1'::jsonb)->>'quote_id' AS q1 \gset
SELECT (:'i2'::jsonb)->>'quote_id' AS q2 \gset
SELECT (:'i2'::jsonb)->>'quote_hash' AS h2 \gset

-- Visitor face.
SET ROLE anon;
SELECT as_user(NULL);
SELECT rd() AS a1 \gset
RESET ROLE;
SELECT t_assert((:'a1'::jsonb)->'viewer' @> '{"context":"visitor","slots":[],"actions":[],"money_visible":false,"party":false,"prices_visible":true,"contact_visible":false}',
 'anon: visitor with no slots or actions');
SELECT t_assert((:'a1'::jsonb)#>>'{current_quote,version}'='2' AND (:'a1'::jsonb)#>'{current_quote,totals_by_currency}'='[{"currency":"USD","total":390,"complete":true}]'
 AND (:'a1'::jsonb)#>'{current_quote,deposit_requested}'='{"amount":200,"currency":"USD","nature":"requested_term_not_payment"}'
 AND jsonb_array_length((:'a1'::jsonb)#>'{current_quote,scope_snapshot,operations}')=2
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'a1'::jsonb)#>'{current_quote,lines}') l WHERE l->>'amount'='150' AND l->>'currency'='USD'),
 'anon: prices, totals, deposit term and full scope are open');
SELECT t_assert((:'a1'::jsonb)#>'{vehicle_label}' @> '{"year":1972,"make":"Chevrolet","model":"K10"}' AND (:'a1'::jsonb)->>'display_title'='Exhaust'
 AND (:'a1'::jsonb)->>'request_source_label'='Requested by text message','anon: vehicle_label, display_title and request_source_label from the open header');
SELECT t_assert((:'a1'::jsonb)#>'{current_quote,quoting_party}' @> '{"kind":"user","label":"unnamed party","attribution":"authenticated_sign","issued_by_role":"organization_owner"}'
 AND NOT (:'a1'::jsonb)#>'{current_quote,quoting_party}' ? 'user_id','anon: private-profile quoting party is an unnamed party, signed');
SELECT t_assert((:'a1'::jsonb)#>'{history,0,quoting_party}' @> '{"kind":"user","handle":"fab_pro","profile_id":"10000000-0000-0000-0000-00000000000f","attribution":"authenticated_sign"}'
 AND (:'a1'::jsonb)#>>'{history,0,state}'='superseded' AND (:'a1'::jsonb)#>'{history,0,lines}' IS NOT NULL,'anon: earlier version open, public handle shown');
SELECT t_assert(NOT :'a1' ~ '(Fixture Customer|Private Fabricator Name|Private Owner Name|fixture@example|15550100|555-010-1234|10000000-0000-0000-0000-00000000000e)',
 'anon: no private names, contact data or raw ids of private profiles');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'a1'::jsonb)#>'{current_quote,scope_snapshot,parts}') p
   WHERE p->>'id'='d0000000-0000-0000-0000-000000000009' AND p->'part_name'='null' AND p->>'part_name_visibility'='withheld_personal_info')
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'a1'::jsonb)#>'{history,0,lines}') l WHERE l->>'ref_id'='d0000000-0000-0000-0000-000000000009'
   AND l->'description'='null' AND l->>'description_visibility'='withheld_personal_info' AND l->>'amount'='40'),
 'anon: text naming the customer or carrying a phone number is withheld; its price stays open');

-- Customer face, before and after the Sign.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(rd()#>'{viewer,actions}'=jsonb_build_array(jsonb_build_object('action','accept_quote','rpc','accept_work_order_quote',
 'args',jsonb_build_object('p_quote_id',:'q2','p_quote_hash',:'h2'))) AND rd()#>>'{viewer,context}'='client' AND (rd()#>>'{viewer,party}')::boolean,
 'customer: accept_quote offered for the current version');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(rd()#>'{current_quote,scope_snapshot,parts}') p WHERE p->>'part_name'='Fixture spare tire')
 AND rd()#>>'{current_quote,quoting_party,user_id}'='10000000-0000-0000-0000-00000000000e','customer (party): full text and raw ids');
SELECT t_assert(accept_work_order_quote(:'q2',:'h2')->>'duplicate'='false','customer signs');
SELECT rd() AS c2 \gset
SELECT t_assert((:'c2'::jsonb)->'acceptance' @> '{"state":"accepted","accepted_by_viewer":true,"signer_role":"customer"}'
 AND (:'c2'::jsonb)#>>'{acceptance,signer,user_id}'='10000000-0000-0000-0000-00000000000c' AND (:'c2'::jsonb)#>'{viewer,actions}'='[]'
 AND (:'c2'::jsonb)#>>'{approved_at,derived}'=(:'c2'::jsonb)#>>'{acceptance,signed_at}','customer: accepted, no second action, approved_at derived');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(rd()#>>'{viewer,context}'='provider' AND rd()#>'{viewer,actions}'='[]'::jsonb AND (rd()#>>'{viewer,party}')::boolean
 AND rd()#>'{viewer,slots}' @> '["performer","quoting_party"]','performer who quoted: provider face, no accept action');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(rd()#>>'{viewer,context}'='visitor' AND rd()#>'{viewer,actions}'='[]'::jsonb AND rd()#>>'{acceptance,state}'='accepted'
 AND rd()#>'{acceptance,signer}' @> '{"kind":"user","handle":"cust_handle"}' AND NOT rd()#>'{acceptance,signer}' ? 'user_id',
 'stranger: visitor; signer by public handle, no raw id');
RESET ROLE;
SET ROLE anon;
SELECT t_assert(rd()#>>'{acceptance,state}'='accepted' AND NOT (rd()#>>'{acceptance,accepted_by_viewer}')::boolean,'anon sees acceptance state');
RESET ROLE;

-- Private vehicle: slot holders only. Missing work order: same refusal.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-000000000008');
SELECT issue('30000000-0000-0000-0000-000000000003',p_lines=>'[{"ref_kind":"fee","ref_id":null,"description":"Bleed","pricing_basis":"per_operation","amount":80,"currency":"USD","unit":"operation","quantity":1}]');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(rd('30000000-0000-0000-0000-000000000003')#>>'{current_quote,version}'='1','customer reads the quote on a private vehicle');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT rd('30000000-0000-0000-0000-000000000003')$q$,'Work order unavailable'),'stranger refused on a private vehicle');
RESET ROLE;
SET ROLE anon;
SELECT t_assert(t_refused_with($q$SELECT rd('30000000-0000-0000-0000-000000000003')$q$,'Work order unavailable'),'anon refused on a private vehicle');
SELECT t_assert(t_refused_with($q$SELECT rd('30000000-0000-0000-0000-0000000000ff')$q$,'Work order unavailable'),'missing work order refused');
SELECT t_assert(t_refused(format($q$SELECT accept_work_order_quote(%L,%L)$q$,:'q2',:'h2')),'anon still cannot sign');
RESET ROLE;

-- A withdrawn version shows its summary only.
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'q1';
SET ROLE anon;
SELECT t_assert(rd()#>'{history,0}' @> '{"state":"withdrawn","withheld_reason":"source_withdrawn"}' AND NOT rd()#>'{history,0}' ? 'lines',
 'withdrawn version: summary only');
RESET ROLE;
SELECT t_assert(has_function_privilege('anon','work_order_quotes_read(uuid)','EXECUTE') AND has_function_privilege('authenticated','work_order_quotes_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','work_order_quotes_read(uuid)','EXECUTE')
 AND (SELECT bool_and(NOT has_function_privilege(r,f,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r,
   unnest(ARRAY['work_order_text_is_personal(uuid,text)','work_order_quote_redact(uuid,jsonb,text[])','work_order_quote_for_viewer(uuid,boolean)']) f)
 AND NOT has_function_privilege('anon','accept_work_order_quote(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)','EXECUTE'),
 'reader open to anon and authenticated; internals and writers not to anon');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('work_order_quotes_read','work_order_quote_for_viewer','work_order_quote_redact','work_order_text_is_personal');
