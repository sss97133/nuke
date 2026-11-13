-- Add 'snowmobile' and 'pwc' (personal watercraft) to the vehicle identity category vocabulary.
--
-- Why: Polaris, Yamaha, Ski-Doo, Arctic Cat and Sea-Doo rows (Indy/RMK/XC/Switchback sleds,
-- WaveRunner/GTX/RXP/Virage/SL watercraft) had no category to land in, so the cited category rules
-- held them (watchdog notes 2026-11-11, runs category_make_rules_v15/v16). ATVs and side-by-sides
-- stay cart_utility by the existing vin_body_v1 convention.
--
-- Shape: the existing owner (vehicle_identity_evidence -> vehicle_category_resolved) is extended in place;
-- no new table or reader. The resolver view passes evidence categories through unchanged.
-- category_make_rules (the cited make/model-line rules the category watchdog writes) carries the same
-- CHECK; it was created outside the repo, so it is altered only when present.
--
-- Load: both constraints are re-added NOT VALID (brief lock, no table scan) and then validated, which
-- takes only SHARE UPDATE EXCLUSIVE. The new list is a superset of the old one, so validation cannot fail.
-- Down: supabase/sql/revert_20261116010001_identity_category_snowmobile_pwc.sql (retire rows first).

SET lock_timeout = '5s';
SET statement_timeout = '50s';

ALTER TABLE public.vehicle_identity_evidence
  DROP CONSTRAINT IF EXISTS vehicle_identity_evidence_category_check,
  ADD CONSTRAINT vehicle_identity_evidence_category_check CHECK (category = ANY (ARRAY[
    'car','truck_utility','motorcycle','tractor','cart_utility','trailer_rv','boat','aircraft','memorabilia',
    'snowmobile','pwc'])) NOT VALID;
ALTER TABLE public.vehicle_identity_evidence VALIDATE CONSTRAINT vehicle_identity_evidence_category_check;

COMMENT ON CONSTRAINT vehicle_identity_evidence_category_check ON public.vehicle_identity_evidence IS
  'Identity category vocabulary. snowmobile and pwc (personal watercraft) added 2026-11-11 (20261116010000); ATV/UTV remain cart_utility.';

DO $do$
BEGIN
  IF to_regclass('public.category_make_rules') IS NOT NULL THEN
    ALTER TABLE public.category_make_rules
      DROP CONSTRAINT IF EXISTS category_make_rules_category_check,
      ADD CONSTRAINT category_make_rules_category_check CHECK (category = ANY (ARRAY[
        'car','truck_utility','motorcycle','tractor','cart_utility','trailer_rv','boat','aircraft','memorabilia',
        'snowmobile','pwc'])) NOT VALID;
    ALTER TABLE public.category_make_rules VALIDATE CONSTRAINT category_make_rules_category_check;
  END IF;
END
$do$;
