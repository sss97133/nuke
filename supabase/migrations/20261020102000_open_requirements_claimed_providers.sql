-- Matching counts claimed organizations as providers.
--
-- 20261020101000 lets a verified claimant (claim_organization) offer as its organization on open requirements. The
-- matching readers still looked only at actor links, organization memberships and ownership, so a claimant read as
-- "no provider link claim" and was never listed. This adds, for verified claimants only:
--   verified_claimant_match_inputs(user, requirement, inputs) (internal): upgrades the match inputs a reader computed
--     when the user is a verified claimant: skill passes on the claimed organizations' recorded service work
--     (organization_supply_evidence *_service kinds the requirement names) or declared capabilities
--     (organization_capabilities with evidence); tools pass on supply records for the kinds a tool/equipment requirement
--     names; evidence_rung passes as 'verified_claimant'. Inputs that already pass are left as they are.
--   open_requirements_read and provider_requirement_match (anchored): claimed organizations join the viewer's
--     organizations for the facility input (declared assets), and the inputs go through the helper.
--   work_order_provider_matches_read (anchored): verified claimants are candidates (listed_because 'verified_claimant')
--     and each row says which organizations they offer as ("Claimed on Nuke").
-- Organizations without a claim stay "Not on Nuke yet" (organization_on_nuke offer_capable false) and are not candidates.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.verified_claimant_match_inputs(p_user uuid, p_requirement jsonb, p_inputs jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  rkind text := p_requirement->>'requirement_kind';
  txt text := lower(COALESCE(p_requirement->>'description', ''));
  orgs uuid[];
  methods text[];
  svc jsonb;
  sup jsonb;
  caps jsonb;
  outv jsonb := '[]'::jsonb;
  i jsonb;
BEGIN
  IF p_user IS NULL OR jsonb_typeof(p_inputs) IS DISTINCT FROM 'array' THEN RETURN p_inputs; END IF;
  SELECT array_agg(c.organization_id ORDER BY c.organization_id), array_agg(DISTINCT c.method) INTO orgs, methods
    FROM public.organization_verified_claimants c WHERE c.user_id = p_user AND c.revoked_at IS NULL;
  IF orgs IS NULL THEN RETURN p_inputs; END IF;
  WITH kinds AS (
    SELECT DISTINCT unnest(k.supply_kinds) AS kind FROM public.supply_requirement_keywords k WHERE txt ~ ('\m(' || k.pattern || ')')
  ), hits AS (
    SELECT e.organization_id, e.supply_kind, count(DISTINCT (e.basis_table, e.basis_id)) AS n
    FROM public.organization_supply_evidence e JOIN kinds ON kinds.kind = e.supply_kind
    WHERE e.organization_id = ANY (orgs) GROUP BY e.organization_id, e.supply_kind
  )
  SELECT jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id), 'kind', h.supply_kind, 'records', h.n)
      ORDER BY h.organization_id, h.supply_kind) FILTER (WHERE h.supply_kind LIKE '%\_service'),
    jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id), 'kind', h.supply_kind, 'records', h.n)
      ORDER BY h.organization_id, h.supply_kind) FILTER (WHERE h.supply_kind NOT LIKE '%\_service')
    INTO svc, sup FROM hits h;
  SELECT jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(oc.organization_id), 'capability', lower(oc.capability_type),
      'evidence_count', oc.evidence_count) ORDER BY oc.organization_id, lower(oc.capability_type))
    INTO caps FROM public.organization_capabilities oc
    WHERE oc.organization_id = ANY (orgs) AND oc.is_active IS NOT FALSE AND COALESCE(oc.evidence_count, 0) > 0
      AND NULLIF(btrim(oc.capability_type), '') IS NOT NULL
      AND txt ~ ('\m' || regexp_replace(lower(oc.capability_type), '\W', '', 'g') || '\M');
  FOR i IN SELECT x FROM jsonb_array_elements(p_inputs) x LOOP
    IF i->>'result' IS DISTINCT FROM 'pass' THEN
      IF i->>'input' = 'skill' AND rkind IN ('skill', 'inspection') AND (svc IS NOT NULL OR caps IS NOT NULL) THEN
        i := jsonb_build_object('input', 'skill', 'result', 'pass', 'basis', 'verified_claimant',
          'reason', 'an organization you verified for has recorded this kind of work on Nuke',
          'organization_evidence', COALESCE(svc, '[]'::jsonb) || COALESCE(caps, '[]'::jsonb));
      ELSIF i->>'input' = 'tools' AND rkind IN ('tool', 'equipment') AND sup IS NOT NULL THEN
        i := jsonb_build_object('input', 'tools', 'result', 'pass', 'basis', 'verified_claimant',
          'reason', 'an organization you verified for has supplied this kind of item on Nuke', 'organization_evidence', sup);
      ELSIF i->>'input' = 'evidence_rung' THEN
        i := jsonb_build_object('input', 'evidence_rung', 'result', 'pass', 'rung', 'verified_claimant',
          'reason', 'verified business claim (' || array_to_string(methods, ', ') || ')');
      END IF;
    END IF;
    outv := outv || jsonb_build_array(i);
  END LOOP;
  RETURN outv;
