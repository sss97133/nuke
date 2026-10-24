-- Gate decision (Skylar, 2026-10-23): blind_agent validations count toward `passed` ONLY when
-- paired with an independent structured cross-check (n>=200, agreement>=0.90, same field).
-- blind_human / structured_crosscheck alone count as before. Recall rows never pass.
-- Revert: supabase/sql/revert_20261025163500_evidence_validation_crosscheck_gate.sql

ALTER TABLE public.evidence_field_validations
  ADD COLUMN IF NOT EXISTS metric text NOT NULL DEFAULT 'precision';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.evidence_field_validations'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%metric%') THEN
    ALTER TABLE public.evidence_field_validations
      ADD CONSTRAINT evidence_field_validations_metric_check CHECK (metric IN ('precision','recall'));
  END IF;
END $$;

ALTER TABLE public.evidence_field_validations
  ADD COLUMN IF NOT EXISTS crosscheck_validation_id bigint REFERENCES public.evidence_field_validations(id),
  ADD COLUMN IF NOT EXISTS independent_source boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crosscheck_source text,
  ADD COLUMN IF NOT EXISTS crosscheck_ok boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.evidence_field_validations.independent_source IS
  'structured_crosscheck rows: true only if the reference source is NOT derived from the same listing text (e.g. other-platform listing, OCR receipts, service records, a different structured extraction path).';
COMMENT ON COLUMN public.evidence_field_validations.crosscheck_ok IS
  'Trigger-maintained: linked crosscheck row is structured_crosscheck, precision, independent_source, same field, n>=200, agreement>=0.90.';

CREATE OR REPLACE FUNCTION public.evidence_validation_crosscheck_ok() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.crosscheck_ok := NEW.crosscheck_validation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.evidence_field_validations c
    WHERE c.id = NEW.crosscheck_validation_id AND c.id <> NEW.id
      AND c.method = 'structured_crosscheck' AND c.metric = 'precision' AND c.independent_source
      AND c.field = NEW.field AND c.sample_n >= 200
      AND c.correct_n::numeric / NULLIF(c.sample_n, 0) >= 0.90);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_evidence_validation_crosscheck_ok ON public.evidence_field_validations;
CREATE TRIGGER trg_evidence_validation_crosscheck_ok
  BEFORE INSERT OR UPDATE ON public.evidence_field_validations
  FOR EACH ROW EXECUTE FUNCTION public.evidence_validation_crosscheck_ok();

ALTER TABLE public.evidence_field_validations DROP COLUMN passed;
ALTER TABLE public.evidence_field_validations ADD COLUMN passed boolean GENERATED ALWAYS AS (
  metric = 'precision' AND sample_n >= 200
  AND (correct_n::numeric / NULLIF(sample_n, 0)) >= 0.90
  AND (method IN ('blind_human','structured_crosscheck')
       OR (method = 'blind_agent' AND crosscheck_ok))
) STORED;
