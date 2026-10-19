-- Seller permission for an inspection (QUOTE lane RSI pass 5). A pre-purchase inspection runs on a vehicle the client does
-- not own; the seller's permission to inspect is its own Sign, never implied by ordering or accepting.
--
--   * vehicle_verified_owner(p_user, p_vehicle): an approved, unexpired ownership_verifications row (the existing owner
--     verification owner). A vehicles.owner_id claim alone is not verification.
--   * grant_inspection_access(p_inspection_work_order_id, p_scope, p_window): the verified owner's Sign. It names the
--     current accepted inspector (accept_offer, role inspector) and records a 'permission' attestation with verdict
--     'supports' and the stated scope on that inspector's offer, through the existing projector attestation event. The
--     attestor is the signer (submitted_by_user_id = attestor_user_id), so the statement is authenticated. p_window
--     {from, until} is optional and kept on the source. It changes no vehicle access rows.
--   * inspection_seller_permission(p_work_order_id, p_party): established while that attestation, the inspector's offer and
--     the inspection requirement are current, the attestor is still a verified owner and the window has not ended;
--     expired after the window; otherwise not_established. Grantor by public handle or unnamed party.
--   * work_order_inspection_view (open inspection reader) and read_work_order_job_path (inspection stage) read it; both
--     are their live definitions (md5 prefixes b88e78fe and the 20261019183000 job path) with that one value changed.
-- Contract: supabase/sql/test_inspection_access.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.vehicle_verified_owner(p_user uuid, p_vehicle uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.ownership_verifications ov WHERE ov.user_id = p_user
    AND ov.vehicle_id = p_vehicle AND ov.status = 'approved' AND (ov.expires_at IS NULL OR ov.expires_at > now()));
