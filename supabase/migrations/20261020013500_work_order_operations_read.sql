-- Open reader of a job's current operations, so an accepted technician who is not the organization owner can quote per
-- operation (work_order_line_items RLS hides them), and work_order_quotes_read says which quote versions the viewer issued.
--   work_order_operations_read(p_work_order_id): operations (id, line number, task_type, status, description, requested_by_role,
--     requirements, specification material/process keys), scope-level specifications, parts and labor rows with their recorded
--     prices, each with the quote_ref issue_work_order_quote accepts (operation | requirement | part | labor; fee lines take no
--     ref). Every listed ref is in work_order_quote_scope_snapshot. Same gate as the other open readers (parties, or a public
--     vehicle), plus anyone who may issue a quote on the job. No people: requested_by is a role; personal text in descriptions
--     is withheld from non-parties as in the quote snapshot. No payments.
--   work_order_quotes_read: current_quote.issued_by_viewer and history[].issued_by_viewer; the private-vehicle gate also admits
--     anyone who may issue a quote on the job or has issued one (it already counts them as a party once inside). Three anchored edits.
-- Contract: supabase/sql/test_work_order_operations_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.work_order_operations_read(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  issuer text;
  party boolean;
  ctx text;
  r jsonb;
  providers uuid[];
  org_owners uuid[];
  ops jsonb;
  scope_specs jsonb;
  parts jsonb;
  labor jsonb;
  qs jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(uid, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  issuer := public.work_order_quote_issuer_role(uid, w.id);
  IF issuer = 'accepted_provider' THEN my_slots := array_append(my_slots, 'accepted_provider'); END IF;
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots) OR issuer IS NOT NULL;
  ctx := public.job_reader_context(my_slots);
  IF ctx = 'visitor' AND issuer IS NOT NULL THEN ctx := 'provider'; END IF;

  r := public.read_work_order_resources(w.id);
  providers := ARRAY(SELECT ap.account_id FROM public.work_order_accepted_providers(w.id) ap WHERE ap.account_id IS NOT NULL);
  org_owners := ARRAY(SELECT bo.owner_id FROM public.business_ownership bo
    WHERE w.organization_id IS NOT NULL AND bo.business_id = w.organization_id AND bo.status = 'active');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', li.id, 'line_number', li.line_number, 'task_type', li.task_type,
      'status', li.status, 'description', li.task_description,
      'description_basis', CASE WHEN li.source_observation_id IS NULL THEN 'unsourced_row' ELSE COALESCE(li.basis_field, 'source_observation') END,
      'requested_by_role', CASE WHEN s.id IS NULL THEN 'unknown'
        WHEN s.submitted_by_user_id IS NULL THEN CASE WHEN s.extraction_method = 'work_order_scope_operation_interpretation_v1'
          THEN 'scope_text_interpretation' ELSE 'source_record' END
        WHEN s.submitted_by_user_id = w.customer_id THEN 'customer'
        WHEN s.submitted_by_user_id = ANY (org_owners) THEN 'organization_owner'
        WHEN s.submitted_by_user_id = ANY (providers) THEN 'accepted_provider'
        WHEN s.extraction_method = 'work_order_offer_sign_v1' THEN 'offering_provider'
        ELSE 'other_account' END,
      'requested_by_basis', CASE WHEN s.submitted_by_user_id IS NOT NULL THEN 'authenticated_sign'
        WHEN s.id IS NOT NULL THEN 'source_without_sign' ELSE 'not_established' END,
      'requirements', (SELECT CASE WHEN party THEN x ELSE public.work_order_quote_redact(w.id, x, ARRAY['description']) END
        FROM (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q->'id', 'requirement_kind', q->'requirement_kind',
            'description', q->'description', 'quantity', q->'quantity', 'unit', q->'unit',
            'quote_ref', jsonb_build_object('ref_kind', 'requirement', 'ref_id', q->'id')) ORDER BY q->>'id'), '[]'::jsonb) x
          FROM jsonb_array_elements(COALESCE(r->'requirements', '[]'::jsonb)) q WHERE q->>'line_item_id' = li.id::text) rq),
      'specifications', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sp->'id', 'specification_stage', sp->'specification_stage',
          'material_role', sp->'material_role', 'material_key', sp->'material_key', 'process_key', sp->'process_key') ORDER BY sp->>'id'), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(r->'specifications', '[]'::jsonb)) sp WHERE sp->>'line_item_id' = li.id::text),
      'quote_ref', jsonb_build_object('ref_kind', 'operation', 'ref_id', li.id))
    ORDER BY li.line_number NULLS LAST, li.id), '[]'::jsonb)
  INTO ops
  FROM public.work_order_line_items li LEFT JOIN public.vehicle_observations s ON s.id = li.source_observation_id
  WHERE li.work_order_id = w.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sp->'id', 'specification_stage', sp->'specification_stage',
      'material_role', sp->'material_role', 'material_key', sp->'material_key', 'process_key', sp->'process_key') ORDER BY sp->>'id'), '[]'::jsonb)
  INTO scope_specs
  FROM jsonb_array_elements(COALESCE(r->'specifications', '[]'::jsonb)) sp WHERE sp->>'line_item_id' IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'part_name', p.part_name, 'part_number', p.part_number, 'brand', p.brand,
      'category', p.category, 'quantity', p.quantity, 'unit_price', p.unit_price, 'total_price', p.total_price, 'status', p.status,
      'job_op_code', p.job_op_code, 'is_comped', p.is_comped,
      'quote_ref', jsonb_build_object('ref_kind', 'part', 'ref_id', p.id)) ORDER BY p.id), '[]'::jsonb)
  INTO parts FROM public.work_order_parts p WHERE p.work_order_id = w.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'task_name', l.task_name, 'task_category', l.task_category,
      'job_op_code', l.job_op_code, 'hours', l.hours, 'hourly_rate', l.hourly_rate, 'total_cost', l.total_cost, 'status', l.status,
      'is_comped', l.is_comped,
      'quote_ref', jsonb_build_object('ref_kind', 'labor', 'ref_id', l.id)) ORDER BY l.id), '[]'::jsonb)
  INTO labor FROM public.work_order_labor l WHERE l.work_order_id = w.id;

  IF NOT party THEN
    ops := public.work_order_quote_redact(w.id, ops, ARRAY['description']);
    parts := public.work_order_quote_redact(w.id, parts, ARRAY['part_name', 'brand']);
    labor := public.work_order_quote_redact(w.id, labor, ARRAY['task_name']);
  END IF;
  IF issuer IS NOT NULL THEN qs := public.work_order_quote_state(w.id); END IF;

  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object(
    'work_order_id', w.id, 'as_of', statement_timestamp(), 'work_order_status', w.status,
    'operations', ops, 'scope_specifications', scope_specs, 'parts', parts, 'labor', labor,
    'quote_line_refs', jsonb_build_object('ref_kinds', jsonb_build_array('operation', 'requirement', 'part', 'labor', 'fee'),
      'fee', 'fee lines carry no ref_id',
      'basis', 'issue_work_order_quote accepts a ref_id only when it is in the work order scope at issue time; every quote_ref here is in that scope now'),
    'coverage', jsonb_build_object('operations', jsonb_array_length(ops), 'parts', jsonb_array_length(parts), 'labor', jsonb_array_length(labor),
      'prices', 'open; recorded line prices, not payments', 'party_money', 'not_returned_by_this_reader', 'customer_contact', 'never_returned'),
    'viewer', public.job_reader_viewer(ctx, my_slots, public.viewer_identity_bridge(uid), party)
      || jsonb_build_object('party', party, 'quote_issuer_role', issuer,
        'actions', CASE WHEN issuer IS NULL THEN '[]'::jsonb ELSE public.work_order_quote_issue_action(uid, w.id,
          (qs#>>'{current_quote,quote_id}')::uuid, qs#>>'{acceptance,state}', (qs#>>'{acceptance,quote_id}')::uuid) END),
    'people_basis', 'no people are returned; requested_by is a role',
    'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.work_order_operations_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_order_operations_read(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_order_operations_read(uuid) IS 'Open reader of a job''s current operations, requirements, specification keys, parts and labor with the quote_ref each accepts in issue_work_order_quote. No people, no payments.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.work_order_quotes_read(uuid)'::regprocedure);
  a1 constant text := $a$quote := public.work_order_quote_for_viewer(cur_id, party) || jsonb_build_object('scope_status',$a$;
  a2 constant text := $a$|| jsonb_build_object('observed_at', s.observed_at,$a$;
  a3 constant text := $a$IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN$a$;
BEGIN
  IF position('issued_by_viewer' IN def) > 0 THEN RAISE EXCEPTION 'work_order_quotes_read already carries issued_by_viewer'; END IF;
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'work_order_quotes_read current-quote anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'work_order_quotes_read history anchor not found once'; END IF;
  IF (length(def) - length(replace(def, a3, ''))) / length(a3) <> 1 THEN RAISE EXCEPTION 'work_order_quotes_read gate anchor not found once'; END IF;
  def := replace(def, a1, $r$quote := public.work_order_quote_for_viewer(cur_id, party) || jsonb_build_object('issued_by_viewer',
      viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_order_quotes iq WHERE iq.id = cur_id AND iq.quoting_user_id = viewer), 'scope_status',$r$);
  def := replace(def, a2, $r$|| jsonb_build_object('issued_by_viewer', viewer IS NOT NULL AND x.quoting_user_id IS NOT DISTINCT FROM viewer, 'observed_at', s.observed_at,$r$);
  def := replace(def, a3, $r$IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id)
    AND public.work_order_quote_issuer_role(viewer, w.id) IS NULL
    AND NOT (viewer IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_order_quotes gq WHERE gq.work_order_id = w.id AND gq.quoting_user_id = viewer)) THEN$r$);
  EXECUTE def;
END $apply$;
NOTIFY pgrst, 'reload schema';
COMMIT;
