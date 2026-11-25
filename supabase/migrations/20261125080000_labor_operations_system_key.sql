-- labor_book_system_key_v1: each labor_operations row gets a foreign key to the receipt system its work belongs to,
-- and labor_book_coverage folds the book against the fleet's receipt part lines per system.
--
-- WHY. Measured live 2026-11-24: labor_operations.system is free text with no foreign key. 19 of its 67 rows sit under
-- names no receipt system uses (mechanical 10, drivetrain 1, paint 8), so a count of book operations per receipt system
-- reads 0 for engine, cooling, suspension and transmission although the book holds operations for them, and no reader
-- can join a receipt line's system to the operations that could take it.
--
-- WHAT CHANGES.
--   labor_operations.system_key   text FK receipt_line_systems(system_key), nullable.
--   labor_operations.system_key_basis  'book_system' | 'line_edges' (CHECK; null with system_key null):
--     book_system  the row's own system text is a receipt system key (53 rows);
--     line_edges   else, the system the stored receipt_line_edges put most of the lines keyed to this operation in
--                  (ties left null) (5 rows: ENG-AIR-CLEANER engine 2 of 2, ENG-IGNITION-WIRES engine 4 of 5,
--                  MECH-BRAKES-FRONT brakes 8 of 8, MECH-SUSPENSION-FRONT suspension 5 of 6, MECH-TRANS-RR
--                  transmission 2 of 2);
--     null         no basis (14 rows: 8 paint operations, which need a paint system key through schema_proposals, and
--                  MECH-BRAKES-ALL, MECH-BRAKES-REAR, MECH-EBRAKE-REBUILD, MECH-ENGINE-RR, MECH-RADIATOR-RR,
--                  TRANS-TAILSHAFT-SEAL, which no stored line has keyed yet).
--   The text column system stays as written; nothing that reads it changes.
--   labor_book_coverage (view, service_role only: it sums amounts): per receipt system, book operations by system_key
--     (and with base_hours), then over receipt_line_gaps: part lines, vehicles, keyed, no_operation,
--     operation_no_hours, and the gap amount (no_operation + operation_no_hours, abs total_price) with its share.
--     Recomputes on read.
--   labor_evidence_grade_policy_piece_rule (20261125063000) is replaced: its form let unwitnessed_allowed stand with a
--     null quantifier (a NULL CHECK passes); 0 live rows were in that state.
-- Test: supabase/sql/test_labor_operations_system_key.sql (PG17).
--
-- REVERT. DROP VIEW labor_book_coverage; ALTER TABLE labor_operations DROP COLUMN system_key_basis, DROP COLUMN system_key.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.labor_operations
  ADD COLUMN IF NOT EXISTS system_key text REFERENCES public.receipt_line_systems(system_key),
  ADD COLUMN IF NOT EXISTS system_key_basis text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labor_operations_system_key_basis') THEN
    ALTER TABLE public.labor_operations ADD CONSTRAINT labor_operations_system_key_basis
      CHECK ((system_key IS NULL) = (system_key_basis IS NULL)
             AND (system_key_basis IS NULL OR system_key_basis IN ('book_system', 'line_edges')));
  END IF;
END $$;

-- 20261125063000's labor_evidence_grade_policy_piece_rule let a row carry unwitnessed_allowed with a null quantifier
-- (NULL AND true is NULL, and a NULL CHECK passes). 0 live rows are in that state (measured 2026-11-24); replace it.
ALTER TABLE public.labor_evidence_grade_policy DROP CONSTRAINT IF EXISTS labor_evidence_grade_policy_piece_rule;
ALTER TABLE public.labor_evidence_grade_policy ADD CONSTRAINT labor_evidence_grade_policy_piece_rule
  CHECK ((piece_quantifier IS NULL) = (unwitnessed_allowed IS NULL)
         AND (piece_quantifier IS NULL OR piece_quantifier IN ('all', 'any', 'none')));
COMMENT ON COLUMN public.labor_operations.system_key IS
  'The receipt system (receipt_line_systems) this operation''s work belongs to; joins a receipt line''s system edge to the operations that could take it. Basis in system_key_basis.';
COMMENT ON COLUMN public.labor_operations.system_key_basis IS
  'book_system: the row''s own system text is a receipt system key. line_edges: the system most stored receipt_line_edges lines keyed to this operation carry (ties null). NULL with system_key NULL.';

UPDATE public.labor_operations o
   SET system_key = o.system, system_key_basis = 'book_system'
 WHERE o.system_key IS NULL
   AND EXISTS (SELECT 1 FROM public.receipt_line_systems s WHERE s.system_key = o.system);

UPDATE public.labor_operations o
   SET system_key = m.system_key, system_key_basis = 'line_edges'
  FROM (SELECT c.operation_code, c.system_key
          FROM (SELECT eo.operation_code, es.system_key, count(*) AS n,
                       rank() OVER (PARTITION BY eo.operation_code ORDER BY count(*) DESC) AS rk,
                       count(*) OVER (PARTITION BY eo.operation_code, count(*)) AS tied
                  FROM public.receipt_line_edges eo
                  JOIN public.receipt_line_edges es ON es.receipt_item_id = eo.receipt_item_id AND es.classifier = 'system'
                 WHERE eo.classifier = 'labor_operation'
                 GROUP BY eo.operation_code, es.system_key) c
         WHERE c.rk = 1 AND c.tied = 1) m
 WHERE o.system_key IS NULL AND o.code = m.operation_code;

CREATE OR REPLACE VIEW public.labor_book_coverage AS
WITH ops AS (
  SELECT system_key, count(*) AS book_operations, count(*) FILTER (WHERE base_hours IS NOT NULL) AS book_operations_with_hours
    FROM public.labor_operations WHERE system_key IS NOT NULL GROUP BY 1),
g AS (
  SELECT coalesce(system_key, '(no system)') AS system_key, count(*) AS part_lines, count(DISTINCT vehicle_id) AS vehicles,
         count(*) FILTER (WHERE gap IS NULL) AS keyed,
         count(*) FILTER (WHERE gap = 'no_operation') AS no_operation,
         count(*) FILTER (WHERE gap = 'operation_no_hours') AS operation_no_hours,
         sum(abs(total_price)) FILTER (WHERE gap IN ('no_operation', 'operation_no_hours')) AS gap_amount
    FROM public.receipt_line_gaps GROUP BY 1)
SELECT g.system_key, s.expects_operation,
       coalesce(ops.book_operations, 0) AS book_operations,
       coalesce(ops.book_operations_with_hours, 0) AS book_operations_with_hours,
       g.part_lines, g.vehicles, g.keyed, g.no_operation, g.operation_no_hours, g.gap_amount,
       round(g.gap_amount / nullif(sum(g.gap_amount) OVER (), 0), 3) AS gap_amount_share
  FROM g
  LEFT JOIN public.receipt_line_systems s ON s.system_key = g.system_key
  LEFT JOIN ops ON ops.system_key = g.system_key;
REVOKE ALL ON public.labor_book_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.labor_book_coverage TO service_role;
COMMENT ON VIEW public.labor_book_coverage IS
  'Per receipt system: labor_operations by system_key against the fleet''s vehicle-linked receipt part lines (receipt_line_gaps): keyed, no_operation, operation_no_hours, and the gap amount with its share. Recomputes on read. Service role only (amounts).';
