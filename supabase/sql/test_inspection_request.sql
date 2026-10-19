-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Inspection as its own job: request_inspection (client Sign), the parent link and its guard.
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
 deposit_cents integer,lead_actor_id uuid,scope_category text,created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,is_public boolean DEFAULT true,merged_into_vehicle_id uuid);
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
\ir ../migrations/20261019153000_job_path_inspection.sql
\ir ../migrations/20261019180000_work_order_offers.sql
\ir ../migrations/20261019181500_work_order_offer_acceptance.sql
\ir ../migrations/20261019183000_work_order_offers_read.sql


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


-- Vehicle 2 public, owned by V (the seller in a pre-purchase case); vehicle 3 private with no owner; vehicle 5 private, V's.
UPDATE vehicles SET is_public=(id<>'40000000-0000-0000-0000-000000000003');
INSERT INTO vehicles(id,owner_id,is_public) VALUES ('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000d',false);
CREATE FUNCTION public.ri(p_vehicle uuid DEFAULT '40000000-0000-0000-0000-000000000002',p_parent uuid DEFAULT NULL,p_scope jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql AS $$ SELECT request_inspection(p_vehicle,p_parent,p_scope) $$;
-- The buying-evidence --plan vehicle entry shape (ppi_checklist items with an empty finding slot).
CREATE FUNCTION public.plan_entry() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT '{
 "vehicle_id":"40000000-0000-0000-0000-000000000002","listing_url":"https://bringatrailer.com/listing/fixture-k10/","record_label":"1972 Chevrolet K10",
 "identity":{},"claims":[],"candidate_operations":[],"parts":[],
 "ppi_checklist":[
  {"item_id":"ppi:identity:engine","order":0,"basis":"identity_conflict","field":"engine","question":"Confirm engine from the VIN plate, build documents and the vehicle itself. Sources: listing=350; vin=307",
   "finding":{"inspection_type":"pre_purchase","system":"engine_bay","verdict":null,"finding":null,"severity":null,"evidence_photo_ref":null,"inspector_actor_id":null,"observed_at":null}},
  {"item_id":"ppi:c1","order":1,"basis":"claim","claim_ids":["c1"],"claim_kind":"defect_or_condition","linked_operation_ids":["BODY-RUST-CAB"],
   "question":"Check the claim: rust in the cab corners","finding":{"inspection_type":"pre_purchase","system":"body","verdict":null,"finding":null,"severity":null,"evidence_photo_ref":null,"inspector_actor_id":null,"observed_at":null}}]}'::jsonb $$;
GRANT EXECUTE ON FUNCTION public.ri(uuid,uuid,jsonb),public.plan_entry() TO anon,authenticated,service_role;

SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT ri()$q$),'anonymous request refused');
RESET ROLE;
SET ROLE service_role;
SELECT t_assert(t_refused($q$SELECT ri()$q$),'service role cannot sign a request');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user(NULL);
SELECT t_assert(t_refused_with($q$SELECT ri()$q$,'Authentication required'),'no auth.uid() refused');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT ri('40000000-0000-0000-0000-000000000003')$q$,'Vehicle unavailable'),'private vehicle the client cannot access refused');
SELECT t_assert(t_refused_with($q$SELECT ri('40000000-0000-0000-0000-0000000000ff')$q$,'Vehicle unavailable'),'missing vehicle looks the same');
SELECT t_assert(t_refused_with($q$SELECT ri(p_scope=>'{"inspection_type":"vibes"}')$q$,'inspection_type'),'unknown inspection type refused');
SELECT t_assert(t_refused_with($q$SELECT ri(p_scope=>'{"request_source":"sms"}')$q$,'request_source'),'request channel must be ios or web');
SELECT t_assert(t_refused_with($q$SELECT ri(p_scope=>'{"listing_url":"javascript:alert(1)"}')$q$,'listing_url'),'listing URL must be http(s)');
SELECT t_assert(t_refused_with($q$SELECT ri(p_scope=>'{"checklist":[{"item_id":"a"}]}')$q$,'one-line question'),'item without question refused');
SELECT t_assert(t_refused_with($q$SELECT ri(p_scope=>'{"checklist":[{"item_id":"a","question":"x"},{"item_id":"a","question":"y"}]}')$q$,'Duplicate'),'duplicate item id refused');
SELECT t_assert(t_refused($q$SELECT ri(p_scope=>jsonb_build_object('checklist',(SELECT jsonb_agg(jsonb_build_object('item_id','i'||g,'question','q')) FROM generate_series(1,51) g)))$q$),'more than 50 items refused');
SELECT t_assert(t_refused_with($q$SELECT ri(p_scope=>'{"parent_line_item_id":"50000000-0000-0000-0000-000000000001"}')$q$,'parent_line_item_id'),'parent operation without a parent refused');

