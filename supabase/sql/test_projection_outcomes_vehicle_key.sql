-- Isolated PostgreSQL 17 contract for 20261007181000_key_projection_outcomes_vehicle_id.sql. Synthetic rows only; never
-- production.
-- Run in an empty, disposable dm_refinement_* database:
--   createdb dm_refinement_projection_outcomes_key_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_projection_outcomes_key_ci -f supabase/sql/test_projection_outcomes_vehicle_key.sql
-- Fixtures carry the live columns of projection_outcomes (prod, 2026-10-07; no triggers on prod) and the vehicles key.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.projection_outcomes') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- A statement must be refused with foreign_key_violation.
CREATE FUNCTION pg_temp.refused(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS % (refused: %)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

-- Live shapes ------------------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text);
CREATE TABLE public.projection_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  projection_type text NOT NULL,
  projected_value numeric NOT NULL,
  projected_at timestamptz NOT NULL,
  projection_horizon text,
  actual_value numeric,
  actual_at timestamptz,
  accuracy_score numeric,
  error_pct numeric,
  model_version text,
  model_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());

-- Before the migration: one live vehicle with a prediction, and one historical orphan prediction ---------------------------
INSERT INTO public.vehicles (id, year, make, model) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1977, 'Chevrolet', 'K5 Blazer');
INSERT INTO public.projection_outcomes (id, vehicle_id, projection_type, projected_value, projected_at, projection_horizon, model_version)
VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'nuke_estimate', 100, '2026-06-01Z', 'spot', 'v1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f0', 'nuke_estimate', 200, '2026-03-01Z', 'spot', 'v1');

\ir ../migrations/20261007181000_key_projection_outcomes_vehicle_id.sql

-- The key ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('one foreign key from projection_outcomes, to vehicles(id)',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.projection_outcomes'::regclass AND contype = 'f') = 1
  AND EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conname = 'projection_outcomes_vehicle_id_fkey'
                AND c.conrelid = 'public.projection_outcomes'::regclass
                AND c.confrelid = 'public.vehicles'::regclass
                AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.projection_outcomes'::regclass AND attname = 'vehicle_id')]
                AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicles'::regclass AND attname = 'id')]));
SELECT pg_temp.ok('the key is NOT VALID (existing rows unchecked) and ON DELETE NO ACTION',
  (SELECT NOT convalidated AND confdeltype = 'a' FROM pg_constraint WHERE conname = 'projection_outcomes_vehicle_id_fkey'));
SELECT pg_temp.ok('the constraint and the column carry their comments',
  obj_description((SELECT oid FROM pg_constraint WHERE conname = 'projection_outcomes_vehicle_id_fkey'), 'pg_constraint') LIKE 'The vehicle a prediction is about.%'
  AND col_description('public.projection_outcomes'::regclass,
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.projection_outcomes'::regclass AND attname = 'vehicle_id')) LIKE 'The vehicle the prediction is about.%');

-- Rows ------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the migration wrote no row: both predictions kept, the orphan untouched',
  (SELECT count(*) FROM public.projection_outcomes) = 2
  AND (SELECT vehicle_id FROM public.projection_outcomes WHERE id = '00000000-0000-0000-0000-0000000000b2') = '00000000-0000-0000-0000-0000000000f0');

-- The writer's insert (compute-vehicle-valuation) for a vehicle that exists is admitted.
INSERT INTO public.projection_outcomes (vehicle_id, projection_type, projected_value, projected_at, projection_horizon, model_version, model_metadata)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'nuke_estimate', 110, '2026-10-07Z', 'spot', 'v1', '{"price_tier":"mid","input_count":3,"comp_count":5}');
SELECT pg_temp.ok('a prediction for an existing vehicle is admitted',
  (SELECT count(*) FROM public.projection_outcomes WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1') = 2);

SELECT pg_temp.refused('a new prediction for a missing vehicle',
  $$INSERT INTO public.projection_outcomes (vehicle_id, projection_type, projected_value, projected_at)
    VALUES ('00000000-0000-0000-0000-0000000000f1', 'nuke_estimate', 1, now())$$);
SELECT pg_temp.refused('re-keying a prediction to a missing vehicle',
  $$UPDATE public.projection_outcomes SET vehicle_id = '00000000-0000-0000-0000-0000000000f1'
    WHERE id = '00000000-0000-0000-0000-0000000000b1'$$);

-- Grading an old orphan row (vehicle_id unchanged) still works.
UPDATE public.projection_outcomes
   SET actual_value = 180, actual_at = '2026-04-01Z', accuracy_score = 1 - abs(200 - 180) / 180.0
 WHERE id = '00000000-0000-0000-0000-0000000000b2';
SELECT pg_temp.ok('grading a historical orphan prediction is admitted',
  (SELECT actual_value FROM public.projection_outcomes WHERE id = '00000000-0000-0000-0000-0000000000b2') = 180);

SELECT pg_temp.refused('deleting a vehicle that has predictions (NO ACTION keeps the log)',
  $$DELETE FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1'$$);
INSERT INTO public.projection_outcomes (vehicle_id, projection_type, projected_value, projected_at)
VALUES (NULL, 'nuke_estimate', 1, now());
SELECT pg_temp.ok('a prediction with no vehicle (NULL) stays admissible, as the column allows',
  (SELECT count(*) FROM public.projection_outcomes WHERE vehicle_id IS NULL) = 1);

-- Re-apply is a no-op ---------------------------------------------------------------------------------------------------
\ir ../migrations/20261007181000_key_projection_outcomes_vehicle_id.sql
SELECT pg_temp.ok('re-applying the migration adds no second key',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.projection_outcomes'::regclass AND contype = 'f') = 1);

\echo 'projection_outcomes vehicle key contract: all checks passed'
