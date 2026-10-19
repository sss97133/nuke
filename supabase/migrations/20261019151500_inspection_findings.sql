-- Inspection findings (QUOTE lane RSI pass 4). The inspector records what was examined on an inspection work order
-- (request_inspection, 20261019150000); the findings become basis evidence for the parent plan.
--
--   * inspection_findings_role(p_user, p_work_order_id): who may record findings, the issue_work_order_quote rule.
--     'organization_owner' for an active business_ownership owner of the inspection's organization, 'inspector' for
--     an evidenced identity bridge (viewer_identity_bridge) to its lead actor or an operation actor (the client
--     assigns the inspector actor on the inspect operation). Never the customer.
--   * record_inspection_findings(p_inspection_work_order_id, p_findings): the inspector's Sign. p_findings is the
--     inspection.json event shape (docs/library/reference/dictionary/inspection.md: summary, findings[] system /
--     finding / severity / evidence_photo_ref, inspection_type, inspector_role, zones_inspected, overall_condition,
--     deferred_maintenance_minutes, photos_referenced) plus, per finding, item_id and verdict
--     (supports / contradicts / unknown) against that checklist item, and an optional inspected_at.
--     It writes one owner-input work_record signed by auth.uid(): content_text is the rendered findings (so parent
--     requirements and specifications can quote them as basis_observation_id + basis_excerpt), structured_data
--     carries the inspection. Each call is one report; reports are append-only. A verdict is the inspector's
--     testimony about one claim, not a price, an approval or seller permission.
--   * work_order_inspection_read(p_work_order_id): open reader (anon and authenticated) for an inspection job or
--     a parent job's inspections: checklist, reports and findings, recorder by public handle or unnamed party,
--     coverage, seller permission (not_established until an authenticated seller signs), quote state. Personal
--     free text is withheld from non-parties (work_order_text_is_personal); non-public vehicles only for slot holders.
-- Contract: supabase/sql/test_inspection_findings.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.inspection_findings_role(p_user uuid, p_work_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE w public.work_orders%ROWTYPE;
BEGIN
  IF p_user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id AND scope_category = 'inspection';
  IF NOT FOUND OR w.customer_id IS NOT DISTINCT FROM p_user THEN RETURN NULL; END IF;
  IF w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
      WHERE bo.business_id = w.organization_id AND bo.owner_id = p_user AND bo.status = 'active') THEN
    RETURN 'organization_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(public.viewer_identity_bridge(p_user)->'evidenced_actor_ids') a
      WHERE a::uuid = w.lead_actor_id OR EXISTS (SELECT 1 FROM public.work_order_line_items li
        WHERE li.work_order_id = w.id AND li.actor_id = a::uuid)) THEN
    RETURN 'inspector';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.inspection_findings_role(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.inspection_findings_role(uuid,uuid) IS 'Internal: organization_owner or inspector when an account may record findings on an inspection work order (issue_work_order_quote eligibility); null otherwise, always for the customer.';

CREATE FUNCTION public.record_inspection_findings(p_inspection_work_order_id uuid, p_findings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  req public.vehicle_observations%ROWTYPE;
  role text;
  checklist jsonb;
  f jsonb;
  fs jsonb := '[]'::jsonb;
  k text;
  n integer := 0;
  itype text;
  irole text;
  inspected timestamptz;
  body text;
  owner_source uuid;
  request_key text;
  obs_id uuid;
  existing uuid;
  covered integer;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_inspection_work_order_id AND scope_category = 'inspection';
  IF FOUND AND w.customer_id IS NOT DISTINCT FROM signer THEN
    RAISE EXCEPTION 'The client cannot record findings on their own inspection' USING ERRCODE = '42501';
  END IF;
  role := public.inspection_findings_role(signer, p_inspection_work_order_id);
  IF role IS NULL THEN RAISE EXCEPTION 'Inspection unavailable for findings' USING ERRCODE = '42501'; END IF;
  SELECT * INTO req FROM public.vehicle_observations WHERE id = w.request_observation_id;
  checklist := COALESCE(req.structured_data#>'{inspection_request,checklist}', '[]'::jsonb);

  IF jsonb_typeof(p_findings) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_findings) x WHERE x NOT IN ('summary','narrative','inspection_type','inspector_role',
      'zones_inspected','findings','overall_condition','deferred_maintenance_minutes','photos_referenced','inspected_at'))
    OR jsonb_typeof(p_findings->'summary') IS DISTINCT FROM 'string' OR length(btrim(p_findings->>'summary')) NOT BETWEEN 1 AND 500
    OR (p_findings ? 'narrative' AND (jsonb_typeof(p_findings->'narrative') <> 'string' OR length(p_findings->>'narrative') > 32768))
    OR jsonb_typeof(p_findings->'findings') IS DISTINCT FROM 'array' OR jsonb_array_length(p_findings->'findings') NOT BETWEEN 1 AND 100
    OR (p_findings ? 'overall_condition' AND COALESCE(p_findings->>'overall_condition','') NOT IN ('excellent','good','fair','rough','project','parts_only'))
    OR (p_findings ? 'deferred_maintenance_minutes' AND (jsonb_typeof(p_findings->'deferred_maintenance_minutes') <> 'number'
      OR (p_findings->>'deferred_maintenance_minutes')::numeric NOT BETWEEN 0 AND 100000))
    OR (p_findings ? 'zones_inspected' AND (jsonb_typeof(p_findings->'zones_inspected') <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_findings->'zones_inspected') z WHERE z #>> '{}' NOT IN ('engine_bay','undercarriage',
        'interior','wheels','drivetrain','cooling','electrical','fuel','ignition','suspension','brakes','body','other'))
      OR jsonb_array_length(p_findings->'zones_inspected') <> (SELECT count(DISTINCT z) FROM jsonb_array_elements(p_findings->'zones_inspected') z)))
    OR (p_findings ? 'photos_referenced' AND (jsonb_typeof(p_findings->'photos_referenced') <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_findings->'photos_referenced') z WHERE jsonb_typeof(z) <> 'string' OR length(z #>> '{}') > 1024))) THEN
    RAISE EXCEPTION 'Findings must follow the inspection event shape (summary, findings[])' USING ERRCODE = '23514';
  END IF;
  itype := COALESCE(p_findings->>'inspection_type', req.structured_data#>>'{inspection_request,inspection_type}', 'other');
  IF itype NOT IN ('pre_purchase','walk_around','photo_audit','post_work_qc','annual_check','incident_report','other') THEN
    RAISE EXCEPTION 'Unknown inspection_type' USING ERRCODE = '23514';
  END IF;
  irole := COALESCE(p_findings->>'inspector_role', CASE role WHEN 'organization_owner' THEN 'shop' ELSE 'third_party_expert' END);
  IF irole NOT IN ('agent_vision','owner_self','shop','third_party_expert') OR irole = 'owner_self' THEN
    RAISE EXCEPTION 'inspector_role must be agent_vision, shop or third_party_expert' USING ERRCODE = '23514';
  END IF;
  inspected := COALESCE((p_findings->>'inspected_at')::timestamptz, signed);
  IF inspected > signed OR inspected < req.observed_at THEN
    RAISE EXCEPTION 'inspected_at must fall between the request and now' USING ERRCODE = '23514';
  END IF;

  FOR f IN SELECT value FROM jsonb_array_elements(p_findings->'findings') LOOP
    n := n + 1;
    IF jsonb_typeof(f) IS DISTINCT FROM 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(f) x WHERE x NOT IN ('item_id','system','finding','severity','evidence_photo_ref','verdict'))
      OR jsonb_typeof(f->'finding') IS DISTINCT FROM 'string' OR length(btrim(f->>'finding')) NOT BETWEEN 1 AND 2000
      OR position(E'\n' IN f->>'finding') > 0
      OR COALESCE(f->>'severity','') NOT IN ('info','monitor','concern','critical')
      OR (f->>'system' IS NOT NULL AND f->>'system' NOT IN ('engine_bay','top_end','bottom_end','undercarriage','interior','wheels',
        'drivetrain','cooling','electrical','fuel','ignition','suspension','brakes','body','other'))
      OR (f->>'evidence_photo_ref' IS NOT NULL AND length(f->>'evidence_photo_ref') > 1024)
      OR (f->>'item_id' IS NOT NULL AND NOT checklist @> jsonb_build_array(jsonb_build_object('item_id', f->>'item_id')))
      OR (f->>'item_id' IS NULL) <> (f->>'verdict' IS NULL)
      OR (f->>'verdict' IS NOT NULL AND f->>'verdict' NOT IN ('supports','contradicts','unknown')) THEN
      RAISE EXCEPTION 'Invalid finding %: needs one-line finding text, severity, a known system, and a verdict exactly when it answers a checklist item', n
        USING ERRCODE = '23514';
    END IF;
    fs := fs || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('item_id', f->>'item_id', 'system', f->>'system',
      'finding', btrim(f->>'finding'), 'severity', f->>'severity', 'evidence_photo_ref', f->>'evidence_photo_ref', 'verdict', f->>'verdict')));
  END LOOP;
  SELECT count(*) INTO covered FROM jsonb_array_elements(checklist) i
    WHERE fs @> jsonb_build_array(jsonb_build_object('item_id', i->>'item_id'));
  body := btrim(p_findings->>'summary') || E'\n' || (SELECT string_agg('- ' || COALESCE('[' || (x->>'item_id') || '] ', '')
      || COALESCE((x->>'system') || ': ', '') || (x->>'finding') || ' (' || (x->>'severity')
      || COALESCE('; ' || (x->>'verdict'), '') || ')', E'\n' ORDER BY ord)
    FROM jsonb_array_elements(fs) WITH ORDINALITY t(x, ord));

  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('inspection-findings', signer, w.id, p_findings)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('inspection_findings:'||w.id::text, 0));
  SELECT o.id INTO existing FROM public.vehicle_observations o
    WHERE o.source_id = owner_source AND o.source_identifier = 'inspection_findings:'||w.id::text AND o.kind = 'work_record'
      AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('findings_observation_id', existing, 'inspection_work_order_id', w.id, 'duplicate', true,
      'seller_permission', 'not_established', 'payment_authorized', false);
  END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis,
    source_event_at, source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id,
    observer_raw, extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'inspection_findings:'||w.id::text, signed, 'event_time', inspected, 'exact', 'work_record',
    body, request_key,
    jsonb_build_object('inspection', jsonb_strip_nulls(jsonb_build_object('schema', 'inspection.v1', 'summary', btrim(p_findings->>'summary'),
        'narrative', p_findings->>'narrative', 'inspection_type', itype, 'inspector_role', irole,
        'zones_inspected', p_findings->'zones_inspected', 'findings', fs, 'overall_condition', p_findings->>'overall_condition',
        'deferred_maintenance_minutes', p_findings->'deferred_maintenance_minutes', 'photos_referenced', p_findings->'photos_referenced')),
      'inspection_work_order_id', w.id, 'parent_work_order_id', w.parent_work_order_id, 'request_observation_id', w.request_observation_id,
      'recorded_by_role', role, 'checklist_coverage', jsonb_build_object('items', jsonb_array_length(checklist), 'with_findings', covered),
      'seller_permission', 'not_established'),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'recorded_by_role', role),
    'inspection_findings_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  RETURN jsonb_build_object('findings_observation_id', obs_id, 'inspection_work_order_id', w.id,
    'parent_work_order_id', w.parent_work_order_id, 'findings', n, 'checklist_items', jsonb_array_length(checklist),
    'items_with_findings', covered,
    'verdicts', (SELECT jsonb_object_agg(v, c) FROM (SELECT x->>'verdict' v, count(*) c FROM jsonb_array_elements(fs) x
      WHERE x ? 'verdict' GROUP BY 1) y),
    'recorded_by_role', role, 'inspected_at', inspected, 'recorded_at', signed, 'duplicate', false,
    'seller_permission', 'not_established', 'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.record_inspection_findings(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_inspection_findings(uuid,jsonb) TO authenticated;
