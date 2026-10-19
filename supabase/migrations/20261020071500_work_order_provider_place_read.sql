-- Open reader of who is doing a job and where, with a delivery-style progress tracker, for the job screen's provider card.
--   work_order_provider_place_read(p_work_order_id): same gate as work_order_job_path_read (parties, or a public vehicle),
--     plus a current accepted provider, as work_order_operations_read admits one. Money (the Paid step) follows the job path.
--     shop: the organization the work order is filed under (work_orders.organization_id; not a claim that it performs the work):
--       name, logo, kind as recorded, rating ('not_rated' unless reviews are recorded; the stored average is a column default
--       when total_reviews is 0), hours as written on the record (not a live open/closed state), public place, public phone.
--       A private organization shows nothing to non-parties and only its name to parties.
--     organization_public_place(org): city and state of a public organization; street address, zip, coordinates and phone
--       only when its entity_type is a storefront business type. Every other type (a personal collection, a builder, an
--       untyped or 'other' record, the platform itself) gets city and state only: never a street address or a pin for what
--       may be a person. The clock is organizations.updated_at (record changed), not when the place was observed.
--     people: accepted providers (work_order_accepted_providers: the customer's accept_offer Sign) by public handle or
--       unnamed party, with their role on the job, and their service-area band and availability summary
--       (provider_service_area_band / provider_availability_summary, self-claims, city-level, never coordinates) only when
--       the profile is public or the viewer is that person, as provider_profile_read would show them. Recorded assignment
--       rows (legacy technician rows, not Signs) are listed apart, by the technician account's handle or unnamed party
--       (never technicians.name), with their recorded roles and statuses.
--     work_site: where the work happens when a confirmed facility reservation states it; otherwise not recorded
--       (work_orders has no location; organizations.offers_mobile_service is a default, so shop vs mobile is not established).
--     vehicle_place: the vehicle's city and state from its record, for parties or a public vehicle.
--     tracker: work_order_progress_tracker(stages) over the viewer's job path (read_work_order_job_path through
--       work_order_job_path_for_viewer): Requested (intake), Quoted and Accepted (terms), In progress (execution), Done
--       (completion), Paid (accounting). Each step carries its evidence (sign | record | status), clock and basis; retained
--       testimony is counted beside a step as reports and never moves it. Paid is withheld from non-parties. No ETAs.
-- Contract: supabase/sql/test_work_order_provider_place_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.organization_public_place(p_org_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  o public.organizations%ROWTYPE;
  storefront boolean;
  street text;
  has_coords boolean;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = p_org_id;
  IF o.id IS NULL OR o.is_public IS NOT TRUE THEN
    RETURN jsonb_build_object('precision', 'none', 'basis', 'the organization record is not public');
  END IF;
  storefront := o.entity_type = ANY (ARRAY['garage','restoration_shop','performance_shop','detailing','dealer','franchise_dealer',
    'dealer_group','consignment_dealer','auction_house','importer_distributor','museum','hotel','restaurant']);
  street := CASE WHEN storefront THEN NULLIF(btrim(o.address), '') END;
  has_coords := storefront AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
    AND o.latitude BETWEEN -90 AND 90 AND o.longitude BETWEEN -180 AND 180 AND NOT (o.latitude = 0 AND o.longitude = 0);
  RETURN jsonb_build_object(
    'city', NULLIF(btrim(o.city), ''), 'state', NULLIF(btrim(o.state), ''),
    'zip_code', CASE WHEN storefront THEN NULLIF(btrim(o.zip_code), '') END,
    'street_address', street,
    'coordinates', CASE WHEN has_coords THEN jsonb_build_object('latitude', o.latitude, 'longitude', o.longitude) END,
    'precision', CASE WHEN has_coords THEN 'coordinates' WHEN street IS NOT NULL THEN 'street'
      WHEN NULLIF(btrim(o.city), '') IS NOT NULL THEN 'city' WHEN NULLIF(btrim(o.state), '') IS NOT NULL THEN 'state' ELSE 'none' END,
    'storefront', storefront,
    'directions', has_coords OR street IS NOT NULL,
    'phone', CASE WHEN storefront THEN NULLIF(btrim(o.phone), '') END,
    'basis', CASE WHEN storefront THEN 'public business record (organization is public; entity type ' || o.entity_type || ' is a storefront business)'
      ELSE 'city and state from the public organization record; street address, coordinates and phone are withheld because its entity type ('
        || COALESCE(NULLIF(o.entity_type, ''), 'not recorded') || ') is not established as a storefront business' END,
    'record_updated_at', o.updated_at,
    'clock_basis', 'organizations.updated_at: when the record last changed, not when the place was observed');
END $$;

CREATE FUNCTION public.work_order_progress_tracker(p_stages jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  i jsonb := COALESCE(p_stages->'intake', '{}'::jsonb);
  t jsonb := COALESCE(p_stages->'terms', '{}'::jsonb);
  e jsonb := COALESCE(p_stages->'execution', '{}'::jsonb);
  c jsonb := COALESCE(p_stages->'completion', '{}'::jsonb);
  a jsonb := COALESCE(p_stages->'accounting', '{}'::jsonb);
  steps jsonb;
  cur text;
BEGIN
  steps := jsonb_build_array(
    CASE WHEN i->>'state' IN ('recorded', 'partial') THEN jsonb_build_object('state', 'reached', 'evidence', 'record',
        'clock', i->'created_at', 'clock_basis', 'work order created', 'basis', 'work order record')
      ELSE jsonb_build_object('state', 'not_yet', 'basis', 'no work order intake recorded') END
      || jsonb_build_object('key', 'requested', 'label', 'Requested', 'job_path_stage', 'intake'),
    CASE WHEN jsonb_typeof(t->'current_quote') = 'object' THEN jsonb_build_object('state', 'reached', 'evidence', 'sign',
        'clock', t->'quote_clock', 'clock_basis', 'current quote', 'basis', 'quote issued through Nuke (issue_work_order_quote)')
      WHEN t->>'quote_clock' IS NOT NULL THEN jsonb_build_object('state', 'reached', 'evidence', 'record',
        'clock', t->'quote_clock', 'clock_basis', t->>'quote_clock_basis', 'basis', 'quote clock on the work order record')
      WHEN (t->>'estimate_recorded')::boolean IS TRUE THEN jsonb_build_object('state', 'partial', 'evidence', 'record',
        'basis', 'an estimate is recorded without a quote clock')
      ELSE jsonb_build_object('state', 'not_yet', 'basis', 'no quote or estimate recorded') END
      || jsonb_build_object('key', 'quoted', 'label', 'Quoted', 'job_path_stage', 'terms'),
    CASE WHEN t->>'customer_acceptance' = 'signed' THEN jsonb_build_object('state', 'reached', 'evidence', 'sign',
        'clock', t->'approval_clock', 'clock_basis', 'quote acceptance', 'basis', 'the customer accepted the quote through Nuke')
      WHEN COALESCE((t->>'accepted_providers')::int, 0) > 0 THEN jsonb_build_object('state', 'reached', 'evidence', 'sign',
        'clock', t->'provider_acceptance_clock', 'clock_basis', 'offer acceptance', 'basis', 'the customer accepted a provider''s offer through Nuke')
      WHEN t->>'approval_clock' IS NOT NULL THEN jsonb_build_object('state', 'reached', 'evidence', 'record',
        'clock', t->'approval_clock', 'clock_basis', t->>'approval_clock_basis', 'basis', 'approval clock on the work order record')
      WHEN COALESCE((t->>'assignments_with_accept_clock')::int, 0) > 0 THEN jsonb_build_object('state', 'reached', 'evidence', 'record',
        'basis', 'an assignment records an accepted clock')
      WHEN t->>'customer_acceptance' = 'withheld' THEN jsonb_build_object('state', 'partial', 'evidence', 'sign',
        'basis', 'an acceptance is withheld: the work changed since the accepted quote')
      WHEN COALESCE(t->'inconsistencies', '[]'::jsonb) ? 'assignment_accepted_status_without_clock' THEN jsonb_build_object('state', 'status_only',
        'evidence', 'status', 'basis', 'an assignment status says accepted, with no clock behind it')
      ELSE jsonb_build_object('state', 'not_yet', 'basis', 'no acceptance recorded') END
      || jsonb_build_object('key', 'accepted', 'label', 'Accepted', 'job_path_stage', 'terms', 'reports', t->'retained_testimony'),
    CASE WHEN jsonb_typeof(e->'start_sign') = 'object' THEN jsonb_build_object('state', 'reached', 'evidence', 'sign',
        'clock', e#>'{start_sign,started_at}', 'clock_basis', 'start_work Sign', 'basis', 'an accepted provider signed the start of work')
      WHEN e->>'state' = 'recorded' THEN jsonb_build_object('state', 'reached', 'evidence', 'record',
        'clock', e->'start_clock', 'clock_basis', CASE WHEN e->>'start_clock' IS NOT NULL THEN 'start clock on the work order record' END,
        'basis', COALESCE(e->>'state_basis', 'start clock or operation records'))
      WHEN e->>'state' = 'partial' THEN jsonb_build_object('state', 'partial', 'evidence', 'record',
        'basis', COALESCE(e->>'state_basis', 'operations marked complete or assignments started, without a start clock'))
      ELSE jsonb_build_object('state', 'not_yet', 'basis', 'no start recorded') END
      || jsonb_build_object('key', 'in_progress', 'label', 'In progress', 'job_path_stage', 'execution', 'reports', e->'retained_testimony'),
    CASE WHEN jsonb_typeof(c->'provider_attestation') = 'object' THEN jsonb_build_object('state', 'reached', 'evidence', 'sign',
        'clock', c#>'{provider_attestation,signed_at}', 'clock_basis', 'provider completion Sign',
        'basis', 'the provider signed completion', 'customer_accepted', jsonb_typeof(c->'customer_acceptance_sign') = 'object',
        'customer_accepted_at', c#>'{customer_acceptance_sign,signed_at}')
      WHEN c->>'state_basis' = 'completion_clock_without_attestation' THEN jsonb_build_object('state', 'reached', 'evidence', 'record',
        'clock', c->'completion_clock', 'clock_basis', 'completion clock on the work order record', 'basis', 'completion clock without a completion Sign')
      WHEN c->>'state' = 'status_only' THEN jsonb_build_object('state', 'status_only', 'evidence', 'status',
        'basis', 'the work order status says done, with no completion clock behind it')
      ELSE jsonb_build_object('state', 'not_yet', 'basis', 'no completion recorded') END
      || jsonb_build_object('key', 'done', 'label', 'Done', 'job_path_stage', 'completion', 'reports', c->'retained_testimony'),
    CASE WHEN a->>'state' = 'withheld' THEN jsonb_build_object('state', 'withheld',
        'basis', COALESCE(a->>'basis', 'payments are shown only to the parties'))
      WHEN a->>'state' = 'recorded' AND a->>'state_basis' = 'current_invoice_settled_by_payee_witness' THEN jsonb_build_object('state', 'reached',
        'evidence', 'sign', 'basis', 'the current invoice is settled by the payee''s payment witness')
      WHEN a->>'state' = 'partial' AND jsonb_typeof(a->'invoice') = 'object' THEN jsonb_build_object('state', 'partial', 'evidence', 'sign',
        'clock', a#>'{invoice,issued_at}', 'clock_basis', 'invoice issued', 'basis', 'an invoice is issued; its balance is open')
      WHEN a->>'state' IN ('recorded', 'partial') THEN jsonb_build_object('state', 'partial', 'evidence', 'record',
        'basis', COALESCE(a->>'state_basis', 'payment records without an invoice'))
      ELSE jsonb_build_object('state', 'not_yet', 'basis', 'no invoice or payment recorded') END
      || jsonb_build_object('key', 'paid', 'label', 'Paid', 'job_path_stage', 'accounting',
        'reports', CASE WHEN a->>'state' = 'withheld' THEN NULL ELSE a->'retained_testimony' END));
  SELECT jsonb_agg(s || jsonb_build_object('conflicting', s->>'key' <> 'quoted'
        AND jsonb_array_length(COALESCE(p_stages->(s->>'job_path_stage')->'inconsistencies', '[]'::jsonb)) > 0,
      'reports', CASE WHEN COALESCE((s#>>'{reports,claims}')::int, 0) > 0 THEN jsonb_build_object('claims', (s#>>'{reports,claims}')::int,
        'by_side', s#>'{reports,by_side}', 'latest_message_at', s#>'{reports,latest_message_at}',
        'basis', 'attributed retained messages; not Signs, not verified; they never move a step') END) ORDER BY n)
    INTO steps FROM jsonb_array_elements(steps) WITH ORDINALITY x(s, n);
  SELECT s->>'key' INTO cur FROM jsonb_array_elements(steps) WITH ORDINALITY x(s, n)
    WHERE s->>'state' IN ('reached', 'partial', 'status_only') ORDER BY n DESC LIMIT 1;
  RETURN jsonb_build_object('steps', steps, 'current_step', cur,
    'evidence_kinds', jsonb_build_object('sign', 'authenticated Sign through Nuke', 'record', 'owner record or clock; not verified',
      'status', 'a status field with no record or clock behind it'),
    'basis', 'derived from the job path stages for this viewer (read_work_order_job_path); no estimated times');
END $$;

CREATE FUNCTION public.work_order_provider_place_read(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  money boolean;
  ctx text;
  vopen boolean;
  o public.organizations%ROWTYPE;
  shop jsonb;
  accepted jsonb;
  recorded jsonb;
  site jsonb;
  vplace jsonb;
  tracker jsonb;
  n_mobile integer;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(uid, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  money := public.job_reader_is_party(my_slots);
  IF uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id = uid) THEN
    my_slots := array_append(my_slots, 'accepted_provider');
  END IF;
  vopen := public.work_order_vehicle_open(w.vehicle_id);
  IF cardinality(my_slots) = 0 AND NOT vopen THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := money OR 'accepted_provider' = ANY (my_slots);
  ctx := public.job_reader_context(my_slots);
  IF ctx = 'visitor' AND 'accepted_provider' = ANY (my_slots) THEN ctx := 'provider'; END IF;

  IF w.organization_id IS NOT NULL THEN SELECT * INTO o FROM public.organizations WHERE id = w.organization_id; END IF;
  shop := CASE WHEN o.id IS NULL THEN jsonb_build_object('state', 'none', 'basis', 'the work order is not filed under an organization')
    WHEN o.is_public IS NOT TRUE AND NOT party THEN jsonb_build_object('state', 'not_public', 'basis', 'the organization record is not public')
    WHEN o.is_public IS NOT TRUE THEN jsonb_build_object('state', 'private', 'name', COALESCE(NULLIF(btrim(o.business_name), ''), NULLIF(btrim(o.name), '')),
      'place', public.organization_public_place(o.id), 'basis', 'the organization record is not public; its name is shown to the parties only')
    ELSE jsonb_build_object('state', 'public', 'organization_id', o.id,
      'name', COALESCE(NULLIF(btrim(o.business_name), ''), NULLIF(btrim(o.name), '')),
      'logo_url', NULLIF(btrim(o.logo_url), ''),
      'entity_type', NULLIF(o.entity_type, ''), 'business_type', NULLIF(o.business_type, ''),
      'rating', CASE WHEN COALESCE(o.total_reviews, 0) = 0 OR o.average_project_rating IS NULL OR o.average_project_rating <= 0
          THEN jsonb_build_object('state', 'not_rated', 'basis', 'no reviews are recorded for this organization')
        ELSE jsonb_build_object('state', 'stored', 'value', o.average_project_rating, 'reviews', o.total_reviews,
          'basis', 'organizations.average_project_rating as stored; how it was computed is not established') END,
      'hours', CASE WHEN jsonb_typeof(o.hours_of_operation) = 'object' AND o.hours_of_operation <> '{}'::jsonb
          THEN jsonb_build_object('state', 'recorded', 'as_recorded', o.hours_of_operation,
            'basis', 'hours as written on the organization record; not verified and not a live open or closed state')
        ELSE jsonb_build_object('state', 'not_recorded', 'basis', 'no hours on the organization record') END,
      'place', public.organization_public_place(o.id)) END
    || CASE WHEN o.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('role_on_job', 'work order organization',
      'role_basis', 'work_orders.organization_id: the organization the work order is filed under; not by itself a claim of who performs the work') END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('person', x.label, 'roles', x.roles, 'accepted_at', x.accepted_at, 'accepted_offers', x.n,
      'acceptance_basis', 'authenticated_sign: the customer accepted this provider''s offer (accept_offer)',
      'service_area', CASE WHEN x.visible THEN public.provider_service_area_band(x.account_id)
        ELSE jsonb_build_object('state', 'withheld', 'basis', 'the provider''s profile is not public') END,
      'availability', CASE WHEN x.visible THEN public.provider_availability_summary(x.account_id)
        ELSE jsonb_build_object('state', 'withheld', 'basis', 'the provider''s profile is not public') END)
    ORDER BY x.accepted_at, x.account_id), '[]'::jsonb)
  INTO accepted
  FROM (SELECT ap.account_id, public.platform_person_label(ap.account_id) AS label,
      (public.platform_person_label(ap.account_id) ? 'handle') OR ap.account_id = uid AS visible,
      jsonb_agg(DISTINCT ap.role) AS roles, min(ap.accepted_at) AS accepted_at, count(*) AS n
    FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id IS NOT NULL GROUP BY ap.account_id) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('person', COALESCE(public.platform_person_label(y.user_id),
        jsonb_build_object('kind', 'user', 'label', 'unnamed party')),
      'roles', y.roles, 'statuses', y.statuses, 'assignments', y.n,
      'basis', 'recorded assignment rows on the work order; not an accepted offer Sign',
      'service_area', CASE WHEN y.user_id IS NOT NULL AND ((public.platform_person_label(y.user_id) ? 'handle') OR y.user_id = uid)
        THEN public.provider_service_area_band(y.user_id) ELSE jsonb_build_object('state', 'not_assessed',
          'basis', CASE WHEN y.user_id IS NULL THEN 'the technician record names no account' ELSE 'the technician''s profile is not public' END) END)
    ORDER BY y.first_at, y.technician_id), '[]'::jsonb)
  INTO recorded
  FROM (SELECT a.technician_id, max(t.user_id::text)::uuid AS user_id, jsonb_agg(DISTINCT a.role) FILTER (WHERE a.role IS NOT NULL) AS roles,
      (SELECT jsonb_object_agg(k, v) FROM (SELECT COALESCE(a2.status, 'unstated') k, count(*) v FROM public.work_order_assignments a2
        WHERE a2.work_order_id = w.id AND a2.technician_id = a.technician_id AND a2.fulfillment_id IS NULL AND a2.cosign_observation_id IS NULL
        GROUP BY 1) st) AS statuses,
      count(*) AS n, min(a.created_at) AS first_at
    FROM public.work_order_assignments a LEFT JOIN public.technicians t ON t.id = a.technician_id
    WHERE a.work_order_id = w.id AND a.technician_id IS NOT NULL AND a.fulfillment_id IS NULL AND a.cosign_observation_id IS NULL
    GROUP BY a.technician_id) y;

  SELECT count(*) INTO n_mobile FROM jsonb_array_elements(accepted) p WHERE (p#>>'{service_area,mobile}')::boolean IS TRUE;
  SELECT jsonb_build_object('state', 'facility_reserved', 'window', jsonb_build_object('from', r.window_from, 'until', r.window_until),
      'organization', CASE WHEN ro.is_public IS TRUE OR party THEN COALESCE(NULLIF(btrim(ro.business_name), ''), NULLIF(btrim(ro.name), '')) END,
      'place', public.organization_public_place(r.organization_id),
      'basis', 'a confirmed facility reservation for this job (reserve_facility, confirmed by the facility)')
    INTO site
  FROM public.facility_reservations r LEFT JOIN public.organizations ro ON ro.id = r.organization_id
  WHERE r.work_order_id = w.id AND public.facility_reservation_state(r.id) IN ('confirmed', 'completed_window')
  ORDER BY r.window_from DESC, r.id LIMIT 1;
  site := COALESCE(site, jsonb_build_object('state', 'not_recorded',
    'basis', 'no work location is recorded for this job: work orders carry no location and no facility reservation is confirmed')) || jsonb_build_object(
    'mobile_service', jsonb_build_object('state', 'not_established',
      'basis', 'organizations.offers_mobile_service is a column default, not a statement of shop versus mobile work',
      'accepted_providers_declaring_mobile', n_mobile, 'declaration_basis', 'self-claimed service areas (set_provider_service_area)'));

  IF party OR vopen THEN
    SELECT CASE WHEN NULLIF(btrim(v.city), '') IS NOT NULL OR NULLIF(btrim(v.state), '') IS NOT NULL
        THEN jsonb_build_object('city', NULLIF(btrim(v.city), ''), 'state', NULLIF(btrim(v.state), ''), 'precision', 'city',
          'basis', 'city and state on the vehicle record; no street address or coordinates')
        ELSE jsonb_build_object('precision', 'none', 'basis', 'the vehicle record states no city or state') END
      INTO vplace FROM public.vehicles v WHERE v.id = w.vehicle_id;
  END IF;

  tracker := public.work_order_progress_tracker(public.work_order_job_path_for_viewer(public.read_work_order_job_path(w.id), money)->'stages');

  RETURN public.work_order_open_header(w.id, money) || jsonb_build_object(
    'work_order_id', w.id, 'as_of', statement_timestamp(), 'work_order_status', w.status,
    'shop', shop,
    'people', jsonb_build_object('accepted_providers', accepted, 'recorded_assignments', recorded,
      'basis', 'people by public handle or unnamed party; no contact fields; areas are self-claimed city-level bands'),
    'work_site', site,
    'vehicle_place', COALESCE(vplace, jsonb_build_object('precision', 'none', 'basis', 'no vehicle on this work order')),
    'tracker', tracker,
    'coverage', jsonb_build_object('shop', shop->>'state', 'shop_place_precision', COALESCE(shop#>>'{place,precision}', 'none'),
      'accepted_providers', jsonb_array_length(accepted), 'recorded_assignment_people', jsonb_array_length(recorded),
      'providers_with_service_area', (SELECT count(*) FROM jsonb_array_elements(accepted || recorded) p WHERE p#>>'{service_area,state}' = 'declared'),
      'work_site', site->>'state', 'tracker_steps', jsonb_array_length(tracker->'steps'),
      'not_assessed', jsonb_build_array('estimated arrival or completion times', 'live location', 'review text'),
      'customer_contact', 'never_returned'),
    'viewer', public.job_reader_viewer(ctx, my_slots, public.viewer_identity_bridge(uid), money) || jsonb_build_object('party', party),
    'payment_authorized', false);
END $$;

REVOKE ALL ON FUNCTION public.organization_public_place(uuid), public.work_order_progress_tracker(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_public_place(uuid), public.work_order_progress_tracker(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.work_order_provider_place_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_order_provider_place_read(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.organization_public_place(uuid) IS 'A public organization''s place: city and state; street address, zip, coordinates and phone only for storefront business entity types. Nothing for a private organization.';
COMMENT ON FUNCTION public.work_order_progress_tracker(jsonb) IS 'Delivery-style steps (requested, quoted, accepted, in progress, done, paid) derived from job path stages, each with its evidence kind (sign, record, status), clock and basis; retained testimony counted beside a step, never moving it.';
COMMENT ON FUNCTION public.work_order_provider_place_read(uuid) IS 'Open reader of who is doing a job and where: the work order''s organization card (rating or not rated, hours as recorded, public business place), accepted providers and recorded assignment people by handle with city-level service bands, the work site when recorded, and a progress tracker over the job path. No contact beyond a storefront''s public phone; no payments.';
NOTIFY pgrst, 'reload schema';
COMMIT;
