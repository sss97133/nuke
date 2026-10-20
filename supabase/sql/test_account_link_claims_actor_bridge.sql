-- Disposable PG17 only. Proves 20261019091500_account_link_claims_actor_bridge.sql: one claim target, a pending
-- self_claim as the only user-written actor rung, reviewed promotions that require evidence row ids, no
-- name/phone/email match path, and the existing external-identity claim flow unchanged.
-- Fixture: account_link_claims, its policies/grants, the external_identity_claims view, its INSTEAD OF triggers and
-- request/approve_external_identity_claim as read live on 2026-10-19.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.account_link_claims') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), full_name text, phone text, email text);
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_active boolean);
CREATE TABLE public.actors(id uuid PRIMARY KEY, actor_type text NOT NULL, name text NOT NULL, phone text, email text);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, owner_confirmed_at timestamptz, owner_confirmed_by uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, is_superseded boolean DEFAULT false, submitted_by_user_id uuid);
CREATE TABLE public.work_order_resource_attestations(id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
  attestor_user_id uuid, attestor_organization_id uuid);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(), table_name text, column_name text, owned_by text,
  description text, do_not_write_directly boolean, write_via text);
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text, handle text,
  profile_url text, claimed_by_user_id uuid, claimed_at timestamptz, claim_confidence integer, last_seen_at timestamptz,
  updated_at timestamptz, UNIQUE(platform, handle));
CREATE TABLE public.account_link_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, platform text NOT NULL, handle text NOT NULL,
  external_identity_id uuid REFERENCES public.external_identities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','pending_review','verified','approved','rejected','expired'])),
  verification_method text, claim_confidence integer DEFAULT 0 CHECK (claim_confidence >= 0 AND claim_confidence <= 100),
  proof_type text, proof_url text, notes text, reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, handle));
ALTER TABLE public.account_link_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY alc_insert_own ON public.account_link_claims FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY alc_select_own ON public.account_link_claims FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY alc_service_role_all ON public.account_link_claims USING ((SELECT auth.jwt()->>'role') = 'service_role')
  WITH CHECK ((SELECT auth.jwt()->>'role') = 'service_role');
CREATE VIEW public.external_identity_claims WITH (security_invoker = true) AS
  SELECT id, external_identity_id, user_id AS requested_by_user_id, proof_type, proof_url, notes, status,
    reviewed_by_user_id, reviewed_at, created_at, updated_at FROM public.account_link_claims;
GRANT ALL ON public.account_link_claims, public.external_identity_claims TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON auth.users TO service_role;

CREATE FUNCTION public.external_identity_claims_compat_insert() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_platform TEXT; v_handle TEXT; v_id UUID;
BEGIN
  SELECT platform, handle INTO v_platform, v_handle FROM external_identities WHERE id = NEW.external_identity_id;
  IF v_platform IS NULL THEN RAISE EXCEPTION 'external identity % not found', NEW.external_identity_id; END IF;
  INSERT INTO account_link_claims AS alc (user_id, platform, handle, external_identity_id, status, proof_type, proof_url, notes)
  VALUES (NEW.requested_by_user_id, v_platform, v_handle, NEW.external_identity_id, COALESCE(NEW.status, 'pending'), NEW.proof_type, NEW.proof_url, NEW.notes)
  ON CONFLICT (user_id, platform, handle) DO UPDATE SET
    external_identity_id = COALESCE(alc.external_identity_id, EXCLUDED.external_identity_id),
    proof_type = COALESCE(EXCLUDED.proof_type, alc.proof_type), proof_url = COALESCE(EXCLUDED.proof_url, alc.proof_url),
    notes = COALESCE(EXCLUDED.notes, alc.notes),
    status = CASE WHEN alc.status IN ('verified','approved') THEN alc.status ELSE COALESCE(EXCLUDED.status, 'pending') END,
    updated_at = NOW()
  RETURNING id INTO v_id;
  NEW.id := v_id; RETURN NEW;
