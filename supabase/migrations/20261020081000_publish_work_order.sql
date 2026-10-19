-- Publish an existing job as an open (or invite-only) request: the customer's or vehicle owner's Sign.
--
-- On 2026-10-19 the platform listed 2 open requirements; the owner's open work orders on his own vehicles had operations
-- but no requirements, or no operations at all. post_work_request covers new jobs only and request_visibility was
-- immutable. This adds, for jobs that already exist:
--   publish_work_order(p_work_order_id, p_visibility 'open'|'invite_only') (authenticated Sign): the work order's customer
--     or a person with access to its vehicle (post_work_request's rule). Refuses closed jobs and inspection jobs. Records a
--     work_record publication observation (the Sign), then, never inventing scope:
--       - a job with no operations gets operations quoting its own description sentence by sentence (the sanctioned
--         operation path: admitted observation + project_work_order_resource_observation, basis_field 'description'),
--         unless that text holds names or contact details (then none, reported);
--       - every open operation (pending, in progress, rework) without a requirement gets the reviewed template
--         requirements matching its text (listing_plan_keyword_table + work_request_requirement_template, as
--         post_work_request), or one skill requirement quoting the operation verbatim; operations whose text holds names
--         or contact details are skipped and reported;
--       - request_visibility is set, which open_requirements_read already honours ('invite_only' is not listed).
--     'open' is refused when the job's title, description or scope holds names or contact details.
--   unpublish_work_order(p_work_order_id): same party; records the Sign and sets invite_only. Requirements stay (needs
--     are testimony); they are simply not listed.
--   work_order_link_guard: visibility alone may now change when a publication Sign for that work order was admitted in the
--     same transaction; every other rule is unchanged.
-- No money, notification, assignment or status change. Contract: supabase/sql/test_publish_work_order.sql (PG17, on the
-- post_work_request chain).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc WHERE oid = 'public.work_order_link_guard()'::regprocedure)
      IS DISTINCT FROM 'sw5ns41s+AZKW/crGW4i12Qbr6bHqaSq3QgRJait9Pw=' THEN
    RAISE EXCEPTION 'work_order_link_guard differs from the reviewed definition';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.work_order_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Visibility alone may change through publish_work_order / unpublish_work_order: their Sign observation for this work order,
    -- admitted in this same transaction, states the new visibility.
    IF NEW.request_visibility IS DISTINCT FROM OLD.request_visibility AND NEW.request_visibility IS NOT NULL
        AND (NEW.parent_work_order_id, NEW.request_observation_id, NEW.vehicle_id)
          IS NOT DISTINCT FROM (OLD.parent_work_order_id, OLD.request_observation_id, OLD.vehicle_id)
        AND EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.source_identifier = 'work_order_publication:' || NEW.id::text
          AND o.extraction_method = 'work_order_publication_sign_v1' AND o.is_superseded IS FALSE AND o.ingested_at = now()
          AND o.structured_data#>>'{work_order_publication,visibility}' = NEW.request_visibility) THEN
      RETURN NEW;
    END IF;
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
END $function$;

