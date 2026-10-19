-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations. Proves 20261019093000_job_readers_authenticated.sql:
-- strangers get nothing, each slot sees exactly the work_orders read policy, performer access only through an
-- evidenced identity bridge, resource supplier identity and excerpts only to parties, no contact fields or amounts,
-- the signature queue matches WorkDaySignView's signable days, and anon cannot execute any reader.
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
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

-- Owners the job path reads (as test_work_order_job_path.sql), with the access columns of the live tables.
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text, business_name text);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,customer_id uuid,organization_id uuid,request_source text,
 customer_name text,customer_phone text,customer_email text,title text,description text,scope_description text,quoted_at timestamptz,
 estimated_total numeric,estimated_cost_cents integer,approved_at timestamptz,scheduled_start timestamptz,scheduled_end timestamptz,
 started_at timestamptz,actual_start timestamptz,completed_at timestamptz,actual_end timestamptz,status text,created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text,phone text);
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
  content_text text,extraction_method text,confidence_score numeric,structured_data jsonb,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),
  is_superseded boolean DEFAULT false,submitted_by_user_id uuid);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(),table_name text,column_name text,owned_by text,
  description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
-- Access owners.
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,year integer,make text,model text);
CREATE TABLE public.business_ownership(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,owner_id uuid,ownership_type text,status text);
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,is_active boolean);
CREATE TABLE public.vehicle_user_permissions(vehicle_id uuid,user_id uuid,role text,is_active boolean);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_user_permissions vup WHERE vup.vehicle_id=p_vehicle_id
    AND vup.user_id=p_user_id AND coalesce(vup.is_active,true) AND vup.role IN ('owner','co_owner','mechanic','photographer'))
$$;
-- Live work_order_is_accessible (2026-10-19), the read-policy predicate the readers must equal.
CREATE FUNCTION public.work_order_is_accessible(p_work_order_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    WHERE wo.id = p_work_order_id AND auth.uid() IS NOT NULL AND (
      wo.customer_id = auth.uid()
      OR wo.organization_id IN (SELECT business_ownership.business_id FROM business_ownership
        WHERE business_ownership.owner_id = auth.uid() AND business_ownership.status = 'active')
      OR (v.id IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid()
        OR vehicle_user_has_access(v.id, auth.uid())))
      OR EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active)));
$function$;
-- Identity owners.
CREATE TABLE public.profiles(id uuid PRIMARY KEY,username text,full_name text,avatar_url text,bio text,city text,state text,
  user_type text,role text,profession text,expertise_areas text[],is_public boolean,member_since timestamptz,
  email text,phone text,phone_number text,address text,zip text);
CREATE TABLE public.organization_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,role text,
  status text,start_date date,end_date date,verification_method text,verified_by uuid,verified_at timestamptz,notes text);
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),platform text,handle text);
CREATE TABLE public.account_link_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, platform text NOT NULL, handle text NOT NULL,
  external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','pending_review','verified','approved','rejected','expired'])),
  verification_method text, claim_confidence integer DEFAULT 0, proof_type text, proof_url text, notes text,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, platform, handle));
