-- Facility reader and the facility confirmation queue.
--
--   facility_read(p_organization_id): open (anon and authenticated) for a public organization, or for its active owners
--     and members. Declared assets by kind (declare_facility_asset: label, capacity, declared_at, evidence count) with an
--     availability calendar for the next 60 days: busy windows only (confirmed reservations: from, until, slot). Parties
--     (organization owners/members, or the requester of that reservation) also see the reservation and work order ids;
--     nobody else sees job details. Licenses: type, active/verified flags, expiry and a computed state; never the number
--     or document. Members by public handle or unnamed party, weighted by relation (owner 2, member 1). Photo-inferred
--     equipment is counted as not declared and never listed as an asset.
--   my_signature_queue gains kind facility_reservation_to_confirm (requested reservations of organizations the viewer
--     owns or is a member of; exact confirm args): three anchored insertions in signature_queue_extend.
-- Contract: supabase/sql/test_facility_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.facility_read(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  org public.organizations%ROWTYPE;
  role text := public.organization_facility_role(viewer, p_organization_id);
  horizon timestamptz := statement_timestamp() + interval '60 days';
  assets jsonb;
  licenses jsonb;
  members jsonb;
  n_private integer;
BEGIN
  SELECT * INTO org FROM public.organizations WHERE id = p_organization_id;
  IF org.id IS NULL OR (org.is_public IS NOT TRUE AND role IS NULL) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', k.asset_kind, 'capacity_total', k.cap, 'assets', k.items) ORDER BY k.asset_kind), '[]'::jsonb)
  INTO assets FROM (
    SELECT e.asset_kind, sum(e.capacity) AS cap, jsonb_agg(jsonb_build_object('asset_id', e.id, 'label', e.name, 'capacity', e.capacity,
        'declared_at', s.observed_at, 'evidence_count', COALESCE(jsonb_array_length(e.evidence), 0), 'basis', 'member_declaration',
        'busy', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', lower(oc.occupied), 'until', upper(oc.occupied), 'slot', oc.slot)
              || CASE WHEN role IS NOT NULL OR r.requested_by_user_id = viewer
                THEN jsonb_build_object('reservation_id', r.id, 'work_order_id', r.work_order_id) ELSE '{}'::jsonb END
            ORDER BY lower(oc.occupied), oc.slot), '[]'::jsonb)
          FROM public.facility_asset_occupancy oc JOIN public.facility_reservations r ON r.id = oc.reservation_id
          WHERE oc.asset_id = e.id AND oc.released_at IS NULL AND upper(oc.occupied) > statement_timestamp() AND lower(oc.occupied) < horizon))
        ORDER BY e.name, e.id) AS items
    FROM public.equipment e LEFT JOIN public.vehicle_observations s ON s.id = e.declaration_observation_id
    WHERE e.shop_id = org.id AND e.source = 'member_declaration' AND e.status = 'in_service'
    GROUP BY e.asset_kind) k;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('license_type', l.license_type, 'issuing_authority', l.issuing_authority,
      'expiration_date', l.expiration_date, 'is_active', l.is_active, 'verified', COALESCE(l.verified, false),
      'state', CASE WHEN l.expiration_date IS NOT NULL AND l.expiration_date < current_date THEN 'expired'
        WHEN l.is_active IS FALSE THEN 'inactive' WHEN l.expiration_date IS NULL THEN 'active_expiry_unknown' ELSE 'active' END)
    ORDER BY l.license_type, l.expiration_date), '[]'::jsonb)
  INTO licenses FROM public.shop_licenses l WHERE l.shop_id = org.id;
  WITH rel AS (
    SELECT bo.owner_id AS user_id, 'owner' AS relation, 2 AS weight FROM public.business_ownership bo WHERE bo.business_id = org.id AND bo.status = 'active'
    UNION ALL SELECT oc.user_id, 'member', 1 FROM public.organization_contributors oc WHERE oc.organization_id = org.id AND oc.status = 'active'
  ), best AS (SELECT DISTINCT ON (user_id) user_id, relation, weight FROM rel ORDER BY user_id, weight DESC),
  labeled AS (SELECT b.*, public.platform_person_label(b.user_id) AS label FROM best b)
  SELECT COALESCE(jsonb_agg(l.label || jsonb_build_object('relation', l.relation, 'weight', l.weight)
      ORDER BY l.weight DESC, l.label->>'handle' NULLS LAST) FILTER (WHERE l.label ? 'handle'), '[]'::jsonb),
    count(*) FILTER (WHERE NOT l.label ? 'handle')
  INTO members, n_private FROM labeled l;
  RETURN jsonb_build_object('organization', public.platform_organization_label(org.id) || jsonb_build_object('organization_id', org.id),
    'as_of', statement_timestamp(), 'assets_by_kind', assets, 'licenses', licenses,
    'members', members, 'members_unnamed', n_private,
    'calendar', jsonb_build_object('from', statement_timestamp(), 'until', horizon, 'basis', 'confirmed reservations only; busy windows, no job details for non-parties'),
    'coverage', jsonb_build_object('declared_assets', (SELECT count(*) FROM public.equipment e WHERE e.shop_id = org.id AND e.source = 'member_declaration' AND e.status = 'in_service'),
      'photo_inferred_not_declared', (SELECT count(*) FROM public.equipment e WHERE e.shop_id = org.id AND e.source IS DISTINCT FROM 'member_declaration'),
      'licenses', jsonb_array_length(licenses), 'license_fields', 'type, authority, flags and expiry only; numbers and documents never returned'),
    'viewer', jsonb_build_object('role', role, 'party', role IS NOT NULL, 'decided_from', 'auth.uid()',
      'actions', CASE WHEN role IS NOT NULL THEN jsonb_build_array(jsonb_build_object('action', 'declare_facility_asset', 'rpc', 'declare_facility_asset',
        'args', jsonb_build_object('p_organization_id', org.id))) ELSE '[]'::jsonb END),
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.facility_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.facility_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.facility_read(uuid) IS 'Open reader of a public organization''s facility: declared assets by kind with capacity and a 60-day busy calendar (job details only to parties), licenses (type, flags, expiry; never numbers or documents), members by handle weighted by relation. Read-only.';

CREATE FUNCTION public.signature_queue_facility_items(p_uid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.window_from, x.id), '[]'::jsonb) FROM (
    SELECT r.id, r.window_from,
      jsonb_build_object('kind', 'facility_reservation_to_confirm', 'ref_id', r.id, 'work_order_id', r.work_order_id,
        'display_title', public.work_order_open_header(r.work_order_id, true)->'display_title',
        'vehicle_label', public.work_order_open_header(r.work_order_id, true)->'vehicle_label',
        'clock', jsonb_build_object('requested_at', r.requested_at, 'from', r.window_from, 'until', r.window_until),
        'summary', jsonb_build_object('asset', jsonb_build_object('asset_id', e.id, 'kind', e.asset_kind, 'label', e.name, 'capacity', e.capacity),
          'organization', public.platform_organization_label(r.organization_id), 'requester_role', r.requester_role,
          'requested_by', public.platform_person_label(r.requested_by_user_id), 'terms', r.terms,
          'capacity_free', EXISTS (SELECT 1 FROM generate_series(1, e.capacity) sl WHERE NOT EXISTS (SELECT 1 FROM public.facility_asset_occupancy oc
            WHERE oc.asset_id = e.id AND oc.slot = sl AND oc.released_at IS NULL AND oc.occupied && tstzrange(r.window_from, r.window_until, '[)')))),
        'sign', jsonb_build_object('rpc', 'confirm_facility_reservation', 'args_hint', jsonb_build_object('p_reservation_id', r.id, 'p_hash', r.reservation_hash),
          'binds', CASE WHEN public.organization_facility_role(p_uid, r.organization_id) = 'organization_owner'
            THEN jsonb_build_array('one capacity slot of this asset for the window', 'your organization''s facility offer on the job''s facility requirement')
            ELSE jsonb_build_array('one capacity slot of this asset for the window') END,
          'does_not_bind', jsonb_build_array('payment', 'vehicle access', 'other windows'))) AS item
    FROM public.facility_reservations r JOIN public.equipment e ON e.id = r.asset_id
    WHERE public.organization_facility_role(p_uid, r.organization_id) IS NOT NULL AND public.facility_reservation_state(r.id) = 'requested'
    ORDER BY r.window_from, r.id LIMIT 100) x
$$;
REVOKE ALL ON FUNCTION public.signature_queue_facility_items(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.signature_queue_extend(uuid,jsonb)'::regprocedure);
  a1 constant text := $a$payments || inspections || contacts || ws) e);$a$;
  a2 constant text := $a$payments || inspections),$a$;
  a3 constant text := $a$'cosign_request', jsonb_build_object('returned', 0, 'available', false,$a$;
  a text;
BEGIN
  IF position('signature_queue_facility_items' IN def) > 0 THEN RAISE EXCEPTION 'signature queue already carries facility items'; END IF;
  FOREACH a IN ARRAY ARRAY[a1, a2, a3] LOOP
    IF (length(def) - length(replace(def, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'signature_queue_extend anchor not found once: %', a; END IF;
  END LOOP;
  def := replace(def, a1, $r$payments || inspections || public.signature_queue_facility_items(p_uid) || contacts || ws) e);$r$);
  def := replace(def, a2, $r$payments || inspections) + jsonb_array_length(public.signature_queue_facility_items(p_uid)),$r$);
  def := replace(def, a3, $r$'facility_reservation_to_confirm', jsonb_build_object('returned', jsonb_array_length(public.signature_queue_facility_items(p_uid)), 'available', true),
    $r$ || a3);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
