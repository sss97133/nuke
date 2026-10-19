-- Evidence finder for technician (actor) link claims. Provider-side Sign writers need an evidenced identity bridge,
-- and approve_actor_link_claim (service-only, distinct active admin reviewer) needs evidence row ids. This finds the
-- candidates by an explainable join over the claimant's own records and the actor's attributed work; it never
-- compares names, phones or e-mails, and it approves nothing.
--
-- actor_link_claim_evidence_read(p_claim_id): for the claimant, active admins and the service role.
--   work_session    claimant's work_sessions on the vehicle of an operation attributed to the actor
--                   (component_events.actor_id, work_order_line_items.actor_id): same day as a dated event = direct,
--                   within the work order's window = corroborating
--   observation     observations the claimant submitted that source the actor's operation (line item source) or are
--                   listed as a component event's evidence = direct; the claimant's analysed photos of that vehicle in
--                   the operation window = corroborating (at most 200 photos per operation)
--   org_membership  the claimant's active membership of a verified organization the actor worked for = corroborating
--                   (not an evidence kind approve_actor_link_claim accepts; context for the reviewer)
-- Each item names the rung approve_actor_link_claim would accept it for, if any.
-- actor_link_claims_review_queue(): active admins and the service role; pending actor claims with evidence counts.
-- Contract: supabase/sql/test_actor_link_claim_evidence.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.actor_link_claim_evidence_read(p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  is_service boolean := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  is_admin boolean;
  c record;
  items jsonb;
BEGIN
  SELECT cl.id, cl.user_id, cl.actor_id, cl.status, cl.verification_method, cl.created_at INTO c
    FROM public.account_link_claims cl WHERE cl.id = p_claim_id AND cl.actor_id IS NOT NULL;
  is_admin := uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = uid AND au.is_active);
  IF c.id IS NULL OR NOT (is_service OR is_admin OR (uid IS NOT NULL AND uid = c.user_id)) THEN
    RAISE EXCEPTION 'Claim unavailable';
  END IF;

  WITH acts AS (
    SELECT 'component event'::text AS src, ce.id AS src_id, ce.vehicle_id, ce.event_date::date AS d_from, ce.event_date::date AS d_to,
      ce.org_id, ce.evidence_ids
    FROM public.component_events ce WHERE ce.actor_id = c.actor_id AND ce.vehicle_id IS NOT NULL AND ce.event_date IS NOT NULL
    UNION ALL
    SELECT 'work order operation', li.id, w.vehicle_id,
      COALESCE(lce.event_date::date, COALESCE(w.started_at, w.actual_start, w.created_at)::date),
      COALESCE(lce.event_date::date, COALESCE(w.completed_at, w.actual_end, now())::date),
      w.organization_id, NULL::uuid[]
    FROM public.work_order_line_items li JOIN public.work_orders w ON w.id = li.work_order_id
    LEFT JOIN public.component_events lce ON lce.id = li.component_event_id
    WHERE li.actor_id = c.actor_id AND w.vehicle_id IS NOT NULL
  ), sessions AS (
    SELECT DISTINCT ON (s.id) s.id, s.vehicle_id, s.session_date, a.src,
      (a.d_from = a.d_to AND s.session_date = a.d_from) AS direct
    FROM acts a JOIN public.work_sessions s ON s.user_id = c.user_id AND s.vehicle_id = a.vehicle_id
      AND s.session_date BETWEEN a.d_from AND a.d_to
    ORDER BY s.id, (a.d_from = a.d_to AND s.session_date = a.d_from) DESC
  ), sourced AS (
    SELECT DISTINCT ON (o.id) o.id, o.vehicle_id, o.observed_at::date AS d, x.why FROM (
      SELECT li.source_observation_id AS oid, 'source of an operation attributed to the actor' AS why
        FROM public.work_order_line_items li WHERE li.actor_id = c.actor_id AND li.source_observation_id IS NOT NULL
      UNION ALL
      SELECT unnest(ce.evidence_ids), 'evidence listed on a component event attributed to the actor'
        FROM public.component_events ce WHERE ce.actor_id = c.actor_id AND ce.evidence_ids IS NOT NULL) x
    JOIN public.vehicle_observations o ON o.id = x.oid AND o.submitted_by_user_id = c.user_id AND o.is_superseded IS FALSE
    ORDER BY o.id
  ), frames AS (
    SELECT DISTINCT ON (ob.id) ob.id, img.vehicle_id, img.taken_at::date AS d, a.src
    FROM acts a
    CROSS JOIN LATERAL (SELECT vi.id, vi.vehicle_id, vi.taken_at FROM public.vehicle_images vi
      WHERE vi.vehicle_id = a.vehicle_id AND vi.user_id = c.user_id AND vi.is_external IS FALSE
        AND vi.taken_at >= a.d_from AND vi.taken_at < a.d_to + 1 ORDER BY vi.taken_at LIMIT 200) img
    CROSS JOIN LATERAL (SELECT o.id FROM public.vehicle_observations o
      WHERE (o.structured_data->>'image_id') = img.id::text AND (o.structured_data->>'analysis_kind') = 'image_deep_byok'
        AND o.is_superseded IS FALSE LIMIT 5) ob
    ORDER BY ob.id
  ), orgs AS (
    SELECT DISTINCT oc.organization_id, org.business_name, org.name
    FROM acts a JOIN public.organizations org ON org.id = a.org_id AND org.is_verified IS TRUE
    JOIN public.organization_contributors oc ON oc.organization_id = org.id AND oc.user_id = c.user_id AND oc.status = 'active'
  ), all_items AS (
    SELECT 'work_session' AS kind, s.id AS row_id, s.vehicle_id, s.session_date AS d,
      'your work session on the vehicle of a ' || s.src || ' attributed to the actor, '
        || CASE WHEN s.direct THEN 'on the same day' ELSE 'within the work order window' END AS why,
      CASE WHEN s.direct THEN 'direct' ELSE 'corroborating' END AS strength, jsonb_build_array('work_evidence') AS approvable_for
    FROM sessions s
    UNION ALL
    SELECT 'observation', o.id, o.vehicle_id, o.d, 'an observation you submitted: ' || o.why, 'direct', jsonb_build_array('authenticated_sign')
    FROM sourced o
    UNION ALL
    SELECT 'observation', f.id, f.vehicle_id, f.d, 'analysis of your photo of the vehicle during a ' || f.src || ' attributed to the actor',
      'corroborating', '[]'::jsonb FROM frames f
    UNION ALL
    SELECT 'org_membership', g.organization_id, NULL::uuid, NULL::date,
      'you are an active member of verified organization ' || COALESCE(g.business_name, g.name, 'unnamed') || ', which the actor worked for',
      'corroborating', '[]'::jsonb FROM orgs g
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'row_id', i.row_id,
      'vehicle_label', (SELECT NULLIF(concat_ws(' ', v.year, v.make, v.model), '') FROM public.vehicles v WHERE v.id = i.vehicle_id),
      'date', i.d, 'why', i.why, 'strength', i.strength, 'approvable_for', i.approvable_for)
    ORDER BY CASE i.strength WHEN 'direct' THEN 0 ELSE 1 END, i.kind, i.d DESC NULLS LAST, i.row_id), '[]'::jsonb)
    INTO items FROM all_items i;

  RETURN jsonb_build_object('as_of', statement_timestamp(),
    'claim', jsonb_build_object('claim_id', c.id, 'actor', public.platform_actor_label(c.actor_id), 'rung', c.verification_method,
      'status', c.status, 'filed_at', c.created_at),
    'viewer', jsonb_build_object('role', CASE WHEN is_service THEN 'service' WHEN is_admin THEN 'admin' ELSE 'claimant' END),
    'items', items,
    'counts', jsonb_build_object('total', jsonb_array_length(items),
      'direct', (SELECT count(*) FROM jsonb_array_elements(items) e WHERE e->>'strength' = 'direct'),
      'corroborating', (SELECT count(*) FROM jsonb_array_elements(items) e WHERE e->>'strength' = 'corroborating'),
      'by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT e->>'kind' k, count(*) n FROM jsonb_array_elements(items) e GROUP BY 1) x), '{}'::jsonb)),
    'approval', jsonb_build_object('writer', 'approve_actor_link_claim', 'access', 'service role with a distinct active admin reviewer',
      'work_evidence_needs', 'at least one work_session item', 'auto_approved', false),
    'not_assessed', jsonb_build_array('whether the claimant is the person who did the work (reviewer judgement)',
      'who appears in photos', 'name, phone or e-mail similarity (never used)', 'photos beyond 200 per operation'));
END $$;
REVOKE ALL ON FUNCTION public.actor_link_claim_evidence_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actor_link_claim_evidence_read(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.actor_link_claim_evidence_read(uuid) IS 'Candidate evidence for an actor link claim (claimant, admins, service): claimant work sessions, submitted observations, photo analyses and verified-org co-membership joined to the actor''s attributed operations. Never name matching; approves nothing.';

CREATE FUNCTION public.actor_link_claims_review_queue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  is_service boolean := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  rows_out jsonb;
BEGIN
  IF NOT (is_service OR (uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = uid AND au.is_active))) THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('claim_id', cl.id, 'actor', public.platform_actor_label(cl.actor_id),
      'claimant', public.platform_person_label(cl.user_id), 'claimant_user_id', cl.user_id, 'rung', cl.verification_method,
      'filed_at', cl.created_at, 'evidence_counts', ev->'counts',
      'reviewer_must_differ_from_claimant', true,
      'reviewer_is_claimant', uid IS NOT NULL AND uid = cl.user_id) ORDER BY cl.created_at, cl.id), '[]'::jsonb)
    INTO rows_out
    FROM public.account_link_claims cl
    CROSS JOIN LATERAL (SELECT public.actor_link_claim_evidence_read(cl.id) AS ev) e
    WHERE cl.actor_id IS NOT NULL AND cl.status = 'pending';
  RETURN jsonb_build_object('as_of', statement_timestamp(), 'pending', rows_out,
    'coverage', jsonb_build_object('pending_actor_claims', jsonb_array_length(rows_out)),
    'approval', jsonb_build_object('writer', 'approve_actor_link_claim', 'access', 'service role; reviewer must be an active admin other than the claimant'));
END $$;
REVOKE ALL ON FUNCTION public.actor_link_claims_review_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actor_link_claims_review_queue() TO authenticated, service_role;
COMMENT ON FUNCTION public.actor_link_claims_review_queue() IS 'Admins and service: pending actor link claims with candidate evidence counts. Approval stays with approve_actor_link_claim and a distinct admin reviewer.';
NOTIFY pgrst, 'reload schema';
COMMIT;