CREATE FUNCTION public.work_order_publication_text_is_personal(p_work_order_id uuid, p_text text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(p_text, '') ~ '(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})' OR public.work_order_text_is_personal(p_work_order_id, p_text)
$$;
REVOKE ALL ON FUNCTION public.work_order_publication_text_is_personal(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.work_order_publication_party(p_work_order_id uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_orders w JOIN public.vehicles v ON v.id = w.vehicle_id
    WHERE w.id = p_work_order_id AND v.merged_into_vehicle_id IS NULL
      AND (w.customer_id = p_user OR v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user
        OR public.vehicle_user_has_access(v.id, p_user)))
$$;
REVOKE ALL ON FUNCTION public.work_order_publication_party(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.publish_work_order(p_work_order_id uuid, p_visibility text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  v public.vehicles%ROWTYPE;
  kw jsonb := public.listing_plan_keyword_table();
  tmpl jsonb := public.work_request_requirement_template()->'entries';
  owner_source uuid;
  pub_id uuid;
  op_id uuid;
  rq_id uuid;
  li record;
  entry jsonb;
  matched jsonb;
  reqs jsonb;
  rq jsonb;
  t text;
  i integer := 0;
  head_personal boolean;
  derive_desc boolean;
  quoted text;
  ops_out jsonb := '[]'::jsonb;
  reqs_out jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_visibility, '') NOT IN ('open', 'invite_only') THEN
    RAISE EXCEPTION 'Visibility must be open or invite_only' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND OR NOT public.work_order_publication_party(w.id, uid) THEN
    RAISE EXCEPTION 'Work order unavailable: publish a job on your own vehicle or one you requested' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(w.status, 'pending') IN ('completed', 'paid', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Only an open job can be published (status %)', w.status USING ERRCODE = '23514';
  END IF;
  IF w.scope_category = 'inspection' THEN
    RAISE EXCEPTION 'Inspection jobs are requested with request_inspection' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v FROM public.vehicles WHERE id = w.vehicle_id;
  head_personal := public.work_order_publication_text_is_personal(w.id, concat_ws(' ', w.title, w.description, w.scope_description));
  IF p_visibility = 'open' AND head_personal THEN
    RAISE EXCEPTION 'Remove names and contact details from the job title and description before opening it; contact goes through Nuke'
      USING ERRCODE = '23514';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;

  -- The Sign's text is exactly what its requirements quote: the description when operations are drawn from it, and the
  -- open operations that will get requirements (never text holding names or contact details).
  derive_desc := NOT EXISTS (SELECT 1 FROM public.work_order_line_items x WHERE x.work_order_id = w.id)
    AND NOT head_personal AND NULLIF(btrim(COALESCE(w.description, '')), '') IS NOT NULL;
  quoted := concat_ws(E'\n', 'Published as ' || p_visibility, CASE WHEN derive_desc THEN w.description END,
    (SELECT string_agg(btrim(x.task_description), E'\n' ORDER BY x.line_number, x.id) FROM public.work_order_line_items x
      WHERE x.work_order_id = w.id AND x.status IN ('pending', 'in_progress', 'rework') AND btrim(COALESCE(x.task_description, '')) <> ''
        AND NOT public.work_order_publication_text_is_personal(w.id, x.task_description)
        AND NOT EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id AND r.line_item_id = x.id)));
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score, ingested_at)
  VALUES (w.vehicle_id, owner_source, 'work_order_publication:' || w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    quoted, md5(w.id::text || ':publish:' || p_visibility || ':' || signed::text),
    jsonb_build_object('work_order_publication', jsonb_build_object('version', 1, 'action', 'publish', 'work_order_id', w.id,
      'visibility', p_visibility, 'previous_visibility', w.request_visibility)),
    uid, jsonb_build_object('user_id', uid, 'intake_actor', 'account'), 'work_order_publication_sign_v1', 'high', 0.95, now())
  RETURNING id INTO pub_id;

  -- Operations from the job's own description, only when it has none.
  IF NOT EXISTS (SELECT 1 FROM public.work_order_line_items x WHERE x.work_order_id = w.id) THEN
    IF head_personal THEN
      skipped := skipped || jsonb_build_array(jsonb_build_object('reason', 'description holds names or contact details; no operations derived'));
    ELSIF NULLIF(btrim(COALESCE(w.description, '')), '') IS NULL THEN
      skipped := skipped || jsonb_build_array(jsonb_build_object('reason', 'no description to quote; no operations derived'));
    ELSE
      FOR t IN SELECT btrim(s.quote, E' \t\r\n-*•') FROM public.listing_plan_sentences(w.description) s ORDER BY s.ord LOOP
        CONTINUE WHEN t = '' OR i >= 20;
        i := i + 1;
        INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text, content_hash,
          structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
        VALUES (w.vehicle_id, owner_source, 'work_order_publication_operation:' || w.id::text, signed, 'work_record', left(t, 500),
          md5(pub_id::text || ':op:' || i),
          jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'operation', 'work_order_id', w.id,
            'line_number', i, 'task_type', 'other', 'task_description', left(t, 500), 'basis_field', 'description',
            'basis_excerpt', left(t, 500), 'notes', 'Quoted from the job description when it was published')),
          uid, 'work_order_publication_sign_v1', 'high', 0.95)
        RETURNING id INTO op_id;
        PERFORM public.project_work_order_resource_observation(op_id);
        ops_out := ops_out || jsonb_build_array(jsonb_build_object('line_item_id', op_id, 'line_number', i, 'text', left(t, 500),
          'basis', 'quoted_from_description'));
      END LOOP;
    END IF;
  END IF;

  -- Requirements for open operations that have none.
  FOR li IN SELECT x.id, x.line_number, x.task_description FROM public.work_order_line_items x
      WHERE x.work_order_id = w.id AND x.status IN ('pending', 'in_progress', 'rework')
        AND NOT EXISTS (SELECT 1 FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id AND r.line_item_id = x.id)
      ORDER BY x.line_number, x.id LOOP
    t := btrim(COALESCE(li.task_description, ''));
    IF t = '' THEN
      skipped := skipped || jsonb_build_array(jsonb_build_object('line_item_id', li.id, 'reason', 'operation has no text'));
      CONTINUE;
    END IF;
    IF public.work_order_publication_text_is_personal(w.id, t) OR length(t) > 2000 THEN
      skipped := skipped || jsonb_build_array(jsonb_build_object('line_item_id', li.id, 'reason', 'operation text holds names or contact details'));
      CONTINUE;
    END IF;
    matched := '[]'::jsonb;
    FOR entry IN SELECT value FROM jsonb_array_elements(kw->'entries') LOOP
      CONTINUE WHEN NOT (t ~* public.listing_plan_re(entry->>'pattern'));
      CONTINUE WHEN entry ? 'requires' AND NOT (t ~* public.listing_plan_re(entry->>'requires'));
      CONTINUE WHEN entry ? 'exclude' AND t ~* public.listing_plan_re(entry->>'exclude');
      matched := matched || jsonb_build_array(entry);
    END LOOP;
    reqs := COALESCE((SELECT jsonb_agg(DISTINCT r) FROM jsonb_array_elements(matched) m, jsonb_array_elements(COALESCE(tmpl->(m->>'id'), '[]'::jsonb)) r), '[]'::jsonb);
    IF jsonb_array_length(reqs) = 0 THEN
      reqs := jsonb_build_array(jsonb_build_object('kind', 'skill', 'description', left(t, 500), 'basis', 'operation_text'));
    END IF;
    FOR rq IN SELECT value FROM jsonb_array_elements(reqs) LOOP
      INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, kind, content_text, content_hash,
        structured_data, submitted_by_user_id, extraction_method, confidence, confidence_score)
      VALUES (w.vehicle_id, owner_source, 'work_order_publication_requirement:' || w.id::text, signed, 'work_record', rq->>'description',
        md5(pub_id::text || ':req:' || li.id::text || ':' || (rq->>'kind') || ':' || (rq->>'description')),
        jsonb_build_object('work_order_resource', jsonb_build_object('version', 1, 'event_type', 'requirement', 'work_order_id', w.id,
          'line_item_id', li.id, 'requirement_kind', rq->>'kind', 'description', rq->>'description', 'quantity', NULL, 'unit', NULL,
          'basis_observation_id', pub_id, 'basis_excerpt', t)),
        uid, 'work_order_publication_sign_v1', 'high', 0.95)
      RETURNING id INTO rq_id;
      PERFORM public.project_work_order_resource_observation(rq_id);
      reqs_out := reqs_out || jsonb_build_array(jsonb_build_object('requirement_id', rq_id, 'line_item_id', li.id, 'kind', rq->>'kind',
        'description', rq->>'description', 'basis', COALESCE(rq->>'basis', 'reviewed_template')));
    END LOOP;
  END LOOP;

  IF w.request_visibility IS DISTINCT FROM p_visibility THEN
    UPDATE public.work_orders SET request_visibility = p_visibility WHERE id = w.id;
  END IF;

  RETURN jsonb_build_object('work_order_id', w.id, 'publication_observation_id', pub_id, 'signed_at', signed,
    'visibility', p_visibility, 'previous_visibility', w.request_visibility,
    'listed_in_open_requirements', p_visibility = 'open' AND v.is_public IS TRUE,
    'operations_derived', ops_out, 'requirements_derived', reqs_out, 'skipped', skipped,
    'requirements_total', (SELECT count(*) FROM public.work_order_resource_requirements r WHERE r.work_order_id = w.id),
    'scope_invented', false, 'providers_notified', false, 'payment_authorized', false, 'status_changed', false);
