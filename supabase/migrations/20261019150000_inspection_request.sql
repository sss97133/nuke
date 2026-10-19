-- Inspection as its own job (owner, 2026-10-19: "a guy can just be an inspector and drive over and inspect a vehicle").
-- Theory decision 5: a priced inspection is its own work_orders row (scope_category 'inspection') with an explicit
-- parent link, and stays a requirement on the parent; its findings become basis inputs to the parent plan. The
-- pre-purchase inspection (PPI) of a listing vehicle is the first paid job and runs on a vehicle the client does
-- not own.
--
--   * work_orders.parent_work_order_id links an inspection to the job it informs (null when the inspection is
--     ordered from a listing before any job exists; the vehicle is then the link). work_orders.request_observation_id
--     names the Sign observation that created the row. Both are set only at insert, together with a matching
--     inspection request observation, and are immutable afterwards, as is the vehicle of a requested inspection
--     (work_order_link_guard).
--   * request_source also allows 'ios'.
--   * request_inspection(p_vehicle_id, p_parent_work_order_id, p_scope) is the client's Sign. It writes one
--     owner-input work_record (the request: checklist, inspection type, listing URL) and, through
--     project_work_order_resource_observation, one 'inspect' operation quoting the job's own description and an
--     'inspection' requirement on it whose basis is the request. With p_scope.parent_line_item_id it also records
--     an 'inspection' requirement on that parent operation. p_scope accepts the buying-evidence --plan vehicle
--     entry (ppi_checklist) or {checklist}. The client becomes the work order customer.
--   * It grants no vehicle access and implies no seller permission: seller permission stays not_established until
--     an authenticated seller signs. No organization, inspector, price, schedule or payment is set.
-- Contract: supabase/sql/test_inspection_request.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_orders
  ADD COLUMN parent_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  ADD COLUMN request_observation_id uuid REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_orders_parent_not_self CHECK (parent_work_order_id IS DISTINCT FROM id);
CREATE INDEX work_orders_parent ON public.work_orders(parent_work_order_id) WHERE parent_work_order_id IS NOT NULL;
COMMENT ON COLUMN public.work_orders.parent_work_order_id IS 'Job this work order informs (an inspection of the same vehicle for a parent job). Set only at insert with its request observation; immutable. Null for an inspection ordered before any job exists.';
COMMENT ON COLUMN public.work_orders.request_observation_id IS 'Sign observation that created this work order (inspection request). Set only at insert; immutable.';

ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_request_source_check;
-- NOT VALID like the table's other checks: new and updated rows are checked; the 26 live rows (web, in_person,
-- 2026-10-19) already satisfy it.
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_request_source_check
  CHECK (request_source = ANY (ARRAY['web','sms','phone','email','in_person','ios'])) NOT VALID;

-- Definer so a client's own insert or update never needs read access to the observation log.
CREATE FUNCTION public.work_order_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.parent_work_order_id, NEW.request_observation_id) IS DISTINCT FROM (OLD.parent_work_order_id, OLD.request_observation_id)
      OR (OLD.request_observation_id IS NOT NULL AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id) THEN
      RAISE EXCEPTION 'Work order links, and the vehicle of a requested inspection, are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_work_order_id IS NULL AND NEW.request_observation_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_observations o
      WHERE o.id = NEW.request_observation_id AND o.kind::text = 'work_record' AND o.is_superseded IS FALSE
        AND o.vehicle_id = NEW.vehicle_id AND o.extraction_method = 'inspection_request_sign_v1'
        AND o.submitted_by_user_id IS NOT DISTINCT FROM NEW.customer_id
        AND o.structured_data#>>'{inspection_request,work_order_id}' = NEW.id::text
        AND o.structured_data#>>'{inspection_request,parent_work_order_id}' IS NOT DISTINCT FROM NEW.parent_work_order_id::text)
    OR NEW.scope_category IS DISTINCT FROM 'inspection'
    OR (NEW.parent_work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders p
      WHERE p.id = NEW.parent_work_order_id AND p.vehicle_id = NEW.vehicle_id)) THEN
    RAISE EXCEPTION 'A parent link needs the inspection request Sign for the same vehicle';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_order_link_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_order_link_guard BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.work_order_link_guard();

