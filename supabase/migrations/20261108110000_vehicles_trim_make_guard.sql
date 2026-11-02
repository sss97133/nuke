-- fix(vehicles): guard against space-padded make.
-- 46 vehicles carry a make with a leading or trailing space ('Ducati ', ' REO', ...). Exact make matching
-- (get_comps_scored, the exact-make find_bat_comps) never matches them. This is the additive guard; the
-- one-time cleanup is the next migration (20261108110100_vehicles_trim_make_backfill.sql).
--
-- BEFORE INSERT OR UPDATE OF make: trims leading/trailing spaces from the value being written. Named trg_00_...
-- so it fires before the other BEFORE triggers (trg_sanitize_make, trg_auto_normalize_model, ...) and they see
-- the trimmed value. Rules:
--   * NULL and whitespace-only values are left alone (trg_sanitize_make decides what to do with garbage).
--   * On UPDATE it only acts when make is actually changing, so an old padded row that is deliberately left
--     alone (see vehicle_make_trim_log, action excluded_*) keeps updating normally.
--   * It changes nothing but spaces: no case change, no alias or canonical mapping.
-- Revert: scripts/vehicles/revert_make_trim_v1_20261102.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.trim_vehicle_make()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.make IS NOT NULL
     AND NEW.make <> btrim(NEW.make)
     AND btrim(NEW.make) <> ''
     AND (TG_OP = 'INSERT' OR NEW.make IS DISTINCT FROM OLD.make) THEN
    NEW.make := btrim(NEW.make);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_00_trim_make ON public.vehicles;
CREATE TRIGGER trg_00_trim_make
  BEFORE INSERT OR UPDATE OF make ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.trim_vehicle_make();

COMMIT;
