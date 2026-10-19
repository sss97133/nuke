-- Offers become readable and the job path recognizes accepted providers (QUOTE lane RSI pass 5: close the matching loop).
--
--   * work_order_offers_read(p_work_order_id): open reader (anon and authenticated) under the privacy doctrine. Per current
--     requirement: its current offers (offer id and hash, kind, evidence rung, provider by public handle / organization name /
--     unnamed party, performer actor label, terms, availability window, offered_at, acceptance state) and the accepted
--     providers. Terms are open. Raw ids and the offer note go to parties only (customer, organization owner, performer, and
--     the offering account for its own offers). A work order on a non-public vehicle only for slot holders, as the other open
--     job readers. viewer.actions: offer (per requirement, when work_order_offer_eligibility allows the viewer as an
--     individual), withdraw_offer (the viewer's own current offers) and accept_offer (the customer, per acceptable offer).
--   * read_work_order_job_path: the live definition (pg_get_functiondef md5 prefix 44db0efd, from 20261019153000) with plan
--     and terms changed only. plan adds requirements_with_offers and requirements_with_accepted_provider. terms counts an
--     accept_offer assignment as an accept clock only while it is current (work_order_accepted_providers), adds
--     accepted_providers, provider_acceptance_clock and provider_acceptances_withheld, and the gap provider_acceptance_withheld.
--     Legacy assignments count as before. No raw ids, amounts or contact. The scoreboard is unchanged.
-- Read-only. Contract: supabase/sql/test_work_order_offers_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_offers_read(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  offering boolean;
  requirements jsonb;
  actions jsonb := '[]'::jsonb;
  n_offers integer;
  n_withdrawn integer;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots);
  offering := viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments f
    JOIN public.vehicle_observations s ON s.id = f.id WHERE f.work_order_id = w.id AND f.offer_kind IS NOT NULL
      AND s.is_superseded IS FALSE AND s.submitted_by_user_id = viewer);
  IF offering THEN my_slots := array_append(my_slots, 'offering_provider'); END IF;

  WITH reqs AS (
    SELECT q->>'id' AS rid, q->>'requirement_kind' AS kind, q->>'description' AS description, q->>'line_item_id' AS line_item_id
    FROM jsonb_array_elements(public.read_work_order_resources(w.id)->'requirements') q
  ), offers AS (
    SELECT f.*, s.observed_at AS offered_at, s.submitted_by_user_id AS offering_account,
      s.structured_data#>>'{work_order_resource,note}' AS note,
      (SELECT ap.assignment_id FROM public.work_order_accepted_providers(w.id) ap WHERE ap.offer_id = f.id LIMIT 1) AS current_assignment,
      (SELECT a.accepted_at FROM public.work_order_assignments a WHERE a.fulfillment_id = f.id ORDER BY a.accepted_at DESC LIMIT 1) AS accepted_at,
      (SELECT a.role FROM public.work_order_assignments a WHERE a.fulfillment_id = f.id ORDER BY a.accepted_at DESC LIMIT 1) AS accepted_role
    FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id
    WHERE f.work_order_id = w.id AND f.offer_kind IS NOT NULL AND s.is_superseded IS FALSE AND s.vehicle_id = w.vehicle_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('requirement_id', r.rid, 'requirement_kind', r.kind, 'description', r.description,
      'offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('offer_id', o.id, 'offer_hash', o.offer_hash, 'offer_kind', o.offer_kind,
          'offer_rung', o.offer_rung,
          'provider', CASE WHEN o.offer_kind = 'organization' THEN public.platform_organization_label(o.supplier_organization_id)
            ELSE public.platform_person_label(o.offering_account) END
            || CASE WHEN party OR o.offering_account = viewer THEN jsonb_build_object('user_id', o.offering_account) ELSE '{}'::jsonb END,
          'performer', CASE WHEN o.performer_actor_id IS NOT NULL THEN public.platform_actor_label(o.performer_actor_id) END,
          'facility', CASE WHEN o.facility_organization_id IS NOT NULL THEN public.platform_organization_label(o.facility_organization_id) END,
          'terms', o.offer_terms, 'available_from', o.available_from, 'available_until', o.available_until, 'offered_at', o.offered_at,
          'note', CASE WHEN party OR o.offering_account = viewer THEN o.note END,
          'acceptance', jsonb_build_object('state', CASE WHEN o.current_assignment IS NOT NULL THEN 'accepted'
              WHEN o.accepted_at IS NOT NULL THEN 'withheld' ELSE 'not_accepted' END,
            'accepted_at', o.accepted_at, 'role', o.accepted_role),
          'attribution', 'authenticated_sign') ORDER BY o.offered_at, o.id) FROM offers o WHERE o.requirement_id::text = r.rid), '[]'::jsonb))
    ORDER BY r.rid), '[]'::jsonb) INTO requirements FROM reqs r;

  SELECT count(*) INTO n_offers FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers');
  SELECT count(*) INTO n_withdrawn FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id
    WHERE f.work_order_id = w.id AND f.offer_kind IS NOT NULL AND s.is_superseded IS NOT FALSE;

  IF viewer IS NOT NULL THEN
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'offer', 'rpc', 'offer_on_requirement',
        'args', jsonb_build_object('p_requirement_id', r->>'requirement_id'),
        'as', jsonb_build_object('offer_kind', el->'offer_kind', 'offer_rung', el->'rung'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r
      CROSS JOIN LATERAL (SELECT public.work_order_offer_eligibility(viewer, (r->>'requirement_id')::uuid) AS el) e
      WHERE (el->>'eligible')::boolean;
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'withdraw_offer', 'rpc', 'withdraw_offer',
        'args', jsonb_build_object('p_offer_id', o->>'offer_id'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers') o
      WHERE (SELECT s.submitted_by_user_id FROM public.vehicle_observations s WHERE s.id = (o->>'offer_id')::uuid) = viewer;
    SELECT actions || COALESCE(jsonb_agg(jsonb_build_object('action', 'accept_offer', 'rpc', 'accept_offer',
        'args', jsonb_build_object('p_offer_id', o->>'offer_id', 'p_offer_hash', o->>'offer_hash'))), '[]'::jsonb)
      INTO actions
      FROM jsonb_array_elements(requirements) r, jsonb_array_elements(r->'offers') o
      WHERE o#>>'{acceptance,state}' <> 'accepted'
        AND public.work_order_offer_acceptance_refusal((o->>'offer_id')::uuid, viewer, statement_timestamp()) IS NULL;
  END IF;

  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object('work_order_id', w.id, 'as_of', statement_timestamp(),
    'work_order_status', w.status, 'requirements', requirements,
    'accepted_providers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('assignment_id', ap.assignment_id, 'offer_id', ap.offer_id,
        'role', ap.role, 'accepted_at', ap.accepted_at, 'performer', public.platform_actor_label(ap.performer_actor_id),
        'provider', public.platform_person_label(ap.account_id)
          || CASE WHEN party THEN jsonb_build_object('user_id', ap.account_id) ELSE '{}'::jsonb END) ORDER BY ap.accepted_at), '[]'::jsonb)
      FROM public.work_order_accepted_providers(w.id) ap),
    'viewer', public.job_reader_viewer(CASE WHEN offering AND public.job_reader_context(my_slots) = 'visitor' THEN 'provider'
        ELSE public.job_reader_context(my_slots) END, my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'actions', actions),
    'coverage', jsonb_build_object('requirements', jsonb_array_length(requirements), 'current_offers', n_offers,
      'withdrawn_or_revised_offers', n_withdrawn, 'source_scope', 'offer_on_requirement and accept_offer Sign records',
      'customer_contact', 'never_returned'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; organizations by name; raw ids to parties only',
    'payment_authorized', false, 'disbursement', 'not_performed');
END $$;
REVOKE ALL ON FUNCTION public.work_order_offers_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_offers_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.work_order_offers_read(uuid) IS 'Open (anon and authenticated) reader of provider offers per current requirement: kind, rung, provider by handle or unnamed party, terms, window, acceptance state; accepted providers; viewer actions offer / withdraw_offer / accept_offer. Raw ids and notes to parties only; non-public vehicles only for slot holders. Read-only.';

-- Live definition from 20261019153000 (pg_get_functiondef md5 prefix 44db0efd on 2026-10-19); plan and terms changed only.
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
    'seller_permission',CASE WHEN n_insp_jobs>0 THEN 'not_established' END,
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
