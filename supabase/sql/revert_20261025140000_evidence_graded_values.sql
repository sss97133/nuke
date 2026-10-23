-- Revert 20261025140000_evidence_graded_values (objects are new; no pre-existing data is touched).
-- Per-run data revert (preferred, keeps schema): UPDATE public.evidence_claim_values SET status='superseded' WHERE run_id='<run_id>';
BEGIN;
DROP FUNCTION IF EXISTS public.fill_graded_mileage(uuid[], uuid);
DROP VIEW IF EXISTS public.evidence_vehicle_graded_v;
DROP TABLE IF EXISTS public.evidence_claim_values;
DROP TABLE IF EXISTS public.evidence_field_validations;
DROP TABLE IF EXISTS public.evidence_extractor_runs;
DROP TABLE IF EXISTS public.evidence_grade_rubrics;
ALTER TABLE public.evidence_claims DROP CONSTRAINT IF EXISTS evidence_claims_status_chk;
ALTER TABLE public.evidence_claims DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS extractor_version;
COMMIT;
