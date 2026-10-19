-- Best matches for a job owner: work_order_provider_matches_read(p_work_order_id) lists providers ranked only by how many
-- match inputs pass, with every input's pass / fail / unknown shown per requirement (the same explainable inputs as
-- open_requirements_read: skill, tools, facility, area, availability, evidence_rung). No hidden score.
--   Who may read: the work order's customer or an owner of its organization.
--   Who is listed: accounts with an evidenced provider link (approved work_evidence / co_sign / authenticated_sign claim)
--     or an active organization membership or ownership; never the reader or the customer. People appear by public
--     handle, otherwise as unnamed party; no contact fields. Contact goes through request_contact (public profiles only).
--   provider_requirement_match(user, ...): the six inputs for one account and one requirement (helpers from 20261020030000
--     and 20261020031000; skill and evidence rung as open_requirements_read states them).
--   Signature queue and actions are untouched.
-- Contract: supabase/sql/test_work_order_provider_matches.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.provider_requirement_match(p_user uuid, p_bridge jsonb, p_requirement jsonb, p_job_org uuid, p_candidates jsonb,
  p_work_order_id uuid, p_area jsonb, p_window jsonb, p_tool_keys jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  kind text := p_requirement->>'requirement_kind';
  dtext text := lower(COALESCE(p_requirement->>'description', ''));
  actors uuid[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_bridge->'evidenced_actor_ids', '[]'::jsonb))::uuid);
  caps text[];
  named text;
  orgs uuid[];
BEGIN
  caps := ARRAY(SELECT DISTINCT lower(c.capability_type) FROM public.actor_capabilities c
    WHERE c.actor_id = ANY (actors) AND COALESCE(c.evidence_count, 0) > 0 AND NULLIF(btrim(c.capability_type), '') IS NOT NULL);
  named := (SELECT string_agg(c, ', ') FROM unnest(caps) c WHERE dtext ~ ('\m' || regexp_replace(c, '\W', '', 'g') || '\M'));
  orgs := ARRAY(SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = p_user AND oc.status = 'active'
    UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active');
  RETURN jsonb_build_array(
    CASE WHEN kind NOT IN ('skill','inspection') THEN
        jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'not required for a ' || kind || ' requirement')
      WHEN cardinality(actors) = 0 THEN
        jsonb_build_object('input', 'skill', 'result', 'unknown', 'reason', 'no evidenced identity bridge; capability records belong to work actors')
      WHEN named IS NOT NULL THEN
        jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'capability ' || named || ' is named in the requirement')
      ELSE jsonb_build_object('input', 'skill', 'result', 'unknown',
        'reason', CASE WHEN cardinality(caps) = 0 THEN 'no evidence-derived capability records' ELSE 'capability records do not name this requirement' END) END,
    public.open_requirement_tools_input(p_user, kind, p_tool_keys, dtext),
    public.open_requirement_facility_input(orgs, p_requirement, p_job_org, p_candidates, p_work_order_id),
    public.open_requirement_area_input(p_user, p_area),
    public.open_requirement_availability_input(p_user, p_window),
    CASE p_bridge->>'state'
      WHEN 'evidenced' THEN jsonb_build_object('input', 'evidence_rung', 'result', 'pass', 'reason', 'evidenced identity bridge')
      WHEN 'claimed' THEN jsonb_build_object('input', 'evidence_rung', 'result', 'unknown', 'reason', 'self-claimed provider link awaiting evidence')
      ELSE jsonb_build_object('input', 'evidence_rung', 'result', 'fail', 'reason', 'no provider link claim') END);
END $$;

