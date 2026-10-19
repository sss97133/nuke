-- Customer-shared supplier invites: a job's customer invites a business that is not on Nuke yet; Nuke sends nothing.
--
-- Plan-B suppliers on open requirements are organizations with no members (2026-10-19: 22 of 22). Outbound messages to
-- businesses stay excluded, so the customer who already deals with the business shares a link themselves:
--   supplier_invites (service-only): organization, requirement and work order, the creating customer, the SHA-256 of a
--     random token (the token itself is never stored), expiry (14 days), single redemption.
--   create_supplier_invite(p_organization_id, p_requirement_id) (authenticated Sign): the customer or a person with access
--     to the requirement's vehicle (publish_work_order's rule) on an open job; the organization must not be on Nuke yet;
--     at most 20 a day. Returns the token once with a share path; providers_notified false.
--   redeem_supplier_invite(p_token) (authenticated): single use, not by its creator, before expiry; returns the
--     organization with its claim methods (and whether the redeemer's confirmed e-mail domain qualifies, as a boolean),
--     and the requirement with an offer descriptor (offer_on_requirement). It changes no membership: claiming stays
--     claim_organization.
--   supplier_invites_summary() (open): counts only.
-- Contract: supabase/sql/test_supplier_invites.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.supplier_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  requirement_id uuid NOT NULL REFERENCES public.work_order_resource_requirements(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK (num_nonnulls(redeemed_at, redeemed_by) IN (0, 2)),
  CHECK (redeemed_by IS DISTINCT FROM created_by)
);
CREATE INDEX supplier_invites_creator ON public.supplier_invites (created_by, created_at);
ALTER TABLE public.supplier_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_invites FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.supplier_invites TO service_role;
COMMENT ON TABLE public.supplier_invites IS
  'Customer-shared, single-use, expiring invites for a business not on Nuke yet to see a requirement and claim its organization. Token hash only; Nuke sends nothing.';

CREATE FUNCTION public.create_supplier_invite(p_organization_id uuid, p_requirement_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  r public.work_order_resource_requirements%ROWTYPE;
  w public.work_orders%ROWTYPE;
  token text;
  inv public.supplier_invites%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.work_order_resource_requirements WHERE id = p_requirement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requirement unavailable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = r.work_order_id;
  IF NOT public.work_order_publication_party(w.id, uid) THEN
    RAISE EXCEPTION 'Only the customer or vehicle owner of this job can invite a supplier' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(w.status, 'pending') IN ('completed', 'paid', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'The job is closed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '22023';
  END IF;
  IF public.organization_on_nuke(p_organization_id)->>'state' = 'claimed' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'already_on_nuke', 'organization', public.platform_organization_label(p_organization_id),
      'contact', jsonb_build_object('writer', 'request_contact', 'context_kind', 'requirement', 'context_id', p_requirement_id,
        'recipient_organization_id', p_organization_id));
  END IF;
  IF (SELECT count(*) FROM public.supplier_invites i WHERE i.created_by = uid AND i.created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'Invite limit reached (20 per day)' USING ERRCODE = '54000';
  END IF;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO public.supplier_invites (organization_id, requirement_id, work_order_id, created_by, token_hash, expires_at)
  VALUES (p_organization_id, r.id, w.id, uid, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + interval '14 days')
  RETURNING * INTO inv;
  RETURN jsonb_build_object('available', true, 'invite_id', inv.id, 'token', token, 'expires_at', inv.expires_at, 'single_use', true,
    'share_path', '/supplier-invite/' || token,
    'organization', public.platform_organization_label(p_organization_id),
    'requirement', jsonb_build_object('requirement_id', r.id, 'work_order_id', w.id, 'kind', r.requirement_kind, 'description', r.description),
    'providers_notified', false, 'sent_by_nuke', false,
    'basis', 'you share this link with the business yourself; the token is shown once and only its hash is kept');
END $$;
REVOKE ALL ON FUNCTION public.create_supplier_invite(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_supplier_invite(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.create_supplier_invite(uuid, uuid) IS
  'Sign (customer or vehicle owner of an open job): a single-use, 14-day invite for a business not on Nuke yet. Returns the token once; Nuke sends nothing.';

CREATE FUNCTION public.redeem_supplier_invite(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  inv public.supplier_invites%ROWTYPE;
  r public.work_order_resource_requirements%ROWTYPE;
  w public.work_orders%ROWTYPE;
  host text;
  mail_host text;
  dup boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign up or sign in to use this invite' USING ERRCODE = '42501'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invite unavailable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO inv FROM public.supplier_invites WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite unavailable' USING ERRCODE = '22023'; END IF;
  IF inv.created_by = uid THEN RAISE EXCEPTION 'Share this invite with the business; you cannot redeem your own' USING ERRCODE = '42501'; END IF;
  IF inv.redeemed_by IS NOT NULL AND inv.redeemed_by <> uid THEN RAISE EXCEPTION 'This invite was already used' USING ERRCODE = '22023'; END IF;
  IF inv.redeemed_by IS NULL AND inv.expires_at <= now() THEN RAISE EXCEPTION 'This invite has expired' USING ERRCODE = '22023'; END IF;
  IF inv.redeemed_by = uid THEN
    dup := true;
  ELSE
    UPDATE public.supplier_invites SET redeemed_at = now(), redeemed_by = uid WHERE id = inv.id;
  END IF;
  SELECT * INTO r FROM public.work_order_resource_requirements WHERE id = inv.requirement_id;
  SELECT * INTO w FROM public.work_orders WHERE id = inv.work_order_id;
  host := public.organization_website_host(inv.organization_id);
  SELECT lower(split_part(u.email, '@', 2)) INTO mail_host FROM auth.users u
    WHERE u.id = uid AND u.email_confirmed_at IS NOT NULL AND COALESCE(u.is_anonymous, false) = false;
  RETURN jsonb_build_object('invite_id', inv.id, 'duplicate', dup,
    'organization', public.platform_organization_label(inv.organization_id), 'on_nuke', public.organization_on_nuke(inv.organization_id),
    'claim', jsonb_build_object('writer', 'claim_organization', 'args', jsonb_build_object('p_organization_id', inv.organization_id),
      'domain_email_qualifies', host IS NOT NULL AND mail_host IS NOT NULL AND (mail_host = host OR mail_host LIKE '%.' || host),
      'methods', public.organization_on_nuke(inv.organization_id)#>'{claim,methods}'),
    'requirement', jsonb_build_object('requirement_id', r.id, 'work_order_id', w.id, 'kind', r.requirement_kind, 'description', r.description,
      'still_open', COALESCE(w.status, 'pending') NOT IN ('completed', 'paid', 'cancelled', 'rejected'),
      'offer', jsonb_build_object('writer', 'offer_on_requirement', 'args', jsonb_build_object('p_requirement_id', r.id),
        'needs', 'a provider link (claim_organization for the business, or your own work actor) before offering')),
    'membership_changed', false, 'email_returned', false);
END $$;
REVOKE ALL ON FUNCTION public.redeem_supplier_invite(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_supplier_invite(text) TO authenticated;
COMMENT ON FUNCTION public.redeem_supplier_invite(text) IS
  'Redeem a customer-shared supplier invite once: shows the organization with its claim methods and the requirement with an offer descriptor. Changes no membership.';

CREATE FUNCTION public.supplier_invites_summary() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('as_of', statement_timestamp(), 'created', count(*), 'redeemed', count(*) FILTER (WHERE redeemed_at IS NOT NULL),
    'expired_unredeemed', count(*) FILTER (WHERE redeemed_at IS NULL AND expires_at <= now()),
    'open', count(*) FILTER (WHERE redeemed_at IS NULL AND expires_at > now()),
    'organizations_invited', count(DISTINCT organization_id),
    'organizations_claimed_after_invite', (SELECT count(DISTINCT i.organization_id) FROM public.supplier_invites i
      WHERE public.organization_on_nuke(i.organization_id)->>'state' = 'claimed'),
    'basis', 'counts only; no tokens, people or organizations listed')
  FROM public.supplier_invites
$$;
REVOKE ALL ON FUNCTION public.supplier_invites_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_invites_summary() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
