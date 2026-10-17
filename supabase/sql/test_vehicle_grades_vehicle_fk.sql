-- Isolated PostgreSQL 17 contract for 20261010084500_key_vehicle_grades_vehicle_fk.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_vehicle_grades_fk_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_grades_fk_ci -f supabase/sql/test_vehicle_grades_vehicle_fk.sql
-- Built and migrated as a non-superuser that owns the tables, like prod's deploy role. Shapes read from prod on
-- 2026-10-10: vehicle_grades (16 columns, PRIMARY KEY vehicle_id, no other constraint), the vehicles columns the writer
-- updates, the live bodies of persist_vehicle_grade(uuid), trigger_regrade_vehicle() and trigger_regrade_vehicle_stmt().
-- compute_vehicle_grade is a constant shim (the contract is about the key, not the grade arithmetic). An orphan grade
-- row is written before the migration, the way prod holds about 3.7% of its rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_grades') IS NOT NULL
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes -------------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicles(
  id uuid PRIMARY KEY, quality_grade numeric, investment_grade numeric, investment_confidence integer);
CREATE TABLE public.vehicle_grades(
  vehicle_id uuid NOT NULL PRIMARY KEY,
  grade numeric, grade_label text, grade_floor numeric, grade_ceiling numeric,
  confidence text DEFAULT 'insufficient'::text, is_gradeable boolean DEFAULT false, total_evidence integer DEFAULT 0,
  dimensions jsonb, calculated_at timestamptz DEFAULT now(),
  doc_score numeric, maint_score numeric, prov_score numeric, photo_score numeric, market_score numeric,
  condition_score numeric);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);

CREATE TYPE public.grade_dimension AS (
  dimension text, raw_score numeric, weight numeric, evidence_count integer, confidence text, notes text);
CREATE TYPE public.grade_result AS (
  grade numeric, grade_label text, grade_floor numeric, grade_ceiling numeric, confidence text,
  is_gradeable boolean, total_evidence integer, dimensions public.grade_dimension[]);

CREATE FUNCTION public.compute_vehicle_grade(p_vehicle_id uuid) RETURNS public.grade_result
LANGUAGE sql AS $$
  SELECT ROW(7.5, 'B', 7.0, 8.0, 'medium', true, 3,
             ARRAY[ROW('documentation', 7, 0.2, 1, 'medium', NULL)::public.grade_dimension])::public.grade_result
$$;

-- persist_vehicle_grade: the live body (prod, 2026-10-10)
CREATE FUNCTION public.persist_vehicle_grade(p_vehicle_id uuid) RETURNS public.vehicle_grades
LANGUAGE plpgsql AS $$
DECLARE
  g grade_result;
  row vehicle_grades;
  dims JSONB := '[]'::JSONB;
  conf_int INTEGER;
