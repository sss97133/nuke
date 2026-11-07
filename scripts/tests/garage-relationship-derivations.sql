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
 trim text, primary_image_url text, purchase_price numeric, image_count integer, is_public boolean, deleted_at timestamptz,
 vin text, bat_seller text, origin_metadata jsonb, bat_auction_url text, listing_url text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid,
 image_url text, created_at timestamptz DEFAULT now(), taken_at timestamptz, latitude numeric, longitude numeric,
 device_fingerprint text, source text, storage_path text, automation_script text,
 exif_data jsonb DEFAULT '{"camera_make":"Apple","camera_model":"iPhone 15 Pro","source_type":"user_library"}',
 ai_detected_vehicle jsonb, vehicle_year integer, image_vehicle_match_status text, merged_from_vehicle_id uuid);
CREATE TABLE public.platform_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE NOT NULL,
 config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text, business_name text, slug text, website text, latitude numeric, longitude numeric);
CREATE TABLE public.organization_vehicles(vehicle_id uuid, organization_id uuid);
CREATE TABLE public.organization_contributors(organization_id uuid, user_id uuid, status text DEFAULT 'active', end_date date);
CREATE TABLE public.bat_listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, organization_id uuid, seller_username text,
 seller_external_identity_id uuid, bat_listing_url text, bat_lot_number text, bat_listing_title text, raw_data jsonb, scraped_at timestamptz DEFAULT now());
CREATE TABLE public.external_listings(vehicle_id uuid, organization_id uuid, listing_url text);
CREATE TABLE public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
 status text, title_document_url text, revoked_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_user_permissions(vehicle_id uuid, user_id uuid, role text, is_active boolean DEFAULT true,
 revoked_at timestamptz, granted_by uuid);
CREATE TABLE public.vehicle_ownerships(vehicle_id uuid, owner_profile_id uuid, is_current boolean);
CREATE TABLE public.discovered_vehicles(vehicle_id uuid, user_id uuid, is_active boolean, relationship_type text);
CREATE TABLE public.vehicle_contributors(vehicle_id uuid, user_id uuid);
CREATE TABLE public.nuke_estimates(vehicle_id uuid, estimated_value numeric, comp_method text, calculated_at timestamptz);
CREATE TYPE public.observation_kind AS ENUM ('provenance','media');
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, submitted_by_user_id uuid,
 content_text text, structured_data jsonb, is_superseded boolean DEFAULT false, observed_at timestamptz DEFAULT now(),
 ingested_at timestamptz DEFAULT now(),
 subject_type text, subject_id uuid, property_id uuid, source_id uuid, source_identifier text, content_hash text, observer_raw jsonb,
 extraction_method text, kind public.observation_kind, confidence text, confidence_score numeric);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE);
