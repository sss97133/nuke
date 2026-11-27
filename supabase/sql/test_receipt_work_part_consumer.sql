-- Disposable PG17. Reuse the part reader fixture and isolate consumer wiring
-- with a controllable current-question set. Qualification itself is tested in
-- test_receipt_work_judgment_currentness.sql against the actual source reader.
\set ON_ERROR_STOP on
\ir test_vehicle_part_installation_evidence.sql
\ir ../migrations/20261120020000_vehicle_part_installation_evidence.sql
\ir ../migrations/20261120050000_part_installation_rules_2.sql

CREATE TABLE public.fixture_current_receipt_questions(id uuid PRIMARY KEY);
INSERT INTO public.fixture_current_receipt_questions SELECT id FROM public.evidence_judgment_requests;
CREATE FUNCTION public.receipt_work_current_judgments(p_vehicle_id uuid)
RETURNS TABLE(judgment_id uuid, receipt_item_id uuid, link_id uuid) LANGUAGE sql STABLE AS $$
  SELECT j.id, NULL::uuid, NULL::uuid FROM public.evidence_judgment_requests j
  JOIN public.fixture_current_receipt_questions f ON f.id=j.id WHERE j.vehicle_id=p_vehicle_id
$$;
-- This fixture tests the part half; labor's actual compute is tested separately.
CREATE FUNCTION public.vehicle_labor_appraisal_compute(p_vehicle_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_visible boolean := true;
BEGIN
  IF v_visible IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  PERFORM e.id FROM public.evidence_judgment_requests e WHERE e.vehicle_id = p_vehicle_id;
  PERFORM e.id FROM public.evidence_judgment_requests e WHERE e.vehicle_id = p_vehicle_id;
  PERFORM e.id FROM public.evidence_judgment_requests e WHERE e.vehicle_id = p_vehicle_id;
  PERFORM e.id FROM public.evidence_judgment_requests e WHERE e.vehicle_id = p_vehicle_id;
  PERFORM e.id FROM public.evidence_judgment_requests e WHERE e.vehicle_id = p_vehicle_id;
  RETURN '{}'::jsonb;
END $$;
CREATE TABLE public.labor_fold_logic_functions(proname text PRIMARY KEY, counts_in_key boolean, reason text);
CREATE FUNCTION public.labor_fold_logic_unlisted() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE TEMP TABLE before_part_currentness AS
  SELECT public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a4') - 'as_of' AS doc;
\ir ../migrations/20261127012805_receipt_work_current_consumers.sql

DO $$
DECLARE before_doc jsonb; after_doc jsonb; line jsonb;
BEGIN
  SELECT doc INTO before_doc FROM before_part_currentness;
  after_doc := public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a4') - 'as_of';
  ASSERT before_doc = after_doc, 'valid questions should preserve the part result';
  DELETE FROM public.fixture_current_receipt_questions f USING public.evidence_judgment_requests q
   WHERE f.id=q.id AND q.params #>> '{context,item_id}' = '00000000-0000-0000-0000-000000000301';
  after_doc := public.vehicle_part_installation_evidence('00000000-0000-0000-0000-0000000000a4') - 'as_of';
  SELECT x INTO line FROM jsonb_array_elements(after_doc -> 'lines') x
   WHERE x ->> 'item_id' = '00000000-0000-0000-0000-000000000301';
  ASSERT line ->> 'status' = 'not_photographed' AND line ->> 'asked' = '0',
    'unqualified answer must not establish a part sighting: ' || line::text;
  RAISE NOTICE 'part reader consumes only qualified receipt questions';
END $$;
