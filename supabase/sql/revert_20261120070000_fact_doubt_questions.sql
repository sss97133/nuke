-- Revert 20261120070000_fact_doubt_questions: restore the single-kind gate and drop what the migration added.
-- Existing fact_doubt rows stay in evidence_judgment_requests (testimony is kept); the restored gate refuses them as
-- unknown_question_kind, so none can be claimed or answered.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.vehicle_open_questions(uuid);
DROP FUNCTION IF EXISTS public.evidence_public_words(text);
DROP FUNCTION IF EXISTS public.evidence_judgment_decision_settled(text, jsonb);
DROP FUNCTION IF EXISTS public.evidence_judgment_decision_key(text, jsonb);
DROP FUNCTION IF EXISTS public.evidence_judgment_ineligibility(uuid);
DROP FUNCTION IF EXISTS public.evidence_judgment_answer_problems(text, jsonb, jsonb);
DO $r$
BEGIN
  IF to_regprocedure('public.receipt_part_visible_ineligibility(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.receipt_part_visible_ineligibility(uuid) RENAME TO evidence_judgment_ineligibility;
  END IF;
  IF to_regprocedure('public.receipt_part_visible_answer_problems(text, jsonb, jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.receipt_part_visible_answer_problems(text, jsonb, jsonb) RENAME TO evidence_judgment_answer_problems;
  END IF;
END
$r$;
DROP FUNCTION IF EXISTS public.fact_doubt_ineligibility(uuid);
DROP FUNCTION IF EXISTS public.fact_doubt_answer_problems(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.fact_doubt_params_problems(jsonb);
DROP FUNCTION IF EXISTS public.fact_doubt_trigger_key(jsonb);
DROP FUNCTION IF EXISTS public.fact_doubt_evidence_state(uuid, text, uuid[], uuid[]);
RESET lock_timeout;
RESET statement_timeout;