INSERT INTO public.observation_sources(slug) VALUES ('owner-input');
CREATE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
-- Stand-in for the reviewed live reader (the migration's hash guard is stripped below).
CREATE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric,
  purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql STABLE AS $$ SELECT NULL::uuid,NULL::int,NULL::text,NULL::text,NULL::text,NULL::text,NULL::numeric,NULL::numeric,NULL::bigint,NULL::text WHERE false $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
GRANT INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
\! sed '/DO \$guard\$/,/END \$guard\$;/d' supabase/migrations/20261111170000_vehicle_relationship_derivations.sql > /tmp/vrd_fixture_migration.sql
\i /tmp/vrd_fixture_migration.sql
\! cp supabase/migrations/20261111180000_garage_evidence_chain.sql /tmp/vrd_fixture_chain.sql
\i /tmp/vrd_fixture_chain.sql
\i supabase/migrations/20261111190000_vehicle_duplicate_gates.sql
\! sed '/DO \$guard\$/,/END \$guard\$;/d' supabase/migrations/20261111200000_garage_listing_org_evidence.sql > /tmp/vrd_fixture_listing_org.sql
\i /tmp/vrd_fixture_listing_org.sql
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

-- ===== ordered evidence chain (steps 1-5) =====
SELECT set_config('fixture.role','service_role',false);
\set viva c433d27e-2159-4f8c-b4ae-32a5e44a77cf
\set ernies e796ca48-0000-4000-8000-000000000002
\set orgx aaaaaaaa-0000-4000-8000-000000000001
\set orgm bbbbbbbb-0000-4000-8000-000000000002
CREATE FUNCTION fx(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'))::uuid $$;
CREATE FUNCTION fx_photo(n int, taken timestamptz DEFAULT now(), lat numeric DEFAULT NULL, lon numeric DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicle_images(vehicle_id,user_id,image_url,taken_at,latitude,longitude,device_fingerprint)
 VALUES (fx(n),'00000000-0000-4000-8000-000000000001','p',taken,lat,lon,'dev-1') $$;
CREATE FUNCTION fx_obs(n int, claim jsonb, excerpt text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicle_observations(vehicle_id,submitted_by_user_id,content_text,structured_data)
 VALUES (fx(n),'00000000-0000-4000-8000-000000000001',excerpt,
  jsonb_build_object('claim_contract','garage_owner_correction_v1','correction',jsonb_build_object('relationship',claim))) $$;
CREATE FUNCTION fx_step(n int, step int) RETURNS jsonb LANGUAGE sql AS $$
 SELECT c FROM derive_vehicle_relationships('00000000-0000-4000-8000-000000000001', fx(n)) d,
   jsonb_array_elements(d.evidence->'chain') c WHERE (c->>'step')::int = step $$;
CREATE FUNCTION fx_role(n int) RETURNS text LANGUAGE sql AS $$
 SELECT derived_role FROM derive_vehicle_relationships('00000000-0000-4000-8000-000000000001', fx(n)) $$;
INSERT INTO vehicles(id,is_public,year,make,model) SELECT fx(g), true, 1984, 'Fixturemake'||g, 'Suburban' FROM generate_series(1,12) g;  -- distinct makes: fixtures are not duplicates of each other

-- step 2: a matched listing whose seller is an organization makes the vehicle that organization's inventory
SELECT fx_photo(1); SELECT fx_obs(1, fixture_claim('{owner_current}',false,false,'2010-01-01'), 'owned since 2010');
INSERT INTO bat_listings(vehicle_id,organization_id,seller_username,bat_listing_url) VALUES (fx(1),:'orgx','someone','https://bringatrailer.com/listing/x/');
SELECT fixture_assert(fx_role(1)='contributor','org-listed vehicle: statement + photos is contributor, never owner');
SELECT fixture_assert((SELECT confidence FROM derive_vehicle_relationships(:'u',fx(1)))=0.45,'contributor confidence');
SELECT fixture_assert(fx_step(1,2)->'eliminated' ? 'owner_reported','step 2 eliminated owner_reported');
SELECT fixture_assert(fx_step(1,2)->'evidence'->>'organization_id'=:'orgx' AND (fx_step(1,2)->>'confidence')::numeric=0.9,'step 2 cites org and confidence');
SELECT fixture_assert((SELECT reason FROM derive_vehicle_relationships(:'u',fx(1))) LIKE '%owner statement set aside%','set aside is stated');
-- seller handle via alias (platform 'bat', case and padding ignored)
SELECT fx_photo(2);
INSERT INTO bat_listings(vehicle_id,organization_id,seller_username) VALUES (fx(2),NULL,' VivaLasVegasAutos ');
SELECT fixture_assert(fx_role(2)='contributor' AND (SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(2)))=:'viva','alias resolves seller to Viva');
SELECT fixture_assert((fx_step(2,2)->>'confidence')::numeric=0.8,'alias confidence 0.80');
-- vehicles.bat_seller and origin_metadata snapshot
SELECT fx_photo(3); UPDATE vehicles SET bat_seller='vivalasvegasautos' WHERE id=fx(3);
SELECT fixture_assert((SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(3)))=:'viva' AND (fx_step(3,2)->>'confidence')::numeric=0.7,'vehicles.bat_seller resolves via alias');
SELECT fx_photo(4); UPDATE vehicles SET origin_metadata='{"bat_snapshot_parsed":{"seller_username":"VivaLasVegasAutos"}}' WHERE id=fx(4);
SELECT fixture_assert((SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(4)))=:'viva','origin_metadata seller resolves via alias');
-- member of the listing organization => business_handling
SELECT fx_photo(5); INSERT INTO bat_listings(vehicle_id,organization_id) VALUES (fx(5),:'orgm');
INSERT INTO organization_contributors(organization_id,user_id) VALUES (:'orgm',:'u');
SELECT fixture_assert(fx_role(5)='business_handling','org member is business_handling');
-- title + org listing => owner_verified but the conflict is flagged and confidence lowered
INSERT INTO ownership_verifications(vehicle_id,user_id,status,title_document_url) VALUES (fx(6),:'u','approved','https://example.test/t.pdf');
INSERT INTO bat_listings(vehicle_id,organization_id) VALUES (fx(6),:'orgx');
SELECT fixture_assert(fx_role(6)='owner_verified' AND (SELECT confidence FROM derive_vehicle_relationships(:'u',fx(6)))=0.7,'title wins over listing at lower confidence');
SELECT fixture_assert((SELECT reason FROM derive_vehicle_relationships(:'u',fx(6))) LIKE '%CONFLICT%' AND (fx_step(6,4)->'evidence'->>'conflict_with_organization_listing')::boolean,'title/listing conflict flagged');
-- external_listings
SELECT fx_photo(7); INSERT INTO external_listings(vehicle_id,organization_id,listing_url) VALUES (fx(7),:'orgx','https://example.test/l');
SELECT fixture_assert(fx_role(7)='contributor' AND fx_step(7,2)->'evidence'->'sources'->0->>'source'='external_listings.organization_id','external_listings step 2');

-- step 3: GPS at an organization alone never makes inventory; a shoot-shaped pattern does. Viva and Ernies are ~24 m apart.
CREATE FUNCTION fx_burst(n int, k int, start_ts timestamptz, lat numeric, lon numeric, gap interval DEFAULT interval '1 minute') RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicle_images(vehicle_id,user_id,image_url,taken_at,latitude,longitude,device_fingerprint)
 SELECT fx(n),'00000000-0000-4000-8000-000000000001','p',start_ts + g*gap,lat,lon,'dev-1' FROM generate_series(1,k) g $$;
INSERT INTO organization_vehicles VALUES (fx(8),:'viva'),(fx(9),:'viva');
-- 8: one dense burst at Viva, vehicle linked to Viva, no listing -> contributor at the organization, not ambiguous
SELECT fx_burst(8, 6, now() - interval '5 months', 36.17010, -115.14000);
SELECT fixture_assert(fx_step(8,3)->'evidence'->>'organization_id'=:'viva' AND fx_step(8,3)->'evidence'->>'pattern'='shop_shoot','shoot burst names the linked organization');
SELECT fixture_assert((fx_step(8,3)->'evidence'->>'organizations_in_range')::int=2 AND NOT (fx_step(8,3)->'evidence'->>'ambiguous')::boolean,'two orgs in range; the linked one wins');
SELECT fixture_assert((fx_step(8,3)->'evidence'->>'decides')::boolean AND (fx_step(8,3)->>'confidence')::numeric=0.5,'shoot decides at 0.5 without a listing');
SELECT fixture_assert(fx_role(8)='contributor','shoot without a listing: contributor at the organization');
SELECT fixture_assert((SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(8))) IS NULL,'GPS alone never makes org inventory');
-- 11: same burst, vehicle not linked to either organization -> ambiguous, confidence halved
SELECT fx_burst(11, 6, now() - interval '7 months', 36.17010, -115.14000);  -- own time window: no other vehicle shot nearby
SELECT fixture_assert((fx_step(11,3)->'evidence'->>'ambiguous')::boolean AND (fx_step(11,3)->>'confidence')::numeric=0.25,'unlinked vehicle between two orgs is ambiguous, halved');
SELECT fixture_assert(fx_role(11)='contributor' AND (SELECT confidence FROM derive_vehicle_relationships(:'u',fx(11)))<=0.2
  AND (SELECT evidence->'flags' FROM derive_vehicle_relationships(:'u',fx(11))) ? 'org_ambiguous'
  AND jsonb_array_length(fx_step(11,3)->'evidence'->'organizations')=2,'two organizations nothing separates: contributor <= 0.2, org_ambiguous flag, both organizations cited');
SELECT fixture_assert(fx_role(11)='contributor' AND jsonb_array_length(fx_step(11,3)->'evidence'->'organizations')=2 AND NOT (fx_step(11,3)->'evidence'->>'tie_break_decided')::boolean,'ambiguous shoot: contributor, both organizations cited');
-- 12: same burst and Viva lists the vehicle -> business_handling
INSERT INTO bat_listings(vehicle_id,organization_id,bat_listing_url) VALUES (fx(12),:'viva','https://bringatrailer.com/listing/y/');
SELECT fx_burst(12, 6, now() - interval '5 months', 36.17010, -115.14000);
SELECT fixture_assert(fx_role(12)='business_handling' AND (fx_step(12,3)->>'confidence')::numeric=0.7,'shoot at the listing organization: business_handling');
-- 9: long span, photos at Viva and far away -> long-term personal, no inventory, still documenting
SELECT fx_burst(9, 3, now() - interval '3 years', 36.17010, -115.14000);
SELECT fx_burst(9, 3, now() - interval '2 days', 36.50000, -115.50000);
SELECT fixture_assert(fx_step(9,3)->'evidence'->>'pattern'='long_term_personal' AND NOT (fx_step(9,3)->'evidence'->>'decides')::boolean,'multi-year span away from the org is personal');
SELECT fixture_assert(fx_role(9)='documenting','long-term personal pattern stays documenting');
-- too few photos, or more than two sessions, are not a shoot
CREATE FUNCTION fx_vehicles(a int, b int) RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicles(id,is_public,year,make,model) SELECT fx(g), true, 2001, 'Fixturemake'||g, 'Fixture' FROM generate_series(a,b) g $$;
SELECT fx_vehicles(13,60);
SELECT fx_burst(13, 3, now() - interval '5 months', 36.17010, -115.14000);
SELECT fixture_assert(fx_role(13)='documenting' AND fx_step(13,3)->'evidence'->>'pattern'='at_organization','three photos at an org is not a shoot');
SELECT fx_burst(14, 3, now() - interval '5 months', 36.17010, -115.14000);
SELECT fx_burst(14, 3, now() - interval '5 months' + interval '3 days', 36.17010, -115.14000);
SELECT fx_burst(14, 3, now() - interval '5 months' + interval '6 days', 36.17010, -115.14000);
SELECT fixture_assert(fx_role(14)='documenting' AND (fx_step(14,3)->'evidence'->>'sessions')::int=3,'three sessions is not a shoot');
-- rules come from platform_config
UPDATE platform_config SET config_value=config_value || '{"min_photos": 3, "max_sessions": 3}' WHERE config_key='garage_shop_shoot_rules';
SELECT fixture_assert(fx_role(13)='contributor' AND fx_role(14)='contributor','shoot thresholds come from platform_config');
UPDATE platform_config SET config_value=config_value || '{"min_photos": 5, "max_sessions": 2}' WHERE config_key='garage_shop_shoot_rules';

