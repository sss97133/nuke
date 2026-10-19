-- A client posts a job (QUOTE lane RSI pass 8; owner intake vision: a client onboards a profile and a vehicle, submits
-- pictures and a description, and the platform works out what the job requires with a suggested cost before booking).
-- Until now no Sign created a job: operations came from a shop's scope text and requirements only from retained
-- interpretations or request_inspection.
--
--   * post_work_request(p_vehicle_id, p_description, p_image_ids, p_requested_operations, p_needed_by, p_visibility): the
--     client's Sign, for a vehicle they own or hold access to (vehicles.user_id / owner_id / uploaded_by, or
--     vehicle_user_has_access). Never for someone else's vehicle: that is request_inspection. It writes one owner-input
--     work_record (the request; content_text = the client's words verbatim) and creates the work order: customer =
--     auth.uid(), scope_description = the client's words verbatim, request_source 'ios' when the PostgREST client header
--     names the Swift SDK, otherwise 'web', request_observation_id = the request, request_visibility = p_visibility.
--     Operations are client-stated items quoted verbatim from the description (p_requested_operations: exact excerpts,
--     optionally {text, task_type}; otherwise its sentences), projected through the existing scope-operation event
--     (basis_field scope_description). Requirements per operation come from a reviewed template keyed to the listing
--     plan's keyword-table entries (work_request_requirement_template); an operation with no template entry gets one
--     skill requirement in the client's words. Each requirement cites the request as its retained basis.
--   * Images: the client's own eligible photos of the vehicle are attached as intake evidence through attach_job_evidence
--     (its refusals apply: personal, sensitive, misattributed, superseded or someone else's photos are refused). Existing
--     analyses of those images are cited with their method and confidence; nothing new is analysed.
--   * Suggested cost: only existing reference data. Reference hours from labor_operations / stage_transition_labor_map
--     through the reviewed keyword table (listing_plan_resolve_target, seed_uncalibrated) times resolve_labor_rate() exactly
--     as returned (labelled placeholder unless its source is contract, user or organization). Not a quote; no paid
--     inference.
--   * Visibility: 'open' lists the requirements in open_requirements_read (public vehicles only, as before); 'invite_only'
--     keeps them out of the open list (one anchored filter in the backend reader; the job is still a normal work order).
--   * Descriptions with contact details or the client's own name are refused (contact is brokered).
--   work_order_link_guard accepts this request observation as the creating Sign (parent link stays inspection-only);
--   request_visibility is set only at insert with it and is immutable afterwards.
-- No price, provider, schedule, notification or payment. Contract: supabase/sql/test_post_work_request.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.work_orders ADD COLUMN request_visibility text CHECK (request_visibility IN ('open','invite_only'));
COMMENT ON COLUMN public.work_orders.request_visibility IS 'Set by post_work_request only: open (requirements listed in open_requirements_read on public vehicles) or invite_only (not listed). Null for other work orders (listed as before). Immutable.';

CREATE OR REPLACE FUNCTION public.work_order_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.parent_work_order_id, NEW.request_observation_id, NEW.request_visibility)
        IS DISTINCT FROM (OLD.parent_work_order_id, OLD.request_observation_id, OLD.request_visibility)
      OR (OLD.request_observation_id IS NOT NULL AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id) THEN
      RAISE EXCEPTION 'Work order links, visibility, and the vehicle of a requested job, are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_work_order_id IS NULL AND NEW.request_observation_id IS NULL AND NEW.request_visibility IS NULL THEN RETURN NEW; END IF;
  -- A client's work request (post_work_request): no parent link, not an inspection.
  IF NEW.parent_work_order_id IS NULL AND NEW.request_observation_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicle_observations o
      WHERE o.id = NEW.request_observation_id AND o.kind::text = 'work_record' AND o.is_superseded IS FALSE
        AND o.vehicle_id = NEW.vehicle_id AND o.extraction_method = 'work_request_sign_v1'
        AND o.submitted_by_user_id IS NOT DISTINCT FROM NEW.customer_id
        AND o.structured_data#>>'{work_request,work_order_id}' = NEW.id::text
        AND o.structured_data#>>'{work_request,visibility}' IS NOT DISTINCT FROM NEW.request_visibility)
    AND NEW.scope_category IS DISTINCT FROM 'inspection' AND NEW.request_visibility IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.request_visibility IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.vehicle_observations o
      WHERE o.id = NEW.request_observation_id AND o.kind::text = 'work_record' AND o.is_superseded IS FALSE
        AND o.vehicle_id = NEW.vehicle_id AND o.extraction_method = 'inspection_request_sign_v1'
        AND o.submitted_by_user_id IS NOT DISTINCT FROM NEW.customer_id
        AND o.structured_data#>>'{inspection_request,work_order_id}' = NEW.id::text
        AND o.structured_data#>>'{inspection_request,parent_work_order_id}' IS NOT DISTINCT FROM NEW.parent_work_order_id::text)
    OR NEW.scope_category IS DISTINCT FROM 'inspection'
    OR (NEW.parent_work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders p
      WHERE p.id = NEW.parent_work_order_id AND p.vehicle_id = NEW.vehicle_id)) THEN
    RAISE EXCEPTION 'A parent link needs the inspection request Sign for the same vehicle; visibility needs the work request Sign';
  END IF;
  RETURN NEW;
