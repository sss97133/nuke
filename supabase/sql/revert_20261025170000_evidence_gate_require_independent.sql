-- Restores the 20261025163500 gate (structured_crosscheck passes regardless of independent_source).
ALTER TABLE public.evidence_field_validations DROP COLUMN passed;
ALTER TABLE public.evidence_field_validations ADD COLUMN passed boolean GENERATED ALWAYS AS (
  metric = 'precision' AND sample_n >= 200
  AND (correct_n::numeric / NULLIF(sample_n, 0)) >= 0.90
  AND (method IN ('blind_human','structured_crosscheck')
       OR (method = 'blind_agent' AND crosscheck_ok))
) STORED;