-- time decay: 18 months by default, from platform_config
SELECT fx_photo(10, now() - interval '30 months'); SELECT fx_photo(10, now() - interval '28 months');
SELECT fixture_assert(fx_role(10)='previously_documented','no photo for 18 months => previously_documented');
SELECT fixture_assert((SELECT (evidence->>'documented_from')::timestamptz < (evidence->>'documented_to')::timestamptz FROM derive_vehicle_relationships(:'u',fx(10))),'documented_from < documented_to');
SELECT fixture_assert((SELECT date_trunc('day',(evidence->>'documented_from')::timestamptz)=date_trunc('day',now()-interval '30 months') FROM derive_vehicle_relationships(:'u',fx(10))),'documented_from is min capture time');
UPDATE platform_config SET config_value='{"months": 36}' WHERE config_key='garage_documenting_decay_months';
SELECT fixture_assert(fx_role(10)='documenting','decay window comes from platform_config');
UPDATE platform_config SET config_value='{"months": 18}' WHERE config_key='garage_documenting_decay_months';
SELECT count(*) FROM derive_vehicle_relationships(:'u',fx(10),gen_random_uuid(),false);
SELECT fixture_assert((SELECT derived_role='previously_documented' AND documented_from IS NOT NULL AND documented_to > documented_from
  FROM vehicle_relationship_derivations WHERE vehicle_id=fx(10) AND superseded_at IS NULL),'previously_documented row persists with documented_from/to');
-- (fixture hygiene: fx(10) now carries a derivation for the account; keep it out of the duplicate-candidate fixtures below)
UPDATE vehicles SET make='Fixturemake' WHERE id=fx(10);

-- ===== duplicate organizations are one organization =====
\set ernies2 40deadd4-0000-4000-8000-000000000003
\set ernies3 a37266f3-0000-4000-8000-000000000004
INSERT INTO organizations(id,name) VALUES (:'ernies2','Ernie''s Upholstery'),(:'ernies3','Ernie''s Custom Upholstery, LLC');
INSERT INTO bat_listings(vehicle_id,organization_id,bat_listing_url) VALUES (fx(41),:'ernies3','https://bringatrailer.com/listing/z/');
SELECT fx_photo(41);
SELECT fixture_assert((SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(41)))=:'ernies','listing org collapses to the duplicate with GPS');
SELECT fixture_assert((SELECT count(*) FROM organizations)=4 AND (SELECT name FROM organizations WHERE id=:'ernies3')='Ernie''s Custom Upholstery, LLC','organization rows are not edited');
-- neighbouring but different businesses (24 m apart) are not collapsed
SELECT fixture_assert((SELECT count(*) FROM propose_organization_aliases(100,gen_random_uuid(),true) WHERE (alias_org_id=:'viva' OR canonical_org_id=:'viva') AND score>=0.6)=0,'GPS neighbours are not aliases');
SELECT fixture_assert((SELECT count(*) FROM propose_organization_aliases(100,gen_random_uuid(),true)
  WHERE score>=0.6 AND canonical_org_id=:'ernies' AND alias_org_id IN (:'ernies2'::uuid,:'ernies3'::uuid))=2,'name variants are proposed as aliases of the one with GPS');
SELECT fixture_assert((SELECT score FROM propose_organization_aliases(100,gen_random_uuid(),true) WHERE alias_org_id=:'viva' AND canonical_org_id=:'ernies' OR alias_org_id=:'ernies' AND canonical_org_id=:'viva')=0.3,'GPS alone is a 0.3 candidate');
SELECT fixture_assert((SELECT count(*) FROM organization_aliases)=0,'dry run writes nothing');
SELECT count(*) FROM propose_organization_aliases(100,gen_random_uuid(),false);
SELECT fixture_assert((SELECT count(*) FROM organization_aliases WHERE superseded_at IS NULL)>=3,'proposals stored');
SELECT fixture_fails($q$DELETE FROM organization_aliases$q$);
SELECT fixture_fails($q$UPDATE organization_aliases SET score=1$q$);

-- ===== seller handle with no alias row resolves to the organization that carries it =====
\set orgw cccccccc-0000-4000-8000-000000000005
INSERT INTO organizations(id,name,slug,website) VALUES (:'orgw','Dealer Xyz Motors','dealer-xyz','https://www.dealerxyz.com/inventory');
SELECT fx_photo(42); UPDATE vehicles SET bat_seller='DealerXYZ' WHERE id=fx(42);
SELECT fixture_assert((SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(42)))=:'orgw' AND (fx_step(42,2)->>'confidence')::numeric=0.55,'seller handle inferred from website host (0.70 - 0.15)');

-- ===== listing -> vehicle matching =====
UPDATE vehicles SET user_id=:'u', year=1979, make='GMC', model='K1500 Sierra Classic', bat_auction_url='https://bringatrailer.com/listing/1979-gmc-k1500-8' WHERE id=fx(43);
SELECT fx_photo(43);
INSERT INTO bat_listings(vehicle_id,seller_username,bat_listing_url,bat_listing_title,raw_data)
 VALUES (NULL,NULL,'HTTPS://bringatrailer.com/listing/1979-gmc-k1500-8/?utm=x','1979 GMC K1500 Sierra Classic 4×4','{"seller_username":"DealerXYZ"}');
SELECT fixture_assert((fx_step(43,2)->'evidence'->'inline_matches'->0->>'score')::numeric=0.95 AND fx_step(43,2)->'evidence'->'inline_matches'->0->'signals' ? 'url','URL equality matches an unlinked listing (0.95)');
SELECT fixture_assert((SELECT evidence->>'organization_inventory' FROM derive_vehicle_relationships(:'u',fx(43)))=:'orgw' AND fx_role(43)='contributor','matched listing seller (raw_data) resolves to the organization');
-- VIN in raw_data
UPDATE vehicles SET vin='1GTEK14H5BJ500123' WHERE id=fx(44); SELECT fx_photo(44);
INSERT INTO bat_listings(vehicle_id,bat_listing_url,raw_data) VALUES (NULL,'https://bringatrailer.com/listing/other/','{"vin":"1gtek14h5bj500123","seller":"someone"}');
SELECT fixture_assert((fx_step(44,2)->'evidence'->'inline_matches'->0->>'score')::numeric=0.95,'VIN in raw_data matches (0.95)');
-- title alone is low and only when unique among the account's vehicles
UPDATE vehicles SET user_id=:'u', year=1987, make='Toyota', model='Land Cruiser' WHERE id=fx(45); SELECT fx_photo(45);
INSERT INTO bat_listings(vehicle_id,bat_listing_url,bat_listing_title) VALUES (NULL,'https://bringatrailer.com/listing/lc/','1987 Toyota Land Cruiser FJ60');
SELECT fixture_assert(jsonb_array_length(fx_step(45,2)->'evidence'->'inline_matches')=0,'title-only match is not used by the chain');
SELECT fixture_assert((SELECT score FROM match_bat_listings_to_vehicles(100,:'u') WHERE vehicle_id=fx(45))=0.35,'title-only proposal scores 0.35');
UPDATE vehicles SET user_id=:'u', year=1987, make='Toyota', model='Land Cruiser' WHERE id=fx(46);
SELECT fixture_assert((SELECT count(*) FROM match_bat_listings_to_vehicles(100,:'u') WHERE vehicle_id IN (fx(45),fx(46)))=0,'title match proposes nothing when two of the account''s vehicles fit');
UPDATE vehicles SET user_id=NULL WHERE id=fx(46);
SELECT fixture_assert((SELECT count(*) FROM listing_vehicle_matches)=0 AND (SELECT count(*) FROM bat_listings WHERE vehicle_id IS NULL)=3,'proposing writes no match and links no listing');
SELECT count(*) FROM match_bat_listings_to_vehicles(100,:'u',gen_random_uuid(),false);
SELECT fixture_assert((SELECT count(*) FROM listing_vehicle_matches WHERE superseded_at IS NULL)>=3 AND (SELECT count(*) FROM bat_listings WHERE vehicle_id IS NULL)=3,'matches stored; bat_listings untouched');
SELECT fixture_fails($q$DELETE FROM listing_vehicle_matches$q$);
-- seller backfill: raw_data first, stored apart from bat_listings
SELECT fixture_assert((SELECT count(*) FROM derive_listing_sellers(100) WHERE seller_username='dealerxyz' AND source='bat_listings.raw_data')=1,'seller read from raw_data (lowercased)');
SELECT count(*) FROM derive_listing_sellers(100,gen_random_uuid(),false);
SELECT fixture_assert((SELECT count(*) FROM listing_seller_derivations WHERE superseded_at IS NULL)=2,'seller derivations stored');
SET ROLE authenticated;
SELECT fixture_fails($q$SELECT * FROM listing_vehicle_matches$q$);
SELECT fixture_fails($q$SELECT * FROM match_bat_listings_to_vehicles(10)$q$);
RESET ROLE;

