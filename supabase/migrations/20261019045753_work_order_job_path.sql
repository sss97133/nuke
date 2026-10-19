-- Self-measurement for the mechanics job path: intake, inspection, plan, terms, execution,
-- completion and accounting, read from the owners that already exist. A stage state reports
-- whether evidence is recorded, partial, only claimed by a status, or absent; it is not a
-- verified truth, a readiness verdict or a payment instruction. Inconsistencies between an
-- owner's status and its own clocks or records are reported, never repaired here.
-- Output carries counts, statuses and clocks only: no customer contact fields or amounts.
-- Contract: supabase/sql/test_work_order_job_path.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.read_work_order_job_path(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  r jsonb;
  n_ops integer; n_ops_req integer; n_ops_complete integer; n_events integer;
  n_inspection integer; n_inspection_candidates integer;
  n_parts integer; n_parts_linked integer; parts_by_status jsonb;
  n_labor integer; n_labor_hours integer; n_labor_estimated integer;
  n_asg integer; n_asg_accept_clock integer; n_asg_unclocked_accept integer; n_asg_unclocked_complete integer;
  n_asg_started integer; n_payouts integer; asg_by_status jsonb; payout_by_status jsonb;
  n_hist integer; n_pay integer; pay_by_status jsonb; n_vehicle_payments integer;
  conflicting integer;
  scope_stated boolean; start_clock boolean; completion_clock boolean;
  intake jsonb; inspection jsonb; plan jsonb; terms jsonb; execution jsonb; completion jsonb; accounting jsonb;
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
  inspection := jsonb_build_object('state',CASE WHEN n_inspection>0 THEN 'recorded' ELSE 'absent' END,
    'inspection_requirements',n_inspection,'with_performer_candidate',n_inspection_candidates,
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN n_inspection=0 THEN 'no_inspection_requirement' END,
      CASE WHEN n_inspection>n_inspection_candidates THEN 'inspection_performer_unresolved' END],NULL)),
    'inconsistencies','[]'::jsonb);

  SELECT count(*),count(*) FILTER (WHERE li.status='complete'),
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r->'requirements') q WHERE q->>'line_item_id'=li.id::text))
    INTO n_ops,n_ops_complete,n_ops_req FROM public.work_order_line_items li WHERE li.work_order_id=w.id;
  SELECT count(*),count(*) FILTER (WHERE job_op_code IS NOT NULL) INTO n_parts,n_parts_linked
    FROM public.work_order_parts WHERE work_order_id=w.id;
  SELECT COALESCE(jsonb_object_agg(k,n),'{}'::jsonb) INTO parts_by_status
    FROM (SELECT COALESCE(status,'unstated') k,count(*) n FROM public.work_order_parts WHERE work_order_id=w.id GROUP BY 1) x;
  SELECT count(*),count(*) FILTER (WHERE hours IS NOT NULL),count(*) FILTER (WHERE ai_estimated IS TRUE)
    INTO n_labor,n_labor_hours,n_labor_estimated FROM public.work_order_labor WHERE work_order_id=w.id;
  SELECT count(*) INTO conflicting FROM jsonb_array_elements(r->'specification_summaries') s WHERE s->>'status'='conflicting_evidence';
  plan := jsonb_build_object('state',CASE WHEN n_ops+n_parts+n_labor=0 THEN 'absent' ELSE 'partial' END,
    'operations',n_ops,'operations_with_requirements',n_ops_req,
    'requirements',r#>'{coverage,recorded_requirements}','requirements_with_candidates',r#>'{coverage,requirements_with_candidates}',
    'specifications',r#>'{coverage,recorded_specifications}','conflicting_specifications',conflicting,
    'parts',n_parts,'parts_with_operation_code',n_parts_linked,'parts_by_status',parts_by_status,
    'labor_rows',n_labor,'labor_rows_with_hours',n_labor_hours,'labor_rows_ai_estimated',n_labor_estimated,
    'executable','not_assessed',
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN n_ops=0 THEN 'no_operations' END,
      CASE WHEN n_ops>n_ops_req THEN 'operations_without_requirements' END,
      CASE WHEN n_parts>n_parts_linked THEN 'parts_without_operation_link' END,
      CASE WHEN conflicting>0 THEN 'conflicting_specification' END],NULL)),
    'inconsistencies','[]'::jsonb);

  SELECT count(*),count(*) FILTER (WHERE accepted_at IS NOT NULL),
      count(*) FILTER (WHERE status IN ('accepted','in_progress','completed') AND accepted_at IS NULL),
      count(*) FILTER (WHERE status='completed' AND completed_at IS NULL),
      count(*) FILTER (WHERE started_at IS NOT NULL),
      count(*) FILTER (WHERE actual_payout IS NOT NULL OR paid_at IS NOT NULL)
    INTO n_asg,n_asg_accept_clock,n_asg_unclocked_accept,n_asg_unclocked_complete,n_asg_started,n_payouts
    FROM public.work_order_assignments WHERE work_order_id=w.id;
  SELECT COALESCE(jsonb_object_agg(k,n),'{}'::jsonb) INTO asg_by_status
    FROM (SELECT COALESCE(status,'unstated') k,count(*) n FROM public.work_order_assignments WHERE work_order_id=w.id GROUP BY 1) x;
  SELECT COALESCE(jsonb_object_agg(k,n),'{}'::jsonb) INTO payout_by_status
    FROM (SELECT COALESCE(payout_status,'unstated') k,count(*) n FROM public.work_order_assignments WHERE work_order_id=w.id GROUP BY 1) x;
  terms := jsonb_build_object('state',CASE WHEN w.approved_at IS NOT NULL OR n_asg_accept_clock>0 THEN 'recorded'
      WHEN w.quoted_at IS NOT NULL OR w.estimated_total IS NOT NULL OR w.estimated_cost_cents IS NOT NULL OR n_asg>0 THEN 'partial'
      ELSE 'absent' END,
    'quote_clock',w.quoted_at,'estimate_recorded',(w.estimated_total IS NOT NULL OR w.estimated_cost_cents IS NOT NULL),
    'approval_clock',w.approved_at,'schedule_window_recorded',(w.scheduled_start IS NOT NULL AND w.scheduled_end IS NOT NULL),
    'assignments',n_asg,'assignments_by_status',asg_by_status,'assignments_with_accept_clock',n_asg_accept_clock,
    'customer_acceptance','not_established',
    'gaps',to_jsonb(array_remove(ARRAY[CASE WHEN w.approved_at IS NULL THEN 'no_approval_clock' END,
      CASE WHEN n_asg=0 THEN 'no_assignment' END,
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

CREATE FUNCTION public.work_order_job_path_scoreboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  WITH paths AS MATERIALIZED (SELECT public.read_work_order_job_path(id) AS p FROM public.work_orders),
  stages AS (SELECT s.key AS stage,s.value AS v FROM paths CROSS JOIN LATERAL jsonb_each(p->'stages') s),
  states AS (SELECT stage,jsonb_object_agg(state,n) AS by_state FROM
    (SELECT stage,v->>'state' AS state,count(*) AS n FROM stages GROUP BY 1,2) x GROUP BY stage),
  gaps AS (SELECT g#>>'{}' AS code,count(*) AS n FROM stages CROSS JOIN LATERAL jsonb_array_elements(v->'gaps') g GROUP BY 1),
  bad AS (SELECT i#>>'{}' AS code,count(*) AS n FROM stages CROSS JOIN LATERAL jsonb_array_elements(v->'inconsistencies') i GROUP BY 1)
  SELECT jsonb_build_object('population','all work_orders rows','work_orders',(SELECT count(*) FROM paths),
    'measured_at',statement_timestamp(),
    'stages',COALESCE((SELECT jsonb_object_agg(stage,by_state) FROM states),'{}'::jsonb),
    'gaps',COALESCE((SELECT jsonb_object_agg(code,n) FROM gaps),'{}'::jsonb),
    'inconsistencies',COALESCE((SELECT jsonb_object_agg(code,n) FROM bad),'{}'::jsonb),
    'state_basis','presence of existing owner records and clocks; not verified truth or public readiness')
$$;
REVOKE ALL ON FUNCTION public.work_order_job_path_scoreboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_job_path_scoreboard() TO service_role;
COMMENT ON FUNCTION public.work_order_job_path_scoreboard() IS 'Service-only population scoreboard over every work order: per-stage state counts, gap counts and inconsistency counts from read_work_order_job_path. Denominator is all work_orders rows at measured_at.';
NOTIFY pgrst, 'reload schema';
COMMIT;
