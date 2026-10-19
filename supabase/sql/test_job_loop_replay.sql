-- Disposable PG17 only. Replay of the job-loop build's migrations in filename order, exactly as a fresh environment
-- (supabase db reset, a preview branch, a new project) applies them. Live deploys apply only files a push ADDS, in push
-- order, so live order can differ from filename order; this contract makes filename-order collisions fail in CI.
-- Fixture: the pre-build owners these migrations read (the contract fixture approach; union of the job-loop chains).
-- Scope: every migration from 20261019005027 on whose name matches scripts/ci/job-loop-replay-check.sh; append new ones
-- below in filename order (the check fails the contract when one is missing, absent or out of order).
-- Out of scope (other lanes in the same range; their own contracts cover them):
--   migrations/20261019031934_work_order_image_objects.sql (image lane; needs the canonical image-object fixture)
--   and the non-job files of 2026-10-19: facet, truck, auction bids, org signals, lotus/honda identity, cab custody,
--   device capture, live auction board, profile reader role, merge identity, source species, broadcast profile, org
--   name trgm, canonical make, identity marks/handle index, family sales, fold docket, marketplace listings.
\set ON_ERROR_STOP on
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
-- Pre-build owners read by later build migrations (union of the contract chains' fixtures).
CREATE TABLE public.technicians(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE FUNCTION public.resolve_work_order_status(p text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT NULL::jsonb';
CREATE FUNCTION public.work_order_balance(p uuid) RETURNS numeric LANGUAGE sql STABLE AS 'SELECT NULL::numeric';
ALTER TABLE public.actors ADD COLUMN organization_name text, ADD COLUMN parent_actor_id uuid, ADD COLUMN city text, ADD COLUMN state text,
  ADD COLUMN country text, ADD COLUMN specialties text[], ADD COLUMN certifications text[], ADD COLUMN trust_score numeric,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN bio text,
  ADD COLUMN profile_image_url text, ADD COLUMN licenses text[], ADD COLUMN training text[], ADD COLUMN years_experience integer,
  ADD COLUMN specialty_makes text[], ADD COLUMN specialty_eras text[], ADD COLUMN current_workload integer, ADD COLUMN max_concurrent_projects integer,
  ADD COLUMN typical_turnaround_days integer, ADD COLUMN total_documented_jobs integer, ADD COLUMN total_components_touched integer,
  ADD COLUMN phone text, ADD COLUMN email text, ADD COLUMN website text, ADD COLUMN location text, ADD COLUMN notes text;
CREATE FUNCTION public.calculate_work_order_estimate() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.estimated_total := COALESCE(NEW.estimated_labor_cost, 0) + COALESCE(NEW.estimated_parts_cost, 0);
  NEW.actual_total := COALESCE(NEW.actual_labor_cost, 0) + COALESCE(NEW.actual_parts_cost, 0);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
ALTER TABLE public.vehicle_images ADD COLUMN user_id uuid, ADD COLUMN image_url text, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN is_sensitive boolean, ADD COLUMN is_superseded boolean, ADD COLUMN vision_gate_status text;
CREATE TABLE public.organization_vehicles(organization_id uuid, vehicle_id uuid);
\ir helpers/facility_tables_live_20261019.sql
ALTER TABLE public.user_tools ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS total_quantity integer, ADD COLUMN IF NOT EXISTS total_spent numeric;
ALTER TABLE public.tool_inventory ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS purchase_price numeric;
ALTER TABLE public.business_ownership ADD COLUMN IF NOT EXISTS ownership_type text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS business_type text, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.organization_images ADD COLUMN IF NOT EXISTS taken_at timestamptz, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, event_date date);
CREATE TABLE public.contractor_work_contributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, contractor_user_id uuid, work_date date);
CREATE FUNCTION public.org_site_photos(p_org_id uuid, p_user_id uuid, p_from timestamptz, p_to timestamptz, p_radius_m double precision DEFAULT 150)
RETURNS TABLE(image_id uuid, vehicle_id uuid, taken_at timestamptz, shared_with integer, vehicle_linked boolean)
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::integer, NULL::boolean WHERE false $$;
CREATE FUNCTION public.relation_weight(p_last timestamptz, p_at timestamptz DEFAULT now(), p_half_life interval DEFAULT '06:00:00')
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_last IS NULL OR p_at IS NULL OR p_last > p_at THEN 0::double precision
    WHEN extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life) > 50 THEN 0::double precision
    ELSE power(2::double precision, -extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life)) END $$;
