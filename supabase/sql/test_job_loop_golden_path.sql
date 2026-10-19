-- Disposable PG17 only. Golden path of the job loop ("a job is a quote"): one synthetic story end to end through only the
-- public Sign writers and open readers, as distinct authenticated users, with the privacy invariants checked for a visitor
-- and a signed-in stranger at each step. No payment is authorized and nothing is disbursed anywhere on the path.
-- Fixture and prior state: the contact-broker contract chain, then every later job-loop migration in live order.
\set ON_ERROR_STOP on
\ir test_contact_broker.sql

-- Live columns the chain fixture omits.
ALTER TABLE public.work_order_assignments ADD COLUMN technician_id uuid NOT NULL DEFAULT gen_random_uuid(), ADD COLUMN job_op_code text,
  ADD COLUMN role text DEFAULT 'lead' CHECK (role = ANY (ARRAY['lead','technician','helper'])), ADD COLUMN offered_at timestamptz,
  ADD COLUMN declined_at timestamptz, ADD COLUMN payout_type text DEFAULT 'flat' CHECK (payout_type = ANY (ARRAY['flat','hourly','percentage'])),
  ADD COLUMN payout_rate numeric, ADD COLUMN payout_percentage numeric, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.work_order_assignments ALTER COLUMN technician_id DROP DEFAULT;
ALTER TABLE public.vehicle_observations ALTER COLUMN id SET DEFAULT gen_random_uuid(), ADD COLUMN source_identifier text,
  ADD COLUMN content_hash text, ADD COLUMN observed_at_basis text, ADD COLUMN source_event_at timestamptz,
  ADD COLUMN source_event_time_precision text, ADD COLUMN observer_raw jsonb, ADD COLUMN confidence text, ADD COLUMN superseded_by uuid,
  ADD COLUMN superseded_at timestamptz, ADD COLUMN lineage_chain uuid[], ADD UNIQUE (source_id, source_identifier, kind, content_hash);
INSERT INTO observation_sources(id,slug,category) VALUES ('90000000-0000-0000-0000-000000000002','owner-input','owner');
ALTER TABLE public.component_events ADD COLUMN actor_id uuid, ADD COLUMN event_date date, ADD COLUMN org_id uuid, ADD COLUMN evidence_ids uuid[];
ALTER TABLE public.organizations ADD COLUMN is_verified boolean;
ALTER TABLE public.work_order_line_items ADD COLUMN IF NOT EXISTS source_observation_id uuid;
ALTER TABLE public.vehicle_images ADD COLUMN image_url text, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN is_sensitive boolean,
  ADD COLUMN is_superseded boolean;
CREATE TABLE public.organization_vehicles(organization_id uuid, vehicle_id uuid);

\ir ../migrations/20261019124500_work_order_quotes_open_read.sql
\ir ../migrations/20261019152500_inspection_findings.sql
\ir ../migrations/20261019153000_job_path_inspection.sql
\ir ../migrations/20261019182000_work_order_offer_acceptance.sql
\ir ../migrations/20261019183000_work_order_offers_read.sql
\ir ../migrations/20261019184500_inspection_access.sql
\ir ../migrations/20261019190000_actor_link_claim_evidence.sql
\ir ../migrations/20261019191500_listing_work_plan_read.sql
\ir ../migrations/20261019200000_work_order_completion_sign.sql
\ir ../migrations/20261019201500_work_order_invoice_payment_witness.sql
-- Deploy order (not filename order): 214500 and 220000 were applied before 211500 and 213000.
\ir ../migrations/20261019210000_work_order_cosign.sql
\ir ../migrations/20261019214500_signature_queue_all_signs.sql
\ir ../migrations/20261019220000_job_evidence_attach.sql
\ir ../migrations/20261019211500_provider_vouches.sql
\ir ../migrations/20261019213000_work_order_change_orders.sql
\ir ../migrations/20261019221500_quote_release_terms.sql
\ir ../migrations/20261019230000_provider_jobs_accepted_offers.sql
\ir ../migrations/20261019231500_job_loop_grant_tidy.sql

-- Listing-reader inputs and live columns these readers and Signs use.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS merged_into_vehicle_id uuid, ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS engine_size text, ADD COLUMN IF NOT EXISTS engine_liters numeric, ADD COLUMN IF NOT EXISTS engine_displacement text,
  ADD COLUMN IF NOT EXISTS displacement text, ADD COLUMN IF NOT EXISTS transmission text, ADD COLUMN IF NOT EXISTS drivetrain text,
  ADD COLUMN IF NOT EXISTS listing_url text, ADD COLUMN IF NOT EXISTS bat_auction_url text, ADD COLUMN IF NOT EXISTS discovery_url text,
  ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS listing_kind text,
  ADD COLUMN IF NOT EXISTS seller_name text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS lead_actor_id uuid, ADD COLUMN IF NOT EXISTS deposit_cents integer;
ALTER TABLE public.work_order_line_items ADD COLUMN IF NOT EXISTS notes text, ADD COLUMN IF NOT EXISTS hours_labor numeric, ADD COLUMN IF NOT EXISTS total_cost_cents integer;
ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS subject_type text, ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.vehicle_images ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.work_order_labor ADD COLUMN IF NOT EXISTS job_op_code text;
CREATE TABLE public.vin_decoded_data(vin text, make text, model text, year integer, engine_displacement_liters text, transmission text,
  drivetrain text, provider text, decoded_at timestamptz, raw_response jsonb);
CREATE TABLE public.description_discoveries(id uuid PRIMARY KEY, vehicle_id uuid, discovered_at timestamptz, model_used text, prompt_version text, raw_extraction jsonb);
CREATE TABLE public.labor_operations(code text PRIMARY KEY, name text, base_hours numeric, system text, model_year_min integer, model_year_max integer);
CREATE TABLE public.stage_transition_labor_map(id uuid PRIMARY KEY, category text, from_stage text, to_stage text, zone_pattern text, description text,
  estimated_hours_min real, estimated_hours_typical real, estimated_hours_max real, materials_cost_min real, materials_cost_max real, confidence text);