END $$;
REVOKE ALL ON FUNCTION public.publish_work_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_work_order(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.publish_work_order(uuid, text) IS
  'Sign (customer or vehicle owner): publish an existing job as open or invite_only. Derives requirements for its open operations (reviewed template, else one skill requirement quoting the operation), operations from its own description when it has none; refuses open when its text holds names or contact details.';

CREATE FUNCTION public.unpublish_work_order(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  owner_source uuid;
  pub_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND OR NOT public.work_order_publication_party(w.id, uid) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score, ingested_at)
  VALUES (w.vehicle_id, owner_source, 'work_order_publication:' || w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    'Unpublished (invite_only)', md5(w.id::text || ':unpublish:' || signed::text),
    jsonb_build_object('work_order_publication', jsonb_build_object('version', 1, 'action', 'unpublish', 'work_order_id', w.id,
      'visibility', 'invite_only', 'previous_visibility', w.request_visibility)),
    uid, jsonb_build_object('user_id', uid, 'intake_actor', 'account'), 'work_order_publication_sign_v1', 'high', 0.95, now())
  RETURNING id INTO pub_id;
  IF w.request_visibility IS DISTINCT FROM 'invite_only' THEN
    UPDATE public.work_orders SET request_visibility = 'invite_only' WHERE id = w.id;
  END IF;
  RETURN jsonb_build_object('work_order_id', w.id, 'publication_observation_id', pub_id, 'signed_at', signed,
    'visibility', 'invite_only', 'previous_visibility', w.request_visibility, 'requirements_kept', true, 'listed_in_open_requirements', false);
END $$;
REVOKE ALL ON FUNCTION public.unpublish_work_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpublish_work_order(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.unpublish_work_order(uuid) IS
  'Sign (customer or vehicle owner): take a published job off the open list (invite_only). Requirements stay as testimony.';

NOTIFY pgrst, 'reload schema';
COMMIT;