SELECT ri(p_scope=>plan_entry()||'{"request_source":"ios"}') AS r1 \gset
SELECT t_assert((:'r1'::jsonb) @> '{"title":"Pre-purchase inspection","inspection_type":"pre_purchase","request_source":"ios","checklist_items":2,
 "duplicate":false,"vehicle_access_granted":false,"seller_permission":"not_established","payment_authorized":false,"parent_work_order_id":null}',
 'client orders a pre-purchase inspection from the plan checklist on a vehicle they do not own');
SELECT t_assert((ri(p_scope=>plan_entry()||'{"request_source":"ios"}')->>'duplicate')::boolean
 AND ri(p_scope=>plan_entry()||'{"request_source":"ios"}')->>'work_order_id'=(:'r1'::jsonb)->>'work_order_id','repeat request returns the same job');
RESET ROLE;
SELECT (:'r1'::jsonb)->>'work_order_id' AS wo \gset
SELECT (:'r1'::jsonb)->>'request_observation_id' AS req \gset
SELECT t_assert((SELECT customer_id='10000000-0000-0000-0000-00000000000c' AND scope_category='inspection' AND status='pending' AND request_source='ios'
 AND parent_work_order_id IS NULL AND request_observation_id=:'req' AND organization_id IS NULL AND lead_actor_id IS NULL
 AND title='Pre-purchase inspection' AND description=E'Pre-purchase inspection: 2 checklist items\n- Confirm engine from the VIN plate, build documents and the vehicle itself. Sources: listing=350; vin=307\n- Check the claim: rust in the cab corners'
 FROM work_orders WHERE id=:'wo'),'inspection work order: client is customer, category inspection, no org, inspector or price');
SELECT t_assert((SELECT o.submitted_by_user_id='10000000-0000-0000-0000-00000000000c' AND o.source_id='90000000-0000-0000-0000-000000000002'
 AND o.kind='work_record' AND o.extraction_method='inspection_request_sign_v1' AND NOT (o.structured_data ? 'work_order_resource')
 AND o.structured_data#>'{inspection_request,checklist}'='[{"item_id":"ppi:identity:engine","order":0,"basis":"identity_conflict","field":"engine","question":"Confirm engine from the VIN plate, build documents and the vehicle itself. Sources: listing=350; vin=307","system":"engine_bay"},{"item_id":"ppi:c1","order":1,"basis":"claim","claim_ids":["c1"],"claim_kind":"defect_or_condition","linked_operation_ids":["BODY-RUST-CAB"],"question":"Check the claim: rust in the cab corners","system":"body"}]'::jsonb
 AND o.structured_data#>>'{inspection_request,listing_url}'='https://bringatrailer.com/listing/fixture-k10/'
 FROM vehicle_observations o WHERE o.id=:'req'),'request observation keeps the normalized checklist and listing URL, signed by the client');
SELECT t_assert((SELECT count(*)=1 AND bool_and(task_type='inspect' AND line_number=1 AND status='pending' AND task_description='Pre-purchase inspection: 2 checklist items'
 AND source_observation_id IS NOT NULL) FROM work_order_line_items WHERE work_order_id=:'wo'),'one inspect operation quoting the job description');
SELECT t_assert((SELECT count(*)=1 AND bool_and(r.requirement_kind='inspection' AND r.basis_observation_id=:'req'
 AND r.description='Inspect the vehicle against the 2 checklist items') FROM work_order_resource_requirements r WHERE r.work_order_id=:'wo'),
 'inspection requirement on it, based on the request');
