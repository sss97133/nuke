-- Synthetic, disposable PostgreSQL contract only; never production.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('fixture.role',true) $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY, year int, make text, model text, trim text, user_id uuid,
 primary_image_url text, purchase_price numeric, image_count bigint, merged_into_vehicle_id uuid, deleted_at timestamptz, is_public boolean);
CREATE TABLE ownership_verifications(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, status text,
 title_document_url text, verification_category text, expires_at timestamp, human_reviewer_id uuid);
CREATE TABLE vehicle_user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,user_id uuid,role text,
 revoked_at timestamptz,is_active boolean,context text,granted_by uuid,granted_at timestamptz,created_at timestamptz);
CREATE UNIQUE INDEX permission_role ON vehicle_user_permissions(vehicle_id,user_id,role) WHERE is_active=true;
CREATE TABLE vehicle_ownerships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,owner_profile_id uuid,
 role text,verification_id uuid,is_current boolean,start_date date,end_date date);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,user_id uuid,documented_by_user_id uuid,
 image_url text,created_at timestamptz,is_superseded boolean);
CREATE TABLE discovered_vehicles(vehicle_id uuid,user_id uuid,is_active boolean,relationship_type text);
CREATE TABLE work_sessions(vehicle_id uuid,user_id uuid,session_date date);
CREATE TABLE vehicle_contributors(vehicle_id uuid,user_id uuid);
CREATE TABLE nuke_estimates(vehicle_id uuid,estimated_value numeric,comp_method text,calculated_at timestamptz);
CREATE TABLE vehicle_activity(vehicle_id uuid,last_activity_at timestamptz);
CREATE FUNCTION vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
\ir fixtures/garage_ownership_before.sql
CREATE TRIGGER admission BEFORE INSERT OR UPDATE ON vehicle_user_permissions FOR EACH ROW EXECUTE FUNCTION enforce_user_vehicle_evidence();
CREATE FUNCTION assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION refuses(statement text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN raise_exception THEN RETURN; END;
  RAISE EXCEPTION 'FAIL: unexpectedly admitted %',statement;
 END $$;
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','authenticated',false);
INSERT INTO vehicles(id,year,make,model,is_public) SELECT
 ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1970,'Fixture','Car',true FROM generate_series(1,9) n;
-- 1 photo-only co_owner; 2 current title; 3 expired title; 4 custody approval;
-- 5 ended ownership with still-approved title; 6 malformed document;
-- 7 profile-only; 8 unknown-role period; 9 title proof with future period.
INSERT INTO vehicle_images(vehicle_id,user_id,created_at,image_url)
 SELECT id,auth.uid(),now(),'fixture-image' FROM vehicles WHERE right(id::text,1)='1';
INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active,context) VALUES
 ('20000000-0000-4000-8000-000000000001',auth.uid(),'co_owner',true,'Photo evidence only');
