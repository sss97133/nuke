-- Organization supply evidence as CORROBORATION on the skill input, never as proven skill.
-- A verified claimant of an organization (organization_verified_claimants, 20261020101000) sees, beside the skill answer,
-- the times that organization was paid for a service kind that maps to one of the requirement's capability keys:
--   supply_kind_capability_map (reviewed): service kinds only (upholstery_service, plating_service); parts kinds say what was
--     bought, not what anyone can do, and are not mapped.
--   supply_skill_corroboration(user, capability keys): [{organization (label), kind, capability, records, label 'paid for this
--     kind of work n times', strength 'corroborating', basis}] or NULL.
--   open_requirement_skill_input is now a wrapper: the evidence-derived answer (renamed open_requirement_skill_input_evidence,
--     unchanged) plus supply_corroboration only when there is some. result, basis and every other field are untouched, so
--     a pass still comes only from evidence_fold capabilities. Additive.
-- verified_claimant_match_inputs (supply lane, 20261020102000) is not edited.
-- Contract: supabase/sql/test_skill_supply_corroboration.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.supply_kind_capability_map (
  supply_kind text NOT NULL CHECK (supply_kind ~ '^[a-z_]+_service$'),
  capability_type text NOT NULL,
  note text NOT NULL,
  PRIMARY KEY (supply_kind, capability_type)
);
ALTER TABLE public.supply_kind_capability_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY supply_kind_capability_map_read ON public.supply_kind_capability_map FOR SELECT USING (true);
REVOKE ALL ON public.supply_kind_capability_map FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supply_kind_capability_map TO anon, authenticated;
GRANT ALL ON public.supply_kind_capability_map TO service_role;
COMMENT ON TABLE public.supply_kind_capability_map IS 'Reviewed (20261020135000): organization supply service kinds onto capability types, for corroboration on the skill input only (paid for this kind of work, not proven skill). Parts kinds are never mapped.';
INSERT INTO public.supply_kind_capability_map(supply_kind, capability_type, note) VALUES
  ('upholstery_service', 'upholstery_full', 'paid for upholstery service (receipts); seats re-covered is full upholstery'),
  ('upholstery_service', 'upholstery_repair', 'paid for upholstery service (receipts)'),
  ('plating_service', 'chrome_plating', 'paid for plating service (receipts)');

CREATE FUNCTION public.supply_skill_corroboration(p_user uuid, p_capability_keys jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(h.organization_id), 'kind', h.supply_kind,
      'capability', h.capability_type, 'records', h.n, 'label', 'paid for this kind of work ' || h.n || CASE WHEN h.n = 1 THEN ' time' ELSE ' times' END,
      'strength', 'corroborating', 'basis', 'organization supply evidence (receipts) of an organization you are a verified claimant for; not evidence of skill')
    ORDER BY h.organization_id, h.supply_kind, h.capability_type)
  FROM (
    SELECT e.organization_id, e.supply_kind, m.capability_type, count(DISTINCT (e.basis_table, e.basis_id)) AS n
    FROM public.organization_verified_claimants c
    JOIN public.organization_supply_evidence e ON e.organization_id = c.organization_id
    JOIN public.supply_kind_capability_map m ON m.supply_kind = e.supply_kind
    WHERE p_user IS NOT NULL AND c.user_id = p_user AND c.revoked_at IS NULL
      AND m.capability_type IN (SELECT x->>'key' FROM jsonb_array_elements(COALESCE(p_capability_keys, '[]'::jsonb)) x)
    GROUP BY e.organization_id, e.supply_kind, m.capability_type
  ) h
$$;

DO $wrap$
BEGIN
  IF to_regprocedure('public.open_requirement_skill_input_evidence(uuid,jsonb,text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'open_requirement_skill_input is already wrapped';
  END IF;
  IF position('evidence_fold_against_only' IN pg_get_functiondef('public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'open_requirement_skill_input is not the evidence-derived skill input';
  END IF;
END $wrap$;
ALTER FUNCTION public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text) RENAME TO open_requirement_skill_input_evidence;
CREATE FUNCTION public.open_requirement_skill_input(p_user uuid, p_bridge jsonb, p_kind text, p_capability_keys jsonb, p_text text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN c IS NULL THEN s ELSE s || jsonb_build_object('supply_corroboration', c) END
  FROM (SELECT public.open_requirement_skill_input_evidence(p_user, p_bridge, p_kind, p_capability_keys, p_text) AS s,
      CASE WHEN p_kind IN ('skill', 'inspection') THEN public.supply_skill_corroboration(p_user, p_capability_keys) END AS c) x
$$;
REVOKE ALL ON FUNCTION public.supply_skill_corroboration(uuid,jsonb), public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text),
  public.open_requirement_skill_input_evidence(uuid,jsonb,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supply_skill_corroboration(uuid,jsonb), public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text),
  public.open_requirement_skill_input_evidence(uuid,jsonb,text,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.open_requirement_skill_input(uuid,jsonb,text,jsonb,text) IS 'Skill input: the evidence-derived answer (open_requirement_skill_input_evidence) plus supply_corroboration (organization paid-for service kinds of a verified claimant, corroborating only) when present.';
COMMIT;