SET ROLE service_role;
SELECT t_assert(read_work_order_job_path(:'wo')#>'{stages,inspection}' @> '{"state":"partial","inspection_job_role":"self","inspection_requirements":1}'
 AND read_work_order_job_path(:'wo')#>>'{stages,plan,operations}'='1','job path sees the operation, the requirement and a pending inspection job');
RESET ROLE;
SELECT t_assert(NOT vehicle_user_has_access('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000c')
 AND (SELECT owner_id='10000000-0000-0000-0000-00000000000d' AND user_id IS NULL FROM vehicles WHERE id='40000000-0000-0000-0000-000000000002')
 AND (SELECT count(*) FROM vehicle_access_grants)=0,'no vehicle access granted to the client');

-- Default checklist, private own vehicle, and a parent job with a named operation.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT t_assert(ri('40000000-0000-0000-0000-000000000005',p_scope=>'{"inspection_type":"annual_check"}') @> '{"title":"Annual Check inspection","checklist_items":1}',
 'owner orders an inspection of their private vehicle; default one-item checklist');
RESET ROLE;
\set pop :op1
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format($q$SELECT ri('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001')$q$),'Parent work order unavailable'),
 'parent on another vehicle refused');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT ri('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')$q$,'Parent work order unavailable'),
 'parent of another customer refused');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format($q$SELECT ri('40000000-0000-0000-0000-000000000002',%L)$q$,:'wo'),'Parent work order unavailable'),'an inspection cannot parent an inspection');
SELECT ri('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',jsonb_build_object('parent_line_item_id',:'pop')) AS r2 \gset
RESET ROLE;
SELECT (:'r2'::jsonb)->>'work_order_id' AS wo2 \gset
SELECT t_assert((SELECT parent_work_order_id='30000000-0000-0000-0000-000000000001' FROM work_orders WHERE id=:'wo2')
 AND (SELECT r.requirement_kind='inspection' AND r.line_item_id=:'pop' AND r.basis_observation_id=((:'r2'::jsonb)->>'request_observation_id')::uuid
   FROM work_order_resource_requirements r WHERE r.id=((:'r2'::jsonb)->>'parent_requirement_id')::uuid),
 'child links to its parent; the parent operation gets an inspection requirement based on the request');

-- Guard: links only through the Sign, immutable afterwards.
SELECT t_assert(t_refused($q$INSERT INTO work_orders(id,vehicle_id,customer_id,title,description,scope_category,parent_work_order_id)
 VALUES (gen_random_uuid(),'40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','x','x','inspection','30000000-0000-0000-0000-000000000001')$q$),
 'a direct insert cannot claim a parent link');
SELECT t_assert(t_refused(format($q$INSERT INTO work_orders(id,vehicle_id,customer_id,title,description,scope_category,request_observation_id)
 VALUES (gen_random_uuid(),'40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000c','x','x','inspection',%L)$q$,:'req')),
 'a direct insert cannot reuse another job''s request observation');
SELECT t_assert(t_refused(format($q$UPDATE work_orders SET parent_work_order_id=NULL WHERE id=%L$q$,:'wo2')),'parent link is immutable');
SELECT t_assert(t_refused(format($q$UPDATE work_orders SET vehicle_id='40000000-0000-0000-0000-000000000001' WHERE id=%L$q$,:'wo')),'requested inspection vehicle is immutable');
UPDATE work_orders SET status='quoted' WHERE id=:'wo';
SELECT t_assert((SELECT status='quoted' FROM work_orders WHERE id=:'wo'),'other work order fields keep their behavior');
INSERT INTO work_orders(id,vehicle_id,title,description,request_source) VALUES ('30000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-000000000001','x','x','ios');
SELECT t_assert(t_refused($q$INSERT INTO work_orders(id,title,description,request_source) VALUES (gen_random_uuid(),'x','x','carrier_pigeon')$q$)
 AND (SELECT request_source='ios' FROM work_orders WHERE id='30000000-0000-0000-0000-0000000000a1'),'request_source allows ios and still refuses unknown channels');
SELECT t_assert(has_function_privilege('authenticated','request_inspection(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','request_inspection(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','request_inspection(uuid,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','inspection_checklist_normalize(jsonb,text)','EXECUTE'),'request: authenticated only; normalizer internal');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('request_inspection','work_order_link_guard','inspection_checklist_normalize');
