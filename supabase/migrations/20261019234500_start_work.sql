-- Start work (QUOTE lane RSI pass 8). The execution stage had no Sign: it was recorded only from legacy start clocks or
-- component events, and attached evidence was counted without changing the state.
--
--   * start_work(p_work_order_id, p_terms_hash): a current accepted provider's Sign (work_order_accepted_providers). It is
--     pinned to the terms the provider works under: the accepted quote's quote_hash when the work order has a current
--     customer quote acceptance, otherwise the provider's accepted offer terms hash (accepted_terms_hash, else offer_hash).
--     One owner-input work_record (signer = auth.uid(), sign clock = start clock) and one immutable
--     work_order_work_starts row. Never the customer; never on a concluded work order. It writes no status or start column.
--   * work_order_start_terms(user, work order): the terms basis and hash a provider would start under (shared by the Sign,
--     the job-view action and the job path).
--   * Job path execution (one line after the backend evidence overlay, anchored once): recorded with a current start Sign
--     (start_sign: clock, signer role, terms basis, whether those terms are still current), partial with attached evidence
--     only, otherwise unchanged.
--   * work_order_job_path_read viewer.actions lists start_work (args include the terms hash) for a current accepted
--     provider who has not started; nobody else gets it. It is a job-view action, not a signature-queue item.
-- No pause/resume, schedule, status write or payment. Contract: supabase/sql/test_start_work.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_work_starts (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES public.work_order_assignments(id) ON DELETE RESTRICT,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL CHECK (signer_role IN ('technician','inspector','lead','helper')),
  terms_basis text NOT NULL CHECK (terms_basis IN ('accepted_quote','accepted_offer')),
  terms_hash text NOT NULL CHECK (terms_hash ~ '^[0-9a-f]{64}$'),
  quote_id uuid REFERENCES public.work_order_quotes(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK ((terms_basis = 'accepted_quote') = (quote_id IS NOT NULL))
);
CREATE INDEX work_order_work_starts_wo ON public.work_order_work_starts(work_order_id, started_at DESC);
ALTER TABLE public.work_order_work_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_order_work_starts FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.work_order_work_starts FROM service_role;
GRANT SELECT ON TABLE public.work_order_work_starts TO service_role;
COMMENT ON TABLE public.work_order_work_starts IS 'Provider start-work Signs (start_work): start clock, signer, the assignment and the terms hash worked under. Immutable; keyed to the Sign observation. Read through read_work_order_job_path.';

CREATE FUNCTION public.work_order_work_start_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Start-work Signs are immutable'; END IF;
  IF current_setting('nuke.work_order_start_sign', true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'Start-work Signs are recorded only by start_work';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_order_work_start_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_order_work_start_guard BEFORE INSERT OR UPDATE OR DELETE ON public.work_order_work_starts
  FOR EACH ROW EXECUTE FUNCTION public.work_order_work_start_guard();

-- The terms a current accepted provider starts under, or null.
CREATE FUNCTION public.work_order_start_terms(p_user uuid, p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE ap record; a public.work_order_assignments%ROWTYPE; qs jsonb;
BEGIN
  IF p_user IS NULL THEN RETURN NULL; END IF;
  SELECT x.* INTO ap FROM public.work_order_accepted_providers(p_work_order_id) x WHERE x.account_id = p_user ORDER BY x.accepted_at DESC LIMIT 1;
  IF ap.assignment_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.work_order_assignments WHERE id = ap.assignment_id;
  qs := public.work_order_quote_state(p_work_order_id);
  IF qs#>>'{acceptance,state}' = 'accepted' THEN
    RETURN jsonb_build_object('assignment_id', a.id, 'role', a.role, 'terms_basis', 'accepted_quote',
      'terms_hash', qs#>>'{acceptance,quote_hash}', 'quote_id', qs#>>'{acceptance,quote_id}');
  END IF;
  RETURN jsonb_build_object('assignment_id', a.id, 'role', a.role, 'terms_basis', 'accepted_offer',
    'terms_hash', COALESCE(a.accepted_terms_hash, a.offer_hash), 'quote_id', NULL);
END $$;
REVOKE ALL ON FUNCTION public.work_order_start_terms(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_start_terms(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.work_order_start_terms(uuid,uuid) IS 'Service-only: assignment, role, terms basis and terms hash a current accepted provider starts work under (accepted quote hash, else accepted offer terms hash); null otherwise.';

CREATE FUNCTION public.start_work(p_work_order_id uuid, p_terms_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  signed timestamptz := now();
  w public.work_orders%ROWTYPE;
  terms jsonb;
  owner_source uuid;
  request_key text;
  prior public.work_order_work_starts%ROWTYPE;
  obs_id uuid;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF w.id IS NULL OR w.vehicle_id IS NULL THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  IF w.customer_id IS NOT DISTINCT FROM signer THEN RAISE EXCEPTION 'The customer does not start the work; the accepted provider does' USING ERRCODE = '42501'; END IF;
  terms := public.work_order_start_terms(signer, w.id);
  IF terms IS NULL THEN RAISE EXCEPTION 'Only a current accepted provider can start this work' USING ERRCODE = '42501'; END IF;
  IF COALESCE(w.status, 'pending') IN ('completed','paid','cancelled','rejected') THEN
    RAISE EXCEPTION 'Work order concluded' USING ERRCODE = '42501';
  END IF;
  IF p_terms_hash IS DISTINCT FROM terms->>'terms_hash' THEN
    RAISE EXCEPTION 'Terms hash does not match the accepted terms (%)', terms->>'terms_basis' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_start:'||w.id::text, 0));
  SELECT s.* INTO prior FROM public.work_order_work_starts s JOIN public.vehicle_observations o ON o.id = s.id AND o.is_superseded IS FALSE
    WHERE s.work_order_id = w.id AND s.assignment_id = (terms->>'assignment_id')::uuid AND s.terms_hash = p_terms_hash
    ORDER BY s.started_at DESC LIMIT 1;
  IF prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('start_id', prior.id, 'work_order_id', w.id, 'started_at', prior.started_at, 'duplicate', true,
      'work_order_status_changed', false, 'payment_authorized', false, 'customer_notified', false);
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-start', signer, w.id, terms)::text);
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw,
    extraction_method, confidence, confidence_score)
  VALUES (w.vehicle_id, owner_source, 'work_order_start:'||w.id::text, signed, 'event_time', signed, 'exact', 'work_record',
    format('Provider started work on work order %s under the %s terms.', w.id, replace(terms->>'terms_basis', '_', ' ')), request_key,
    jsonb_build_object('work_order_start', jsonb_build_object('version', 1, 'work_order_id', w.id, 'assignment_id', terms->'assignment_id',
      'signer_role', terms->'role', 'terms_basis', terms->'terms_basis', 'terms_hash', terms->'terms_hash', 'quote_id', terms->'quote_id')),
    signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account'), 'work_order_start_sign_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  PERFORM set_config('nuke.work_order_start_sign', obs_id::text, true);
  INSERT INTO public.work_order_work_starts(id, work_order_id, assignment_id, signer_user_id, signer_role, terms_basis, terms_hash, quote_id, started_at)
  VALUES (obs_id, w.id, (terms->>'assignment_id')::uuid, signer, terms->>'role', terms->>'terms_basis', terms->>'terms_hash',
    (terms->>'quote_id')::uuid, signed);
  PERFORM set_config('nuke.work_order_start_sign', '', true);
  RETURN jsonb_build_object('start_id', obs_id, 'work_order_id', w.id, 'started_at', signed, 'signer_role', terms->'role',
    'terms_basis', terms->'terms_basis', 'terms_hash', terms->'terms_hash', 'quote_id', terms->'quote_id', 'duplicate', false,
    'work_order_status_changed', false, 'payment_authorized', false, 'customer_notified', false);
END $$;
REVOKE ALL ON FUNCTION public.start_work(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_work(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.start_work(uuid,text) IS 'Sign: a current accepted provider starts the work, pinned to the accepted quote hash (or the accepted offer terms hash when no quote is accepted). Start clock = sign clock, attributed to the signer. No status write, schedule or payment.';

-- Job path execution: a current start Sign records the stage; evidence alone is partial.
CREATE FUNCTION public.work_order_execution_start_overlay(p_work_order_id uuid, p_stage jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE s public.work_order_work_starts%ROWTYPE; n integer;
BEGIN
  SELECT x.* INTO s FROM public.work_order_work_starts x JOIN public.vehicle_observations o ON o.id = x.id AND o.is_superseded IS FALSE
    WHERE x.work_order_id = p_work_order_id ORDER BY x.started_at, x.id LIMIT 1;
  SELECT count(*) INTO n FROM public.work_order_work_starts x JOIN public.vehicle_observations o ON o.id = x.id AND o.is_superseded IS FALSE
    WHERE x.work_order_id = p_work_order_id;
  IF s.id IS NOT NULL THEN
    RETURN p_stage || jsonb_build_object('state', 'recorded', 'state_basis', 'provider_start_sign',
      'start_sign', jsonb_build_object('start_id', s.id, 'started_at', s.started_at, 'signer_role', s.signer_role,
        'terms_basis', s.terms_basis, 'terms_current', public.work_order_start_terms(s.signer_user_id, p_work_order_id)->>'terms_hash' IS NOT DISTINCT FROM s.terms_hash,
        'start_signs', n, 'basis', 'start_work Sign by a current accepted provider'),
      'gaps', COALESCE((SELECT jsonb_agg(g) FROM jsonb_array_elements(COALESCE(p_stage->'gaps', '[]'::jsonb)) g WHERE g #>> '{}' <> 'no_start_clock'), '[]'::jsonb));
  END IF;
  IF p_stage->>'state' = 'absent' AND COALESCE((p_stage#>>'{attached_evidence,images}')::int, 0) > 0 THEN
    RETURN p_stage || jsonb_build_object('state', 'partial', 'state_basis', 'attached_evidence_without_start_sign', 'start_sign', NULL);
  END IF;
  RETURN p_stage || jsonb_build_object('start_sign', NULL, 'state_basis', CASE WHEN p_stage->>'state' = 'absent' THEN 'no_start_sign'
    ELSE 'legacy_start_clock_or_component_events' END);
END $$;
REVOKE ALL ON FUNCTION public.work_order_execution_start_overlay(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_execution_start_overlay(uuid,jsonb) TO service_role;

-- Job-view actions for the viewer (start_work for a current accepted provider who has not started).
CREATE FUNCTION public.work_order_job_actions(p_user uuid, p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE terms jsonb; w public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF p_user IS NULL OR w.id IS NULL OR w.customer_id IS NOT DISTINCT FROM p_user
    OR COALESCE(w.status, 'pending') IN ('completed','paid','cancelled','rejected') THEN RETURN '[]'::jsonb; END IF;
  terms := public.work_order_start_terms(p_user, p_work_order_id);
  IF terms IS NULL OR EXISTS (SELECT 1 FROM public.work_order_work_starts s JOIN public.vehicle_observations o ON o.id = s.id AND o.is_superseded IS FALSE
      WHERE s.work_order_id = p_work_order_id AND s.assignment_id = (terms->>'assignment_id')::uuid AND s.terms_hash = terms->>'terms_hash') THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN jsonb_build_array(jsonb_build_object('action', 'start_work', 'rpc', 'start_work',
    'args', jsonb_build_object('p_work_order_id', p_work_order_id, 'p_terms_hash', terms->'terms_hash'),
    'terms_basis', terms->'terms_basis',
    'binds', jsonb_build_array('your statement that you started this work under these exact terms (by hash)'),
    'does_not_bind', jsonb_build_array('completion', 'schedule', 'payment')));
END $$;
REVOKE ALL ON FUNCTION public.work_order_job_actions(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_job_actions(uuid,uuid) TO service_role;

DO $$
DECLARE
  jp text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
  rd text := pg_get_functiondef('public.work_order_job_path_read(uuid)'::regprocedure);
  a1 text := 'execution := public.work_order_execution_evidence_overlay(w.id, execution);';
  a2 text := $a$jsonb_build_object('actions', '[]'::jsonb,$a$;
  a3 text := $a$'actions_basis', 'no Sign writer exists yet; the server lists actionable steps here'$a$;
BEGIN
  IF (length(jp) - length(replace(jp, a1, ''))) / length(a1) <> 1 OR (length(rd) - length(replace(rd, a2, ''))) / length(a2) <> 1
    OR (length(rd) - length(replace(rd, a3, ''))) / length(a3) <> 1 THEN
    RAISE EXCEPTION 'job path anchors not found exactly once';
  END IF;
  EXECUTE replace(jp, a1, a1 || E'\n  execution := public.work_order_execution_start_overlay(w.id, execution);');
  rd := replace(rd, a2, $r$jsonb_build_object('actions', public.work_order_job_actions(uid, p_work_order_id),$r$);
  rd := replace(rd, a3, $r$'actions_basis', 'Signs this viewer can take from the job view (start_work for a current accepted provider who has not started)'$r$);
  EXECUTE rd;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