ALTER TABLE public.account_link_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY alc_insert_own ON public.account_link_claims FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY alc_select_own ON public.account_link_claims FOR SELECT USING (user_id = (SELECT auth.uid()));
GRANT ALL ON public.account_link_claims TO anon, authenticated, service_role;
-- Signature owners.
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY,user_id uuid,vehicle_id uuid,session_date date,start_time timestamptz,
  end_time timestamptz,duration_minutes integer,image_count integer,owner_confirmed_at timestamptz,owner_confirmed_by uuid,total_labor_cost numeric);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,taken_at timestamptz,is_external boolean);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON auth.users TO service_role;

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE FUNCTION public.t_as(p_sub uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',p_sub)::text, false); END $$;
CREATE FUNCTION public.t_private(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(Fixture Customer|Other Customer|5550100|cust@example|"amount"|unit_price|total_cost|estimated_total"|amount_usd|actual_payout|total_labor_cost|"phone"|"email"|"address")' $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text),public.t_refused(text),public.t_as(uuid),public.t_private(jsonb) TO anon,authenticated,service_role;

-- Users: 01 customer of A, 02 customer of B, 03 vehicle permission on A's vehicle, 04 owns C's org, 05 admin,
-- 06 performer candidate (actor X on C's operation), 07 owns A's vehicle, 08 tool supplier, 09 stranger.
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text,2,'0'))::uuid FROM generate_series(1,9) n;
INSERT INTO organizations VALUES ('0a000000-0000-0000-0000-000000000001','Fixture Shop',NULL);
INSERT INTO vehicles VALUES
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007',NULL,NULL,1970,'Chevrolet','C10'),
 ('40000000-0000-0000-0000-000000000002',NULL,'00000000-0000-0000-0000-000000000008',NULL,1985,'Ford','F-150'),
 ('40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',NULL,NULL,1999,'Jeep','Cherokee'),
 ('40000000-0000-0000-0000-000000000004',NULL,'00000000-0000-0000-0000-000000000001',NULL,NULL,'UNRESOLVED',NULL);
INSERT INTO business_ownership(business_id,owner_id,ownership_type,status) VALUES
 ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','owner','active');
INSERT INTO admin_users(user_id,is_active) VALUES ('00000000-0000-0000-0000-000000000005',true),('00000000-0000-0000-0000-000000000009',false);
INSERT INTO vehicle_user_permissions VALUES ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','mechanic',true);
INSERT INTO actors VALUES ('a0000000-0000-0000-0000-0000000000f1','Fixture Performer','person','+15550199')
 ;
INSERT INTO work_orders(id,vehicle_id,customer_id,request_source,customer_name,customer_phone,customer_email,title,estimated_total,status) VALUES
 ('30000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','sms',
  'Fixture Customer','+15550100','cust@example.com','Brake job',100,'paid'),
 ('30000000-0000-0000-0000-00000000000b',NULL,'00000000-0000-0000-0000-000000000002','walk_in','Other Customer',NULL,NULL,'Paint',NULL,'completed');
INSERT INTO work_orders(id,vehicle_id,organization_id,title,quoted_at,approved_at,scheduled_start,scheduled_end,started_at,completed_at,status) VALUES
 ('30000000-0000-0000-0000-00000000000c','40000000-0000-0000-0000-000000000002','0a000000-0000-0000-0000-000000000001','Exhaust',
  '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-03','2026-01-04','completed');
INSERT INTO work_order_line_items(id,work_order_id,status,actor_id) VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-00000000000a','complete',NULL),
 ('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-00000000000c','complete','a0000000-0000-0000-0000-0000000000f1');
INSERT INTO work_order_parts VALUES ('d0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-00000000000a','Pads','installed',NULL,40);
INSERT INTO work_order_labor(work_order_id,hours,ai_estimated,total_cost) VALUES ('30000000-0000-0000-0000-00000000000a',2,true,300);
INSERT INTO work_order_payments(work_order_id,amount,status) VALUES ('30000000-0000-0000-0000-00000000000b',50,'completed');
INSERT INTO work_order_assignments(work_order_id,status,actual_payout) VALUES ('30000000-0000-0000-0000-00000000000c','completed',77);
INSERT INTO user_tools VALUES ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000008');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,content_text,observed_at,structured_data) VALUES
 ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',
  'Customer asked: please road test after brake bleed','2026-01-01',NULL),
 ('80000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',NULL,'2026-01-01',
  '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-00000000000a","line_item_id":"50000000-0000-0000-0000-000000000001","requirement_kind":"tool","description":"Brake bleeder","quantity":1,"unit":"each","basis_observation_id":"80000000-0000-0000-0000-000000000002","basis_excerpt":"road test after brake bleed"}}'),
 ('80000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',NULL,'2026-01-02',
  '{"work_order_resource":{"version":1,"event_type":"fulfillment","work_order_id":"30000000-0000-0000-0000-00000000000a","requirement_id":"80000000-0000-0000-0000-000000000003","user_tool_id":"70000000-0000-0000-0000-000000000001","supplier_user_id":"00000000-0000-0000-0000-000000000008"}}'),
 ('80000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',NULL,'2026-01-03',
  '{"work_order_resource":{"version":1,"event_type":"attestation","work_order_id":"30000000-0000-0000-0000-00000000000a","fulfillment_id":"80000000-0000-0000-0000-000000000004","attestor_user_id":"00000000-0000-0000-0000-000000000008","attestation_kind":"availability","verdict":"supports","scope":"Bleeder available Tuesday"}}');
-- Sessions: U01 has one signable day (S1); S2 confirmed, S3 no capture span, S4 unresolved vehicle, S5 another user's
-- session on U01's vehicle. S6 is U06's own day (bridge evidence).
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,start_time,end_time,duration_minutes,image_count,owner_confirmed_at,total_labor_cost) VALUES
 ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','2026-01-05','2026-01-05 15:00','2026-01-05 16:00',60,3,NULL,410),
 ('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','2026-01-06',NULL,NULL,30,1,'2026-01-07',NULL),
 ('60000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','2026-01-07',NULL,NULL,0,1,NULL,NULL),
 ('60000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004','2026-01-08',NULL,NULL,45,2,NULL,NULL),
 ('60000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000003','2026-01-09',NULL,NULL,45,2,NULL,NULL),
 ('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000002','2026-01-03',NULL,NULL,90,4,NULL,NULL);
