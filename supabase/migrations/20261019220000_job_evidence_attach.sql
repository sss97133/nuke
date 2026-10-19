-- Evidence attach from the Library: a party links its own photos of the vehicle to a work order (optionally to one
-- operation) as a Sign. Nothing about the images changes: no visibility, gate, vehicle or ownership write.
--
--   attach_job_evidence(p_work_order_id, p_image_ids, p_operation_id, p_note): eligible = parties on the work order
--     (customer, current accepted provider or inspector, organization owner or member). Each image must be the signer's
--     own (vehicle_images.user_id = auth.uid()) of the work order's vehicle, current (not superseded), not sensitive, and
--     not gated as rejected_personal or rejected_misattributed. 1 to 50 images per call; an image is attached to a work
--     order at most once while its attachment is current. One owner-input work_record (envelope work_order_evidence v1)
--     projected in the same transaction by project_work_order_evidence_attachment into immutable
--     work_order_evidence_attachments / work_order_evidence_images rows.
--   job_evidence_candidates_read(p_work_order_id, p_after, p_limit): self only. The viewer's own attachable photos of the
--     work order's vehicle inside the job window (work_order_evidence_window) that are not yet attached; without a work
--     order, across the viewer's work orders. Keyset by capture clock (taken_at, else upload time).
--   work_order_evidence_read(p_work_order_id): open reader of current attachments. Images follow the existing
--     vehicle_images read policies: strangers see an image only on a public vehicle when it is not sensitive, not
--     superseded and not gated rejected/review_needed; the image's owner, the vehicle's owner/uploader and members of an
--     organization holding the vehicle see it as RLS allows. Withheld images are counted, never described. Notes and raw
--     ids to parties only.
--   Job path execution stage: one added line (work_order_execution_evidence_overlay) adds attached_evidence counts.
-- Contract: supabase/sql/test_job_evidence_attach.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_evidence_attachments (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  attached_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  attacher_role text NOT NULL CHECK (attacher_role IN ('customer','accepted_provider','organization_owner','organization_member')),
  operation_id uuid,
  image_count integer NOT NULL CHECK (image_count BETWEEN 1 AND 50),
  attached_at timestamptz NOT NULL CHECK (isfinite(attached_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, work_order_id)
);
CREATE INDEX work_order_evidence_attachments_work_order ON public.work_order_evidence_attachments(work_order_id, attached_at DESC);
CREATE TABLE public.work_order_evidence_images (
  attachment_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  image_id uuid NOT NULL,
  PRIMARY KEY (attachment_id, image_id),
  FOREIGN KEY (attachment_id, work_order_id) REFERENCES public.work_order_evidence_attachments(id, work_order_id) ON DELETE RESTRICT
);
CREATE INDEX work_order_evidence_images_work_order ON public.work_order_evidence_images(work_order_id, image_id);
COMMENT ON TABLE public.work_order_evidence_attachments IS 'Party Sign attaching its own vehicle photos to a work order (attach_job_evidence); one row per owner-input work_record. Immutable. Writer: project_work_order_evidence_attachment.';
COMMENT ON TABLE public.work_order_evidence_images IS 'Images of one evidence attachment. image_id names vehicle_images.id (validated by the Sign; no FK to the image table). Immutable.';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_evidence_attachments','work_order_evidence_images'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY evidence_service_read ON public.%I FOR SELECT TO service_role USING (true)', t);
    EXECUTE format('CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
    EXECUTE format('CREATE TRIGGER evidence_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
  END LOOP;
END $$;

CREATE FUNCTION public.work_order_evidence_role(p_work_order_id uuid, p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_user IS NULL THEN NULL WHEN w.customer_id = p_user THEN 'customer'
    ELSE public.work_order_completion_signer_role(w.id, p_user) END
  FROM public.work_orders w WHERE w.id = p_work_order_id
$$;

-- Job window for candidate photos: from the start clock (else the first acceptance, else creation) to the completion
-- clock or attestation plus a day (else now).
CREATE FUNCTION public.work_order_evidence_window(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  w public.work_orders%ROWTYPE;
  accepted_at timestamptz;
  attested_at timestamptz;
  f timestamptz; fb text; u timestamptz; ub text;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  SELECT min(ap.accepted_at) INTO accepted_at FROM public.work_order_accepted_providers(w.id) ap;
  accepted_at := LEAST(accepted_at, (public.work_order_quote_state(w.id)#>>'{acceptance,signed_at}')::timestamptz, w.approved_at);
  attested_at := (public.work_order_completion_overlay(w.id, '{}'::jsonb)#>>'{provider_attestation,signed_at}')::timestamptz;
  IF COALESCE(w.started_at, w.actual_start) IS NOT NULL THEN f := COALESCE(w.started_at, w.actual_start); fb := 'start_clock';
  ELSIF accepted_at IS NOT NULL THEN f := accepted_at; fb := 'first_acceptance';
  ELSE f := w.created_at; fb := 'work_order_created'; END IF;
  IF COALESCE(w.completed_at, w.actual_end) IS NOT NULL THEN u := COALESCE(w.completed_at, w.actual_end) + interval '1 day'; ub := 'completion_clock_plus_1_day';
  ELSIF attested_at IS NOT NULL THEN u := attested_at + interval '1 day'; ub := 'completion_attestation_plus_1_day';
  ELSE u := statement_timestamp(); ub := 'open_job_now'; END IF;
  RETURN jsonb_build_object('from', f, 'until', u, 'from_basis', fb, 'until_basis', ub);
END $$;

CREATE FUNCTION public.work_order_evidence_image_refusal(p_image_ids uuid[], p_user uuid, p_vehicle_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_image_ids IS NULL OR cardinality(p_image_ids) NOT BETWEEN 1 AND 50 THEN 'Attach 1 to 50 images'
    WHEN (SELECT count(DISTINCT x) FROM unnest(p_image_ids) x) <> cardinality(p_image_ids) THEN 'Each image once per attachment'
    WHEN (SELECT count(*) FROM public.vehicle_images vi WHERE vi.id = ANY (p_image_ids) AND vi.user_id = p_user AND vi.vehicle_id = p_vehicle_id)
      <> cardinality(p_image_ids) THEN 'Only your own images of this vehicle can be attached'
    WHEN EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = ANY (p_image_ids) AND (COALESCE(vi.is_sensitive, false)
      OR COALESCE(vi.is_superseded, false) OR vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed')))
      THEN 'Personal, sensitive, misattributed or superseded images cannot be attached' END
$$;

CREATE FUNCTION public.project_work_order_evidence_attachment(p_observation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  role text;
  ids uuid[];
  refusal text;
  inserted integer;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.submitted_by_user_id IS NULL
     OR o.source_id IS DISTINCT FROM (SELECT id FROM public.observation_sources WHERE slug = 'owner-input') THEN
    RAISE EXCEPTION 'Current signed owner-input work_record required';
  END IF;
  e := o.structured_data->'work_order_evidence';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'work_order_evidence version 1 envelope required'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_evidence_attachments WHERE id = o.id) THEN RETURN jsonb_build_object('id', o.id, 'duplicate', true); END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN RAISE EXCEPTION 'Source and work order must identify the same vehicle'; END IF;
  role := public.work_order_evidence_role(w.id, o.submitted_by_user_id);
  IF role IS NULL OR role IS DISTINCT FROM e->>'attacher_role' THEN RAISE EXCEPTION 'Signer is not a party to this work order'; END IF;
  SELECT array_agg(x::uuid ORDER BY x) INTO ids FROM jsonb_array_elements_text(e->'image_ids') x;
  refusal := public.work_order_evidence_image_refusal(ids, o.submitted_by_user_id, w.vehicle_id);
  IF refusal IS NOT NULL THEN RAISE EXCEPTION '%', refusal; END IF;
  IF e->>'operation_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_order_line_items li
      WHERE li.id = (e->>'operation_id')::uuid AND li.work_order_id = w.id) THEN
    RAISE EXCEPTION 'Operation is not on this work order';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_evidence_images ei JOIN public.vehicle_observations s ON s.id = ei.attachment_id
      WHERE ei.work_order_id = w.id AND ei.image_id = ANY (ids) AND s.is_superseded IS FALSE) THEN
    RAISE EXCEPTION 'Some images are already attached to this work order';
  END IF;
  INSERT INTO public.work_order_evidence_attachments(id, work_order_id, attached_by_user_id, attacher_role, operation_id, image_count, attached_at)
  VALUES (o.id, w.id, o.submitted_by_user_id, role, (e->>'operation_id')::uuid, cardinality(ids), o.observed_at);
  INSERT INTO public.work_order_evidence_images(attachment_id, work_order_id, image_id) SELECT o.id, w.id, x FROM unnest(ids) x;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN jsonb_build_object('id', o.id, 'images', inserted, 'duplicate', false);
END $$;

CREATE FUNCTION public.attach_job_evidence(p_work_order_id uuid, p_image_ids uuid[], p_operation_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  role text;
  ids uuid[];
  refusal text;
  owner_source uuid;
  request_key text;
  obs_id uuid;
  a public.work_order_evidence_attachments%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  role := public.work_order_evidence_role(p_work_order_id, signer);
  IF w.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for evidence' USING ERRCODE = '42501'; END IF;
  IF w.vehicle_id IS NULL THEN RAISE EXCEPTION 'Evidence needs a vehicle-bound work order' USING ERRCODE = '23514'; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 1000 THEN RAISE EXCEPTION 'Note must be at most 1000 characters' USING ERRCODE = '22023'; END IF;
  refusal := public.work_order_evidence_image_refusal(p_image_ids, signer, w.vehicle_id);
  IF refusal IS NOT NULL THEN RAISE EXCEPTION '%', refusal USING ERRCODE = '22023'; END IF;
  IF p_operation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_order_line_items li WHERE li.id = p_operation_id AND li.work_order_id = w.id) THEN
    RAISE EXCEPTION 'Operation is not on this work order' USING ERRCODE = '23514';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO ids FROM unnest(p_image_ids) x;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_evidence:' || w.id::text, 0));
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-evidence', signer, w.id, ids, p_operation_id, p_note)::text);
  SELECT x.* INTO a FROM public.work_order_evidence_attachments x JOIN public.vehicle_observations o ON o.id = x.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'work_order_evidence:' || w.id::text AND o.content_hash = request_key
      AND o.is_superseded IS FALSE;
  IF a.id IS NOT NULL THEN
    RETURN jsonb_build_object('attachment_id', a.id, 'work_order_id', w.id, 'image_count', a.image_count, 'operation_id', a.operation_id,
      'attacher_role', a.attacher_role, 'attached_at', a.attached_at, 'duplicate', true, 'image_visibility_changed', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_order_evidence_images ei JOIN public.vehicle_observations s ON s.id = ei.attachment_id
      WHERE ei.work_order_id = w.id AND ei.image_id = ANY (ids) AND s.is_superseded IS FALSE) THEN
    RAISE EXCEPTION 'Some images are already attached to this work order' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
    confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_evidence:' || w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('A party attached %s of its own photos as evidence to work order %s.', cardinality(ids), w.id), request_key,
    jsonb_build_object('work_order_evidence', jsonb_build_object('version', 1, 'work_order_id', w.id, 'image_ids', to_jsonb(ids),
      'operation_id', p_operation_id, 'note', p_note, 'attacher_role', role, 'signer_user_id', signer)),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'attacher_role', role), 'work_order_evidence_attach_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM public.project_work_order_evidence_attachment(obs_id);
  RETURN jsonb_build_object('attachment_id', obs_id, 'work_order_id', w.id, 'image_count', cardinality(ids), 'operation_id', p_operation_id,
    'attacher_role', role, 'attached_at', signed, 'duplicate', false, 'image_visibility_changed', false);
END $$;

CREATE FUNCTION public.job_evidence_candidates_read(p_work_order_id uuid DEFAULT NULL, p_after timestamptz DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  lim integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  wos jsonb;
  items jsonb;
  n_unattachable integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501'; END IF;
  IF p_work_order_id IS NOT NULL AND public.work_order_evidence_role(p_work_order_id, uid) IS NULL THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  WITH scope AS MATERIALIZED (
    SELECT w.id, w.vehicle_id, public.work_order_evidence_role(w.id, uid) AS role, public.work_order_evidence_window(w.id) AS win
    FROM public.work_orders w
    WHERE w.vehicle_id IS NOT NULL AND (CASE WHEN p_work_order_id IS NOT NULL THEN w.id = p_work_order_id
      ELSE w.id IN (SELECT x.id FROM public.work_orders x WHERE x.customer_id = uid
        UNION SELECT x.id FROM public.work_orders x JOIN public.business_ownership bo ON bo.business_id = x.organization_id
          WHERE bo.owner_id = uid AND bo.status = 'active'
        UNION SELECT x.id FROM public.work_orders x JOIN public.organization_contributors oc ON oc.organization_id = x.organization_id
          WHERE oc.user_id = uid AND oc.status = 'active'
        UNION SELECT f.work_order_id FROM public.work_order_resource_fulfillments f JOIN public.vehicle_observations s ON s.id = f.id
          WHERE f.offer_kind IS NOT NULL AND s.submitted_by_user_id = uid) END)
    ORDER BY w.created_at DESC NULLS LAST, w.id LIMIT 50),
  eligible AS (SELECT * FROM scope WHERE role IS NOT NULL),
  imgs AS (
    SELECT e.id AS work_order_id, vi.id AS image_id, COALESCE(vi.taken_at, vi.created_at) AS captured_at,
      CASE WHEN vi.taken_at IS NOT NULL THEN 'taken_at' ELSE 'uploaded_at' END AS clock_basis, vi.image_url, vi.vision_gate_status::text AS gate,
      (COALESCE(vi.is_sensitive, false) OR COALESCE(vi.is_superseded, false) OR COALESCE(vi.vision_gate_status::text IN ('rejected_personal','rejected_misattributed'), false)) AS unattachable
    FROM eligible e CROSS JOIN LATERAL (
      SELECT * FROM public.vehicle_images vi WHERE vi.user_id = uid AND vi.vehicle_id = e.vehicle_id
        AND COALESCE(vi.taken_at, vi.created_at) >= (e.win->>'from')::timestamptz AND COALESCE(vi.taken_at, vi.created_at) <= (e.win->>'until')::timestamptz
        AND (p_after IS NULL OR COALESCE(vi.taken_at, vi.created_at) < p_after)
      ORDER BY COALESCE(vi.taken_at, vi.created_at) DESC LIMIT 500) vi
    WHERE NOT EXISTS (SELECT 1 FROM public.work_order_evidence_images ei JOIN public.vehicle_observations s ON s.id = ei.attachment_id
      WHERE ei.work_order_id = e.id AND ei.image_id = vi.id AND s.is_superseded IS FALSE))
  SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object('work_order_id', e.id, 'role', e.role, 'window', e.win)
              || (SELECT jsonb_build_object('display_title', h->'display_title', 'vehicle_label', h->'vehicle_label')
                  FROM (SELECT public.work_order_open_header(e.id, true) AS h) hh) ORDER BY e.id), '[]'::jsonb) FROM eligible e),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('image_id', i.image_id, 'work_order_id', i.work_order_id, 'captured_at', i.captured_at,
        'clock_basis', i.clock_basis, 'image_url', i.image_url, 'vision_gate_status', i.gate) ORDER BY i.captured_at DESC, i.image_id), '[]'::jsonb)
      FROM (SELECT * FROM imgs WHERE NOT unattachable ORDER BY captured_at DESC, image_id LIMIT lim) i),
    (SELECT count(*) FROM imgs WHERE unattachable)
  INTO wos, items, n_unattachable;
  RETURN jsonb_build_object('viewer', public.job_reader_viewer('self', '{}', public.viewer_identity_bridge(uid), false), 'as_of', statement_timestamp(),
    'work_orders', wos, 'items', items,
    'next_after', CASE WHEN jsonb_array_length(items) = lim THEN items->(lim - 1)->'captured_at' END,
    'coverage', jsonb_build_object('returned', jsonb_array_length(items), 'limit', lim, 'work_orders_considered', jsonb_array_length(wos),
      'not_attachable_excluded', n_unattachable, 'population', 'own photos of each work order vehicle inside its job window, not yet attached; sensitive, personal, misattributed or superseded photos excluded'),
    'sign', jsonb_build_object('rpc', 'attach_job_evidence', 'args_hint', jsonb_build_object('p_work_order_id', p_work_order_id, 'p_image_ids', '[]'::jsonb,
      'p_operation_id', NULL, 'p_note', NULL), 'binds', jsonb_build_array('your statement that these own photos document this job'),
      'does_not_bind', jsonb_build_array('image visibility or ownership', 'completion', 'payment')));
END $$;

-- Mirrors the vehicle_images SELECT policies for one viewer.
CREATE FUNCTION public.work_order_evidence_image_visible(p_image_id uuid, p_viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_images vi JOIN public.vehicles v ON v.id = vi.vehicle_id WHERE vi.id = p_image_id AND (
    (COALESCE(vi.is_sensitive, false) = false AND COALESCE(vi.is_superseded, false) = false
      AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status::text NOT IN ('rejected_personal','rejected_misattributed','review_needed'))
      AND v.is_public = true)
    OR (p_viewer IS NOT NULL AND (vi.user_id = p_viewer OR v.user_id = p_viewer OR v.uploaded_by = p_viewer OR v.owner_id = p_viewer
      OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
        WHERE ov.vehicle_id = vi.vehicle_id AND oc.user_id = p_viewer AND oc.status = 'active')))))
