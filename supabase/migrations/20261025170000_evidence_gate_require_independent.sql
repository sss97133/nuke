-- Gate tightening (Skylar, 2026-10-23): a structured_crosscheck row counts toward `passed` only when
-- its reference source is independent of the listing text (independent_source = true).
-- Effect: validation id 1 (graded-v1 mileage vs vehicles.mileage, same BaT text) stops passing;
-- it is superseded by id 23 (graded-v2 mileage vs other-platform listings, independent).
-- Revert: supabase/sql/revert_20261025170000_evidence_gate_require_independent.sql

ALTER TABLE public.evidence_field_validations DROP COLUMN passed;
ALTER TABLE public.evidence_field_validations ADD COLUMN passed boolean GENERATED ALWAYS AS (
  metric = 'precision' AND sample_n >= 200
  AND (correct_n::numeric / NULLIF(sample_n, 0)) >= 0.90
  AND (method = 'blind_human'
       OR (method = 'structured_crosscheck' AND independent_source)
       OR (method = 'blind_agent' AND crosscheck_ok))
) STORED;

COMMENT ON COLUMN public.evidence_field_validations.passed IS
  'precision metric, n>=200, ratio>=0.90, and: blind_human; or structured_crosscheck with independent_source; or blind_agent with crosscheck_ok.';