END $$;
REVOKE ALL ON FUNCTION public.vehicle_verified_owner(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_verified_owner(uuid,uuid) IS 'Internal: approved, unexpired ownership_verifications for this account and vehicle.';

CREATE FUNCTION public.inspection_seller_permission(p_work_order_id uuid, p_party boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE w public.work_orders%ROWTYPE; g record;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  SELECT a.id, a.attestor_user_id, a.scope, a.fulfillment_id, s.observed_at,
      (s.structured_data#>>'{inspection_access,window,from}')::timestamptz AS w_from,
      (s.structured_data#>>'{inspection_access,window,until}')::timestamptz AS w_until
    INTO g
    FROM public.work_order_resource_attestations a
    JOIN public.vehicle_observations s ON s.id = a.id AND s.is_superseded IS FALSE AND s.vehicle_id = w.vehicle_id
      AND s.extraction_method = 'inspection_access_sign_v1' AND s.submitted_by_user_id = a.attestor_user_id
    JOIN public.work_order_resource_fulfillments f ON f.id = a.fulfillment_id
    JOIN public.vehicle_observations fs ON fs.id = f.id AND fs.is_superseded IS FALSE
    JOIN public.work_order_resource_requirements r ON r.id = f.requirement_id AND r.requirement_kind = 'inspection'
    JOIN public.vehicle_observations rs ON rs.id = r.id AND rs.is_superseded IS FALSE
    WHERE a.work_order_id = w.id AND a.attestation_kind = 'permission' AND a.verdict = 'supports'
      AND public.vehicle_verified_owner(a.attestor_user_id, w.vehicle_id)
    ORDER BY s.observed_at DESC, a.id LIMIT 1;
  IF g.id IS NULL THEN
    RETURN jsonb_build_object('state', 'not_established',
      'basis', 'no current authenticated permission from a verified owner; ordering or accepting an inspection grants no vehicle access');
  END IF;
  RETURN jsonb_build_object('state', CASE WHEN g.w_until IS NOT NULL AND g.w_until <= now() THEN 'expired' ELSE 'established' END,
    'granted_at', g.observed_at, 'scope', g.scope, 'window', CASE WHEN g.w_from IS NOT NULL THEN jsonb_build_object('from', g.w_from, 'until', g.w_until) END,
    'granted_by', public.platform_person_label(g.attestor_user_id)
      || CASE WHEN p_party THEN jsonb_build_object('user_id', g.attestor_user_id) ELSE '{}'::jsonb END,
    'offer_id', g.fulfillment_id, 'attestation_id', g.id, 'basis', 'permission attestation signed by a verified owner for the accepted inspector');
END $$;
REVOKE ALL ON FUNCTION public.inspection_seller_permission(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspection_seller_permission(uuid,boolean) TO service_role;
COMMENT ON FUNCTION public.inspection_seller_permission(uuid,boolean) IS 'Service-only: seller permission state of an inspection job (established | expired | not_established) from a verified owner''s signed permission attestation on the current accepted inspector''s offer.';

CREATE FUNCTION public.grant_inspection_access(p_inspection_work_order_id uuid, p_scope text, p_window jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  seller uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  inspector record;
  w_from timestamptz;
  w_until timestamptz;
  owner_source uuid;
  request_key text;
  obs_id uuid;
  existing uuid;
BEGIN
  IF seller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_inspection_work_order_id AND scope_category = 'inspection';
  IF NOT FOUND OR NOT public.vehicle_verified_owner(seller, w.vehicle_id) THEN
    RAISE EXCEPTION 'Inspection unavailable for access: verified owner of the vehicle required' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR length(btrim(p_scope)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Scope of the permission is required (at most 2000 characters)' USING ERRCODE = '23514';
  END IF;
  IF p_window IS NOT NULL THEN
    IF jsonb_typeof(p_window) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_window) k WHERE k NOT IN ('from','until')) THEN
      RAISE EXCEPTION 'Window must be {from, until}' USING ERRCODE = '23514';
    END IF;
    w_from := (p_window->>'from')::timestamptz; w_until := (p_window->>'until')::timestamptz;
    IF w_from IS NULL OR w_until IS NULL OR w_from >= w_until OR w_until <= signed THEN
      RAISE EXCEPTION 'Window needs from before until, ending in the future' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT ap.* INTO inspector FROM public.work_order_accepted_providers(w.id) ap WHERE ap.role = 'inspector' ORDER BY ap.accepted_at DESC LIMIT 1;
  IF inspector.offer_id IS NULL THEN
    RAISE EXCEPTION 'Accept an inspector offer before granting access' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('inspection-access', seller, w.id, inspector.offer_id, btrim(p_scope), w_from, w_until)::text);
  SELECT o.id INTO existing FROM public.vehicle_observations o WHERE o.source_id = owner_source
    AND o.source_identifier = 'inspection_access:'||w.id::text AND o.kind = 'work_record' AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('attestation_id', existing, 'inspection_work_order_id', w.id, 'offer_id', inspector.offer_id, 'duplicate', true,
      'seller_permission', public.inspection_seller_permission(w.id, true)->'state', 'vehicle_access_rows_changed', false);
  END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'inspection_access:'||w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('Verified owner permits the accepted inspector to inspect the vehicle: %s', btrim(p_scope)), request_key,
    jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'attestation', 'work_order_id', w.id,
        'fulfillment_id', inspector.offer_id, 'attestor_user_id', seller, 'attestation_kind', 'permission', 'verdict', 'supports',
        'scope', btrim(p_scope)),
      'inspection_access', jsonb_build_object('version', 1, 'inspection_work_order_id', w.id, 'vehicle_id', w.vehicle_id,
        'window', CASE WHEN w_from IS NOT NULL THEN jsonb_build_object('from', w_from, 'until', w_until) END)),
    seller, jsonb_build_object('user_id', seller, 'intake_actor', 'account'), 'inspection_access_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM public.project_work_order_resource_observation(obs_id);
  RETURN jsonb_build_object('attestation_id', obs_id, 'inspection_work_order_id', w.id, 'offer_id', inspector.offer_id,
    'inspector_role', inspector.role, 'scope', btrim(p_scope),
    'window', CASE WHEN w_from IS NOT NULL THEN jsonb_build_object('from', w_from, 'until', w_until) END,
    'granted_at', signed, 'duplicate', false, 'seller_permission', 'established', 'vehicle_access_rows_changed', false,
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.grant_inspection_access(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_inspection_access(uuid,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.grant_inspection_access(uuid,text,jsonb) IS 'Sign: the verified owner of an inspection job''s vehicle permits the current accepted inspector to inspect (permission attestation, verdict supports, stated scope, optional window). Changes no vehicle access rows; no payment.';

-- Live definition of work_order_inspection_view (md5 prefix b88e78fe) with seller_permission read from the helper.
CREATE OR REPLACE FUNCTION public.work_order_inspection_view(p_work_order_id uuid, p_party boolean)
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
    'seller_permission', public.inspection_seller_permission(w.id, p_party),
    'quote', jsonb_build_object('current_version', qs#>'{current_quote,version}', 'acceptance_state', qs#>'{acceptance,state}'),
    'payment_authorized', false);
END $$;

REVOKE ALL ON FUNCTION public.work_order_inspection_view(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Live definition from 20261019183000 with the inspection stage seller_permission read from the helper.
CREATE OR REPLACE FUNCTION public.read_work_order_job_path(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  r jsonb;
  n_ops integer; n_ops_req integer; n_ops_complete integer; n_events integer;
  n_ops_sourced integer; n_ops_pending integer; n_ops_withdrawn integer; n_ops_stale integer;
  n_inspection integer; n_inspection_candidates integer;
  n_insp_jobs integer; n_insp_with_findings integer; n_findings_reports integer; findings_clock timestamptz;
  n_parts integer; n_parts_linked integer; parts_by_status jsonb;
  n_labor integer; n_labor_hours integer; n_labor_estimated integer;
  n_asg integer; n_asg_accept_clock integer; n_asg_unclocked_accept integer; n_asg_unclocked_complete integer;
  n_providers integer; n_offer_accepts integer; n_req_offers integer; n_req_accepted integer; provider_clock timestamptz;
  n_asg_started integer; n_payouts integer; asg_by_status jsonb; payout_by_status jsonb;
  n_hist integer; n_pay integer; pay_by_status jsonb; n_vehicle_payments integer;
  conflicting integer;
  scope_stated boolean; start_clock boolean; completion_clock boolean;
  intake jsonb; inspection jsonb; plan jsonb; terms jsonb; execution jsonb; completion jsonb; accounting jsonb;
  qs jsonb; quote_current boolean; acceptance_state text; approval_at timestamptz; quote_at timestamptz;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id=p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable'; END IF;
  r := public.read_work_order_resources(p_work_order_id);

  scope_stated := COALESCE(NULLIF(btrim(w.scope_description),''),NULLIF(btrim(w.description),''),NULLIF(btrim(w.title),'')) IS NOT NULL;
  intake := jsonb_build_object('state',CASE WHEN w.vehicle_id IS NOT NULL AND scope_stated THEN 'recorded'
      WHEN w.vehicle_id IS NOT NULL OR scope_stated THEN 'partial' ELSE 'absent' END,
    'vehicle_bound',w.vehicle_id IS NOT NULL,'scope_stated',scope_stated,'request_source',w.request_source,'created_at',w.created_at,
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN w.vehicle_id IS NULL THEN 'no_vehicle' END,
      CASE WHEN NOT scope_stated THEN 'no_scope' END],NULL)),
    'inconsistencies','[]'::jsonb);

  SELECT count(*),count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r->'fulfillments') f WHERE f->>'requirement_id'=q->>'id'))
    INTO n_inspection,n_inspection_candidates
    FROM jsonb_array_elements(r->'requirements') q WHERE q->>'requirement_kind'='inspection';
  -- Linked inspection jobs: this job when it is an inspection, otherwise its child inspections.
  SELECT count(*),count(*) FILTER (WHERE fr.n>0),COALESCE(sum(fr.n),0),max(fr.last_at)
    INTO n_insp_jobs,n_insp_with_findings,n_findings_reports,findings_clock
    FROM public.work_orders x
    CROSS JOIN LATERAL (SELECT count(*) n,max(o.observed_at) last_at FROM public.vehicle_observations o
      WHERE o.source_id=(SELECT s.id FROM public.observation_sources s WHERE s.slug='owner-input')
        AND o.source_identifier='inspection_findings:'||x.id::text AND o.kind::text='work_record' AND o.is_superseded IS FALSE
        AND o.vehicle_id IS NOT DISTINCT FROM x.vehicle_id AND o.extraction_method='inspection_findings_sign_v1') fr
    WHERE x.scope_category='inspection' AND ((w.scope_category='inspection' AND x.id=w.id)
      OR (w.scope_category IS DISTINCT FROM 'inspection' AND x.parent_work_order_id=w.id));
  inspection := jsonb_build_object('state',CASE WHEN n_insp_jobs>0 THEN CASE WHEN n_insp_with_findings>0 THEN 'recorded' ELSE 'partial' END
      WHEN n_inspection>0 THEN 'recorded' ELSE 'absent' END,
    'inspection_requirements',n_inspection,'with_performer_candidate',n_inspection_candidates,
    'inspection_jobs',n_insp_jobs,'inspection_job_role',CASE WHEN n_insp_jobs=0 THEN NULL
      WHEN w.scope_category='inspection' THEN 'self' ELSE 'child' END,
    'inspection_jobs_with_findings',n_insp_with_findings,'findings_reports',n_findings_reports,'findings_clock',findings_clock,
    'seller_permission',CASE WHEN n_insp_jobs=0 THEN NULL WHEN EXISTS (SELECT 1 FROM public.work_orders x
      WHERE x.scope_category='inspection' AND ((w.scope_category='inspection' AND x.id=w.id) OR x.parent_work_order_id=w.id)
        AND public.inspection_seller_permission(x.id,false)->>'state'='established') THEN 'established' ELSE 'not_established' END,
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN n_inspection=0 AND n_insp_jobs=0 THEN 'no_inspection_requirement' END,
      CASE WHEN n_inspection>n_inspection_candidates THEN 'inspection_performer_unresolved' END,
      CASE WHEN n_insp_jobs>n_insp_with_findings THEN 'inspection_findings_pending' END],NULL)),
    'inconsistencies','[]'::jsonb);

  SELECT count(*),count(*) FILTER (WHERE li.status='complete'),
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r->'requirements') q WHERE q->>'line_item_id'=li.id::text))
    INTO n_ops,n_ops_complete,n_ops_req FROM public.work_order_line_items li WHERE li.work_order_id=w.id;
  SELECT count(*) FILTER (WHERE li.source_observation_id IS NOT NULL),count(*) FILTER (WHERE li.status='pending'),
      count(*) FILTER (WHERE li.source_observation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicle_observations o
        WHERE o.id=li.source_observation_id AND o.is_superseded IS FALSE AND o.vehicle_id IS NOT DISTINCT FROM w.vehicle_id)),
      count(*) FILTER (WHERE li.source_observation_id IS NOT NULL AND strpos(COALESCE(CASE li.basis_field
        WHEN 'description' THEN w.description ELSE w.scope_description END,''),li.basis_excerpt)=0)
    INTO n_ops_sourced,n_ops_pending,n_ops_withdrawn,n_ops_stale
    FROM public.work_order_line_items li WHERE li.work_order_id=w.id;
  SELECT count(*),count(*) FILTER (WHERE job_op_code IS NOT NULL) INTO n_parts,n_parts_linked
    FROM public.work_order_parts WHERE work_order_id=w.id;
  SELECT COALESCE(jsonb_object_agg(k,n),'{}'::jsonb) INTO parts_by_status
    FROM (SELECT COALESCE(status,'unstated') k,count(*) n FROM public.work_order_parts WHERE work_order_id=w.id GROUP BY 1) x;
  SELECT count(*),count(*) FILTER (WHERE hours IS NOT NULL),count(*) FILTER (WHERE ai_estimated IS TRUE)
    INTO n_labor,n_labor_hours,n_labor_estimated FROM public.work_order_labor WHERE work_order_id=w.id;
  SELECT count(*) INTO conflicting FROM jsonb_array_elements(r->'specification_summaries') s WHERE s->>'status'='conflicting_evidence';
  -- Provider offers and accepted providers (offer_on_requirement, accept_offer).
  SELECT count(DISTINCT f->>'requirement_id') INTO n_req_offers FROM jsonb_array_elements(r->'fulfillments') f WHERE f->>'offer_kind' IS NOT NULL;
  SELECT count(*),count(DISTINCT fu.requirement_id),max(ap.accepted_at) INTO n_providers,n_req_accepted,provider_clock
    FROM public.work_order_accepted_providers(w.id) ap JOIN public.work_order_resource_fulfillments fu ON fu.id=ap.offer_id;
  plan := jsonb_build_object('state',CASE WHEN n_ops+n_parts+n_labor=0 THEN 'absent' ELSE 'partial' END,
    'operations',n_ops,'operations_with_requirements',n_ops_req,
    'operations_from_scope_text',n_ops_sourced,'operations_pending',n_ops_pending,
    'requirements',r#>'{coverage,recorded_requirements}','requirements_with_candidates',r#>'{coverage,requirements_with_candidates}',
    'requirements_with_offers',n_req_offers,'requirements_with_accepted_provider',n_req_accepted,
    'specifications',r#>'{coverage,recorded_specifications}','conflicting_specifications',conflicting,
    'parts',n_parts,'parts_with_operation_code',n_parts_linked,'parts_by_status',parts_by_status,
    'labor_rows',n_labor,'labor_rows_with_hours',n_labor_hours,'labor_rows_ai_estimated',n_labor_estimated,
    'executable','not_assessed',
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN n_ops=0 AND n_labor=0 THEN 'no_operations' END,
      CASE WHEN n_ops=0 AND n_labor>0 THEN 'operations_only_in_labor_rows' END,
      CASE WHEN n_ops>n_ops_req THEN 'operations_without_requirements' END,
      CASE WHEN n_parts>n_parts_linked THEN 'parts_without_operation_link' END,
      CASE WHEN conflicting>0 THEN 'conflicting_specification' END],NULL)),
    'inconsistencies',to_jsonb(array_remove(ARRAY[
      CASE WHEN n_ops_withdrawn>0 THEN 'operation_source_withdrawn' END,
      CASE WHEN n_ops_stale>0 THEN 'operation_excerpt_missing_from_scope' END],NULL)));

  SELECT count(*),count(*) FILTER (WHERE accepted_at IS NOT NULL),
      count(*) FILTER (WHERE status IN ('accepted','in_progress','completed') AND accepted_at IS NULL),
      count(*) FILTER (WHERE status='completed' AND completed_at IS NULL),
      count(*) FILTER (WHERE started_at IS NOT NULL),
      count(*) FILTER (WHERE actual_payout IS NOT NULL OR paid_at IS NOT NULL)
    INTO n_asg,n_asg_accept_clock,n_asg_unclocked_accept,n_asg_unclocked_complete,n_asg_started,n_payouts
    FROM public.work_order_assignments WHERE work_order_id=w.id;
  -- An accept_offer row counts as an accept clock only while its acceptance is current.
  SELECT count(*) INTO n_offer_accepts FROM public.work_order_assignments WHERE work_order_id=w.id AND acceptance_observation_id IS NOT NULL;
  n_asg_accept_clock := n_asg_accept_clock-(n_offer_accepts-n_providers);
  SELECT COALESCE(jsonb_object_agg(k,n),'{}'::jsonb) INTO asg_by_status
    FROM (SELECT COALESCE(status,'unstated') k,count(*) n FROM public.work_order_assignments WHERE work_order_id=w.id GROUP BY 1) x;
  SELECT COALESCE(jsonb_object_agg(k,n),'{}'::jsonb) INTO payout_by_status
    FROM (SELECT COALESCE(payout_status,'unstated') k,count(*) n FROM public.work_order_assignments WHERE work_order_id=w.id GROUP BY 1) x;
  -- Quote and acceptance evidence (work_order_quote_state); the stored scalars stay the fallback.
  qs := public.work_order_quote_state(w.id);
  quote_current := jsonb_typeof(qs->'current_quote')='object';
  acceptance_state := qs#>>'{acceptance,state}';
  approval_at := CASE WHEN acceptance_state='accepted' THEN (qs#>>'{acceptance,signed_at}')::timestamptz ELSE w.approved_at END;
  quote_at := COALESCE((qs#>>'{current_quote,observed_at}')::timestamptz,w.quoted_at);
  terms := jsonb_build_object('state',CASE WHEN approval_at IS NOT NULL OR n_asg_accept_clock>0 THEN 'recorded'
      WHEN quote_at IS NOT NULL OR w.estimated_total IS NOT NULL OR w.estimated_cost_cents IS NOT NULL OR n_asg>0 THEN 'partial'
      ELSE 'absent' END,
    'quote_clock',quote_at,
    'quote_clock_basis',CASE WHEN quote_current THEN 'current_quote' WHEN w.quoted_at IS NOT NULL THEN 'work_orders.quoted_at' END,
    'current_quote',CASE WHEN quote_current THEN jsonb_build_object('quote_id',qs#>'{current_quote,quote_id}',
      'version',qs#>'{current_quote,version}','quote_hash',qs#>'{current_quote,quote_hash}') END,
    'quote_versions',qs->'quote_versions',
    'estimate_recorded',(w.estimated_total IS NOT NULL OR w.estimated_cost_cents IS NOT NULL),
    'approval_clock',approval_at,
    'approval_clock_basis',CASE WHEN acceptance_state='accepted' THEN 'quote_acceptance_sign'
      WHEN w.approved_at IS NOT NULL THEN 'work_orders.approved_at' END,
    'approval_signer',CASE WHEN acceptance_state='accepted' THEN jsonb_build_object('role',qs#>'{acceptance,signer_role}',
      'acceptance_id',qs#>'{acceptance,acceptance_id}','basis','authenticated_sign') END,
    'stored_approval_clock',w.approved_at,
    'schedule_window_recorded',(w.scheduled_start IS NOT NULL AND w.scheduled_end IS NOT NULL),
    'assignments',n_asg,'assignments_by_status',asg_by_status,'assignments_with_accept_clock',n_asg_accept_clock,
    'accepted_providers',n_providers,'provider_acceptance_clock',provider_clock,'provider_acceptances_withheld',n_offer_accepts-n_providers,
    'customer_acceptance',CASE acceptance_state WHEN 'accepted' THEN 'signed' WHEN 'withheld' THEN 'withheld' ELSE 'not_established' END,
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN approval_at IS NULL THEN 'no_approval_clock' END,
      CASE WHEN acceptance_state='withheld' THEN 'acceptance_withheld_'||(qs#>>'{acceptance,withheld_reason}') END,
      CASE WHEN n_asg=0 THEN 'no_assignment' END,
      CASE WHEN n_offer_accepts>n_providers THEN 'provider_acceptance_withheld' END,
      CASE WHEN w.scheduled_start IS NULL OR w.scheduled_end IS NULL THEN 'no_schedule_window' END],NULL)),
    'inconsistencies',to_jsonb(array_remove(ARRAY[CASE WHEN n_asg_unclocked_accept>0 THEN 'assignment_accepted_status_without_clock' END],NULL)));

  SELECT count(*) INTO n_events FROM public.component_events WHERE work_order_id=w.id;
  start_clock := w.started_at IS NOT NULL OR w.actual_start IS NOT NULL;
  execution := jsonb_build_object('state',CASE WHEN start_clock OR n_events>0 THEN 'recorded'
      WHEN n_ops_complete>0 OR n_asg_started>0 THEN 'partial' ELSE 'absent' END,
    'start_clock',COALESCE(w.started_at,w.actual_start),'component_events',n_events,
    'operations_complete_status',n_ops_complete,'assignments_started',n_asg_started,'measured_usage','not_established',
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN NOT start_clock THEN 'no_start_clock' END,
      CASE WHEN n_events=0 THEN 'no_operation_record' END],NULL)),
    'inconsistencies','[]'::jsonb);

  SELECT count(*) INTO n_hist FROM public.work_order_status_history WHERE work_order_id=w.id;
  completion_clock := w.completed_at IS NOT NULL OR w.actual_end IS NOT NULL;
  completion := jsonb_build_object('state',CASE WHEN completion_clock THEN 'recorded'
      WHEN w.status IN ('completed','paid') THEN 'status_only' ELSE 'absent' END,
    'status',w.status,'completion_clock',COALESCE(w.completed_at,w.actual_end),'status_history_rows',n_hist,
    'customer_acceptance','not_established',
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN n_hist=0 THEN 'no_status_history' END],NULL)),
    'inconsistencies',to_jsonb(array_remove(ARRAY[
      CASE WHEN w.status IN ('completed','paid') AND NOT completion_clock THEN 'done_status_without_completion_clock' END,
      CASE WHEN n_asg_unclocked_complete>0 THEN 'assignment_completed_status_without_clock' END],NULL)));

  SELECT count(*) INTO n_pay FROM public.work_order_payments WHERE work_order_id=w.id;
  SELECT COALESCE(jsonb_object_agg(k,c),'{}'::jsonb) INTO pay_by_status
    FROM (SELECT COALESCE(status,'unstated') k,count(*) c FROM public.work_order_payments WHERE work_order_id=w.id GROUP BY 1) x;
  SELECT count(*) INTO n_vehicle_payments FROM public.payment_events
    WHERE w.vehicle_id IS NOT NULL AND scope_type='vehicle' AND scope_id=w.vehicle_id AND is_superseded IS NOT TRUE;
  accounting := jsonb_build_object('state',CASE WHEN n_pay>0 THEN 'recorded' ELSE 'absent' END,
    'payment_records',n_pay,'payment_records_by_status',pay_by_status,
    'vehicle_scoped_payment_events',n_vehicle_payments,'vehicle_payment_job_attribution','not_established',
    'payouts_recorded',n_payouts,'payout_status',payout_by_status,
    'labor_value_calculated',false,'cost_allocated',false,'disbursement','not_performed',
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN n_pay=0 THEN 'no_payment_record' END,
      CASE WHEN n_asg>0 AND n_payouts=0 THEN 'no_payout_record' END],NULL)),
    'inconsistencies',to_jsonb(array_remove(ARRAY[
      CASE WHEN w.status='paid' AND n_pay=0 THEN 'paid_status_without_payment_record' END,
      CASE WHEN n_pay>0 AND w.vehicle_id IS NULL THEN 'payments_without_vehicle' END],NULL)));

  RETURN jsonb_build_object('work_order_id',w.id,'vehicle_id',w.vehicle_id,'as_of',statement_timestamp(),
    'stages',jsonb_build_object('intake',intake,'inspection',inspection,'plan',plan,'terms',terms,
      'execution',execution,'completion',completion,'accounting',accounting),
    'state_basis','presence of existing owner records and clocks; not verified truth',
    'booking_readiness','not_assessed','permission_authority','not_assessed','payment_authorized',false);
END $$;
REVOKE ALL ON FUNCTION public.read_work_order_job_path(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_work_order_job_path(uuid) TO service_role;
COMMENT ON FUNCTION public.read_work_order_job_path(uuid) IS 'Service-only, read-only job-path measurement for one work order across intake, inspection, plan, terms, execution, completion and accounting. Reports evidence presence, gaps and status/clock/record inconsistencies from existing owners; no customer contact fields or amounts; never repairs, books, approves or pays.';

NOTIFY pgrst, 'reload schema';
COMMIT;