INSERT INTO vehicle_images(vehicle_id,taken_at,is_external) VALUES
 ('40000000-0000-0000-0000-000000000003','2026-01-05 15:10',false),('40000000-0000-0000-0000-000000000003','2026-01-05 15:50',false),
 ('40000000-0000-0000-0000-000000000003','2026-01-05 15:20',true),('40000000-0000-0000-0000-000000000003','2026-01-06 09:00',false);
INSERT INTO profiles(id,username,full_name,city,role,user_type,email,phone,address) VALUES
 ('00000000-0000-0000-0000-000000000001','fixture_one','Fixture One','Boise','mechanic','user','one@example.com','+15550111','1 Main St');
INSERT INTO organization_contributors(organization_id,user_id,role,status,verification_method) VALUES
 ('0a000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','technician','active','self_claimed');

\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019045753_work_order_job_path.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql
\ir ../migrations/20261019091500_account_link_claims_actor_bridge.sql
\ir ../migrations/20261019093000_job_readers_authenticated.sql

SET ROLE service_role;
SELECT project_work_order_resource_observation(id) FROM unnest(ARRAY['80000000-0000-0000-0000-000000000003',
  '80000000-0000-0000-0000-000000000004','80000000-0000-0000-0000-000000000005']::uuid[]) id;
RESET ROLE;

-- 0. Grants and shape of the readers.
SELECT t_assert((SELECT bool_and(p.prosecdef AND p.provolatile='s' AND 'search_path=pg_catalog, public' = ANY (p.proconfig)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)) AND count(*) = 5
  FROM pg_proc p WHERE p.proname IN ('my_identity_read','my_work_orders','work_order_job_path_read','work_order_resources_read','my_signature_queue')),
  'readers: definer, stable, fixed search_path, authenticated only');
SELECT t_assert((SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.proname IN ('work_order_viewer_slots','viewer_identity_bridge','job_reader_viewer','job_reader_context',
    'read_work_order_job_path','read_work_order_resources')), 'helpers and wrapped readers stay closed to anon and authenticated');