COMMENT ON FUNCTION public.record_inspection_findings(uuid,jsonb) IS 'Sign: the inspector (organization owner of the inspection job, or an evidenced bridge to its lead or operation actor; never the customer) records one findings report: inspection event shape plus item_id and verdict per checklist item. Writes an owner-input work_record usable as plan basis. No price, approval, seller permission or payment.';

-- One inspection job as the open reader shows it.
CREATE FUNCTION public.work_order_inspection_view(p_work_order_id uuid, p_party boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  req public.vehicle_observations%ROWTYPE;
  checklist jsonb;
  reports jsonb;
  qs jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  SELECT * INTO req FROM public.vehicle_observations WHERE id = w.request_observation_id;
  checklist := COALESCE(req.structured_data#>'{inspection_request,checklist}', '[]'::jsonb);
  IF NOT p_party THEN checklist := public.work_order_quote_redact(w.id, checklist, ARRAY['question']); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('observation_id', o.id, 'recorded_at', o.observed_at, 'inspected_at', o.source_event_at,
      'recorded_by', public.platform_person_label(o.submitted_by_user_id)
        || CASE WHEN p_party THEN jsonb_build_object('user_id', o.submitted_by_user_id) ELSE '{}'::jsonb END,
      'recorded_by_role', o.structured_data->'recorded_by_role', 'attribution', 'authenticated_sign',
      'inspection', (o.structured_data->'inspection') || jsonb_build_object(
        'summary', CASE WHEN p_party OR NOT public.work_order_text_is_personal(w.id, o.structured_data#>>'{inspection,summary}')
          THEN o.structured_data#>'{inspection,summary}' END,
        'narrative', CASE WHEN p_party THEN o.structured_data#>'{inspection,narrative}' END,
        'findings', CASE WHEN p_party THEN o.structured_data#>'{inspection,findings}'
          ELSE public.work_order_quote_redact(w.id, o.structured_data#>'{inspection,findings}', ARRAY['finding']) END),
      'checklist_coverage', o.structured_data->'checklist_coverage') ORDER BY o.observed_at DESC, o.id), '[]'::jsonb)
    INTO reports
    FROM public.vehicle_observations o
    WHERE o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'owner-input')
      AND o.source_identifier = 'inspection_findings:'||w.id::text AND o.kind = 'work_record' AND o.is_superseded IS FALSE
      AND o.vehicle_id IS NOT DISTINCT FROM w.vehicle_id AND o.extraction_method = 'inspection_findings_sign_v1';
  qs := public.work_order_quote_state(w.id);
  RETURN jsonb_build_object('work_order_id', w.id, 'parent_work_order_id', w.parent_work_order_id, 'status', w.status,
    'inspection_type', req.structured_data#>'{inspection_request,inspection_type}', 'requested_at', req.observed_at,
    'requested_by', CASE WHEN req.id IS NOT NULL THEN public.platform_person_label(req.submitted_by_user_id)
      || CASE WHEN p_party THEN jsonb_build_object('user_id', req.submitted_by_user_id) ELSE '{}'::jsonb END END,
    'listing_url', req.structured_data#>'{inspection_request,listing_url}',
    'checklist', checklist, 'reports', reports, 'current_report', reports->0,
    'state', CASE WHEN jsonb_array_length(reports) > 0 THEN 'findings_recorded' ELSE 'requested' END,
    'seller_permission', jsonb_build_object('state', 'not_established',
      'basis', 'no authenticated seller permission attestation; ordering an inspection grants no vehicle access'),
    'quote', jsonb_build_object('current_version', qs#>'{current_quote,version}', 'acceptance_state', qs#>'{acceptance,state}'),
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.work_order_inspection_view(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.work_order_inspection_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  role text;
  inspections jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots);
  role := CASE WHEN w.scope_category = 'inspection' THEN public.inspection_findings_role(viewer, w.id) END;
  IF role IS NOT NULL THEN party := true; my_slots := array_append(my_slots, 'inspector'); END IF;
  SELECT COALESCE(jsonb_agg(public.work_order_inspection_view(x.id, party) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO inspections
    FROM public.work_orders x
    WHERE (w.scope_category = 'inspection' AND x.id = w.id) OR (w.scope_category IS DISTINCT FROM 'inspection' AND x.parent_work_order_id = w.id
      AND x.scope_category = 'inspection');
  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object('work_order_id', w.id,
    'role', CASE WHEN w.scope_category = 'inspection' THEN 'inspection' ELSE 'parent' END,
    'as_of', statement_timestamp(), 'inspections', inspections,
    'viewer', public.job_reader_viewer(CASE WHEN role IS NOT NULL THEN 'provider' ELSE public.job_reader_context(my_slots) END,
        my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'actions', CASE WHEN role IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
        'action', 'record_findings', 'rpc', 'record_inspection_findings', 'args', jsonb_build_object('p_inspection_work_order_id', w.id)))
        ELSE '[]'::jsonb END),
    'coverage', jsonb_build_object('inspections', jsonb_array_length(inspections),
      'with_findings', (SELECT count(*) FROM jsonb_array_elements(inspections) i WHERE i->>'state' = 'findings_recorded'),
      'source_scope', 'inspection_request and inspection_findings Sign records', 'customer_contact', 'never_returned'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; raw ids to parties only');
END $$;
REVOKE ALL ON FUNCTION public.work_order_inspection_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_inspection_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.work_order_inspection_read(uuid) IS 'Open (anon and authenticated) reader of an inspection job, or of a parent job''s linked inspections: checklist, findings reports with verdicts, recorder by handle or unnamed party, coverage, seller permission (not_established), quote state. Personal text and raw ids only for parties; non-public vehicles only for slot holders. Read-only.';

NOTIFY pgrst, 'reload schema';
COMMIT;