-- ===== own-device test: camera EXIF plus a user_library / relay / known-fingerprint source =====
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data,device_fingerprint) VALUES
 (fx(47),:'u','p',NULL,'Apple-iPhone-Unknown-scraper'),
 (fx(48),:'u','p','{"camera_make":"Apple","camera_model":"iPhone","source_type":"scraper"}',NULL),
 (fx(49),:'u','p','{"camera_make":"Apple","camera_model":"iPhone","source_type":"x"}','relay-dev'),
 (fx(50),:'u','p','{"camera_make":"Apple","camera_model":"iPhone","synced_by":"capture-relay-ios"}',NULL),
 (fx(51),:'u','p','{"camera_make":"Apple","source_type":"user_library"}',NULL);
SELECT fixture_assert(fx_role(47)='imported_by_user' AND fx_role(48)='imported_by_user','no camera EXIF, or EXIF without an own-device source: imported_by_user');
SELECT fixture_assert(fx_role(49)='imported_by_user','fingerprint not yet seen on a relay upload: imported');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,device_fingerprint,source) VALUES (fx(52),:'u','p','relay-dev','capture_relay_ios');
SELECT fixture_assert(fx_role(49)='documenting','fingerprint seen on the account''s capture_relay_ios uploads makes it own-device');
SELECT fixture_assert(fx_role(50)='documenting','synced_by capture-relay-ios with camera EXIF is own-device');
SELECT fixture_assert(fx_role(51)='imported_by_user','camera_model missing: not own-device');
SELECT fixture_assert((fx_step(47,1)->'evidence'->>'own_device_photo_count')::int=0 AND (fx_step(47,1)->'evidence'->>'imported_photo_count')::int=1 AND (fx_step(47,1)->'eliminated') ? 'documenting','step 1 reports imports and eliminates documenting');
-- an import with a statement, a title or an organization link is not hidden
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data) VALUES (fx(53),:'u','p',NULL);
SELECT fx_obs(53, fixture_claim('{owner_current}'), 'I own it');
SELECT fixture_assert(fx_role(53)='owner_reported','import with a first-person statement keeps its role');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data) VALUES (fx(54),:'u','p',NULL);
INSERT INTO bat_listings(vehicle_id,organization_id,bat_listing_url) VALUES (fx(54),:'orgm','https://bringatrailer.com/listing/q/');
SELECT fixture_assert(fx_role(54)='contributor','import with an organization link is not imported_by_user');
-- the garage hides imported_by_user
SELECT count(*) FROM derive_vehicle_relationships(:'u',fx(47),gen_random_uuid(),false);
SELECT count(*) FROM derive_vehicle_relationships(:'u',fx(50),gen_random_uuid(),false);
SELECT fixture_assert(NOT EXISTS (SELECT 1 FROM get_user_garage(:'u') WHERE vehicle_id=fx(47)) AND EXISTS (SELECT 1 FROM get_user_garage(:'u') WHERE vehicle_id=fx(50)),'garage hides imported_by_user and keeps documenting');

-- ===== statement precedence =====
CREATE FUNCTION fx_stmt(n int, roles text[], actor text, at_ts timestamptz, excerpt text, speaker uuid DEFAULT NULL, start_date text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicle_observations(vehicle_id,submitted_by_user_id,content_text,observed_at,structured_data)
 VALUES (fx(n),'00000000-0000-4000-8000-000000000001',excerpt,at_ts,
  jsonb_build_object('claim_contract','garage_owner_correction_v1','intake_actor',actor,'speaker_user_id',speaker,
   'correction',jsonb_build_object('relationship',fixture_claim(roles,false,false,start_date)))) $$;
SELECT fx_photo(55);
SELECT fx_stmt(55,'{business_handling}','authorized_agent',now()-interval '2 days','agent: he handles it for the shop');
SELECT fx_stmt(55,'{owner_current}','owner',now()-interval '1 day','I own it');
SELECT fixture_assert(fx_role(55)='owner_reported' AND (fx_step(55,5)->'evidence'->>'first_person')::boolean,'newer first-person statement supersedes an older agent paraphrase');
SELECT fx_photo(56);
SELECT fx_stmt(56,'{owner_current}','owner',now()-interval '3 days','I own it');
SELECT fx_stmt(56,'{business_handling}','authorized_agent',now()-interval '1 day','agent paraphrase');
SELECT fixture_assert(fx_role(56)='owner_reported','an agent paraphrase does not outrank the owner''s own words');
-- an agent paraphrase of a long tenure is capped; the owner''s own long-tenure words with own-device photos reach 0.85
SELECT fx_photo(57);
SELECT fx_stmt(57,'{owner_current}','authorized_agent',now(),'agent paraphrase','00000000-0000-4000-8000-000000000002','2010-01-01');
SELECT fixture_assert((SELECT confidence FROM derive_vehicle_relationships(:'u',fx(57)))=0.75,'agent paraphrase with long tenure and own photos is 0.75');
SELECT fx_photo(58);
SELECT fx_stmt(58,'{owner_current}','authorized_agent',now(),'I have owned it since 2010',:'u','2010-01-01');
SELECT fixture_assert((SELECT confidence FROM derive_vehicle_relationships(:'u',fx(58)))=0.85 AND (fx_step(58,5)->'evidence'->>'first_person')::boolean,'quoted first-person statement attributed to the account counts as first-person');

-- ===== a contributor / permission row is not evidence by itself =====
SELECT fx_vehicles(61,70);
INSERT INTO vehicle_contributors(vehicle_id,user_id) VALUES (fx(61),:'u');                                -- no photo at all
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data) VALUES (fx(62),:'u','p',NULL),(fx(63),:'u','p',NULL);
INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,granted_by) VALUES (fx(62),:'u','contributor',NULL),(fx(63),:'u','photographer',:'u');
INSERT INTO vehicle_contributors(vehicle_id,user_id) VALUES (fx(63),:'u');
SELECT fixture_assert(fx_role(61)='imported_by_user' AND fx_role(62)='imported_by_user' AND fx_role(63)='imported_by_user','contributor / permission rows (any role, self-granted or granted_by null) with no own-device photo, org link, title or statement: imported_by_user');
SELECT fx_photo(64);
INSERT INTO vehicle_contributors(vehicle_id,user_id) VALUES (fx(64),:'u');
SELECT fixture_assert(fx_role(64)='documenting','own-device photos decide; the contributor row adds nothing');

