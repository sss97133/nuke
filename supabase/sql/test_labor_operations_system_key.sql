-- Disposable PG17: labor_operations.system_key (labor_book_system_key_v1). Checks: a book row whose system text is a
-- receipt system key takes it (book_system); otherwise the system most of its stored line edges carry (line_edges); a
-- tie or no edge leaves it null; the FK and the basis CHECK hold; labor_book_coverage counts book operations by key and
-- the fleet lines by gap per system, is not readable by anon, and recomputes on read. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.receipt_line_systems (system_key text PRIMARY KEY, label text, expects_operation boolean);
INSERT INTO public.receipt_line_systems VALUES ('engine', 'Engine', true), ('brakes', 'Brakes', true),
  ('interior', 'Interior', true), ('hardware', 'Hardware', false);
CREATE TABLE public.labor_operations (code text PRIMARY KEY, name text, base_hours numeric, system text);
INSERT INTO public.labor_operations VALUES
  ('INT-SEATS', 'Seats', 3, 'interior'),          -- book_system
  ('MECH-ENGINE-X', 'Engine part', 2, 'mechanical'), -- line_edges: engine 2 of 3
  ('MECH-TIE', 'Tied', 1, 'mechanical'),          -- tie engine 1 / brakes 1: null
  ('PAINT-X', 'Paint', 4, 'paint'),               -- no edges: null
  ('INT-NOHOURS', 'No hours', NULL, 'interior');
-- guardrail-allow(center-key-fk): receipt_line_edges.receipt_item_id: synthetic fixture table in a disposable test database
CREATE TABLE public.receipt_line_edges (receipt_item_id uuid, classifier text, system_key text, operation_code text,
  PRIMARY KEY (receipt_item_id, classifier));
INSERT INTO public.receipt_line_edges VALUES
  ('00000000-0000-0000-0000-000000000001', 'labor_operation', NULL, 'MECH-ENGINE-X'),
  ('00000000-0000-0000-0000-000000000001', 'system', 'engine', NULL),
  ('00000000-0000-0000-0000-000000000002', 'labor_operation', NULL, 'MECH-ENGINE-X'),
  ('00000000-0000-0000-0000-000000000002', 'system', 'engine', NULL),
  ('00000000-0000-0000-0000-000000000003', 'labor_operation', NULL, 'MECH-ENGINE-X'),
  ('00000000-0000-0000-0000-000000000003', 'system', 'brakes', NULL),
  ('00000000-0000-0000-0000-000000000004', 'labor_operation', NULL, 'MECH-TIE'),
  ('00000000-0000-0000-0000-000000000004', 'system', 'engine', NULL),
  ('00000000-0000-0000-0000-000000000005', 'labor_operation', NULL, 'MECH-TIE'),
  ('00000000-0000-0000-0000-000000000005', 'system', 'brakes', NULL);
-- receipt_line_gaps stub: the matcher's view has this shape (item, vehicle, system, gap, amount)
CREATE TABLE public._fixture_gaps (item_id uuid, vehicle_id uuid, system_key text, gap text, total_price numeric);
INSERT INTO public._fixture_gaps VALUES
  (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', 'engine', 'no_operation', 30),
  (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', 'engine', NULL, 10),
  (gen_random_uuid(), '10000000-0000-0000-0000-000000000002', 'interior', 'operation_no_hours', -10),
  (gen_random_uuid(), '10000000-0000-0000-0000-000000000002', NULL, 'no_system', 5);
CREATE VIEW public.receipt_line_gaps AS SELECT * FROM public._fixture_gaps;
-- the grade policy as 20261125063000 left it (its constraint is replaced here)
CREATE TABLE public.labor_evidence_grade_policy (grade text PRIMARY KEY, counts_in text, rank int, meaning text,
  piece_quantifier text, unwitnessed_allowed boolean,
  CONSTRAINT labor_evidence_grade_policy_piece_rule CHECK (piece_quantifier IN ('all', 'any', 'none') AND unwitnessed_allowed IS NOT NULL
             OR piece_quantifier IS NULL AND unwitnessed_allowed IS NULL));
INSERT INTO public.labor_evidence_grade_policy VALUES ('parts_bought', 'unwitnessed_purchase', 9, 'x', 'none', true),
  ('shop_paper', 'witnessed', 1, 'x', NULL, NULL);

\ir ../migrations/20261125080000_labor_operations_system_key.sql
\ir ../migrations/20261125080000_labor_operations_system_key.sql

DO $$
DECLARE c jsonb;
BEGIN
  IF (SELECT string_agg(code || '=' || coalesce(system_key, '-') || '/' || coalesce(system_key_basis, '-'), ' ' ORDER BY code)
        FROM labor_operations)
     <> 'INT-NOHOURS=interior/book_system INT-SEATS=interior/book_system MECH-ENGINE-X=engine/line_edges MECH-TIE=-/- PAINT-X=-/-' THEN
    RAISE EXCEPTION 'derivation: %', (SELECT string_agg(code || '=' || coalesce(system_key, '-'), ' ' ORDER BY code) FROM labor_operations);
  END IF;
  BEGIN
    UPDATE labor_operations SET system_key = 'paint', system_key_basis = 'book_system' WHERE code = 'PAINT-X';
    RAISE EXCEPTION 'FK did not fire';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE labor_operations SET system_key = 'engine' WHERE code = 'PAINT-X';
    RAISE EXCEPTION 'basis CHECK did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT jsonb_object_agg(system_key, jsonb_build_array(book_operations, book_operations_with_hours, part_lines, keyed,
                                                        no_operation, operation_no_hours, gap_amount, gap_amount_share))
    INTO c FROM labor_book_coverage;
  IF c->'engine' <> '[1, 1, 2, 1, 1, 0, 30, 0.75]'::jsonb OR c->'interior' <> '[2, 1, 1, 0, 0, 1, 10, 0.25]'::jsonb
     OR c->'(no system)' IS NULL THEN
    RAISE EXCEPTION 'coverage: %', c;
  END IF;
  IF has_table_privilege('anon', 'public.labor_book_coverage', 'SELECT') THEN RAISE EXCEPTION 'anon reads amounts'; END IF;
  -- the replaced policy CHECK closes the null hole
  BEGIN
    UPDATE labor_evidence_grade_policy SET unwitnessed_allowed = true WHERE grade = 'shop_paper';
    RAISE EXCEPTION 'policy CHECK hole still open';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- recomputes on read
  UPDATE _fixture_gaps SET gap = NULL WHERE gap = 'no_operation';
  IF (SELECT keyed FROM labor_book_coverage WHERE system_key = 'engine') <> 2 THEN RAISE EXCEPTION 'not recomputed'; END IF;
END $$;
\echo labor_operations_system_key: ok