-- 1. Anonymous callers are refused.
SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT t_assert(t_refused('SELECT my_identity_read()') AND t_refused('SELECT my_work_orders()') AND t_refused('SELECT my_signature_queue()')
  AND t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000a')$q$)
  AND t_refused($q$SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a')$q$), 'anon refused by every reader');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',false);
SELECT t_assert(t_refused('SELECT my_work_orders()') AND t_refused('SELECT my_identity_read()'), 'authenticated role without a subject refused');

-- 2. A signed-in stranger gets nothing.
SELECT t_as('00000000-0000-0000-0000-000000000009');
SELECT t_assert((SELECT my_work_orders() @> '{"rows":[],"coverage":{"returned":0,"total_for_viewer":0}}'), 'stranger: no work orders');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000a')$q$), 'stranger: job path refused');
SELECT t_assert(t_refused($q$SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a')$q$), 'stranger: resources refused');
SELECT t_assert((SELECT my_identity_read() @> '{"profile":null,"provider_link":{"state":"none","actor_id":null,"claims":[]},"org_memberships":[],"payout_setup":"not_established","viewer":{"identity_bridge":"none"}}'),
  'stranger: empty identity, bridge none');
SELECT t_assert((SELECT my_signature_queue() @> '{"items":[],"coverage":{"returned":0,"total":0}}'), 'stranger: empty signature queue');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-000000000099')$q$), 'unknown work order refused');

-- 3. Each slot sees exactly what the work_orders read policy allows.
CREATE TEMP TABLE seen(u text, wo uuid, slots text[], policy boolean);
GRANT ALL ON seen TO PUBLIC;
DO $$
DECLARE u int; r jsonb;
BEGIN
  FOR u IN 1..9 LOOP
    PERFORM t_as(('00000000-0000-0000-0000-0000000000' || lpad(u::text,2,'0'))::uuid);
    FOR r IN SELECT jsonb_array_elements(my_work_orders(NULL,NULL,100)->'rows') LOOP
      INSERT INTO seen VALUES (lpad(u::text,2,'0'), (r->>'work_order_id')::uuid, ARRAY(SELECT jsonb_array_elements_text(r->'slots')), true);
    END LOOP;
    INSERT INTO seen SELECT lpad(u::text,2,'0'), w.id, NULL, false FROM unnest(ARRAY['30000000-0000-0000-0000-00000000000a','30000000-0000-0000-0000-00000000000b','30000000-0000-0000-0000-00000000000c']::uuid[]) w(id) WHERE work_order_is_accessible(w.id);
  END LOOP;
END $$;
SELECT t_assert((SELECT count(*) FROM (SELECT u, wo FROM seen WHERE policy GROUP BY 1,2 EXCEPT SELECT u, wo FROM seen WHERE NOT policy GROUP BY 1,2) x) = 0
  AND (SELECT count(*) FROM (SELECT u, wo FROM seen WHERE NOT policy GROUP BY 1,2 EXCEPT SELECT u, wo FROM seen WHERE policy GROUP BY 1,2) x) = 0,
  'my_work_orders equals work_order_is_accessible for every fixture user');
SELECT t_assert((SELECT string_agg(u || ':' || right(wo::text,1) || ':' || array_to_string(slots, '+'), ' ' ORDER BY u, wo) FROM seen WHERE policy)
  = '01:a:customer 02:b:customer 03:a:vehicle_access 04:c:org_owner 05:a:admin 05:b:admin 05:c:admin 07:a:vehicle_access 08:c:vehicle_access',
  'slots per viewer: customer, vehicle permission, org ownership, admin, vehicle owner');

SELECT t_as('00000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE c1 AS SELECT my_work_orders() j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"self","money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"none"},"coverage":{"returned":1,"total_for_viewer":1},"next_after":null}' FROM c1),
  'customer: viewer block and coverage');
SELECT t_assert((SELECT j->'rows'->0 @> '{"work_order_id":"30000000-0000-0000-0000-00000000000a","title":"Brake job","slots":["customer"],"stage_states":{"intake":"recorded","completion":"status_only","accounting":"absent"},"first_gap":{"stage":"inspection","gap":"no_inspection_requirement"}}'
  AND (SELECT count(*) FROM jsonb_object_keys(j->'rows'->0->'stage_states')) = 7 FROM c1), 'customer: row carries seven stage states and the first gap');
SELECT t_assert((SELECT NOT t_private(j) FROM c1), 'customer list: no contact fields or amounts');
CREATE TEMP TABLE jp AS SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"work_order_id":"30000000-0000-0000-0000-00000000000a","viewer":{"context":"client","slots":["customer"],"actions":[],"money_visible":false,"contact_visible":false},"payment_authorized":false,"coverage":{"stages_reported":7}}'
  AND (SELECT count(*) FROM jsonb_object_keys(j->'stages')) = 7 FROM jp), 'customer: job path with viewer and empty actions');
SELECT t_assert((SELECT NOT t_private(j) FROM jp), 'customer job path: no contact fields or amounts');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000b')$q$), 'customer: another customer''s job refused');
CREATE TEMP TABLE rs AS SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"viewer":{"slots":["customer"],"party":true},"requirements":[{"basis_excerpt":"road test after brake bleed"}],"fulfillments":[{"supplier_user_id":"00000000-0000-0000-0000-000000000008"}],"attestations":[{"attestor_user_id":"00000000-0000-0000-0000-000000000008","attestor_basis":"attributed_by_source_testimony","attestor_identity":"shown_to_party"}]}' FROM rs),
  'customer (party): supplier, attestor and excerpt shown');
SELECT t_assert((SELECT NOT t_private(j) FROM rs), 'customer resources: no contact fields or amounts');
CREATE TEMP TABLE me1 AS SELECT my_identity_read() j;
SELECT t_assert((SELECT j @> '{"profile":{"username":"fixture_one","full_name":"Fixture One","city":"Boise","self_claims":{"basis":"stated_by_account","role":"mechanic"}},"org_memberships":[{"relation":"contributor","organization_name":"Fixture Shop","role":"technician","verification_method":"self_claimed"}],"payout_setup":"not_established","viewer":{"context":"self"}}' FROM me1),
  'self: profile basics, self-claims, memberships, payout not established');
SELECT t_assert((SELECT j::text !~ '(one@example|5550111|Main St)' AND NOT t_private(j) FROM me1), 'self identity: no contact fields');
CREATE TEMP TABLE q1 AS SELECT my_signature_queue() j;
SELECT t_assert((SELECT j @> '{"coverage":{"returned":1,"total":1,"kinds":["work_session"]},"items":[{"kind":"work_session","ref_id":"60000000-0000-0000-0000-000000000001","work_order_id":null,"capture_span_minutes":60,"evidence_counts":{"session_images":3,"vehicle_photos_that_day":2},"sign":{"rpc":"confirm_work_session"}}]}' FROM q1),
  'signature queue: own signable day only, with evidence counts');
