-- Job market health: one open, aggregate-only reader of the job loop (demand, supply, matching, flow, trust) with daily
-- history.
--
--   job_market_health_read() (anon, authenticated, service_role): counts and medians only; no ids, names, handles,
--     amounts or texts. Computed on read (job_market_health_compute) plus 'history', the daily snapshots.
--   job_market_health_snapshots: one row per UTC day, written only by record_job_market_health_snapshot()
--     (cron job-market-health-snapshot, daily 07:23 UTC; registered in pipeline_registry). Seeded once here.
--
-- Definitions (also returned under 'rules'):
--   open requirement: current requirement of a work order that is not completed/paid/cancelled/rejected, on a public
--     vehicle, not invite_only (the open_requirements_read rule).
--   provider population: accounts with an evidenced provider link (approved work_evidence/co_sign/authenticated_sign actor
--     claim) or a verified business claim; capped at 200 for the per-requirement match.
--   requirement with an evidenced candidate: some account in the population, other than the job's customer, passes the
--     evidence rung and the requirement's own input (skill for skill/inspection, tools for tool/equipment, facility for
--     facility) in provider_requirement_match; or a current offer on it at an evidenced rung.
--   unknown for all: the input is 'unknown' for every account in the population (requirements with no population count
--     separately).
--   medians: hours between consecutive signed steps, shown when there are at least 2 samples.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.job_market_health_snapshots (
  snapshot_date date PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  health jsonb NOT NULL CHECK (jsonb_typeof(health) = 'object')
);
ALTER TABLE public.job_market_health_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_market_health_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_market_health_snapshots TO service_role;
COMMENT ON TABLE public.job_market_health_snapshots IS
  'Daily aggregate job-market health (job_market_health_compute). Written only by record_job_market_health_snapshot() (cron job-market-health-snapshot); read through job_market_health_read().';

CREATE FUNCTION public.job_market_health_median(p_hours double precision[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('samples', COALESCE(cardinality(p_hours), 0),
    'median_hours', CASE WHEN COALESCE(cardinality(p_hours), 0) >= 2
      THEN round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) FROM unnest(p_hours) h)::numeric, 1) END)
$$;
REVOKE ALL ON FUNCTION public.job_market_health_median(double precision[]) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.job_market_health_compute() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  rq jsonb;
  pop uuid[];
  pop_capped boolean;
  demand jsonb;
  supply jsonb;
  matching jsonb;
  flow jsonb;
  trust jsonb;
  per_req jsonb;
