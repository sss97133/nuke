-- vehicle_build_reconstruction: an operation with no book hours (labor_operations.base_hours NULL, 20261124163300) is
-- not a reference operation. After 14 unpriced keys were promoted to receipt lines, the reader counted them as
-- reference_operations ("jobs at reference fitting time") and dropped their parts from parts_without_reference
-- although no hours were counted (proof car 2026-11-24: reference_operations 30, parts_without_reference 144 of 223,
-- reference_hours 56.75). Rendered by nuke_frontend/src/pages/vehicle-profile/BuildRecord.tsx and
-- garage/GarageCardAnalysis.tsx.
--
-- One condition is added to the op_code lookup. The function is being edited by other lanes the same day, so this
-- migration does not carry a copy of the body: it edits the live definition in place, and refuses unless the lookup
-- text it targets occurs exactly once.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $edit$
DECLARE
  def text := pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure);
  target constant text := 'AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)) END AS op_code';
  replacement constant text := 'AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)'
    || E'\n                 -- an operation with no book hours is keyed, not priced: it stays a part without reference here'
    || E'\n                 AND o.base_hours IS NOT NULL) END AS op_code';
  n int := (length(def) - length(replace(def, target, ''))) / length(target);
BEGIN
  IF n <> 1 THEN
    RAISE EXCEPTION 'vehicle_build_reconstruction: the op_code lookup occurs % times, expected 1; re-read the live body', n;
  END IF;
  EXECUTE replace(def, target, replacement);
END $edit$;

DO $check$ BEGIN
  IF pg_get_functiondef('public.vehicle_build_reconstruction(uuid)'::regprocedure) NOT LIKE '%AND o.base_hours IS NOT NULL) END AS op_code%' THEN
    RAISE EXCEPTION 'vehicle_build_reconstruction: priced-operation condition did not land';
  END IF;
END $check$;