SELECT t_assert((SELECT NOT t_private(j) AND j::text !~ '410' FROM q1), 'signature queue: no labor cost');

-- 4. A vehicle-access holder who is not a party sees the job but not supplier identity or excerpts.
SELECT t_as('00000000-0000-0000-0000-000000000003');
CREATE TEMP TABLE rs3 AS SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a') j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"client","slots":["vehicle_access"],"party":false},"requirements":[{"basis_excerpt":null,"basis_excerpt_visibility":"withheld_not_party"}],"fulfillments":[{"supplier_user_id":null,"supplier_identity":"withheld_not_party"}],"attestations":[{"attestor_user_id":null,"attestor_identity":"withheld_not_party"}]}'
  AND j::text !~ '(00000000-0000-0000-0000-000000000008|road test)' FROM rs3), 'non-party: supplier, attestor and excerpt withheld');
SELECT t_assert((SELECT jsonb_array_length(j->'fulfillments')=1 AND jsonb_array_length(j->'attestations')=1 FROM rs3), 'non-party: graph shape kept');

-- 5. Admin paginates every work order; the slot filter narrows.
SELECT t_as('00000000-0000-0000-0000-000000000005');
CREATE TEMP TABLE pg1 AS SELECT my_work_orders(NULL,NULL,2) j;
SELECT t_assert((SELECT jsonb_array_length(j->'rows')=2 AND (j#>>'{coverage,total_for_viewer}')::int=3
  AND j->>'next_after'='30000000-0000-0000-0000-00000000000b' FROM pg1), 'admin: first page of two with a cursor');
SELECT t_assert((SELECT j->'rows'->0->>'work_order_id'='30000000-0000-0000-0000-00000000000c' AND j->>'next_after' IS NULL
  FROM (SELECT my_work_orders(NULL,'30000000-0000-0000-0000-00000000000b',2) j) x), 'admin: second page ends');
SELECT t_assert((SELECT my_work_orders('customer') @> '{"rows":[],"coverage":{"total_for_viewer":0,"slot_filter":"customer"}}'), 'slot filter narrows');
SELECT t_assert(t_refused($q$SELECT my_work_orders('owner')$q$), 'unknown slot refused');
SELECT t_assert((SELECT NOT t_private(my_work_orders(NULL,NULL,100))), 'admin list: no contact fields or amounts');
SELECT t_assert((SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000a') @> '{"viewer":{"context":"admin","party":false}}'),
  'admin is not a party to supplier identity');

-- 6. Performer access only through an evidenced identity bridge.
SELECT t_as('00000000-0000-0000-0000-000000000006');
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,verification_method) VALUES
 ('c0000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006','nuke_actor',
  'a0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000f1','self_claim');
SELECT t_assert((SELECT my_work_orders() @> '{"rows":[],"viewer":{"identity_bridge":"claimed"}}'), 'self-claimed performer sees no job');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000c')$q$), 'self-claimed performer refused job path');
SELECT t_assert((SELECT my_identity_read() @> '{"provider_link":{"state":"claimed","claims":[{"rung":"self_claim","status":"pending","actor":{"name":"Fixture Performer"}}]}}'
  AND my_identity_read()::text !~ '5550199'), 'identity shows the claim, not the actor''s phone');
RESET ROLE;
SET ROLE service_role;
SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000006','work_evidence',
  '[{"kind":"work_session","id":"60000000-0000-0000-0000-000000000006"}]','00000000-0000-0000-0000-000000000005');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
SELECT t_assert((SELECT my_work_orders() @> '{"rows":[{"work_order_id":"30000000-0000-0000-0000-00000000000c","slots":["performer"]}],"viewer":{"identity_bridge":"evidenced"},"coverage":{"total_for_viewer":1}}'),
  'evidenced performer sees the job naming their actor');
SELECT t_assert((SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000c') @> '{"viewer":{"context":"provider","slots":["performer"],"identity_bridge":"evidenced","actions":[]}}'),
  'evidenced performer: provider context');
SELECT t_assert((SELECT work_order_resources_read('30000000-0000-0000-0000-00000000000c') @> '{"viewer":{"party":true}}'), 'evidenced performer is a party');
SELECT t_assert(t_refused($q$SELECT work_order_job_path_read('30000000-0000-0000-0000-00000000000a')$q$), 'evidenced performer still refused other jobs');
SELECT t_assert((SELECT NOT t_private(work_order_job_path_read('30000000-0000-0000-0000-00000000000c'))), 'performer job path: no payouts or amounts');
RESET ROLE;
