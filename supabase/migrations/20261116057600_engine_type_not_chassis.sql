-- Readers: a vehicles.engine_type that holds a listing's chassis line is not an engine value.
--
-- WHY. BaT intake from Dec 2025 to Apr 2026 parsed the Listing Details "Chassis: <id>" line into vehicles.engine_type
-- (the parser is fixed: supabase/functions/_shared/batChassis.ts). The profile then printed it as the engine
-- ("Chassis: 2V87Y3N131165 455ci V8" on bf3821e3). Where the chassis equals the vehicle's VIN, the value is being
-- cleared through correct_vehicle_text_field (prior value kept in superseded_rows). Where it differs from the VIN, or
-- the vehicle has no VIN, the row is identity evidence for an identity review and is left in place, so the readers
-- must not show it as an engine.
--
-- WHAT. Anchor patches of the deployed bodies (marker engine_type_not_chassis_v1). vehicle_facet_items and
-- vehicle_profile_read read engine_type as NULL when it starts with "chassis:" (any case). Every other value is
-- unchanged.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';

DO $migration$
DECLARE
  d text;
  anchor text;
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('engine_type_not_chassis_v1' in d) = 0 THEN
    anchor := 'v.engine_type, v.engine_size, v.engine_code';
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items engine_type anchor drifted (found % times)', n; END IF;
    d := replace(d, anchor,
      $a$CASE WHEN v.engine_type ~* '^\s*chassis\s*:' THEN NULL ELSE v.engine_type END AS engine_type /* engine_type_not_chassis_v1 */, v.engine_size, v.engine_code$a$);
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('engine_type_not_chassis_v1' in d) = 0 THEN
    anchor := 'body_style, engine_size, engine_type,';
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    IF n <> 1 THEN RAISE EXCEPTION 'vehicle_profile_read engine_type anchor drifted (found % times)', n; END IF;
    d := replace(d, anchor,
      $a$body_style, engine_size, CASE WHEN engine_type ~* '^\s*chassis\s*:' THEN NULL ELSE engine_type END AS engine_type /* engine_type_not_chassis_v1 */,$a$);
    EXECUTE d;
  END IF;
END
$migration$;

COMMIT;
