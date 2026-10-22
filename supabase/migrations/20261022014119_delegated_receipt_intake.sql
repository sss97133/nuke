BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
-- Account membership is authority. Keys only authenticate and attenuate it.
ALTER TABLE public.organization_contributors DROP CONSTRAINT organization_contributors_role_check;
ALTER TABLE public.organization_contributors ADD CONSTRAINT organization_contributors_role_check CHECK (role IN ('owner','co_founder','board_member','manager','employee','technician','contractor','moderator','contributor','photographer','historian','accountant'));
ALTER TABLE public.api_usage_logs ADD COLUMN IF NOT EXISTS participation_context jsonb;

CREATE OR REPLACE FUNCTION public.accounting_org_owner(p_user_id uuid,p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_user_id IS NOT NULL AND p_organization_id IS NOT NULL AND (
 EXISTS (SELECT 1 FROM business_ownership WHERE owner_id=p_user_id AND business_id=p_organization_id AND status='active') OR
 EXISTS (SELECT 1 FROM organization_contributors WHERE user_id=p_user_id AND organization_id=p_organization_id AND status='active' AND role IN ('owner','co_founder') AND verification_method='owner_approval' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND (end_date IS NULL OR end_date>=CURRENT_DATE)));
$$;
REVOKE ALL ON FUNCTION public.accounting_org_owner(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accounting_membership_context(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m organization_contributors%ROWTYPE; u uuid:=auth.uid();
BEGIN
 IF u IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM organization_contributors WHERE user_id=u AND organization_id=p_organization_id;
 RETURN jsonb_build_object('can_review',accounting_org_owner(u,p_organization_id),'membership_id',m.id,'status',m.status,'role',m.role);
END $$;

CREATE OR REPLACE FUNCTION public.request_accounting_membership(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m organization_contributors%ROWTYPE; u uuid:=auth.uid();
BEGIN
 IF u IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 INSERT INTO organization_contributors(organization_id,user_id,role,status,verification_method,actor_type)
 VALUES(p_organization_id,u,'accountant','pending','self_claimed','user') ON CONFLICT(organization_id,user_id) DO NOTHING;
 SELECT * INTO m FROM organization_contributors WHERE organization_id=p_organization_id AND user_id=u FOR UPDATE;
 IF m.role<>'accountant' THEN RAISE EXCEPTION 'Existing membership requires owner review' USING ERRCODE='22023'; END IF;
 -- A revoked membership cannot reactivate itself; the owner must approve again.
 INSERT INTO api_usage_logs(user_id,resource,action,resource_id,participation_context) VALUES(u,'organization_membership','accounting_request',m.id::text,jsonb_build_object('organization_id',p_organization_id,'membership_id',m.id));
 RETURN jsonb_build_object('membership_id',m.id,'status',m.status,'role',m.role);
END $$;

CREATE OR REPLACE FUNCTION public.review_accounting_membership(p_membership_id uuid,p_action text,p_authorization_text text DEFAULT NULL,p_agent_session text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m organization_contributors%ROWTYPE; u uuid:=auth.uid(); old_status text;
BEGIN
 IF auth.role()='service_role' THEN
   u:=owner_delegation_owner_id();
   IF coalesce(length(btrim(p_authorization_text)),0) NOT BETWEEN 10 AND 10000 OR coalesce(length(btrim(p_agent_session)),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Recorded owner authorization required' USING ERRCODE='42501'; END IF;
 ELSIF auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'Owner authentication required' USING ERRCODE='42501'; END IF;
 IF u IS NULL OR p_action IS NULL OR p_action NOT IN ('approve','revoke') THEN RAISE EXCEPTION 'Invalid membership review' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM organization_contributors WHERE id=p_membership_id FOR UPDATE;
 IF m.id IS NULL OR m.role<>'accountant' OR NOT accounting_org_owner(u,m.organization_id) OR m.user_id=u THEN RAISE EXCEPTION 'Organization owner required' USING ERRCODE='42501'; END IF;
 IF p_action='approve' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=m.user_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 old_status:=m.status;
 UPDATE organization_contributors SET status=CASE WHEN p_action='approve' THEN 'active' ELSE 'inactive' END,verification_method='owner_approval',verified_by=u,verified_at=now(),updated_at=now(),end_date=CASE WHEN p_action='approve' THEN NULL ELSE CURRENT_DATE END WHERE id=m.id RETURNING * INTO m;
 INSERT INTO api_usage_logs(user_id,resource,action,resource_id,participation_context) VALUES(u,'organization_membership','accounting_'||p_action,m.id::text,jsonb_build_object('organization_id',m.organization_id,'membership_id',m.id,'participant_user_id',m.user_id,'previous_status',old_status,'status',m.status));
 IF auth.role()='service_role' THEN PERFORM owner_delegated_sign_register('review_accounting_membership',jsonb_build_object('organization_id',m.organization_id,'membership_id',m.id,'action',p_action),m.id::text,p_authorization_text,p_agent_session,now()); END IF;
 RETURN jsonb_build_object('membership_id',m.id,'status',m.status,'role',m.role);
END $$;

CREATE OR REPLACE FUNCTION public.check_receipt_intake_access(p_key_id uuid,p_user_id uuid,p_owner_user_id uuid,p_organization_id uuid,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k api_keys%ROWTYPE; m organization_contributors%ROWTYPE; required_scope text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service authentication required' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL OR p_owner_user_id IS NULL OR p_organization_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('upload','submit','read') THEN RAISE EXCEPTION 'Invalid receipt access context' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 IF p_key_id IS NOT NULL THEN
 SELECT * INTO k FROM api_keys WHERE id=p_key_id FOR SHARE;
 required_scope:=CASE WHEN p_operation='read' THEN 'read' ELSE 'write' END;
 IF k.id IS NULL OR k.user_id IS DISTINCT FROM p_user_id OR k.is_active IS DISTINCT FROM true OR (k.expires_at IS NOT NULL AND k.expires_at<=now()) OR NOT coalesce(k.scopes && ARRAY[required_scope,'receipts:'||p_operation],false) THEN RAISE EXCEPTION 'API key not authorized' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO m FROM organization_contributors WHERE organization_id=p_organization_id AND user_id=p_user_id FOR SHARE;
 IF NOT accounting_org_owner(p_user_id,p_organization_id) AND (m.id IS NULL OR m.status IS DISTINCT FROM 'active' OR m.role NOT IN ('accountant','owner','co_founder','manager') OR m.verification_method IS DISTINCT FROM 'owner_approval' OR m.verified_by IS NULL OR m.verified_at IS NULL OR (m.end_date IS NOT NULL AND m.end_date<CURRENT_DATE)) THEN RAISE EXCEPTION 'Active owner-approved accounting membership required' USING ERRCODE='42501'; END IF;
 IF NOT accounting_org_owner(p_owner_user_id,p_organization_id) THEN RAISE EXCEPTION 'Profile owner does not own organization' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('allowed',true,'membership_id',m.id,'owner_user_id',p_owner_user_id,'organization_id',p_organization_id,'actor_user_id',p_user_id,'role',CASE WHEN accounting_org_owner(p_user_id,p_organization_id) THEN 'owner' ELSE m.role END);
END $$;

CREATE OR REPLACE FUNCTION public.record_receipt_participation(p_key_id uuid,p_user_id uuid,p_owner_user_id uuid,p_organization_id uuid,p_operation text,p_target jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c jsonb; result_id uuid; key_name text;
BEGIN
 c:=check_receipt_intake_access(p_key_id,p_user_id,p_owner_user_id,p_organization_id,p_operation);
 IF p_target IS NULL OR jsonb_typeof(p_target)<>'object' OR octet_length(p_target::text)>4000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_target) x WHERE x NOT IN ('document_id','observation_id','sha256','status','extraction_method','artifact_id','storage_path')) THEN RAISE EXCEPTION 'Invalid participation target'; END IF;
 SELECT name INTO key_name FROM api_keys WHERE id=p_key_id;
 INSERT INTO api_usage_logs(user_id,api_key_id,resource,action,resource_id,participation_context) VALUES(p_user_id,p_key_id,'receipt_intake',p_operation,coalesce(p_target->>'document_id',p_target->>'artifact_id'),c||jsonb_build_object('target',p_target,'api_key_id',p_key_id,'api_key_name',key_name)) RETURNING id INTO result_id;
 RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.accounting_membership_context(uuid),public.request_accounting_membership(uuid),public.review_accounting_membership(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_membership_context(uuid),public.request_accounting_membership(uuid),public.review_accounting_membership(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.check_receipt_intake_access(uuid,uuid,uuid,uuid,text),public.record_receipt_participation(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_receipt_intake_access(uuid,uuid,uuid,uuid,text),public.record_receipt_participation(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.review_accounting_membership(uuid,text,text,text) TO service_role;

-- A legacy membership INSERT policy accepts any active owner, including self-claimed
-- rows. Authority-bearing attestations must be signed by an actual authorized owner.
CREATE FUNCTION public.guard_accounting_membership_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; protected_change boolean;
BEGIN
 IF TG_OP='INSERT' THEN
   protected_change:=NEW.verification_method='owner_approval';
 ELSE
   protected_change:=(OLD.verification_method='owner_approval' OR NEW.verification_method='owner_approval')
     AND ROW(NEW.organization_id,NEW.user_id,NEW.role,NEW.status,NEW.verification_method,NEW.verified_by,NEW.verified_at,NEW.end_date)
       IS DISTINCT FROM ROW(OLD.organization_id,OLD.user_id,OLD.role,OLD.status,OLD.verification_method,OLD.verified_by,OLD.verified_at,OLD.end_date);
 END IF;
 IF coalesce(protected_change,false) THEN
   actor:=CASE WHEN auth.role()='service_role' THEN public.owner_delegation_owner_id() ELSE auth.uid() END;
   IF (auth.role() IS DISTINCT FROM 'authenticated' AND auth.role() IS DISTINCT FROM 'service_role') OR actor IS NULL
      OR NOT public.accounting_org_owner(actor,NEW.organization_id)
      OR (TG_OP='UPDATE' AND NOT public.accounting_org_owner(actor,OLD.organization_id))
      OR (NEW.verification_method='owner_approval' AND (NEW.verified_by IS DISTINCT FROM actor OR NEW.verified_at IS NULL)) THEN
     RAISE EXCEPTION 'Only an authorized organization owner may attest membership authority' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_accounting_membership_authority() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER accounting_membership_authority BEFORE INSERT OR UPDATE ON public.organization_contributors
 FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_membership_authority();

-- Reuse the existing OAuth login session as the revocable credential family.
ALTER TABLE public.oauth_login_sessions ADD COLUMN IF NOT EXISTS access_key_id uuid REFERENCES public.api_keys(id), ADD COLUMN IF NOT EXISTS refresh_token_hash text, ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz, ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS oauth_login_sessions_refresh_hash_idx ON public.oauth_login_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
ALTER TABLE public.oauth_authorization_codes ADD COLUMN IF NOT EXISTS login_session_id text REFERENCES public.oauth_login_sessions(session_id);
CREATE OR REPLACE FUNCTION public.finish_mcp_oauth_login(p_session_id text,p_user_id uuid,p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s oauth_login_sessions%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM oauth_login_sessions WHERE session_id=p_session_id FOR UPDATE;
 SELECT * INTO u FROM auth.users WHERE id=p_user_id;
 IF s.session_id IS NULL OR s.completed_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=now() OR s.code_challenge IS NULL OR s.code_challenge='' OR u.id IS NULL OR u.email_confirmed_at IS NULL OR coalesce(u.is_anonymous,false) OR lower(u.email) IS DISTINCT FROM lower(s.email) THEN RAISE EXCEPTION 'Invalid login session' USING ERRCODE='42501'; END IF;
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
 IF s.session_id IS NULL OR s.revoked_at IS NOT NULL OR s.client_id IS DISTINCT FROM p_client_id OR s.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM oauth_clients WHERE client_id=p_client_id AND token_endpoint_auth_method='none') OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=s.user_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'Invalid OAuth account or client' USING ERRCODE='42501'; END IF;
 scopes:=regexp_split_to_array(trim(coalesce(s.scope,'')),'\s+');
 SELECT array_agg(CASE x WHEN 'events:read' THEN 'events:read:all' WHEN 'events:write' THEN 'events:write:all' ELSE x END) INTO scopes FROM unnest(scopes) x;
 IF scopes IS NULL OR cardinality(scopes)=0 OR EXISTS(SELECT 1 FROM unnest(scopes) x WHERE x NOT IN ('read','write','stage_write','write:observations','mcp:tools','receipts:read','receipts:submit','receipts:upload','events:read:all','events:write:all')) THEN RAISE EXCEPTION 'Unsupported OAuth scope' USING ERRCODE='42501'; END IF;
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

-- Existing canonical intake owns registration + attributed extraction atomically.
UPDATE public.observation_sources SET species='owner_private', species_set=ARRAY['owner_private']::public.source_species[],
 species_evidence=jsonb_build_object('examined_at','2026-10-22','examined',jsonb_build_array('retained private receipt images and OCR handoff'),
 'seen','Owner-private receipts, returns and deal recaps; original image bytes retained; no public publication',
 'doc','docs/ledger/RECEIPT_INTAKE.md','extractor','receipt_evidence_v1','listing_rule','not a listing source')
 WHERE slug='receipt-scan' AND species IS NULL;

CREATE INDEX IF NOT EXISTS secure_documents_owner_hash ON public.secure_documents(user_id,file_hash);
CREATE INDEX receipt_intake_context ON public.artifact_dispatch_log
 ((artifact_payload->>'owner_user_id'),(artifact_payload->>'organization_id'),submitted_at DESC,id)
 WHERE handler='receipt_evidence_v1';

CREATE FUNCTION public.ingest_receipt_evidence(p_key_id uuid,p_user_id uuid,p_owner_user_id uuid,p_organization_id uuid,
 p_original jsonb,p_extraction jsonb,p_supersedes_artifact_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE access_context jsonb; payload jsonb; fingerprint text; source_key uuid; doc_id uuid;
 artifact_id uuid; observation_id uuid; original_hash text:=p_original->>'sha256';
 object_path text:=p_original->>'storage_path'; ext text; prior public.artifact_dispatch_log; received timestamptz:=clock_timestamp();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service invocation required'; END IF;
 access_context:=public.check_receipt_intake_access(p_key_id,p_user_id,p_owner_user_id,p_organization_id,'submit');
 IF access_context->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'accounting membership required'; END IF;
 IF original_hash IS NULL OR original_hash !~ '^[0-9a-f]{64}$' OR p_original->>'bucket' IS DISTINCT FROM 'user-documents'
   OR coalesce((p_original->>'file_size')::integer,0) NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'invalid original'; END IF;
 ext:=CASE p_original->>'mime_type' WHEN 'image/jpeg' THEN 'jpeg' WHEN 'image/png' THEN 'png' WHEN 'application/pdf' THEN 'pdf' END;
 IF ext IS NULL OR object_path IS DISTINCT FROM p_owner_user_id::text||'/receipt-originals/sha256/'||original_hash||'.'||ext THEN RAISE EXCEPTION 'original outside accounting owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='user-documents' AND public IS FALSE) OR
 NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='user-documents' AND name=object_path
   AND (metadata->>'size')::bigint=(p_original->>'file_size')::bigint) THEN RAISE EXCEPTION 'private original missing'; END IF;
 IF jsonb_typeof(p_extraction) IS DISTINCT FROM 'object' OR jsonb_typeof(p_extraction->'fields') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_extraction->'raw_text') IS DISTINCT FROM 'string'
   OR coalesce(length(btrim(p_extraction->>'method')),0)=0 OR coalesce(length(btrim(p_extraction->>'version')),0)=0
   OR length(p_extraction::text)>500000 THEN RAISE EXCEPTION 'invalid extraction'; END IF;
 SELECT id INTO source_key FROM public.observation_sources WHERE slug='receipt-scan' AND species='owner_private';
 IF source_key IS NULL THEN RAISE EXCEPTION 'private receipt source unavailable'; END IF;
 IF p_supersedes_artifact_id IS NOT NULL THEN
   SELECT * INTO prior FROM public.artifact_dispatch_log WHERE id=p_supersedes_artifact_id AND handler='receipt_evidence_v1'
     AND artifact_payload->>'owner_user_id'=p_owner_user_id::text AND artifact_payload->>'organization_id'=p_organization_id::text;
   IF NOT FOUND OR prior.artifact_payload#>>'{original,sha256}' IS DISTINCT FROM original_hash THEN RAISE EXCEPTION 'correction must cite same-context original'; END IF;
 END IF;
 -- The hash names a submission, including its actor and accounting context, not a purchase.
 payload:=jsonb_build_object('contract','receipt_evidence_v1','owner_user_id',p_owner_user_id,'organization_id',p_organization_id,
  'contributor_user_id',p_user_id,'original',p_original,'extraction',p_extraction,'supersedes_artifact_id',p_supersedes_artifact_id);
 fingerprint:=encode(extensions.digest(payload::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt-submission:'||fingerprint,0));
 SELECT * INTO prior FROM public.artifact_dispatch_log WHERE content_sha256=fingerprint AND kind='receipt';
 IF FOUND THEN
   IF prior.handler IS DISTINCT FROM 'receipt_evidence_v1' OR prior.artifact_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'submission identity conflict'; END IF;
   PERFORM public.record_receipt_participation(p_key_id,p_user_id,p_owner_user_id,p_organization_id,'submit',jsonb_build_object('artifact_id',prior.id,'observation_id',prior.observation_ids[1],'sha256',original_hash,'status','duplicate'));
   RETURN jsonb_build_object('artifact_id',prior.id,'observation_id',prior.observation_ids[1],
     'document_id',(SELECT citation_secure_document_id FROM public.vehicle_observations WHERE id=prior.observation_ids[1]),
     'status','captured_needs_review','duplicate',true,'expense_posted',false);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('receipt-original:'||p_owner_user_id::text||':'||original_hash,0));
 SELECT id INTO doc_id FROM public.secure_documents WHERE user_id=p_owner_user_id AND file_hash=original_hash
   AND storage_path=object_path AND document_type='receipt_original' ORDER BY created_at,id LIMIT 1;
 IF doc_id IS NULL THEN
   INSERT INTO public.secure_documents(user_id,document_type,file_hash,file_size,mime_type,storage_path,upload_metadata)
   VALUES(p_owner_user_id,'receipt_original',original_hash,(p_original->>'file_size')::integer,p_original->>'mime_type',object_path,
     jsonb_build_object('contract','receipt_evidence_v1','filename',p_original->>'filename','organization_id',p_organization_id,
       'first_contributor_user_id',p_user_id,'first_membership_id',access_context->'membership_id','verification','sha256_checked_by_canonical_intake')) RETURNING id INTO doc_id;
 END IF;
 artifact_id:=gen_random_uuid(); observation_id:=gen_random_uuid();
 INSERT INTO public.artifact_dispatch_log(id,content_sha256,kind,source_slug,submitted_at,submitted_by,handler,status,
  artifact_payload,observation_ids,routed_at,completed_at)
 VALUES(artifact_id,fingerprint,'receipt','receipt-scan',received,p_user_id::text,'receipt_evidence_v1','complete',
  payload,ARRAY[observation_id],received,received);
 INSERT INTO public.vehicle_observations(id,source_id,source_identifier,subject_type,subject_id,subject_organization_id,
  submitted_by_user_id,observed_at,kind,content_text,structured_data,content_hash,extraction_method,
  citation_secure_document_id,observer_raw,extraction_metadata,confidence,confidence_score,raw_source_ref)
 VALUES(observation_id,source_key,'receipt-submission:'||artifact_id::text,'user',p_owner_user_id,p_organization_id,
  p_user_id,received,'comment',p_extraction->>'raw_text',jsonb_build_object('claim_contract','receipt_evidence_v1',
    'artifact_id',artifact_id,'review_status','needs_review','expense_posted',false,'is_inferred',true,
    'observation_time_basis','interpretation_received','transaction_date_verified',false,
    'fields',p_extraction->'fields','items',coalesce(p_extraction->'items','[]'::jsonb),'supersedes_artifact_id',p_supersedes_artifact_id),
  fingerprint,'receipt_evidence_v1',doc_id,jsonb_build_object('contributor_user_id',p_user_id,'on_behalf_of_user_id',p_owner_user_id,
    'organization_id',p_organization_id,'membership_id',access_context->'membership_id','transport','ingest-artifact'),
  jsonb_build_object('method',p_extraction->'method','version',p_extraction->'version','extracted_at',p_extraction->'extracted_at'),
  'low',0.3,'user-documents/'||object_path);
 PERFORM public.record_receipt_participation(p_key_id,p_user_id,p_owner_user_id,p_organization_id,'submit',jsonb_build_object('artifact_id',artifact_id,'observation_id',observation_id,'document_id',doc_id,'sha256',original_hash,'status','captured_needs_review'));
 RETURN jsonb_build_object('artifact_id',artifact_id,'observation_id',observation_id,'document_id',doc_id,
   'status','captured_needs_review','duplicate',false,'expense_posted',false);
END $$;
REVOKE ALL ON FUNCTION public.ingest_receipt_evidence(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_receipt_evidence(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid) TO service_role;

-- Scope this restriction to the new private contract; existing public readers retain their behavior.
CREATE POLICY receipt_evidence_private_read ON public.vehicle_observations AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING (extraction_method IS DISTINCT FROM 'receipt_evidence_v1' OR subject_id=auth.uid());

CREATE FUNCTION public.read_receipt_intake(p_key_id uuid,p_user_id uuid,p_owner_user_id uuid,p_organization_id uuid,p_artifact_id uuid DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE allowed jsonb; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service invocation required'; END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid offset'; END IF;
 allowed:=public.check_receipt_intake_access(p_key_id,p_user_id,p_owner_user_id,p_organization_id,'read');
 IF allowed->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'accounting membership required'; END IF;
 SELECT coalesce(jsonb_agg(row_to_json(r)),'[]'::jsonb) INTO result FROM (
  SELECT a.id AS artifact_id,a.submitted_at,a.artifact_payload,a.observation_ids,'captured_needs_review' AS review_status,
   false AS expense_posted,
   EXISTS(SELECT 1 FROM public.artifact_dispatch_log newer WHERE newer.handler='receipt_evidence_v1'
     AND newer.artifact_payload->>'supersedes_artifact_id'=a.id::text
     AND newer.artifact_payload->>'owner_user_id'=p_owner_user_id::text
     AND newer.artifact_payload->>'organization_id'=p_organization_id::text) AS has_later_interpretation
  FROM public.artifact_dispatch_log a WHERE a.handler='receipt_evidence_v1'
   AND a.artifact_payload->>'owner_user_id'=p_owner_user_id::text AND a.artifact_payload->>'organization_id'=p_organization_id::text
   AND (p_artifact_id IS NULL OR a.id=p_artifact_id)
  ORDER BY a.submitted_at DESC,a.id LIMIT 50 OFFSET p_offset
 ) r;
 PERFORM public.record_receipt_participation(p_key_id,p_user_id,p_owner_user_id,p_organization_id,'read',jsonb_build_object('artifact_id',p_artifact_id,'status','read'));
 RETURN jsonb_build_object('records',result,'offset',p_offset,'limit',50,'scope','receipt evidence submissions; not the complete accounting ledger');
END $$;
REVOKE ALL ON FUNCTION public.read_receipt_intake(uuid,uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_receipt_intake(uuid,uuid,uuid,uuid,uuid,integer) TO service_role;

CREATE FUNCTION public.guard_receipt_evidence_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='secure_documents' AND to_jsonb(OLD)->>'document_type'='receipt_original' THEN RAISE EXCEPTION 'Receipt originals are immutable; retain source and submit a linked interpretation'; END IF;
 IF TG_TABLE_NAME='artifact_dispatch_log' AND to_jsonb(OLD)->>'handler'='receipt_evidence_v1' THEN RAISE EXCEPTION 'Receipt evidence is append-only; submit a linked correction'; END IF;
 IF TG_TABLE_NAME='vehicle_observations' AND to_jsonb(OLD)->>'extraction_method'='receipt_evidence_v1' THEN RAISE EXCEPTION 'Receipt evidence is append-only; submit a linked correction'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER receipt_artifact_history BEFORE UPDATE OR DELETE ON public.artifact_dispatch_log FOR EACH ROW
 WHEN (OLD.handler='receipt_evidence_v1') EXECUTE FUNCTION public.guard_receipt_evidence_history();
CREATE TRIGGER receipt_observation_history BEFORE UPDATE OR DELETE ON public.vehicle_observations FOR EACH ROW
 WHEN (OLD.extraction_method='receipt_evidence_v1') EXECUTE FUNCTION public.guard_receipt_evidence_history();

-- Protect only the newly introduced private receipt contract, retaining legacy readers.
CREATE POLICY receipt_artifact_private_read ON public.artifact_dispatch_log AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING (handler IS DISTINCT FROM 'receipt_evidence_v1');
CREATE POLICY receipt_original_private_read ON public.secure_documents AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING (document_type IS DISTINCT FROM 'receipt_original' OR user_id=auth.uid());
CREATE POLICY receipt_original_canonical_insert ON public.secure_documents AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK (document_type IS DISTINCT FROM 'receipt_original');
CREATE POLICY receipt_original_canonical_update ON public.secure_documents AS RESTRICTIVE FOR UPDATE TO anon,authenticated
 USING (document_type IS DISTINCT FROM 'receipt_original') WITH CHECK (document_type IS DISTINCT FROM 'receipt_original');
CREATE TRIGGER receipt_original_history BEFORE UPDATE OR DELETE ON public.secure_documents FOR EACH ROW
 WHEN (OLD.document_type='receipt_original') EXECUTE FUNCTION public.guard_receipt_evidence_history();
REVOKE TRUNCATE ON public.artifact_dispatch_log, public.secure_documents, public.vehicle_observations FROM anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
