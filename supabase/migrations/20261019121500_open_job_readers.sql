-- Open job readers under the privacy doctrine (owner, 2026-10-18 23:06-23:08 PT; work-order-intelligence.md):
-- job, work, provider and vehicle data is open; personal information (email, phone, street address, legal names of
-- private people) is withheld at the source; quote prices, labor rates and parts costs are open; payments and
-- balances between specific parties are shown only to those parties.
--
--   * work_order_job_path_read and work_order_resources_read become callable by anon as well as authenticated.
--     A visitor's viewer is {context:'visitor', slots:[], money_visible:false}. A work order on a vehicle whose
--     owner set is_public = false stays visible only to viewers holding a slot on it.
--   * New vehicle_work_orders_read(p_vehicle_id, p_after, p_limit): the work orders on one vehicle, same row shape
--     as my_work_orders; slots list only the viewer's own.
--   * Parties (customer, org_owner, performer) see payments: money_visible true and the accounting stage as
--     recorded. For everyone else the accounting stage is 'withheld' (no payment or payout counts).
--   * People appear as {kind:'user', profile_id, handle} only when their profile is public and has a handle,
--     otherwise {label:'unnamed party'}; raw user ids are returned to parties only. Work actors carry no name
--     (a person's legal name); an actor shows a handle only through an evidenced identity bridge to a public
--     profile. Organizations appear by name. Free text that can quote people (basis excerpts, source
--     interpretations) is returned to parties only.
--   * Every job row and header carries vehicle_label {year, make, model, trim, text}, display_title with its basis
--     (title, first operation, scope category, then 'Work order on <vehicle>'; for non-parties a title or operation
--     containing the customer's name or contact-like text is skipped) and request_source_label.
--   * work_order_viewer_slots no longer evaluates every work order: one work order, one vehicle, or the caller's
--     candidate set (customer, owned organizations, own vehicles, evidenced performer, vehicle-access check).
-- my_* readers stay authenticated-only personal queues. Wrapped readers stay service-only and unchanged. No writes.
-- Contract: supabase/sql/test_open_job_readers.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.job_reader_is_party(p_slots text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(p_slots && ARRAY['customer','org_owner','performer'], false)
$$;

CREATE FUNCTION public.work_order_row_slots(p_user uuid, p_is_admin boolean, p_actors uuid[], p_work_order_id uuid,
  p_customer_id uuid, p_organization_id uuid, p_vehicle_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_user IS NULL THEN '{}'::text[] ELSE array_remove(ARRAY[
    CASE WHEN p_customer_id = p_user THEN 'customer' END,
    CASE WHEN p_organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
      WHERE bo.business_id = p_organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN 'org_owner' END,
    CASE WHEN p_vehicle_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id
      AND (v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user OR public.vehicle_user_has_access(v.id, p_user))) THEN 'vehicle_access' END,
    CASE WHEN p_is_admin THEN 'admin' END,
    CASE WHEN cardinality(p_actors) > 0 AND EXISTS (SELECT 1 FROM public.work_order_line_items li
      WHERE li.work_order_id = p_work_order_id AND li.actor_id = ANY (p_actors)) THEN 'performer' END], NULL) END
$$;

DROP FUNCTION public.work_order_viewer_slots(uuid, uuid);
CREATE FUNCTION public.work_order_viewer_slots(p_user uuid, p_work_order_id uuid DEFAULT NULL, p_vehicle_id uuid DEFAULT NULL)
RETURNS TABLE(work_order_id uuid, vehicle_id uuid, slots text[])
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  adm boolean := false;
  acts uuid[] := '{}';
  owned uuid[];
  own_vehicles uuid[];
  bridged uuid[];
BEGIN
  IF p_user IS NOT NULL THEN
    adm := EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user AND au.is_active);
    acts := ARRAY(SELECT jsonb_array_elements_text(public.viewer_identity_bridge(p_user)->'evidenced_actor_ids')::uuid);
  END IF;
  IF p_work_order_id IS NOT NULL THEN
    RETURN QUERY SELECT w.id, w.vehicle_id, public.work_order_row_slots(p_user, adm, acts, w.id, w.customer_id, w.organization_id, w.vehicle_id)
      FROM public.work_orders w WHERE w.id = p_work_order_id;
  ELSIF p_vehicle_id IS NOT NULL THEN
    RETURN QUERY SELECT w.id, w.vehicle_id, public.work_order_row_slots(p_user, adm, acts, w.id, w.customer_id, w.organization_id, w.vehicle_id)
      FROM public.work_orders w WHERE w.vehicle_id = p_vehicle_id;
  ELSIF p_user IS NULL THEN
    RETURN;
  ELSIF adm THEN
    RETURN QUERY SELECT w.id, w.vehicle_id, public.work_order_row_slots(p_user, adm, acts, w.id, w.customer_id, w.organization_id, w.vehicle_id)
      FROM public.work_orders w;
  ELSE
    owned := ARRAY(SELECT bo.business_id FROM public.business_ownership bo WHERE bo.owner_id = p_user AND bo.status = 'active');
    own_vehicles := ARRAY(SELECT v.id FROM public.vehicles v WHERE v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user);
    bridged := ARRAY(SELECT DISTINCT li.work_order_id FROM public.work_order_line_items li WHERE li.actor_id = ANY (acts));
    RETURN QUERY SELECT w.id, w.vehicle_id, public.work_order_row_slots(p_user, adm, acts, w.id, w.customer_id, w.organization_id, w.vehicle_id)
      FROM public.work_orders w
      WHERE w.customer_id = p_user OR w.organization_id = ANY (owned) OR w.vehicle_id = ANY (own_vehicles) OR w.id = ANY (bridged)
        OR (w.vehicle_id IS NOT NULL AND public.vehicle_user_has_access(w.vehicle_id, p_user));
  END IF;
END $$;
COMMENT ON FUNCTION public.work_order_viewer_slots(uuid, uuid, uuid) IS 'Internal: slots an account holds on one work order, on a vehicle''s work orders, or on every work order it may read (the work_orders read policy split into customer, org_owner, vehicle_access, admin, plus performer through an evidenced identity bridge). Rows for one work order or one vehicle are returned even with no slots.';

CREATE FUNCTION public.work_order_vehicle_open(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT p_vehicle_id IS NULL OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.is_public IS TRUE)
$$;

CREATE FUNCTION public.platform_person_label(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_user IS NULL THEN NULL ELSE COALESCE(
    (SELECT jsonb_build_object('kind', 'user', 'profile_id', p.id, 'handle', p.username) FROM public.profiles p
      WHERE p.id = p_user AND p.is_public IS TRUE AND NULLIF(btrim(p.username), '') IS NOT NULL),
    jsonb_build_object('kind', 'user', 'label', 'unnamed party')) END
$$;

CREATE FUNCTION public.platform_organization_label(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_organization_id IS NULL THEN NULL ELSE
    jsonb_build_object('kind', 'organization', 'organization_id', p_organization_id,
      'name', (SELECT COALESCE(o.business_name, o.name) FROM public.organizations o WHERE o.id = p_organization_id)) END
$$;

CREATE FUNCTION public.platform_actor_label(p_actor_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_actor_id IS NULL THEN NULL ELSE COALESCE(
    (SELECT jsonb_build_object('kind', 'user', 'profile_id', p.id, 'handle', p.username, 'actor_id', p_actor_id,
        'basis', 'evidenced_identity_bridge')
      FROM public.account_link_claims c JOIN public.profiles p ON p.id = c.user_id
      WHERE c.actor_id = p_actor_id AND c.status = 'approved' AND c.verification_method IN ('work_evidence','co_sign','authenticated_sign')
        AND p.is_public IS TRUE AND NULLIF(btrim(p.username), '') IS NOT NULL
      ORDER BY c.reviewed_at DESC, c.id LIMIT 1),
    (SELECT jsonb_build_object('kind', 'actor', 'actor_id', a.id, 'role', a.actor_type, 'label', 'unnamed party')
      FROM public.actors a WHERE a.id = p_actor_id)) END
$$;

CREATE FUNCTION public.work_order_open_header(p_work_order_id uuid, p_party boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  WITH w AS (SELECT * FROM public.work_orders WHERE id = p_work_order_id),
  veh AS (SELECT jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
      'text', NULLIF(concat_ws(' ', v.year, v.make, v.model, v.trim), '')) AS label
    FROM public.vehicles v JOIN w ON v.id = w.vehicle_id),
  tokens AS (SELECT DISTINCT lower(regexp_replace(tok, '\W', '', 'g')) AS tok
    FROM w, regexp_split_to_table(concat_ws(' ', w.customer_name,
      (SELECT p.full_name FROM public.profiles p WHERE p.id = w.customer_id)), '\s+') tok),
  op AS (SELECT btrim(li.task_description) AS t FROM public.work_order_line_items li JOIN w ON li.work_order_id = w.id
    WHERE NULLIF(btrim(li.task_description), '') IS NOT NULL ORDER BY li.line_number NULLS LAST, li.id LIMIT 1),
  cands AS (
    SELECT 1 AS n, 'title' AS basis, NULLIF(btrim(w.title), '') AS t FROM w
    UNION ALL SELECT 2, 'first_operation', t FROM op
    UNION ALL SELECT 3, 'scope_category', upper(left(replace(w.scope_category, '_', ' '), 1)) || substr(replace(w.scope_category, '_', ' '), 2)
      FROM w WHERE NULLIF(btrim(w.scope_category), '') IS NOT NULL
    UNION ALL SELECT 4, 'vehicle', 'Work order on ' || COALESCE((SELECT label->>'text' FROM veh), 'an unidentified vehicle')),
  pick AS (SELECT c.basis, c.t FROM cands c
    WHERE c.t IS NOT NULL AND (p_party OR c.n >= 3 OR (
      c.t !~ '(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})'
      AND NOT EXISTS (SELECT 1 FROM tokens k WHERE length(k.tok) >= 3 AND c.t ~* ('\m' || k.tok || '\M'))))
    ORDER BY c.n LIMIT 1)
  SELECT jsonb_build_object('vehicle_label', (SELECT label FROM veh),
    'display_title', (SELECT t FROM pick), 'display_title_basis', (SELECT basis FROM pick),
    'request_source_label', CASE WHEN w.request_source IS NULL THEN 'Request channel not recorded' ELSE CASE w.request_source
      WHEN 'web' THEN 'Requested on the web' WHEN 'in_person' THEN 'Requested in person'
      WHEN 'walk_in' THEN 'Walk-in request' WHEN 'sms' THEN 'Requested by text message'
      WHEN 'phone' THEN 'Requested by phone' WHEN 'email' THEN 'Requested by email'
      WHEN 'ios' THEN 'Requested in the iOS app' WHEN 'app' THEN 'Requested in the app'
      ELSE 'Requested via ' || replace(w.request_source, '_', ' ') END END)
  FROM w
$$;

CREATE FUNCTION public.work_order_job_path_for_viewer(p_path jsonb, p_money_visible boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_money_visible THEN p_path ELSE jsonb_set(p_path, '{stages,accounting}', jsonb_build_object(
    'state', 'withheld', 'visibility', 'parties_only',
    'basis', 'payments and balances between specific parties are shown only to those parties',
    'labor_value_calculated', false, 'cost_allocated', false, 'disbursement', 'not_performed',
    'gaps', '[]'::jsonb, 'inconsistencies', '[]'::jsonb)) END
$$;

CREATE FUNCTION public.work_order_list_row(p_work_order_id uuid, p_slots text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  WITH x AS (SELECT public.job_reader_is_party(p_slots) AS party),
  y AS (SELECT x.party, public.work_order_job_path_for_viewer(public.read_work_order_job_path(p_work_order_id), x.party) AS p,
      public.work_order_open_header(p_work_order_id, x.party) AS h FROM x)
  SELECT y.h || jsonb_build_object('work_order_id', p_work_order_id, 'vehicle_id', y.p->'vehicle_id',
    'title', y.h->'display_title', 'slots', to_jsonb(COALESCE(p_slots, '{}'::text[])), 'money_visible', y.party,
    'stage_states', (SELECT jsonb_object_agg(st.key, st.value->>'state') FROM jsonb_each(y.p->'stages') st),
    'first_gap', (SELECT jsonb_build_object('stage', o.stage, 'gap', y.p#>>ARRAY['stages', o.stage, 'gaps', '0'])
      FROM unnest(ARRAY['intake','inspection','plan','terms','execution','completion','accounting']) WITH ORDINALITY o(stage, n)
      WHERE jsonb_array_length(y.p#>ARRAY['stages', o.stage, 'gaps']) > 0 ORDER BY o.n LIMIT 1),
    'inconsistencies', (SELECT count(*) FROM jsonb_each(y.p->'stages') st, jsonb_array_elements(st.value->'inconsistencies')),
    'as_of', y.p->'as_of')
  FROM y
$$;

DROP FUNCTION public.job_reader_viewer(text, text[], jsonb);
CREATE FUNCTION public.job_reader_viewer(p_context text, p_slots text[], p_bridge jsonb, p_money_visible boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('context', p_context, 'slots', to_jsonb(COALESCE(p_slots, '{}'::text[])),
    'money_visible', COALESCE(p_money_visible, false), 'contact_visible', false, 'decided_from', 'auth.uid()',
    'identity_bridge', COALESCE(p_bridge->>'state', 'none'))
$$;

CREATE OR REPLACE FUNCTION public.my_identity_read()
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
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', bridge, false), 'as_of', statement_timestamp(),
    'profile', profile,
    'provider_link', jsonb_build_object('state', bridge->>'state', 'actor_id', link_actor, 'claims', claims,
      'basis', 'account_link_claims actor claims; never matched by name, phone or email'),
    'org_memberships', orgs, 'external_identity_claims', external, 'payout_setup', 'not_established',
    'coverage', jsonb_build_object('profile_found', profile IS NOT NULL, 'actor_claims', jsonb_array_length(claims),
      'org_memberships', jsonb_array_length(orgs), 'external_identity_claims', jsonb_array_length(external)));
END $$;

CREATE OR REPLACE FUNCTION public.my_work_orders(p_slot text DEFAULT NULL, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
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
  WITH visible AS MATERIALIZED (
    SELECT s.work_order_id, s.slots FROM public.work_order_viewer_slots(uid) s
    WHERE cardinality(s.slots) > 0 AND (p_slot IS NULL OR p_slot = ANY (s.slots))
  ), page AS (
    SELECT v.* FROM visible v WHERE p_after IS NULL OR v.work_order_id > p_after ORDER BY v.work_order_id LIMIT lim + 1
  ), shown AS (SELECT * FROM page ORDER BY work_order_id LIMIT lim)
  SELECT COALESCE((SELECT jsonb_agg(public.work_order_list_row(s.work_order_id, s.slots) ORDER BY s.work_order_id) FROM shown s), '[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page) > lim THEN (SELECT work_order_id FROM shown ORDER BY work_order_id DESC LIMIT 1) END,
    (SELECT count(*) FROM visible)
    INTO rows_out, next_after, total;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'rows', rows_out, 'next_after', next_after,
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'total_for_viewer', total, 'slot_filter', p_slot,
      'population', 'work_orders readable under the work_orders read policy, plus evidenced-bridge performer slots',
      'state_basis', 'presence of existing owner records and clocks; not verified truth'));
END $$;

CREATE OR REPLACE FUNCTION public.work_order_job_path_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  my_slots text[];
  vid uuid;
  party boolean;
BEGIN
  SELECT s.slots, s.vehicle_id INTO my_slots, vid FROM public.work_order_viewer_slots(uid, p_work_order_id) s;
  IF NOT FOUND OR (cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(vid)) THEN
    RAISE EXCEPTION 'Work order unavailable';
  END IF;
  party := public.job_reader_is_party(my_slots);
  RETURN public.work_order_job_path_for_viewer(public.read_work_order_job_path(p_work_order_id), party)
    || public.work_order_open_header(p_work_order_id, party)
    || jsonb_build_object('viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots,
      public.viewer_identity_bridge(uid), party) || jsonb_build_object('actions', '[]'::jsonb,
      'actions_basis', 'no Sign writer exists yet; the server lists actionable steps here'),
      'coverage', jsonb_build_object('stages_reported', 7, 'population', 'one work order',
        'sources', 'work_orders, line items, resource graph, parts, labor, assignments, component_events, status history, payments',
        'withheld', CASE WHEN party THEN '[]'::jsonb ELSE '["accounting: party payments and balances"]'::jsonb END));
END $$;

CREATE OR REPLACE FUNCTION public.work_order_resources_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  my_slots text[];
  vid uuid;
  party boolean;
  r jsonb;
BEGIN
  SELECT s.slots, s.vehicle_id INTO my_slots, vid FROM public.work_order_viewer_slots(uid, p_work_order_id) s;
  IF NOT FOUND OR (cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(vid)) THEN
    RAISE EXCEPTION 'Work order unavailable';
  END IF;
  party := public.job_reader_is_party(my_slots);
  r := public.read_work_order_resources(p_work_order_id);
  r := jsonb_set(r, '{fulfillments}', COALESCE((SELECT jsonb_agg(
      (CASE WHEN party THEN f ELSE f || jsonb_build_object('supplier_user_id', NULL, 'interpretation', NULL,
        'interpretation_visibility', CASE WHEN f->'interpretation' IS NULL OR f->'interpretation' = 'null'::jsonb THEN NULL ELSE 'withheld_not_party' END) END)
      || jsonb_build_object('supplier', COALESCE(public.platform_person_label((f->>'supplier_user_id')::uuid),
          public.platform_organization_label((f->>'supplier_organization_id')::uuid), jsonb_build_object('kind', 'unknown')),
        'performer', CASE WHEN f->'performer' IS NULL OR f->'performer' = 'null'::jsonb THEN NULL
          ELSE ((f->'performer') - 'name') || jsonb_build_object('display', public.platform_actor_label((f->>'performer_actor_id')::uuid)) END)
      ORDER BY f->>'id') FROM jsonb_array_elements(r->'fulfillments') f), '[]'::jsonb));
  r := jsonb_set(r, '{attestations}', COALESCE((SELECT jsonb_agg(
      (CASE WHEN party THEN a ELSE a || '{"attestor_user_id":null}'::jsonb END)
      || jsonb_build_object('attestor', COALESCE(public.platform_person_label((a->>'attestor_user_id')::uuid),
          public.platform_organization_label((a->>'attestor_organization_id')::uuid)),
        'attestor_basis', 'attributed_by_source_testimony') ORDER BY a->>'id')
    FROM jsonb_array_elements(r->'attestations') a), '[]'::jsonb));
  IF NOT party THEN
    r := jsonb_set(r, '{requirements}', COALESCE((SELECT jsonb_agg(CASE WHEN q->>'basis_excerpt' IS NOT NULL
        THEN q || '{"basis_excerpt":null,"basis_excerpt_visibility":"withheld_not_party"}'::jsonb ELSE q END ORDER BY q->>'id')
      FROM jsonb_array_elements(r->'requirements') q), '[]'::jsonb));
    IF r ? 'specifications' THEN
      r := jsonb_set(r, '{specifications}', COALESCE((SELECT jsonb_agg(CASE WHEN q->>'basis_excerpt' IS NOT NULL
          THEN q || '{"basis_excerpt":null,"basis_excerpt_visibility":"withheld_not_party"}'::jsonb ELSE q END ORDER BY q->>'id')
        FROM jsonb_array_elements(r->'specifications') q), '[]'::jsonb));
    END IF;
  END IF;
  RETURN r || public.work_order_open_header(p_work_order_id, party)
    || jsonb_build_object('viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots,
      public.viewer_identity_bridge(uid), party) || jsonb_build_object('party', party),
      'people_basis', 'people appear by public profile handle, otherwise as unnamed party; organizations by name');
END $$;

CREATE FUNCTION public.vehicle_work_orders_read(p_vehicle_id uuid, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v public.vehicles%ROWTYPE;
  vehicle_open boolean;
  lim integer;
  total integer;
  rows_out jsonb;
  next_after uuid;
  all_slots text[];
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable'; END IF;
  vehicle_open := v.is_public IS TRUE OR (uid IS NOT NULL AND (v.user_id = uid OR v.owner_id = uid OR v.uploaded_by = uid
    OR public.vehicle_user_has_access(v.id, uid)
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = uid AND au.is_active)));
  lim := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  WITH visible AS MATERIALIZED (
    SELECT s.work_order_id, s.slots FROM public.work_order_viewer_slots(uid, NULL, p_vehicle_id) s
    WHERE vehicle_open OR cardinality(s.slots) > 0
  ), page AS (
    SELECT x.* FROM visible x WHERE p_after IS NULL OR x.work_order_id > p_after ORDER BY x.work_order_id LIMIT lim + 1
  ), shown AS (SELECT * FROM page ORDER BY work_order_id LIMIT lim)
  SELECT COALESCE((SELECT jsonb_agg(public.work_order_list_row(s.work_order_id, s.slots) ORDER BY s.work_order_id) FROM shown s), '[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page) > lim THEN (SELECT work_order_id FROM shown ORDER BY work_order_id DESC LIMIT 1) END,
    (SELECT count(*) FROM visible),
    ARRAY(SELECT DISTINCT unnest(x.slots) FROM visible x)
    INTO rows_out, next_after, total, all_slots;
  IF NOT vehicle_open AND total = 0 THEN RAISE EXCEPTION 'Vehicle unavailable'; END IF;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer(public.job_reader_context(all_slots), all_slots,
      public.viewer_identity_bridge(uid), false) || jsonb_build_object('money_visible_basis', 'per row'),
    'as_of', statement_timestamp(), 'vehicle_id', v.id,
    'vehicle_label', jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
      'text', NULLIF(concat_ws(' ', v.year, v.make, v.model, v.trim), '')),
    'rows', rows_out, 'next_after', next_after,
    'coverage', jsonb_build_object('returned', jsonb_array_length(rows_out), 'total_for_vehicle', total,
      'population', CASE WHEN vehicle_open THEN 'every work order on this vehicle'
        ELSE 'work orders on this private vehicle where the viewer holds a slot' END,
      'state_basis', 'presence of existing owner records and clocks; not verified truth'));
END $$;

CREATE OR REPLACE FUNCTION public.my_signature_queue()
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
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false),
    'as_of', statement_timestamp(), 'items', items,
    'coverage', jsonb_build_object('returned', jsonb_array_length(items), 'total', total, 'limit', 250,
      'kinds', jsonb_build_array('work_session'),
      'kinds_not_yet_available', jsonb_build_array('terms', 'offer', 'completion_attestation', 'co_sign_request'),
      'population', 'own unconfirmed work sessions with capture span on own resolved vehicles'));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['job_reader_is_party(text[])','work_order_row_slots(uuid,boolean,uuid[],uuid,uuid,uuid,uuid)',
      'work_order_viewer_slots(uuid,uuid,uuid)','work_order_vehicle_open(uuid)','platform_person_label(uuid)',
      'platform_organization_label(uuid)','platform_actor_label(uuid)','work_order_open_header(uuid,boolean)',
      'work_order_job_path_for_viewer(jsonb,boolean)','work_order_list_row(uuid,text[])','job_reader_viewer(text,text[],jsonb,boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['work_order_job_path_read(uuid)','work_order_resources_read(uuid)','vehicle_work_orders_read(uuid,uuid,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated', f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.work_order_job_path_read(uuid) IS 'Open (anon and authenticated) job path for one work order with vehicle_label, display_title and request_source_label; accounting (party payments) shown to parties only; viewer block and viewer.actions. Private-vehicle work orders only to slot holders.';
COMMENT ON FUNCTION public.work_order_resources_read(uuid) IS 'Open resource graph for one work order; people by public handle or unnamed party, organizations by name, actors without legal names; raw user ids and free-text excerpts to parties only.';
COMMENT ON FUNCTION public.vehicle_work_orders_read(uuid, uuid, integer) IS 'Open list of work orders on one vehicle (rows as my_work_orders; slots only the viewer''s own). Private vehicles: only rows where the viewer holds a slot.';
NOTIFY pgrst, 'reload schema';
COMMIT;
