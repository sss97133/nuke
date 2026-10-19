-- Historical job lifecycle testimony (mechanics RSI pass 3). Retained client/provider work messages already
-- state price acceptance, invoicing, pauses and finished operations for real jobs, but the job-loop owners
-- (quote acceptances, starts, completion and payment witnesses) record only authenticated Signs. A retained
-- message is not a Sign, so it gets its own immutable projection: one attributed claim per source observation,
-- quoting the original message verbatim under its own clock and speaker label. The job path reads it beside the
-- Signs as testimony; it never sets a Sign, a clock the Signs own, an approval, a completion or a payment.
-- Edits to the shared projector, job-path reader and scoreboard are anchored and applied exactly once.
-- Contract: supabase/sql/test_work_order_retained_testimony.sql (PG17); composition: test_job_loop_replay.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_retained_testimony (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  line_item_id uuid REFERENCES public.work_order_line_items(id) ON DELETE RESTRICT,
  lifecycle_stage text NOT NULL CHECK (lifecycle_stage IN
    ('terms_accepted','invoice_issued','work_paused','operation_completed','payment_reported')),
  speaker_label text NOT NULL CHECK (length(btrim(speaker_label)) BETWEEN 1 AND 80),
  speaker_side text NOT NULL CHECK (speaker_side IN ('client','provider')),
  basis_observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  basis_excerpt text NOT NULL CHECK (length(btrim(basis_excerpt)) BETWEEN 1 AND 2000),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT lifecycle_basis_not_self CHECK (basis_observation_id <> id),
  CONSTRAINT lifecycle_stage_side CHECK (
    (lifecycle_stage = 'terms_accepted' AND speaker_side = 'client')
    OR (lifecycle_stage IN ('invoice_issued','work_paused','operation_completed') AND speaker_side = 'provider')
    OR lifecycle_stage = 'payment_reported'),
  CONSTRAINT lifecycle_completion_names_operation CHECK (lifecycle_stage <> 'operation_completed' OR line_item_id IS NOT NULL)
);
CREATE INDEX work_order_retained_testimony_order ON public.work_order_retained_testimony(work_order_id, lifecycle_stage);
CREATE INDEX work_order_retained_testimony_line ON public.work_order_retained_testimony(line_item_id) WHERE line_item_id IS NOT NULL;
CREATE INDEX work_order_retained_testimony_basis ON public.work_order_retained_testimony(basis_observation_id);
COMMENT ON TABLE public.work_order_retained_testimony IS 'One attributed historical lifecycle claim for a work order, quoted from a retained work message (terms_accepted, invoice_issued, work_paused, operation_completed, payment_reported). Testimony, not a Sign: sets no approval, start, completion or payment. Writer: project_work_order_retained_testimony via project_work_order_resource_observation.';
COMMENT ON COLUMN public.work_order_retained_testimony.id IS 'Source vehicle_observations UUID (the interpretation) and idempotency key; method, trust and clocks stay on the source.';
COMMENT ON COLUMN public.work_order_retained_testimony.work_order_id IS 'Work order the claim speaks to; same vehicle as source and basis.';
COMMENT ON COLUMN public.work_order_retained_testimony.line_item_id IS 'Operation the claim names; required for operation_completed, null when the message speaks to the whole order.';
COMMENT ON COLUMN public.work_order_retained_testimony.lifecycle_stage IS 'terms_accepted (client accepts stated price or scope), invoice_issued, work_paused, operation_completed (provider reports an operation done), payment_reported. A report, not a verified event.';
COMMENT ON COLUMN public.work_order_retained_testimony.speaker_label IS 'The basis message''s own attribution label (structured_data.who), copied exactly; not an authenticated identity.';
COMMENT ON COLUMN public.work_order_retained_testimony.speaker_side IS 'client or provider: the interpretation of the label for this work order. Constrained against the stage.';
COMMENT ON COLUMN public.work_order_retained_testimony.basis_observation_id IS 'Original retained work message; same vehicle, same observed_at as the interpretation, not itself a projection.';
COMMENT ON COLUMN public.work_order_retained_testimony.basis_excerpt IS 'Exact excerpt of the basis message stating the claim. May contain stated amounts; service-only.';
COMMENT ON COLUMN public.work_order_retained_testimony.recorded_at IS 'Projection insertion clock.';

ALTER TABLE public.work_order_retained_testimony ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_retained_testimony FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_order_retained_testimony TO service_role;
CREATE POLICY resource_service_read ON public.work_order_retained_testimony FOR SELECT TO service_role USING (true);
CREATE TRIGGER resource_immutable BEFORE UPDATE OR DELETE ON public.work_order_retained_testimony
  FOR EACH ROW EXECUTE FUNCTION public.work_order_resource_immutable();
