-- Supply side from evidence: suggest provider links an account's own records already support.
--
-- On 2026-10-19 one account had an evidenced technician link; nothing told anyone else which work actor, organization or
-- legacy record their evidence supports. This adds, for the signed-in viewer only:
--   actor_link_evidence_items(p_user, p_actor): the explainable join of actor_link_claim_evidence_read (20261019190000),
--     parameterized by account and actor instead of a filed claim (same vehicle/day work sessions, observations the account
--     submitted that source the actor's work, analyses of its own photos during that work, verified-org co-membership).
--     Internal. Never compares names, phones or e-mails.
--   my_suggested_provider_links() (authenticated): actors with attributed work whose items overlap the viewer's evidence
--     (counts by strength, existing claim state, a 'claim' action = today's pending self_claim insert); public
--     work facilities (garage, restoration, performance, builder, detailing, dealer) whose site holds the viewer's recent
--     photos (within 150 m of a known location) as 'ask to join'
--     (the existing pending self_claimed organization_contributors insert; no auto-join); the viewer's own legacy records
--     (contractor_work_contributions, technicians.user_id) as 'your recorded contributions' with a confirm action.
--   provider_record_confirmations + confirm_provider_record(p_source_kind, p_source_id, p_snapshot_hash) (authenticated
--     Sign): the account confirms its own legacy record as shown (hash-pinned snapshot). Rung self_confirmed; never read by
--     the capability fold (never evidence-derived skill). Immutable; a changed source reads as changed_since_confirmed.
-- Contract: supabase/sql/test_suggested_provider_links.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.actor_link_evidence_items(p_user uuid, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE items jsonb;
BEGIN
  IF p_user IS NULL OR p_actor IS NULL THEN RETURN '[]'::jsonb; END IF;
    WITH acts AS (
      SELECT 'component event'::text AS src, ce.id AS src_id, ce.vehicle_id, ce.event_date::date AS d_from, ce.event_date::date AS d_to,
        ce.org_id, ce.evidence_ids
      FROM public.component_events ce WHERE ce.actor_id = p_actor AND ce.vehicle_id IS NOT NULL AND ce.event_date IS NOT NULL
      UNION ALL
      SELECT 'work order operation', li.id, w.vehicle_id,
        COALESCE(lce.event_date::date, COALESCE(w.started_at, w.actual_start, w.created_at)::date),
        COALESCE(lce.event_date::date, COALESCE(w.completed_at, w.actual_end, now())::date),
        w.organization_id, NULL::uuid[]
      FROM public.work_order_line_items li JOIN public.work_orders w ON w.id = li.work_order_id
      LEFT JOIN public.component_events lce ON lce.id = li.component_event_id
      WHERE li.actor_id = p_actor AND w.vehicle_id IS NOT NULL
    ), sessions AS (
      SELECT DISTINCT ON (s.id) s.id, s.vehicle_id, s.session_date, a.src,
        (a.d_from = a.d_to AND s.session_date = a.d_from) AS direct
      FROM acts a JOIN public.work_sessions s ON s.user_id = p_user AND s.vehicle_id = a.vehicle_id
        AND s.session_date BETWEEN a.d_from AND a.d_to
      ORDER BY s.id, (a.d_from = a.d_to AND s.session_date = a.d_from) DESC
    ), sourced AS (
      SELECT DISTINCT ON (o.id) o.id, o.vehicle_id, o.observed_at::date AS d, x.why FROM (
        SELECT li.source_observation_id AS oid, 'source of an operation attributed to the actor' AS why
          FROM public.work_order_line_items li WHERE li.actor_id = p_actor AND li.source_observation_id IS NOT NULL
        UNION ALL
        SELECT unnest(ce.evidence_ids), 'evidence listed on a component event attributed to the actor'
          FROM public.component_events ce WHERE ce.actor_id = p_actor AND ce.evidence_ids IS NOT NULL) x
      JOIN public.vehicle_observations o ON o.id = x.oid AND o.submitted_by_user_id = p_user AND o.is_superseded IS FALSE
      ORDER BY o.id
    ), frames AS (
      SELECT DISTINCT ON (ob.id) ob.id, img.vehicle_id, img.taken_at::date AS d, a.src
      FROM acts a
      CROSS JOIN LATERAL (SELECT vi.id, vi.vehicle_id, vi.taken_at FROM public.vehicle_images vi
        WHERE vi.vehicle_id = a.vehicle_id AND vi.user_id = p_user AND vi.is_external IS FALSE
          AND vi.taken_at >= a.d_from AND vi.taken_at < a.d_to + 1 ORDER BY vi.taken_at LIMIT 200) img
      CROSS JOIN LATERAL (SELECT o.id FROM public.vehicle_observations o
        WHERE (o.structured_data->>'image_id') = img.id::text AND (o.structured_data->>'analysis_kind') = 'image_deep_byok'
          AND o.is_superseded IS FALSE LIMIT 5) ob
      ORDER BY ob.id
    ), orgs AS (
      SELECT DISTINCT oc.organization_id, org.business_name, org.name
      FROM acts a JOIN public.organizations org ON org.id = a.org_id AND org.is_verified IS TRUE
      JOIN public.organization_contributors oc ON oc.organization_id = org.id AND oc.user_id = p_user AND oc.status = 'active'
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
  RETURN items;
END $$;
REVOKE ALL ON FUNCTION public.actor_link_evidence_items(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_link_evidence_items(uuid, uuid) TO service_role;

CREATE TABLE public.provider_record_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('contractor_work_contribution', 'technician')),
  source_id uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  rung text NOT NULL DEFAULT 'self_confirmed' CHECK (rung = 'self_confirmed'),
  signed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (user_id, source_kind, source_id, snapshot_hash)
);
ALTER TABLE public.provider_record_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_record_confirmations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.provider_record_confirmations TO service_role;
COMMENT ON TABLE public.provider_record_confirmations IS
  'An account''s signed confirmation of its own legacy provider record (contractor_work_contributions, technicians) as shown. Rung self_confirmed; not skill evidence. Immutable.';
CREATE FUNCTION public.provider_record_confirmations_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'provider_record_confirmations is immutable'; END $$;
CREATE TRIGGER provider_record_confirmations_immutable BEFORE UPDATE OR DELETE ON public.provider_record_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.provider_record_confirmations_immutable();

CREATE FUNCTION public.provider_record_snapshot(p_source_kind text, p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE s jsonb;
BEGIN
  IF p_source_kind = 'contractor_work_contribution' THEN
    SELECT jsonb_build_object('source_kind', p_source_kind, 'source_id', c.id, 'user_id', c.contractor_user_id,
        'organization_id', c.organization_id, 'work_category', c.work_category, 'work_description', c.work_description,
        'work_date', c.work_date, 'labor_hours', c.labor_hours, 'hourly_rate', c.hourly_rate, 'vehicle_id', c.vehicle_id,
        'verified_by_shop', c.verified_by_shop)
      INTO s FROM public.contractor_work_contributions c WHERE c.id = p_source_id;
  ELSIF p_source_kind = 'technician' THEN
    SELECT jsonb_build_object('source_kind', p_source_kind, 'source_id', t.id, 'user_id', t.user_id,
        'display_name', t.display_name, 'certification_level', t.certification_level, 'specializations', to_jsonb(t.specializations),
        'organization_id', t.shop_id, 'experience_years', t.experience_years, 'hourly_rate_cents', t.hourly_rate_cents,
        'record_source', t.source)
      INTO s FROM public.technicians t WHERE t.id = p_source_id;
  END IF;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.provider_record_snapshot(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_record_snapshot(text, uuid) TO service_role;

CREATE FUNCTION public.provider_record_snapshot_hash(p_snapshot jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION public.confirm_provider_record(p_source_kind text, p_source_id uuid, p_snapshot_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  snap jsonb;
  h text;
  r public.provider_record_confirmations%ROWTYPE;
  dup boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  snap := public.provider_record_snapshot(p_source_kind, p_source_id);
  IF snap IS NULL OR (snap->>'user_id')::uuid IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Record unavailable: confirm only a record that names your account' USING ERRCODE = '42501';
  END IF;
  h := public.provider_record_snapshot_hash(snap);
  IF p_snapshot_hash IS DISTINCT FROM h THEN
    RAISE EXCEPTION 'The record changed since you read it; read it again and confirm what is shown' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO r FROM public.provider_record_confirmations c
    WHERE c.user_id = uid AND c.source_kind = p_source_kind AND c.source_id = p_source_id AND c.snapshot_hash = h;
  IF FOUND THEN
    dup := true;
  ELSE
    INSERT INTO public.provider_record_confirmations (user_id, source_kind, source_id, snapshot, snapshot_hash)
      VALUES (uid, p_source_kind, p_source_id, snap, h) RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('confirmation_id', r.id, 'source_kind', r.source_kind, 'source_id', r.source_id, 'snapshot_hash', r.snapshot_hash,
    'rung', r.rung, 'signed_at', r.signed_at, 'duplicate', dup, 'counted_as_skill_evidence', false,
    'basis', 'your confirmation of your own recorded contribution; skills come only from attributed work and accepted completions');
END $$;
REVOKE ALL ON FUNCTION public.confirm_provider_record(text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_provider_record(text, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.confirm_provider_record(text, uuid, text) IS
  'Authenticated Sign: confirm your own legacy provider record (contractor_work_contributions or technicians) exactly as shown (snapshot hash). Self-confirmed; never skill evidence.';

CREATE FUNCTION public.provider_record_confirmation_state(p_user uuid, p_source_kind text, p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  cur text := public.provider_record_snapshot_hash(public.provider_record_snapshot(p_source_kind, p_source_id));
  last public.provider_record_confirmations%ROWTYPE;
BEGIN
  SELECT * INTO last FROM public.provider_record_confirmations c
    WHERE c.user_id = p_user AND c.source_kind = p_source_kind AND c.source_id = p_source_id ORDER BY c.signed_at DESC, c.id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unconfirmed'); END IF;
  RETURN jsonb_build_object('state', CASE WHEN last.snapshot_hash = cur THEN 'confirmed' ELSE 'changed_since_confirmed' END,
    'confirmation_id', last.id, 'confirmed_at', last.signed_at, 'rung', last.rung);
END $$;
REVOKE ALL ON FUNCTION public.provider_record_confirmation_state(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_record_confirmation_state(uuid, text, uuid) TO service_role;

CREATE FUNCTION public.my_suggested_provider_links() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  actor_rows jsonb;
  org_rows jsonb;
  contrib_rows jsonb;
  tech_rows jsonb;
  n_actors integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;

  -- Actors with attributed work (component events or work-order operations), at most 200, most recent work first.
  WITH worked AS (
    SELECT x.actor_id, max(x.d) AS last_work FROM (
      SELECT ce.actor_id, ce.event_date::date AS d FROM public.component_events ce WHERE ce.actor_id IS NOT NULL AND ce.vehicle_id IS NOT NULL
      UNION ALL
      SELECT li.actor_id, NULL::date FROM public.work_order_line_items li WHERE li.actor_id IS NOT NULL) x
    GROUP BY x.actor_id ORDER BY max(x.d) DESC NULLS LAST, x.actor_id LIMIT 200
  ), scored AS (
    SELECT w.actor_id, public.actor_link_evidence_items(uid, w.actor_id) AS items FROM worked w
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
      'actor', public.platform_actor_label(s.actor_id),
      'strength', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(s.items) e WHERE e->>'strength' = 'direct') THEN 'direct' ELSE 'corroborating' END,
      'evidence', jsonb_build_object('total', jsonb_array_length(s.items),
        'direct', (SELECT count(*) FROM jsonb_array_elements(s.items) e WHERE e->>'strength' = 'direct'),
        'corroborating', (SELECT count(*) FROM jsonb_array_elements(s.items) e WHERE e->>'strength' = 'corroborating'),
        'by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT e->>'kind' k, count(*) n FROM jsonb_array_elements(s.items) e GROUP BY 1) q), '{}'::jsonb),
        'approvable_for', COALESCE((SELECT jsonb_agg(DISTINCT a) FROM jsonb_array_elements(s.items) e, jsonb_array_elements_text(e->'approvable_for') a), '[]'::jsonb)),
      'your_claim', (SELECT jsonb_build_object('claim_id', c.id, 'status', c.status, 'rung', c.verification_method, 'filed_at', c.created_at)
        FROM public.account_link_claims c WHERE c.user_id = uid AND c.actor_id = s.actor_id ORDER BY c.created_at DESC LIMIT 1),
      'linked_to_another_account', EXISTS (SELECT 1 FROM public.account_link_claims c WHERE c.actor_id = s.actor_id AND c.user_id <> uid
        AND c.status = 'approved'),
      'actions', CASE WHEN EXISTS (SELECT 1 FROM public.account_link_claims c WHERE c.user_id = uid AND c.actor_id = s.actor_id)
        THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('action', 'claim', 'writer', 'account_link_claims insert',
          'row', jsonb_build_object('user_id', uid, 'platform', 'nuke_actor', 'handle', s.actor_id::text, 'actor_id', s.actor_id,
            'verification_method', 'self_claim'),
          'then', 'evidence is reviewed (actor_link_claim_evidence_read); nothing is approved automatically')) END)
      ORDER BY (SELECT count(*) FROM jsonb_array_elements(s.items) e WHERE e->>'strength' = 'direct') DESC, jsonb_array_length(s.items) DESC, s.actor_id),
      '[]'::jsonb)
    INTO n_actors, actor_rows
    FROM scored s WHERE jsonb_array_length(s.items) > 0;

  -- Public organizations within 150 m of the viewer's geotagged photos among their most recent 2,000 timed photos (top 20
  -- places). Location is filtered after the window so the planner walks (user_id, taken_at), never the partial GPS index.
  WITH recent AS MATERIALIZED (
    SELECT vi.taken_at, vi.latitude, vi.longitude FROM public.vehicle_images vi
    WHERE vi.user_id = uid AND vi.taken_at IS NOT NULL AND COALESCE(vi.is_superseded, false) = false
    ORDER BY vi.taken_at DESC LIMIT 2000
  ), mine AS (
    SELECT r.taken_at, r.latitude::float8 AS lat, r.longitude::float8 AS lon FROM recent r
    WHERE r.latitude IS NOT NULL AND r.longitude IS NOT NULL
  ), places AS (
    SELECT round(lat::numeric, 3) AS clat, round(lon::numeric, 3) AS clon, count(*) n FROM mine GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 20
  ), near AS (
    SELECT DISTINCT ol.organization_id, ol.latitude::float8 AS lat, ol.longitude::float8 AS lon
    FROM places p JOIN public.organization_locations ol
      ON ol.latitude BETWEEN p.clat - 0.003 AND p.clat + 0.003 AND ol.longitude BETWEEN p.clon - 0.004 AND p.clon + 0.004
    JOIN public.organizations o ON o.id = ol.organization_id AND o.is_public IS TRUE
      AND o.business_type IN ('garage', 'restoration_shop', 'performance_shop', 'builder', 'detailing', 'dealer')
    WHERE NOT EXISTS (SELECT 1 FROM public.organization_contributors oc WHERE oc.organization_id = ol.organization_id AND oc.user_id = uid)
      AND NOT EXISTS (SELECT 1 FROM public.business_ownership bo WHERE bo.business_id = ol.organization_id AND bo.owner_id = uid)
  ), hits AS (
    SELECT n.organization_id, m.taken_at FROM near n JOIN mine m
      ON m.lat BETWEEN n.lat - 0.0015 AND n.lat + 0.0015 AND m.lon BETWEEN n.lon - 0.002 AND n.lon + 0.002
     AND 6371000 * 2 * asin(sqrt(power(sin(radians(m.lat - n.lat) / 2), 2)
       + cos(radians(n.lat)) * cos(radians(m.lat)) * power(sin(radians(m.lon - n.lon) / 2), 2))) <= 150
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organization', public.platform_organization_label(g.organization_id),
      'strength', 'corroborating',
      'evidence', jsonb_build_object('photos_at_site', g.photos, 'days', g.days, 'first_at', g.first_at, 'last_at', g.last_at,
        'radius_m', 150, 'basis', 'your own geotagged photos within 150 m of a known location of the organization'),
      'actions', jsonb_build_array(jsonb_build_object('action', 'ask_to_join', 'writer', 'organization_contributors insert',
        'row', jsonb_build_object('organization_id', g.organization_id, 'user_id', uid, 'role', 'contributor', 'status', 'pending',
          'verification_method', 'self_claimed'),
        'then', 'the organization''s owner or an admin decides; nothing is joined automatically')))
      ORDER BY g.photos DESC, g.organization_id), '[]'::jsonb)
    INTO org_rows
    FROM (SELECT h.organization_id, count(*) photos, count(DISTINCT h.taken_at::date) days, min(h.taken_at) first_at, max(h.taken_at) last_at
      FROM hits h GROUP BY h.organization_id ORDER BY count(*) DESC LIMIT 20) g;

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.d DESC NULLS LAST, x.id), '[]'::jsonb) INTO contrib_rows FROM (
    SELECT c.id, c.work_date AS d, jsonb_build_object('source_kind', 'contractor_work_contribution', 'source_id', c.id,
        'organization', public.platform_organization_label(c.organization_id), 'work_category', c.work_category,
        'work_description', c.work_description, 'work_date', c.work_date, 'labor_hours', c.labor_hours, 'hourly_rate', c.hourly_rate,
        'vehicle_id', c.vehicle_id, 'verified_by_shop', COALESCE(c.verified_by_shop, false),
        'snapshot_hash', public.provider_record_snapshot_hash(public.provider_record_snapshot('contractor_work_contribution', c.id)),
        'confirmation', public.provider_record_confirmation_state(uid, 'contractor_work_contribution', c.id)) AS item
    FROM public.contractor_work_contributions c WHERE c.contractor_user_id = uid ORDER BY c.work_date DESC NULLS LAST, c.id LIMIT 500) x;
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.id), '[]'::jsonb) INTO tech_rows FROM (
    SELECT t.id, jsonb_build_object('source_kind', 'technician', 'source_id', t.id, 'display_name', t.display_name,
        'certification_level', t.certification_level, 'specializations', to_jsonb(t.specializations),
        'organization', public.platform_organization_label(t.shop_id), 'experience_years', t.experience_years,
        'hourly_rate_cents', t.hourly_rate_cents, 'record_source', t.source,
        'snapshot_hash', public.provider_record_snapshot_hash(public.provider_record_snapshot('technician', t.id)),
        'confirmation', public.provider_record_confirmation_state(uid, 'technician', t.id)) AS item
    FROM public.technicians t WHERE t.user_id = uid ORDER BY t.id LIMIT 100) x;

  RETURN jsonb_build_object('as_of', statement_timestamp(), 'viewer', jsonb_build_object('role', 'self'),
    'actor_links', actor_rows,
    'organizations', org_rows,
    'recorded_contributions', jsonb_build_object('contractor_work', contrib_rows, 'technician_records', tech_rows,
      'basis', 'records that name your account; confirming them is your own statement (self_confirmed), never evidence-derived skill',
      'action', jsonb_build_object('action', 'confirm', 'rpc', 'confirm_provider_record',
        'args', jsonb_build_array('p_source_kind', 'p_source_id', 'p_snapshot_hash'))),
    'counts', jsonb_build_object('actor_links', jsonb_array_length(actor_rows),
      'actor_links_direct', (SELECT count(*) FROM jsonb_array_elements(actor_rows) a WHERE a->>'strength' = 'direct'),
      'organizations', jsonb_array_length(org_rows), 'contractor_work', jsonb_array_length(contrib_rows),
      'technician_records', jsonb_array_length(tech_rows)),
    'coverage', jsonb_build_object('actors_considered', 'actors with attributed work, most recent 200',
      'organizations_considered', 'public work facilities (garage, restoration, performance, builder, detailing, dealer) with a known location; the geotagged ones among your most recent 2,000 timed photos, top 20 places',
      'never', jsonb_build_array('name, phone or e-mail matching', 'automatic claims, joins or approvals')));
END $$;
REVOKE ALL ON FUNCTION public.my_suggested_provider_links() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_suggested_provider_links() TO authenticated;
COMMENT ON FUNCTION public.my_suggested_provider_links() IS
  'Authenticated: work actors, organizations and your own legacy records your evidence supports, with claim / ask-to-join / confirm actions. Never name, phone or e-mail matching; nothing automatic.';

NOTIFY pgrst, 'reload schema';
COMMIT;