END; $function$;
CREATE FUNCTION public.external_identity_claims_compat_update() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  UPDATE account_link_claims SET status = NEW.status, proof_type = NEW.proof_type, proof_url = NEW.proof_url, notes = NEW.notes,
    reviewed_by_user_id = NEW.reviewed_by_user_id, reviewed_at = NEW.reviewed_at, updated_at = COALESCE(NEW.updated_at, NOW())
  WHERE id = OLD.id;
  RETURN NEW;
END; $function$;
CREATE TRIGGER external_identity_claims_compat_ins INSTEAD OF INSERT ON public.external_identity_claims FOR EACH ROW EXECUTE FUNCTION external_identity_claims_compat_insert();
CREATE TRIGGER external_identity_claims_compat_upd INSTEAD OF UPDATE ON public.external_identity_claims FOR EACH ROW EXECUTE FUNCTION external_identity_claims_compat_update();
CREATE FUNCTION public.request_external_identity_claim(p_platform text, p_handle text, p_profile_url text DEFAULT NULL,
  p_proof_type text DEFAULT 'profile_link', p_proof_url text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_identity_id UUID; v_claim_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO external_identities (platform, handle, profile_url, last_seen_at) VALUES (LOWER(p_platform), p_handle, p_profile_url, NOW())
  ON CONFLICT (platform, handle) DO UPDATE SET profile_url = COALESCE(external_identities.profile_url, EXCLUDED.profile_url), last_seen_at = NOW(), updated_at = NOW()
  RETURNING id INTO v_identity_id;
  INSERT INTO external_identity_claims (external_identity_id, requested_by_user_id, proof_type, proof_url, notes, status)
  VALUES (v_identity_id, auth.uid(), p_proof_type, p_proof_url, p_notes, 'pending') RETURNING id INTO v_claim_id;
  RETURN v_claim_id;
END; $function$;
CREATE FUNCTION public.approve_external_identity_claim(p_claim_id uuid, p_confidence integer DEFAULT 80)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_claim RECORD;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO v_claim FROM external_identity_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE external_identity_claims SET status = 'approved', reviewed_by_user_id = auth.uid(), reviewed_at = NOW(), updated_at = NOW() WHERE id = p_claim_id;
  UPDATE external_identities SET claimed_by_user_id = v_claim.requested_by_user_id, claimed_at = NOW(),
    claim_confidence = LEAST(100, GREATEST(0, COALESCE(p_confidence, 80))), updated_at = NOW() WHERE id = v_claim.external_identity_id;
  RETURN TRUE;
END; $function$;
REVOKE ALL ON FUNCTION public.request_external_identity_claim(text,text,text,text,text,text), public.approve_external_identity_claim(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_external_identity_claim(text,text,text,text,text,text), public.approve_external_identity_claim(uuid,integer) TO authenticated, service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE FUNCTION public.t_as(p_role text, p_sub uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role, 'sub', p_sub)::text, false); END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text), public.t_as(text,uuid) TO anon, authenticated, service_role;

-- U1 claimant, U2 another user, R active admin reviewer, N inactive admin. A1 shares U1's name, phone and email; A2 shares the name.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000ad'),('00000000-0000-0000-0000-0000000000ae');
INSERT INTO profiles VALUES ('00000000-0000-0000-0000-0000000000a1','Fixture Mechanic','+15550100','m@example.com');
INSERT INTO admin_users(user_id,is_active) VALUES ('00000000-0000-0000-0000-0000000000ad',true),('00000000-0000-0000-0000-0000000000ae',false);
INSERT INTO actors VALUES ('a0000000-0000-0000-0000-000000000001','person','Fixture Mechanic','+15550100','m@example.com'),
  ('a0000000-0000-0000-0000-000000000002','person','Fixture Mechanic',NULL,NULL);
INSERT INTO work_sessions VALUES ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',NULL,NULL,NULL),
  ('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',NULL,NULL,NULL);