END $$;
REVOKE ALL ON FUNCTION public.verified_claimant_match_inputs(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  IF position('verified_claimant' IN def) > 0 THEN RAISE EXCEPTION 'open_requirements_read: already edited'; END IF;
  anchor := $a$      UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = uid AND bo.status = 'active');$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'open_requirements_read: orgs anchor found % times', n; END IF;
  def := replace(def, anchor, $r$      UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = uid AND bo.status = 'active'
      UNION SELECT vc.organization_id FROM public.organization_verified_claimants vc WHERE vc.user_id = uid AND vc.revoked_at IS NULL);$r$);
  anchor := $a$'match', CASE WHEN uid IS NULL THEN NULL ELSE jsonb_build_array($a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'open_requirements_read: match anchor found % times', n; END IF;
  def := replace(def, anchor, $r$'match', CASE WHEN uid IS NULL THEN NULL ELSE public.verified_claimant_match_inputs(uid, b.q, jsonb_build_array($r$);
  anchor := $a$'reason', 'no provider link claim') END) END)$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'open_requirements_read: match end anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$'reason', 'no provider link claim') END)) END)$r$);

  def := pg_get_functiondef('public.provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  IF position('verified_claimant' IN def) > 0 THEN RAISE EXCEPTION 'provider_requirement_match: already edited'; END IF;
  anchor := $a$    UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active');$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'provider_requirement_match: orgs anchor found % times', n; END IF;
  def := replace(def, anchor, $r$    UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active'
    UNION SELECT vc.organization_id FROM public.organization_verified_claimants vc WHERE vc.user_id = p_user AND vc.revoked_at IS NULL);$r$);
  anchor := $a$  RETURN jsonb_build_array($a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'provider_requirement_match: return anchor found % times', n; END IF;
  def := replace(def, anchor, $r$  RETURN public.verified_claimant_match_inputs(p_user, p_requirement, jsonb_build_array($r$);
  anchor := $a$'reason', 'no provider link claim') END);$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'provider_requirement_match: return end anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$'reason', 'no provider link claim') END));$r$);

  def := pg_get_functiondef('public.work_order_provider_matches_read(uuid,integer)'::regprocedure);
  IF position('verified_claimant' IN def) > 0 THEN RAISE EXCEPTION 'work_order_provider_matches_read: already edited'; END IF;
  anchor := $a$    UNION SELECT bo.owner_id, 'organization_owner' FROM public.business_ownership bo WHERE bo.status = 'active'$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read: candidates anchor found % times', n; END IF;
  def := replace(def, anchor, anchor || $r$
    UNION SELECT vc.user_id, 'verified_claimant' FROM public.organization_verified_claimants vc WHERE vc.revoked_at IS NULL$r$);
  anchor := $a$'listed_because', r.listed_because,$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read: row anchor found % times', n; END IF;
  def := replace(def, anchor, anchor || $r$
      'offers_as', (SELECT jsonb_agg(public.platform_organization_label(vc.organization_id) || jsonb_build_object('on_nuke', 'Claimed on Nuke')
        ORDER BY vc.organization_id) FROM public.organization_verified_claimants vc WHERE vc.user_id = r.user_id AND vc.revoked_at IS NULL),$r$);
  anchor := $a$or an active organization membership or ownership;$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'work_order_provider_matches_read: population anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, $r$or an active organization membership, ownership or verified business claim (claim_organization);$r$);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;
