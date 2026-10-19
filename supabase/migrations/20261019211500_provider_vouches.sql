-- Standing vouch (QUOTE lane RSI pass 6, PR B). The user-subject sibling of a job-scoped co-sign: an authenticated statement
-- (supervision / suitability / permission / availability) with an explicit scope about a provider (account or work actor),
-- not tied to one offer. A vouch is never skill evidence: provider_profile_read shows it as "vouched_for_by", next to
-- facilities, never under capabilities.
--
--   * vouch_for_provider(p_subject_user_id, p_subject_actor_id, p_kinds, p_scope, p_expires_at): an owner or active member of
--     exactly one organization vouches for that organization; otherwise an account that owns tools or belongs to organizations
--     vouches for itself. Never for oneself (the account or an evidenced actor of it). A new vouch by the same voucher for the
--     same subject supersedes the previous one; an identical repeat is a duplicate.
--   * withdraw_vouch(p_id): the signer (or, for an organization vouch, a current owner/member) withdraws it.
--   * provider_vouches: immutable signed rows (service-only); withdrawal and supersession are the only changes, once.
--   * provider_profile_read (backend): anchored additions of vouched_for_by and tools.co_signed.authenticated_attestations
--     (co-sign attestations signed by the attestor or its organization); refused unless each anchor occurs exactly once.
-- No messaging, payment or ranking. Contract: supabase/sql/test_provider_vouches.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.provider_vouches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  voucher_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  voucher_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
  kinds text[] NOT NULL CHECK (cardinality(kinds) BETWEEN 1 AND 4
    AND kinds <@ ARRAY['availability','permission','supervision','suitability']::text[]),
  scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 1 AND 2000),
  expires_at timestamptz,
  signed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  request_key text NOT NULL,
  withdrawn_at timestamptz,
  withdrawn_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  superseded_by uuid REFERENCES public.provider_vouches(id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(voucher_user_id, voucher_organization_id) = 1),
  CHECK (num_nonnulls(subject_user_id, subject_actor_id) = 1),
  CHECK (voucher_user_id IS NULL OR voucher_user_id = signer_user_id),
  CHECK (expires_at IS NULL OR expires_at > signed_at),
  CHECK (num_nonnulls(withdrawn_at, withdrawn_by_user_id) IN (0,2)),
  CHECK (superseded_by IS NULL OR withdrawn_at IS NOT NULL)
);
CREATE INDEX provider_vouches_subject_user ON public.provider_vouches(subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX provider_vouches_subject_actor ON public.provider_vouches(subject_actor_id) WHERE subject_actor_id IS NOT NULL;
CREATE INDEX provider_vouches_signer ON public.provider_vouches(signer_user_id);
ALTER TABLE public.provider_vouches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_vouches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.provider_vouches TO service_role;
COMMENT ON TABLE public.provider_vouches IS 'Standing vouches: authenticated supervision/suitability/permission/availability statements with scope about a provider. Never skill evidence. Written only by vouch_for_provider / withdraw_vouch.';

CREATE FUNCTION public.provider_vouch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vouches are retained; withdraw instead'; END IF;
  IF current_setting('nuke.provider_vouch_sign', true) IS DISTINCT FROM COALESCE(NEW.id::text, '') THEN
    RAISE EXCEPTION 'Vouches are recorded only by vouch_for_provider and withdraw_vouch';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.withdrawn_at IS NOT NULL
    OR (NEW.id, NEW.signer_user_id, NEW.voucher_user_id, NEW.voucher_organization_id, NEW.subject_user_id, NEW.subject_actor_id,
      NEW.kinds, NEW.scope, NEW.expires_at, NEW.signed_at, NEW.request_key) IS DISTINCT FROM
      (OLD.id, OLD.signer_user_id, OLD.voucher_user_id, OLD.voucher_organization_id, OLD.subject_user_id, OLD.subject_actor_id,
      OLD.kinds, OLD.scope, OLD.expires_at, OLD.signed_at, OLD.request_key)) THEN
    RAISE EXCEPTION 'Vouch terms are immutable; withdrawal happens once';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.provider_vouch_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER provider_vouch_guard BEFORE INSERT OR UPDATE OR DELETE ON public.provider_vouches
  FOR EACH ROW EXECUTE FUNCTION public.provider_vouch_guard();