-- ===== shoot at one of two organizations: tie-breaks =====
-- 65: unlinked, shot in the same sessions as vehicles linked to Viva (8, 12) -> Viva by session co-occurrence
SELECT fx_burst(65, 6, now() - interval '5 months', 36.17010, -115.14000);
SELECT fixture_assert(fx_step(65,3)->'evidence'->>'organization_id'=:'viva' AND NOT (fx_step(65,3)->'evidence'->>'ambiguous')::boolean
  AND (fx_step(65,3)->'evidence'->>'tie_break_decided')::boolean AND (fx_step(65,3)->'evidence'->>'session_cooccurrence_links')::int>=1
  AND fx_role(65)='contributor' AND (fx_step(65,3)->>'confidence')::numeric=0.5,'co-occurrence with the other vehicles of the same sessions picks the organization');
-- 66: appears in a listing (organization unknown), no co-occurrence: dealer beats restoration_shop
ALTER TABLE organizations ADD COLUMN business_type text;
UPDATE organizations SET business_type='restoration_shop' WHERE id=:'viva';
UPDATE organizations SET business_type='dealer' WHERE id=:'ernies';
INSERT INTO bat_listings(vehicle_id,seller_username,bat_listing_url) VALUES (fx(66),'unknownseller123','https://bringatrailer.com/listing/unlinked66/');
SELECT fx_burst(66, 6, now() - interval '9 months', 36.17010, -115.14000);
SELECT fixture_assert(fx_step(66,3)->'evidence'->>'organization_id'=:'ernies' AND NOT (fx_step(66,3)->'evidence'->>'ambiguous')::boolean
  AND fx_role(66)='contributor','listed vehicle: dealer / auction outranks restoration_shop');
UPDATE organizations SET business_type=NULL WHERE id IN (:'viva',:'ernies');

-- ===== a statement on a high-score duplicate applies to the whole cluster =====
UPDATE vehicles SET year=1990, make='Dupmake', model='Dupmodel' WHERE id IN (fx(67),fx(68));
UPDATE vehicles SET year=1993, make='Dupmake', model='Dupmodel' WHERE id=fx(69);   -- year 3 off: not a candidate
SELECT fx_obs(67, fixture_claim('{owner_current}'), 'I own it');                    -- photo-less duplicate
SELECT fx_photo(68); SELECT fx_photo(69);
SELECT fixture_assert(fx_role(68)='owner_reported' AND (fx_step(68,5)->'evidence'->>'statement_vehicle_id')=fx(67)::text
  AND (fx_step(68,5)->'evidence'->>'statement_from_duplicate')::boolean,'statement on a photo-less duplicate reaches the photo-rich record');
SELECT fixture_assert(fx_role(69)='documenting','a vehicle that is not a duplicate does not inherit the statement');

-- ===== own-origin photos count as own-device without EXIF; scraped sources do not =====
SELECT fixture_assert(own_origin_source('iphoto',NULL,NULL,:'u') AND own_origin_source('iphoto_60d',NULL,NULL,:'u')
  AND own_origin_source('user_upload',NULL,NULL,:'u') AND own_origin_source('capture_relay_ios',NULL,NULL,:'u')
  AND own_origin_source('photo_auto_sync',NULL,NULL,:'u') AND own_origin_source('photo_sync',NULL,NULL,:'u')
  AND own_origin_source('drop-folder',NULL,NULL,:'u') AND own_origin_source('library_recovery',NULL,NULL,:'u')
  AND own_origin_source('hd_archive',NULL,NULL,:'u') AND own_origin_source('daily_receipt',NULL,NULL,:'u')
  AND own_origin_source('dropbox_import',NULL,NULL,:'u'),'own library / upload sources are own-origin');
SELECT fixture_assert(NOT own_origin_source('bat',NULL,NULL,:'u') AND NOT own_origin_source('mecum',NULL,NULL,:'u')
  AND NOT own_origin_source('classic-com',NULL,NULL,:'u') AND NOT own_origin_source('craigslist',NULL,NULL,:'u')
  AND NOT own_origin_source('url_scraper',NULL,NULL,:'u') AND NOT own_origin_source('ssd_blast',NULL,NULL,:'u')
  AND NOT own_origin_source('dropbox_import#automated',NULL,NULL,:'u') AND NOT own_origin_source(NULL,NULL,NULL,:'u')
  AND NOT own_origin_source('iphoto',NULL,NULL,NULL),'scraped / external sources are not own-origin');
SELECT fixture_assert(own_origin_source('image_intake',NULL,:'u',:'u') AND NOT own_origin_source('image_intake',NULL,'00000000-0000-4000-8000-000000000002',:'u')
  AND own_origin_source(NULL,'users/'||:'u'||'/capture-relay/a.jpg',NULL,:'u') AND own_origin_source(NULL,'users/'||:'u'||'/photo-sync/a.jpg',NULL,:'u')
  AND NOT own_origin_source(NULL,'users/00000000-0000-4000-8000-000000000002/photo-sync/a.jpg',NULL,:'u')
  AND own_origin_source(NULL,'00000000-0000-4000-8000-000000000299/iphoto/a.jpg',NULL,:'u')
  AND NOT own_origin_source(NULL,'vehicles/x/bat/a.jpg',NULL,:'u'),'image_intake needs the account as uploader; storage paths under the account or <vehicle>/iphoto');
SELECT fx_vehicles(71,76);
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data,source) VALUES (fx(71),:'u','p',NULL,'iphoto'),(fx(72),:'u','p',NULL,'bat');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data,source,automation_script) VALUES (fx(73),:'u','p',NULL,'dropbox_import','bulk.py');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data,source) VALUES (fx(74),:'u','p',NULL,'image_intake');
INSERT INTO vehicle_images(vehicle_id,user_id,image_url,exif_data,storage_path) VALUES (fx(75),:'u','p',NULL,'users/'||:'u'||'/photo-sync/1.jpg');
SELECT fixture_assert(fx_role(71)='documenting' AND fx_role(74)='documenting' AND fx_role(75)='documenting','own-origin photos without EXIF are own-device');
SELECT fixture_assert(fx_role(72)='imported_by_user' AND fx_role(73)='imported_by_user','bat source, or dropbox_import with automation_script, stays an import');
SELECT fixture_assert((fx_step(71,1)->'evidence'->>'own_origin_photo_count')::int=1 AND (fx_step(72,1)->'evidence'->>'own_origin_photo_count')::int=0,'step 1 reports own-origin photos');