INSERT INTO vehicle_observations VALUES ('60000000-0000-0000-0000-000000000001',false,'00000000-0000-0000-0000-0000000000a1'),
  ('60000000-0000-0000-0000-000000000002',false,'00000000-0000-0000-0000-0000000000a2'),
  ('60000000-0000-0000-0000-000000000003',false,NULL),('60000000-0000-0000-0000-000000000004',true,'00000000-0000-0000-0000-0000000000a1');
INSERT INTO work_order_resource_attestations VALUES ('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',NULL),
  ('60000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1',NULL);
INSERT INTO account_link_claims(id,user_id,platform,handle,external_identity_id,status,proof_type)
  SELECT 'c0000000-0000-0000-0000-0000000000e0','00000000-0000-0000-0000-0000000000a2','bat','existing',NULL,'pending','profile_link';

\ir ../migrations/20261019091500_account_link_claims_actor_bridge.sql

SELECT t_assert((SELECT count(*) FROM account_link_claims) = 1 AND (SELECT rung_evidence FROM account_link_claims) = '[]',
  'existing claim kept with an empty rung history');
SELECT t_assert(NOT has_function_privilege('anon','public.approve_actor_link_claim(uuid,text,jsonb,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.approve_actor_link_claim(uuid,text,jsonb,uuid,text)','EXECUTE')
  AND has_function_privilege('service_role','public.approve_actor_link_claim(uuid,text,jsonb,uuid,text)','EXECUTE'),
  'approve_actor_link_claim is service-only');

-- 1. Existing external-identity flow.
SET ROLE authenticated;
SELECT t_as('authenticated','00000000-0000-0000-0000-0000000000a1');
CREATE TEMP TABLE ext AS SELECT request_external_identity_claim('BaT','fixture_handle') AS id;
GRANT SELECT ON ext TO service_role;
SELECT t_assert((SELECT count(*) FROM account_link_claims WHERE platform='bat' AND handle='fixture_handle' AND external_identity_id IS NOT NULL
  AND status='pending') = 1, 'request_external_identity_claim still files a pending claim');
SELECT t_assert((SELECT count(*) FROM external_identity_claims) = 1, 'the claimant reads their external claim through the view');
RESET ROLE;
SET ROLE service_role;
SELECT t_as('service_role', NULL);
INSERT INTO account_link_claims(user_id,platform,handle,external_identity_id,status)
  VALUES ('00000000-0000-0000-0000-0000000000a2','ebay','unresolved_seller',NULL,'pending');
SELECT t_assert(true, 'an unresolved external handle (null external_identity_id) can still be filed, as the MCP link flow does');
UPDATE account_link_claims SET status='pending_review', verification_method='manual_review', claim_confidence=75
  WHERE platform='ebay' AND handle='unresolved_seller';
SELECT t_assert((SELECT verification_method FROM account_link_claims WHERE handle='unresolved_seller')='manual_review',
  'external claims keep their own verification_method vocabulary');
SELECT t_assert(approve_external_identity_claim((SELECT id FROM ext)), 'approve_external_identity_claim still approves');
SELECT t_assert((SELECT claimed_by_user_id FROM external_identities WHERE handle='fixture_handle')='00000000-0000-0000-0000-0000000000a1',
  'approval still links the external identity');
RESET ROLE;

-- 2. A user files a self_claim for an actor, and nothing else.
SET ROLE authenticated;
SELECT t_as('authenticated','00000000-0000-0000-0000-0000000000a1');
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,verification_method)
  VALUES ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','nuke_actor',
  'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','self_claim');
SELECT t_assert((SELECT status||'/'||verification_method FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001')='pending/self_claim',
  'the claimant files and reads a pending self_claim');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method)
  VALUES ('00000000-0000-0000-0000-0000000000a1','nuke_actor','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','co_sign')$q$),
  'a user cannot file a rung above self_claim');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method,status)
  VALUES ('00000000-0000-0000-0000-0000000000a1','nuke_actor','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','self_claim','approved')$q$),
  'a user cannot file an approved actor claim');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method)
  VALUES ('00000000-0000-0000-0000-0000000000a2','nuke_actor','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','self_claim')$q$),
  'a user cannot file a claim in another account''s name');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method)
  VALUES ('00000000-0000-0000-0000-0000000000a1','nuke_actor','someone','a0000000-0000-0000-0000-000000000002','self_claim')$q$),
  'an actor claim handle must be the actor id');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle,actor_id,external_identity_id,verification_method)
  VALUES ('00000000-0000-0000-0000-0000000000a1','nuke_actor','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002',
  (SELECT id FROM external_identities LIMIT 1),'self_claim')$q$), 'a claim cannot name both an actor and an external identity');
