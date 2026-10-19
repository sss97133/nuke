-- Authenticated job readers: the signed-in app reads its own identity, its work orders, one job's path and
-- resources, and its signature queue. Each wraps an existing owner and returns a viewer block decided on the server:
--   viewer {context, slots[], money_visible, contact_visible, decided_from:'auth.uid()', identity_bridge}
-- plus as_of and coverage. Nothing here returns customer contact fields or amounts (money_visible is false
-- everywhere until a reader carries defended money), and nothing writes.
--
-- Access to a work order is the work_orders read policy, slot by slot (work_order_is_accessible is the same
-- predicate): customer, org_owner (active business_ownership), vehicle_access (vehicle user/owner/uploader or
-- vehicle_user_has_access) and admin. A performer slot exists only through an evidenced identity bridge: an approved
-- account_link_claims actor claim above self_claim whose actor is named on one of the job's operations. Fulfillment
-- suppliers and attestors are attributed by source testimony and grant no access.
-- Resource supplier/attestor identity and quoted source excerpts are returned to parties only (customer, org_owner,
-- performer). viewer.actions is empty until Sign writers exist.
-- The wrapped readers (read_work_order_job_path, read_work_order_resources) stay service-only and unchanged; these
-- wrappers are SECURITY DEFINER with a fixed search_path, gated on auth.uid(), executable by authenticated only.
-- Contract: supabase/sql/test_job_readers_authenticated.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.viewer_identity_bridge(p_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'state', CASE WHEN bool_or(c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')) THEN 'evidenced'
      WHEN bool_or(c.status = 'pending') THEN 'claimed' ELSE 'none' END,
    'evidenced_actor_ids', COALESCE(to_jsonb(array_agg(DISTINCT c.actor_id) FILTER (WHERE c.status = 'approved'
      AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign'))), '[]'::jsonb))
  FROM public.account_link_claims c
  WHERE c.user_id = p_user AND c.actor_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.viewer_identity_bridge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_identity_bridge(uuid) TO service_role;
COMMENT ON FUNCTION public.viewer_identity_bridge(uuid) IS 'Internal: identity bridge state (none|claimed|evidenced) and evidenced actor ids for one account, from account_link_claims actor claims only.';

CREATE FUNCTION public.work_order_viewer_slots(p_user uuid, p_work_order_id uuid DEFAULT NULL)
RETURNS TABLE(work_order_id uuid, vehicle_id uuid, title text, slots text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  WITH me AS (
    SELECT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user AND au.is_active) AS is_admin,
      ARRAY(SELECT jsonb_array_elements_text(public.viewer_identity_bridge(p_user)->'evidenced_actor_ids')::uuid) AS actors
  ), s AS (
    SELECT w.id, w.vehicle_id, w.title, array_remove(ARRAY[
        CASE WHEN w.customer_id = p_user THEN 'customer' END,
        CASE WHEN w.organization_id IN (SELECT bo.business_id FROM public.business_ownership bo
          WHERE bo.owner_id = p_user AND bo.status = 'active') THEN 'org_owner' END,
        CASE WHEN v.id IS NOT NULL AND (v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user
          OR public.vehicle_user_has_access(v.id, p_user)) THEN 'vehicle_access' END,
        CASE WHEN me.is_admin THEN 'admin' END,
        CASE WHEN cardinality(me.actors) > 0 AND EXISTS (SELECT 1 FROM public.work_order_line_items li
          WHERE li.work_order_id = w.id AND li.actor_id = ANY (me.actors)) THEN 'performer' END], NULL) AS slots
    FROM public.work_orders w LEFT JOIN public.vehicles v ON v.id = w.vehicle_id CROSS JOIN me
    WHERE p_user IS NOT NULL AND (p_work_order_id IS NULL OR w.id = p_work_order_id)
  )
  SELECT id, vehicle_id, title, slots FROM s WHERE cardinality(slots) > 0
$$;
REVOKE ALL ON FUNCTION public.work_order_viewer_slots(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_viewer_slots(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_viewer_slots(uuid, uuid) IS 'Internal: work orders an account may read and the slots that grant it: the work_orders read policy split into customer, org_owner, vehicle_access, admin, plus performer through an evidenced identity bridge only.';

CREATE FUNCTION public.job_reader_viewer(p_context text, p_slots text[], p_bridge jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('context', p_context, 'slots', to_jsonb(COALESCE(p_slots, '{}'::text[])),
    'money_visible', false, 'contact_visible', false, 'decided_from', 'auth.uid()',
    'identity_bridge', COALESCE(p_bridge->>'state', 'none'))
$$;
REVOKE ALL ON FUNCTION public.job_reader_viewer(text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_reader_viewer(text, text[], jsonb) TO service_role;

CREATE FUNCTION public.job_reader_context(p_slots text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_slots && ARRAY['customer','vehicle_access'] THEN 'client'
    WHEN 'performer' = ANY (p_slots) THEN 'provider' WHEN 'org_owner' = ANY (p_slots) THEN 'org_member'
    WHEN 'admin' = ANY (p_slots) THEN 'admin' ELSE 'visitor' END
$$;
REVOKE ALL ON FUNCTION public.job_reader_context(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_reader_context(text[]) TO service_role;

CREATE FUNCTION public.my_identity_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  uid uuid := auth.uid();
  bridge jsonb;
  profile jsonb;
  claims jsonb;
  orgs jsonb;
  external jsonb;
  link_actor uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  bridge := public.viewer_identity_bridge(uid);
  SELECT jsonb_build_object('user_id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
      'bio', p.bio, 'city', p.city, 'state', p.state, 'is_public', p.is_public, 'member_since', p.member_since,
      'self_claims', jsonb_build_object('basis', 'stated_by_account', 'role', p.role, 'user_type', p.user_type,
        'profession', p.profession, 'expertise_areas', p.expertise_areas))
    INTO profile FROM public.profiles p WHERE p.id = uid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('claim_id', c.id, 'actor_id', c.actor_id,
      'actor', jsonb_build_object('name', a.name, 'actor_type', a.actor_type), 'rung', c.verification_method,
      'status', c.status, 'filed_at', c.created_at, 'reviewed_at', c.reviewed_at,
      'evidence_entries', jsonb_array_length(c.rung_evidence)) ORDER BY c.created_at, c.id), '[]'::jsonb)
    INTO claims FROM public.account_link_claims c JOIN public.actors a ON a.id = c.actor_id
    WHERE c.user_id = uid AND c.actor_id IS NOT NULL;
  SELECT c.actor_id INTO link_actor FROM public.account_link_claims c
    WHERE c.user_id = uid AND c.actor_id IS NOT NULL AND c.status IN ('pending','approved')
    ORDER BY array_position(ARRAY['unknown','self_claim','work_evidence','co_sign','authenticated_sign'], c.verification_method) DESC,
      c.created_at DESC LIMIT 1;
  SELECT COALESCE(jsonb_agg(m ORDER BY m->>'relation', m->>'organization_id'), '[]'::jsonb) INTO orgs FROM (
    SELECT jsonb_build_object('relation', 'contributor', 'organization_id', oc.organization_id,
        'organization_name', COALESCE(o.business_name, o.name), 'role', oc.role, 'status', oc.status,
        'start_date', oc.start_date, 'end_date', oc.end_date, 'verification_method', oc.verification_method,
        'verified_at', oc.verified_at) AS m
      FROM public.organization_contributors oc LEFT JOIN public.organizations o ON o.id = oc.organization_id
      WHERE oc.user_id = uid
    UNION ALL
    SELECT jsonb_build_object('relation', 'ownership', 'organization_id', bo.business_id,
        'organization_name', COALESCE(o.business_name, o.name), 'role', bo.ownership_type, 'status', bo.status)
      FROM public.business_ownership bo LEFT JOIN public.organizations o ON o.id = bo.business_id
      WHERE bo.owner_id = uid) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('claim_id', c.id, 'platform', c.platform, 'handle', c.handle,
      'status', c.status, 'identity_resolved', c.external_identity_id IS NOT NULL) ORDER BY c.created_at, c.id), '[]'::jsonb)
    INTO external FROM public.account_link_claims c WHERE c.user_id = uid AND c.actor_id IS NULL;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', bridge), 'as_of', statement_timestamp(),
    'profile', profile,
    'provider_link', jsonb_build_object('state', bridge->>'state', 'actor_id', link_actor, 'claims', claims,
      'basis', 'account_link_claims actor claims; never matched by name, phone or email'),
    'org_memberships', orgs, 'external_identity_claims', external, 'payout_setup', 'not_established',
    'coverage', jsonb_build_object('profile_found', profile IS NOT NULL, 'actor_claims', jsonb_array_length(claims),
      'org_memberships', jsonb_array_length(orgs), 'external_identity_claims', jsonb_array_length(external)));
END $$;

CREATE FUNCTION public.my_work_orders(p_slot text DEFAULT NULL, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  bridge jsonb;
  lim integer;
  total integer;
  rows_out jsonb;
  next_after uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF p_slot IS NOT NULL AND p_slot NOT IN ('customer','org_owner','vehicle_access','admin','performer') THEN
    RAISE EXCEPTION 'Unknown slot %', p_slot USING ERRCODE = '22023';
  END IF;
  lim := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  bridge := public.viewer_identity_bridge(uid);
  WITH visible AS MATERIALIZED (
    SELECT s.work_order_id, s.vehicle_id, s.title, s.slots FROM public.work_order_viewer_slots(uid) s
    WHERE p_slot IS NULL OR p_slot = ANY (s.slots)
  ), page AS (
    SELECT v.* FROM visible v WHERE p_after IS NULL OR v.work_order_id > p_after
    ORDER BY v.work_order_id LIMIT lim + 1
  ), shown AS (SELECT * FROM page ORDER BY work_order_id LIMIT lim),
  paths AS (SELECT s.*, public.read_work_order_job_path(s.work_order_id) AS p FROM shown s)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('work_order_id', x.work_order_id, 'vehicle_id', x.vehicle_id, 'title', x.title,
      'slots', to_jsonb(x.slots),
      'stage_states', (SELECT jsonb_object_agg(st.key, st.value->>'state') FROM jsonb_each(x.p->'stages') st),
      'first_gap', (SELECT jsonb_build_object('stage', o.stage, 'gap', x.p#>>ARRAY['stages', o.stage, 'gaps', '0'])
        FROM unnest(ARRAY['intake','inspection','plan','terms','execution','completion','accounting']) WITH ORDINALITY o(stage, n)
        WHERE jsonb_array_length(x.p#>ARRAY['stages', o.stage, 'gaps']) > 0 ORDER BY o.n LIMIT 1),
      'inconsistencies', (SELECT count(*) FROM jsonb_each(x.p->'stages') st, jsonb_array_elements(st.value->'inconsistencies')),
      'as_of', x.p->'as_of') ORDER BY x.work_order_id), '[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page) > lim THEN (SELECT work_order_id FROM shown ORDER BY work_order_id DESC LIMIT 1) END,
    (SELECT count(*) FROM visible)
    INTO rows_out, next_after, total FROM paths x;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', bridge), 'as_of', statement_timestamp(),
    'rows', rows_out, 'next_after', next_after,
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'total_for_viewer', total, 'slot_filter', p_slot,
      'population', 'work_orders readable under the work_orders read policy, plus evidenced-bridge performer slots',
      'state_basis', 'presence of existing owner records and clocks; not verified truth'));
END $$;

CREATE FUNCTION public.work_order_job_path_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  my_slots text[];
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(uid, p_work_order_id) s;
  IF my_slots IS NULL THEN RAISE EXCEPTION 'Work order unavailable'; END IF;
  RETURN public.read_work_order_job_path(p_work_order_id)
    || jsonb_build_object('viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots,
      public.viewer_identity_bridge(uid)) || jsonb_build_object('actions', '[]'::jsonb,
      'actions_basis', 'no Sign writer exists yet; the server lists actionable steps here'),
      'coverage', jsonb_build_object('stages_reported', 7, 'population', 'one work order',
        'sources', 'work_orders, line items, resource graph, parts, labor, assignments, component_events, status history, payments'));
END $$;

CREATE FUNCTION public.work_order_resources_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  my_slots text[];
  party boolean;
  r jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(uid, p_work_order_id) s;
  IF my_slots IS NULL THEN RAISE EXCEPTION 'Work order unavailable'; END IF;
  party := my_slots && ARRAY['customer','org_owner','performer'];
  r := public.read_work_order_resources(p_work_order_id);
  r := jsonb_set(r, '{attestations}', COALESCE((SELECT jsonb_agg(CASE WHEN party THEN a
      ELSE a || '{"attestor_user_id":null,"attestor_organization_id":null}'::jsonb END
      || jsonb_build_object('attestor_basis', 'attributed_by_source_testimony',
        'attestor_identity', CASE WHEN party THEN 'shown_to_party' ELSE 'withheld_not_party' END) ORDER BY a->>'id')
    FROM jsonb_array_elements(r->'attestations') a), '[]'::jsonb));
  IF NOT party THEN
    r := jsonb_set(r, '{fulfillments}', COALESCE((SELECT jsonb_agg(f || '{"supplier_user_id":null,"supplier_organization_id":null,
        "supplier_identity":"withheld_not_party"}'::jsonb ORDER BY f->>'id') FROM jsonb_array_elements(r->'fulfillments') f), '[]'::jsonb));
    r := jsonb_set(r, '{requirements}', COALESCE((SELECT jsonb_agg(CASE WHEN q ? 'basis_excerpt' AND q->>'basis_excerpt' IS NOT NULL
        THEN q || '{"basis_excerpt":null,"basis_excerpt_visibility":"withheld_not_party"}'::jsonb ELSE q END ORDER BY q->>'id')
      FROM jsonb_array_elements(r->'requirements') q), '[]'::jsonb));
    IF r ? 'specifications' THEN
      r := jsonb_set(r, '{specifications}', COALESCE((SELECT jsonb_agg(CASE WHEN q->>'basis_excerpt' IS NOT NULL
          THEN q || '{"basis_excerpt":null,"basis_excerpt_visibility":"withheld_not_party"}'::jsonb ELSE q END ORDER BY q->>'id')
        FROM jsonb_array_elements(r->'specifications') q), '[]'::jsonb));
    END IF;
  END IF;
  RETURN r || jsonb_build_object('viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots,
    public.viewer_identity_bridge(uid)) || jsonb_build_object('party', party));
END $$;

CREATE FUNCTION public.my_signature_queue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  total integer;
  items jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO total FROM public.work_sessions s JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE s.user_id = uid AND s.owner_confirmed_at IS NULL AND s.duration_minutes > 0
      AND (v.user_id = uid OR v.owner_id = uid) AND v.make <> 'UNRESOLVED';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'work_session', 'ref_id', q.id, 'work_order_id', NULL,
      'vehicle', jsonb_build_object('vehicle_id', q.vehicle_id, 'year', q.year, 'make', q.make, 'model', q.model),
      'clock', jsonb_build_object('session_date', q.session_date, 'start_time', q.start_time, 'end_time', q.end_time),
      'capture_span_minutes', q.duration_minutes,
      'evidence_counts', jsonb_build_object('session_images', q.image_count,
        'vehicle_photos_that_day', (SELECT count(*) FROM public.vehicle_images vi WHERE vi.vehicle_id = q.vehicle_id
          AND vi.taken_at >= q.session_date::timestamptz AND vi.taken_at < (q.session_date + 1)::timestamptz
          AND vi.is_external IS FALSE)),
      'sign', jsonb_build_object('rpc', 'confirm_work_session', 'binds', 'self-confirmation of a photo-derived work day',
        'does_not_bind', jsonb_build_array('counterparty acceptance', 'labor value', 'payment')))
      ORDER BY q.session_date DESC, q.id), '[]'::jsonb) INTO items
  FROM (SELECT s.id, s.vehicle_id, s.session_date, s.start_time, s.end_time, s.duration_minutes, s.image_count, v.year, v.make, v.model
    FROM public.work_sessions s JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE s.user_id = uid AND s.owner_confirmed_at IS NULL AND s.duration_minutes > 0
      AND (v.user_id = uid OR v.owner_id = uid) AND v.make <> 'UNRESOLVED'
    ORDER BY s.session_date DESC, s.id LIMIT 250) q;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid)),
    'as_of', statement_timestamp(), 'items', items,
    'coverage', jsonb_build_object('returned', jsonb_array_length(items), 'total', total, 'limit', 250,
      'kinds', jsonb_build_array('work_session'),
      'kinds_not_yet_available', jsonb_build_array('terms', 'offer', 'completion_attestation', 'co_sign_request'),
      'population', 'own unconfirmed work sessions with capture span on own resolved vehicles'));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['my_identity_read()','my_work_orders(text,uuid,integer)','work_order_job_path_read(uuid)',
      'work_order_resources_read(uuid)','my_signature_queue()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.my_identity_read() IS 'Authenticated self reader: profile basics and self-claims, provider link from actor claims (none|claimed|evidenced), org memberships, external identity claims; payout_setup not_established. No contact fields.';
COMMENT ON FUNCTION public.my_work_orders(text, uuid, integer) IS 'Authenticated: work orders the caller may read (work_orders read policy plus evidenced performer), with slots, the seven job-path stage states and first gap. Keyset by work_order_id; no contact fields or amounts.';
COMMENT ON FUNCTION public.work_order_job_path_read(uuid) IS 'Authenticated wrapper of read_work_order_job_path for parties and access holders, with viewer block and viewer.actions (empty until Sign writers exist).';
COMMENT ON FUNCTION public.work_order_resources_read(uuid) IS 'Authenticated wrapper of read_work_order_resources; supplier/attestor identity and source excerpts shown to parties (customer, org_owner, performer) only.';
COMMENT ON FUNCTION public.my_signature_queue() IS 'Authenticated: items awaiting the caller''s Sign. Today only own unconfirmed work sessions (confirm_work_session), the WorkDaySignView population.';
NOTIFY pgrst, 'reload schema';
COMMIT;
