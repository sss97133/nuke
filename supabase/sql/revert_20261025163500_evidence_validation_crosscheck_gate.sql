-- Restores the pre-20261025163500 gate. Keeps metric/link columns (additive, harmless).
ALTER TABLE public.evidence_field_validations DROP COLUMN passed;
ALTER TABLE public.evidence_field_validations ADD COLUMN passed boolean GENERATED ALWAYS AS (
  (method = ANY (ARRAY['blind_human','structured_crosscheck'])) AND sample_n >= 200
  AND (correct_n::numeric / NULLIF(sample_n, 0)) >= 0.9) STORED;
DROP TRIGGER IF EXISTS trg_evidence_validation_crosscheck_ok ON public.evidence_field_validations;
