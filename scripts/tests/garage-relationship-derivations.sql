-- Synthetic, isolated PostgreSQL fixture only. Never run against Nuke production.
-- Run: psql -v ON_ERROR_STOP=1 -f scripts/tests/garage-relationship-derivations.sql  (from repo root; needs sed)
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('fixture.role',true) $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, merged_into_vehicle_id uuid, year integer, make text, model text,
 trim text, primary_image_url text, purchase_price numeric, image_count integer, is_public boolean, deleted_at timestamptz);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid,
 image_url text, created_at timestamptz DEFAULT now());
CREATE TABLE public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
 status text, title_document_url text, revoked_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_user_permissions(vehicle_id uuid, user_id uuid, role text, is_active boolean DEFAULT true,
 revoked_at timestamptz, granted_by uuid);
CREATE TABLE public.vehicle_ownerships(vehicle_id uuid, owner_profile_id uuid, is_current boolean);
CREATE TABLE public.discovered_vehicles(vehicle_id uuid, user_id uuid, is_active boolean, relationship_type text);
CREATE TABLE public.vehicle_contributors(vehicle_id uuid, user_id uuid);
CREATE TABLE public.nuke_estimates(vehicle_id uuid, estimated_value numeric, comp_method text, calculated_at timestamptz);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, submitted_by_user_id uuid,
 content_text text, structured_data jsonb, is_superseded boolean DEFAULT false, observed_at timestamptz DEFAULT now(),
 ingested_at timestamptz DEFAULT now());
CREATE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
-- Stand-in for the reviewed live reader (the migration's hash guard is stripped below).
CREATE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric,
  purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql STABLE AS $$ SELECT NULL::uuid,NULL::int,NULL::text,NULL::text,NULL::text,NULL::text,NULL::numeric,NULL::numeric,NULL::bigint,NULL::text WHERE false $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
\! sed '/DO \$guard\$/,/END \$guard\$;/d' supabase/migrations/20261111170000_vehicle_relationship_derivations.sql > /tmp/vrd_fixture_migration.sql
\i /tmp/vrd_fixture_migration.sql
CREATE TRIGGER fixture_evidence BEFORE INSERT OR UPDATE ON vehicle_user_permissions
 FOR EACH ROW EXECUTE FUNCTION enforce_user_vehicle_evidence();

CREATE FUNCTION fixture_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION fixture_fails(statement text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN RETURN; END;
  RAISE EXCEPTION 'expected failure did not occur: %',statement; END $$;
CREATE FUNCTION fixture_role(v int) RETURNS text LANGUAGE sql AS $$
 SELECT derived_role FROM derive_vehicle_relationships('00000000-0000-4000-8000-000000000001',
  ('00000000-0000-4000-8000-0000000001'||lpad(v::text,2,'0'))::uuid) $$;
CREATE FUNCTION fixture_obs(v int, claim jsonb, excerpt text, extra jsonb DEFAULT '{}') RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicle_observations(vehicle_id,submitted_by_user_id,content_text,structured_data)
 VALUES (('00000000-0000-4000-8000-0000000001'||lpad(v::text,2,'0'))::uuid,'00000000-0000-4000-8000-000000000001',excerpt,
  jsonb_build_object('claim_contract','garage_owner_correction_v1','correction',jsonb_build_object('relationship',claim)||extra)) $$;
CREATE FUNCTION fixture_claim(roles text[], denied boolean DEFAULT false, disputed boolean DEFAULT false, start_date text DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('roles',to_jsonb(roles),'ownership_denied',denied,'title_status','unknown',
  'disputed',disputed,'start_date',start_date,'end_date',null) $$;

INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO vehicles(id,is_public) SELECT ('00000000-0000-4000-8000-0000000001'||lpad(g::text,2,'0'))::uuid, true FROM generate_series(1,12) g;
SELECT set_config('fixture.role','service_role',false);
\set u '00000000-0000-4000-8000-000000000001'

-- 1 verified title -> owner_verified; 2 revoked verification -> not owner; 3 self-granted co_owner -> not ownership
INSERT INTO ownership_verifications(vehicle_id,user_id,status,title_document_url) VALUES ('00000000-0000-4000-8000-000000000101',:'u','approved','https://example.test/t.pdf');
INSERT INTO ownership_verifications(vehicle_id,user_id,status,title_document_url,revoked_at) VALUES ('00000000-0000-4000-8000-000000000102',:'u','approved','https://example.test/t.pdf',now());
INSERT INTO vehicle_images(vehicle_id,user_id,image_url) VALUES ('00000000-0000-4000-8000-000000000103',:'u','p');
INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,granted_by) VALUES ('00000000-0000-4000-8000-000000000103',:'u','co_owner',:'u') ;
SELECT fixture_assert(fixture_role(1)='owner_verified','approved https title, not revoked => owner_verified');
SELECT fixture_assert(fixture_role(2)='profile_record','revoked verification is not title');
SELECT fixture_assert(fixture_role(3)='documenting','self-granted co_owner is not ownership');

-- 4 owner statement => owner_reported (never owner_verified); 5 long tenure + photos => owner_reported 0.85
SELECT fixture_obs(4, fixture_claim('{owner_current}'), 'I own it');
SELECT fixture_assert(fixture_role(4)='owner_reported','owner statement without title => owner_reported');
SELECT fixture_obs(5, fixture_claim('{owner_current}',false,false,'2010-01-01'), 'owned since 2010');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url) VALUES ('00000000-0000-4000-8000-000000000105',:'u','p');
SELECT fixture_assert((SELECT confidence FROM derive_vehicle_relationships(:'u','00000000-0000-4000-8000-000000000105'))=0.85,'long tenure + photos');
SELECT fixture_assert(fixture_role(5)='owner_reported','long tenure never claimed_interest');

-- 6 uncited disputed (no excerpt, no evidence ids) is ignored; 7 cited dispute downgrades
SELECT fixture_obs(6, fixture_claim('{owner_current}',false,true), NULL);
SELECT fixture_assert(fixture_role(6)='owner_reported','uncited downgrade ignored');
SELECT fixture_assert((SELECT reason FROM derive_vehicle_relationships(:'u','00000000-0000-4000-8000-000000000106')) LIKE '%uncited downgrade ignored%','uncited downgrade reported');
SELECT fixture_obs(7, fixture_claim('{owner_current}',false,true), 'seller disputes my title');
SELECT fixture_assert(fixture_role(7)='claimed_interest','cited dispute caps below owner');
-- 8 verified title + cited denial is capped
INSERT INTO ownership_verifications(vehicle_id,user_id,status,title_document_url) VALUES ('00000000-0000-4000-8000-000000000108',:'u','approved','https://example.test/t.pdf');
SELECT fixture_obs(8, fixture_claim('{}',true), 'I sold it');
SELECT fixture_assert(fixture_role(8)='claimed_interest','cited denial caps verified title');
-- 9 business, 10 photos only
SELECT fixture_obs(9, fixture_claim('{business_handling}'), 'shop handling');
SELECT fixture_assert(fixture_role(9)='business_handling','business context');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url) VALUES ('00000000-0000-4000-8000-000000000110',:'u','p');
SELECT fixture_assert(fixture_role(10)='documenting','photos only never owner');

