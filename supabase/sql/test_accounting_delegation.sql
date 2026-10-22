-- Disposable synthetic contract; no production data.
\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN email_confirmed_at timestamptz;
CREATE TABLE profiles(id uuid PRIMARY KEY, username text, full_name text);
CREATE TABLE api_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,name text,scopes text[],is_active boolean,expires_at timestamptz,key_hash text,key_prefix text,rate_limit_per_hour int,rate_limit_remaining int);
CREATE TABLE api_usage_logs(user_id uuid,resource text,action text,resource_id text);
CREATE TABLE oauth_clients(client_id text PRIMARY KEY,redirect_uris text[],token_endpoint_auth_method text);
CREATE TABLE oauth_login_sessions(session_id text PRIMARY KEY,client_id text,user_id uuid,redirect_uri text,scope text,state text,code_challenge text,code_challenge_method text,email text,expires_at timestamptz,completed_at timestamptz);
CREATE TABLE oauth_authorization_codes(code text PRIMARY KEY,client_id text,user_id uuid,redirect_uri text,scope text,code_challenge text,code_challenge_method text,expires_at timestamptz,used_at timestamptz);
\ir ../migrations/20261022231316_accounting_delegation.sql
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('11111111-1111-4111-8111-111111111111','owner@example.invalid',now()),('22222222-2222-4222-8222-222222222222','reviewer@example.invalid',now()),('33333333-3333-4333-8333-333333333333','other@example.invalid',now());
INSERT INTO profiles VALUES('22222222-2222-4222-8222-222222222222','reviewer','Synthetic reviewer');
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF find_accounting_member('reviewer')->>'email'='reviewer@example.invalid' THEN RAISE EXCEPTION 'username revealed private login'; END IF;
 IF find_accounting_member('reviewer@example.invalid')->>'email'<>'reviewer@example.invalid' THEN RAISE EXCEPTION 'exact supplied login not confirmed'; END IF;
 PERFORM set_accounting_access('22222222-2222-4222-8222-222222222222','correct');
 IF list_accounting_access()::text LIKE '%reviewer@example.invalid%' THEN RAISE EXCEPTION 'grant listing revealed unknown private email'; END IF;
 BEGIN INSERT INTO accounting_access_grants(owner_id,member_id) VALUES('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'); RAISE EXCEPTION 'raw grant write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM authorize_financial_access('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',NULL,'correct'); RAISE EXCEPTION 'direct authority rpc accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO api_keys(id,user_id,scopes,is_active) VALUES('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',ARRAY['accounting:read','accounting:correct'],true);
DO $$ DECLARE
 owner uuid:='11111111-1111-4111-8111-111111111111'; actor uuid:='22222222-2222-4222-8222-222222222222'; key uuid:='44444444-4444-4444-8444-444444444444';
 original jsonb:=jsonb_build_object('sha256',repeat('a',64),'storage_path',owner||'/proof.pdf','byte_size',100);
 revision jsonb:='{"idempotency_key":"first","method":"synthetic","version":"1","fields":[{"field_key":"purpose","value_raw":"unknown","evidence":{"quote":"source"}}]}';
 first_run jsonb; next_run jsonb; authority jsonb;