END $$;

-- Reviewed requirement template keyed to listing_plan_keyword_table() entry ids. A match proposes what the job needs,
-- for providers to offer against; it is not a diagnosis.
CREATE FUNCTION public.work_request_requirement_template() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS
$t$ SELECT $json${"schema_version":"work_request_requirements_v1","reviewed_at":"2026-10-19","review_state":"operator_reviewed_pending_owner_review",
"keyed_to":"listing_plan_keyword_table entries","note":"What a client-stated operation needs, as open requirements providers can offer against. Not a diagnosis, price or assignment. Extend only from reviewed misses.",
"entries":{
 "dent":[{"kind":"skill","description":"Dent repair (paintless or conventional)"}],
 "rust_body":[{"kind":"skill","description":"Rust repair and panel welding"},{"kind":"tool","description":"MIG welder"},{"kind":"facility","description":"Body shop bay"}],
 "paint_refinish":[{"kind":"skill","description":"Automotive paint refinishing"},{"kind":"facility","description":"Paint booth"}],
 "bumper":[{"kind":"skill","description":"Bumper removal and installation"}],
 "exhaust":[{"kind":"skill","description":"Exhaust repair and fabrication"},{"kind":"facility","description":"Vehicle lift"}],
 "brakes":[{"kind":"skill","description":"Brake service"},{"kind":"facility","description":"Vehicle lift"}],
 "parking_brake":[{"kind":"skill","description":"Parking brake service"}],
 "seat_upholstery":[{"kind":"skill","description":"Automotive upholstery"}],
 "carpet":[{"kind":"skill","description":"Automotive interior trim"}],
 "headliner":[{"kind":"skill","description":"Automotive interior trim"}],
 "dash":[{"kind":"skill","description":"Automotive interior trim"}],
 "windshield":[{"kind":"skill","description":"Auto glass installation"}],
 "cooling":[{"kind":"skill","description":"Cooling system service"}],
 "gauges":[{"kind":"skill","description":"Automotive electrical diagnosis and repair"}],
 "wiring_repair":[{"kind":"skill","description":"Automotive electrical diagnosis and repair"}],
 "lights":[{"kind":"skill","description":"Automotive electrical diagnosis and repair"}],
 "transmission":[{"kind":"skill","description":"Transmission and drivetrain service"},{"kind":"facility","description":"Vehicle lift"}],
 "tailshaft_seal":[{"kind":"skill","description":"Transmission and drivetrain service"},{"kind":"facility","description":"Vehicle lift"}],
 "engine_health":[{"kind":"inspection","description":"Diagnose the engine condition before repair"},{"kind":"skill","description":"Engine diagnosis and repair"}],
 "front_suspension":[{"kind":"skill","description":"Suspension and steering service"},{"kind":"facility","description":"Vehicle lift"}],
 "trim_exterior":[{"kind":"skill","description":"Exterior trim installation"}]}}$json$::jsonb $t$;
