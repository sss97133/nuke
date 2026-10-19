-- Jobs looking for a provider (owner: route jobs to "the most accessible user labor provider"). Matching is an
-- explainable join over evidence, never a score (THEORY.md section 6).
--
-- open_requirements_read(p_after, p_limit, p_kind): current requirements of the resource graph that are open for
-- providers. work_orders has no marketplace / published flag, so the rule is: the requirement is current
-- (read_work_order_resources), its work order is not concluded (status not completed, paid, cancelled or rejected),
-- and its vehicle is public. No candidate acceptance is recorded anywhere yet, so listed candidates do not close a
-- requirement; their count is returned with candidate_acceptance 'not_recorded'.
-- Each row: kind, description, quantity/unit, requested specifications, the work order's display title, vehicle label
-- and status, an area band (vehicle city/state when public, else the public shop's city/state; never a street address
-- or coordinates), the candidates' stated window, and quote state. Open data; no customer, no money, no excerpts.
-- For a signed-in viewer, match[] lists one row per input with result pass|fail|unknown and its reason: skill
-- (actor_capabilities through an evidenced identity bridge, named in the requirement), tools (claimed user_tools
-- category or description named in the requirement), facility (membership or ownership of the job's shop or proposed
-- facility), area (both sides public), availability (unknown: no standing availability exists) and evidence rung.
-- A missing resource reads next:'plan_b_supplier_needed'; nothing disqualifies. Anonymous viewers get no match.
-- Contract: supabase/sql/test_open_requirements_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.open_requirements_read(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 25, p_kind text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  lim integer;
  bridge jsonb;
  v_actors uuid[] := '{}';
  v_caps text[] := '{}';
  v_tools text[] := '{}';
  v_orgs uuid[] := '{}';
  v_city text;
  v_state text;
  total integer;
  rows_out jsonb;
  next_after uuid;
  population jsonb;
BEGIN
  IF p_kind IS NOT NULL AND p_kind NOT IN ('tool','equipment','facility','skill','inspection','approval') THEN
    RAISE EXCEPTION 'Unknown requirement kind %', p_kind USING ERRCODE = '22023';
  END IF;
  lim := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  bridge := public.viewer_identity_bridge(uid);
  IF uid IS NOT NULL THEN
    v_actors := ARRAY(SELECT jsonb_array_elements_text(bridge->'evidenced_actor_ids')::uuid);
    v_caps := ARRAY(SELECT DISTINCT lower(c.capability_type) FROM public.actor_capabilities c
      WHERE c.actor_id = ANY (v_actors) AND COALESCE(c.evidence_count, 0) > 0 AND NULLIF(btrim(c.capability_type), '') IS NOT NULL);
    v_tools := ARRAY(SELECT DISTINCT lower(btrim(x)) FROM public.user_tools t, LATERAL unnest(ARRAY[t.category, t.description]) x
      WHERE t.user_id = uid AND length(btrim(COALESCE(x, ''))) >= 3);
    v_orgs := ARRAY(SELECT oc.organization_id FROM public.organization_contributors oc WHERE oc.user_id = uid AND oc.status = 'active'
      UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = uid AND bo.status = 'active');
    SELECT CASE WHEN p.is_public IS TRUE THEN NULLIF(btrim(p.city), '') END, CASE WHEN p.is_public IS TRUE THEN NULLIF(btrim(p.state), '') END
      INTO v_city, v_state FROM public.profiles p WHERE p.id = uid;
  END IF;

  WITH wos AS MATERIALIZED (
    SELECT w.id, w.status, w.organization_id, v.city AS veh_city, v.state AS veh_state,
      o.is_public AS org_public, o.city AS o_city, o.state AS o_state
    FROM public.work_orders w JOIN public.vehicles v ON v.id = w.vehicle_id AND v.is_public IS TRUE
    LEFT JOIN public.organizations o ON o.id = w.organization_id
    WHERE COALESCE(w.status, 'pending') NOT IN ('completed','paid','cancelled','rejected')
      AND EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id)
  ), graphs AS MATERIALIZED (
    SELECT w.*, public.read_work_order_resources(w.id) AS g FROM wos w
  ), reqs AS MATERIALIZED (
    SELECT (q->>'id')::uuid AS id, g.id AS work_order_id, g.status, g.organization_id, q, g.g,
      g.veh_city, g.veh_state, g.org_public, g.o_city, g.o_state
    FROM graphs g, jsonb_array_elements(g.g->'requirements') q
    WHERE p_kind IS NULL OR q->>'requirement_kind' = p_kind
  ), page AS (
    SELECT * FROM reqs WHERE p_after IS NULL OR id > p_after ORDER BY id LIMIT lim + 1
  ), shown AS (SELECT * FROM page ORDER BY id LIMIT lim),
  built AS (
    SELECT s.*,
      (SELECT jsonb_agg(f ORDER BY f->>'id') FROM jsonb_array_elements(s.g->'fulfillments') f WHERE f->>'requirement_id' = s.id::text) AS cands,
      CASE WHEN NULLIF(btrim(s.veh_state), '') IS NOT NULL OR NULLIF(btrim(s.veh_city), '') IS NOT NULL
        THEN jsonb_build_object('city', NULLIF(btrim(s.veh_city), ''), 'state', NULLIF(btrim(s.veh_state), ''), 'basis', 'public vehicle city/state')
        WHEN s.org_public IS TRUE AND (NULLIF(btrim(s.o_state), '') IS NOT NULL OR NULLIF(btrim(s.o_city), '') IS NOT NULL)
        THEN jsonb_build_object('city', NULLIF(btrim(s.o_city), ''), 'state', NULLIF(btrim(s.o_state), ''), 'basis', 'public shop city/state') END AS area,
      public.work_order_quote_state(s.work_order_id) AS qs,
      lower(COALESCE(s.q->>'description', '')) AS dtext
    FROM shown s
  )
  SELECT COALESCE(jsonb_agg(public.work_order_open_header(b.work_order_id, false) || jsonb_build_object(
      'requirement_id', b.id, 'requirement_kind', b.q->>'requirement_kind', 'description', b.q->>'description',
      'quantity', b.q->'quantity', 'unit', b.q->'unit', 'work_order_id', b.work_order_id, 'work_order_status', b.status,
      'specifications', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', sp->>'specification_stage', 'material_role', sp->>'material_role',
          'material_label', sp->>'material_label', 'material_key', sp->>'material_key', 'process_label', sp->>'process_label',
          'process_key', sp->>'process_key') ORDER BY sp->>'id')
        FROM jsonb_array_elements(COALESCE(b.g->'specifications', '[]'::jsonb)) sp
        WHERE sp->>'specification_stage' = 'requested' AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = b.q->>'line_item_id')), '[]'::jsonb),
      'area_band', b.area,
      'window', (SELECT CASE WHEN count(f->>'available_from') > 0 THEN jsonb_build_object('available_from', min(f->>'available_from'),
          'available_until', max(f->>'available_until'), 'basis', 'stated by listed candidates') END
        FROM jsonb_array_elements(COALESCE(b.cands, '[]'::jsonb)) f),
      'candidates_listed', jsonb_array_length(COALESCE(b.cands, '[]'::jsonb)), 'candidate_acceptance', 'not_recorded',
      'quote_state', jsonb_build_object('has_current_quote', jsonb_typeof(b.qs->'current_quote') = 'object',
        'quote_versions', b.qs->'quote_versions', 'acceptance', b.qs#>'{acceptance,state}'),
      'match', CASE WHEN uid IS NULL THEN NULL ELSE jsonb_build_array(
        CASE WHEN b.q->>'requirement_kind' NOT IN ('skill','inspection') THEN
            jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'not required for a ' || (b.q->>'requirement_kind') || ' requirement')
          WHEN cardinality(v_actors) = 0 THEN
            jsonb_build_object('input', 'skill', 'result', 'unknown', 'reason', 'no evidenced identity bridge; capability records belong to work actors')
          WHEN EXISTS (SELECT 1 FROM unnest(v_caps) c WHERE b.dtext ~ ('\m' || regexp_replace(c, '\W', '', 'g') || '\M')) THEN
            jsonb_build_object('input', 'skill', 'result', 'pass', 'reason', 'capability ' || (SELECT string_agg(c, ', ') FROM unnest(v_caps) c
              WHERE b.dtext ~ ('\m' || regexp_replace(c, '\W', '', 'g') || '\M')) || ' is named in the requirement')
          ELSE jsonb_build_object('input', 'skill', 'result', 'unknown',
            'reason', CASE WHEN cardinality(v_caps) = 0 THEN 'no evidence-derived capability records'
              ELSE 'capability records do not name this requirement' END) END,
        CASE WHEN b.q->>'requirement_kind' NOT IN ('tool','equipment') THEN
            jsonb_build_object('input', 'tools', 'result', 'pass', 'reason', 'not required for a ' || (b.q->>'requirement_kind') || ' requirement')
          WHEN EXISTS (SELECT 1 FROM unnest(v_tools) t WHERE strpos(b.dtext, t) > 0) THEN
            jsonb_build_object('input', 'tools', 'result', 'pass', 'reason', 'claimed tool record named in the requirement: '
              || (SELECT string_agg(t, ', ') FROM (SELECT t FROM unnest(v_tools) t WHERE strpos(b.dtext, t) > 0 ORDER BY t LIMIT 3) x)
              || ' (claimed ownership, not physical verification)')
          ELSE jsonb_build_object('input', 'tools', 'result', 'fail', 'next', 'plan_b_supplier_needed',
            'reason', CASE WHEN cardinality(v_tools) = 0 THEN 'no claimed tool records' ELSE 'no claimed tool record names this requirement' END) END,
        CASE WHEN b.q->>'requirement_kind' NOT IN ('facility','equipment') THEN
            jsonb_build_object('input', 'facility', 'result', 'pass', 'reason', 'not required for a ' || (b.q->>'requirement_kind') || ' requirement')
          WHEN b.organization_id = ANY (v_orgs) OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(b.cands, '[]'::jsonb)) f
              WHERE (f->>'facility_organization_id')::uuid = ANY (v_orgs)) THEN
            jsonb_build_object('input', 'facility', 'result', 'pass', 'reason', 'member or owner of the job''s shop or proposed facility (access for this job not attested)')
          WHEN cardinality(v_orgs) > 0 THEN
            jsonb_build_object('input', 'facility', 'result', 'unknown', 'next', 'plan_b_supplier_needed',
              'reason', 'member of another organization; its facilities are not assessed against this requirement')
          ELSE jsonb_build_object('input', 'facility', 'result', 'fail', 'next', 'plan_b_supplier_needed', 'reason', 'no organization membership or ownership') END,
        CASE WHEN b.area IS NULL OR v_state IS NULL THEN
            jsonb_build_object('input', 'area', 'result', 'unknown', 'reason', CASE WHEN b.area IS NULL THEN 'job area not public' ELSE 'your public profile states no area' END)
          WHEN lower(v_state) = lower(COALESCE(b.area->>'state', '')) THEN
            jsonb_build_object('input', 'area', 'result', 'pass', 'reason', 'same state'
              || CASE WHEN v_city IS NOT NULL AND lower(v_city) = lower(COALESCE(b.area->>'city', '')) THEN ' and city' ELSE '' END)
          ELSE jsonb_build_object('input', 'area', 'result', 'fail', 'reason', 'different state (travel or remote work not assessed)') END,
        jsonb_build_object('input', 'availability', 'result', 'unknown', 'reason', 'no standing availability is recorded yet'),
        CASE bridge->>'state'
          WHEN 'evidenced' THEN jsonb_build_object('input', 'evidence_rung', 'result', 'pass', 'reason', 'evidenced identity bridge')
          WHEN 'claimed' THEN jsonb_build_object('input', 'evidence_rung', 'result', 'unknown', 'reason', 'self-claimed provider link awaiting evidence')
          ELSE jsonb_build_object('input', 'evidence_rung', 'result', 'fail', 'next', 'claim_provider_link', 'reason', 'no provider link claim') END) END)
      ORDER BY b.id), '[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page) > lim THEN (SELECT id FROM shown ORDER BY id DESC LIMIT 1) END,
    (SELECT count(*) FROM reqs),
    jsonb_build_object('requirements_total', (SELECT count(*) FROM public.work_order_resource_requirements),
      'work_orders_with_requirements', (SELECT count(DISTINCT work_order_id) FROM public.work_order_resource_requirements),
      'open_work_orders_with_requirements', (SELECT count(*) FROM wos),
      'open_requirements', (SELECT count(*) FROM reqs))
    INTO rows_out, next_after, total, population FROM built b;

  RETURN jsonb_build_object(
    'viewer', public.job_reader_viewer(CASE WHEN uid IS NULL THEN 'visitor' ELSE 'provider' END, '{}', bridge, false),
    'as_of', statement_timestamp(), 'rows', rows_out, 'next_after', next_after,
    'match_basis', CASE WHEN uid IS NULL THEN 'sign in to see how your evidence matches each requirement'
      ELSE 'explainable per-input join over your evidence; no score, nothing disqualifies' END,
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'total_open', total, 'kind_filter', p_kind,
      'population', population,
      'rule', 'current requirement; work order not completed, paid, cancelled or rejected; public vehicle (no marketplace flag exists)',
      'not_assessed', jsonb_build_array('candidate acceptance', 'distance', 'standing availability', 'price')),
    'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', false));
END $$;
REVOKE ALL ON FUNCTION public.open_requirements_read(uuid, integer, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.open_requirements_read(uuid, integer, text) TO anon, authenticated;
COMMENT ON FUNCTION public.open_requirements_read(uuid, integer, text) IS 'Open requirements on open, public-vehicle work orders with display title, vehicle label, area band (city/state only), window, quote state; for signed-in viewers an explainable per-input match (pass/fail/unknown with reason, plan_b_supplier_needed for missing resources). No scores, PII or money.';
NOTIFY pgrst, 'reload schema';
COMMIT;
