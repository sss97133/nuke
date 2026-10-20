-- Verified claimants: supply evidence is never competence (lead decision, 2026-10-19 K3).
-- 20261020102000 (supply lane) let verified_claimant_match_inputs turn the skill input into a pass on an organization's
-- paid-for service records or its declared capabilities, and the tools input into a pass on records of supplying that kind
-- of item. Being paid for a kind of purchase is not evidence the organization performs that work, and selling a tool is not
-- having it for the job. Reconciled (guarded edits; the supply lane was told in LANES):
--   verified_claimant_match_inputs (performer role):
--     skill  - passes only on completions the organization performed through Nuke and the customer accepted (an accepted
--              offer of the organization on a job with a completion acceptance, whose requirements share a capability key
--              with this one). Paid-for service records ("paid for this kind of work n times") and declared capability
--              records are attached as organization_corroboration; the result stays as the evidence-derived input left it.
--     tools  - supplying this kind of item leaves the result unknown, with the supplier evidence and a note; the Plan-B role
--              is where it counts.
--     evidence_rung (verified business claim) and the facility input (claimed organizations' declared assets) unchanged.
--   requirement_plan_b_suppliers (role plan_b_supplier): each supplier gains supplier_result 'pass' and supplier_label
--     'can supply this' (additive).
--   open_requirements_read rows gain match_role 'performer'; work_order_provider_matches_read rows gain role 'performer',
--     ranking says performers rank on performer inputs only, and a separate plan_b_suppliers list per requirement.
-- Contract: supabase/sql/test_verified_claimant_roles.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF position($a$'reason', 'an organization you verified for has recorded this kind of work on Nuke',$a$
      IN pg_get_functiondef('public.verified_claimant_match_inputs(uuid,jsonb,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'verified_claimant_match_inputs is not the 20261020102000 body; refusing to replace it';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.verified_claimant_match_inputs(p_user uuid, p_requirement jsonb, p_inputs jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  rkind text := p_requirement->>'requirement_kind';
  txt text := lower(COALESCE(p_requirement->>'description', ''));
  rk text[];
  orgs uuid[];
  methods text[];
  svc jsonb;
  sup jsonb;
  caps jsonb;
  done jsonb;
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
  SELECT jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id), 'kind', h.supply_kind, 'records', h.n,
        'label', 'paid for this kind of work ' || h.n || CASE WHEN h.n = 1 THEN ' time' ELSE ' times' END, 'strength', 'corroborating')
      ORDER BY h.organization_id, h.supply_kind) FILTER (WHERE h.supply_kind LIKE '%\_service'),
    jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id), 'kind', h.supply_kind, 'records', h.n,
        'label', 'can supply this', 'role', 'plan_b_supplier')
      ORDER BY h.organization_id, h.supply_kind) FILTER (WHERE h.supply_kind NOT LIKE '%\_service')
    INTO svc, sup FROM hits h;
  SELECT jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(oc.organization_id), 'capability', lower(oc.capability_type),
      'evidence_count', oc.evidence_count, 'label', 'declared capability record', 'strength', 'stated') ORDER BY oc.organization_id, lower(oc.capability_type))
    INTO caps FROM public.organization_capabilities oc
    WHERE oc.organization_id = ANY (orgs) AND oc.is_active IS NOT FALSE AND COALESCE(oc.evidence_count, 0) > 0
      AND NULLIF(btrim(oc.capability_type), '') IS NOT NULL
      AND txt ~ ('\m' || regexp_replace(lower(oc.capability_type), '\W', '', 'g') || '\M');
  IF rkind IN ('skill', 'inspection') THEN
    rk := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(public.requirement_capability_keys(p_requirement, NULL)) x);
    SELECT jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(z.org), 'jobs_completed_and_accepted', z.jobs) ORDER BY z.org)
      INTO done
    FROM (SELECT f.supplier_organization_id AS org, count(DISTINCT f.work_order_id) AS jobs
      FROM public.work_order_resource_fulfillments f
      JOIN public.work_order_assignments asg ON asg.fulfillment_id = f.id AND asg.acceptance_observation_id IS NOT NULL
      JOIN public.work_order_completion_acceptances a ON a.work_order_id = f.work_order_id
      WHERE f.supplier_organization_id = ANY (orgs) AND cardinality(rk) > 0
        AND EXISTS (SELECT 1 FROM public.work_order_resource_requirements r,
            jsonb_array_elements(public.requirement_capability_keys(jsonb_build_object('description', r.description, 'line_item_id', r.line_item_id), NULL)) k
          WHERE r.work_order_id = f.work_order_id AND k->>'key' = ANY (rk))
      GROUP BY f.supplier_organization_id) z;
  END IF;
  FOR i IN SELECT x FROM jsonb_array_elements(p_inputs) x LOOP
    IF i->>'input' = 'skill' AND rkind IN ('skill', 'inspection') AND i->>'result' IS DISTINCT FROM 'pass' THEN
      IF done IS NOT NULL THEN
        i := jsonb_build_object('input', 'skill', 'result', 'pass', 'basis', 'organization_completed_on_nuke',
          'reason', 'an organization you verified for completed this kind of work on Nuke and the customer accepted it',
          'capability_keys', to_jsonb(rk), 'organization_evidence', done);
      ELSIF svc IS NOT NULL OR caps IS NOT NULL THEN
        i := i || jsonb_build_object('organization_corroboration', COALESCE(svc, '[]'::jsonb) || COALESCE(caps, '[]'::jsonb),
          'organization_corroboration_basis', 'paid-for service records and declared capabilities of an organization you verified for: corroborating, not evidence of skill');
      END IF;
    ELSIF i->>'input' = 'tools' AND rkind IN ('tool', 'equipment') AND i->>'result' IS DISTINCT FROM 'pass' AND sup IS NOT NULL THEN
      i := i || jsonb_build_object('result', 'unknown', 'role', 'performer', 'basis', 'organization_supplies_this_kind',
        'reason', 'an organization you verified for can supply this kind of item (Plan-B supplier role); supplying it is not having it for the work',
        'supplier_evidence', sup);
    ELSIF i->>'input' = 'evidence_rung' AND i->>'result' IS DISTINCT FROM 'pass' THEN
      i := jsonb_build_object('input', 'evidence_rung', 'result', 'pass', 'rung', 'verified_claimant',
        'reason', 'verified business claim (' || array_to_string(methods, ', ') || ')');
    END IF;
    outv := outv || jsonb_build_array(i);
  END LOOP;
  RETURN outv;
