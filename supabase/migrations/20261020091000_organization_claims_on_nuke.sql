-- Businesses join Nuke by claiming their organization; readers say whether a business is on Nuke.
--
-- On 2026-10-19 the 22 organizations that supply Plan-B for open requirements had no members, so none could receive a
-- request or offer, and request_contact to such an organization failed with "No reachable recipient". The existing claim
-- path was a user-inserted pending organization_ownership_verifications row with no reviewer; an approved one lets the
-- user add an owner organization_contributors row. Outbound messages to businesses stay excluded. This adds:
--   claim_organization(p_organization_id, p_method 'domain_email'|'document', p_evidence) (authenticated Sign):
--     domain_email: the caller's confirmed sign-in e-mail domain equals (or is a subdomain of) the organization's website
--       host -> an active owner membership (organization_contributors, verification_method 'domain_email', claim_evidence
--       with the domain and confirmation clock; the address is never stored or returned). Free-mail hosts never match.
--     document: a pending organization_ownership_verifications row (business_license, tax_id, ...; https document URL).
--   approve_organization_claim_owner_agent(p_verification_id, p_review_note, p_authorization_quote, p_agent_session)
--     (service-only): a document claim by a signed-in account other than the owner, with a document URL, is approved on
--     the owner's behalf with the reviewer's note, registered in owner_delegated_signs, and becomes an active owner
--     membership (verification_method 'document').
--   organization_on_nuke(p_organization_id) (open): state 'claimed' | 'not_on_nuke_yet', active member and owner counts,
--     claim methods. Added to facility_read (anchored), organization_supply_read and each requirement_plan_b_suppliers
--     entry (with can_receive_requests).
--   request_contact (anchored): to an organization with no active member it returns available:false,
--     reason 'not_on_nuke_yet' and an invite descriptor (create_supplier_invite; the customer shares the link) instead of
--     raising; nothing is sent.
-- Contract: supabase/sql/test_organization_claims_on_nuke.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.organization_contributors DROP CONSTRAINT IF EXISTS organization_contributors_verification_method_chk;
ALTER TABLE public.organization_contributors ADD CONSTRAINT organization_contributors_verification_method_chk
  CHECK (verification_method = ANY (ARRAY['self_claimed', 'owner_approval', 'proof_of_work', 'document', 'domain_email'])) NOT VALID;
ALTER TABLE public.organization_contributors ADD COLUMN IF NOT EXISTS claim_evidence jsonb;

