-- oauth_refresh_sliding_replay: keep a connector signed in for as long as it is used.
--
-- Measured 2026-11-18 on public.oauth_login_sessions (4 sessions holding a refresh token):
--   1. refresh_expires_at was set once, 30 days after sign-in, and a refresh kept it. Every connector lost its
--      sign-in 30 days after it connected, however often it was used (one session connected 2026-10-23 was due to
--      end 2026-11-22).
--   2. A refresh replaced the refresh token and switched off the previous access key at once. Two refreshes sent
--      with the same token at the same moment (three /oauth/token calls arrived within 1.4 s at 15:31 UTC) left
--      the second with "Invalid refresh token", which a client reads as "sign in again".
--
-- What changes, in exchange_mcp_oauth_credential only:
--   1. Sliding expiry: sign-in and every refresh set the refresh token to end 90 days later. An unused connection
--      still ends, 90 days after its last refresh. Revocation is unchanged.
--   2. Replay of the token just rotated: the previous refresh hash is kept with the time it was replaced. For two
--      minutes a call presenting it is answered with the credentials already issued, when the caller derives the
--      same pair (oauth-server derives them from the presented token with a server-held key, so only a caller
--      going through oauth-server with that exact token can match). Nothing is written on a replay.
--
-- revoke_mcp_oauth_credential also matches the previous refresh hash, so a caller still holding the token that was
-- just rotated can end the connection with it (before, that revoke matched nothing and the session lived on).
--
-- No row is rewritten: existing sessions keep their expiry until their next refresh.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.oauth_login_sessions
  ADD COLUMN IF NOT EXISTS prev_refresh_token_hash text,
  ADD COLUMN IF NOT EXISTS prev_refresh_rotated_at timestamptz;

COMMENT ON COLUMN public.oauth_login_sessions.prev_refresh_token_hash IS
  'Hash of the refresh token replaced by the last refresh. A call presenting it within two minutes of prev_refresh_rotated_at is answered with the credentials already issued (exchange_mcp_oauth_credential).';
COMMENT ON COLUMN public.oauth_login_sessions.prev_refresh_rotated_at IS
  'When prev_refresh_token_hash was replaced.';

