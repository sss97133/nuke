-- Extend the existing GM Pickup umbrella without changing source identity or sales qualification.
-- The browser calls this family Truck; Pickup and Truck are the same browse group.
-- Existing model families remain the children, including car-based pickups (El Camino / Caballero).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

DO $gm_trucks$
DECLARE
  sig text;
  definition text;
  old_chevy text := $c$'S10', 'S-10 Pickup'$c$;
  new_chevy text := $c$'S10', 'S-10 Pickup', 'Colorado', 'Avalanche', 'SSR', 'LUV', 'El Camino'$c$;
  old_gmc text := $c$'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'$c$;
  new_gmc text := $c$'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500', 'Canyon', 'Hummer EV Pickup'$c$;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.treemap_family_models(text,text)', 'public.treemap_family_sales(text,text,integer)'] LOOP
    definition := pg_get_functiondef(to_regprocedure(sig));
    IF definition IS NULL OR position($anchor$u.family = 'Pickup'$anchor$ IN definition) = 0 THEN
      RAISE EXCEPTION 'GM truck umbrella reader missing or changed: %', sig;
    END IF;
    -- Accept a repeated application; reject a changed membership expression rather than rewriting unrelated SQL.
    IF position(new_chevy IN definition) = 0 THEN
      IF (length(definition) - length(replace(definition, old_chevy, ''))) / length(old_chevy) <> 1 THEN
        RAISE EXCEPTION 'Chevrolet truck membership changed: %', sig;
      END IF;
      definition := replace(definition, old_chevy, new_chevy);
    END IF;
    IF position(new_gmc IN definition) = 0 THEN
      IF (length(definition) - length(replace(definition, old_gmc, ''))) / length(old_gmc) <> 1 THEN
        RAISE EXCEPTION 'GMC truck membership changed: %', sig;
      END IF;
      definition := replace(definition, old_gmc, new_gmc);
    END IF;
    EXECUTE definition;
  END LOOP;
END $gm_trucks$;

COMMIT;