BEGIN
 first_run:=ingest_financial_evidence(owner,original,revision);
 authority:=authorize_financial_access(actor,owner,key,'correct')-'allowed'-'operation'; authority:=authority||'{"kind":"api_key"}';
 revision:=revision||jsonb_build_object('idempotency_key','corrected','supersedes_run_id',first_run->>'extraction_run_id');
 next_run:=ingest_financial_evidence(owner,original,revision,authority);
 IF NOT EXISTS(SELECT 1 FROM financial_document_extractions WHERE extraction_run_id=(next_run->>'extraction_run_id')::uuid AND owner_id=owner AND value_normalized->>'actor_user_id'=actor::text AND value_normalized->'auth_context'->>'key_id'=key::text) THEN RAISE EXCEPTION 'actor attribution lost'; END IF;
 IF (ingest_financial_evidence(owner,original,revision,authority))->>'duplicate'<>'true' THEN RAISE EXCEPTION 'retry not idempotent'; END IF;
 BEGIN PERFORM ingest_financial_evidence(owner,original,revision||'{"idempotency_key":"stale"}',authority); RAISE EXCEPTION 'stale correction accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='stale correction accepted' THEN RAISE; END IF; END;
 BEGIN PERFORM ingest_financial_evidence(owner,original||jsonb_build_object('sha256',repeat('b',64)),revision,authority); RAISE EXCEPTION 'delegate minted original'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE api_keys SET scopes=ARRAY['accounting:read'] WHERE id=key;
 BEGIN PERFORM ingest_financial_evidence(owner,original,revision,authority); RAISE EXCEPTION 'read key corrected'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE api_keys SET scopes=ARRAY['accounting:read','accounting:correct'] WHERE id=key;
 UPDATE accounting_access_grants SET active=false WHERE owner_id=owner;
 BEGIN PERFORM ingest_financial_evidence(owner,original,revision,authority); RAISE EXCEPTION 'revoked grant admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE accounting_access_grants SET active=true WHERE owner_id=owner;
 UPDATE api_keys SET is_active=false WHERE id=key;
 BEGIN PERFORM authorize_financial_access(actor,owner,key,'read'); RAISE EXCEPTION 'revoked key read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM authorize_financial_access(actor,'33333333-3333-4333-8333-333333333333',NULL,'read'); RAISE EXCEPTION 'cross owner read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- RLS permits only the granted member, and revocation takes effect on the next read.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM financial_documents)<>1 THEN RAISE EXCEPTION 'shared browser document unavailable'; END IF; END $$;
RESET ROLE;
UPDATE accounting_access_grants SET active=false;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM financial_documents) THEN RAISE EXCEPTION 'revoked browser read'; END IF; END $$;
RESET ROLE;
-- An owner can revoke a banned member; the grant must not revive on unban.
UPDATE accounting_access_grants SET active=true;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE email='reviewer@example.invalid';
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','revoke');
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM accounting_access_grants WHERE active) THEN RAISE EXCEPTION 'banned member could not be revoked'; END IF; END $$;
UPDATE auth.users SET banned_until=NULL;
-- Banned/deleted accounts cannot start or exchange a connection.
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO oauth_clients VALUES('client',ARRAY['http://localhost:8123/callback'],'none');
INSERT INTO oauth_login_sessions(session_id,client_id,redirect_uri,scope,code_challenge,code_challenge_method,email,expires_at) VALUES('session','client','http://localhost:8123/callback','mcp:tools accounting:read','challenge','S256','reviewer@example.invalid',now()+interval '5 minutes');
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE email='reviewer@example.invalid';
DO $$ BEGIN BEGIN PERFORM finish_mcp_oauth_login('session','22222222-2222-4222-8222-222222222222','code'); RAISE EXCEPTION 'banned login accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
UPDATE auth.users SET banned_until=NULL WHERE email='reviewer@example.invalid';
SELECT finish_mcp_oauth_login('session','22222222-2222-4222-8222-222222222222','code');
UPDATE auth.users SET deleted_at=now() WHERE email='reviewer@example.invalid';
DO $$ BEGIN BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','client','http://localhost:8123/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64)); RAISE EXCEPTION 'deleted exchange accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
-- Successful exchange, PKCE/client binding, refresh rotation and revocation use real SQL.
UPDATE auth.users SET deleted_at=NULL WHERE email='reviewer@example.invalid';
DO $$ DECLARE first_key uuid; second_key uuid; result jsonb;
BEGIN
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','other-client','http://localhost:8123/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64)); RAISE EXCEPTION 'wrong client exchanged'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','client','https://wrong.example.invalid','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64)); RAISE EXCEPTION 'wrong redirect exchanged'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','client','http://localhost:8123/callback','wrong-challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64)); RAISE EXCEPTION 'wrong PKCE exchanged'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=exchange_mcp_oauth_credential('authorization_code','code','client','http://localhost:8123/callback','challenge','sha256_'||repeat('a',64),'sha256_'||repeat('b',64));
 first_key:=(result->>'key_id')::uuid;
 IF result->>'user_id'<>'22222222-2222-4222-8222-222222222222' OR result->'scopes'<>'["mcp:tools","accounting:read"]'::jsonb
 OR NOT EXISTS(SELECT 1 FROM api_keys WHERE id=first_key AND user_id='22222222-2222-4222-8222-222222222222' AND key_hash='sha256_'||repeat('a',64) AND is_active AND expires_at>now() AND scopes=ARRAY['mcp:tools','accounting:read']) THEN RAISE EXCEPTION 'credential binding lost'; END IF;
 BEGIN PERFORM exchange_mcp_oauth_credential('authorization_code','code','client','http://localhost:8123/callback','challenge','sha256_'||repeat('c',64),'sha256_'||repeat('d',64)); RAISE EXCEPTION 'code replay accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- An unrelated client cannot revoke either access or refresh credentials.
 PERFORM revoke_mcp_oauth_credential('sha256_'||repeat('a',64),'other-client');
 PERFORM revoke_mcp_oauth_credential('sha256_'||repeat('b',64),'other-client');
 IF NOT EXISTS(SELECT 1 FROM api_keys WHERE id=first_key AND is_active) THEN RAISE EXCEPTION 'wrong client revoked'; END IF;
 BEGIN PERFORM exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('b',64),'other-client',NULL,NULL,'sha256_'||repeat('c',64),'sha256_'||repeat('d',64)); RAISE EXCEPTION 'wrong client refreshed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('b',64),'client',NULL,NULL,'sha256_'||repeat('c',64),'sha256_'||repeat('d',64));
 second_key:=(result->>'key_id')::uuid;
 IF second_key=first_key OR EXISTS(SELECT 1 FROM api_keys WHERE id=first_key AND is_active) OR NOT EXISTS(SELECT 1 FROM api_keys WHERE id=second_key AND is_active AND user_id='22222222-2222-4222-8222-222222222222' AND scopes=ARRAY['mcp:tools','accounting:read']) THEN RAISE EXCEPTION 'refresh did not rotate bound key'; END IF;
 BEGIN PERFORM exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('b',64),'client',NULL,NULL,'sha256_'||repeat('e',64),'sha256_'||repeat('f',64)); RAISE EXCEPTION 'old refresh replay accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM revoke_mcp_oauth_credential('sha256_'||repeat('c',64),'client');
 IF EXISTS(SELECT 1 FROM api_keys WHERE id=second_key AND is_active) THEN RAISE EXCEPTION 'revoke kept active access'; END IF;
 BEGIN PERFORM exchange_mcp_oauth_credential('refresh_token','sha256_'||repeat('d',64),'client',NULL,NULL,'sha256_'||repeat('e',64),'sha256_'||repeat('f',64)); RAISE EXCEPTION 'revoked credential refreshed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