-- Normalized inspection checklist from a request scope (buying-evidence --plan ppi_checklist or {checklist}).
CREATE FUNCTION public.inspection_checklist_normalize(p_scope jsonb, p_inspection_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  raw jsonb := COALESCE(p_scope->'ppi_checklist', p_scope->'checklist', '[]'::jsonb);
  item jsonb;
  result jsonb := '[]'::jsonb;
  n integer := 0;
  sys text;
BEGIN
  IF jsonb_typeof(raw) IS DISTINCT FROM 'array' OR jsonb_array_length(raw) > 50 THEN
    RAISE EXCEPTION 'Checklist must be an array of at most 50 items' USING ERRCODE = '23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(raw) LOOP
    n := n + 1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'item_id') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'item_id')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(item->'question') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'question')) NOT BETWEEN 1 AND 500 OR position(E'\n' IN item->>'question') > 0
      OR (item ? 'claim_ids' AND jsonb_typeof(item->'claim_ids') NOT IN ('array','null'))
      OR (item ? 'linked_operation_ids' AND jsonb_typeof(item->'linked_operation_ids') NOT IN ('array','null')) THEN
      RAISE EXCEPTION 'Checklist item % needs an item_id and a one-line question', n USING ERRCODE = '23514';
    END IF;
    IF result @> jsonb_build_array(jsonb_build_object('item_id', item->>'item_id')) THEN
      RAISE EXCEPTION 'Duplicate checklist item_id %', item->>'item_id' USING ERRCODE = '23514';
    END IF;
    sys := COALESCE(item#>>'{finding,system}', item->>'system');
    IF sys IS NOT NULL AND sys NOT IN ('engine_bay','top_end','bottom_end','undercarriage','interior','wheels','drivetrain',
      'cooling','electrical','fuel','ignition','suspension','brakes','body','other') THEN sys := NULL; END IF;
    result := result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('item_id', item->>'item_id',
      'order', CASE WHEN jsonb_typeof(item->'order') = 'number' THEN item->'order' END,
      'basis', left(item->>'basis', 64), 'field', left(item->>'field', 64), 'claim_kind', left(item->>'claim_kind', 64),
      'claim_ids', item->'claim_ids', 'linked_operation_ids', item->'linked_operation_ids',
      'question', btrim(item->>'question'), 'system', sys)));
  END LOOP;
  IF n = 0 THEN
    result := jsonb_build_array(jsonb_build_object('item_id', 'inspection:general', 'basis', 'client_request',
      'question', 'General ' || replace(p_inspection_type, '_', ' ') || ' inspection of the vehicle'));
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.inspection_checklist_normalize(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.request_inspection(p_vehicle_id uuid, p_parent_work_order_id uuid DEFAULT NULL, p_scope jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  client uuid := auth.uid();
  signed timestamptz := now();
  scope jsonb := COALESCE(p_scope, '{}'::jsonb);
  itype text;
  channel text;
  listing_url text;
  parent_line uuid;
  checklist jsonb;
  n integer;
  title text;
  header text;
  body text;
  owner_source uuid;
  request_key text;
  existing public.work_orders%ROWTYPE;
  wo_id uuid := gen_random_uuid();
  req_id uuid;
  op_id uuid;
  requirement_id uuid;
  parent_requirement_id uuid;
BEGIN
  IF client IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(scope) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Scope must be an object' USING ERRCODE = '23514'; END IF;
  -- A listing vehicle is public; a private vehicle is only for the caller's own vehicles.
  IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.merged_into_vehicle_id IS NULL
      AND (v.is_public IS TRUE OR v.user_id = client OR v.owner_id = client OR v.uploaded_by = client
        OR public.vehicle_user_has_access(v.id, client))) THEN
    RAISE EXCEPTION 'Vehicle unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_parent_work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders p
      WHERE p.id = p_parent_work_order_id AND p.vehicle_id = p_vehicle_id AND p.customer_id = client
        AND p.scope_category IS DISTINCT FROM 'inspection') THEN
    RAISE EXCEPTION 'Parent work order unavailable' USING ERRCODE = '42501';
  END IF;
  itype := COALESCE(scope->>'inspection_type', 'pre_purchase');
  IF itype NOT IN ('pre_purchase','walk_around','photo_audit','post_work_qc','annual_check','incident_report','other') THEN
    RAISE EXCEPTION 'Unknown inspection_type' USING ERRCODE = '23514';
  END IF;
  channel := COALESCE(scope->>'request_source', 'web');
  IF channel NOT IN ('ios','web') THEN RAISE EXCEPTION 'request_source must be ios or web' USING ERRCODE = '23514'; END IF;
  listing_url := scope->>'listing_url';
  IF listing_url IS NOT NULL AND (listing_url !~ '^https?://' OR length(listing_url) > 2048) THEN
    RAISE EXCEPTION 'listing_url must be an http(s) URL' USING ERRCODE = '23514';
  END IF;
  parent_line := (scope->>'parent_line_item_id')::uuid;
  IF parent_line IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_order_line_items li
      WHERE li.id = parent_line AND li.work_order_id = p_parent_work_order_id) THEN
    RAISE EXCEPTION 'parent_line_item_id must be an operation of the parent work order' USING ERRCODE = '23514';
  END IF;
  checklist := public.inspection_checklist_normalize(scope, itype);
  n := jsonb_array_length(checklist);
  title := CASE itype WHEN 'pre_purchase' THEN 'Pre-purchase inspection'
    ELSE initcap(replace(itype, '_', ' ')) || ' inspection' END;
  header := format('%s: %s checklist item%s', title, n, CASE WHEN n = 1 THEN '' ELSE 's' END);
  body := header || E'\n' || (SELECT string_agg('- ' || (i->>'question'), E'\n' ORDER BY ord) FROM jsonb_array_elements(checklist) WITH ORDINALITY t(i, ord));

  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('inspection-request', client, p_vehicle_id, p_parent_work_order_id, itype, channel,
    listing_url, parent_line, checklist)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('inspection_request:'||client::text||':'||p_vehicle_id::text, 0));
  SELECT w.* INTO existing FROM public.vehicle_observations o JOIN public.work_orders w ON w.request_observation_id = o.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'inspection_request:'||p_vehicle_id::text||':'||client::text
      AND o.kind = 'work_record' AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('work_order_id', existing.id, 'request_observation_id', existing.request_observation_id,
      'duplicate', true, 'vehicle_access_granted', false, 'seller_permission', 'not_established', 'payment_authorized', false);
  END IF;

  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis,
    source_event_at, source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id,
    observer_raw, extraction_method, confidence, confidence_score)
  VALUES (p_vehicle_id, owner_source, 'inspection_request:'||p_vehicle_id::text||':'||client::text, signed, 'event_time', signed,
    'exact', 'work_record', body, request_key,
    jsonb_build_object('inspection_request', jsonb_build_object('version', 1, 'work_order_id', wo_id,
      'parent_work_order_id', p_parent_work_order_id, 'inspection_type', itype, 'request_source', channel,
      'listing_url', listing_url, 'parent_line_item_id', parent_line, 'checklist', checklist,
      'vehicle_access_granted', false, 'seller_permission', 'not_established')),
    client, jsonb_build_object('user_id', client, 'intake_actor', 'account'), 'inspection_request_sign_v1', 'high', 0.95)
  RETURNING id INTO req_id;

  INSERT INTO public.work_orders(id, vehicle_id, customer_id, request_source, title, description, scope_category, status,
    parent_work_order_id, request_observation_id)
  VALUES (wo_id, p_vehicle_id, client, channel, title, body, 'inspection', 'pending', p_parent_work_order_id, req_id);

  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text,
    content_hash, structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
  VALUES (p_vehicle_id, owner_source, 'inspection_operation:'||wo_id::text, signed, 'work_record', header, md5('op:'||req_id::text),
    jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'operation', 'work_order_id', wo_id,
      'line_number', 1, 'task_type', 'inspect', 'task_description', header, 'basis_field', 'description', 'basis_excerpt', header,
      'notes', 'Inspection requested by the client')),
    client, 'inspection_request_sign_v1', 'high', 0.95)
  RETURNING id INTO op_id;
  PERFORM public.project_work_order_resource_observation(op_id);

  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text,
    content_hash, structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
  VALUES (p_vehicle_id, owner_source, 'inspection_requirement:'||wo_id::text, signed, 'work_record', header, md5('req:'||req_id::text),
    jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement', 'work_order_id', wo_id,
      'line_item_id', op_id, 'requirement_kind', 'inspection', 'description', format('Inspect the vehicle against the %s', lower(substr(header, length(title) + 3))),
      'quantity', NULL, 'unit', NULL, 'basis_observation_id', req_id, 'basis_excerpt', header)),
    client, 'inspection_request_sign_v1', 'high', 0.95)
  RETURNING id INTO requirement_id;
  PERFORM public.project_work_order_resource_observation(requirement_id);

  IF parent_line IS NOT NULL THEN
    INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text,
      content_hash, structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
    VALUES (p_vehicle_id, owner_source, 'inspection_parent_requirement:'||wo_id::text, signed, 'work_record', header,
      md5('parent-req:'||req_id::text),
      jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement',
        'work_order_id', p_parent_work_order_id, 'line_item_id', parent_line, 'requirement_kind', 'inspection',
        'description', format('%s (inspection work order %s)', title, wo_id), 'quantity', NULL, 'unit', NULL,
        'basis_observation_id', req_id, 'basis_excerpt', header)),
      client, 'inspection_request_sign_v1', 'high', 0.95)
    RETURNING id INTO parent_requirement_id;
    PERFORM public.project_work_order_resource_observation(parent_requirement_id);
  END IF;

  RETURN jsonb_build_object('work_order_id', wo_id, 'request_observation_id', req_id, 'title', title,
    'inspection_type', itype, 'request_source', channel, 'checklist_items', n, 'operation_id', op_id,
    'requirement_id', requirement_id, 'parent_work_order_id', p_parent_work_order_id,
    'parent_requirement_id', parent_requirement_id, 'requested_at', signed, 'duplicate', false,
    'vehicle_access_granted', false, 'seller_permission', 'not_established', 'payment_authorized', false);
END $$;
REVOKE ALL ON FUNCTION public.request_inspection(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_inspection(uuid,uuid,jsonb) TO authenticated;
COMMENT ON FUNCTION public.request_inspection(uuid,uuid,jsonb) IS 'Sign: an authenticated client orders an inspection (default pre_purchase) of a public vehicle or one they can access, optionally for one of their own work orders. Creates the inspection work order (customer = auth.uid(), scope_category inspection) with its request observation, an inspect operation and an inspection requirement through the projector; optionally an inspection requirement on a named parent operation. Grants no vehicle access, implies no seller permission, sets no price, inspector or payment.';

NOTIFY pgrst, 'reload schema';
COMMIT;
