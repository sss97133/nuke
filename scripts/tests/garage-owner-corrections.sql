-- Synthetic, isolated PostgreSQL fixture only. Never run against Nuke production.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT current_setting('fixture.role',true) $$;
CREATE TYPE public.observation_kind AS ENUM ('listing','sale_result','comment','bid','specification','condition','media','provenance','splice');
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, merged_into_vehicle_id uuid,
 year integer,make text,model text,is_public boolean,deleted_at timestamptz,listing_kind text);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text,display_name text);
CREATE TABLE public.observation_properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),property_key text,
 namespace text,deprecated_at timestamptz,discriminator_key text);
CREATE TABLE public.schema_proposals(id uuid DEFAULT gen_random_uuid(),proposed_by_agent_key text,proposal_type text,
 payload jsonb,evidence jsonb,estimated_scope jsonb,backward_compatibility jsonb,status text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles,user_id uuid REFERENCES profiles,
 image_url text,is_superseded boolean DEFAULT false,is_duplicate boolean DEFAULT false,is_document boolean DEFAULT false,
 image_vehicle_match_status text,vision_gate_status text);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES vehicles,
 subject_type text,subject_id uuid,property_id uuid REFERENCES observation_properties,source_id uuid REFERENCES observation_sources,
 source_identifier text,observed_at timestamptz,content_text text,content_hash text,structured_data jsonb,
 submitted_by_user_id uuid REFERENCES profiles,observer_raw jsonb,extraction_method text,kind observation_kind,
 confidence text,confidence_score numeric,is_superseded boolean DEFAULT false,superseded_by uuid REFERENCES vehicle_observations,
 superseded_at timestamptz,lineage_chain uuid[],is_processed boolean,processing_metadata jsonb,
 source_observation_id uuid REFERENCES vehicle_observations,rank text DEFAULT 'normal',changeset_id uuid,
 source_url text,ingested_at timestamptz DEFAULT now());
CREATE TABLE public.user_subscriptions(user_id uuid,target_id uuid,is_active boolean,subscription_type text);
CREATE TABLE public.user_notifications(id uuid,user_id uuid,type text,notification_type text,title text,message text,
 vehicle_id uuid,action_url text,is_read boolean,metadata jsonb,created_at timestamptz);
ALTER TABLE vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_read ON vehicle_observations FOR SELECT TO authenticated,anon USING (true);
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
\ir ../../supabase/migrations/20261008050000_garage_owner_corrections.sql
CREATE TRIGGER fixture_notify AFTER INSERT ON vehicle_observations FOR EACH ROW
 EXECUTE FUNCTION notify_subscribers_on_observation();
INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO vehicles(id,year,make,model,is_public) VALUES ('00000000-0000-4000-8000-000000000010',1970,'Example','Car',true);
INSERT INTO observation_sources VALUES ('00000000-0000-4000-8000-000000000020','owner-input','Owner input');
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url) VALUES ('00000000-0000-4000-8000-000000000030',
 '00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','fixture-photo');
INSERT INTO user_subscriptions VALUES ('00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000010',true,'vehicle_status_change');
CREATE FUNCTION fixture_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION fixture_fails(statement text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE=expected_state THEN RETURN; END IF;
   RAISE EXCEPTION 'unexpected SQLSTATE %: %',SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'expected failure did not occur: %',statement;
 END $$;
CREATE FUNCTION fixture_claim(role_name text,denied boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('relationship',jsonb_build_object('roles',jsonb_build_array(role_name),
  'ownership_denied',denied,'title_status','unknown','disputed',false,'start_date',null,'end_date',null)) $$;
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','authenticated',false);
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000040',fixture_claim('owner_past'),'I previously owned it')$q$,'23514');
-- Ratification is synthetic fixture setup, not an approval of production schema.
INSERT INTO observation_properties(property_key,namespace) VALUES ('garage_relationship','core');
CREATE TEMP TABLE fixture_result(id uuid);
INSERT INTO fixture_result SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000040',fixture_claim('owner_past'),'I previously owned it');
SELECT fixture_assert((SELECT id FROM fixture_result)=record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000040',fixture_claim('owner_past'),'I previously owned it'),'idempotent replay');
SELECT fixture_assert((SELECT count(*) FROM vehicle_observations)=1,'replay appends once');
SELECT fixture_assert((SELECT structured_data->'correction'->'relationship'->'end_date' FROM vehicle_observations)='null'::jsonb,'unknown end stays NULL');
SELECT fixture_assert((SELECT count(*) FROM user_notifications)=0,'private correction is not broadcast');
SELECT fixture_assert((SELECT count(*) FROM vehicle_canonical)=0,'private correction absent from definer canonical view');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000041',fixture_claim('owner_past'),'Other account')$q$,'42501');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000040',fixture_claim('owner_current'),'Changed request')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000042',fixture_claim('verified_owner'),'Unqualified title')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000042',fixture_claim('owner_current',true),'Contradictory')$q$,'23514');
SELECT fixture_fails($q$UPDATE vehicle_observations SET content_text='overwrite'$q$,'23514');
SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000043',fixture_claim('consignment'),'It was a consignment',null,(SELECT id FROM fixture_result));
SELECT fixture_assert((SELECT count(*) FROM vehicle_observations)=2,'predecessor retained');
SELECT fixture_assert((SELECT count(*) FROM vehicle_observations WHERE is_superseded)=1,'named predecessor superseded');
SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000044',jsonb_build_object('cover_image_id','00000000-0000-4000-8000-000000000030'),'Use this photo');
SET ROLE authenticated;
SELECT fixture_assert((SELECT count(*) FROM get_my_garage_owner_corrections())=2,'speaker reads active relationship and cover');
SELECT fixture_assert((SELECT cover_image_url FROM get_my_garage_owner_corrections() WHERE correction ? 'cover_image_id')='fixture-photo','chosen cover resolves by indexed image key');
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000002',false);
SELECT fixture_assert((SELECT count(*) FROM vehicle_observations)=0,'other account cannot read private corrections');
SELECT fixture_assert((SELECT count(*) FROM get_my_garage_owner_corrections('00000000-0000-4000-8000-000000000001'))=0,'cannot request another account projection');
RESET ROLE;
SELECT set_config('fixture.user_id','',false);
SELECT set_config('fixture.role','service_role',false);
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000045',fixture_claim('business_handling'),'Business handling')$q$,'42501');
SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000045',fixture_claim('business_handling'),'Business handling','fixture-explicit-owner-approval');
SELECT fixture_assert((SELECT structured_data->>'intake_actor' FROM vehicle_observations
 WHERE submitted_by_user_id='00000000-0000-4000-8000-000000000002')='authorized_agent','service intake attributed rather than forged user auth');
SELECT 'PASS: admission, replay, supersession, account isolation, privacy, cover and explicit service authorization';
