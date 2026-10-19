-- Requested operations from a work order's own scope text (mechanics RSI pass 2).
-- work_order_line_items is the operations owner but had no provenance and no sanctioned
-- insert path. A sourced line item is the projection of one admitted work_record whose
-- envelope quotes one item of the work order's description or scope_description verbatim.
-- It starts pending with no cost, hours or actor: a requested scope item, not performed,
-- priced or assigned work. Its text and provenance are immutable; status stays editable by
-- the work order's parties. Bills include only priced or comped lines, so these do not bill.
-- The job-path reader also counts labor-task rows as operations evidence and reports
-- sourced operations whose source was withdrawn or whose excerpt left the scope text.
-- Contract: supabase/sql/test_work_order_scope_operations.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_order_line_items
  ADD COLUMN source_observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD COLUMN basis_field text,
  ADD COLUMN basis_excerpt text,
  ADD CONSTRAINT woli_provenance_complete CHECK (num_nonnulls(source_observation_id,basis_field,basis_excerpt) IN (0,3)),
  ADD CONSTRAINT woli_basis_field CHECK (basis_field IN ('description','scope_description')),
  ADD CONSTRAINT woli_basis_excerpt CHECK (length(btrim(basis_excerpt)) BETWEEN 1 AND 500),
  ADD CONSTRAINT woli_source_is_id CHECK (source_observation_id IS NULL OR source_observation_id=id);
CREATE UNIQUE INDEX woli_sourced_line_number ON public.work_order_line_items(work_order_id,line_number)
  WHERE source_observation_id IS NOT NULL;
COMMENT ON COLUMN public.work_order_line_items.source_observation_id IS 'Admitted work_record this operation was projected from (equals id); null for legacy rows. Written only by project_work_order_resource_observation.';
COMMENT ON COLUMN public.work_order_line_items.basis_field IS 'Work order text field quoted by a sourced operation: description or scope_description.';
COMMENT ON COLUMN public.work_order_line_items.basis_excerpt IS 'Exact excerpt of that work order field; equals task_description for a sourced operation.';

-- Definer so a party's status update never needs read access to the observation log.
CREATE FUNCTION public.work_order_line_item_provenance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (OLD.source_observation_id IS NOT NULL OR NEW.source_observation_id IS NOT NULL)
      AND (NEW.source_observation_id,NEW.basis_field,NEW.basis_excerpt,NEW.work_order_id,NEW.task_description,NEW.line_number)
        IS DISTINCT FROM (OLD.source_observation_id,OLD.basis_field,OLD.basis_excerpt,OLD.work_order_id,OLD.task_description,OLD.line_number) THEN
      RAISE EXCEPTION 'Sourced operation text and provenance are immutable; supersede the source observation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_observation_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_observations o JOIN public.work_orders wo ON wo.id=NEW.work_order_id AND wo.vehicle_id=o.vehicle_id
    WHERE o.id=NEW.source_observation_id AND o.kind::text='work_record' AND o.is_superseded IS FALSE
      AND strpos(COALESCE(CASE NEW.basis_field WHEN 'description' THEN wo.description ELSE wo.scope_description END,''),NEW.basis_excerpt)>0
      AND o.structured_data#>>'{work_order_resource,event_type}'='operation'
      AND o.structured_data#>>'{work_order_resource,work_order_id}'=NEW.work_order_id::text
      AND o.structured_data#>>'{work_order_resource,basis_excerpt}'=NEW.basis_excerpt
      AND o.structured_data#>>'{work_order_resource,basis_field}'=NEW.basis_field
      AND NEW.task_description=NEW.basis_excerpt) THEN
    RAISE EXCEPTION 'A sourced operation must match its current operation observation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_order_line_item_provenance_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER woli_provenance_guard BEFORE INSERT OR UPDATE ON public.work_order_line_items
  FOR EACH ROW EXECUTE FUNCTION public.work_order_line_item_provenance_guard();

