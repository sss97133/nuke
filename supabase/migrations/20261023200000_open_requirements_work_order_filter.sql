-- open_requirements_read: optional p_work_order_id filter (server-side).
--
-- The iOS job screen read the first 100 open requirements across ALL jobs and filtered
-- them on the device: a job outside that page showed no supplier rows, and every job
-- open paid for the whole marketplace graph. p_work_order_id (DEFAULT NULL) narrows the
-- `wos` set to one work order before the per-requirement graph is built.
--
-- Backward compatible: existing callers (p_after, p_limit, p_kind) get identical rows,
-- plus coverage.work_order_filter = null. The 3-argument overload is dropped in the same
-- transaction so PostgREST never sees two candidates with defaulted arguments.
-- Body = live production definition (pg_get_functiondef, read 2026-10-22) with only the
-- filter line and the coverage key added.

BEGIN;

DROP FUNCTION IF EXISTS public.open_requirements_read(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.open_requirements_read(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25, p_kind text DEFAULT NULL::text, p_work_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
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
      UNION SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = uid AND bo.status = 'active'
      UNION SELECT vc.organization_id FROM public.organization_verified_claimants vc WHERE vc.user_id = uid AND vc.revoked_at IS NULL);
    SELECT CASE WHEN p.is_public IS TRUE THEN NULLIF(btrim(p.city), '') END, CASE WHEN p.is_public IS TRUE THEN NULLIF(btrim(p.state), '') END
      INTO v_city, v_state FROM public.profiles p WHERE p.id = uid;
  END IF;

  WITH wos AS MATERIALIZED (
    SELECT w.id, w.status, w.organization_id, v.city AS veh_city, v.state AS veh_state,
      o.is_public AS org_public, o.city AS o_city, o.state AS o_state
    FROM public.work_orders w JOIN public.vehicles v ON v.id = w.vehicle_id AND v.is_public IS TRUE
    LEFT JOIN public.organizations o ON o.id = w.organization_id
    WHERE COALESCE(w.status, 'pending') NOT IN ('completed','paid','cancelled','rejected') AND w.request_visibility IS DISTINCT FROM 'invite_only'
      AND EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id)
      AND (p_work_order_id IS NULL OR w.id = p_work_order_id)
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
      lower(COALESCE(s.q->>'description', '')) AS dtext,
      public.requirement_tool_keys(s.q, s.g->'specifications') AS tool_keys,
      public.requirement_capability_keys(s.q, s.g->'specifications') AS capability_keys
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
      'tool_keys', b.tool_keys, 'capability_keys', b.capability_keys, 'area_band', b.area,
      'window', (SELECT CASE WHEN count(f->>'available_from') > 0 THEN jsonb_build_object('available_from', min(f->>'available_from'),
          'available_until', max(f->>'available_until'), 'basis', 'stated by listed candidates') END
        FROM jsonb_array_elements(COALESCE(b.cands, '[]'::jsonb)) f),
      'plan_b_suppliers', CASE WHEN b.q->>'requirement_kind' IN ('tool', 'equipment', 'facility', 'skill')
        THEN public.requirement_plan_b_suppliers_tiered(concat_ws(' ', b.q->>'description', (SELECT string_agg(concat_ws(' ', sp->>'material_label',
          sp->>'process_label'), ' ') FROM jsonb_array_elements(COALESCE(b.g->'specifications', '[]'::jsonb)) sp
          WHERE sp->>'specification_stage' = 'requested' AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = b.q->>'line_item_id'))), b.q->>'requirement_kind', b.capability_keys, b.area, 5)
        ELSE '[]'::jsonb END,
      'candidates_listed', jsonb_array_length(COALESCE(b.cands, '[]'::jsonb)), 'candidate_acceptance', 'not_recorded',
      'quote_state', jsonb_build_object('has_current_quote', jsonb_typeof(b.qs->'current_quote') = 'object',
        'quote_versions', b.qs->'quote_versions', 'acceptance', b.qs#>'{acceptance,state}'),
      'match_role', 'performer', 'match', CASE WHEN uid IS NULL THEN NULL ELSE public.verified_claimant_match_inputs(uid, b.q, jsonb_build_array(
        public.open_requirement_skill_input(uid, bridge, b.q->>'requirement_kind', b.capability_keys, b.dtext),
        public.open_requirement_tools_input(uid, b.q->>'requirement_kind', b.tool_keys, b.dtext),
        public.open_requirement_facility_input(v_orgs, b.q, b.organization_id, b.cands, b.work_order_id),
        public.open_requirement_area_input(uid, b.area),
        public.open_requirement_availability_input(uid, public.work_order_job_window(b.work_order_id)),
        CASE bridge->>'state'
          WHEN 'evidenced' THEN jsonb_build_object('input', 'evidence_rung', 'result', 'pass', 'reason', 'evidenced identity bridge')
          WHEN 'claimed' THEN jsonb_build_object('input', 'evidence_rung', 'result', 'unknown', 'reason', 'self-claimed provider link awaiting evidence')
          ELSE jsonb_build_object('input', 'evidence_rung', 'result', 'fail', 'next', 'claim_provider_link', 'reason', 'no provider link claim') END)) END)
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
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'total_open', total, 'kind_filter', p_kind, 'work_order_filter', p_work_order_id,
      'population', population,
      'rule', 'current requirement; work order not completed, paid, cancelled or rejected; public vehicle; not an invite_only work request',
      'not_assessed', jsonb_build_array('candidate acceptance', 'distance beyond city-level service areas', 'availability beyond self-claimed standing windows', 'price')),
    'contact', jsonb_build_object('action', 'contact_via_nuke', 'available', uid IS NOT NULL,
      'request', jsonb_build_object('writer', 'request_contact', 'context_kind', 'requirement', 'context_id', 'requirement_id of the row'),
      'basis', 'contact between users is brokered by Nuke; contact fields are never exposed'));
END $function$;

REVOKE ALL ON FUNCTION public.open_requirements_read(uuid, integer, text, uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.open_requirements_read(uuid, integer, text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