CREATE FUNCTION public.relation_state(p_weight double precision) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_weight >= 0.5 THEN 'live' WHEN p_weight >= 0.0625 THEN 'stalling' ELSE 'dormant' END $$;
CREATE FUNCTION public.user_org_relations(p_user_id uuid, p_at timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('relations', COALESCE(jsonb_agg(jsonb_build_object('organization_id', oc.organization_id, 'name', NULL,
    'type', NULL, 'role', oc.role, 'membership_status', oc.status,
    'relation', jsonb_build_object('weight', 0.5, 'state', 'live', 'last_contribution_at', '2026-01-04T12:00:00Z'))), '[]'::jsonb))
  FROM public.organization_contributors oc WHERE oc.user_id = p_user_id $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
ALTER TABLE public.component_events ADD COLUMN component_table text, ADD COLUMN component_id uuid, ADD COLUMN event_type text,
  ADD COLUMN actor_id uuid, ADD COLUMN event_date date, ADD COLUMN description text, ADD COLUMN evidence_ids uuid[];
CREATE TABLE public.actor_capabilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE CASCADE,
  capability_type text NOT NULL CONSTRAINT chk_ac_capability_type CHECK (capability_type = ANY (ARRAY['engine_machining','engine_assembly','engine_tuning',
    'engine_diagnostics','transmission_rebuild','differential_rebuild','transfer_case_rebuild','brake_rebuild','brake_fabrication','suspension_rebuild',
    'suspension_fabrication','steering_rebuild','steering_fabrication','paint_refinish','paint_correction','paint_custom','body_repair','body_fabrication',
    'rust_repair','panel_replacement','frame_repair','frame_fabrication','frame_reinforcement','upholstery_repair','upholstery_full','convertible_top',
    'electrical_repair','electrical_custom','wiring_harness','welding_mig','welding_tig','welding_stick','welding_gas','welding_brazing',
    'fabrication_sheet_metal','fabrication_tube','fabrication_exhaust','glass_installation','glass_fabrication','chrome_plating','powder_coating',
    'anodizing','machine_lathe','machine_mill','machine_cnc','machine_hone','machine_grind','appraisal','inspection','documentation','judging',
    'transport','storage','detailing','general_maintenance','diagnostics_obd','diagnostics_analog','fuel_system','cooling_system','exhaust_system',
    'intake_system','ac_system','audio_system','hydraulics'])),
  complexity_tier text NOT NULL CONSTRAINT chk_ac_complexity_tier CHECK (complexity_tier = ANY (ARRAY['basic','intermediate','advanced','expert','master'])),
  evidence_count integer NOT NULL CONSTRAINT chk_ac_evidence_count CHECK (evidence_count >= 0), first_demonstrated date, last_demonstrated date,
  best_outcome_vehicle_id uuid, best_outcome_description text, avg_spec_compliance numeric, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ac_dates CHECK (last_demonstrated IS NULL OR first_demonstrated IS NULL OR last_demonstrated >= first_demonstrated));
ALTER TABLE public.actor_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view actor_capabilities" ON public.actor_capabilities FOR SELECT USING (true);
GRANT SELECT ON public.actor_capabilities TO anon, authenticated;
GRANT ALL ON public.actor_capabilities TO service_role;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS estimated_labor_cost numeric, ADD COLUMN IF NOT EXISTS estimated_parts_cost numeric,
  ADD COLUMN IF NOT EXISTS actual_labor_cost numeric, ADD COLUMN IF NOT EXISTS actual_parts_cost numeric, ADD COLUMN IF NOT EXISTS actual_total numeric,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- This build in filename order.
