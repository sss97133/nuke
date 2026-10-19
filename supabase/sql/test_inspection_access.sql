-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Seller permission for an inspection: grant_inspection_access (verified owner Sign) -> permission attestation; readers.
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


CREATE TABLE public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,vehicle_id uuid,status text,expires_at timestamptz);
INSERT INTO profiles(id,username,full_name,is_public) VALUES ('10000000-0000-0000-0000-00000000000d','seller_handle','Private Seller Name',true);
CREATE FUNCTION public.ga(p_wo uuid,p_scope text DEFAULT 'Inspect at my driveway; no test drive',p_window jsonb DEFAULT '{"from":"2099-01-01T09:00:00Z","until":"2099-01-01T17:00:00Z"}')
 RETURNS jsonb LANGUAGE sql AS $$ SELECT grant_inspection_access(p_wo,p_scope,p_window) $$;
CREATE FUNCTION public.ir(p_wo uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_inspection_read(p_wo) $$;
CREATE FUNCTION public.jpi(p_wo uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT read_work_order_job_path(p_wo)#>'{stages,inspection}' $$;
GRANT EXECUTE ON FUNCTION public.ga(uuid,text,jsonb),public.ir(uuid),public.jpi(uuid) TO anon,authenticated,service_role;

-- Client C orders a pre-purchase inspection of vehicle 2 (owner V, the seller).
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT request_inspection('40000000-0000-0000-0000-000000000002',NULL,'{"checklist":[{"item_id":"i1","question":"Check the frame"}]}')->>'work_order_id' AS insp \gset
RESET ROLE;
SELECT r.id AS ireq FROM work_order_resource_requirements r WHERE r.work_order_id=:'insp' \gset
SELECT t_assert(jpi(:'insp')->>'seller_permission'='not_established' AND ir(:'insp')#>>'{inspections,0,seller_permission,state}'='not_established',
 'before a grant: not established');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L)$q$,:'insp'),'verified owner'),'an unverified vehicle owner cannot grant');
RESET ROLE;
INSERT INTO ownership_verifications(user_id,vehicle_id,status,expires_at) VALUES
 ('10000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-000000000002','approved',now()+interval '1 year');
SET ROLE authenticated;
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L)$q$,:'insp'),'Accept an inspector offer'),'no accepted inspector yet');
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT offer(:'ireq','{"lines":[{"description":"PPI visit","pricing_basis":"flat","amount":250,"currency":"USD","unit":null,"quantity":null}]}') AS oi \gset
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L)$q$,:'insp'),'verified owner'),'the inspector cannot grant');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L)$q$,:'insp'),'verified owner'),'the buyer cannot grant');
SELECT accept_offer(((:'oi'::jsonb)->>'offer_id')::uuid,(:'oi'::jsonb)->>'offer_hash');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L,'')$q$,:'insp'),'Scope'),'scope required');
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L,'x','{"from":"2020-01-01T00:00:00Z","until":"2020-01-02T00:00:00Z"}')$q$,:'insp'),'Window'),'past window refused');
SELECT t_assert(t_refused_with(format($q$SELECT ga(%L,'x','{"from":"2099-01-01T00:00:00Z"}')$q$,:'insp'),'Window'),'half window refused');
SELECT ga(:'insp') AS g1 \gset
SELECT t_assert((:'g1'::jsonb) @> '{"seller_permission":"established","inspector_role":"inspector","vehicle_access_rows_changed":false,"duplicate":false,
 "scope":"Inspect at my driveway; no test drive","window":{"from":"2099-01-01T09:00:00+00:00","until":"2099-01-01T17:00:00+00:00"}}'
 AND (:'g1'::jsonb)->>'offer_id'=(:'oi'::jsonb)->>'offer_id','verified owner grants the accepted inspector access for a window');
SELECT t_assert((ga(:'insp')->>'duplicate')::boolean,'repeat grant is idempotent');
RESET ROLE;
SELECT t_assert((SELECT a.attestation_kind='permission' AND a.verdict='supports' AND a.attestor_user_id='10000000-0000-0000-0000-00000000000d'
 AND a.fulfillment_id=((:'oi'::jsonb)->>'offer_id')::uuid AND o.submitted_by_user_id=a.attestor_user_id AND o.extraction_method='inspection_access_sign_v1'
 FROM work_order_resource_attestations a JOIN vehicle_observations o ON o.id=a.id WHERE a.id=((:'g1'::jsonb)->>'attestation_id')::uuid),
 'permission attestation signed by the attestor on the inspector''s offer');
SELECT t_assert(NOT vehicle_user_has_access('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000009')
 AND (SELECT count(*) FROM vehicle_access_grants)=0,'no vehicle access rows changed');
SET ROLE anon;
SELECT as_user(NULL);
SELECT ir(:'insp') AS a1 \gset
RESET ROLE;
SELECT t_assert((:'a1'::jsonb)#>'{inspections,0,seller_permission}' @> '{"state":"established","scope":"Inspect at my driveway; no test drive",
 "granted_by":{"kind":"user","handle":"seller_handle"}}' AND NOT (:'a1'::jsonb)#>'{inspections,0,seller_permission,granted_by}' ? 'user_id'
 AND NOT :'a1' ~ 'Private Seller Name','anon inspection reader: permission established, seller by handle');
SELECT t_assert(jpi(:'insp')->>'seller_permission'='established','job path: seller permission established');

-- Withheld: a revised inspector offer, or a lapsed verification, no longer carries the permission.
UPDATE ownership_verifications SET expires_at=now()-interval '1 day' WHERE user_id='10000000-0000-0000-0000-00000000000d';
SELECT t_assert(ir(:'insp')#>>'{inspections,0,seller_permission,state}'='not_established','lapsed owner verification withholds the permission');
UPDATE ownership_verifications SET expires_at=now()+interval '1 year' WHERE user_id='10000000-0000-0000-0000-00000000000d';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT offer(:'ireq','{"lines":[{"description":"PPI visit","pricing_basis":"flat","amount":275,"currency":"USD","unit":null,"quantity":null}]}');
RESET ROLE;
SELECT t_assert(ir(:'insp')#>>'{inspections,0,seller_permission,state}'='not_established' AND jpi(:'insp')->>'seller_permission'='not_established',
 'a revised inspector offer withholds the permission');
SELECT t_assert(has_function_privilege('authenticated','grant_inspection_access(uuid,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','grant_inspection_access(uuid,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','grant_inspection_access(uuid,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','inspection_seller_permission(uuid,boolean)','EXECUTE')
 AND NOT has_function_privilege('authenticated','vehicle_verified_owner(uuid,uuid)','EXECUTE'),'grants');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('grant_inspection_access','inspection_seller_permission','vehicle_verified_owner',
 'work_order_inspection_view','read_work_order_job_path');
