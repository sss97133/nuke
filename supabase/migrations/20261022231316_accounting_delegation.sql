BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
-- Reuse the reviewed revocable OAuth foundation; no receipt-store fork.
ALTER TABLE public.oauth_login_sessions ADD COLUMN IF NOT EXISTS access_key_id uuid REFERENCES public.api_keys(id), ADD COLUMN IF NOT EXISTS refresh_token_hash text, ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz, ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS oauth_login_sessions_refresh_hash_idx ON public.oauth_login_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
ALTER TABLE public.oauth_authorization_codes ADD COLUMN IF NOT EXISTS login_session_id text REFERENCES public.oauth_login_sessions(session_id);
CREATE OR REPLACE FUNCTION public.finish_mcp_oauth_login(p_session_id text,p_user_id uuid,p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s oauth_login_sessions%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM oauth_login_sessions WHERE session_id=p_session_id FOR UPDATE;
 SELECT * INTO u FROM auth.users WHERE id=p_user_id;
 IF s.session_id IS NULL OR s.completed_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=now() OR s.code_challenge IS NULL OR s.code_challenge='' OR u.id IS NULL OR u.email_confirmed_at IS NULL OR coalesce(u.is_anonymous,false) OR u.deleted_at IS NOT NULL OR u.banned_until>now() OR lower(u.email) IS DISTINCT FROM lower(s.email) THEN RAISE EXCEPTION 'Invalid login session' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM oauth_clients WHERE client_id=s.client_id AND s.redirect_uri=ANY(redirect_uris) AND token_endpoint_auth_method='none') OR s.code_challenge_method IS DISTINCT FROM 'S256' THEN RAISE EXCEPTION 'Invalid OAuth client'; END IF;
 INSERT INTO oauth_authorization_codes(code,client_id,user_id,redirect_uri,scope,code_challenge,code_challenge_method,expires_at,login_session_id) VALUES(p_code,s.client_id,u.id,s.redirect_uri,s.scope,s.code_challenge,'S256',now()+interval '10 minutes',s.session_id);
 UPDATE oauth_login_sessions SET completed_at=now(),user_id=u.id WHERE session_id=s.session_id;
 RETURN jsonb_build_object('redirect_uri',s.redirect_uri,'state',s.state,'client_id',s.client_id);
END $$;
CREATE OR REPLACE FUNCTION public.exchange_mcp_oauth_credential(p_grant_type text,p_credential text,p_client_id text,p_redirect_uri text,p_challenge text,p_access_hash text,p_refresh_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
 IF s.session_id IS NULL OR s.refresh_expires_at<=now() OR s.refresh_expires_at IS NULL THEN RAISE EXCEPTION 'Invalid refresh token' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM api_keys WHERE id=s.access_key_id AND is_active=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Credential revoked' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported grant'; END IF;
 IF s.session_id IS NULL OR s.revoked_at IS NOT NULL OR s.client_id IS DISTINCT FROM p_client_id OR s.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM oauth_clients WHERE client_id=p_client_id AND token_endpoint_auth_method='none') OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=s.user_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'Invalid OAuth account or client' USING ERRCODE='42501'; END IF;
 scopes:=regexp_split_to_array(trim(coalesce(s.scope,'')),'\s+');
 SELECT array_agg(CASE x WHEN 'events:read' THEN 'events:read:all' WHEN 'events:write' THEN 'events:write:all' ELSE x END) INTO scopes FROM unnest(scopes) x;
 IF scopes IS NULL OR cardinality(scopes)=0 OR EXISTS(SELECT 1 FROM unnest(scopes) x WHERE x NOT IN ('read','write','stage_write','write:observations','mcp:tools','accounting:read','accounting:correct','events:read:all','events:write:all')) THEN RAISE EXCEPTION 'Unsupported OAuth scope' USING ERRCODE='42501'; END IF;
 IF s.access_key_id IS NOT NULL THEN UPDATE api_keys SET is_active=false WHERE id=s.access_key_id; END IF;
 INSERT INTO api_keys(user_id,name,key_hash,key_prefix,scopes,is_active,rate_limit_per_hour,rate_limit_remaining,expires_at) VALUES(s.user_id,'OAuth MCP connection',p_access_hash,'oauth',scopes,true,1000,1000,now()+interval '1 hour') RETURNING id INTO key_id;
 UPDATE oauth_login_sessions SET expires_at=CASE WHEN p_grant_type='authorization_code' THEN now()+interval '30 days' ELSE refresh_expires_at END,access_key_id=key_id,refresh_token_hash=p_refresh_hash,refresh_expires_at=CASE WHEN p_grant_type='authorization_code' THEN now()+interval '30 days' ELSE refresh_expires_at END WHERE session_id=s.session_id;
 IF p_grant_type='authorization_code' THEN UPDATE oauth_authorization_codes SET used_at=now() WHERE code=c.code; END IF;
 RETURN jsonb_build_object('user_id',s.user_id,'key_id',key_id,'scopes',scopes);