-- dry run writes nothing; apply supersedes
SELECT fixture_assert((SELECT count(*) FROM vehicle_relationship_derivations)=0,'dry run writes nothing');
CREATE TEMP TABLE run1 AS SELECT gen_random_uuid() id;
SELECT count(*) FROM derive_vehicle_relationships(:'u',NULL,(SELECT id FROM run1),false);
SELECT fixture_assert((SELECT count(*) FROM vehicle_relationship_derivations WHERE superseded_at IS NULL)=10,'one active row per vehicle');
SELECT fixture_fails($q$INSERT INTO vehicle_relationship_derivations(vehicle_id,user_id,derived_role,confidence,run_id)
 VALUES ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','owner_verified',0.9,gen_random_uuid())$q$);
SELECT fixture_fails($q$INSERT INTO vehicle_relationship_derivations(vehicle_id,user_id,derived_role,confidence,run_id)
 VALUES ('00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000001','claimed_interest',0.9,gen_random_uuid())$q$);
-- demotion path: the title is revoked, rerun supersedes the old row
UPDATE ownership_verifications SET revoked_at=now() WHERE vehicle_id='00000000-0000-4000-8000-000000000101';
SELECT count(*) FROM derive_vehicle_relationships(:'u','00000000-0000-4000-8000-000000000101',gen_random_uuid(),false);
SELECT fixture_assert((SELECT derived_role FROM vehicle_relationship_derivations WHERE vehicle_id='00000000-0000-4000-8000-000000000101' AND superseded_at IS NULL)='profile_record','demoted');
SELECT fixture_assert((SELECT count(*) FROM vehicle_relationship_derivations WHERE vehicle_id='00000000-0000-4000-8000-000000000101')=2,'prior row kept, superseded');
SELECT fixture_assert((SELECT superseded_by IS NOT NULL AND superseded_reason IS NOT NULL FROM vehicle_relationship_derivations WHERE vehicle_id='00000000-0000-4000-8000-000000000101' AND superseded_at IS NOT NULL),'supersession recorded');

-- evidence gate trigger
SELECT fixture_fails($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,granted_by) VALUES ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000002','co_owner','00000000-0000-4000-8000-000000000001')$q$);
INSERT INTO ownership_verifications(vehicle_id,user_id,status,title_document_url) VALUES ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000002','approved','https://example.test/t.pdf');
SELECT fixture_fails($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,granted_by) VALUES ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000002','owner','00000000-0000-4000-8000-000000000002')$q$);
INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,granted_by) VALUES ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000002','co_owner','00000000-0000-4000-8000-000000000001');

-- RLS: user reads own rows only; no writes
SET ROLE authenticated;
SELECT set_config('fixture.role','authenticated',false);
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000002',false);
SELECT fixture_assert((SELECT count(*) FROM vehicle_relationship_derivations)=0,'other account reads none');
SELECT fixture_fails($q$INSERT INTO vehicle_relationship_derivations(vehicle_id,user_id,derived_role,confidence,run_id) VALUES ('00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000002','documenting',0.4,gen_random_uuid())$q$);
SELECT fixture_fails($q$SELECT * FROM derive_vehicle_relationships('00000000-0000-4000-8000-000000000002',NULL,gen_random_uuid(),false)$q$);
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000001',false);
SELECT fixture_assert((SELECT count(*) FROM vehicle_relationship_derivations)>0,'owner reads own rows');
RESET ROLE;
SELECT 'PASS: derivation rules, cited downgrades, supersession, evidence gate, RLS';