REVOKE ALL ON FUNCTION public.work_request_requirement_template() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.work_request_requirement_template() IS 'Reviewed requirement template (operator reviewed, pending owner review) keyed to listing_plan_keyword_table entry ids; post_work_request uses it for client-stated operations.';

CREATE FUNCTION public.post_work_request(p_vehicle_id uuid, p_description text, p_image_ids uuid[] DEFAULT NULL,
  p_requested_operations jsonb DEFAULT NULL, p_needed_by timestamptz DEFAULT NULL, p_visibility text DEFAULT 'open')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  client uuid := auth.uid();
  signed timestamptz := now();
  v public.vehicles%ROWTYPE;
  descr text := p_description;
  kw jsonb := public.listing_plan_keyword_table();
  tmpl jsonb := public.work_request_requirement_template()->'entries';
  ops jsonb := '[]'::jsonb;
  item jsonb;
  t text;
  tt text;
  channel text;
  owner_source uuid;
  request_key text;
  existing public.work_orders%ROWTYPE;
  wo_id uuid := gen_random_uuid();
  req_id uuid;
  op_id uuid;
  rq_id uuid;
  entry jsonb;
  matched jsonb;
  rq jsonb;
  op_out jsonb := '[]'::jsonb;
  req_out jsonb := '[]'::jsonb;
  est jsonb := '[]'::jsonb;
  targets jsonb;
  rate jsonb := public.resolve_labor_rate();
  rate_value numeric;
  analyses jsonb := '[]'::jsonb;
  att jsonb;
  i integer := 0;
  lo numeric; hi numeric;