-- ===== owner statements: parser =====
SELECT fixture_assert((parse_owner_statement('I''ve owned these for 10 years but none of them are titled to me')->>'ownership_claim')::boolean
  AND (parse_owner_statement('I''ve owned these for 10 years but none of them are titled to me')->>'tenure_years')::numeric=10
  AND (parse_owner_statement('I''ve owned these for 10 years but none of them are titled to me')->>'title_denied')::boolean
  AND parse_owner_statement('I''ve owned these for 10 years but none of them are titled to me')->>'title_denial_scope'='all_listed','ownership + tenure + title denial across a listed set');
SELECT fixture_assert(parse_owner_statement('That one is not titled to me')->>'title_denial_scope'='single'
  AND NOT (parse_owner_statement('That one is not titled to me')->>'ownership_claim')::boolean
  AND (parse_owner_statement('I own it, owned twelve years')->>'tenure_years')::numeric=12
  AND NOT (parse_owner_statement('I don''t own it')->>'ownership_claim')::boolean
  AND NOT (parse_owner_statement('It is titled to me, I own it')->>'title_denied')::boolean,'single denial, word numbers, negated ownership, no false denial');

-- ===== owner statements: record_owner_statement (dry run first, idempotent, ambiguity kept) =====
SELECT fx_vehicles(77,82);
UPDATE vehicles SET year=1978, make='Testmake', model='Zed' WHERE id IN (fx(76),fx(77));
UPDATE vehicles SET year=1990, make='Testmake', model='Zed' WHERE id=fx(78);
UPDATE vehicles SET year=1985, make='Ambmake', model='Amb', vin='AAAAAAAAAAAAAAAA1' WHERE id=fx(79);
UPDATE vehicles SET year=1985, make='Ambmake', model='Amb', vin='AAAAAAAAAAAAAAAA2' WHERE id=fx(80);
UPDATE vehicles SET year=1970, make='Solomake', model='Solo' WHERE id=fx(81);
SELECT fx_photo(76); SELECT fx_photo(76); SELECT fx_photo(77); SELECT fx_photo(78); SELECT fx_photo(79); SELECT fx_photo(80); SELECT fx_photo(81);
SELECT count(*) AS stmts_before FROM vehicle_observations WHERE extraction_method='owner_statement_v1' \gset
SELECT fixture_assert((SELECT resolution='resolved' AND vehicle_id=fx(76) AND jsonb_array_length(candidates)=2 AND observation_id IS NULL
  FROM record_owner_statement(:'u','I''ve owned it for 10 years but it is not titled to me','chat_message:m1',now(),'{"year":1978,"make":"Testmake","model":"Zed"}')),
  'dry run resolves the hint to the duplicate family (photo-rich member) and stores nothing');
SELECT fixture_assert((SELECT count(*) FROM vehicle_observations WHERE extraction_method='owner_statement_v1')=:stmts_before,'dry run wrote nothing');
SELECT fixture_assert((SELECT resolution='ambiguous' AND vehicle_id IS NULL AND jsonb_array_length(candidates)=2
  FROM record_owner_statement(:'u','I own the Amb','chat_message:m2',now(),'{"year":1985,"make":"Ambmake","model":"Amb"}')),'incompatible VINs: ambiguous, every candidate listed');
SELECT fixture_assert((SELECT resolution='unresolved' FROM record_owner_statement(:'u','I own it','chat_message:m3',now(),'{"year":2001,"make":"Nomake","model":"Nomodel"}')),'no match is unresolved, not guessed');
SELECT count(*) FROM record_owner_statement(:'u','I''ve owned it for 10 years but it is not titled to me','chat_message:m1',now(),'{"year":1978,"make":"Testmake","model":"Zed"}',false);
SELECT count(*) FROM record_owner_statement(:'u','I''ve owned it for 10 years but it is not titled to me','chat_message:m1',now(),'{"year":1978,"make":"Testmake","model":"Zed"}',false);
SELECT count(*) FROM record_owner_statement(:'u','I own the Amb','chat_message:m2',now(),'{"year":1985,"make":"Ambmake","model":"Amb"}',false);
SELECT fixture_assert((SELECT count(*) FROM vehicle_observations WHERE extraction_method='owner_statement_v1')=:stmts_before+2,'apply is idempotent per source_ref');
SELECT fixture_assert((SELECT o.structured_data->>'intake_actor'='owner_first_person' AND o.content_text LIKE 'I''ve owned it%' AND o.vehicle_id=fx(76)
  AND o.structured_data->>'source_ref'='chat_message:m1' AND o.submitted_by_user_id=:'u'
  FROM vehicle_observations o WHERE o.structured_data->>'source_ref'='chat_message:m1'),'row carries actor, quoted text, source_ref and vehicle');
SELECT fixture_assert((SELECT o.vehicle_id IS NULL AND jsonb_array_length(o.structured_data->'candidates')=2
  FROM vehicle_observations o WHERE o.structured_data->>'source_ref'='chat_message:m2'),'ambiguous statement stored with vehicle NULL and both candidates');
SET ROLE authenticated; SELECT fixture_fails($q$SELECT * FROM record_owner_statement('00000000-0000-4000-8000-000000000001','x','y')$q$); RESET ROLE;
-- the chain reads it: ownership + tenure + own photos, title denied: owner_reported, capped below 0.85, shared with the duplicate
SELECT fixture_assert(fx_role(76)='owner_reported' AND fx_role(77)='owner_reported'
  AND (SELECT confidence FROM derive_vehicle_relationships(:'u',fx(77)))=0.7
  AND (SELECT evidence->>'title_denied' FROM derive_vehicle_relationships(:'u',fx(77)))='true'
  AND (fx_step(77,5)->'evidence'->>'statement_from_duplicate')::boolean,'title denial caps below owner and keeps the role; the duplicate shares it');
SELECT fixture_assert(fx_role(78)='documenting','a vehicle outside the duplicate family does not inherit it');
-- title denial alone does not remove the garage role
INSERT INTO vehicle_observations(vehicle_id,submitted_by_user_id,content_text,structured_data,extraction_method)
 VALUES (fx(78),:'u','none of them are titled to me',jsonb_build_object('claim_contract','owner_statement_v1','facts',parse_owner_statement('none of them are titled to me')),'owner_statement_v1');
SELECT fixture_assert(fx_role(78)='documenting' AND (SELECT evidence->>'title_denied' FROM derive_vehicle_relationships(:'u',fx(78)))='true','title denial alone: role stays, flagged');
-- inline (unstored) statements through the preview placeholder; the function has none
\set inl_sql `sed -e "s/:'user_id'/'00000000-0000-4000-8000-000000000001'/" -e "s/:'vehicle_id'/''/" -e '$ s/;[[:space:]]*$//' -e "s/^   WHERE false\$/   WHERE false UNION ALL SELECT gen_random_uuid(), '00000000-0000-4000-8000-000000000281'::uuid, now(), 'I have owned it for 12 years', jsonb_build_object('claim_contract','owner_statement_v1','facts',parse_owner_statement('I have owned it for 12 years'))/" supabase/sql/derive_vehicle_relationships_preview.sql`
SELECT count(*) AS obs_before FROM vehicle_observations \gset
SELECT fixture_assert((SELECT derived_role||confidence::text FROM (:inl_sql) q WHERE vehicle_id=fx(81))='owner_reported0.85'
  AND fx_role(81)='documenting' AND (SELECT count(*) FROM vehicle_observations)=:obs_before,'inline statement is previewed read-only: owner_reported 0.85; unstored, the function says documenting');