\echo REPLAY 20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\echo REPLAY 20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\echo REPLAY 20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\echo REPLAY 20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\echo REPLAY 20261019045753_work_order_job_path.sql
\ir ../migrations/20261019045753_work_order_job_path.sql
\echo REPLAY 20261019051336_work_order_scope_operations.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql
\echo REPLAY 20261019054333_close_work_order_pii_readers.sql
\ir ../migrations/20261019054333_close_work_order_pii_readers.sql
\echo REPLAY 20261019060000_actors_contact_columns_service_only.sql
\ir ../migrations/20261019060000_actors_contact_columns_service_only.sql
\echo REPLAY 20261019091500_account_link_claims_actor_bridge.sql
\ir ../migrations/20261019091500_account_link_claims_actor_bridge.sql
\echo REPLAY 20261019093000_job_readers_authenticated.sql
\ir ../migrations/20261019093000_job_readers_authenticated.sql
\echo REPLAY 20261019094500_work_order_quotes.sql
\ir ../migrations/20261019094500_work_order_quotes.sql
\echo REPLAY 20261019100000_account_link_claims_pending_inserts_only.sql
\ir ../migrations/20261019100000_account_link_claims_pending_inserts_only.sql
\echo REPLAY 20261019120000_work_order_quote_issue.sql
\ir ../migrations/20261019120000_work_order_quote_issue.sql
\echo REPLAY 20261019121500_open_job_readers.sql
\ir ../migrations/20261019121500_open_job_readers.sql
\echo REPLAY 20261019123000_work_order_job_path_quotes.sql
\ir ../migrations/20261019123000_work_order_job_path_quotes.sql
\echo REPLAY 20261019124500_work_order_quotes_open_read.sql
\ir ../migrations/20261019124500_work_order_quotes_open_read.sql
\echo REPLAY 20261019130000_work_order_statement_read.sql
\ir ../migrations/20261019130000_work_order_statement_read.sql
\echo REPLAY 20261019140000_provider_profile_read.sql
\ir ../migrations/20261019140000_provider_profile_read.sql
\echo REPLAY 20261019150000_inspection_request.sql
\ir ../migrations/20261019150000_inspection_request.sql
\echo REPLAY 20261019151500_provider_job_record_read.sql
\ir ../migrations/20261019151500_provider_job_record_read.sql
\echo REPLAY 20261019152500_inspection_findings.sql
\ir ../migrations/20261019152500_inspection_findings.sql
\echo REPLAY 20261019153000_job_path_inspection.sql
\ir ../migrations/20261019153000_job_path_inspection.sql
\echo REPLAY 20261019160000_provider_profile_read_cold_start.sql
\ir ../migrations/20261019160000_provider_profile_read_cold_start.sql
\echo REPLAY 20261019161500_open_requirements_read.sql
\ir ../migrations/20261019161500_open_requirements_read.sql
\echo REPLAY 20261019170000_work_order_estimate_unknown_not_zero.sql
\ir ../migrations/20261019170000_work_order_estimate_unknown_not_zero.sql
\echo REPLAY 20261019180000_work_order_offers.sql
\ir ../migrations/20261019180000_work_order_offers.sql
\echo REPLAY 20261019181500_contact_broker.sql
\ir ../migrations/20261019181500_contact_broker.sql
\echo REPLAY 20261019182000_work_order_offer_acceptance.sql
\ir ../migrations/20261019182000_work_order_offer_acceptance.sql
\echo REPLAY 20261019183000_work_order_offers_read.sql
\ir ../migrations/20261019183000_work_order_offers_read.sql
\echo REPLAY 20261019184500_inspection_access.sql
\ir ../migrations/20261019184500_inspection_access.sql
\echo REPLAY 20261019190000_actor_link_claim_evidence.sql
\ir ../migrations/20261019190000_actor_link_claim_evidence.sql
\echo REPLAY 20261019191500_listing_work_plan_read.sql
\ir ../migrations/20261019191500_listing_work_plan_read.sql
\echo REPLAY 20261019200000_work_order_completion_sign.sql
\ir ../migrations/20261019200000_work_order_completion_sign.sql
\echo REPLAY 20261019201500_work_order_invoice_payment_witness.sql
\ir ../migrations/20261019201500_work_order_invoice_payment_witness.sql
\echo REPLAY 20261019210000_work_order_cosign.sql
\ir ../migrations/20261019210000_work_order_cosign.sql
\echo REPLAY 20261019211500_provider_vouches.sql
\ir ../migrations/20261019211500_provider_vouches.sql
\echo REPLAY 20261019213000_work_order_change_orders.sql
\ir ../migrations/20261019213000_work_order_change_orders.sql
\echo REPLAY 20261019214500_signature_queue_all_signs.sql
\ir ../migrations/20261019214500_signature_queue_all_signs.sql
\echo REPLAY 20261019220000_job_evidence_attach.sql
\ir ../migrations/20261019220000_job_evidence_attach.sql
\echo REPLAY 20261019221500_quote_release_terms.sql
\ir ../migrations/20261019221500_quote_release_terms.sql
\echo REPLAY 20261019224000_facility_assets.sql
\ir ../migrations/20261019224000_facility_assets.sql
\echo REPLAY 20261019225000_facility_reservations.sql
\ir ../migrations/20261019225000_facility_reservations.sql
\echo REPLAY 20261019226000_facility_read.sql
\ir ../migrations/20261019226000_facility_read.sql
\echo REPLAY 20261019227000_open_requirements_facility_assets.sql
\ir ../migrations/20261019227000_open_requirements_facility_assets.sql
\echo REPLAY 20261019230000_provider_jobs_accepted_offers.sql
\ir ../migrations/20261019230000_provider_jobs_accepted_offers.sql
\echo REPLAY 20261019231500_job_loop_grant_tidy.sql
\ir ../migrations/20261019231500_job_loop_grant_tidy.sql
\echo REPLAY 20261019233000_post_work_request.sql
\ir ../migrations/20261019233000_post_work_request.sql
\echo REPLAY 20261019234000_post_work_request_description.sql
\ir ../migrations/20261019234000_post_work_request_description.sql
\echo REPLAY 20261019234500_start_work.sql
\ir ../migrations/20261019234500_start_work.sql