-- Independent sessions prove key/grant locks serialize admission against revocation.
CREATE EXTENSION dblink;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('11111111-1111-4111-8111-111111111111','owner@example.invalid',now()),('22222222-2222-4222-8222-222222222222','reviewer@example.invalid',now());
INSERT INTO accounting_access_grants(owner_id,member_id,can_correct) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true);
INSERT INTO api_keys(id,user_id,scopes,is_active) VALUES('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',ARRAY['accounting:read','accounting:correct'],true);
SELECT dblink_connect('admission',format('dbname=%s host=%s port=%s user=%s',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user));
SELECT dblink_exec('admission','BEGIN');
SELECT * FROM dblink('admission',$q$SELECT set_config('request.jwt.claim.role','service_role',false)$q$) AS t(result text);
SELECT * FROM dblink('admission',$q$SELECT authorize_financial_access('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','correct')$q$) AS t(result jsonb);
SET lock_timeout='100ms';
DO $$ BEGIN
 BEGIN UPDATE accounting_access_grants SET active=false; RAISE EXCEPTION 'grant revoke did not serialize'; EXCEPTION WHEN lock_not_available THEN NULL; END;
 BEGIN UPDATE api_keys SET is_active=false; RAISE EXCEPTION 'key revoke did not serialize'; EXCEPTION WHEN lock_not_available THEN NULL; END;
END $$;
SELECT dblink_exec('admission','COMMIT');
SELECT dblink_disconnect('admission');
UPDATE accounting_access_grants SET active=false;
UPDATE api_keys SET is_active=false;
RESET lock_timeout;