CREATE FUNCTION public.vouch_for_provider(p_subject_user_id uuid DEFAULT NULL, p_subject_actor_id uuid DEFAULT NULL,
  p_kinds text[] DEFAULT NULL, p_scope text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  orgs uuid[];
  v_org uuid;
  v_user uuid;
  kinds text[];
  request_key text;
  prev public.provider_vouches%ROWTYPE;
  new_id uuid := gen_random_uuid();
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF num_nonnulls(p_subject_user_id, p_subject_actor_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one of subject user id or subject actor id is required' USING ERRCODE = '22023';
  END IF;
  IF p_subject_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_subject_user_id) THEN
    RAISE EXCEPTION 'Provider unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_subject_actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.actors a WHERE a.id = p_subject_actor_id) THEN
    RAISE EXCEPTION 'Provider unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_subject_user_id = signer OR p_subject_actor_id::text IN (SELECT jsonb_array_elements_text(public.viewer_identity_bridge(signer)->'evidenced_actor_ids')) THEN
    RAISE EXCEPTION 'Cannot vouch for oneself' USING ERRCODE = '42501';
  END IF;
  kinds := ARRAY(SELECT DISTINCT x FROM unnest(p_kinds) x ORDER BY 1);
  IF COALESCE(cardinality(p_kinds), 0) = 0 OR cardinality(kinds) <> cardinality(p_kinds)
    OR EXISTS (SELECT 1 FROM unnest(p_kinds) x WHERE x IS NULL OR x NOT IN ('supervision','suitability','permission','availability')) THEN
    RAISE EXCEPTION 'Kinds must be distinct values of supervision, suitability, permission, availability' USING ERRCODE = '23514';
  END IF;
  IF p_scope IS NULL OR length(btrim(p_scope)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Scope of the vouch is required (at most 2000 characters)' USING ERRCODE = '23514';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'Expiry must be in the future' USING ERRCODE = '23514';
  END IF;
  orgs := ARRAY(SELECT DISTINCT y.x FROM (SELECT bo.business_id x FROM public.business_ownership bo WHERE bo.owner_id = signer AND bo.status = 'active'
    UNION SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = signer AND oc.status = 'active') y
    WHERE y.x IS NOT NULL ORDER BY 1);
  IF cardinality(orgs) = 1 THEN
    v_org := orgs[1];
  ELSIF cardinality(orgs) > 1 OR EXISTS (SELECT 1 FROM public.user_tools t WHERE t.user_id = signer)
    OR EXISTS (SELECT 1 FROM public.tool_inventory t WHERE t.owner_id = signer) THEN
    v_user := signer;
  ELSE
    RAISE EXCEPTION 'Vouch unavailable: needs_facility_organization_or_owned_tools' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('provider_vouch:'||COALESCE(v_org, v_user)::text||':'||COALESCE(p_subject_user_id, p_subject_actor_id)::text, 0));
  request_key := md5(jsonb_build_array('provider-vouch', v_org, v_user, p_subject_user_id, p_subject_actor_id, kinds, btrim(p_scope), p_expires_at)::text);
  SELECT * INTO prev FROM public.provider_vouches v
    WHERE v.withdrawn_at IS NULL AND v.voucher_organization_id IS NOT DISTINCT FROM v_org AND v.voucher_user_id IS NOT DISTINCT FROM v_user
      AND v.subject_user_id IS NOT DISTINCT FROM p_subject_user_id AND v.subject_actor_id IS NOT DISTINCT FROM p_subject_actor_id
    ORDER BY v.signed_at DESC LIMIT 1;
  IF prev.id IS NOT NULL AND prev.request_key = request_key AND (prev.expires_at IS NULL OR prev.expires_at > statement_timestamp()) THEN
    RETURN jsonb_build_object('vouch_id', prev.id, 'duplicate', true);
  END IF;
  PERFORM set_config('nuke.provider_vouch_sign', new_id::text, true);
  INSERT INTO public.provider_vouches(id, signer_user_id, voucher_user_id, voucher_organization_id, subject_user_id, subject_actor_id,
    kinds, scope, expires_at, request_key)
  VALUES (new_id, signer, v_user, v_org, p_subject_user_id, p_subject_actor_id, kinds, btrim(p_scope), p_expires_at, request_key);
  IF prev.id IS NOT NULL THEN
    PERFORM set_config('nuke.provider_vouch_sign', prev.id::text, true);
    UPDATE public.provider_vouches SET withdrawn_at = statement_timestamp(), withdrawn_by_user_id = signer, superseded_by = new_id WHERE id = prev.id;
  END IF;
  PERFORM set_config('nuke.provider_vouch_sign', '', true);
  RETURN jsonb_build_object('vouch_id', new_id, 'voucher', jsonb_build_object('kind', CASE WHEN v_org IS NOT NULL THEN 'organization' ELSE 'user' END,
      'organization_id', v_org, 'user_id', v_user),
    'subject', jsonb_build_object('user_id', p_subject_user_id, 'actor_id', p_subject_actor_id), 'kinds', to_jsonb(kinds),
    'scope', btrim(p_scope), 'expires_at', p_expires_at, 'supersedes_vouch_id', prev.id, 'duplicate', false,
    'skill_evidence', false, 'subject_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.vouch_for_provider(uuid,uuid,text[],text,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vouch_for_provider(uuid,uuid,text[],text,timestamptz) TO authenticated;
COMMENT ON FUNCTION public.vouch_for_provider(uuid,uuid,text[],text,timestamptz) IS 'Sign: a standing supervision/suitability/permission/availability vouch with scope for a provider account or work actor, by a single facility organization (owner/member) or a tool-owning or organization-member account. Never skill evidence; never for oneself.';

CREATE FUNCTION public.withdraw_vouch(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE signer uuid := auth.uid(); v public.provider_vouches%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.provider_vouches WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL OR NOT (v.signer_user_id = signer OR public.work_order_org_member(signer, v.voucher_organization_id)) THEN
    RAISE EXCEPTION 'Vouch unavailable' USING ERRCODE = '42501';
  END IF;
  IF v.withdrawn_at IS NOT NULL THEN RETURN jsonb_build_object('vouch_id', v.id, 'withdrawn_at', v.withdrawn_at, 'duplicate', true); END IF;
  PERFORM set_config('nuke.provider_vouch_sign', v.id::text, true);
  UPDATE public.provider_vouches SET withdrawn_at = statement_timestamp(), withdrawn_by_user_id = signer WHERE id = v.id;
  PERFORM set_config('nuke.provider_vouch_sign', '', true);
  RETURN jsonb_build_object('vouch_id', v.id, 'withdrawn_at', statement_timestamp(), 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_vouch(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_vouch(uuid) TO authenticated;
COMMENT ON FUNCTION public.withdraw_vouch(uuid) IS 'Sign: the signer, or a current owner/member of the vouching organization, withdraws a standing vouch (once).';

-- Current vouches for a provider, voucher by organization name or public handle.
CREATE FUNCTION public.provider_vouched_for_by(p_user_id uuid, p_actor_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
BEGIN
  RETURN jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object('vouch_id', v.id,
      'voucher', CASE WHEN v.voucher_organization_id IS NOT NULL THEN public.platform_organization_label(v.voucher_organization_id)
        ELSE public.platform_person_label(v.voucher_user_id) END,
      'kinds', to_jsonb(v.kinds), 'scope', v.scope, 'vouched_at', v.signed_at, 'expires_at', v.expires_at,
      'subject', CASE WHEN v.subject_user_id IS NOT NULL THEN 'account' ELSE 'work_actor' END,
      'attribution', 'authenticated_sign') ORDER BY v.signed_at DESC, v.id)
    FROM public.provider_vouches v
    WHERE v.withdrawn_at IS NULL AND (v.expires_at IS NULL OR v.expires_at > statement_timestamp())
      AND ((p_user_id IS NOT NULL AND v.subject_user_id = p_user_id) OR v.subject_actor_id = ANY (COALESCE(p_actor_ids, '{}'::uuid[])))), '[]'::jsonb),
    'basis', 'standing vouches signed by the voucher (supervision, suitability, permission, availability with scope); not skill evidence and never counted as capability');
END $$;
REVOKE ALL ON FUNCTION public.provider_vouched_for_by(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_vouched_for_by(uuid,uuid[]) TO service_role;

-- Authenticated co-sign attestations about resources the provider supplies or performs (same population as co_signed).
CREATE FUNCTION public.provider_authenticated_cosigns(p_user_id uuid, p_actor_ids uuid[])
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN (SELECT count(*) FROM public.work_order_resource_attestations at
    JOIN public.vehicle_observations so ON so.id = at.id AND so.is_superseded IS FALSE
    JOIN public.work_order_resource_fulfillments f ON f.id = at.fulfillment_id
    WHERE at.verdict = 'supports' AND at.attestor_user_id IS DISTINCT FROM p_user_id
      AND ((p_user_id IS NOT NULL AND (f.supplier_user_id = p_user_id
          OR f.user_tool_id IN (SELECT t.id FROM public.user_tools t WHERE t.user_id = p_user_id)))
        OR f.performer_actor_id = ANY (COALESCE(p_actor_ids, '{}'::uuid[])))
      AND public.work_order_attestation_authenticated(at.id));
END $$;
REVOKE ALL ON FUNCTION public.provider_authenticated_cosigns(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_authenticated_cosigns(uuid,uuid[]) TO service_role;

-- Backend provider_profile_read: two anchored additions on the live definition.
DO $$
DECLARE
  def text := pg_get_functiondef('public.provider_profile_read(uuid,uuid)'::regprocedure);
  a1 text := '''co_signed'', jsonb_build_object(''supporting_attestations'', cosigned,';
  a2 text := '''facilities'', facilities, ''identity_bridge'', idb,';
BEGIN
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 OR (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'provider_profile_read anchors not found exactly once';
  END IF;
  def := replace(def, a1, a1 || ' ''authenticated_attestations'', public.provider_authenticated_cosigns(p_user_id, actor_ids),'
    || ' ''authenticated_basis'', ''of these, statements signed by the attestor or an owner/member of the attesting organization (cosign_provider)'',');
  def := replace(def, a2, '''facilities'', facilities, ''vouched_for_by'', public.provider_vouched_for_by(p_user_id, actor_ids), ''identity_bridge'', idb,');
  EXECUTE def;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