CREATE OR REPLACE FUNCTION public.project_work_order_resource_observation(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  operation_id uuid;
  target_id uuid;
  event_type text;
  inserted_rows integer;
  required_kind text;
  basis_id uuid;
  basis_quote text;
  basis_clock timestamptz;
  spec_stage text;
  basis_text text;
  basis_values text[];
  part_status text;
BEGIN
  -- Fixed allowlisted projection only; the source is always read from the existing log.
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.source_id IS NULL THEN
    RAISE EXCEPTION 'Current attributed work_record source required';
  END IF;
  e := o.structured_data->'work_order_resource';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'work_order_resource version 1 envelope required';
  END IF;
  event_type := e->>'event_type';
  IF event_type IS NULL OR event_type NOT IN ('requirement','fulfillment','attestation','specification','operation') THEN
    RAISE EXCEPTION 'Unknown resource event type';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  -- Retained-source links are explicit, one-hop evidence, not inferred authorship.
  -- A legacy source may lack source_id; the new interpretation must still have it.
  IF event_type IN ('requirement','specification') THEN
    basis_id := (e->>'basis_observation_id')::uuid;
    basis_quote := e->>'basis_excerpt';
    basis_clock := o.observed_at;
  ELSIF event_type IN ('fulfillment','attestation') THEN
    SELECT r.basis_observation_id,r.basis_excerpt,s.observed_at
      INTO basis_id,basis_quote,basis_clock
      FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
      WHERE r.id=CASE WHEN event_type='fulfillment' THEN (e->>'requirement_id')::uuid
        ELSE (SELECT f.requirement_id FROM public.work_order_resource_fulfillments f WHERE f.id=(e->>'fulfillment_id')::uuid) END
      FOR SHARE OF r,s;
  END IF;
  IF num_nonnulls(basis_id,basis_quote)=1 THEN RAISE EXCEPTION 'Retained basis ID and excerpt must be paired'; END IF;
  IF basis_id IS NOT NULL THEN
    IF length(btrim(basis_quote)) NOT BETWEEN 1 AND 2000 OR basis_id=o.id THEN
      RAISE EXCEPTION 'Nonempty original-source excerpt required';
    END IF;
    PERFORM 1 FROM public.vehicle_observations b WHERE b.id=basis_id AND b.kind::text='work_record'
      AND b.is_superseded IS FALSE AND b.vehicle_id=w.vehicle_id AND b.observed_at=basis_clock
      AND NOT (COALESCE(b.structured_data,'{}'::jsonb) ? 'work_order_resource')
      AND strpos(b.content_text,basis_quote)>0 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current same-vehicle original basis, exact excerpt and original clock required'; END IF;
  END IF;
  -- Source IDs are idempotency keys. Replays still qualify every source and parent.
  IF event_type='requirement' THEN
    operation_id := (e->>'line_item_id')::uuid;
    PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    INSERT INTO public.work_order_resource_requirements(id,work_order_id,line_item_id,requirement_kind,description,quantity,unit,basis_observation_id,basis_excerpt)
      VALUES(o.id,w.id,operation_id,e->>'requirement_kind',e->>'description',(e->>'quantity')::numeric,e->>'unit',basis_id,basis_quote)
      ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='operation' THEN
    -- A requested scope item quoted from the work order itself; never priced, assigned or done here.
    basis_quote := e->>'basis_excerpt';
    basis_text := CASE e->>'basis_field' WHEN 'description' THEN w.description
      WHEN 'scope_description' THEN w.scope_description END;
    IF basis_text IS NULL OR basis_quote IS NULL OR length(btrim(basis_quote)) NOT BETWEEN 1 AND 500
      OR strpos(basis_text,basis_quote)=0 THEN
      RAISE EXCEPTION 'Exact excerpt of the work order scope text required';
    END IF;
    IF e->>'task_description' IS DISTINCT FROM basis_quote THEN
      RAISE EXCEPTION 'Operation text must be the quoted scope item';
    END IF;
    IF (e->>'line_number')::integer IS NULL OR (e->>'line_number')::integer < 1 THEN
      RAISE EXCEPTION 'Positive line number required';
    END IF;
    INSERT INTO public.work_order_line_items(id,work_order_id,line_number,task_type,task_description,status,notes,
      source_observation_id,basis_field,basis_excerpt)
      VALUES(o.id,w.id,(e->>'line_number')::integer,e->>'task_type',basis_quote,'pending',e->>'notes',
      o.id,e->>'basis_field',basis_quote) ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='specification' THEN
    spec_stage := e->>'specification_stage';
    operation_id := (e->>'line_item_id')::uuid;
    IF operation_id IS NOT NULL THEN
      PERFORM 1 FROM public.work_order_line_items WHERE id=operation_id AND work_order_id=w.id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
    END IF;
    IF num_nonnulls(basis_id,e->>'basis_component_event_id',e->>'basis_work_order_part_id')<>1 THEN
      RAISE EXCEPTION 'Exactly one specification basis required';
    END IF;
    IF basis_id IS NOT NULL THEN
      IF e ? 'basis_snapshot' THEN RAISE EXCEPTION 'A retained excerpt basis carries no record snapshot'; END IF;
      basis_text := lower(basis_quote);
      basis_values := ARRAY[basis_text];
    ELSIF e->>'basis_component_event_id' IS NOT NULL THEN
      SELECT ARRAY(SELECT lower(m.value) FROM jsonb_each_text(COALESCE(ce.metadata,'{}'::jsonb)) m WHERE m.value IS NOT NULL)
        INTO basis_values
        FROM public.component_events ce JOIN public.work_order_line_items li
          ON li.component_event_id=ce.id AND li.id=operation_id AND li.work_order_id=w.id
        WHERE ce.id=(e->>'basis_component_event_id')::uuid AND ce.work_order_id=w.id AND ce.vehicle_id=w.vehicle_id
          AND e->'basis_snapshot'=to_jsonb(ce)
        FOR SHARE OF ce,li;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-operation component event snapshot required'; END IF;
    ELSE
      SELECT lower(p.part_name),p.status INTO basis_text,part_status FROM public.work_order_parts p
        WHERE p.id=(e->>'basis_work_order_part_id')::uuid AND p.work_order_id=w.id
          AND e->'basis_snapshot'=to_jsonb(p) FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-work-order part snapshot required'; END IF;
      IF NOT ((spec_stage='supplied' AND part_status='installed') OR (spec_stage='proposed' AND part_status='quoted')) THEN
        RAISE EXCEPTION 'Part status does not support this specification stage';
      END IF;
      basis_values := ARRAY[basis_text];
    END IF;
    -- Event metadata labels match a whole recorded value; excerpts and part names contain them.
    IF (e->>'material_label' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(basis_values) v WHERE
          CASE WHEN e->>'basis_component_event_id' IS NOT NULL THEN v=lower(e->>'material_label')
          ELSE strpos(v,lower(e->>'material_label'))>0 END))
      OR (e->>'process_label' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(basis_values) v WHERE
          CASE WHEN e->>'basis_component_event_id' IS NOT NULL THEN v=lower(e->>'process_label')
          ELSE strpos(v,lower(e->>'process_label'))>0 END)) THEN
      RAISE EXCEPTION 'Specification labels must be quoted from their basis record';
    END IF;
    INSERT INTO public.work_order_resource_specifications(id,work_order_id,line_item_id,specification_stage,material_role,
      material_label,material_key,process_label,process_key,basis_observation_id,basis_excerpt,basis_component_event_id,basis_work_order_part_id)
      VALUES(o.id,w.id,operation_id,spec_stage,e->>'material_role',e->>'material_label',e->>'material_key',
      e->>'process_label',e->>'process_key',basis_id,basis_quote,(e->>'basis_component_event_id')::uuid,(e->>'basis_work_order_part_id')::uuid)
      ON CONFLICT(id) DO NOTHING;
  ELSIF event_type='fulfillment' THEN
    target_id := (e->>'requirement_id')::uuid;
    SELECT r.requirement_kind INTO required_kind
      FROM public.work_order_resource_requirements r JOIN public.vehicle_observations s ON s.id=r.id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE r.id=target_id AND r.work_order_id=w.id AND s.is_superseded IS FALSE AND s.vehicle_id=w.vehicle_id
      FOR SHARE OF r,s,li;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current requirement in the same work order required'; END IF;
    IF NOT ((required_kind='tool' AND num_nonnulls(e->>'user_tool_id',e->>'inventory_tool_id',e->>'equipment_id')=1)
      OR (required_kind='equipment' AND e->>'equipment_id' IS NOT NULL)
      OR (required_kind='facility' AND e->>'facility_organization_id' IS NOT NULL)
      OR (required_kind IN ('skill','inspection') AND e->>'performer_actor_id' IS NOT NULL)) THEN
      RAISE EXCEPTION 'Resource type does not satisfy this requirement kind';
    END IF;
    -- A retained assignment is custody evidence, not proof of capability or consent.
    IF e->>'basis_line_item_id' IS NOT NULL THEN
      PERFORM 1 FROM public.work_order_line_items li JOIN public.work_order_resource_requirements r
        ON r.line_item_id=li.id AND r.id=target_id AND r.work_order_id=w.id
        WHERE li.id=(e->>'basis_line_item_id')::uuid AND li.work_order_id=w.id
          AND li.actor_id=(e->>'performer_actor_id')::uuid
          AND e->'basis_line_item_snapshot'=to_jsonb(li) FOR SHARE OF li,r;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exact same-operation actor assignment snapshot required'; END IF;
    ELSIF e ? 'basis_line_item_snapshot' THEN
      RAISE EXCEPTION 'Assignment snapshot requires its typed line-item basis';
    END IF;
    INSERT INTO public.work_order_resource_fulfillments(id,work_order_id,requirement_id,supplier_user_id,supplier_organization_id,
      user_tool_id,inventory_tool_id,equipment_id,facility_organization_id,available_from,available_until,performer_actor_id,basis_line_item_id)
      VALUES(o.id,w.id,target_id,(e->>'supplier_user_id')::uuid,(e->>'supplier_organization_id')::uuid,
      (e->>'user_tool_id')::uuid,(e->>'inventory_tool_id')::uuid,(e->>'equipment_id')::uuid,(e->>'facility_organization_id')::uuid,
      (e->>'available_from')::timestamptz,(e->>'available_until')::timestamptz,
      (e->>'performer_actor_id')::uuid,(e->>'basis_line_item_id')::uuid) ON CONFLICT(id) DO NOTHING;
  ELSE
    target_id := (e->>'fulfillment_id')::uuid;
    PERFORM 1 FROM public.work_order_resource_fulfillments f
      JOIN public.vehicle_observations fs ON fs.id=f.id JOIN public.vehicle_observations rs ON rs.id=f.requirement_id
      JOIN public.work_order_resource_requirements r ON r.id=f.requirement_id
      JOIN public.work_order_line_items li ON li.id=r.line_item_id AND li.work_order_id=w.id
      WHERE f.id=target_id AND f.work_order_id=w.id AND fs.is_superseded IS FALSE AND rs.is_superseded IS FALSE
        AND fs.vehicle_id=w.vehicle_id AND rs.vehicle_id=w.vehicle_id
        AND (f.basis_line_item_id IS NULL OR (f.basis_line_item_id=li.id AND li.actor_id=f.performer_actor_id
          AND fs.structured_data#>'{work_order_resource,basis_line_item_snapshot}'=to_jsonb(li)))
      FOR SHARE OF f,fs,rs,r,li;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current fulfillment and requirement in the same work order required'; END IF;
    INSERT INTO public.work_order_resource_attestations(id,work_order_id,fulfillment_id,attestor_user_id,attestor_organization_id,
      attestation_kind,verdict,scope)
      VALUES(o.id,w.id,target_id,(e->>'attestor_user_id')::uuid,(e->>'attestor_organization_id')::uuid,
      e->>'attestation_kind',e->>'verdict',e->>'scope') ON CONFLICT(id) DO NOTHING;
  END IF;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN jsonb_build_object('id',o.id,'event_type',event_type,'duplicate',inserted_rows=0);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_resource_observation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_work_order_resource_observation(uuid) TO service_role;
COMMENT ON FUNCTION public.project_work_order_resource_observation(uuid) IS 'Service-only typed projection of an existing current work_record admitted through ingest-observation. Never inserts or changes testimony, permissions, bookings or payments.';

CREATE OR REPLACE FUNCTION public.read_work_order_job_path(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  r jsonb;
  n_ops integer; n_ops_req integer; n_ops_complete integer; n_events integer;
  n_ops_sourced integer; n_ops_pending integer; n_ops_withdrawn integer; n_ops_stale integer;
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
  plan := jsonb_build_object('state',CASE WHEN n_ops+n_parts+n_labor=0 THEN 'absent' ELSE 'partial' END,
    'operations',n_ops,'operations_with_requirements',n_ops_req,
    'operations_from_scope_text',n_ops_sourced,'operations_pending',n_ops_pending,
    'requirements',r#>'{coverage,recorded_requirements}','requirements_with_candidates',r#>'{coverage,requirements_with_candidates}',
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

NOTIFY pgrst, 'reload schema';
COMMIT;