CREATE FUNCTION public.organization_website_host(p_organization_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(lower(regexp_replace(regexp_replace(COALESCE(o.website, ''), '^[a-z]+://(www\.)?', '', 'i'), '[/:?#].*$', '')), '')
  FROM public.organizations o WHERE o.id = p_organization_id
$$;

CREATE FUNCTION public.organization_on_nuke(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH m AS (
    SELECT oc.user_id, oc.role, oc.verification_method FROM public.organization_contributors oc
      WHERE oc.organization_id = p_organization_id AND oc.status = 'active' AND oc.user_id IS NOT NULL
    UNION SELECT bo.owner_id, 'owner', 'business_ownership' FROM public.business_ownership bo
      WHERE bo.business_id = p_organization_id AND bo.status = 'active' AND bo.owner_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'state', CASE WHEN EXISTS (SELECT 1 FROM m) THEN 'claimed' ELSE 'not_on_nuke_yet' END,
    'label', CASE WHEN EXISTS (SELECT 1 FROM m) THEN 'Claimed on Nuke' ELSE 'Not on Nuke yet' END,
    'members_active', (SELECT count(DISTINCT user_id) FROM m),
    'owners_active', (SELECT count(DISTINCT user_id) FROM m WHERE role IN ('owner', 'co_founder')),
    'claimed_via', COALESCE((SELECT jsonb_agg(DISTINCT verification_method) FROM m WHERE role IN ('owner', 'co_founder')), '[]'::jsonb),
    'claim', jsonb_build_object('writer', 'claim_organization',
      'methods', CASE WHEN public.organization_website_host(p_organization_id) IS NOT NULL
        THEN jsonb_build_array('domain_email', 'document') ELSE jsonb_build_array('document') END,
      'domain', public.organization_website_host(p_organization_id),
      'domain_email_rule', 'your confirmed sign-in e-mail is at this website''s domain'))
$$;
REVOKE ALL ON FUNCTION public.organization_on_nuke(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_on_nuke(uuid) TO anon, authenticated, service_role;

CREATE FUNCTION public.organization_claim_grant(p_organization_id uuid, p_user uuid, p_method text, p_evidence jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE mid uuid;
BEGIN
  INSERT INTO public.organization_contributors (organization_id, user_id, role, status, verification_method, verified_at, claim_evidence, start_date)
  VALUES (p_organization_id, p_user, 'owner', 'active', p_method, now(), p_evidence, current_date)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner', status = 'active', verification_method = EXCLUDED.verification_method,
    verified_at = EXCLUDED.verified_at, claim_evidence = EXCLUDED.claim_evidence, updated_at = now()
  RETURNING id INTO mid;
  RETURN mid;
END $$;
REVOKE ALL ON FUNCTION public.organization_claim_grant(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_organization(p_organization_id uuid, p_method text, p_evidence jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  host text;
  mail_host text;
  confirmed timestamptz;
  mid uuid;
  vid uuid;
  vtype text;
  doc text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_method, '') NOT IN ('domain_email', 'document') THEN
    RAISE EXCEPTION 'Method must be domain_email or document' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_organization_id AND oc.user_id = uid
      AND oc.status = 'active' AND oc.role IN ('owner', 'co_founder')) THEN
    RETURN jsonb_build_object('organization_id', p_organization_id, 'state', 'claimed', 'duplicate', true,
      'on_nuke', public.organization_on_nuke(p_organization_id));
  END IF;

  IF p_method = 'domain_email' THEN
    host := public.organization_website_host(p_organization_id);
    IF host IS NULL THEN
      RAISE EXCEPTION 'This organization has no website domain on Nuke; claim with a document' USING ERRCODE = '22023';
    END IF;
    IF host IN ('gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
        'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com') THEN
      RAISE EXCEPTION 'A free e-mail domain cannot prove a business; claim with a document' USING ERRCODE = '22023';
    END IF;
    SELECT lower(split_part(u.email, '@', 2)), u.email_confirmed_at INTO mail_host, confirmed FROM auth.users u
      WHERE u.id = uid AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.is_anonymous, false) = false;
    IF mail_host IS NULL OR NOT (mail_host = host OR mail_host LIKE '%.' || host) THEN
      RAISE EXCEPTION 'Your confirmed sign-in e-mail is not at this organization''s website domain; claim with a document'
        USING ERRCODE = '42501';
    END IF;
    mid := public.organization_claim_grant(p_organization_id, uid, 'domain_email', jsonb_build_object('method', 'domain_email', 'domain', host,
      'match', CASE WHEN mail_host = host THEN 'exact' ELSE 'subdomain' END, 'email_confirmed_at', confirmed, 'claimed_at', now()));
    RETURN jsonb_build_object('organization_id', p_organization_id, 'state', 'claimed', 'method', 'domain_email', 'role', 'owner',
      'membership_id', mid, 'domain', host, 'email_returned', false, 'on_nuke', public.organization_on_nuke(p_organization_id));
  ELSIF p_method = 'document' THEN
    vtype := p_evidence->>'verification_type';
    doc := p_evidence->>'document_url';
    IF vtype IS NULL OR vtype NOT IN ('business_license', 'tax_id', 'articles_incorporation', 'dba_certificate', 'lease_agreement', 'utility_bill') THEN
      RAISE EXCEPTION 'verification_type must be business_license, tax_id, articles_incorporation, dba_certificate, lease_agreement or utility_bill'
        USING ERRCODE = '22023';
    END IF;
    IF doc IS NULL OR doc !~ '^https://' OR length(doc) > 2000 THEN
      RAISE EXCEPTION 'An https document_url is required' USING ERRCODE = '22023';
    END IF;
    SELECT v.id INTO vid FROM public.organization_ownership_verifications v
      WHERE v.organization_id = p_organization_id AND v.user_id = uid AND v.status IN ('pending', 'documents_uploaded', 'ai_processing', 'human_review')
      ORDER BY v.created_at DESC LIMIT 1;
    IF vid IS NOT NULL THEN
      RETURN jsonb_build_object('organization_id', p_organization_id, 'state', 'pending_review', 'verification_id', vid, 'duplicate', true);
    END IF;
    INSERT INTO public.organization_ownership_verifications (organization_id, user_id, verification_type, status, document_url,
      supporting_documents, submitted_at)
    VALUES (p_organization_id, uid, vtype, 'pending', doc, COALESCE(p_evidence->'supporting_documents', '[]'::jsonb), now())
    RETURNING id INTO vid;
    RETURN jsonb_build_object('organization_id', p_organization_id, 'state', 'pending_review', 'verification_id', vid, 'method', 'document',
      'duplicate', false, 'review', 'a reviewer checks the document; nothing is granted until then');
  END IF;
  RAISE EXCEPTION 'Method must be domain_email or document' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.claim_organization(uuid, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_organization(uuid, text, jsonb) TO authenticated;
COMMENT ON FUNCTION public.claim_organization(uuid, text, jsonb) IS
  'Sign: claim an organization. domain_email (confirmed sign-in e-mail at the website domain) grants an active owner membership; document files a pending ownership verification for review.';

CREATE FUNCTION public.approve_organization_claim_owner_agent(p_verification_id uuid, p_review_note text, p_authorization_quote text,
  p_agent_session text DEFAULT 'agent')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v public.organization_ownership_verifications%ROWTYPE;
  owner_id constant uuid := public.owner_delegation_owner_id();
  sign_id uuid;
  mid uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO v FROM public.organization_ownership_verifications WHERE id = p_verification_id FOR UPDATE;
  IF NOT FOUND OR v.status NOT IN ('pending', 'documents_uploaded', 'ai_processing', 'human_review') THEN
    RAISE EXCEPTION 'Open document claim not found';
  END IF;
  IF v.user_id = owner_id OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.user_id AND u.last_sign_in_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only a signed-in account other than the owner can be approved on the owner''s behalf';
  END IF;
  IF v.document_url IS NULL OR v.document_url !~ '^https://' THEN RAISE EXCEPTION 'The claim carries no document'; END IF;
  IF length(btrim(COALESCE(p_review_note, ''))) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'State what the document shows (10 to 2000 characters)';
  END IF;
  IF NULLIF(btrim(p_authorization_quote), '') IS NULL THEN RAISE EXCEPTION 'Authorization quote required'; END IF;
  sign_id := public.owner_delegated_sign_record('approve_organization_claim_owner_agent',
    jsonb_build_object('verification_id', v.id, 'organization_id', v.organization_id, 'claimant_user_id', v.user_id,
      'verification_type', v.verification_type), v.id::text, p_authorization_quote, p_agent_session);
  UPDATE public.organization_ownership_verifications SET status = 'approved', human_reviewer_id = owner_id, human_reviewed_at = now(),
      approved_at = now(), updated_at = now(),
      human_review_notes = 'reviewed by an agent on the owner''s behalf; owner_delegated_signs ' || sign_id::text || '; ' || btrim(p_review_note)
    WHERE id = v.id;
  mid := public.organization_claim_grant(v.organization_id, v.user_id, 'document', jsonb_build_object('method', 'document',
    'verification_id', v.id, 'verification_type', v.verification_type, 'approved_at', now(), 'owner_delegated_sign_id', sign_id));
  RETURN jsonb_build_object('verification_id', v.id, 'organization_id', v.organization_id, 'state', 'claimed', 'membership_id', mid,
    'reviewer', 'agent_on_behalf_of_owner', 'owner_delegated_sign_id', sign_id);
END $$;
REVOKE ALL ON FUNCTION public.approve_organization_claim_owner_agent(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_organization_claim_owner_agent(uuid, text, text, text) TO service_role;

-- Readers: anchored, exactly-once additions re-created from the live text.
DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.facility_read(uuid)'::regprocedure);
  anchor := $a$'work_recorded_on_nuke', public.organization_supply_summary(org.id),$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('''on_nuke''' IN def) > 0 THEN RAISE EXCEPTION 'facility_read: anchor found % times (or already edited)', n; END IF;
  EXECUTE replace(def, anchor, anchor || $r$
    'on_nuke', public.organization_on_nuke(org.id),$r$);

  def := pg_get_functiondef('public.request_contact(text,uuid,text,uuid,uuid,uuid)'::regprocedure);
  anchor := $a$  IF num_nonnulls(r_user, r_actor, r_org) <> 1 OR cardinality(public.contact_recipient_users(r_user, r_actor, r_org)) = 0 THEN$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('not_on_nuke_yet' IN def) > 0 THEN RAISE EXCEPTION 'request_contact: anchor found % times (or already edited)', n; END IF;
  EXECUTE replace(def, anchor, $r$  IF r_org IS NOT NULL AND r_user IS NULL AND r_actor IS NULL AND cardinality(public.contact_recipient_users(NULL, NULL, r_org)) = 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_on_nuke_yet', 'status', 'not_sent', 'request_id', NULL, 'delivery', 'none',
      'recipient', public.contact_counterpart_label(NULL, NULL, r_org), 'on_nuke', public.organization_on_nuke(r_org),
      'invite', jsonb_build_object('action', 'invite_supplier', 'rpc', 'create_supplier_invite',
        'args', jsonb_build_object('p_organization_id', r_org, 'p_requirement_id', CASE WHEN p_context_kind = 'requirement' THEN p_context_id END),
        'who', 'the customer or vehicle owner of the job',
        'basis', 'you share the single-use link yourself; Nuke sends nothing to the business'));
  END IF;
$r$ || anchor);
END $edit$;

CREATE OR REPLACE FUNCTION public.organization_supply_read(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE o record;
BEGIN
  SELECT x.id, x.is_public INTO o FROM public.organizations x WHERE x.id = p_organization_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('as_of', statement_timestamp(), 'organization', public.platform_organization_label(o.id),
    'profile_public', o.is_public IS TRUE,
    'on_nuke', public.organization_on_nuke(o.id),
    'work_recorded_on_nuke', public.organization_supply_summary(o.id),
    'basis', 'purchase records retained on Nuke (receipts, work-order parts, organization-resolved payments), resolved by reviewed vendor names; times are records, not quantities',
    'withheld', jsonb_build_array('amounts paid', 'who paid', 'receipt and line ids', 'line text'));
END $$;

CREATE OR REPLACE FUNCTION public.requirement_plan_b_suppliers(p_text text, p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH kinds AS (
    SELECT DISTINCT unnest(k.supply_kinds) AS kind FROM public.supply_requirement_keywords k
    WHERE lower(COALESCE(p_text, '')) ~ ('\m(' || k.pattern || ')')
  ), hits AS (
    SELECT e.organization_id, array_agg(DISTINCT e.supply_kind ORDER BY e.supply_kind) AS kinds_matched,
      count(DISTINCT (e.basis_table, e.basis_id)) AS times, min(e.observed_on) AS first_on, max(e.observed_on) AS last_on
    FROM public.organization_supply_evidence e JOIN kinds k ON k.kind = e.supply_kind GROUP BY e.organization_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id),
      'profile_public', o.is_public IS TRUE, 'kinds_matched', to_jsonb(h.kinds_matched), 'times', h.times,
      'first_on', h.first_on, 'last_on', h.last_on,
      'label', 'paid for this before on Nuke (' || h.times || CASE WHEN h.times = 1 THEN ' time)' ELSE ' times)' END,
      'on_nuke', n.on_nuke, 'can_receive_requests', n.on_nuke->>'state' = 'claimed',
      'role', 'plan_b_supplier', 'basis', 'retained purchase records resolved to this organization; no amounts or payers')
      ORDER BY h.times DESC, h.organization_id), '[]'::jsonb)
  FROM (SELECT * FROM hits ORDER BY times DESC, organization_id LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)) h
  JOIN public.organizations o ON o.id = h.organization_id
  CROSS JOIN LATERAL (SELECT public.organization_on_nuke(h.organization_id) AS on_nuke) n
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