-- ===== detail-page enrichment: VIN match, lowercase seller, append-only =====
UPDATE vehicles SET year=1978, make='Gmcx', model='K1500', vin='TKL148F714125' WHERE id=fx(82);
SELECT fx_photo(82);
INSERT INTO bat_listings(id,bat_listing_url,bat_listing_title) VALUES ('00000000-0000-4000-8000-0000000003e1','https://bringatrailer.com/listing/1978-gmc-k1500-8/','1978 GMC K1500');
SELECT fixture_assert((SELECT count(*) FROM match_bat_listings_to_vehicles(100,:'u') WHERE vehicle_id=fx(82))=0,'no VIN on the listing yet: no match');
INSERT INTO listing_detail_enrichments(listing_id,listing_url,lot_number,chassis,seller_username,title,run_id,producer_version)
 VALUES ('00000000-0000-4000-8000-0000000003e1','https://bringatrailer.com/listing/1978-gmc-k1500-8/','255909','TKL148F714125','vivalasvegasautos','1978 GMC K1500',gen_random_uuid(),'t');
SELECT fixture_assert((SELECT score=0.95 AND signals ? 'vin' FROM match_bat_listings_to_vehicles(100,:'u') WHERE vehicle_id=fx(82)),'the matcher matches by the enriched chassis / VIN');
SELECT fixture_assert((SELECT fx_step(82,2)->'evidence'->>'organization_id')=:'viva' AND fx_step(82,2)->'evidence'->'inline_matches'->0->'signals' ? 'vin','the chain matches by the enriched VIN and resolves the (lowercased) seller handle to the organization');
SELECT fixture_fails($q$INSERT INTO listing_detail_enrichments(listing_url,seller_username,run_id,producer_version) VALUES ('u2','VivaLasVegasAutos',gen_random_uuid(),'t')$q$);
SELECT fixture_fails($q$UPDATE listing_detail_enrichments SET chassis='X1234567'$q$);
SELECT fixture_fails($q$DELETE FROM listing_detail_enrichments$q$);

-- every row carries the five-step chain with an eliminated list
SELECT fixture_assert(NOT EXISTS (SELECT 1 FROM derive_vehicle_relationships(:'u') d
  WHERE jsonb_array_length(d.evidence->'chain')<>5
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.evidence->'chain') c WHERE jsonb_typeof(c->'eliminated')<>'array' OR NOT c ? 'confidence')),'five steps, each with confidence and eliminated');
SELECT fixture_assert((SELECT (c->'eliminated') ? 'owner_reported' FROM derive_vehicle_relationships(:'u','00000000-0000-4000-8000-000000000108') d, jsonb_array_elements(d.evidence->'chain') c WHERE (c->>'step')='4'),'step 4 title eliminates owner_reported');

-- the preview file is a pure SELECT and returns exactly what the function returns
\set bad `grep -Eic '^[[:space:]]*(insert|update|delete|create|alter|drop|truncate|grant)[[:space:]]' supabase/sql/derive_vehicle_relationships_preview.sql || true`
SELECT fixture_assert(:bad = 0, 'preview file has no DDL or DML');
\set prev_sql `sed -e "s/:'user_id'/'00000000-0000-4000-8000-000000000001'/" -e "s/:'vehicle_id'/''/" -e '$ s/;[[:space:]]*$//' supabase/sql/derive_vehicle_relationships_preview.sql`
BEGIN READ ONLY;
SELECT fixture_assert((SELECT count(*) FROM (:prev_sql) q) > 20,'preview runs in a read-only transaction');
COMMIT;
CREATE TEMP TABLE prev AS :prev_sql ;
SELECT fixture_assert(NOT EXISTS (SELECT 1 FROM prev p FULL JOIN derive_vehicle_relationships(:'u') f ON f.vehicle_id=p.vehicle_id
  WHERE f.vehicle_id IS NULL OR p.vehicle_id IS NULL OR f.derived_role IS DISTINCT FROM p.derived_role
     OR f.confidence IS DISTINCT FROM p.confidence OR f.reason IS DISTINCT FROM p.reason OR f.evidence IS DISTINCT FROM p.evidence),
  'preview file and function return identical rows');

\set same `node scripts/garage/build-chain-function.mjs --check >/dev/null 2>&1 && echo t || echo f`
SELECT fixture_assert(:'same' = 't','migration function body is byte-identical to the preview');
-- alias table is not readable by accounts
SET ROLE authenticated;
SELECT fixture_fails($q$SELECT * FROM org_seller_aliases$q$);
RESET ROLE;
SELECT fixture_assert((SELECT organization_id::text FROM org_seller_aliases WHERE platform='bat' AND seller_username='vivalasvegasautos')=:'viva','Viva alias is seeded');