END $$;
CREATE OR REPLACE FUNCTION public.revoke_mcp_oauth_credential(p_token_hash text,p_client_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s oauth_login_sessions%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 SELECT o.* INTO s FROM oauth_login_sessions o LEFT JOIN api_keys k ON k.id=o.access_key_id WHERE o.client_id=p_client_id AND (o.refresh_token_hash=p_token_hash OR k.key_hash=p_token_hash) FOR UPDATE OF o;
 IF s.session_id IS NOT NULL THEN UPDATE api_keys SET is_active=false WHERE id=s.access_key_id; UPDATE oauth_login_sessions SET revoked_at=now(),refresh_token_hash=NULL WHERE session_id=s.session_id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.finish_mcp_oauth_login(text,uuid,text),public.exchange_mcp_oauth_credential(text,text,text,text,text,text,text),public.revoke_mcp_oauth_credential(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_mcp_oauth_login(text,uuid,text),public.exchange_mcp_oauth_credential(text,text,text,text,text,text,text),public.revoke_mcp_oauth_credential(text,text) TO service_role;

-- An explicit account-to-account book grant; organization roles do not imply access.
CREATE TABLE public.accounting_access_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id),
 member_id uuid NOT NULL REFERENCES auth.users(id), can_correct boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true, approved_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz, UNIQUE(owner_id,member_id), CHECK(owner_id<>member_id)
);
ALTER TABLE public.accounting_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_access_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_access_grants TO authenticated;
CREATE POLICY accounting_grant_participant_read ON public.accounting_access_grants FOR SELECT TO authenticated
 USING (auth.uid() IN (owner_id,member_id));
GRANT ALL ON public.accounting_access_grants TO service_role;