END $$;

DO $apply$
DECLARE
  pdef text := pg_get_functiondef('public.requirement_plan_b_suppliers(text,integer)'::regprocedure);
  odef text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  wdef text := pg_get_functiondef('public.work_order_provider_matches_read(uuid,integer)'::regprocedure);
  p1 constant text := $a$'role', 'plan_b_supplier',$a$;
  o1 constant text := $a$'match', CASE WHEN uid IS NULL THEN NULL ELSE public.verified_claimant_match_inputs($a$;
  w1 constant text := $a$jsonb_build_object('rank', r.rank,$a$;
  w2 constant text := $a$'ranking', 'by count of passed inputs only (ties share a rank); every input is shown; nothing is hidden or weighted',$a$;
BEGIN
  IF position('supplier_label' IN pdef) > 0 OR position('match_role' IN odef) > 0 OR position($a$'role', 'performer'$a$ IN wdef) > 0 THEN
    RAISE EXCEPTION 'roles already applied';
  END IF;
  IF (length(pdef) - length(replace(pdef, p1, ''))) / length(p1) <> 1 THEN RAISE EXCEPTION 'plan-B role anchor not found once'; END IF;
  IF (length(odef) - length(replace(odef, o1, ''))) / length(o1) <> 1 THEN RAISE EXCEPTION 'open_requirements_read match anchor not found once'; END IF;
  IF (length(wdef) - length(replace(wdef, w1, ''))) / length(w1) <> 1 THEN RAISE EXCEPTION 'matches row anchor not found once'; END IF;
  IF (length(wdef) - length(replace(wdef, w2, ''))) / length(w2) <> 1 THEN RAISE EXCEPTION 'matches ranking anchor not found once'; END IF;
  EXECUTE replace(pdef, p1, p1 || $r$ 'supplier_result', 'pass', 'supplier_label', 'can supply this',$r$);
  EXECUTE replace(odef, o1, $r$'match_role', 'performer', $r$ || o1);
  wdef := replace(wdef, w1, $r$jsonb_build_object('rank', r.rank, 'role', 'performer',$r$);
  wdef := replace(wdef, w2, $r$'ranking', 'performers by count of passed performer inputs only (ties share a rank); every input is shown; nothing is hidden or weighted; supply records never count as performer evidence (Plan-B suppliers are listed separately)',
    'plan_b_suppliers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('requirement_id', q->'id', 'requirement_kind', q->'requirement_kind',
        'description', q->'description', 'suppliers', s.sup) ORDER BY q->>'id'), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(g->'requirements', '[]'::jsonb)) q, LATERAL (SELECT public.requirement_plan_b_suppliers(q->>'description', 5) AS sup) s
      WHERE q->>'requirement_kind' IN ('tool', 'equipment', 'facility', 'skill') AND jsonb_array_length(s.sup) > 0),$r$);
  EXECUTE wdef;
END $apply$;
COMMIT;
