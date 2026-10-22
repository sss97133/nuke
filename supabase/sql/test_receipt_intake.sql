-- Disposable PG17 database only. Synthetic fixtures; never run against production.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false);
CREATE TABLE organization_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,status text,role text CONSTRAINT organization_contributors_role_check CHECK(role IN ('owner')),verification_method text,verified_by uuid,verified_at timestamptz,end_date date,updated_at timestamptz,actor_type text,UNIQUE(organization_id,user_id));
CREATE TABLE business_ownership(business_id uuid,owner_id uuid,status text);
CREATE TABLE api_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,name text,scopes text[],is_active boolean,expires_at timestamptz);
CREATE TABLE api_usage_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,api_key_id uuid,resource text,action text,resource_id text);
CREATE TABLE delegation_audit(rpc text,result_ref text);
CREATE FUNCTION owner_delegation_owner_id() RETURNS uuid LANGUAGE sql AS $$SELECT '10000000-0000-0000-0000-000000000001'::uuid$$;
CREATE FUNCTION owner_delegated_sign_register(text,jsonb,text,text,text,timestamptz) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN INSERT INTO delegation_audit VALUES($1,$3);RETURN gen_random_uuid();END$$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
CREATE TYPE source_species AS ENUM ('owner_private');
CREATE TABLE observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text,species source_species,species_set source_species[],species_evidence jsonb);
INSERT INTO observation_sources(slug) VALUES('receipt-scan');
CREATE TABLE secure_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,document_type text,file_hash text,file_size int,mime_type text,storage_path text,upload_metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE artifact_dispatch_log(id uuid PRIMARY KEY,content_sha256 text,kind text,source_slug text,submitted_at timestamptz,submitted_by text,handler text,status text,artifact_payload jsonb,observation_ids uuid[],routed_at timestamptz,completed_at timestamptz,UNIQUE(content_sha256,kind));
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,source_id uuid,source_identifier text,subject_type text,subject_id uuid,subject_organization_id uuid,submitted_by_user_id uuid,observed_at timestamptz,kind text,content_text text,structured_data jsonb,content_hash text,extraction_method text,citation_secure_document_id uuid,observer_raw jsonb,extraction_metadata jsonb,confidence text,confidence_score numeric,raw_source_ref text);
ALTER TABLE vehicle_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE secure_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_dispatch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_legacy_doc_read ON secure_documents FOR SELECT USING(true);
CREATE POLICY fixture_legacy_doc_insert ON secure_documents FOR INSERT WITH CHECK(true);
CREATE POLICY fixture_legacy_artifact_read ON artifact_dispatch_log FOR SELECT USING(true);
CREATE POLICY fixture_legacy_public_read ON vehicle_observations FOR SELECT USING(true);
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
GRANT SELECT ON vehicle_observations TO anon,authenticated;
GRANT SELECT,INSERT,TRUNCATE ON secure_documents,artifact_dispatch_log TO anon,authenticated;
GRANT TRUNCATE ON vehicle_observations TO anon,authenticated;
CREATE FUNCTION t_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; RAISE NOTICE 'PASS: %',message; END $$;
-- Model the legacy permissive membership INSERT path; the new trigger must close it.
GRANT SELECT,INSERT ON organization_contributors TO authenticated;
ALTER TABLE auth.users ADD COLUMN email text;
ALTER TABLE api_keys ADD COLUMN key_hash text, ADD COLUMN key_prefix text, ADD COLUMN rate_limit_per_hour integer, ADD COLUMN rate_limit_remaining integer;
CREATE TABLE oauth_clients(client_id text PRIMARY KEY,redirect_uris text[],token_endpoint_auth_method text);
CREATE TABLE oauth_login_sessions(session_id text PRIMARY KEY,client_id text,user_id uuid,redirect_uri text,scope text,state text,code_challenge text,code_challenge_method text,email text,expires_at timestamptz,completed_at timestamptz);
CREATE TABLE oauth_authorization_codes(code text PRIMARY KEY,client_id text,user_id uuid,redirect_uri text,scope text,code_challenge text,code_challenge_method text,expires_at timestamptz,used_at timestamptz);
\ir ../migrations/20261022014119_delegated_receipt_intake.sql
BEGIN;
INSERT INTO auth.users(id,email_confirmed_at,is_anonymous) VALUES('10000000-0000-0000-0000-000000000001',now(),false),('20000000-0000-0000-0000-000000000002',now(),false),('30000000-0000-0000-0000-000000000003',now(),false);
INSERT INTO business_ownership VALUES('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','active');
INSERT INTO organization_contributors(organization_id,user_id,status,role,verification_method) VALUES('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','active','owner','self_claimed');
INSERT INTO organization_contributors(organization_id,user_id,status,role,verification_method) VALUES('50000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000003','active','owner','self_claimed');
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN INSERT INTO organization_contributors(organization_id,user_id,status,role,verification_method,verified_by,verified_at) VALUES('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000004','active','accountant','owner_approval','10000000-0000-0000-0000-000000000001',now()); RAISE EXCEPTION 'legacy owner forged accountant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO organization_contributors(organization_id,user_id,status,role,verification_method,verified_by,verified_at) VALUES('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000004','active','owner','owner_approval','10000000-0000-0000-0000-000000000001',now()); RAISE EXCEPTION 'legacy owner forged verified owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM t_assert(true,'legacy self-claimed owner cannot forge privileged approval');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
SELECT request_accounting_membership('50000000-0000-0000-0000-000000000005');
DO $$ BEGIN BEGIN PERFORM review_accounting_membership((SELECT id FROM organization_contributors WHERE role='accountant'),'approve'); RAISE EXCEPTION 'self approval bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT t_assert((check_receipt_intake_access(NULL,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','submit')->>'allowed')::boolean,'legal owner works despite self-claimed membership');
DO $$ BEGIN BEGIN PERFORM check_receipt_intake_access(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','submit'); RAISE EXCEPTION 'pending member bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT review_accounting_membership(id,'approve') FROM organization_contributors WHERE role='accountant';
INSERT INTO api_keys(id,user_id,name,scopes,is_active) VALUES('60000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','synthetic receipt agent',ARRAY['read','write'],true);
INSERT INTO storage.buckets VALUES('user-documents',false);
INSERT INTO storage.objects VALUES('user-documents','10000000-0000-0000-0000-000000000001/receipt-originals/sha256/'||repeat('a',64)||'.png','{"size":123}');
CREATE TEMP TABLE receipt_results(label text PRIMARY KEY,result jsonb);
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE original jsonb; extraction jsonb; first_result jsonb; again jsonb; corrected jsonb; wrong jsonb; BEGIN
 original:=jsonb_build_object('sha256',repeat('a',64),'bucket','user-documents','storage_path','10000000-0000-0000-0000-000000000001/receipt-originals/sha256/'||repeat('a',64)||'.png','file_size',123,'mime_type','image/png','filename','synthetic.png');
 extraction:='{"method":"synthetic-ocr","version":"test-v1","raw_text":"SYNTHETIC RECEIPT","fields":{"total":12.34},"items":[]}';
 BEGIN PERFORM ingest_receipt_evidence(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',original||'{"file_size":124}',extraction); RAISE EXCEPTION 'size mismatch accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'private original missing' THEN RAISE; END IF; END;
 BEGIN PERFORM ingest_receipt_evidence(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',original,'{"fields":{}}'); RAISE EXCEPTION 'incomplete extraction accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid extraction' THEN RAISE; END IF; END;
 PERFORM t_assert((SELECT count(*) FROM artifact_dispatch_log)=0 AND (SELECT count(*) FROM secure_documents)=0,'invalid input fails atomically before records are written');
 first_result:=ingest_receipt_evidence('60000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',original,extraction);
 INSERT INTO receipt_results VALUES('first',first_result);
 PERFORM t_assert(first_result @> '{"duplicate":false,"expense_posted":false,"status":"captured_needs_review"}','capture remains review evidence, no automatic expense');
 PERFORM t_assert((SELECT submitted_by_user_id='20000000-0000-0000-0000-000000000002' AND subject_id='10000000-0000-0000-0000-000000000001' AND subject_organization_id='50000000-0000-0000-0000-000000000005' AND observer_raw->>'membership_id'=(SELECT id::text FROM organization_contributors WHERE role='accountant') AND extraction_metadata->>'method'='synthetic-ocr' FROM vehicle_observations WHERE id=(first_result->>'observation_id')::uuid),'actor, owner, org, membership and extraction provenance');
 again:=ingest_receipt_evidence('60000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',original,extraction);
 PERFORM t_assert(again->>'duplicate'='true' AND again->>'artifact_id'=first_result->>'artifact_id' AND (SELECT count(*) FROM vehicle_observations)=1 AND (SELECT count(*) FROM secure_documents)=1,'same submission is idempotent');
 corrected:=ingest_receipt_evidence(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',original,jsonb_set(extraction,'{fields,total}','12.35'),(first_result->>'artifact_id')::uuid);
 PERFORM t_assert(corrected->>'document_id'=first_result->>'document_id' AND corrected->>'observation_id'<>first_result->>'observation_id' AND (SELECT structured_data#>>'{fields,total}' FROM vehicle_observations WHERE id=(first_result->>'observation_id')::uuid)='12.34','same original correction appends interpretation without overwriting');
 PERFORM t_assert((read_receipt_intake(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',(first_result->>'artifact_id')::uuid)#>>'{records,0,has_later_interpretation}')='true','reader identifies superseded interpretation');
 INSERT INTO storage.objects VALUES('user-documents','10000000-0000-0000-0000-000000000001/receipt-originals/sha256/'||repeat('b',64)||'.png','{"size":123}');
 wrong:=original||jsonb_build_object('sha256',repeat('b',64),'storage_path','10000000-0000-0000-0000-000000000001/receipt-originals/sha256/'||repeat('b',64)||'.png');
 BEGIN PERFORM ingest_receipt_evidence(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005',wrong,extraction,(first_result->>'artifact_id')::uuid); RAISE EXCEPTION 'different original correction accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'correction must cite same-context original' THEN RAISE; END IF; END;
 PERFORM t_assert((SELECT count(*) FROM api_usage_logs WHERE resource='receipt_intake' AND action='submit')=3 AND (SELECT count(*) FROM api_usage_logs WHERE resource='receipt_intake' AND action='read')=1,'duplicate, correction and reads all record participation');
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','anon',true);
SELECT t_assert((SELECT count(*) FROM vehicle_observations)=0,'anonymous cannot read private receipt observations');
SELECT t_assert((SELECT count(*) FROM secure_documents)=0 AND (SELECT count(*) FROM artifact_dispatch_log)=0,'anonymous cannot read private original or payload');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000003',true),set_config('request.jwt.claim.role','authenticated',true);
SELECT t_assert((SELECT count(*) FROM vehicle_observations)=0,'unrelated account cannot read private receipt observations');
SELECT t_assert((SELECT count(*) FROM secure_documents)=0 AND (SELECT count(*) FROM artifact_dispatch_log)=0,'unrelated account cannot read private original or payload');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT t_assert((SELECT count(*) FROM vehicle_observations)=2,'owner retains private observation access');
SELECT t_assert((SELECT count(*) FROM secure_documents)=1 AND (SELECT count(*) FROM artifact_dispatch_log)=0,'owner can read original; artifact payload remains API-only');
DO $$ BEGIN
 BEGIN INSERT INTO secure_documents(user_id,document_type,file_hash,file_size,mime_type,storage_path) VALUES(auth.uid(),'receipt_original',repeat('c',64),123,'image/png','forged'); RAISE EXCEPTION 'direct original insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT review_accounting_membership(id,'revoke') FROM organization_contributors WHERE role='accountant';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
 BEGIN PERFORM read_receipt_intake('60000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005'); RAISE EXCEPTION 'revoked member reads via old key'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM check_receipt_intake_access(NULL,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','submit'); RAISE EXCEPTION 'revoked member submits via session'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM t_assert(true,'membership revocation immediately denies both key and session');
END $$;
SELECT t_assert(NOT has_function_privilege('authenticated','ingest_receipt_evidence(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid)','EXECUTE') AND NOT has_function_privilege('anon','read_receipt_intake(uuid,uuid,uuid,uuid,uuid,integer)','EXECUTE'),'service-only receipt RPC privileges');
SELECT t_assert((SELECT count(*) FROM pg_trigger WHERE tgname IN ('receipt_artifact_history','receipt_observation_history','receipt_original_history') AND tgenabled='O')=3,'append-only history guards installed');
SELECT t_assert(NOT has_table_privilege('authenticated','secure_documents','TRUNCATE') AND NOT has_table_privilege('anon','artifact_dispatch_log','TRUNCATE') AND NOT has_table_privilege('authenticated','vehicle_observations','TRUNCATE'),'client truncate bypass unavailable');
ROLLBACK;

-- Account permission and OAuth credential regression suites over the same migration.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,email_confirmed_at,is_anonymous) VALUES('10000000-0000-0000-0000-000000000001',now(),false),('20000000-0000-0000-0000-000000000002',now(),false);
INSERT INTO business_ownership VALUES('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','active');
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
SELECT request_accounting_membership('50000000-0000-0000-0000-000000000005');
DO $$ DECLARE m uuid; BEGIN SELECT id INTO m FROM organization_contributors LIMIT 1; BEGIN PERFORM review_accounting_membership(m,'approve'); RAISE EXCEPTION 'self approval accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT review_accounting_membership(id,'approve') FROM organization_contributors;
INSERT INTO api_keys(user_id,name,scopes,is_active) VALUES('20000000-0000-0000-0000-000000000002','normal',ARRAY['read','write'],true),('20000000-0000-0000-0000-000000000002','narrow',ARRAY['receipts:read'],true);
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE k record; ctx jsonb; denied int:=0; BEGIN
 FOR k IN SELECT * FROM api_keys LOOP
 ctx:=check_receipt_intake_access(k.id,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','read'); IF (ctx->>'allowed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'access missing'; END IF;
 END LOOP;
 SELECT * INTO k FROM api_keys WHERE name='narrow';
 BEGIN PERFORM check_receipt_intake_access(k.id,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','submit'); RAISE EXCEPTION 'scope bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM record_receipt_participation(NULL,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','upload','{"sha256":"fixture","status":"uploaded"}');
 UPDATE organization_contributors SET status='inactive';
 FOR k IN SELECT * FROM api_keys LOOP
 BEGIN PERFORM check_receipt_intake_access(k.id,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','read'); RAISE EXCEPTION 'membership revoke bypass'; EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1; END;
 END LOOP; IF denied<>2 THEN RAISE EXCEPTION 'must deny both keys'; END IF;
 PERFORM review_accounting_membership((SELECT id FROM organization_contributors LIMIT 1),'approve','Owner explicitly authorizes accounting membership','local-test-session');
 IF NOT EXISTS(SELECT 1 FROM delegation_audit) THEN RAISE EXCEPTION 'audit missing'; END IF;

 SELECT * INTO k FROM api_keys WHERE name='normal';
 UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=k.id;
 BEGIN PERFORM check_receipt_intake_access(k.id,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','read'); RAISE EXCEPTION 'expired key bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE api_keys SET expires_at=NULL,is_active=false WHERE id=k.id;
 BEGIN PERFORM check_receipt_intake_access(k.id,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','read'); RAISE EXCEPTION 'revoked key bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM check_receipt_intake_access(NULL,k.user_id,k.user_id,'50000000-0000-0000-0000-000000000005','read'); RAISE EXCEPTION 'wrong owner bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE organization_contributors SET verification_method='self_claimed';
 BEGIN PERFORM check_receipt_intake_access(NULL,k.user_id,'10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','read'); RAISE EXCEPTION 'self claimed bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS request, owner approval, scoped keys, JWT, provenance, membership revocation across keys, delegated owner audit, self-claimed denial';
END $$;
ROLLBACK;

\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES('20000000-0000-0000-0000-000000000002','delegate@example.test',now(),false);
INSERT INTO oauth_clients VALUES('fixture',ARRAY['https://client.example/callback'],'none');
INSERT INTO oauth_login_sessions VALUES('session','fixture',NULL,'https://client.example/callback','read receipts:read receipts:upload receipts:submit','state','challenge','S256','delegate@example.test',now()+interval '10 minutes',NULL,NULL,NULL,NULL,NULL);
SELECT finish_mcp_oauth_login('session','20000000-0000-0000-0000-000000000002','code');
DO $$BEGIN
 BEGIN PERFORM finish_mcp_oauth_login('session','20000000-0000-0000-0000-000000000002','code2');RAISE EXCEPTION 'replay accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','wrong','https://client.example/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64));RAISE EXCEPTION 'wrongclient accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','fixture','https://client.example/callback','wrong','sha256_'||repeat('a',64),'sha256_'||repeat('b',64));RAISE EXCEPTION 'wrongPKCE accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE oauth_authorization_codes SET scope='admin' WHERE code='code';
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','fixture','https://client.example/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64));RAISE EXCEPTION 'mismatched scope accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE oauth_authorization_codes SET scope='read receipts:read receipts:upload receipts:submit',code_challenge=NULL WHERE code='code';
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','fixture','https://client.example/callback',NULL,'sha256_'||repeat('a',64),'sha256_'||repeat('b',64));RAISE EXCEPTION 'null PKCE accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE oauth_authorization_codes SET code_challenge='challenge' WHERE code='code';
 PERFORM exchange_mcp_oauth_credential('authorization_code','code','fixture','https://client.example/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64));
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','fixture','https://client.example/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64));RAISE EXCEPTION 'code replay accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('b',64),'fixture',NULL,NULL,'sha256_'||repeat('c',64),'sha256_'||repeat('d',64));
 IF EXISTS(SELECT 1 FROM api_keys WHERE key_hash='sha256_'||repeat('a',64) AND is_active) THEN RAISE EXCEPTION 'old access remains active';END IF;
 BEGIN PERFORM exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('b',64),'fixture',NULL,NULL,'sha256_'||repeat('e',64),'sha256_'||repeat('f',64));RAISE EXCEPTION 'refresh replay accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM revoke_mcp_oauth_credential('sha256_'||repeat('d',64),'fixture');
 IF EXISTS(SELECT 1 FROM api_keys WHERE is_active) THEN RAISE EXCEPTION 'revocation failed';END IF;
 BEGIN PERFORM exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('d',64),'fixture',NULL,NULL,'sha256_'||repeat('e',64),'sha256_'||repeat('f',64));RAISE EXCEPTION 'revoked refresh accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS one-time login/code, client/PKCE, refresh rotation, access invalidation, revocation';
END $$;
ROLLBACK;