SELECT t_assert(t_refused($q$INSERT INTO account_link_claims(user_id,platform,handle) VALUES ('00000000-0000-0000-0000-0000000000a1','nuke_actor','x')$q$),
  'platform nuke_actor requires an actor');
UPDATE account_link_claims SET verification_method='authenticated_sign', status='approved' WHERE id='c0000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT verification_method FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001')='self_claim',
  'the claimant cannot update their own claim');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('authenticated','00000000-0000-0000-0000-0000000000a2');
SELECT t_assert((SELECT count(*) FROM account_link_claims WHERE actor_id IS NOT NULL)=0, 'another user cannot see the actor claim');
RESET ROLE;
SET ROLE anon;
SELECT t_as('anon', NULL);
SELECT t_assert((SELECT count(*) FROM account_link_claims)=0, 'anon sees no claims');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$), 'anon cannot approve');
RESET ROLE;

-- 3. No name, phone or email match: the same-name actors gain no claim and the self_claim stays a claim.
SELECT t_assert((SELECT count(*) FROM account_link_claims WHERE actor_id IS NOT NULL)=1, 'only the explicitly filed actor claim exists');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM account_link_claims WHERE actor_id='a0000000-0000-0000-0000-000000000002'),
  'an actor with the claimant''s name gains no claim');
SELECT t_assert((SELECT bool_and(prosrc !~* '(full_name|phone|email|\mname\M|profiles|actors)') FROM pg_proc
  WHERE proname IN ('account_link_claims_actor_guard','approve_actor_link_claim')), 'bridge code reads no name, phone, email, profile or actor field');
SELECT t_assert((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.actors'::regclass,'public.profiles'::regclass))=0,
  'nothing on actors or profiles writes claims');

-- 4. External path cannot reach actor claims.
SET ROLE service_role;
SELECT t_as('service_role', NULL);
SELECT t_assert((SELECT count(*) FROM external_identity_claims WHERE id='c0000000-0000-0000-0000-000000000001')=0, 'the external view hides actor claims');
SELECT t_assert(approve_external_identity_claim('c0000000-0000-0000-0000-000000000001') IS FALSE, 'the external approval path cannot approve an actor claim');
SELECT t_assert((SELECT status FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001')='pending', 'actor claim untouched by the external path');

-- 5. Promotion requires reviewed evidence, from every write path.
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET verification_method='work_evidence', status='approved',
  reviewed_by_user_id='00000000-0000-0000-0000-0000000000ad', reviewed_at=now() WHERE id='c0000000-0000-0000-0000-000000000001'$q$),
  'a direct service update cannot promote without an evidence entry');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET verification_method='co_sign', status='approved', reviewed_by_user_id='00000000-0000-0000-0000-0000000000ad',
  reviewed_at='2026-01-01', rung_evidence='[{"rung":"co_sign","evidence":[{"kind":"attestation","id":"60000000-0000-0000-0000-000000000099"}],
  "reviewer_user_id":"00000000-0000-0000-0000-0000000000ad","reviewed_at":"2026-01-01T00:00:00+00:00"}]' WHERE id='c0000000-0000-0000-0000-000000000001'$q$),
  'a hand-built entry naming a missing row is refused');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence','[]','00000000-0000-0000-0000-0000000000ad')$q$),
  'no evidence ids, no promotion');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',NULL,'00000000-0000-0000-0000-0000000000ad')$q$),
  'null evidence, no promotion');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000002"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'another account''s work session is not the claimant''s work evidence');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"observation","id":"60000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'work_evidence needs the claimant''s work session');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000a1')$q$),
  'the claimant cannot review their own claim');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ae')$q$),
  'an inactive admin cannot review');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]',NULL)$q$), 'a reviewer is required');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','self_claim',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'a promotion must rise above self_claim');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','verified',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'rungs outside the vocabulary are refused');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"name_match","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'unknown evidence kinds are refused');