CREATE FUNCTION public.set_accounting_access(p_member_id uuid,p_access text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner uuid:=auth.uid(); member uuid; grant_row accounting_access_grants%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR owner IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users WHERE id=owner AND email_confirmed_at IS NOT NULL AND is_anonymous IS NOT TRUE AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 THEN RAISE EXCEPTION 'Confirmed owner sign-in required' USING ERRCODE='42501'; END IF;
 IF p_access IS NULL OR p_access NOT IN ('review','correct','revoke') OR p_member_id IS NULL THEN RAISE EXCEPTION 'Invalid accounting access request'; END IF;
 member:=p_member_id;
 IF member=owner THEN RAISE EXCEPTION 'A different account is required'; END IF;
 IF p_access<>'revoke' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=member AND email_confirmed_at IS NOT NULL AND is_anonymous IS NOT TRUE AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'A confirmed active account is required'; END IF;
 IF p_access='revoke' THEN
  UPDATE accounting_access_grants SET active=false,revoked_at=now() WHERE owner_id=owner AND member_id=member RETURNING * INTO grant_row;
  IF grant_row.id IS NULL THEN RAISE EXCEPTION 'No accounting grant for this account'; END IF;
 ELSE
  INSERT INTO accounting_access_grants(owner_id,member_id,can_correct) VALUES(owner,member,p_access='correct')
  ON CONFLICT(owner_id,member_id) DO UPDATE SET can_correct=EXCLUDED.can_correct,active=true,approved_at=now(),revoked_at=NULL RETURNING * INTO grant_row;
 END IF;
 INSERT INTO api_usage_logs(user_id,resource,action,resource_id) VALUES(owner,'accounting_access',p_access,grant_row.id::text);
 RETURN to_jsonb(grant_row);
END $$;
REVOKE ALL ON FUNCTION public.set_accounting_access(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_accounting_access(uuid,text) TO authenticated;

-- Key and grant are locked in the same transaction as correction admission. Revocation
-- serializes against that admission; already-delivered private bytes cannot be recalled.
CREATE FUNCTION public.authorize_financial_access(p_actor_id uuid,p_owner_id uuid,p_key_id uuid,p_operation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k api_keys%ROWTYPE; g accounting_access_grants%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor_id IS NULL OR p_owner_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('read','correct') THEN RAISE EXCEPTION 'Invalid accounting authority' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id AND email_confirmed_at IS NOT NULL AND is_anonymous IS NOT TRUE AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 IF p_key_id IS NOT NULL THEN
  SELECT * INTO k FROM api_keys WHERE id=p_key_id FOR SHARE;
  IF k.id IS NULL OR k.user_id IS DISTINCT FROM p_actor_id OR k.is_active IS DISTINCT FROM true OR (k.expires_at IS NOT NULL AND k.expires_at<=now()) OR NOT coalesce(('accounting:'||p_operation)=ANY(k.scopes),false) THEN RAISE EXCEPTION 'Accounting credential refused' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_actor_id<>p_owner_id THEN
  SELECT * INTO g FROM accounting_access_grants WHERE owner_id=p_owner_id AND member_id=p_actor_id FOR SHARE;
  IF g.id IS NULL OR NOT g.active OR (p_operation='correct' AND NOT g.can_correct) THEN RAISE EXCEPTION 'Owner accounting grant required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN jsonb_build_object('actor_user_id',p_actor_id,'owner_user_id',p_owner_id,'grant_id',g.id,'key_id',p_key_id,'operation',p_operation,'allowed',true);
END $$;
REVOKE ALL ON FUNCTION public.authorize_financial_access(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_financial_access(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.read_financial_access_context(p_actor_id uuid,p_key_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM authorize_financial_access(p_actor_id,p_actor_id,p_key_id,'read');
 SELECT coalesce(jsonb_agg(jsonb_build_object('owner_user_id',g.owner_id,'grant_id',g.id,'can_correct',g.can_correct) ORDER BY g.owner_id),'[]') INTO result
 FROM accounting_access_grants g WHERE g.member_id=p_actor_id AND g.active;
 RETURN jsonb_build_object('actor_user_id',p_actor_id,'own_book_owner_id',p_actor_id,'shared_books',result,
 'contract','financial_evidence_v1','canonical_store',jsonb_build_array('financial_documents','financial_document_extractions','financial_document_lines'),
 'correction_basis','Full current-document snapshot, supersedes_run_id and attributed evidence; original and prior runs retained',
 'authority','Review and correction only; no SQL, schema, filing, signing, payments or owner impersonation');
END $$;
REVOKE ALL ON FUNCTION public.read_financial_access_context(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_financial_access_context(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_financial_evidence(
  p_owner_id uuid, p_original jsonb, p_revision jsonb, p_actor_context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  doc public.financial_documents%ROWTYPE;
  v_run uuid := gen_random_uuid();
  v_prior uuid;
  v_key text := p_revision->>'idempotency_key';
  v_digest text := encode(extensions.digest(p_original::text || p_revision::text,'sha256'),'hex');
  v_runs jsonb;
  v_old jsonb;
  v_cell jsonb;
  v_concern jsonb;
  v_id uuid;
  v_cells jsonb := '[]';
  v_reviews jsonb := '[]';
  v_receipt jsonb;
  v_part jsonb;
  v_actor uuid := coalesce((p_actor_context->>'actor_user_id')::uuid,p_owner_id);
  v_authority jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' OR p_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND is_anonymous IS NOT TRUE AND (banned_until IS NULL OR banned_until<=now())
  ) THEN RAISE EXCEPTION 'authenticated account required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_actor_context) IS DISTINCT FROM 'object'
    OR octet_length(p_actor_context::text)>500
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_actor_context) k WHERE k NOT IN ('kind','agent_id','actor_user_id','owner_user_id','grant_id','key_id'))
    OR (p_actor_context->>'kind' IS NOT NULL AND p_actor_context->>'kind' NOT IN ('user','api_key'))
    OR (p_actor_context->>'agent_id' IS NOT NULL AND p_actor_context->>'agent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'invalid verified actor context'; END IF;
  IF p_actor_context ? 'actor_user_id' THEN
    v_authority := authorize_financial_access(v_actor,p_owner_id,(p_actor_context->>'key_id')::uuid,'correct');
    IF p_actor_context->>'owner_user_id' IS DISTINCT FROM p_owner_id::text
      OR p_actor_context->>'grant_id' IS DISTINCT FROM v_authority->>'grant_id'
      OR (p_actor_context->>'kind'='api_key' AND p_actor_context->>'key_id' IS NULL)
      OR (p_actor_context->>'kind'='user' AND p_actor_context->>'key_id' IS NOT NULL)
    THEN RAISE EXCEPTION 'Verified accounting authority mismatch' USING ERRCODE='42501'; END IF;
  ELSIF p_actor_context ?| array['owner_user_id','grant_id','key_id'] THEN
    RAISE EXCEPTION 'Incomplete verified accounting authority' USING ERRCODE='42501';
  END IF;
  IF p_original IS NULL OR p_revision IS NULL OR jsonb_typeof(p_original)<>'object' OR jsonb_typeof(p_revision)<>'object'
    OR octet_length(p_original::text || p_revision::text)>250000
    OR coalesce(p_original->>'sha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_original->>'storage_path','') NOT LIKE p_owner_id::text || '/%'
    OR position('..' in p_original->>'storage_path')>0
    OR length(p_original->>'storage_path')>600 OR length(p_original->>'source_filename')>255
    OR coalesce(p_original->>'byte_size','') !~ '^[0-9]+$'
    OR (p_original->>'byte_size')::bigint NOT BETWEEN 1 AND 10485760
    OR coalesce(length(v_key),0) NOT BETWEEN 1 AND 200
    OR coalesce(length(p_revision->>'method'),0) NOT BETWEEN 1 AND 120
    OR coalesce(length(p_revision->>'version'),0) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(p_revision->'fields') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_revision->'fields') NOT BETWEEN 1 AND 100
    OR jsonb_typeof(coalesce(p_revision->'concerns','[]')) IS DISTINCT FROM 'array'
    OR jsonb_array_length(coalesce(p_revision->'concerns','[]')) > 30
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_original) k WHERE k NOT IN ('sha256','storage_path','source_filename','source_kind','byte_size'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_revision) k WHERE k NOT IN ('idempotency_key','method','version','fields','concerns','supersedes_run_id','lines','accounting_records'))
  THEN RAISE EXCEPTION 'invalid financial evidence envelope'; END IF;
  FOR v_part IN SELECT jsonb_path_query(p_revision, '$.**') LOOP
    IF (jsonb_typeof(v_part)='string' AND (length(v_part #>> '{}')>2000
          OR (v_part #>> '{}') ~ '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}'))
      OR (jsonb_typeof(v_part)='object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(v_part) k
        WHERE lower(k) IN ('ocr_text','raw_text','full_ocr','full_text','iban','bank_iban','full_iban')))
    THEN RAISE EXCEPTION 'full OCR and financial identifiers must remain local'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || (p_original->>'sha256'),0));
  SELECT * INTO doc FROM financial_documents WHERE owner_id=p_owner_id AND content_sha256=p_original->>'sha256'
    AND logical_index=1 ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF doc.id IS NOT NULL AND doc.attributes->>'intake_mode' IS DISTINCT FROM 'financial_evidence_v1' THEN
    RAISE EXCEPTION 'existing original requires explicit migration review';
  END IF;
  IF v_actor<>p_owner_id AND (doc.id IS NULL OR p_revision->>'supersedes_run_id' IS NULL
    OR doc.storage_path IS DISTINCT FROM p_original->>'storage_path') THEN
    RAISE EXCEPTION 'Delegated correction requires the existing original and current revision' USING ERRCODE='42501';
  END IF;
  IF doc.id IS NULL THEN
    INSERT INTO financial_documents(owner_id,content_sha256,storage_path,source_filename,source_kind,byte_size,
      doc_type,extraction_status,review_status,privacy_tier,attributes)
    VALUES(p_owner_id,p_original->>'sha256',p_original->>'storage_path',p_original->>'source_filename',
      coalesce(p_original->>'source_kind','upload'),(p_original->>'byte_size')::bigint,
      'unclassified','extracted','needs_review','private',jsonb_build_object('intake_mode','financial_evidence_v1','expense_posted',false,'runs','[]'::jsonb))
    RETURNING * INTO doc;
  END IF;
  v_runs := doc.attributes->'runs';
  SELECT x INTO v_old FROM jsonb_array_elements(v_runs) x WHERE x->>'key'=v_key;
  IF v_old IS NOT NULL THEN
    IF v_old->>'digest'<>v_digest THEN RAISE EXCEPTION 'idempotency key payload conflict'; END IF;
    RETURN (v_old->'receipt') || jsonb_build_object('duplicate',true);
  END IF;
  IF jsonb_array_length(v_runs)>=100 THEN RAISE EXCEPTION 'revision limit requires review'; END IF;
  IF p_revision->>'supersedes_run_id' IS NOT NULL THEN
    v_prior := (p_revision->>'supersedes_run_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) x WHERE x->>'run_id'=v_prior::text)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) x WHERE x->>'supersedes_run_id'=v_prior::text)
    THEN RAISE EXCEPTION 'correction must name a current revision of this original'; END IF;
  ELSIF jsonb_array_length(v_runs)>0 THEN
    RAISE EXCEPTION 'existing original requires explicit revision supersession';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_revision->'fields')) <>
     (SELECT count(DISTINCT x->>'field_key') FROM jsonb_array_elements(p_revision->'fields') x)
  THEN RAISE EXCEPTION 'duplicate field keys'; END IF;
  IF v_prior IS NOT NULL AND (
    EXISTS (SELECT field_key FROM financial_document_extractions WHERE extraction_run_id=v_prior AND document_id=doc.id
      EXCEPT SELECT x->>'field_key' FROM jsonb_array_elements(p_revision->'fields') x)
  ) THEN RAISE EXCEPTION 'correction requires the complete prior field set'; END IF;
  FOR v_cell IN SELECT x FROM jsonb_array_elements(p_revision->'fields') x LOOP
    IF jsonb_typeof(v_cell)<>'object' OR coalesce(length(v_cell->>'field_key'),0) NOT BETWEEN 1 AND 160
      OR coalesce(length(v_cell->>'value_raw'),0) NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(v_cell->'evidence') IS DISTINCT FROM 'object' OR v_cell->'evidence'='{}'::jsonb
      OR octet_length(coalesce(v_cell->'value_normalized','null')::text)>4000
      OR octet_length(coalesce(v_cell->'evidence','null')::text)>4000
      OR lower(v_cell->>'field_key') IN ('ocr_text','raw_text','full_ocr','full_text','redacted_source')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_cell) k WHERE k NOT IN ('field_key','value_raw','value_normalized','value_type','page_number','evidence'))
    THEN RAISE EXCEPTION 'only bounded attributed cells allowed'; END IF;
    INSERT INTO financial_document_extractions(owner_id,document_id,field_key,value_raw,value_normalized,value_type,
      page_number,extractor,extractor_model,extraction_run_id,privacy_tier)
    VALUES(p_owner_id,doc.id,v_cell->>'field_key',v_cell->>'value_raw',
      jsonb_build_object('value',v_cell->'value_normalized','evidence',v_cell->'evidence','method',p_revision->>'method',
        'version',p_revision->>'version','actor_user_id',v_actor,'auth_context',p_actor_context,'original_sha256',p_original->>'sha256'),
      coalesce(v_cell->>'value_type','text'),(v_cell->>'page_number')::integer,
      p_revision->>'method',p_revision->>'version',v_run,'private') RETURNING id INTO v_id;
    v_cells := v_cells || to_jsonb(v_id);
  END LOOP;
  FOR v_concern IN SELECT x FROM jsonb_array_elements(coalesce(p_revision->'concerns','[]')) x LOOP
    IF coalesce(length(v_concern->>'resolver'),0) NOT BETWEEN 1 AND 120
      OR coalesce(length(v_concern->>'detail'),0)>2000
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_concern) k WHERE k NOT IN ('concern_type','priority','detail','resolver'))
    THEN RAISE EXCEPTION 'invalid review concern'; END IF;
    INSERT INTO financial_review_queue(owner_id,document_id,concern_type,priority,detail,resolver,confidence_factors)
    VALUES(p_owner_id,doc.id,v_concern->>'concern_type',coalesce(v_concern->>'priority','medium'),
      v_concern->>'detail',v_concern->>'resolver',jsonb_build_object('extraction_run_id',v_run,'method',p_revision->>'method',
        'version',p_revision->>'version','original_sha256',p_original->>'sha256','actor_user_id',v_actor,'auth_context',p_actor_context))
    RETURNING id INTO v_id;
    v_reviews := v_reviews || to_jsonb(v_id);
  END LOOP;
  PERFORM public.project_financial_document_lines(p_owner_id,doc.id,v_run,p_revision->'lines',v_prior);
  PERFORM public.project_financial_accounting_records(p_owner_id,doc.id,v_run,p_revision->'accounting_records',v_prior);
  -- Only the existing supersession stamps change; original cells remain intact.
  IF v_prior IS NOT NULL THEN
    UPDATE financial_document_extractions old SET is_superseded=true,superseded_at=now(),superseded_by=new.id
      FROM financial_document_extractions new
      WHERE old.owner_id=p_owner_id AND old.document_id=doc.id AND old.extraction_run_id=v_prior AND NOT old.is_superseded
        AND new.document_id=doc.id AND new.extraction_run_id=v_run AND new.field_key=old.field_key;
  END IF;
  v_receipt := jsonb_build_object('document_id',doc.id,'extraction_run_id',v_run,'extraction_ids',v_cells,
    'review_ids',v_reviews,'duplicate',false,'expense_posted',false);
  UPDATE financial_documents SET attributes=attributes || jsonb_build_object('runs',v_runs || jsonb_build_array(
    jsonb_build_object('run_id',v_run,'key',v_key,'digest',v_digest,'supersedes_run_id',v_prior,'receipt',v_receipt,'actor_user_id',v_actor,'auth_context',p_actor_context))),
    review_status='needs_review' WHERE id=doc.id AND owner_id=p_owner_id;
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb) TO service_role;
COMMENT ON FUNCTION public.ingest_financial_evidence(uuid,jsonb,jsonb,jsonb) IS 'ingest-observation financial_evidence_v1 service admission after account authentication and original SHA verification; evidence only, never posts expenses';