INSERT INTO vehicle_user_permissions(id,vehicle_id,user_id,role,is_active,context) VALUES
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',auth.uid(),'co_owner',null,'Legacy NULL-active photo claim');
SELECT assert((SELECT relationship='owner' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000001'), 'reproduce old photo -> owner bug');
INSERT INTO ownership_verifications(id,vehicle_id,user_id,status,title_document_url,verification_category,expires_at) SELECT
 ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,auth.uid(),'approved',
 CASE WHEN n=6 THEN 'iphoto://local' ELSE 'https://example.test/title' END,
 CASE WHEN n=4 THEN 'custody_evidence' ELSE 'title_document' END,
 CASE WHEN n=3 THEN now()-interval '1 day' ELSE now()+interval '1 day' END
 FROM generate_series(2,9) n WHERE n NOT IN (7,8);
INSERT INTO vehicle_ownerships(vehicle_id,owner_profile_id,role,verification_id,is_current,start_date,end_date) VALUES
 ('20000000-0000-4000-8000-000000000005',auth.uid(),'owner','30000000-0000-4000-8000-000000000005',false,current_date-100,current_date-10),
 ('20000000-0000-4000-8000-000000000008',auth.uid(),'photographer',null,true,null,null),
 ('20000000-0000-4000-8000-000000000009',auth.uid(),'owner','30000000-0000-4000-8000-000000000009',true,current_date+10,null);
UPDATE vehicles SET user_id=auth.uid() WHERE id='20000000-0000-4000-8000-000000000007';
CREATE TEMP TABLE original_permissions AS SELECT row_to_json(p)::text value FROM vehicle_user_permissions p;
CREATE TEMP TABLE original_verifications AS SELECT row_to_json(p)::text value FROM ownership_verifications p;
\ir ../migrations/20261109055301_garage_ownership_requires_evidence.sql
SELECT assert(NOT EXISTS (SELECT value FROM original_permissions EXCEPT SELECT row_to_json(p)::text FROM vehicle_user_permissions p),'permission testimony unchanged');
SELECT assert(NOT EXISTS (SELECT value FROM original_verifications EXCEPT SELECT row_to_json(p)::text FROM ownership_verifications p),'verification testimony unchanged');
SELECT assert((SELECT relationship='documenting' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000001'),'photo membership retained as documenting');
SELECT assert((SELECT relationship='owner' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000002'),'current title remains owner');
SELECT assert((SELECT count(*)=5 FROM get_user_garage(auth.uid()) WHERE relationship='relationship_review'),'expired/custody/malformed/unknown/future remain review');
SELECT assert((SELECT relationship='previously_owned' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000005'),'approval does not override disposal');
SELECT assert((SELECT relationship='profile_record' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000007'),'creator is not owner');
SELECT refuses($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active) VALUES ('20000000-0000-4000-8000-000000000001',auth.uid(),'co_owner',true)$q$);
SELECT refuses($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active) VALUES ('20000000-0000-4000-8000-000000000001',auth.uid(),'owner',true)$q$);
SELECT refuses($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active) VALUES ('20000000-0000-4000-8000-000000000003',auth.uid(),'co_owner',true)$q$);
SELECT refuses($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active) VALUES ('20000000-0000-4000-8000-000000000004',auth.uid(),'owner',true)$q$);
INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active) VALUES
 ('20000000-0000-4000-8000-000000000002',auth.uid(),'co_owner',true),
 ('20000000-0000-4000-8000-000000000001',auth.uid(),'contributor',true);
SELECT refuses($q$UPDATE vehicle_user_permissions SET is_active=false,vehicle_id='20000000-0000-4000-8000-000000000003' WHERE role='co_owner' AND vehicle_id='20000000-0000-4000-8000-000000000001'$q$);
SELECT refuses($q$UPDATE vehicle_user_permissions SET is_active=null WHERE role='co_owner' AND is_active IS TRUE AND vehicle_id='20000000-0000-4000-8000-000000000001'$q$);
UPDATE vehicle_user_permissions SET is_active=false WHERE role='co_owner' AND vehicle_id='20000000-0000-4000-8000-000000000001';
SELECT assert((SELECT is_active IS FALSE FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000001'),'NULL-active unsupported permission can be retracted');
SELECT refuses($q$UPDATE vehicle_user_permissions SET is_active=true WHERE role='co_owner' AND vehicle_id='20000000-0000-4000-8000-000000000001'$q$);
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000002',false);
SELECT assert((SELECT count(*)=1 FROM get_user_garage('10000000-0000-4000-8000-000000000001')),'stranger sees only qualified public owner');
UPDATE vehicles SET is_public=false WHERE id='20000000-0000-4000-8000-000000000002';
SELECT assert((SELECT count(*)=0 FROM get_user_garage('10000000-0000-4000-8000-000000000001')),'private vehicle remains private');
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000001',false);
SELECT assert((SELECT count(*)=9 FROM get_user_garage(auth.uid())),'all own records retained after rule repair');
-- Approval -> auto-grant -> admission: custody stays approved without gaining title permissions.
CREATE TRIGGER approval AFTER INSERT OR UPDATE OF status ON ownership_verifications
 FOR EACH ROW EXECUTE FUNCTION auto_grant_owner_on_verification();
UPDATE ownership_verifications SET status='pending' WHERE vehicle_id IN (
 '20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004');
UPDATE ownership_verifications SET status='approved',human_reviewer_id='10000000-0000-4000-8000-000000000002';
SELECT assert((SELECT count(*)=1 FROM vehicle_user_permissions WHERE role='owner'),'only current title approval grants owner');
SELECT assert((SELECT status='approved' FROM ownership_verifications WHERE vehicle_id='20000000-0000-4000-8000-000000000004'),'custody approval succeeds without ownership grant');
-- An activity row cannot withdraw independently approved title evidence.
INSERT INTO ownership_verifications(id,vehicle_id,user_id,status,title_document_url,verification_category,expires_at,human_reviewer_id) VALUES
 ('30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000008',auth.uid(),'approved',
 'https://example.test/title','title_document',now()+interval '1 day','10000000-0000-4000-8000-000000000002');
SELECT assert((SELECT relationship='owner' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000008'),'photographer row cannot cancel current title');
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000002',false);
SELECT assert((SELECT relationship='owner' FROM get_user_garage('10000000-0000-4000-8000-000000000001') WHERE vehicle_id='20000000-0000-4000-8000-000000000008'),'qualified public title survives activity row');
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000001',false);
UPDATE vehicle_user_permissions SET is_active=false WHERE vehicle_id='20000000-0000-4000-8000-000000000008';
UPDATE vehicle_ownerships SET is_current=false,end_date=current_date-5 WHERE vehicle_id='20000000-0000-4000-8000-000000000008';
SELECT assert(NOT EXISTS (SELECT 1 FROM vehicle_user_permissions WHERE vehicle_id='20000000-0000-4000-8000-000000000008' AND coalesce(is_active,true)),'title case has no active permission to mask reader classification');
SELECT assert((SELECT relationship='owner' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000008'),'ended photography is not disposal without a permission');
INSERT INTO vehicle_ownerships(vehicle_id,owner_profile_id,role,is_current,start_date,end_date) VALUES
 ('20000000-0000-4000-8000-000000000005',auth.uid(),'photographer',true,current_date-1,null),
 ('20000000-0000-4000-8000-000000000009',auth.uid(),'photographer',false,current_date-10,current_date-5);
SELECT assert((SELECT relationship='previously_owned' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000005'),'current photography cannot mask real disposal');
SELECT assert((SELECT relationship='relationship_review' FROM get_user_garage(auth.uid()) WHERE vehicle_id='20000000-0000-4000-8000-000000000009'),'ended photography cannot invent prior ownership before a future period');
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000002',false);
SELECT assert((SELECT relationship='owner' FROM get_user_garage('10000000-0000-4000-8000-000000000001') WHERE vehicle_id='20000000-0000-4000-8000-000000000008'),'public title survives ended photography without a permission');
\echo 'garage ownership admission -> reader contract PASS'