\echo REPLAY 20261019235000_capability_fold.sql
\ir ../migrations/20261019235000_capability_fold.sql
\echo REPLAY 20261019235300_provider_profile_derived_capabilities.sql
\ir ../migrations/20261019235300_provider_profile_derived_capabilities.sql
\echo REPLAY 20261019235600_provider_productivity_read.sql
\ir ../migrations/20261019235600_provider_productivity_read.sql
\echo REPLAY 20261019235700_job_facility_reservations_read.sql
\ir ../migrations/20261019235700_job_facility_reservations_read.sql
\echo REPLAY 20261019235800_my_vouches_read.sql
\ir ../migrations/20261019235800_my_vouches_read.sql
\echo REPLAY 20261019235900_offers_cosign_acting_for.sql
\ir ../migrations/20261019235900_offers_cosign_acting_for.sql
\echo REPLAY 20261019235930_quotes_release_conditions_read.sql
\ir ../migrations/20261019235930_quotes_release_conditions_read.sql
\echo REPLAY 20261020000500_work_order_invented_zero_totals.sql
\ir ../migrations/20261020000500_work_order_invented_zero_totals.sql
\echo REPLAY 20261020002000_owner_delegated_signs.sql
\ir ../migrations/20261020002000_owner_delegated_signs.sql
\echo REPLAY 20261020003000_work_order_retained_testimony.sql
\ir ../migrations/20261020003000_work_order_retained_testimony.sql
\echo REPLAY 20261020004000_vehicle_work_orders_viewer_access.sql
\ir ../migrations/20261020004000_vehicle_work_orders_viewer_access.sql
-- Plan check and final state.
\set replay_problems `scripts/ci/job-loop-replay-check.sh | tr '\n' ' '`
SELECT t_assert(btrim(:'replay_problems') = '', 'replay plan covers the build in filename order: ' || COALESCE(NULLIF(btrim(:'replay_problems'), ''), 'ok'));
SELECT t_assert(public.work_order_change_orders_live() AND prosrc LIKE '%change_order IS NOT NULL%',
  'signature-queue hooks keep the change-order definitions (20261019213000) after 20261019214500')
FROM pg_proc WHERE oid = 'public.work_order_quote_is_change_order(uuid)'::regprocedure;
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure),
  'work_order_(completion|accounting|execution_evidence)_overlay', 'g')) = 3, 'job path carries the completion, accounting and execution overlay lines once each');