CREATE TRIGGER resource_no_truncate BEFORE TRUNCATE ON public.work_order_retained_testimony
  FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_resource_immutable();

CREATE FUNCTION public.project_work_order_retained_testimony(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  basis_id uuid;
  basis_quote text;
  label text;
  operation_id uuid;
  inserted_rows integer;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.source_id IS NULL THEN
    RAISE EXCEPTION 'Current attributed work_record source required';
  END IF;
  e := o.structured_data->'work_order_resource';
  IF e->>'version' IS DISTINCT FROM '1' OR e->>'event_type' IS DISTINCT FROM 'retained_lifecycle' THEN
    RAISE EXCEPTION 'work_order_resource version 1 retained_lifecycle envelope required';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Source and work order must identify the same vehicle';
  END IF;
  basis_id := (e->>'basis_observation_id')::uuid;
  basis_quote := e->>'basis_excerpt';
  IF basis_id IS NULL OR basis_quote IS NULL OR length(btrim(basis_quote)) NOT BETWEEN 1 AND 2000 OR basis_id = o.id THEN
    RAISE EXCEPTION 'Retained basis message and exact excerpt required';
  END IF;
  SELECT b.structured_data->>'who' INTO label FROM public.vehicle_observations b
    WHERE b.id = basis_id AND b.kind::text = 'work_record' AND b.is_superseded IS FALSE AND b.vehicle_id = w.vehicle_id
      AND b.observed_at = o.observed_at AND NOT (COALESCE(b.structured_data,'{}'::jsonb) ? 'work_order_resource')
      AND strpos(b.content_text, basis_quote) > 0 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current same-vehicle original basis, exact excerpt and original clock required'; END IF;
  IF label IS NULL OR label IS DISTINCT FROM e->>'speaker_label' THEN
    RAISE EXCEPTION 'Speaker label must be the basis message''s own attribution';
  END IF;
  operation_id := (e->>'line_item_id')::uuid;
  IF operation_id IS NOT NULL THEN
    PERFORM 1 FROM public.work_order_line_items WHERE id = operation_id AND work_order_id = w.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation must belong to the work order'; END IF;
  END IF;
  INSERT INTO public.work_order_retained_testimony(id,work_order_id,line_item_id,lifecycle_stage,speaker_label,speaker_side,
    basis_observation_id,basis_excerpt)
    VALUES (o.id,w.id,operation_id,e->>'lifecycle_stage',label,e->>'speaker_side',basis_id,basis_quote)
    ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN jsonb_build_object('id',o.id,'event_type','retained_lifecycle','duplicate',inserted_rows = 0);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_retained_testimony(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_work_order_retained_testimony(uuid) TO service_role;
COMMENT ON FUNCTION public.project_work_order_retained_testimony(uuid) IS 'Service-only projection of one lifecycle testimony envelope into work_order_retained_testimony; called through project_work_order_resource_observation. Never writes a Sign, clock, approval, completion or payment.';

-- Counts and clocks only; excerpts never leave the table through the job path.
CREATE FUNCTION public.work_order_retained_testimony_overlay(p_work_order_id uuid, p_stage_name text, p_stage jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  WITH t AS (
    SELECT lt.* FROM public.work_order_retained_testimony lt
    JOIN public.vehicle_observations s ON s.id = lt.id AND s.is_superseded IS FALSE
    JOIN public.work_orders w ON w.id = lt.work_order_id AND w.vehicle_id = s.vehicle_id
    JOIN public.vehicle_observations b ON b.id = lt.basis_observation_id AND b.is_superseded IS FALSE
      AND b.vehicle_id = w.vehicle_id AND b.observed_at = s.observed_at AND strpos(b.content_text, lt.basis_excerpt) > 0
    WHERE lt.work_order_id = p_work_order_id
      AND (lt.line_item_id IS NULL OR EXISTS (SELECT 1 FROM public.work_order_line_items li
        WHERE li.id = lt.line_item_id AND li.work_order_id = lt.work_order_id))
      AND lt.lifecycle_stage = ANY (CASE p_stage_name
        WHEN 'terms' THEN ARRAY['terms_accepted'] WHEN 'execution' THEN ARRAY['work_paused']
        WHEN 'completion' THEN ARRAY['operation_completed']
        WHEN 'accounting' THEN ARRAY['invoice_issued','payment_reported'] ELSE ARRAY[]::text[] END)
  )
  SELECT p_stage || jsonb_build_object('retained_testimony', jsonb_build_object(
    'claims', (SELECT count(*) FROM t),
    'by_stage', COALESCE((SELECT jsonb_object_agg(lifecycle_stage, n) FROM
      (SELECT lifecycle_stage, count(*) n FROM t GROUP BY 1) x), '{}'::jsonb),
    'by_side', COALESCE((SELECT jsonb_object_agg(speaker_side, n) FROM
      (SELECT speaker_side, count(*) n FROM t GROUP BY 1) x), '{}'::jsonb),
    'operations', (SELECT count(DISTINCT line_item_id) FROM t),
    'latest_message_at', (SELECT max(s.observed_at) FROM t JOIN public.vehicle_observations s ON s.id = t.id),
    'basis', 'attributed retained messages; not Signs, not verified'))
$$;
REVOKE ALL ON FUNCTION public.work_order_retained_testimony_overlay(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_retained_testimony_overlay(uuid,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.work_order_retained_testimony_overlay(uuid,text,jsonb) IS 'Adds a testimony block (counts, sides, operations, latest message clock) to one job-path stage from current lifecycle testimony; withdrawn, reattributed or changed bases drop out. Returns no message text and never changes the stage state.';

DO $edit$
DECLARE
  pj text := pg_get_functiondef('public.project_work_order_resource_observation(uuid)'::regprocedure);
  jp text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
  sb text := pg_get_functiondef('public.work_order_job_path_scoreboard()'::regprocedure);
  p1 text := $a$'quote','quote_acceptance','offer','offer_acceptance') THEN$a$;
  p2 text := $a$RETURN public.project_work_order_offer_event(o.id);
  END IF;$a$;
  j1 text := $a$  SELECT count(*) INTO n_events FROM public.component_events WHERE work_order_id=w.id;$a$;
  j2 text := $a$  execution := public.work_order_execution_start_overlay(w.id, execution);$a$;
  j3 text := $a$  completion := public.work_order_completion_overlay(w.id, completion);$a$;
  j4 text := $a$  accounting := public.work_order_accounting_overlay(w.id, accounting);$a$;
  s1 text := $a$jsonb_array_elements(v->'inconsistencies') i GROUP BY 1)$a$;
  s2 text := $a$'inconsistencies',COALESCE((SELECT jsonb_object_agg(code,n) FROM bad),'{}'::jsonb),$a$;
BEGIN
  IF (length(pj)-length(replace(pj,p1,'')))/length(p1) <> 1 OR (length(pj)-length(replace(pj,p2,'')))/length(p2) <> 1
    OR (length(jp)-length(replace(jp,j1,'')))/length(j1) <> 1 OR (length(jp)-length(replace(jp,j2,'')))/length(j2) <> 1
    OR (length(jp)-length(replace(jp,j3,'')))/length(j3) <> 1 OR (length(jp)-length(replace(jp,j4,'')))/length(j4) <> 1
    OR (length(sb)-length(replace(sb,s1,'')))/length(s1) <> 1 OR (length(sb)-length(replace(sb,s2,'')))/length(s2) <> 1 THEN
    RAISE EXCEPTION 'lifecycle testimony anchors not found exactly once';
  END IF;
  pj := replace(pj, p1, $r$'quote','quote_acceptance','offer','offer_acceptance','retained_lifecycle') THEN$r$);
  pj := replace(pj, p2, p2 || $r$
  IF event_type = 'retained_lifecycle' THEN
    RETURN public.project_work_order_retained_testimony(o.id);
  END IF;$r$);
  EXECUTE pj;
  jp := replace(jp, j1, $r$  terms := public.work_order_retained_testimony_overlay(w.id, 'terms', terms);
$r$ || j1);
  jp := replace(jp, j2, j2 || $r$
  execution := public.work_order_retained_testimony_overlay(w.id, 'execution', execution);$r$);
  jp := replace(jp, j3, j3 || $r$
  completion := public.work_order_retained_testimony_overlay(w.id, 'completion', completion);$r$);
  jp := replace(jp, j4, j4 || $r$
  accounting := public.work_order_retained_testimony_overlay(w.id, 'accounting', accounting);$r$);
  EXECUTE jp;
  sb := replace(sb, s1, s1 || $r$,
  testimony AS (SELECT stage,count(*) FILTER (WHERE (v#>>'{retained_testimony,claims}')::int > 0) AS n FROM stages GROUP BY stage)$r$);
  sb := replace(sb, s2, s2 || $r$
    'retained_testimony_work_orders',COALESCE((SELECT jsonb_object_agg(stage,n) FROM testimony WHERE n > 0),'{}'::jsonb),$r$);
  EXECUTE sb;
END $edit$;

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('work_order_retained_testimony','id','project_work_order_retained_testimony',
  'Typed index of retained lifecycle testimony; source id is the idempotency key. No raw writes.',
  true,'project_work_order_resource_observation(uuid)');
NOTIFY pgrst, 'reload schema';
COMMIT;