SELECT t_assert((SELECT status||'/'||verification_method||'/'||jsonb_array_length(rung_evidence) FROM account_link_claims
  WHERE id='c0000000-0000-0000-0000-000000000001')='pending/self_claim/0', 'refused attempts leave the claim unchanged');

CREATE TEMP TABLE p1 AS SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad','reviewed capture days') r;
SELECT t_assert((SELECT r @> '{"rung":"work_evidence","previous_rung":"self_claim","evidence_rows":1}' FROM p1), 'work_evidence promotion with the claimant''s session');
SELECT t_assert((SELECT status='approved' AND reviewed_by_user_id='00000000-0000-0000-0000-0000000000ad' AND reviewed_at IS NOT NULL
  AND rung_evidence->0->>'reviewer_user_id'='00000000-0000-0000-0000-0000000000ad' AND rung_evidence->0->>'note'='reviewed capture days'
  FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001'), 'promotion records reviewer, clock, evidence ids and note');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','work_evidence',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'the same rung cannot be granted twice');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','co_sign',
  '[{"kind":"attestation","id":"60000000-0000-0000-0000-000000000003"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'a co-sign attributed to the claimant is not a co-sign');
SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','co_sign',
  '[{"kind":"attestation","id":"60000000-0000-0000-0000-000000000002"}]','00000000-0000-0000-0000-0000000000ad');
SELECT t_assert((SELECT verification_method='co_sign' AND jsonb_array_length(rung_evidence)=2 AND rung_evidence->0->>'rung'='work_evidence'
  FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001'), 'co_sign appends and keeps the earlier entry');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','authenticated_sign',
  '[{"kind":"work_session","id":"50000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'an unconfirmed session is not an authenticated sign');
SELECT t_assert(t_refused($q$SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','authenticated_sign',
  '[{"kind":"observation","id":"60000000-0000-0000-0000-000000000004"}]','00000000-0000-0000-0000-0000000000ad')$q$),
  'a superseded observation is not evidence');
SELECT approve_actor_link_claim('c0000000-0000-0000-0000-000000000001','authenticated_sign',
  '[{"kind":"observation","id":"60000000-0000-0000-0000-000000000001"}]','00000000-0000-0000-0000-0000000000ad');
SELECT t_assert((SELECT verification_method FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001')='authenticated_sign',
  'authenticated_sign from an observation the claimant submitted');

-- 6. History cannot be rewritten, demoted or retargeted.
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET rung_evidence = rung_evidence - 0 WHERE id='c0000000-0000-0000-0000-000000000001'$q$),
  'rung history cannot be truncated');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET verification_method='work_evidence' WHERE id='c0000000-0000-0000-0000-000000000001'$q$),
  'a rung cannot be lowered in place');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET actor_id='a0000000-0000-0000-0000-000000000002', handle='a0000000-0000-0000-0000-000000000002'
  WHERE id='c0000000-0000-0000-0000-000000000001'$q$), 'the claimed actor cannot be changed');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET claim_confidence=90 WHERE id='c0000000-0000-0000-0000-000000000001'$q$),
  'an actor claim carries no free confidence score');
UPDATE account_link_claims SET status='rejected' WHERE id='c0000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT status FROM account_link_claims WHERE id='c0000000-0000-0000-0000-000000000001')='rejected', 'a claim can be closed without a promotion');
SELECT t_assert(t_refused($q$UPDATE account_link_claims SET status='approved' WHERE id='c0000000-0000-0000-0000-000000000001'$q$),
  'a closed claim cannot be reopened in place');
RESET ROLE;