CREATE INDEX IF NOT EXISTS oauth_login_sessions_prev_refresh_hash_idx
  ON public.oauth_login_sessions (prev_refresh_token_hash) WHERE prev_refresh_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.exchange_mcp_oauth_credential(p_grant_type text, p_credential text, p_client_id text, p_redirect_uri text, p_challenge text, p_access_hash text, p_refresh_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s oauth_login_sessions%ROWTYPE; c oauth_authorization_codes%ROWTYPE; scopes text[]; key_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 IF p_access_hash !~ '^sha256_[a-f0-9]{64}$' OR p_refresh_hash !~ '^sha256_[a-f0-9]{64}$' OR p_access_hash IS NULL OR p_refresh_hash IS NULL THEN RAISE EXCEPTION 'Invalid credential hash'; END IF;
 IF p_grant_type='authorization_code' THEN
 SELECT * INTO c FROM oauth_authorization_codes WHERE code=p_credential FOR UPDATE;
 IF c.code IS NULL OR c.used_at IS NOT NULL OR c.expires_at IS NULL OR c.expires_at<=now() OR c.code_challenge IS NULL OR c.code_challenge='' OR p_challenge IS NULL OR c.client_id IS DISTINCT FROM p_client_id OR c.redirect_uri IS DISTINCT FROM p_redirect_uri OR c.code_challenge IS DISTINCT FROM p_challenge OR c.code_challenge_method IS DISTINCT FROM 'S256' OR c.login_session_id IS NULL THEN RAISE EXCEPTION 'Invalid authorization code' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM oauth_login_sessions WHERE session_id=c.login_session_id FOR UPDATE;
 IF c.user_id IS DISTINCT FROM s.user_id OR c.redirect_uri IS DISTINCT FROM s.redirect_uri OR c.scope IS DISTINCT FROM s.scope THEN RAISE EXCEPTION 'Authorization session binding mismatch' USING ERRCODE='42501'; END IF;
 ELSEIF p_grant_type='refresh_token' THEN
 SELECT * INTO s FROM oauth_login_sessions WHERE refresh_token_hash=p_credential FOR UPDATE;
 IF s.session_id IS NULL THEN
  -- The token replaced moments ago, presented again by a caller that raced the refresh that replaced it.
  SELECT * INTO s FROM oauth_login_sessions WHERE prev_refresh_token_hash=p_credential AND prev_refresh_rotated_at>now()-interval '2 minutes' FOR UPDATE;
  IF s.session_id IS NOT NULL AND s.revoked_at IS NULL AND s.client_id IS NOT DISTINCT FROM p_client_id AND s.refresh_token_hash=p_refresh_hash AND s.refresh_expires_at>now() THEN
   SELECT k.id,k.scopes INTO key_id,scopes FROM api_keys k WHERE k.id=s.access_key_id AND k.is_active=true AND k.key_hash=p_access_hash AND k.expires_at>now();
   IF key_id IS NOT NULL THEN RETURN jsonb_build_object('user_id',s.user_id,'key_id',key_id,'scopes',scopes,'replayed',true); END IF;
  END IF;
  RAISE EXCEPTION 'Invalid refresh token' USING ERRCODE='42501';
 END IF;
 IF s.refresh_expires_at<=now() OR s.refresh_expires_at IS NULL THEN RAISE EXCEPTION 'Invalid refresh token' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM api_keys WHERE id=s.access_key_id AND is_active=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Credential revoked' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported grant'; END IF;
 IF s.session_id IS NULL OR s.revoked_at IS NOT NULL OR s.client_id IS DISTINCT FROM p_client_id OR s.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM oauth_clients WHERE client_id=p_client_id AND token_endpoint_auth_method='none') OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=s.user_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'Invalid OAuth account or client' USING ERRCODE='42501'; END IF;
 scopes:=regexp_split_to_array(trim(coalesce(s.scope,'')),'\s+');
 SELECT array_agg(CASE x WHEN 'events:read' THEN 'events:read:all' WHEN 'events:write' THEN 'events:write:all' ELSE x END) INTO scopes FROM unnest(scopes) x;
 IF scopes IS NULL OR cardinality(scopes)=0 OR EXISTS(SELECT 1 FROM unnest(scopes) x WHERE x NOT IN ('read','write','stage_write','write:observations','mcp:tools','accounting:read','accounting:correct','events:read:all','events:write:all')) THEN RAISE EXCEPTION 'Unsupported OAuth scope' USING ERRCODE='42501'; END IF;
 IF s.access_key_id IS NOT NULL THEN UPDATE api_keys SET is_active=false WHERE id=s.access_key_id; END IF;
 INSERT INTO api_keys(user_id,name,key_hash,key_prefix,scopes,is_active,rate_limit_per_hour,rate_limit_remaining,expires_at) VALUES(s.user_id,'OAuth MCP connection',p_access_hash,'oauth',scopes,true,1000,1000,now()+interval '1 hour') RETURNING id INTO key_id;
 UPDATE oauth_login_sessions SET expires_at=now()+interval '90 days',access_key_id=key_id,refresh_token_hash=p_refresh_hash,refresh_expires_at=now()+interval '90 days',
  prev_refresh_token_hash=CASE WHEN p_grant_type='refresh_token' THEN p_credential END,
  prev_refresh_rotated_at=CASE WHEN p_grant_type='refresh_token' THEN now() END
  WHERE session_id=s.session_id;
 IF p_grant_type='authorization_code' THEN UPDATE oauth_authorization_codes SET used_at=now() WHERE code=c.code; END IF;
 RETURN jsonb_build_object('user_id',s.user_id,'key_id',key_id,'scopes',scopes);
END $function$;

CREATE OR REPLACE FUNCTION public.revoke_mcp_oauth_credential(p_token_hash text, p_client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s oauth_login_sessions%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 SELECT o.* INTO s FROM oauth_login_sessions o LEFT JOIN api_keys k ON k.id=o.access_key_id WHERE o.client_id=p_client_id AND (o.refresh_token_hash=p_token_hash OR o.prev_refresh_token_hash=p_token_hash OR k.key_hash=p_token_hash) FOR UPDATE OF o;
 IF s.session_id IS NOT NULL THEN UPDATE api_keys SET is_active=false WHERE id=s.access_key_id; UPDATE oauth_login_sessions SET revoked_at=now(),refresh_token_hash=NULL,prev_refresh_token_hash=NULL WHERE session_id=s.session_id; END IF;
END $function$;

REVOKE ALL ON FUNCTION public.revoke_mcp_oauth_credential(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_mcp_oauth_credential(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.exchange_mcp_oauth_credential(text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_mcp_oauth_credential(text,text,text,text,text,text,text) TO service_role;