BEGIN
  -- Open requirements with what the matching inputs need (the open_requirements_read rule and inputs).
  WITH wos AS MATERIALIZED (
    SELECT w.id, w.customer_id, w.organization_id, to_jsonb(v)->>'city' AS city, to_jsonb(v)->>'state' AS state
    FROM public.work_orders w JOIN public.vehicles v ON v.id = w.vehicle_id AND v.is_public IS TRUE
    WHERE COALESCE(w.status, 'pending') NOT IN ('completed','paid','cancelled','rejected') AND w.request_visibility IS DISTINCT FROM 'invite_only'
      AND EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id)
  ), graphs AS MATERIALIZED (
    SELECT w.*, public.read_work_order_resources(w.id) AS g FROM wos w
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q->>'id', 'kind', q->>'requirement_kind', 'wo', g.id, 'customer', g.customer_id,
      'org', g.organization_id,
      'area', CASE WHEN NULLIF(btrim(g.state), '') IS NOT NULL OR NULLIF(btrim(g.city), '') IS NOT NULL
        THEN jsonb_build_object('city', NULLIF(btrim(g.city), ''), 'state', NULLIF(btrim(g.state), ''), 'basis', 'public vehicle city/state') END,
      'q', q || jsonb_build_object('capability_keys', public.requirement_capability_keys(q, g.g->'specifications')),
      'tool_keys', public.requirement_tool_keys(q, g.g->'specifications'),
      'cands', COALESCE((SELECT jsonb_agg(f ORDER BY f->>'id') FROM jsonb_array_elements(COALESCE(g.g->'fulfillments', '[]'::jsonb)) f
        WHERE f->>'requirement_id' = q->>'id'), '[]'::jsonb),
      'plan_b', CASE WHEN q->>'requirement_kind' IN ('tool', 'equipment', 'facility', 'skill')
        THEN public.requirement_plan_b_suppliers(concat_ws(' ', q->>'description', (SELECT string_agg(concat_ws(' ', sp->>'material_label',
          sp->>'process_label'), ' ') FROM jsonb_array_elements(COALESCE(g.g->'specifications', '[]'::jsonb)) sp
          WHERE sp->>'specification_stage' = 'requested' AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = q->>'line_item_id'))), 5)
        ELSE '[]'::jsonb END)), '[]'::jsonb)
  INTO rq
  FROM graphs g, jsonb_array_elements(COALESCE(g.g->'requirements', '[]'::jsonb)) q;

  pop := ARRAY(SELECT DISTINCT u FROM (
      SELECT c.user_id AS u FROM public.account_link_claims c
        WHERE c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign') AND c.actor_id IS NOT NULL
      UNION SELECT vc.user_id FROM public.organization_verified_claimants vc WHERE vc.revoked_at IS NULL) x
    WHERE u IS NOT NULL ORDER BY u LIMIT 201);
  pop_capped := cardinality(pop) > 200;
  IF pop_capped THEN pop := pop[1:200]; END IF;

  WITH r AS (
    SELECT e AS row, e->>'id' AS id, e->>'kind' AS kind FROM jsonb_array_elements(rq) e
  ), people AS MATERIALIZED (
    SELECT u, public.viewer_identity_bridge(u) AS bridge FROM unnest(pop) u
  ), pairs AS (
    SELECT r.id, r.kind, p.u,
      public.provider_requirement_match(p.u, p.bridge, r.row->'q', NULLIF(r.row->>'org', '')::uuid, r.row->'cands',
        (r.row->>'wo')::uuid, NULLIF(r.row->'area', 'null'::jsonb), public.work_order_job_window((r.row->>'wo')::uuid), r.row->'tool_keys') AS inputs
    FROM r CROSS JOIN people p WHERE p.u::text IS DISTINCT FROM r.row->>'customer'
  ), pair_inputs AS (
    SELECT pr.id, pr.kind, pr.u, i->>'input' AS input, i->>'result' AS result FROM pairs pr, jsonb_array_elements(pr.inputs) i
  ), per AS (
    SELECT r.id, r.kind,
      (SELECT count(DISTINCT pi.u) FROM pair_inputs pi WHERE pi.id = r.id) AS considered,
      EXISTS (SELECT 1 FROM pair_inputs a JOIN pair_inputs b ON b.id = a.id AND b.u = a.u
        WHERE a.id = r.id AND a.input = 'evidence_rung' AND a.result = 'pass'
          AND b.input = CASE WHEN r.kind IN ('tool', 'equipment') THEN 'tools' WHEN r.kind = 'facility' THEN 'facility' ELSE 'skill' END
          AND b.result = 'pass')
      OR EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id AND s.is_superseded IS FALSE
        WHERE f.requirement_id::text = r.id AND f.offer_rung IN ('work_evidence','co_sign','authenticated_sign','organization_owner','verified_claimant')) AS evidenced_candidate,
      COALESCE((SELECT jsonb_object_agg(x.input, x.all_unknown) FROM (SELECT pi.input, bool_and(pi.result = 'unknown') AS all_unknown
        FROM pair_inputs pi WHERE pi.id = r.id GROUP BY pi.input) x), '{}'::jsonb) AS unknown_all,
      jsonb_array_length(COALESCE(r.row->'plan_b', '[]'::jsonb)) > 0 AS plan_b,
      EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.row->'plan_b', '[]'::jsonb)) s WHERE (s->>'can_receive_requests')::boolean) AS plan_b_reachable,
      jsonb_array_length(COALESCE(r.row#>'{q,capability_keys}', '[]'::jsonb)) > 0 AS has_capability_keys,
      jsonb_array_length(COALESCE(r.row->'tool_keys', '[]'::jsonb)) > 0 AS has_tool_keys
    FROM r
  )
  SELECT jsonb_agg(to_jsonb(per)) INTO per_req FROM per;
  per_req := COALESCE(per_req, '[]'::jsonb);

  SELECT jsonb_build_object(
    'open_requirements', jsonb_array_length(rq),
    'open_requirements_by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT e->>'kind' k, count(*) n FROM jsonb_array_elements(rq) e GROUP BY 1) x), '{}'::jsonb),
    'requirements_by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT r.requirement_kind k, count(*) n FROM public.work_order_resource_requirements r
      JOIN public.vehicle_observations s ON s.id = r.id AND s.is_superseded IS FALSE GROUP BY 1) x), '{}'::jsonb),
    'jobs', (SELECT count(*) FROM public.work_orders),
    'jobs_by_status', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT COALESCE(w.status, 'unknown') k, count(*) n FROM public.work_orders w GROUP BY 1) x), '{}'::jsonb),
    'jobs_by_stage', COALESCE((SELECT jsonb_object_agg(st, n) FROM (SELECT st, count(*) n FROM (
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM public.work_order_payment_witnesses x WHERE x.work_order_id = w.id) THEN 'payment_witnessed'
          WHEN EXISTS (SELECT 1 FROM public.work_order_invoices x WHERE x.work_order_id = w.id) THEN 'invoiced'
          WHEN EXISTS (SELECT 1 FROM public.work_order_completion_acceptances x WHERE x.work_order_id = w.id) THEN 'completion_accepted'
          WHEN EXISTS (SELECT 1 FROM public.work_order_completion_attestations x WHERE x.work_order_id = w.id) THEN 'completion_attested'
          WHEN EXISTS (SELECT 1 FROM public.work_order_work_starts x WHERE x.work_order_id = w.id) THEN 'started'
          WHEN EXISTS (SELECT 1 FROM public.work_order_quote_acceptances x WHERE x.work_order_id = w.id) THEN 'quote_accepted'
          WHEN EXISTS (SELECT 1 FROM public.work_order_quotes x WHERE x.work_order_id = w.id) THEN 'quoted'
          WHEN EXISTS (SELECT 1 FROM public.work_order_assignments x WHERE x.work_order_id = w.id AND x.fulfillment_id IS NOT NULL) THEN 'offer_accepted'
          WHEN EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments x WHERE x.work_order_id = w.id AND x.offer_kind IS NOT NULL) THEN 'offered'
          WHEN EXISTS (SELECT 1 FROM public.work_order_resource_requirements x WHERE x.work_order_id = w.id) THEN 'requested'
          ELSE 'no_requirements' END AS st
        FROM public.work_orders w) y GROUP BY 1) z), '{}'::jsonb),
    'published', jsonb_build_object(
      'open', (SELECT count(*) FROM public.work_orders w WHERE w.request_visibility = 'open'),
      'invite_only', (SELECT count(*) FROM public.work_orders w WHERE w.request_visibility = 'invite_only'),
      'unset', (SELECT count(*) FROM public.work_orders w WHERE w.request_visibility IS NULL)),
    'new_requests', jsonb_build_object(
      'last_7_days', (SELECT count(*) FROM public.work_orders w WHERE w.created_at >= now() - interval '7 days'),
      'last_30_days', (SELECT count(*) FROM public.work_orders w WHERE w.created_at >= now() - interval '30 days'),
      'published_open_last_7_days', (SELECT count(DISTINCT s.structured_data#>>'{work_order_publication,work_order_id}') FROM public.vehicle_observations s
        WHERE s.vehicle_id IN (SELECT w.vehicle_id FROM public.work_orders w WHERE w.vehicle_id IS NOT NULL)
          AND s.extraction_method = 'work_order_publication_sign_v1' AND s.structured_data#>>'{work_order_publication,action}' = 'publish'
          AND s.structured_data#>>'{work_order_publication,visibility}' = 'open' AND s.observed_at >= now() - interval '7 days'),
      'published_open_last_30_days', (SELECT count(DISTINCT s.structured_data#>>'{work_order_publication,work_order_id}') FROM public.vehicle_observations s
        WHERE s.vehicle_id IN (SELECT w.vehicle_id FROM public.work_orders w WHERE w.vehicle_id IS NOT NULL)
          AND s.extraction_method = 'work_order_publication_sign_v1' AND s.structured_data#>>'{work_order_publication,action}' = 'publish'
          AND s.structured_data#>>'{work_order_publication,visibility}' = 'open' AND s.observed_at >= now() - interval '30 days')),
    'inspection_orders', jsonb_build_object(
      'total', (SELECT count(DISTINCT r.work_order_id) FROM public.work_order_resource_requirements r
        JOIN public.vehicle_observations s ON s.id = r.id AND s.is_superseded IS FALSE WHERE r.requirement_kind = 'inspection'),
      'open', (SELECT count(DISTINCT e->>'wo') FROM jsonb_array_elements(rq) e WHERE e->>'kind' = 'inspection')))
  INTO demand;

  SELECT jsonb_build_object(
    'accounts_with_evidenced_provider_links', (SELECT count(DISTINCT c.user_id) FROM public.account_link_claims c
      WHERE c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign') AND c.actor_id IS NOT NULL),
    'accounts_with_pending_provider_links', (SELECT count(DISTINCT c.user_id) FROM public.account_link_claims c
      WHERE c.status = 'pending' AND c.actor_id IS NOT NULL),
    'verified_claimant_organizations', (SELECT count(DISTINCT vc.organization_id) FROM public.organization_verified_claimants vc WHERE vc.revoked_at IS NULL),
    'verified_claimant_accounts', (SELECT count(DISTINCT vc.user_id) FROM public.organization_verified_claimants vc WHERE vc.revoked_at IS NULL),
    'organizations_with_supply_evidence', (SELECT count(DISTINCT e.organization_id) FROM public.organization_supply_evidence e),
    'supply_organizations_claimable', (SELECT jsonb_build_object(
        'not_on_nuke_yet', count(*) FILTER (WHERE NOT x.on_nuke),
        'by_domain_email', count(*) FILTER (WHERE NOT x.on_nuke AND x.host IS NOT NULL),
        'document_only', count(*) FILTER (WHERE NOT x.on_nuke AND x.host IS NULL))
      FROM (SELECT o.organization_id, public.organization_website_host(o.organization_id) AS host,
          (public.organization_on_nuke(o.organization_id)->>'state') = 'claimed' AS on_nuke
        FROM (SELECT DISTINCT e.organization_id FROM public.organization_supply_evidence e) o) x),
    'providers_with_availability', (SELECT count(DISTINCT a.user_id) FROM public.provider_availability a),
    'providers_with_service_area', (SELECT count(DISTINCT a.user_id) FROM public.provider_service_area a),
    'providers_with_both', (SELECT count(*) FROM (SELECT a.user_id FROM public.provider_availability a INTERSECT SELECT b.user_id FROM public.provider_service_area b) x),
    'declared_facility_assets', (SELECT count(*) FROM public.equipment e WHERE e.source = 'member_declaration' AND e.status = 'in_service'),
    'declared_facility_assets_by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT e.asset_kind k, count(*) n FROM public.equipment e
      WHERE e.source = 'member_declaration' AND e.status = 'in_service' GROUP BY 1) x), '{}'::jsonb),
    'organizations_with_declared_assets', (SELECT count(DISTINCT e.shop_id) FROM public.equipment e WHERE e.source = 'member_declaration' AND e.status = 'in_service'),
    'provider_population', cardinality(pop), 'provider_population_capped', pop_capped)
  INTO supply;

  SELECT jsonb_build_object(
    'open_requirements', jsonb_array_length(per_req),
    'with_evidenced_candidate', (SELECT count(*) FROM jsonb_array_elements(per_req) p WHERE (p->>'evidenced_candidate')::boolean),
    'with_plan_b_supplier', (SELECT count(*) FROM jsonb_array_elements(per_req) p WHERE (p->>'plan_b')::boolean),
    'with_reachable_plan_b_supplier', (SELECT count(*) FROM jsonb_array_elements(per_req) p WHERE (p->>'plan_b_reachable')::boolean),
    'with_no_provider_considered', (SELECT count(*) FROM jsonb_array_elements(per_req) p WHERE (p->>'considered')::int = 0),
    'skill_key_coverage', (SELECT jsonb_build_object('requirements', count(*), 'with_keys', count(*) FILTER (WHERE (p->>'has_capability_keys')::boolean),
        'percent', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE (p->>'has_capability_keys')::boolean) / count(*), 1) END)
      FROM jsonb_array_elements(per_req) p WHERE p->>'kind' IN ('skill', 'inspection')),
    'tool_key_coverage', (SELECT jsonb_build_object('requirements', count(*), 'with_keys', count(*) FILTER (WHERE (p->>'has_tool_keys')::boolean),
        'percent', CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE (p->>'has_tool_keys')::boolean) / count(*), 1) END)
      FROM jsonb_array_elements(per_req) p WHERE p->>'kind' IN ('tool', 'equipment')),
    'unknown_for_all', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT u.key k, count(*) FILTER (WHERE u.value = 'true'::jsonb) n
      FROM jsonb_array_elements(per_req) p, jsonb_each(COALESCE(p->'unknown_all', '{}'::jsonb)) u GROUP BY 1) x), '{}'::jsonb))
  INTO matching;

  SELECT jsonb_build_object(
    'counts', jsonb_build_object(
      'offers', (SELECT count(*) FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id AND s.is_superseded IS FALSE
        WHERE f.offer_kind IS NOT NULL),
      'offers_accepted', (SELECT count(*) FROM public.work_order_assignments a WHERE a.fulfillment_id IS NOT NULL AND a.accepted_at IS NOT NULL),
      'quotes_issued', (SELECT count(*) FROM public.work_order_quotes),
      'quotes_accepted', (SELECT count(DISTINCT qa.quote_id) FROM public.work_order_quote_acceptances qa),
      'starts', (SELECT count(*) FROM public.work_order_work_starts),
      'completions_attested', (SELECT count(*) FROM public.work_order_completion_attestations),
      'completions_accepted', (SELECT count(*) FROM public.work_order_completion_acceptances),
      'invoices', (SELECT count(*) FROM public.work_order_invoices),
      'payment_witnesses', (SELECT count(*) FROM public.work_order_payment_witnesses),
      'invoices_with_payment_witness', (SELECT count(DISTINCT pw.invoice_id) FROM public.work_order_payment_witnesses pw)),
    'step_hours', jsonb_build_object(
      'offer_to_acceptance', public.job_market_health_median(ARRAY(SELECT extract(epoch FROM a.accepted_at - f.recorded_at) / 3600
        FROM public.work_order_assignments a JOIN public.work_order_resource_fulfillments f ON f.id = a.fulfillment_id
        WHERE a.accepted_at IS NOT NULL AND f.recorded_at IS NOT NULL AND a.accepted_at >= f.recorded_at)),
      'quote_to_acceptance', public.job_market_health_median(ARRAY(SELECT extract(epoch FROM qa.signed_at - q.recorded_at) / 3600
        FROM public.work_order_quote_acceptances qa JOIN public.work_order_quotes q ON q.id = qa.quote_id WHERE qa.signed_at >= q.recorded_at)),
      'quote_acceptance_to_start', public.job_market_health_median(ARRAY(SELECT extract(epoch FROM s.started_at - x.accepted) / 3600
        FROM public.work_order_work_starts s
        JOIN LATERAL (SELECT min(qa.signed_at) AS accepted FROM public.work_order_quote_acceptances qa WHERE qa.quote_id = s.quote_id) x ON x.accepted IS NOT NULL
        WHERE s.started_at >= x.accepted)),
      'start_to_completion', public.job_market_health_median(ARRAY(SELECT extract(epoch FROM c.signed_at - x.started) / 3600
        FROM public.work_order_completion_attestations c
        JOIN LATERAL (SELECT min(s.started_at) AS started FROM public.work_order_work_starts s WHERE s.work_order_id = c.work_order_id) x ON x.started IS NOT NULL
        WHERE c.signed_at >= x.started)),
      'completion_to_acceptance', public.job_market_health_median(ARRAY(SELECT extract(epoch FROM ca.signed_at - c.signed_at) / 3600
        FROM public.work_order_completion_acceptances ca JOIN public.work_order_completion_attestations c ON c.id = ca.completion_id
        WHERE ca.signed_at >= c.signed_at)),
      'invoice_to_payment_witness', public.job_market_health_median(ARRAY(SELECT extract(epoch FROM x.first_witness - i.issued_at) / 3600
        FROM public.work_order_invoices i
        JOIN LATERAL (SELECT min(pw.witnessed_at) AS first_witness FROM public.work_order_payment_witnesses pw WHERE pw.invoice_id = i.id) x ON x.first_witness IS NOT NULL
        WHERE x.first_witness >= i.issued_at))),
    'money_moved_by_nuke', false)
  INTO flow;

  SELECT jsonb_build_object(
    'open_exposures_known', CASE WHEN EXISTS (SELECT 1 FROM pg_policy p
        WHERE p.polrelid IN (SELECT to_regclass(t) FROM unnest(ARRAY['public.deal_contacts', 'public.deal_documents', 'public.deal_jackets']) t WHERE to_regclass(t) IS NOT NULL)
          AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ 'organization_contributors'
          AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') !~ 'status = ''active''') THEN 1 ELSE 0 END,
    'exposure_basis', 'tracked access-rule checks; details are not published',
    'owner_delegated_signs', (SELECT count(*) FROM public.owner_delegated_signs s WHERE s.rolled_back IS NOT TRUE),
    'owner_delegated_signs_last_30_days', (SELECT count(*) FROM public.owner_delegated_signs s WHERE s.rolled_back IS NOT TRUE AND s.signed_at >= now() - interval '30 days'))
  INTO trust;

  RETURN jsonb_build_object('as_of', statement_timestamp(), 'demand', demand, 'supply', supply, 'matching', matching, 'flow', flow, 'trust', trust);
END $$;
REVOKE ALL ON FUNCTION public.job_market_health_compute() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_job_market_health_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE h jsonb := public.job_market_health_compute();
BEGIN
  INSERT INTO public.job_market_health_snapshots (snapshot_date, taken_at, health)
  VALUES (current_date, now(), h)
  ON CONFLICT (snapshot_date) DO UPDATE SET taken_at = EXCLUDED.taken_at, health = EXCLUDED.health;
  RETURN jsonb_build_object('snapshot_date', current_date, 'taken_at', now());
END $$;
REVOKE ALL ON FUNCTION public.record_job_market_health_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_market_health_snapshot() TO service_role;

CREATE FUNCTION public.job_market_health_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
BEGIN
  RETURN public.job_market_health_compute() || jsonb_build_object(
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', s.snapshot_date,
        'open_requirements', s.health#>'{demand,open_requirements}',
        'jobs', s.health#>'{demand,jobs}',
        'new_requests_last_7_days', s.health#>'{demand,new_requests,last_7_days}',
        'evidenced_provider_accounts', s.health#>'{supply,accounts_with_evidenced_provider_links}',
        'verified_claimant_organizations', s.health#>'{supply,verified_claimant_organizations}',
        'with_evidenced_candidate', s.health#>'{matching,with_evidenced_candidate}',
        'with_plan_b_supplier', s.health#>'{matching,with_plan_b_supplier}',
        'offers', s.health#>'{flow,counts,offers}',
        'quotes_accepted', s.health#>'{flow,counts,quotes_accepted}',
        'completions_accepted', s.health#>'{flow,counts,completions_accepted}',
        'invoices', s.health#>'{flow,counts,invoices}',
        'payment_witnesses', s.health#>'{flow,counts,payment_witnesses}') ORDER BY s.snapshot_date)
      FROM (SELECT * FROM public.job_market_health_snapshots ORDER BY snapshot_date DESC LIMIT 90) s), '[]'::jsonb),
    'history_basis', 'daily snapshots (UTC), last 90 days; written by cron job-market-health-snapshot',
    'rules', jsonb_build_object(
      'open_requirement', 'current requirement; work order not completed, paid, cancelled or rejected; public vehicle; not invite_only',
      'provider_population', 'accounts with an approved work_evidence, co_sign or authenticated_sign provider link, or a verified business claim; at most 200',
      'evidenced_candidate', 'an account in the population, not the job''s customer, passes the evidence rung and the requirement''s own input (skill, tools or facility), or a current offer at an evidenced rung',
      'unknown_for_all', 'requirements where the input is unknown for every account in the population',
      'medians', 'hours between consecutive signed steps, shown with at least 2 samples',
      'published', 'aggregates only: no ids, names, handles, amounts or texts'));
END $$;
REVOKE ALL ON FUNCTION public.job_market_health_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_market_health_read() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.job_market_health_read() IS
  'Open aggregate health of the job market: demand, supply, matching, flow, trust, and daily history. Counts and medians only.';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'job_market_health_snapshots', NULL, 'record_job_market_health_snapshot',
  'Daily aggregate job-market health snapshot (one row per UTC day).', true,
  'record_job_market_health_snapshot() (cron job-market-health-snapshot, 07:23 UTC daily; ON CONFLICT (snapshot_date) DO UPDATE)'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'job_market_health_snapshots' AND column_name IS NULL);

DO $job$
DECLARE scheduled boolean;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-market-health-snapshot')$q$ INTO scheduled;
    IF NOT scheduled THEN
      EXECUTE $q$SELECT cron.schedule('job-market-health-snapshot', '23 7 * * *',
        'SET statement_timeout = ''60s''; SELECT public.record_job_market_health_snapshot()')$q$;
    END IF;
  END IF;
END $job$;

SELECT public.record_job_market_health_snapshot();

NOTIFY pgrst, 'reload schema';
COMMIT;