CREATE FUNCTION public.find_accounting_member(p_lookup text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE matches jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND is_anonymous IS NOT TRUE AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'Confirmed sign-in required' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_lookup,''))) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'Exact username or email required'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',u.id,'email',CASE WHEN lower(u.email)=lower(btrim(p_lookup)) THEN u.email ELSE left(u.email,1)||'•••@•••' END,'username',p.username,'full_name',p.full_name)) INTO matches
 FROM auth.users u LEFT JOIN profiles p ON p.id=u.id
 WHERE (lower(u.email)=lower(btrim(p_lookup)) OR lower(p.username)=lower(btrim(p_lookup)))
 AND u.id<>auth.uid() AND u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS NOT TRUE AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now());
 IF coalesce(jsonb_array_length(matches),0)<>1 THEN RAISE EXCEPTION 'One confirmed existing account must match'; END IF;
 RETURN matches->0;
END $$;
REVOKE ALL ON FUNCTION public.find_accounting_member(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_accounting_member(text) TO authenticated;

-- Browser reads remain tied to the signed-in identity and a current explicit grant.
-- No storage policy is broadened: shared bytes use the checked evidence endpoint.
CREATE FUNCTION public.can_read_accounting_owner(p_owner_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.role()='authenticated' AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND is_anonymous IS NOT TRUE AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 AND EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 AND EXISTS(SELECT 1 FROM accounting_access_grants WHERE owner_id=p_owner_id AND member_id=auth.uid() AND active)
$$;
REVOKE ALL ON FUNCTION public.can_read_accounting_owner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_accounting_owner(uuid) TO authenticated;
CREATE POLICY financial_documents_delegate_read ON public.financial_documents FOR SELECT TO authenticated USING(public.can_read_accounting_owner(owner_id));
CREATE POLICY financial_extractions_delegate_read ON public.financial_document_extractions FOR SELECT TO authenticated USING(public.can_read_accounting_owner(owner_id));
CREATE POLICY financial_lines_delegate_read ON public.financial_document_lines FOR SELECT TO authenticated USING(public.can_read_accounting_owner(owner_id));
CREATE POLICY financial_concerns_delegate_read ON public.financial_review_queue FOR SELECT TO authenticated USING(public.can_read_accounting_owner(owner_id));

CREATE FUNCTION public.list_accounting_access() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND is_anonymous IS NOT TRUE AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'Confirmed sign-in required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('owner_name',coalesce(op.full_name,op.username,'Shared book'),'member_name',coalesce(mp.full_name,mp.username,'Existing account'),'member_email',left(mu.email,1)||'•••@•••')),'[]') INTO result
 FROM accounting_access_grants g JOIN auth.users mu ON mu.id=g.member_id LEFT JOIN profiles op ON op.id=g.owner_id LEFT JOIN profiles mp ON mp.id=g.member_id
 WHERE auth.uid() IN (g.owner_id,g.member_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_accounting_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_accounting_access() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