$$;

CREATE FUNCTION public.work_order_evidence_read(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  attachments jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots) OR public.work_order_evidence_role(w.id, viewer) IS NOT NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('attachment_id', a.id, 'attached_at', a.attached_at,
      'attached_by', public.platform_person_label(a.attached_by_user_id) || jsonb_build_object('role', a.attacher_role)
        || CASE WHEN party THEN jsonb_build_object('user_id', a.attached_by_user_id) ELSE '{}'::jsonb END,
      'operation', CASE WHEN a.operation_id IS NULL THEN NULL ELSE (SELECT jsonb_build_object('operation_id', li.id, 'line_number', li.line_number,
        'task_description', li.task_description) FROM public.work_order_line_items li WHERE li.id = a.operation_id) END,
      'note', CASE WHEN party THEN s.structured_data#>>'{work_order_evidence,note}' END,
      'images', (SELECT COALESCE(jsonb_agg(jsonb_build_object('image_id', vi.id, 'image_url', vi.image_url,
          'captured_at', COALESCE(vi.taken_at, vi.created_at)) ORDER BY COALESCE(vi.taken_at, vi.created_at), vi.id), '[]'::jsonb)
        FROM public.work_order_evidence_images ei JOIN public.vehicle_images vi ON vi.id = ei.image_id
        WHERE ei.attachment_id = a.id AND public.work_order_evidence_image_visible(vi.id, viewer)),
      'images_withheld', (SELECT count(*) FROM public.work_order_evidence_images ei WHERE ei.attachment_id = a.id
        AND NOT public.work_order_evidence_image_visible(ei.image_id, viewer)),
      'attribution', 'authenticated_sign') ORDER BY a.attached_at DESC, a.id), '[]'::jsonb)
  INTO attachments FROM public.work_order_evidence_attachments a JOIN public.vehicle_observations s ON s.id = a.id
  WHERE a.work_order_id = w.id AND s.is_superseded IS FALSE;
  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object('work_order_id', w.id, 'as_of', statement_timestamp(),
    'attachments', attachments,
    'viewer', public.job_reader_viewer(public.job_reader_context(my_slots), my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'actions', CASE WHEN viewer IS NOT NULL AND public.work_order_evidence_role(w.id, viewer) IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('action', 'attach_evidence', 'rpc', 'attach_job_evidence', 'args', jsonb_build_object('p_work_order_id', w.id)))
        ELSE '[]'::jsonb END),
    'coverage', jsonb_build_object('attachments', jsonb_array_length(attachments),
      'image_visibility', 'existing vehicle_images read rules for this viewer; withheld images are counted, never described'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; raw ids and notes to parties only');
END $$;

CREATE FUNCTION public.work_order_execution_evidence_overlay(p_work_order_id uuid, p_stage jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  WITH a AS (SELECT a.* FROM public.work_order_evidence_attachments a JOIN public.vehicle_observations s ON s.id = a.id
    WHERE a.work_order_id = p_work_order_id AND s.is_superseded IS FALSE)
  SELECT p_stage || jsonb_build_object('attached_evidence', jsonb_build_object(
    'attachments', (SELECT count(*) FROM a), 'images', COALESCE((SELECT sum(image_count) FROM a), 0),
    'operations_with_evidence', (SELECT count(DISTINCT operation_id) FROM a),
    'by_role', COALESCE((SELECT jsonb_object_agg(attacher_role, n) FROM (SELECT attacher_role, count(*) n FROM a GROUP BY 1) x), '{}'::jsonb),
    'last_attached_at', (SELECT max(attached_at) FROM a),
    'basis', 'party-attached own photos (attach_job_evidence)'))
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['work_order_evidence_role(uuid,uuid)','work_order_evidence_window(uuid)','work_order_evidence_image_refusal(uuid[],uuid,uuid)',
      'project_work_order_evidence_attachment(uuid)','work_order_evidence_image_visible(uuid,uuid)','work_order_execution_evidence_overlay(uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['attach_job_evidence(uuid,uuid[],uuid,text)','job_evidence_candidates_read(uuid,timestamptz,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.work_order_evidence_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_evidence_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.attach_job_evidence(uuid,uuid[],uuid,text) IS 'Sign: a party on the work order attaches its own current, non-sensitive photos of the vehicle (optionally to one operation). Owner-input work_record + projection. Never changes image visibility.';
COMMENT ON FUNCTION public.job_evidence_candidates_read(uuid,timestamptz,integer) IS 'Self-only: own attachable photos of the work order vehicle(s) inside the job window, not yet attached; keyset by capture clock.';
COMMENT ON FUNCTION public.work_order_evidence_read(uuid) IS 'Open reader of attached job evidence; images follow the existing vehicle_images read rules for the viewer (withheld images counted); notes and raw ids to parties only.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
  anchor constant text := $a$  SELECT count(*) INTO n_hist FROM public.work_order_status_history WHERE work_order_id=w.id;$a$;
BEGIN
  IF position('work_order_execution_evidence_overlay' IN def) > 0 THEN RAISE EXCEPTION 'job path already carries the evidence overlay'; END IF;
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN RAISE EXCEPTION 'job path status history line not found once'; END IF;
  EXECUTE replace(def, anchor, E'  execution := public.work_order_execution_evidence_overlay(w.id, execution);\n' || anchor);
END $apply$;

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT t, 'id', 'project_work_order_evidence_attachment', 'Party evidence attachment Sign projection; written only by attach_job_evidence in its transaction.', true,
  'attach_job_evidence(uuid,uuid[],uuid,text)'
FROM unnest(ARRAY['work_order_evidence_attachments']) t
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = t AND r.column_name = 'id');
NOTIFY pgrst, 'reload schema';
COMMIT;