CREATE TABLE public.catalog_parts(id uuid PRIMARY KEY, part_number text, name text, price_current numeric, currency text, fits_models text[],
  year_start integer, year_end integer, manufacturer text);
CREATE TABLE IF NOT EXISTS public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,vehicle_id uuid,status text,expires_at timestamptz);
DO $$ BEGIN
  IF to_regprocedure('public.resolve_labor_rate(uuid,uuid,uuid,uuid)') IS NULL THEN
    CREATE FUNCTION public.resolve_labor_rate(p_org uuid DEFAULT NULL, p_user uuid DEFAULT NULL, p_vehicle uuid DEFAULT NULL, p_client uuid DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql STABLE AS 'SELECT ''{"rate":160,"source":"spitball","rate_confidence":"spitball_no_data"}''::jsonb';
  END IF;
  IF to_regprocedure('public.observation_is_public(text,jsonb)') IS NULL THEN
    CREATE FUNCTION public.observation_is_public(k text, d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT COALESCE(d->>''private'', ''false'') <> ''true''';
  END IF;
END $$;
CREATE FUNCTION public.t_refused_with(q text, needle text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN strpos(SQLERRM, needle) > 0; END $$;
GRANT EXECUTE ON FUNCTION public.t_refused_with(text,text) TO anon, authenticated;

-- ============================================================================================================
-- The cast (synthetic): CL client (private profile), MX mechanic (actor AMX), AD admin, SO shop owner of Golden Shop,
-- SE seller and verified owner of the listing vehicle, IN inspector (actor AIN), ST signed-in stranger.
-- Retained history (not Signs): a past job of AMX on another vehicle with MX's same-day work session, the listing,
-- and an active ownership verification. No Sign exists for posting a job or its requirements: the parent job and the
-- requirement/specification interpretations quoting the inspector's findings are retained-source projections.
-- ============================================================================================================
INSERT INTO auth.users VALUES ('e7000000-0000-0000-0000-0000000000c1'),('e7000000-0000-0000-0000-0000000000a1'),
 ('e7000000-0000-0000-0000-0000000000ad'),('e7000000-0000-0000-0000-0000000000b0'),('e7000000-0000-0000-0000-0000000000e1'),
 ('e7000000-0000-0000-0000-0000000000f1'),('e7000000-0000-0000-0000-000000000099');
INSERT INTO profiles(id,username,full_name,is_public,city,state,email,phone,address) VALUES
 ('e7000000-0000-0000-0000-0000000000c1','gold_client','Goldie Clientname',false,'Reno','NV','goldie@example.org','+15550123001','1 Private Way'),
 ('e7000000-0000-0000-0000-0000000000a1','gold_mech','Marco Mechlegal',true,'Reno','NV','marco@example.org','+15550123002','2 Private Way'),
 ('e7000000-0000-0000-0000-0000000000ad','gold_admin','Ada Adminlegal',false,NULL,NULL,'ada@example.org',NULL,NULL),
 ('e7000000-0000-0000-0000-0000000000b0','gold_shop_owner','Sol Shoplegal',true,'Reno','NV','sol@example.org','+15550123004',NULL),
 ('e7000000-0000-0000-0000-0000000000e1','gold_seller','Sela Sellerlegal',true,'Sparks','NV','sela@example.org','+15550123005','5 Private Way'),
 ('e7000000-0000-0000-0000-0000000000f1','gold_inspector','Ivo Inspectlegal',true,'Reno','NV','ivo@example.org','+15550123006',NULL),
 ('e7000000-0000-0000-0000-000000000099','gold_stranger','Stan Strangerlegal',true,NULL,NULL,'stan@example.org',NULL,NULL);
INSERT INTO admin_users(user_id,is_active) VALUES ('e7000000-0000-0000-0000-0000000000ad',true);
INSERT INTO organizations(id,name,business_name,is_public,business_type,is_verified) VALUES ('e7100000-0000-0000-0000-000000000001','Golden Shop','Golden Shop',true,'shop',true);
INSERT INTO business_ownership(business_id,owner_id,ownership_type,status) VALUES ('e7100000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-0000000000b0','owner','active');
INSERT INTO user_tools(id,user_id,category) VALUES ('e7600000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-0000000000b0','lifts');
INSERT INTO actors(id,name,actor_type) VALUES ('e7200000-0000-0000-0000-0000000000a1','Marco M.','mechanic'),('e7200000-0000-0000-0000-0000000000f1','Ivo I.','inspector');
INSERT INTO vehicles(id,owner_id,year,make,model,is_public,vin,listing_url,description,seller_name,transmission,drivetrain,city,state) VALUES
 ('e7300000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-0000000000e1',1972,'Chevrolet','C10',true,'CCE142Z100001',
  'https://bringatrailer.com/listing/1972-chevrolet-c10-golden/',
  'This 1972 Chevrolet C10 has a 350 ci V8. The exhaust leaks at the manifold and the muffler is rusted through. The brakes are worn and need service.',
  'Sela Sellerlegal','Automatic','RWD','Sparks','NV'),
 ('e7300000-0000-0000-0000-000000000002',NULL,1968,'Ford','F-100',true,NULL,NULL,NULL,NULL,NULL,NULL,'Reno','NV');
INSERT INTO labor_operations VALUES ('EXH-MUFFLER-RR','Muffler',1.5,'exhaust',NULL,NULL),('MECH-BRAKES-ALL','All brakes',4,'brakes',NULL,NULL);
INSERT INTO ownership_verifications(user_id,vehicle_id,status,expires_at) VALUES
 ('e7000000-0000-0000-0000-0000000000e1','e7300000-0000-0000-0000-000000000001','approved',now()+interval '1 year');
-- MX's past job: operation by AMX on vehicle 2 with a dated component event and MX's same-day work session.
INSERT INTO work_orders(id,vehicle_id,title,description,status,completed_at) VALUES
 ('e7400000-0000-0000-0000-000000000002','e7300000-0000-0000-0000-000000000002','Header swap','- Swap headers','completed','2026-02-01');
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status,actor_id) VALUES
 ('e7500000-0000-0000-0000-000000000002','e7400000-0000-0000-0000-000000000002',1,'replace','Swap headers','complete','e7200000-0000-0000-0000-0000000000a1');
INSERT INTO component_events(id,vehicle_id,work_order_id,metadata,actor_id,event_date) VALUES
 ('e7700000-0000-0000-0000-000000000002','e7300000-0000-0000-0000-000000000002','e7400000-0000-0000-0000-000000000002','{}','e7200000-0000-0000-0000-0000000000a1','2026-02-01');
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,duration_minutes) VALUES
 ('e7800000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-0000000000a1','e7300000-0000-0000-0000-000000000002','2026-02-01',240);
-- The client's job on the listing vehicle (as a shop would open it): two scope lines quoted from its description.
INSERT INTO work_orders(id,vehicle_id,customer_id,title,description,status) VALUES
 ('e7400000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-0000000000c1','Exhaust and brakes',
  E'- Replace exhaust with stainless system\n- Service brakes','pending');

-- Viewer helpers and invariants.
CREATE FUNCTION public.g_anon() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims', '{"role":"anon"}', false) $$;
-- Private fields of this story: legal names, contact fields, street addresses, the private client's raw id.
CREATE FUNCTION public.g_pii(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(Goldie|Clientname|Mechlegal|Shoplegal|Sellerlegal|Inspectlegal|Strangerlegal|Adminlegal|@example\.org|5550123|Private Way|e7000000-0000-0000-0000-0000000000c1|"email"|"phone"|"address")' $$;
GRANT EXECUTE ON FUNCTION public.g_anon(), public.g_pii(jsonb) TO anon, authenticated;

-- Privacy sweep helper: every open reader as the current viewer, recorded per step (g.step).
CREATE TABLE public.g_sweep(step text, viewer text, reader text, j jsonb);
GRANT INSERT, SELECT ON public.g_sweep TO anon, authenticated;
CREATE FUNCTION public.g_iw() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM work_orders WHERE parent_work_order_id = 'e7400000-0000-0000-0000-000000000001' $$;
CREATE FUNCTION public.g_capture(p_viewer text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE wo uuid := 'e7400000-0000-0000-0000-000000000001'; iw uuid := public.g_iw(); st text := current_setting('g.step', true); BEGIN
  INSERT INTO g_sweep VALUES (st,p_viewer,'listing_work_plan_read',listing_work_plan_read('e7300000-0000-0000-0000-000000000001')),
   (st,p_viewer,'open_requirements_read',open_requirements_read(NULL,100,NULL)),
   (st,p_viewer,'work_order_offers_read',work_order_offers_read(wo)),
   (st,p_viewer,'work_order_quotes_read',work_order_quotes_read(wo)),(st,p_viewer,'work_order_invoices_read',work_order_invoices_read(wo)),
   (st,p_viewer,'work_order_evidence_read',work_order_evidence_read(wo)),(st,p_viewer,'work_order_job_path_read',work_order_job_path_read(wo)),
   (st,p_viewer,'work_order_resources_read',work_order_resources_read(wo)),
   (st,p_viewer,'work_order_inspection_read/parent',work_order_inspection_read(wo)),(st,p_viewer,'work_order_statement_read',work_order_statement_read(wo)),
   (st,p_viewer,'provider_profile_read',provider_profile_read('e7000000-0000-0000-0000-0000000000a1')),
   (st,p_viewer,'provider_profile_read/shop_owner',provider_profile_read('e7000000-0000-0000-0000-0000000000b0')),
   (st,p_viewer,'provider_job_record_read',provider_job_record_read('e7000000-0000-0000-0000-0000000000a1'));
  IF iw IS NOT NULL THEN
    INSERT INTO g_sweep VALUES (st,p_viewer,'work_order_offers_read/inspection',work_order_offers_read(iw)),
     (st,p_viewer,'work_order_inspection_read',work_order_inspection_read(iw));
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.g_capture(text), public.g_iw() TO anon, authenticated;
\set g_step 'SET ROLE anon; SELECT g_anon(); SELECT g_capture(''visitor''); RESET ROLE; SET ROLE authenticated; SELECT t_as(''e7000000-0000-0000-0000-000000000099''); SELECT g_capture(''stranger''); RESET ROLE;'

SELECT set_config('g.step','before 1',false);
:g_step
-- 1. A visitor plans the work from the listing.
SET ROLE anon;
SELECT g_anon();
CREATE TEMP TABLE g_plan AS SELECT listing_work_plan_read('e7300000-0000-0000-0000-000000000001') j;
GRANT SELECT ON g_plan TO PUBLIC;
RESET ROLE;
SELECT t_assert((SELECT j @> '{"state":"public_current_parent","viewer":{"context":"visitor","money_visible":false}}'
  AND j#>>'{inspection_scope,inspection_type}'='pre_purchase' AND jsonb_array_length(j#>'{inspection_scope,ppi_checklist}')>=1
  AND NOT g_pii(j) AND NOT j::text ~ 'Sela' FROM g_plan),'1 listing_work_plan_read: visitor plan with an inspection_scope; no seller identity');

-- The parent job's two scope operations (retained: quoted from its own description by the scope projector).
CREATE FUNCTION public.g_op(p_n integer,p_text text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); BEGIN
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data)
 VALUES(k,'e7300000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',now()-interval '2 days','scope_operation_v1',
 jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','operation','work_order_id','e7400000-0000-0000-0000-000000000001',
 'line_number',p_n,'task_type','other','task_description',p_text,'basis_field','description','basis_excerpt',p_text)));
 PERFORM project_work_order_resource_observation(k); RETURN k; END $$;
SELECT g_op(1,'Replace exhaust with stainless system') AS op_exh \gset
SELECT g_op(2,'Service brakes') AS op_brk \gset

SELECT set_config('g.step','before 2',false);
:g_step
-- 2. The client orders a pre-purchase inspection with the plan's scope, for the exhaust operation of their job.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT request_inspection('e7300000-0000-0000-0000-000000000001','e7400000-0000-0000-0000-000000000001',
  (SELECT j->'inspection_scope' FROM g_plan) || jsonb_build_object('parent_line_item_id',:'op_exh','request_source','ios')) AS ri \gset
RESET ROLE;
SELECT (:'ri'::jsonb)->>'work_order_id' AS iw \gset
SELECT (:'ri'::jsonb)->>'requirement_id' AS ireq \gset
SELECT t_assert((:'ri'::jsonb) @> '{"duplicate":false,"vehicle_access_granted":false,"seller_permission":"not_established","payment_authorized":false}'
  AND (:'ri'::jsonb)->>'parent_requirement_id' IS NOT NULL,'2 request_inspection: inspection job + requirement, and an inspection requirement on the parent operation');

SELECT set_config('g.step','before 3',false);
:g_step
-- 3. The inspector claims their work actor (self_claim) and offers on the inspection requirement.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000f1');
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method) VALUES
 ('e7000000-0000-0000-0000-0000000000f1','nuke_actor','e7200000-0000-0000-0000-0000000000f1','e7200000-0000-0000-0000-0000000000f1','self_claim');
SELECT offer_on_requirement(:'ireq',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('description','Pre-purchase inspection at the seller',
  'pricing_basis','flat','amount',180,'currency','USD','unit',NULL,'quantity',NULL))),now()+interval '1 day',now()+interval '10 days',NULL) AS io \gset
RESET ROLE;
SELECT (:'io'::jsonb)->>'offer_id' AS ioffer \gset
SELECT t_assert((:'io'::jsonb) @> '{"offer_kind":"individual","offer_rung":"self_claim","duplicate":false,"payment_authorized":false}','3 offer_on_requirement: inspector offer at the self_claim rung');

SELECT set_config('g.step','before 4',false);
:g_step
-- 4. The client accepts the inspector's offer with the hash the reader hands them.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT a->'args'->>'p_offer_hash' AS ihash FROM jsonb_array_elements(work_order_offers_read(:'iw')#>'{viewer,actions}') a WHERE a->>'action'='accept_offer' \gset
SELECT accept_offer(:'ioffer',:'ihash') AS ia \gset
RESET ROLE;
SELECT t_assert((:'ia'::jsonb) @> '{"role":"inspector","duplicate":false,"payment_authorized":false}','4 accept_offer: inspector assigned');

SELECT set_config('g.step','before 5',false);
:g_step
-- 5. The seller, a verified owner, permits the inspection; ordering and accepting never implied it.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused(format('SELECT grant_inspection_access(%L,%L)',:'iw','Inspect')),'5 stranger cannot grant seller permission');
SELECT t_as('e7000000-0000-0000-0000-0000000000e1');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='inspection_access_request'
  AND i->>'work_order_id'=:'iw' AND i#>>'{sign,rpc}'='grant_inspection_access'),'5 my_signature_queue (seller): inspection_access_request');
SELECT grant_inspection_access(:'iw','Inspect at the seller lot; no test drive',jsonb_build_object('from',now(),'until',now()+interval '14 days')) AS ga \gset
RESET ROLE;
SET ROLE anon;
SELECT g_anon();
SELECT work_order_inspection_read(:'iw') AS ir1 \gset
RESET ROLE;
SELECT t_assert((:'ir1'::jsonb)::text ~ '"established"' AND NOT g_pii(:'ir1'::jsonb),'5 grant_inspection_access: seller permission established; visitor sees no PII');

SELECT set_config('g.step','before 6',false);
:g_step
-- 6. The inspector records findings (their testimony; no price, approval or permission).
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000f1');
SELECT record_inspection_findings(:'iw',jsonb_build_object('summary','Pre-purchase inspection at the seller lot: manifold gasket leaking, muffler rusted through, pads worn',
 'inspection_type','pre_purchase','zones_inspected',jsonb_build_array('undercarriage','brakes'),'overall_condition','fair','deferred_maintenance_minutes',480,
 'findings',jsonb_build_array(
   jsonb_build_object('item_id',(SELECT j#>>'{inspection_scope,ppi_checklist,0,item_id}' FROM g_plan),'system','undercarriage',
     'finding','Manifold gasket leaking and muffler rusted through; replace with stainless','severity','concern','verdict','supports'),
   jsonb_build_object('system','brakes','finding','Front pads at minimum','severity','monitor')))) AS rf \gset
RESET ROLE;
SELECT (:'rf'::jsonb)->>'findings_observation_id' AS fobs \gset
SET ROLE anon;
SELECT g_anon();
SELECT work_order_inspection_read(:'iw') AS ir2 \gset
RESET ROLE;
SELECT t_assert((:'rf'::jsonb)->>'findings'='2' AND NOT g_pii(:'ir2'::jsonb) AND (:'ir2'::jsonb)::text ~ 'gold_inspector'
  AND (:'ir2'::jsonb)::text ~ 'Manifold gasket leaking','6 record_inspection_findings: report open to a visitor, inspector by handle, no PII');

SELECT set_config('g.step','before 7',false);
:g_step
-- 7. The parent job's plan quotes the findings (retained interpretations): a skill requirement and the requested material.
CREATE FUNCTION public.g_interp(p_env jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); f public.vehicle_observations%ROWTYPE; BEGIN
 SELECT * INTO f FROM vehicle_observations WHERE extraction_method='inspection_findings_sign_v1' AND vehicle_id='e7300000-0000-0000-0000-000000000001';
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,confidence_score,structured_data)
 VALUES(k,f.vehicle_id,'work_record','90000000-0000-0000-0000-000000000001',f.observed_at,'requirement_interpretation_v1',0.7,
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'work_order_id','e7400000-0000-0000-0000-000000000001',
  'basis_observation_id',f.id,'basis_excerpt','Manifold gasket leaking and muffler rusted through; replace with stainless')||p_env));
 PERFORM project_work_order_resource_observation(k); RETURN k; END $$;
SELECT g_interp(jsonb_build_object('event_type','requirement','line_item_id',:'op_exh','requirement_kind','skill',
  'description','Stainless exhaust fabrication and TIG welding','quantity',NULL,'unit',NULL)) AS rskill \gset
SELECT g_interp(jsonb_build_object('event_type','specification','specification_stage','requested','line_item_id',:'op_exh','material_role','workpiece',
  'material_label','stainless','material_key','stainless_steel.304')) AS spec \gset

SELECT set_config('g.step','before 8',false);
:g_step
-- 8. The mechanic claims their actor; the evidence finder shows the matching work session; the service approves it
--    naming a distinct admin reviewer.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,verification_method) VALUES
 ('e7900000-0000-0000-0000-0000000000a1','e7000000-0000-0000-0000-0000000000a1','nuke_actor','e7200000-0000-0000-0000-0000000000a1','e7200000-0000-0000-0000-0000000000a1','self_claim');
SELECT actor_link_claim_evidence_read('e7900000-0000-0000-0000-0000000000a1') AS ev \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000ad');
SELECT actor_link_claims_review_queue() AS rq \gset
RESET ROLE;
SELECT t_assert((:'ev'::jsonb)::text ~ 'e7800000-0000-0000-0000-000000000001' AND (:'rq'::jsonb)::text ~ 'e7900000-0000-0000-0000-0000000000a1'
  AND NOT (:'rq'::jsonb)::text ~ 'Mechlegal','8 actor_link_claim_evidence_read finds the same-day work session; admin queue lists the claim without names');
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT approve_actor_link_claim('e7900000-0000-0000-0000-0000000000a1','work_evidence','[{"kind":"work_session","id":"e7800000-0000-0000-0000-000000000001"}]',
  'e7000000-0000-0000-0000-0000000000ad');
RESET ROLE;
SELECT t_assert((SELECT status='approved' AND verification_method='work_evidence' AND reviewed_by_user_id='e7000000-0000-0000-0000-0000000000ad'
  FROM account_link_claims WHERE id='e7900000-0000-0000-0000-0000000000a1'),'8 approve_actor_link_claim: evidenced bridge, reviewed by a distinct admin');

SELECT set_config('g.step','before 9',false);
:g_step
-- 9. The mechanic sees the open requirement with an explainable match and offers.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT open_requirements_read(NULL,100,'skill') AS orr \gset
RESET ROLE;
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'orr'::jsonb)->'rows') r WHERE r->>'requirement_id'=:'rskill'
   AND r->'match' @> '[{"input":"evidence_rung","result":"pass"},{"input":"area","result":"pass"}]'
   AND r->'specifications' @> '[{"material_key":"stainless_steel.304"}]' AND r->>'display_title'='Exhaust and brakes')
 AND NOT g_pii(:'orr'::jsonb),'9 open_requirements_read: the mechanic''s explainable match table (evidenced bridge, area); no PII');
SET ROLE anon;
SELECT g_anon();
SELECT open_requirements_read(NULL,100,'skill') AS orr_anon \gset
RESET ROLE;
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'orr_anon'::jsonb)->'rows') r WHERE jsonb_typeof(r->'match')='array') AND NOT g_pii(:'orr_anon'::jsonb),'9 visitor: open requirements without a match table or PII');

SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT offer_on_requirement(:'rskill',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('description','Stainless exhaust fabrication',
  'pricing_basis','day_rate','amount',400,'currency','USD','unit','day','quantity',2))),now()+interval '2 days',now()+interval '20 days',
  'Can start next week') AS mo \gset
RESET ROLE;
SELECT (:'mo'::jsonb)->>'offer_id' AS moffer \gset
SELECT t_assert((:'mo'::jsonb) @> '{"offer_kind":"individual","offer_rung":"work_evidence","duplicate":false,"payment_authorized":false}'
  AND (:'mo'::jsonb)->>'performer_actor_id'='e7200000-0000-0000-0000-0000000000a1','9 offer_on_requirement: mechanic offers at the work_evidence rung');

SELECT set_config('g.step','before 10',false);
:g_step
-- 10. The shop owner co-signs for Golden Shop: supervision and bay permission, with a 15% cut of the labor line.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused_with(format('SELECT cosign_provider(%L,%L,ARRAY[''supervision''],''x'')','e7400000-0000-0000-0000-000000000001',:'moffer'),
  'needs_facility_organization_or_owned_tools'),'10 a stranger without facility or tools cannot co-sign');
SELECT t_as('e7000000-0000-0000-0000-0000000000b0');
SELECT cosign_provider('e7400000-0000-0000-0000-000000000001',:'moffer',ARRAY['supervision','permission'],
  'Supervised work in Golden Shop bay 2',jsonb_build_object('basis','share_of_labor_line','percentage',15)) AS cs \gset
RESET ROLE;
SELECT t_assert((:'cs'::jsonb) @> '{"co_signer":{"kind":"organization","organization_id":"e7100000-0000-0000-0000-000000000001"},"binding":"on_offer_acceptance",
  "payment_authorized":false}' AND jsonb_array_length((:'cs'::jsonb)->'attestation_ids')=2,'10 cosign_provider: authenticated organization co-sign with a cut term');

SELECT set_config('g.step','before 11',false);
:g_step
-- 11. The client accepts the co-signed offer with its terms hash; the bare offer hash no longer accepts.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT my_signature_queue() AS sq_offer \gset
SELECT t_assert(t_refused(format('SELECT accept_offer(%L,%L)',:'moffer',(:'mo'::jsonb)->>'offer_hash')),'11 the bare offer hash is refused once co-signed');
SELECT accept_offer(:'moffer',(:'cs'::jsonb)->>'terms_hash') AS ma \gset
RESET ROLE;
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'sq_offer'::jsonb)->'items') i WHERE i->>'kind'='offer_to_accept'
   AND i#>>'{sign,args_hint,p_offer_hash}'=(:'cs'::jsonb)->>'terms_hash')
 AND (:'ma'::jsonb) @> '{"role":"technician","cosigner_terms":1,"duplicate":false,"payment_authorized":false}','11 my_signature_queue (client) then accept_offer: provider + cosigner term bound');
SET ROLE anon;
SELECT g_anon();
SELECT work_order_offers_read('e7400000-0000-0000-0000-000000000001') AS ofr_anon \gset
RESET ROLE;
SELECT t_assert((:'ofr_anon'::jsonb)->'accepted_cosigners' @> '[{"co_signer":{"name":"Golden Shop"},"cut":{"pricing_basis":"percentage","percentage":15}}]'
  AND jsonb_array_length((:'ofr_anon'::jsonb)->'accepted_providers')=1 AND NOT g_pii(:'ofr_anon'::jsonb)
  AND NOT (:'ofr_anon'::jsonb)::text ~ 'Can start next week','11 visitor: accepted provider and the shop''s cut open; note and PII withheld');

SELECT set_config('g.step','before 12',false);
:g_step
-- 12. The accepted mechanic quotes the job; 13. the client accepts.
CREATE FUNCTION public.g_qlines(p_exh numeric DEFAULT 400) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_array(
  jsonb_build_object('ref_kind','operation','ref_id',(SELECT id FROM work_order_line_items WHERE work_order_id='e7400000-0000-0000-0000-000000000001' AND line_number=1),
    'description','Stainless exhaust fabrication','pricing_basis','day_rate','amount',p_exh,'currency','USD','unit','day','quantity',2),
  jsonb_build_object('ref_kind','operation','ref_id',(SELECT id FROM work_order_line_items WHERE work_order_id='e7400000-0000-0000-0000-000000000001' AND line_number=2),
    'description','Brake service','pricing_basis','flat','amount',220,'currency','USD','unit',NULL,'quantity',NULL),
  jsonb_build_object('ref_kind','fee','ref_id',NULL,'description','Shop supplies','pricing_basis','flat','amount',40,'currency','USD','unit',NULL,'quantity',NULL)) $$;
GRANT EXECUTE ON FUNCTION public.g_qlines(numeric) TO authenticated;
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT issue_work_order_quote('e7400000-0000-0000-0000-000000000001',g_qlines(),NULL,now()+interval '30 days',NULL) AS q1 \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='quote_to_accept'
  AND i->>'ref_id'=(:'q1'::jsonb)->>'quote_id'),'12 my_signature_queue (client): quote_to_accept');
SELECT accept_work_order_quote(((:'q1'::jsonb)->>'quote_id')::uuid,(:'q1'::jsonb)->>'quote_hash') AS qa \gset
RESET ROLE;
SELECT t_assert((:'q1'::jsonb) @> '{"version":1,"issued_by_role":"accepted_provider","duplicate":false,"payment_authorized":false}'
  AND (:'qa'::jsonb)->>'duplicate'='false','12-13 issue_work_order_quote by the accepted provider; accept_work_order_quote by the client');

SELECT set_config('g.step','before 14',false);
:g_step
-- 14. Change order: the client chose 409 stainless (material substitution on the requested spec) at a lower day rate.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT issue_change_order('e7400000-0000-0000-0000-000000000001',((:'q1'::jsonb)->>'quote_id')::uuid,jsonb_build_array(
  jsonb_build_object('action','substitute','specification_id',:'spec','field','material','from_key','stainless_steel.304','to_key','stainless_steel.409',
    'to_label','409 stainless','line_index',0,'line',g_qlines(380)->0)),'Client chose 409 stainless') AS co \gset
SELECT set_config('g.step','before 15',false);
:g_step
-- 15. The client accepts the change order on the quote acceptance path.
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='change_order_to_accept'
  AND i->>'ref_id'=(:'co'::jsonb)->>'quote_id'),'14 my_signature_queue (client): change_order_to_accept');
SELECT accept_work_order_quote(((:'co'::jsonb)->>'quote_id')::uuid,(:'co'::jsonb)->>'quote_hash') AS coa \gset
RESET ROLE;
SELECT t_assert((:'co'::jsonb) @> '{"version":2,"duplicate":false,"payment_authorized":false}'
  AND (:'co'::jsonb)#>'{change_order,changes}' @> '[{"action":"substitute","base_line_index":0,"new_line_index":0,
    "specification":{"field":"material","from_key":"stainless_steel.304","to_key":"stainless_steel.409"},"from_line":{"amount":400},"to_line":{"amount":380}}]',
  '14-15 issue_change_order: material substitution as an explicit change line; accepted');
SET ROLE anon;
SELECT g_anon();
SELECT work_order_quotes_read('e7400000-0000-0000-0000-000000000001') AS qr_anon \gset
RESET ROLE;
SELECT t_assert((:'qr_anon'::jsonb) @> '{"current_quote":{"is_change_order":true,"version":2},"change_order":{"state":"accepted"},"acceptance":{"state":"accepted"}}'
  AND NOT g_pii(:'qr_anon'::jsonb),'15 visitor: accepted change order with its diff open; signer not identified');

SELECT set_config('g.step','before 16',false);
:g_step
-- 16. The mechanic attaches their own photos of the work.
INSERT INTO vehicle_images(id,vehicle_id,taken_at,is_external,user_id,vision_gate_status,image_url,is_sensitive,is_superseded) VALUES
 ('e7a00000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000001',clock_timestamp(),false,'e7000000-0000-0000-0000-0000000000a1','approved','https://img.example.invalid/1.jpg',false,false),
 ('e7a00000-0000-0000-0000-000000000002','e7300000-0000-0000-0000-000000000001',clock_timestamp(),false,'e7000000-0000-0000-0000-0000000000a1','approved','https://img.example.invalid/2.jpg',false,false);
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT job_evidence_candidates_read('e7400000-0000-0000-0000-000000000001') AS cand \gset
SELECT attach_job_evidence('e7400000-0000-0000-0000-000000000001',ARRAY['e7a00000-0000-0000-0000-000000000001','e7a00000-0000-0000-0000-000000000002']::uuid[],
  :'op_exh','Welds before wrap') AS att \gset
RESET ROLE;
SELECT t_assert(jsonb_array_length((:'cand'::jsonb)->'items')=2 AND (:'att'::jsonb) @> '{"image_count":2,"attacher_role":"accepted_provider","image_visibility_changed":false,"duplicate":false}',
  '16 job_evidence_candidates_read lists own in-window photos; attach_job_evidence links them (no visibility change)');
SET ROLE anon;
SELECT g_anon();
SELECT work_order_evidence_read('e7400000-0000-0000-0000-000000000001') AS evr_anon \gset
RESET ROLE;
SELECT t_assert(NOT (:'evr_anon'::jsonb)::text ~ 'Welds before wrap' AND NOT g_pii(:'evr_anon'::jsonb),'16 visitor: evidence reader withholds the note and PII');

SELECT set_config('g.step','before 17',false);
:g_step
-- 17. The mechanic attests completion against the accepted change order; 18. the client accepts that exact attestation.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(t_refused(format('SELECT attest_work_completion(%L,%L)','e7400000-0000-0000-0000-000000000001',(:'co'::jsonb)->>'quote_hash')),'17 the customer cannot attest completion');
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT t_assert(t_refused(format('SELECT attest_work_completion(%L,%L)','e7400000-0000-0000-0000-000000000001',(:'q1'::jsonb)->>'quote_hash')),'17 the superseded base quote hash is refused');
SELECT attest_work_completion('e7400000-0000-0000-0000-000000000001',(:'co'::jsonb)->>'quote_hash','Exhaust and brakes done',
  '[{"kind":"image","id":"e7a00000-0000-0000-0000-000000000002"}]') AS at \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT my_signature_queue() AS sq_comp \gset
SELECT accept_work_completion('e7400000-0000-0000-0000-000000000001',((:'at'::jsonb)->>'completion_id')::uuid,(:'at'::jsonb)->>'completion_hash') AS ac \gset
RESET ROLE;
SELECT t_assert((:'at'::jsonb) @> '{"scope_basis":"accepted_quote","signer_role":"accepted_provider","evidence_count":1,"payment_authorized":false,"work_order_status_changed":false}'
  AND (:'at'::jsonb)->>'quote_id'=(:'co'::jsonb)->>'quote_id'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'sq_comp'::jsonb)->'items') i WHERE i->>'kind'='completion_to_accept' AND i->>'ref_id'=(:'at'::jsonb)->>'completion_id')
  AND (:'ac'::jsonb) @> '{"signer_role":"customer","duplicate":false,"payment_authorized":false}','17-18 attest_work_completion pinned to the change order; queue; accept_work_completion');

SELECT set_config('g.step','before 19',false);
:g_step
-- 19. The mechanic invoices the change-order lines; 20. the client reports paying, the mechanic confirms receipt.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT issue_work_order_invoice('e7400000-0000-0000-0000-000000000001',jsonb_build_array(
  jsonb_build_object('quote_line',0,'description','Stainless exhaust fabrication','pricing_basis','day_rate','amount',380,'currency','USD','unit','day','quantity',2),
  jsonb_build_object('quote_line',1,'description','Brake service','pricing_basis','flat','amount',220,'currency','USD'),
  jsonb_build_object('quote_line',2,'description','Shop supplies','pricing_basis','flat','amount',40,'currency','USD')),
  ((:'co'::jsonb)->>'quote_id')::uuid,now()+interval '14 days') AS inv \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT record_work_order_payment(((:'inv'::jsonb)->>'invoice_id')::uuid,1020,'USD','card',now()-interval '5 minutes','client-ref-77') AS pw1 \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT my_signature_queue() AS sq_pay \gset
SELECT record_work_order_payment(((:'inv'::jsonb)->>'invoice_id')::uuid,1020,'USD','card',now()-interval '5 minutes','client-ref-77') AS pw2 \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT work_order_invoices_read('e7400000-0000-0000-0000-000000000001') AS invr_client \gset
RESET ROLE;
SELECT t_assert((:'inv'::jsonb) @> '{"total":1020,"issuer_role":"accepted_provider","payment_requested":false,"payment_authorized":false,"money_moved":false,
   "changes_from_quote":{"unchanged":3,"delta_from_quote":0}}'
 AND (:'pw1'::jsonb) @> '{"witness_side":"payer","reconciliation":{"state":"payer_reported_unconfirmed"},"payment_authorized":false,"disbursement":"not_performed"}'
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'sq_pay'::jsonb)->'items') i WHERE i->>'kind'='invoice_payment_to_confirm')
 AND (:'pw2'::jsonb) @> '{"witness_side":"payee","reconciliation":{"state":"paid","balance_due":0},"payment_authorized":false,"disbursement":"not_performed","money_moved":false}',
 '19-20 issue_work_order_invoice; payer report; payee queue item; payee confirmation settles; nothing authorized or moved');
SELECT t_assert((:'invr_client'::jsonb) @> '{"release":{"met":true,"payment_authorized":false,"disbursement":"not_performed"},"money_moved":false}'
  AND jsonb_array_length((:'invr_client'::jsonb)->'payments')=2,'20 client (party): payments, reconciliation and release conditions met; payment_authorized false');

SET ROLE anon;
SELECT g_anon();
SELECT work_order_job_path_read('e7400000-0000-0000-0000-000000000001') AS jp_anon \gset
SELECT provider_profile_read('e7000000-0000-0000-0000-0000000000a1') AS pp_anon \gset
SELECT provider_job_record_read('e7000000-0000-0000-0000-0000000000a1') AS pj_anon \gset
SELECT work_order_invoices_read('e7400000-0000-0000-0000-000000000001') AS inv_anon \gset
RESET ROLE;
SET ROLE service_role;
SELECT read_work_order_job_path('e7400000-0000-0000-0000-000000000001') AS jp_svc \gset
SELECT work_order_job_path_scoreboard() AS sb \gset
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM jsonb_object_keys((:'jp_svc'::jsonb)->'stages'))=7
 AND (:'jp_svc'::jsonb)->'stages' @> '{"intake":{"state":"recorded"},"inspection":{"state":"recorded"},"terms":{"state":"recorded","customer_acceptance":"signed",
   "change_order":{"state":"accepted"}},"completion":{"state":"recorded"},"accounting":{"state":"recorded"}}'
 AND (:'jp_svc'::jsonb)#>>'{stages,plan,state}'='partial' AND (:'jp_svc'::jsonb)#>'{stages,plan,gaps}' @> '["operations_without_requirements"]'
 AND (:'jp_svc'::jsonb)#>'{stages,execution,attached_evidence}' @> '{"images":2}' AND (:'jp_svc'::jsonb)#>'{stages,execution,gaps}' @> '["no_start_clock"]',
 'job path: all 7 stages; intake/inspection/terms/completion/accounting recorded; plan partial (brakes op has no requirement); execution has evidence but no start Sign');
SELECT t_assert((:'jp_anon'::jsonb)#>>'{stages,accounting,state}' IN ('withheld','not_reported') OR NOT (:'jp_anon'::jsonb)#>'{stages,accounting}' ? 'reconciliation',
  'job path (visitor): accounting withheld');
SELECT t_assert(NOT g_pii(:'jp_anon'::jsonb) AND NOT (:'jp_anon'::jsonb)::text ~ '"amount"|: 1020[,}]|client-ref','job path (visitor): no PII, amounts or references');
SELECT t_assert((:'sb'::jsonb) ? 'stages' AND ((:'sb'::jsonb)#>>'{stages,completion,recorded}')::int>=1 AND ((:'sb'::jsonb)#>>'{stages,accounting,recorded}')::int>=1
  AND ((:'sb'::jsonb)#>>'{stages,inspection,recorded}')::int>=1,'scoreboard counts this work order''s recorded completion, accounting and inspection');
SELECT t_assert((:'pp_anon'::jsonb)#>'{tools,co_signed}' @> '{"authenticated_attestations":2}'
  AND ((:'pp_anon'::jsonb)#>>'{work_record,jobs,jobs}')::int=2 AND (:'pp_anon'::jsonb)#>'{work_record,jobs,completion}' @> '{"recorded":1}'
  AND NOT g_pii(:'pp_anon'::jsonb),'provider_profile_read (visitor): the job counts with its recorded completion; shop co-sign authenticated; no PII');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'pj_anon'::jsonb)->'rows') r WHERE r->>'work_order_id'='e7400000-0000-0000-0000-000000000001'
   AND r->'subject_roles' @> '["accepted_provider"]' AND r->>'customer_acceptance'='signed' AND r#>>'{stage_states,accounting}'='withheld')
 AND NOT g_pii(:'pj_anon'::jsonb),'provider_job_record_read (visitor): the job with customer acceptance signed, accounting withheld, no customer identity');

SELECT set_config('g.step','before contact',false);
:g_step
-- Contact between client and mechanic, brokered in app; nobody else reads the thread.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT request_contact('work_order','e7400000-0000-0000-0000-000000000001','Can you start Monday?','e7000000-0000-0000-0000-0000000000a1') AS cr \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'='contact_request'),'contact: request in the mechanic''s queue');
SELECT respond_contact_request(((:'cr'::jsonb)->>'request_id')::uuid,true);
SELECT post_contact_message(((:'cr'::jsonb)->>'request_id')::uuid,'Monday works.');
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT contact_thread_read(((:'cr'::jsonb)->>'request_id')::uuid) AS th \gset
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused(format('SELECT contact_thread_read(%L)',(:'cr'::jsonb)->>'request_id')),'contact: a stranger cannot read the thread');
RESET ROLE;
SELECT t_assert((:'cr'::jsonb) @> '{"status":"pending","delivery":"in_app","recipient":{"handle":"gold_mech"}}'
  AND (:'th'::jsonb) @> '{"request":{"status":"accepted"},"messages":[{"body":"Monday works."}]}' AND NOT g_pii(:'th'::jsonb),
  'contact: request, acceptance and thread between the two parties; no contact fields');

-- Privacy sweep after the last step.
SELECT set_config('g.step','after contact',false);
:g_step
SELECT t_assert((SELECT count(DISTINCT step) FROM g_sweep)=19 AND (SELECT count(*) FROM g_sweep WHERE step='after contact')=30
  AND (SELECT count(DISTINCT viewer) FROM g_sweep)=2,'sweep: the open readers captured for visitor and stranger after every step (15 readers each at the end)');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM g_sweep WHERE g_pii(j)),'sweep: no legal names, contact fields, street addresses or the private client id');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM g_sweep WHERE j::text ~ '(client-ref-77|"payer_reported"|"confirmed_received"|"balance_due": [0-9]|Welds before wrap|Can start next week|Monday works)'),
  'sweep: no payment witnesses, balances, private notes or messages');
SELECT t_assert((SELECT bool_and(j->'payments' = 'null'::jsonb AND j->'reconciliation' = 'null'::jsonb AND j->'release' = 'null'::jsonb)
  FROM g_sweep WHERE reader='work_order_invoices_read'),'sweep: invoice payments, reconciliation and release only to parties');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM g_sweep WHERE j::text ~ '"payment_authorized": true'
  OR (j::text ~ '"disbursement": "' AND j::text !~ '"disbursement": "not_performed"')),'sweep: payment_authorized never true; disbursement not_performed');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM g_sweep WHERE (j->'viewer'->>'money_visible')::boolean),'sweep: money_visible false for visitor and stranger');

-- No Sign on the path authorized a payment or disbursed anything.
CREATE TEMP TABLE g_signs(label text, j jsonb);
INSERT INTO g_signs VALUES ('request_inspection',:'ri'),('offer inspector',:'io'),('accept_offer inspector',:'ia'),('grant_inspection_access',:'ga'),
 ('record_inspection_findings',:'rf'),('offer mechanic',:'mo'),('cosign_provider',:'cs'),('accept_offer mechanic',:'ma'),('issue_work_order_quote',:'q1'),
 ('accept_work_order_quote',:'qa'),('issue_change_order',:'co'),('accept change order',:'coa'),('attach_job_evidence',:'att'),('attest_work_completion',:'at'),
 ('accept_work_completion',:'ac'),('issue_work_order_invoice',:'inv'),('payment payer',:'pw1'),('payment payee',:'pw2'),('request_contact',:'cr');
SELECT t_assert((SELECT count(*) FROM g_signs)=19 AND NOT EXISTS (SELECT 1 FROM g_signs WHERE j::text ~ '"payment_authorized": true'
  OR (j ? 'disbursement' AND j->>'disbursement' <> 'not_performed') OR (j ? 'money_moved' AND (j->>'money_moved')::boolean))
 AND (SELECT count(*) FROM g_signs WHERE j ? 'payment_authorized')>=14,'every Sign on the path: payment_authorized false, nothing disbursed or moved');