BEGIN
  g := compute_vehicle_grade(p_vehicle_id);

  -- Serialize dimensions to JSONB
  FOR i IN 1..COALESCE(array_length(g.dimensions, 1), 0) LOOP
    dims := dims || jsonb_build_object(
      'dimension', g.dimensions[i].dimension,
      'score', g.dimensions[i].raw_score,
      'weight', g.dimensions[i].weight,
      'evidence', g.dimensions[i].evidence_count,
      'confidence', g.dimensions[i].confidence,
      'notes', g.dimensions[i].notes
    );
  END LOOP;

  INSERT INTO vehicle_grades (
    vehicle_id, grade, grade_label, grade_floor, grade_ceiling,
    confidence, is_gradeable, total_evidence, dimensions, calculated_at,
    doc_score, maint_score, prov_score, photo_score, market_score, condition_score
  ) VALUES (
    p_vehicle_id, g.grade, g.grade_label, g.grade_floor, g.grade_ceiling,
    g.confidence, g.is_gradeable, g.total_evidence, dims, NOW(),
    g.dimensions[1].raw_score, g.dimensions[2].raw_score, g.dimensions[3].raw_score,
    g.dimensions[4].raw_score, g.dimensions[5].raw_score, g.dimensions[6].raw_score
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    grade = EXCLUDED.grade,
    grade_label = EXCLUDED.grade_label,
    grade_floor = EXCLUDED.grade_floor,
    grade_ceiling = EXCLUDED.grade_ceiling,
    confidence = EXCLUDED.confidence,
    is_gradeable = EXCLUDED.is_gradeable,
    total_evidence = EXCLUDED.total_evidence,
    dimensions = EXCLUDED.dimensions,
    calculated_at = EXCLUDED.calculated_at,
    doc_score = EXCLUDED.doc_score,
    maint_score = EXCLUDED.maint_score,
    prov_score = EXCLUDED.prov_score,
    photo_score = EXCLUDED.photo_score,
    market_score = EXCLUDED.market_score,
    condition_score = EXCLUDED.condition_score
  RETURNING * INTO row;

  conf_int := CASE g.confidence
    WHEN 'high' THEN 90
    WHEN 'medium' THEN 60
    WHEN 'low' THEN 30
    WHEN 'insufficient' THEN 5
    ELSE 0
  END;

  UPDATE vehicles SET
    quality_grade = g.grade,
    investment_grade = g.grade,
    investment_confidence = conf_int
  WHERE id = p_vehicle_id;

  RETURN row;
END;
$$;

-- trigger_regrade_vehicle / trigger_regrade_vehicle_stmt: the live bodies (prod, 2026-10-10)
CREATE FUNCTION public.trigger_regrade_vehicle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM persist_vehicle_grade(NEW.vehicle_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.trigger_regrade_vehicle_stmt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL LOOP
    BEGIN
      PERFORM persist_vehicle_grade(v);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_regrade_on_timeline AFTER INSERT ON public.timeline_events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_regrade_vehicle();
CREATE TRIGGER trg_regrade_on_image AFTER INSERT ON public.vehicle_images
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trigger_regrade_vehicle_stmt();

-- Prod-like state before the migration: two vehicles, one graded; one orphan grade --------------------------------
INSERT INTO public.vehicles(id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a4');
SELECT public.persist_vehicle_grade('00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.vehicle_grades(vehicle_id, grade) VALUES ('00000000-0000-0000-0000-00000000dead', 4.0);
SELECT pg_temp.ok('before: the orphan grade exists without a vehicle',
  (SELECT count(*) FROM public.vehicle_grades g
    WHERE NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = g.vehicle_id)) = 1);

-- Apply the migration -----------------------------------------------------------------------------------------------
\ir ../migrations/20261010084500_key_vehicle_grades_vehicle_fk.sql

SELECT pg_temp.ok('the key exists, NOT VALID, ON DELETE CASCADE, to vehicles(id)',
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'vehicle_grades_vehicle_id_fkey' AND conrelid = 'public.vehicle_grades'::regclass
             AND contype = 'f' AND confrelid = 'public.vehicles'::regclass
             AND NOT convalidated AND confdeltype = 'c'));
SELECT pg_temp.ok('the key carries its comment',
  (SELECT obj_description(oid, 'pg_constraint') FROM pg_constraint WHERE conname = 'vehicle_grades_vehicle_id_fkey')
    LIKE 'The graded vehicle.%');
SELECT pg_temp.ok('the existing orphan grade is kept (NOT VALID, nothing deleted)',
  EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-00000000dead'));

-- The writer on an existing vehicle: insert, then upsert ------------------------------------------------------------
SELECT public.persist_vehicle_grade('00000000-0000-0000-0000-0000000000a2');
SELECT pg_temp.ok('writer: a grade lands for an existing vehicle and is denormalized onto it',
  EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2' AND grade = 7.5)
  AND (SELECT investment_confidence FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a2') = 60);
SELECT public.persist_vehicle_grade('00000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.ok('writer: the upsert on an existing graded vehicle still succeeds (one row)',
  (SELECT count(*) FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1') = 1);

-- The writer on a missing vehicle: refused with 23503 ---------------------------------------------------------------
DO $$
DECLARE v_state text;
BEGIN
  BEGIN
    PERFORM public.persist_vehicle_grade('00000000-0000-0000-0000-00000000beef');
    v_state := 'no error';
  EXCEPTION WHEN foreign_key_violation THEN
    v_state := '23503';
  END;
  PERFORM pg_temp.ok('writer: a grade for a missing vehicle is refused with foreign_key_violation', v_state = '23503');
END $$;
SELECT pg_temp.ok('writer: no orphan grade row was written for the missing vehicle',
  NOT EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-00000000beef'));

-- The writer re-grading the pre-existing orphan: vehicle_id unchanged, so the key is not re-checked -----------------
SELECT public.persist_vehicle_grade('00000000-0000-0000-0000-00000000dead');
SELECT pg_temp.ok('writer: re-grading a pre-existing orphan row updates it in place',
  (SELECT grade FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-00000000dead') = 7.5);

-- Row trigger caller: an insert for a missing vehicle is never blocked ---------------------------------------------
INSERT INTO public.timeline_events(vehicle_id) VALUES ('00000000-0000-0000-0000-00000000cafe');
SELECT pg_temp.ok('row trigger: the timeline insert for a missing vehicle succeeds',
  EXISTS (SELECT 1 FROM public.timeline_events WHERE vehicle_id = '00000000-0000-0000-0000-00000000cafe'));
SELECT pg_temp.ok('row trigger: and leaves no orphan grade',
  NOT EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-00000000cafe'));
INSERT INTO public.timeline_events(vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000a3');
SELECT pg_temp.ok('row trigger: a timeline insert for an existing vehicle grades it',
  EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a3'));

-- Statement trigger caller: a mixed batch inserts every image; only the existing vehicle is graded -----------------
INSERT INTO public.vehicle_images(vehicle_id) VALUES
  ('00000000-0000-0000-0000-0000000000a4'), ('00000000-0000-0000-0000-00000000f00d'), (NULL);
SELECT pg_temp.ok('statement trigger: all three image rows land',
  (SELECT count(*) FROM public.vehicle_images) = 3);
SELECT pg_temp.ok('statement trigger: the existing vehicle is graded, the missing one is not',
  EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a4')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-00000000f00d'));

-- Direct writes ------------------------------------------------------------------------------------------------------
DO $$
DECLARE v_state text;
BEGIN
  BEGIN
    UPDATE public.vehicle_grades SET vehicle_id = '00000000-0000-0000-0000-00000000babe'
     WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a4';
    v_state := 'no error';
  EXCEPTION WHEN foreign_key_violation THEN
    v_state := '23503';
  END;
  PERFORM pg_temp.ok('re-keying a grade to a missing vehicle is refused', v_state = '23503');
END $$;

-- Vehicle deletion cascades to its grade only -------------------------------------------------------------------------
DELETE FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.ok('deleting a vehicle removes its grade (ON DELETE CASCADE)',
  NOT EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2'));
SELECT pg_temp.ok('the other grades are untouched: a1, a3, a4 and the pre-existing orphan',
  (SELECT count(*) FROM public.vehicle_grades) = 4
  AND EXISTS (SELECT 1 FROM public.vehicle_grades WHERE vehicle_id = '00000000-0000-0000-0000-00000000dead'));

-- Idempotence guard: the migration is not re-runnable as is (ADD CONSTRAINT would collide); a second apply must fail
-- loudly rather than add a twin key.
DO $$
DECLARE v_state text;
BEGIN
  BEGIN
    ALTER TABLE public.vehicle_grades ADD CONSTRAINT vehicle_grades_vehicle_id_fkey
      FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE NOT VALID;
    v_state := 'no error';
  EXCEPTION WHEN duplicate_object THEN
    v_state := '42710';
  END;
  PERFORM pg_temp.ok('a second ADD CONSTRAINT collides instead of adding a twin key', v_state = '42710');
END $$;
SELECT pg_temp.ok('exactly one foreign key on vehicle_grades',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.vehicle_grades'::regclass AND contype = 'f') = 1);

RESET ROLE;
\echo 'vehicle_grades vehicle key contract: all assertions passed'