BEGIN
  IF client IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.vehicles WHERE id = p_vehicle_id AND merged_into_vehicle_id IS NULL;
  IF v.id IS NULL OR (v.user_id = client OR v.owner_id = client OR v.uploaded_by = client
      OR public.vehicle_user_has_access(v.id, client)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Vehicle unavailable: post a job for your own vehicle; for a vehicle you do not own, order an inspection (request_inspection)'
      USING ERRCODE = '42501';
  END IF;
  IF descr IS NULL OR length(btrim(descr)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Describe the work (1 to 4000 characters)' USING ERRCODE = '23514';
  END IF;
  IF descr ~ '(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})' THEN
    RAISE EXCEPTION 'Remove contact details from the description; contact goes through Nuke' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_visibility, '') NOT IN ('open','invite_only') THEN
    RAISE EXCEPTION 'Visibility must be open or invite_only' USING ERRCODE = '23514';
  END IF;
  IF p_needed_by IS NOT NULL AND p_needed_by <= signed THEN
    RAISE EXCEPTION 'needed_by must be in the future' USING ERRCODE = '23514';
  END IF;
  IF p_image_ids IS NOT NULL AND cardinality(p_image_ids) > 50 THEN
    RAISE EXCEPTION 'At most 50 images' USING ERRCODE = '23514';
  END IF;

  -- Client-stated operations, each an exact excerpt of the description.
  IF p_requested_operations IS NULL THEN
    FOR t IN SELECT btrim(s.quote, E' \t\r\n-*•') FROM public.listing_plan_sentences(descr) s ORDER BY s.ord LOOP
      CONTINUE WHEN t = '';
      ops := ops || jsonb_build_array(jsonb_build_object('text', left(t, 500), 'task_type', 'other'));
    END LOOP;
  ELSE
    IF jsonb_typeof(p_requested_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_requested_operations) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'Requested operations must be an array of 1 to 20 items' USING ERRCODE = '23514';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_requested_operations) LOOP
      t := CASE jsonb_typeof(item) WHEN 'string' THEN item #>> '{}' WHEN 'object' THEN item->>'text' END;
      tt := CASE WHEN jsonb_typeof(item) = 'object' THEN COALESCE(item->>'task_type', 'other') ELSE 'other' END;
      IF t IS NULL OR length(btrim(t)) NOT BETWEEN 1 AND 500 OR strpos(descr, t) = 0
        OR (jsonb_typeof(item) = 'object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('text','task_type')))
        OR tt NOT IN ('replace','inspect','install','clean','paint','adjust','other') THEN
        RAISE EXCEPTION 'Each requested operation must quote the description exactly (1 to 500 characters), with an optional known task_type: %', item
          USING ERRCODE = '23514';
      END IF;
      ops := ops || jsonb_build_array(jsonb_build_object('text', t, 'task_type', tt));
    END LOOP;
  END IF;
  IF jsonb_array_length(ops) = 0 OR jsonb_array_length(ops) > 20 THEN
    RAISE EXCEPTION 'The description must state 1 to 20 operations' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT x->>'text') FROM jsonb_array_elements(ops) x) <> jsonb_array_length(ops) THEN
    RAISE EXCEPTION 'Requested operations must be distinct' USING ERRCODE = '23514';
  END IF;

  -- Template requirements and reference hours per operation.
  rate_value := CASE WHEN jsonb_typeof(rate->'rate') = 'number' THEN (rate->>'rate')::numeric END;
  FOR i IN 0 .. jsonb_array_length(ops) - 1 LOOP
    t := ops->i->>'text';
    matched := '[]'::jsonb;
    FOR entry IN SELECT value FROM jsonb_array_elements(kw->'entries') LOOP
      CONTINUE WHEN NOT (t ~* public.listing_plan_re(entry->>'pattern'));
      CONTINUE WHEN entry ? 'requires' AND NOT (t ~* public.listing_plan_re(entry->>'requires'));
      CONTINUE WHEN entry ? 'exclude' AND t ~* public.listing_plan_re(entry->>'exclude');
      matched := matched || jsonb_build_array(entry);
    END LOOP;
    ops := jsonb_set(ops, ARRAY[i::text, 'keyword_entry_ids'], COALESCE((SELECT jsonb_agg(m->>'id') FROM jsonb_array_elements(matched) m), '[]'::jsonb));
    ops := jsonb_set(ops, ARRAY[i::text, 'requirements'], COALESCE((SELECT jsonb_agg(DISTINCT r) FROM jsonb_array_elements(matched) m,
      jsonb_array_elements(COALESCE(tmpl->(m->>'id'), '[]'::jsonb)) r), '[]'::jsonb));
    IF jsonb_array_length(ops->i->'requirements') = 0 THEN
      ops := jsonb_set(ops, ARRAY[i::text, 'requirements'], jsonb_build_array(jsonb_build_object('kind', 'skill', 'description', t, 'basis', 'client_description')));
    END IF;
    targets := COALESCE((SELECT jsonb_agg(public.listing_plan_resolve_target(tg, v.year)) FROM jsonb_array_elements(matched) m,
      jsonb_array_elements(m->'targets') tg), '[]'::jsonb);
    SELECT min(COALESCE((x#>>'{hours,min}')::numeric, (x#>>'{hours,typical}')::numeric)),
        max(COALESCE((x#>>'{hours,max}')::numeric, (x#>>'{hours,typical}')::numeric))
      INTO lo, hi FROM jsonb_array_elements(targets) x WHERE x->>'state' = 'resolved';
    est := est || jsonb_build_array(jsonb_build_object('line_number', i + 1, 'text', t, 'keyword_entry_ids', ops->i->'keyword_entry_ids',
      'reference_targets', targets, 'hours', CASE WHEN lo IS NOT NULL THEN jsonb_build_object('low', lo, 'high', hi) END,
      'cost', CASE WHEN lo IS NOT NULL AND rate_value IS NOT NULL THEN jsonb_build_object('low', round(lo * rate_value, 2), 'high', round(hi * rate_value, 2)) END,
      'state', CASE WHEN jsonb_array_length(matched) = 0 THEN 'no_reference_match' WHEN lo IS NULL THEN 'reference_rows_absent' ELSE 'estimated' END));
  END LOOP;

  -- Existing analyses of the submitted images, cited only.
  IF p_image_ids IS NOT NULL AND cardinality(p_image_ids) > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('observation_id', o.id, 'image_id', o.structured_data->>'image_id',
        'analysis_kind', o.structured_data->>'analysis_kind', 'extraction_method', o.extraction_method,
        'confidence_score', o.confidence_score, 'observed_at', o.observed_at) ORDER BY o.observed_at, o.id), '[]'::jsonb)
      INTO analyses FROM public.vehicle_observations o
      WHERE (o.structured_data->>'image_id') = ANY (ARRAY(SELECT x::text FROM unnest(p_image_ids) x))
        AND o.vehicle_id = v.id AND o.is_superseded IS FALSE AND o.structured_data ? 'analysis_kind';
  END IF;

  channel := CASE WHEN COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-client-info' ILIKE 'supabase-swift%'
    THEN 'ios' ELSE 'web' END;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-request', client, v.id, descr, ops, p_image_ids, p_needed_by, p_visibility)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('work_request:'||client::text||':'||v.id::text, 0));
  SELECT w.* INTO existing FROM public.vehicle_observations o JOIN public.work_orders w ON w.request_observation_id = o.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'work_request:'||v.id::text||':'||client::text
      AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('work_order_id', existing.id, 'request_observation_id', existing.request_observation_id, 'duplicate', true,
      'payment_authorized', false, 'providers_notified', false);
  END IF;

  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score)
  VALUES (v.id, owner_source, 'work_request:'||v.id::text||':'||client::text, signed, 'event_time', signed, 'exact', 'work_record',
    descr, request_key,
    jsonb_build_object('work_request', jsonb_build_object('version', 1, 'work_order_id', wo_id, 'request_source', channel,
      'visibility', p_visibility, 'needed_by', p_needed_by, 'operations', ops, 'image_ids', to_jsonb(COALESCE(p_image_ids, '{}'::uuid[])),
      'image_analyses_cited', analyses, 'suggested_cost', jsonb_build_object('lines', est, 'rate', rate))),
    client, jsonb_build_object('user_id', client, 'intake_actor', 'account'), 'work_request_sign_v1', 'high', 0.95)
  RETURNING id INTO req_id;

  INSERT INTO public.work_orders(id, vehicle_id, customer_id, request_source, title, scope_description, status,
    request_observation_id, request_visibility)
  VALUES (wo_id, v.id, client, channel, left(ops->0->>'text', 120), descr, 'pending', req_id, p_visibility);
  IF public.work_order_text_is_personal(wo_id, descr) THEN
    RAISE EXCEPTION 'Remove names and contact details from the description; contact goes through Nuke' USING ERRCODE = '23514';
  END IF;

  FOR i IN 0 .. jsonb_array_length(ops) - 1 LOOP
    t := ops->i->>'text';
    INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text, content_hash,
      structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
    VALUES (v.id, owner_source, 'work_request_operation:'||wo_id::text, signed, 'work_record', t, md5(req_id::text||':op:'||i),
      jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'operation', 'work_order_id', wo_id,
        'line_number', i + 1, 'task_type', ops->i->>'task_type', 'task_description', t, 'basis_field', 'scope_description',
        'basis_excerpt', t, 'notes', 'Client-stated in the work request')),
      client, 'work_request_sign_v1', 'high', 0.95)
    RETURNING id INTO op_id;
    PERFORM public.project_work_order_resource_observation(op_id);
    op_out := op_out || jsonb_build_array(jsonb_build_object('line_item_id', op_id, 'line_number', i + 1, 'text', t,
      'task_type', ops->i->>'task_type', 'basis', 'client_stated', 'keyword_entry_ids', ops->i->'keyword_entry_ids'));
    FOR rq IN SELECT value FROM jsonb_array_elements(ops->i->'requirements') LOOP
      INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text, content_hash,
        structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
      VALUES (v.id, owner_source, 'work_request_requirement:'||wo_id::text, signed, 'work_record', rq->>'description',
        md5(req_id::text||':req:'||i||':'||(rq->>'kind')||':'||(rq->>'description')),
        jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement', 'work_order_id', wo_id,
          'line_item_id', op_id, 'requirement_kind', rq->>'kind', 'description', rq->>'description', 'quantity', NULL, 'unit', NULL,
          'basis_observation_id', req_id, 'basis_excerpt', t)),
        client, 'work_request_sign_v1', 'high', 0.95)
      RETURNING id INTO rq_id;
      PERFORM public.project_work_order_resource_observation(rq_id);
      req_out := req_out || jsonb_build_array(jsonb_build_object('requirement_id', rq_id, 'line_item_id', op_id, 'kind', rq->>'kind',
        'description', rq->>'description', 'basis', COALESCE(rq->>'basis', 'reviewed_template')));
    END LOOP;
  END LOOP;

  IF p_image_ids IS NOT NULL AND cardinality(p_image_ids) > 0 THEN
    att := public.attach_job_evidence(wo_id, p_image_ids, NULL, 'Intake photos submitted with the work request');
  END IF;

  RETURN jsonb_build_object('work_order_id', wo_id, 'request_observation_id', req_id, 'requested_at', signed,
    'request_source', channel, 'request_source_basis', 'x-client-info header names the Swift SDK -> ios; otherwise web',
    'visibility', p_visibility,
    'listed_in_open_requirements', p_visibility = 'open' AND v.is_public IS TRUE,
    'listing_basis', CASE WHEN p_visibility = 'invite_only' THEN 'invite_only' WHEN v.is_public IS TRUE THEN 'open_public_vehicle'
      ELSE 'vehicle_not_public' END,
    'needed_by', p_needed_by, 'operations', op_out, 'requirements', req_out,
    'intake_evidence', CASE WHEN att IS NULL THEN NULL ELSE jsonb_build_object('attachment_id', att->'attachment_id', 'image_count', att->'image_count') END,
    'image_analyses_cited', analyses,
    'suggested_cost', jsonb_build_object('lines', est,
      'total', CASE WHEN rate_value IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(est) e WHERE e->>'state' = 'estimated')
        THEN jsonb_build_object('low', (SELECT sum((e#>>'{cost,low}')::numeric) FROM jsonb_array_elements(est) e WHERE e->>'state' = 'estimated'),
          'high', (SELECT sum((e#>>'{cost,high}')::numeric) FROM jsonb_array_elements(est) e WHERE e->>'state' = 'estimated'),
          'lines_estimated', (SELECT count(*) FROM jsonb_array_elements(est) e WHERE e->>'state' = 'estimated'), 'lines', jsonb_array_length(est)) END,
      'rate', rate, 'rate_label', CASE WHEN rate->>'source' IN ('contract','user','organization') THEN 'reported_rate' ELSE 'placeholder' END,
      'currency', NULL, 'currency_basis', 'resolve_labor_rate returns no currency',
      'hours_label', 'seed_uncalibrated',
      'basis', 'reference hours (labor_operations / stage_transition_labor_map via the reviewed keyword table) times resolve_labor_rate() as returned; not a quote, no image analysis, no paid inference'),
    'duplicate', false, 'payment_authorized', false, 'providers_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text) TO authenticated;
COMMENT ON FUNCTION public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text) IS 'Sign: a client posts a job on their own vehicle (owner/uploader/access holder): work order with their words as scope, client-stated operations quoting them, template requirements (or one skill requirement in their words), their own eligible photos attached as intake evidence, existing image analyses cited, and a labelled reference-hours x rate suggested cost. open lists the requirements publicly (public vehicles); invite_only does not. No price, provider, schedule or payment.';

-- Backend open_requirements_read: invite-only work requests stay out of the open list (anchored, each anchor once).
DO $$
DECLARE
  def text := pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure);
  a1 text := $a$WHERE COALESCE(w.status, 'pending') NOT IN ('completed','paid','cancelled','rejected')$a$;
  a2 text := $a$'rule', 'current requirement; work order not completed, paid, cancelled or rejected; public vehicle (no marketplace flag exists)'$a$;
BEGIN
  IF (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 OR (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'open_requirements_read anchors not found exactly once';
  END IF;
  def := replace(def, a1, a1 || $r$ AND w.request_visibility IS DISTINCT FROM 'invite_only'$r$);
  def := replace(def, a2, $r$'rule', 'current requirement; work order not completed, paid, cancelled or rejected; public vehicle; not an invite_only work request'$r$);
  EXECUTE def;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