CREATE FUNCTION public.work_order_provider_matches_read(p_work_order_id uuid, p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  g jsonb;
  area jsonb;
  win jsonb;
  lim integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  cap constant integer := 500;
  n_cand integer;
  n_reqs integer;
  rows_out jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(uid, w.id) s;
  IF NOT COALESCE(my_slots && ARRAY['customer','org_owner'], false) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  g := public.read_work_order_resources(w.id);
  n_reqs := jsonb_array_length(COALESCE(g->'requirements', '[]'::jsonb));
  SELECT CASE WHEN NULLIF(btrim(v.state), '') IS NOT NULL OR NULLIF(btrim(v.city), '') IS NOT NULL
      THEN jsonb_build_object('city', NULLIF(btrim(v.city), ''), 'state', NULLIF(btrim(v.state), ''), 'basis', 'vehicle city/state')
    WHEN NULLIF(btrim(o.state), '') IS NOT NULL OR NULLIF(btrim(o.city), '') IS NOT NULL
      THEN jsonb_build_object('city', NULLIF(btrim(o.city), ''), 'state', NULLIF(btrim(o.state), ''), 'basis', 'shop city/state') END
    INTO area
  FROM public.work_orders x LEFT JOIN public.vehicles v ON v.id = x.vehicle_id LEFT JOIN public.organizations o ON o.id = x.organization_id
  WHERE x.id = w.id;
  win := public.work_order_job_window(w.id);

  WITH cand AS (
    SELECT c.user_id, 'evidenced_link' AS basis FROM public.account_link_claims c
      WHERE c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign') AND c.actor_id IS NOT NULL
    UNION SELECT oc.user_id, 'organization_member' FROM public.organization_contributors oc WHERE oc.status = 'active'
    UNION SELECT bo.owner_id, 'organization_owner' FROM public.business_ownership bo WHERE bo.status = 'active'
  ), people AS MATERIALIZED (
    SELECT c.user_id, jsonb_agg(DISTINCT c.basis) AS listed_because, public.viewer_identity_bridge(c.user_id) AS bridge
    FROM cand c WHERE c.user_id IS NOT NULL AND c.user_id <> uid AND c.user_id IS DISTINCT FROM w.customer_id
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id)
    GROUP BY c.user_id ORDER BY c.user_id LIMIT cap
  ), per AS (
    SELECT p.user_id, p.listed_because, p.bridge, q,
      public.provider_requirement_match(p.user_id, p.bridge, q, w.organization_id,
        (SELECT jsonb_agg(f ORDER BY f->>'id') FROM jsonb_array_elements(COALESCE(g->'fulfillments', '[]'::jsonb)) f WHERE f->>'requirement_id' = q->>'id'),
        w.id, area, win, public.requirement_tool_keys(q, g->'specifications')) AS inputs
    FROM people p, jsonb_array_elements(COALESCE(g->'requirements', '[]'::jsonb)) q
  ), tallied AS (
    SELECT p.user_id, p.listed_because, p.bridge->>'state' AS link_state,
      jsonb_agg(jsonb_build_object('requirement_id', p.q->'id', 'requirement_kind', p.q->'requirement_kind', 'description', p.q->'description',
        'passed', (SELECT count(*) FROM jsonb_array_elements(p.inputs) i WHERE i->>'result' = 'pass'), 'inputs', p.inputs) ORDER BY p.q->>'id') AS reqs,
      sum((SELECT count(*) FROM jsonb_array_elements(p.inputs) i WHERE i->>'result' = 'pass'))::int AS passed,
      sum((SELECT count(*) FROM jsonb_array_elements(p.inputs) i WHERE i->>'result' = 'fail'))::int AS failed,
      sum((SELECT count(*) FROM jsonb_array_elements(p.inputs) i WHERE i->>'result' = 'unknown'))::int AS unknown,
      sum(jsonb_array_length(p.inputs))::int AS inputs_total
    FROM per p GROUP BY p.user_id, p.listed_because, p.bridge->>'state'
  ), ranked AS (
    SELECT t.*, dense_rank() OVER (ORDER BY t.passed DESC) AS rank, public.platform_person_label(t.user_id) AS who FROM tallied t
  )
  SELECT (SELECT count(*) FROM people),
    COALESCE(jsonb_agg(jsonb_build_object('rank', r.rank, 'provider', r.who, 'listed_because', r.listed_because, 'link_state', COALESCE(r.link_state, 'none'),
      'passed', r.passed, 'failed', r.failed, 'unknown', r.unknown, 'inputs_total', r.inputs_total, 'requirements', r.reqs,
      'contact', CASE WHEN r.who ? 'profile_id' THEN jsonb_build_object('writer', 'request_contact', 'context_kind', 'work_order', 'context_id', w.id,
        'recipient_user_id', r.who->'profile_id') END)
      ORDER BY r.passed DESC, r.who->>'handle' NULLS LAST, r.user_id), '[]'::jsonb)
  INTO n_cand, rows_out
  FROM (SELECT * FROM ranked ORDER BY passed DESC, who->>'handle' NULLS LAST, user_id LIMIT lim) r;

  RETURN public.work_order_open_header(w.id, true) || jsonb_build_object(
    'work_order_id', w.id, 'as_of', statement_timestamp(), 'providers', rows_out,
    'ranking', 'by count of passed inputs only (ties share a rank); every input is shown; nothing is hidden or weighted',
    'inputs', jsonb_build_array('skill', 'tools', 'facility', 'area', 'availability', 'evidence_rung'),
    'job_area', area, 'job_window', win,
    'coverage', jsonb_build_object('requirements', n_reqs, 'providers_considered', COALESCE(n_cand, 0), 'providers_returned', jsonb_array_length(rows_out),
      'candidate_cap', cap, 'population', 'accounts with an evidenced provider link (approved work_evidence, co_sign or authenticated_sign claim) or an active organization membership or ownership; not the reader or the customer',
      'self_claims', 'availability and service area are self-claimed Signs; tools are claimed ownership'),
    'viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots, public.viewer_identity_bridge(uid), true),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; contact fields are never returned',
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.work_order_provider_matches_read(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_provider_matches_read(uuid,integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.work_order_provider_matches_read(uuid,integer) IS 'Best matches for the job''s customer or organization owner: providers (evidenced link or organization membership) ranked only by count of passed match inputs, every input shown per requirement. Handles only; no contact fields.';
NOTIFY pgrst, 'reload schema';
COMMIT;