-- ===== duplicate candidates (read-only, never merges) =====
CREATE FUNCTION fd(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-0000000003'||lpad(n::text,2,'0'))::uuid $$;
INSERT INTO vehicles(id,user_id,year,make,model,vin) VALUES
 (fd(1),:'u',1984,'Chevrolet','Suburban','AAA'),          -- target
 (fd(2),:'u',1985,'Chevrolet','K15 Suburban',NULL),      -- candidate: year +1, family match, one VIN missing
 (fd(3),:'u',1984,'Chevrolet','Suburban','BBB'),         -- VINs both present and different
 (fd(4),:'u',1990,'Chevrolet','Suburban',NULL),          -- year too far
 (fd(5),:'u',1984,'GMC','Suburban',NULL),                -- other make
 (fd(6),:'u',1984,'Chevrolet','Jimmy',NULL),             -- other model family
 (fd(7),'00000000-0000-4000-8000-000000000002',1984,'Chevrolet','Suburban',NULL),  -- other account, no relation
 (fd(8),'00000000-0000-4000-8000-000000000002',1984,'Chevrolet','Suburban 1500',NULL);  -- related by derivation only
INSERT INTO vehicle_relationship_derivations(vehicle_id,user_id,derived_role,confidence,run_id) VALUES (fd(8),:'u','profile_record',0.3,gen_random_uuid());
SELECT fixture_assert((SELECT array_agg(candidate_vehicle_id ORDER BY candidate_vehicle_id) FROM find_vehicle_duplicate_candidates(fd(1)))=ARRAY[fd(2),fd(8)],
  'candidates: same relation, make, year within 1, family, compatible VIN');
SELECT fixture_assert((SELECT vin_state FROM find_vehicle_duplicate_candidates(fd(1)) WHERE candidate_vehicle_id=fd(2))='one_missing' AND
  (SELECT score FROM find_vehicle_duplicate_candidates(fd(1)) WHERE candidate_vehicle_id=fd(2)) BETWEEN 0 AND 1,'candidate carries vin_state and score');
SELECT fixture_assert((SELECT count(*) FROM vehicles WHERE merged_into_vehicle_id IS NOT NULL)=0,'finding candidates merges nothing');
SELECT fixture_assert(normalize_vehicle_model_family('K15 Suburban')='suburban' AND normalize_vehicle_model_family('Suburban 1500')='suburban'
  AND normalize_vehicle_model_family('Jimmy')=normalize_vehicle_model_family('K5 Blazer') AND normalize_vehicle_model_family('C10')='ck-truck'
  AND normalize_vehicle_model_family('Camaro')='camaro' AND normalize_vehicle_model_family('')IS NULL,'model family normalization');
SET ROLE authenticated;
SELECT fixture_fails($q$SELECT * FROM find_vehicle_duplicate_candidates('00000000-0000-4000-8000-000000000301')$q$);
RESET ROLE;

-- ===== image filing gate (flag off by default) =====
INSERT INTO vehicles(id,year,make,model) VALUES (fd(20),1984,'Chevrolet','Suburban'),(fd(21),1999,'Chevrolet','Suburban');
CREATE FUNCTION fd_img(v uuid, ai jsonb, vy int DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 WITH i AS (INSERT INTO vehicle_images(vehicle_id,user_id,image_url,ai_detected_vehicle,vehicle_year) VALUES (v,'00000000-0000-4000-8000-000000000001','g',ai,vy)
   RETURNING image_vehicle_match_status) SELECT coalesce(image_vehicle_match_status,'unset') FROM i $$;
SELECT fixture_assert((SELECT (config_value->>'enabled')::boolean FROM platform_config WHERE config_key='vehicle_image_filing_gate')=false,'gate is off by default');
SELECT fixture_assert(fd_img(fd(20),'{"year":1999,"model":"Suburban"}')='unset','flag off: filed silently, as before');
UPDATE platform_config SET config_value='{"enabled": true, "max_year_gap": 3, "min_ai_confidence": 0.5}' WHERE config_key='vehicle_image_filing_gate';
SELECT fixture_assert(fd_img(fd(20),'{"year":1999,"model":"Suburban"}')='mismatch','flag on: year 15 off => mismatch (review)');
SELECT fixture_assert(fd_img(fd(20),'{"year":1986,"model":"Suburban"}')='unset','year 2 off is filed');
SELECT fixture_assert(fd_img(fd(20),'{"year_range":"1983-1987","model":"K15 Suburban"}')='unset','year range and family agree');
SELECT fixture_assert(fd_img(fd(20),'{"year":1984,"model":"Camaro"}')='mismatch','different model family => mismatch');
SELECT fixture_assert(fd_img(fd(20),'{"year":1999,"model":"Suburban","confidence":0.2}')='unset','low-confidence guess does not gate');
SELECT fixture_assert(fd_img(fd(20),NULL,1960)='mismatch','vehicle_year contradicts => mismatch');
SELECT fixture_assert(fd_img(fd(20),NULL,NULL)='unset','no image-side claim => filed');
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url,ai_detected_vehicle) VALUES ('00000000-0000-4000-8000-000000000a01',fd(21),'00000000-0000-4000-8000-000000000001','g','{"year":1999}');
UPDATE vehicle_images SET vehicle_id=fd(20) WHERE id='00000000-0000-4000-8000-000000000a01';
SELECT fixture_assert((SELECT image_vehicle_match_status FROM vehicle_images WHERE id='00000000-0000-4000-8000-000000000a01')='mismatch','re-filing onto a contradicting vehicle is held');
UPDATE platform_config SET config_value='{"enabled": false, "max_year_gap": 3, "min_ai_confidence": 0.5}' WHERE config_key='vehicle_image_filing_gate';

-- ===== merge and split plans: generated, executable here only to prove they reverse =====
INSERT INTO vehicles(id,year,make,model,user_id) VALUES (fd(30),1984,'Chevrolet','Suburban',:'u'),(fd(31),1984,'Chevrolet','Suburban',:'u');
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url) VALUES ('00000000-0000-4000-8000-000000000b01',fd(31),:'u','m1'),('00000000-0000-4000-8000-000000000b02',fd(31),:'u','m2');
SELECT fd(30)::text AS fd30, fd(31)::text AS fd31 \gset
\set winner :fd30
\set loser :fd31
\pset tuples_only on
\pset format unaligned
\o /tmp/garage_merge_plan.sql
\i scripts/garage/merge-plan.sql
\o
\set loser :fd30
\o /tmp/garage_merge_refused.sql
\i scripts/garage/merge-plan.sql
\o
\pset tuples_only off
\pset format aligned
\set plan_text `cat /tmp/garage_merge_plan.sql`
\set refused_text `cat /tmp/garage_merge_refused.sql`
SELECT fixture_assert(:'plan_text' LIKE '%CREATE TABLE%vehicle_images AS SELECT%' AND :'plan_text' LIKE '%merged_from_vehicle_id%' AND :'plan_text' LIKE '%-- UPDATE public.vehicle_images vi SET vehicle_id = b.vehicle_id%','merge plan: backup, move with merged_from, commented inverse');
SELECT fixture_assert(:'refused_text' LIKE '-- REFUSED%','merge plan refuses winner = loser');
SELECT fixture_assert((SELECT count(*) FROM vehicle_images WHERE vehicle_id=fd(31))=2 AND (SELECT merged_into_vehicle_id FROM vehicles WHERE id=fd(31)) IS NULL,'generating the plan changed nothing');
\i /tmp/garage_merge_plan.sql
SELECT fixture_assert((SELECT count(*) FROM vehicle_images WHERE vehicle_id=fd(30) AND merged_from_vehicle_id=fd(31))=2 AND (SELECT merged_into_vehicle_id FROM vehicles WHERE id=fd(31))=fd(30),'merge plan moves images and marks the loser');
\! sed -n '/INVERSE/,$p' /tmp/garage_merge_plan.sql | sed -E 's/^-- (BEGIN|UPDATE|COMMIT)/\1/' > /tmp/garage_merge_inverse.sql
\i /tmp/garage_merge_inverse.sql
SELECT fixture_assert((SELECT count(*) FROM vehicle_images WHERE vehicle_id=fd(31) AND merged_from_vehicle_id IS NULL)=2 AND (SELECT merged_into_vehicle_id FROM vehicles WHERE id=fd(31)) IS NULL,'merge inverse restores images and loser');

\set source :fd31
\set image_ids 00000000-0000-4000-8000-000000000b01
\set year 1985
\set make Chevrolet
\set model Suburban
\pset tuples_only on
\pset format unaligned
\o /tmp/garage_split_plan.sql
\i scripts/garage/split-plan.sql
\o
\set image_ids 00000000-0000-4000-8000-0000000000ff
\o /tmp/garage_split_refused.sql
\i scripts/garage/split-plan.sql
\o
\pset tuples_only off
\pset format aligned
\set split_text `cat /tmp/garage_split_plan.sql`
\set split_refused `cat /tmp/garage_split_refused.sql`
SELECT fixture_assert(:'split_refused' LIKE '-- REFUSED%','split plan refuses images that are not on the source');
SELECT fixture_assert(:'split_text' LIKE '%INSERT INTO public.vehicles%' AND :'split_text' LIKE '%-- UPDATE public.vehicles SET deleted_at = now()%','split plan: new vehicle row and commented inverse');
\i /tmp/garage_split_plan.sql
SELECT fixture_assert((SELECT count(*) FROM vehicle_images WHERE id='00000000-0000-4000-8000-000000000b01' AND vehicle_id<>fd(31))=1
  AND (SELECT count(*) FROM vehicle_images WHERE vehicle_id=fd(31))=1,'split moves only the listed image');
\! sed -n '/INVERSE/,$p' /tmp/garage_split_plan.sql | sed -E 's/^-- (BEGIN|UPDATE|COMMIT)/\1/' > /tmp/garage_split_inverse.sql
\i /tmp/garage_split_inverse.sql
SELECT fixture_assert((SELECT vehicle_id FROM vehicle_images WHERE id='00000000-0000-4000-8000-000000000b01')=fd(31)
  AND (SELECT count(*) FROM vehicles WHERE deleted_at IS NOT NULL AND year=1985 AND user_id=:'u')=1,'split inverse returns the image and retires the new row (no delete)');

SELECT 'PASS: evidence chain, listing matches, org aliases, shoot vs long-term, own-device, statement precedence, decay, preview parity, duplicate candidates, filing gate, merge/split plans';

