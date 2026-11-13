-- Down for 20261116010001_identity_category_snowmobile_pwc. No COMMIT: run in a transaction, check, then commit.
-- The old CHECK refuses rows typed snowmobile/pwc, so retire (not delete) them first; the evidence stays as
-- retired testimony. Rows are retired by run_id so the category rules can be re-applied later.
SET lock_timeout = '5s';
SET statement_timeout = '50s';

UPDATE public.vehicle_identity_evidence SET retired_at = now()
 WHERE category IN ('snowmobile','pwc') AND retired_at IS NULL;
UPDATE public.category_make_rules SET retired_at = now()
 WHERE category IN ('snowmobile','pwc') AND retired_at IS NULL;

-- A CHECK applies to retired rows too, so the narrowed constraint is added NOT VALID: it refuses new
-- snowmobile/pwc writes while the retired rows stay in place as history.
ALTER TABLE public.vehicle_identity_evidence
  DROP CONSTRAINT IF EXISTS vehicle_identity_evidence_category_check,
  ADD CONSTRAINT vehicle_identity_evidence_category_check CHECK (category = ANY (ARRAY[
    'car','truck_utility','motorcycle','tractor','cart_utility','trailer_rv','boat','aircraft','memorabilia'])) NOT VALID;

ALTER TABLE public.category_make_rules
  DROP CONSTRAINT IF EXISTS category_make_rules_category_check,
  ADD CONSTRAINT category_make_rules_category_check CHECK (category = ANY (ARRAY[
    'car','truck_utility','motorcycle','tractor','cart_utility','trailer_rv','boat','aircraft','memorabilia'])) NOT VALID;
