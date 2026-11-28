-- Disposable PG17. The full labor fold fixture is followed by a deterministic
-- qualification stub so this contract isolates the labor consumer and fold key.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_fold.sql
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

CREATE TABLE public.fixture_current_receipt_questions(id uuid PRIMARY KEY);
INSERT INTO public.fixture_current_receipt_questions SELECT id FROM public.evidence_judgment_requests;
CREATE FUNCTION public.receipt_work_current_judgments(p_vehicle_id uuid)
RETURNS TABLE(judgment_id uuid, receipt_item_id uuid, link_id uuid) LANGUAGE sql STABLE AS $$
  SELECT j.id, j.subject_id, NULL::uuid FROM public.evidence_judgment_requests j
  JOIN public.fixture_current_receipt_questions f ON f.id=j.id WHERE j.vehicle_id=p_vehicle_id
$$;
-- This fixture tests the labor half; the part consumer is exercised separately.
CREATE FUNCTION public.vehicle_part_installation_evidence(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT p_vehicle_id AS id),
  aq0 AS (
    SELECT q.id FROM v JOIN public.evidence_judgment_requests q ON q.vehicle_id = v.id
  ) SELECT coalesce(jsonb_agg(id), '[]'::jsonb) FROM aq0
$$;
CREATE TEMP TABLE before_currentness AS
  SELECT public.vehicle_labor_appraisal_compute('10000000-0000-0000-0000-000000000001') - 'as_of' AS doc,
         public.vehicle_labor_appraisal_logic_key() AS logic_key;
\ir ../migrations/20261127012805_receipt_work_current_consumers.sql

DO $$
DECLARE before_doc jsonb; after_doc jsonb; old_key text;
BEGIN
  SELECT doc, logic_key INTO before_doc, old_key FROM before_currentness;
  after_doc := public.vehicle_labor_appraisal_compute('10000000-0000-0000-0000-000000000001') - 'as_of';
  ASSERT before_doc = after_doc, 'current questions should preserve the labor result: ' ||
    (SELECT string_agg(k, ', ') FROM jsonb_object_keys(before_doc || after_doc) k WHERE before_doc->k IS DISTINCT FROM after_doc->k);
  ASSERT old_key <> public.vehicle_labor_appraisal_logic_key(), 'qualification must change the fold logic key';
  ASSERT public.labor_fold_logic_unlisted() IS NULL, 'fold closure incomplete';
  DELETE FROM public.fixture_current_receipt_questions;
  after_doc := public.vehicle_labor_appraisal_compute('10000000-0000-0000-0000-000000000001') - 'as_of';
  ASSERT before_doc -> 'segments' IS DISTINCT FROM after_doc -> 'segments', 'invalidating all questions must affect the labor fold';
  RAISE NOTICE 'labor fold consumes only qualified questions and keys its logic';
END $$;
