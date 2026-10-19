-- Verified claimants offer as their organization, least privilege.
--
-- 20261020091000 recorded a business claim (claim_organization: confirmed e-mail at the website domain, or an approved
-- document) as an active owner row in organization_contributors. That table is read by many access rules (deal contacts
-- and documents, organization vehicle images, organization updates, completion signing as organization_member), so a
-- claim would have opened the organization's private records. This moves claims to their own register and grants only:
--   - offer_on_requirement as the organization (rung 'verified_claimant', recorded on the signed offer) on OPEN
--     requirements (public vehicle, not invite_only), with the same resource rules as an owner offer (the organization as
--     facility, or a named performer the claimant has linked to their own account);
--   - after the customer accepts that offer, the claimant is that job's accepted provider, so issue_work_order_quote,
--     start_work, attest_work_completion and issue_work_order_invoice work on that job only (unchanged writers).
-- work_order_is_accessible, work_order_viewer_slots, business_ownership and every organization_contributors rule are
-- unchanged; a claimant is not a member, so none of them apply.
--
--   organization_verified_claimants: the register (service-only). Existing claim rows (contributors rows written by
--     organization_claim_grant, claim_evidence ? 'method') move here and leave organization_contributors.
--   organization_verified_claimant(user, org): the check used by offer eligibility.
--   organization_claim_grant / claim_organization / approve_organization_claim_owner_agent: write the register; results
--     say role 'verified_claimant', claimant_id and what the claim grants.
--   organization_on_nuke: a claim still reads "Claimed on Nuke"; adds verified_claimants and offer_capable.
--   contact_recipient_users (anchored): verified claimants receive contact requests addressed to the organization.
--   work_order_offer_eligibility (anchored): the verified_claimant organization path.
--   work_order_offers_read (anchored): an organization offer's provider carries on_nuke and evidence_rung.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.organization_verified_claimants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('domain_email', 'document')),
  claim_evidence jsonb NOT NULL CHECK (jsonb_typeof(claim_evidence) = 'object' AND claim_evidence::text !~ '@'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_verified_claimants_user_idx ON public.organization_verified_claimants (user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.organization_verified_claimants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_verified_claimants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_verified_claimants TO service_role;
COMMENT ON TABLE public.organization_verified_claimants IS
  'Business claims (claim_organization). A claimant may offer as the organization on open requirements and works only jobs where that offer was accepted; not an organization member.';

INSERT INTO public.organization_verified_claimants (organization_id, user_id, method, claim_evidence, verified_at)
SELECT oc.organization_id, oc.user_id, oc.verification_method, oc.claim_evidence, COALESCE(oc.verified_at, now())
FROM public.organization_contributors oc
WHERE oc.claim_evidence ? 'method' AND oc.verification_method IN ('domain_email', 'document') AND oc.user_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;
DELETE FROM public.organization_contributors oc
WHERE oc.claim_evidence ? 'method' AND oc.verification_method IN ('domain_email', 'document');

CREATE FUNCTION public.organization_verified_claimant(p_user uuid, p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND p_organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_verified_claimants c
    WHERE c.organization_id = p_organization_id AND c.user_id = p_user AND c.revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.organization_verified_claimant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_verified_claimant(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.organization_claim_grant(p_organization_id uuid, p_user uuid, p_method text, p_evidence jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cid uuid;
BEGIN
  INSERT INTO public.organization_verified_claimants (organization_id, user_id, method, claim_evidence, verified_at)
  VALUES (p_organization_id, p_user, p_method, p_evidence, now())
  ON CONFLICT (organization_id, user_id) DO UPDATE SET method = EXCLUDED.method, claim_evidence = EXCLUDED.claim_evidence,
    verified_at = EXCLUDED.verified_at, revoked_at = NULL
  RETURNING id INTO cid;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.organization_claim_grant(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.organization_on_nuke(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH m AS (
    SELECT oc.user_id, oc.role, oc.verification_method FROM public.organization_contributors oc
      WHERE oc.organization_id = p_organization_id AND oc.status = 'active' AND oc.user_id IS NOT NULL
    UNION SELECT bo.owner_id, 'owner', 'business_ownership' FROM public.business_ownership bo
      WHERE bo.business_id = p_organization_id AND bo.status = 'active' AND bo.owner_id IS NOT NULL
    UNION SELECT c.user_id, 'verified_claimant', c.method FROM public.organization_verified_claimants c
      WHERE c.organization_id = p_organization_id AND c.revoked_at IS NULL
  )
  SELECT jsonb_build_object(
    'state', CASE WHEN EXISTS (SELECT 1 FROM m) THEN 'claimed' ELSE 'not_on_nuke_yet' END,
    'label', CASE WHEN EXISTS (SELECT 1 FROM m) THEN 'Claimed on Nuke' ELSE 'Not on Nuke yet' END,
    'members_active', (SELECT count(DISTINCT user_id) FROM m WHERE role <> 'verified_claimant'),
    'owners_active', (SELECT count(DISTINCT user_id) FROM m WHERE role IN ('owner', 'co_founder')),
    'verified_claimants', (SELECT count(DISTINCT user_id) FROM m WHERE role = 'verified_claimant'),
    'claimed_via', COALESCE((SELECT jsonb_agg(DISTINCT verification_method) FROM m WHERE role IN ('owner', 'co_founder', 'verified_claimant')), '[]'::jsonb),
    'offer_capable', EXISTS (SELECT 1 FROM m),
    'claim', jsonb_build_object('writer', 'claim_organization',
      'methods', CASE WHEN public.organization_website_host(p_organization_id) IS NOT NULL
        THEN jsonb_build_array('domain_email', 'document') ELSE jsonb_build_array('document') END,
      'domain', public.organization_website_host(p_organization_id),
      'domain_email_rule', 'your confirmed sign-in e-mail is at this website''s domain',
      'grants', 'offer as this organization on open requirements; quote, start, complete and invoice only jobs where its offer was accepted; no access to its other work orders, customers or payments'))
$$;

DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.claim_organization(uuid,text,jsonb)'::regprocedure);
  anchor := $a$  IF EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_organization_id AND oc.user_id = uid$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('organization_verified_claimant' IN def) > 0 THEN RAISE EXCEPTION 'claim_organization: anchor found % times (or already edited)', n; END IF;
  def := replace(def, anchor, $r$  IF public.organization_verified_claimant(uid, p_organization_id) OR EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = p_organization_id AND oc.user_id = uid$r$);
  anchor := $a$'role', 'owner',
      'membership_id', mid,$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'claim_organization: result anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$'role', 'verified_claimant',
      'claimant_id', mid, 'grants', public.organization_on_nuke(p_organization_id)#>'{claim,grants}',$r$);

  def := pg_get_functiondef('public.approve_organization_claim_owner_agent(uuid,text,text,text)'::regprocedure);
  anchor := $a$'state', 'claimed', 'membership_id', mid,$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'approve_organization_claim_owner_agent: anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$'state', 'claimed', 'role', 'verified_claimant', 'claimant_id', mid,$r$);

  def := pg_get_functiondef('public.contact_recipient_users(uuid,uuid,uuid)'::regprocedure);
  anchor := $a$oc.organization_id = p_org AND oc.status = 'active') x$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('organization_verified_claimants' IN def) > 0 THEN RAISE EXCEPTION 'contact_recipient_users: anchor found % times (or already edited)', n; END IF;
  EXECUTE replace(def, anchor, $r$oc.organization_id = p_org AND oc.status = 'active'
    UNION ALL SELECT vc.user_id FROM public.organization_verified_claimants vc WHERE p_org IS NOT NULL AND vc.organization_id = p_org AND vc.revoked_at IS NULL) x$r$);

  def := pg_get_functiondef('public.work_order_offer_eligibility(uuid,uuid,uuid,uuid)'::regprocedure);
  anchor := $a$    IF NOT EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'not_organization_owner');
    END IF;$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('verified_claimant' IN def) > 0 THEN RAISE EXCEPTION 'work_order_offer_eligibility: anchor found % times (or already edited)', n; END IF;
  EXECUTE replace(def, anchor, $r$    IF NOT EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN
      IF NOT public.organization_verified_claimant(p_user, p_organization_id) THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_organization_owner');
      END IF;
      IF NOT public.work_order_vehicle_open(w.vehicle_id) OR w.request_visibility IS NOT DISTINCT FROM 'invite_only' THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'verified_claimants_offer_on_open_requirements_only');
      END IF;
      IF rkind = 'facility' AND p_performer_actor_id IS NULL THEN
        RETURN jsonb_build_object('eligible', true, 'offer_kind', 'organization', 'rung', 'verified_claimant', 'requirement_kind', rkind,
          'supplier_organization_id', p_organization_id, 'facility_organization_id', p_organization_id);
      ELSIF rkind IN ('skill','inspection') AND p_performer_actor_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.account_link_claims c WHERE c.user_id = p_user AND c.actor_id = p_performer_actor_id
            AND c.status IN ('pending','approved')) THEN
          RETURN jsonb_build_object('eligible', false, 'reason', 'actor_not_linked_to_account');
        END IF;
        RETURN jsonb_build_object('eligible', true, 'offer_kind', 'organization', 'rung', 'verified_claimant', 'requirement_kind', rkind,
          'supplier_organization_id', p_organization_id, 'performer_actor_id', p_performer_actor_id);
      END IF;
      RETURN jsonb_build_object('eligible', false, 'reason', 'organization_offer_needs_facility_or_named_performer');
    END IF;$r$);

  def := pg_get_functiondef('public.work_order_offers_read(uuid)'::regprocedure);
  anchor := $a$'provider', CASE WHEN o.offer_kind = 'organization' THEN public.platform_organization_label(o.supplier_organization_id)$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('evidence_rung' IN def) > 0 THEN RAISE EXCEPTION 'work_order_offers_read: anchor found % times (or already edited)', n; END IF;
  EXECUTE replace(def, anchor, anchor || $r$
              || jsonb_build_object('on_nuke', public.organization_on_nuke(o.supplier_organization_id)->>'label', 'evidence_rung', o.offer_rung)$r$);
END $edit$;

ALTER TABLE public.work_order_resource_fulfillments DROP CONSTRAINT IF EXISTS work_order_resource_fulfillments_offer_rung_check;
ALTER TABLE public.work_order_resource_fulfillments ADD CONSTRAINT work_order_resource_fulfillments_offer_rung_check
  CHECK (offer_rung = ANY (ARRAY['unknown', 'self_claim', 'work_evidence', 'co_sign', 'authenticated_sign', 'organization_owner', 'verified_claimant'])) NOT VALID;
ALTER TABLE public.work_order_resource_fulfillments VALIDATE CONSTRAINT work_order_resource_fulfillments_offer_rung_check;

COMMENT ON FUNCTION public.claim_organization(uuid, text, jsonb) IS
  'Sign: claim an organization. domain_email (confirmed sign-in e-mail at the website domain) records a verified claimant; document files a pending ownership verification for review. A claimant offers as the organization on open requirements and works only jobs where that offer was accepted.';

NOTIFY pgrst, 'reload schema';
COMMIT;
