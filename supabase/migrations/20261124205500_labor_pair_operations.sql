-- labor_pair_ops_v1: a book operation that covers a pair or a set is paid once per vehicle in reassembly, not once per
-- fitted piece.
--
-- WHY. Reassembly paid each fitted piece its operation's base_hours. ELEC-TAILLIGHTS is "Taillight assembly (pair)",
-- "Both taillights", 0.5 h; the proof vehicle has two taillight lens lines, each seen fitted, so the pair operation was
-- paid twice (1.0 h). Same shape for every book row priced per pair or set (doors, seats, mirrors, headlights ...).
--
-- WHAT CHANGES.
--   * labor_operations.max_per_vehicle int (NULL = paid per piece): how many times one vehicle can need the operation.
--     Seeded 1 only on book rows whose own name or notes say pair, both, all or complete (the operation already covers
--     the set), and on hood, rear bumper and headliner R&R (one such part on a car). Everything else stays NULL.
--   * vehicle_labor_appraisal reassembly: a fitted piece whose operation has already been paid max_per_vehicle times is
--     listed with hours 0 and counted_in_operation = <code>; matched_count still counts it.
--   * A fitted piece whose operation row exists with base_hours NULL (classification keys with no book hours, agreed
--     with the line classifier's lane) reads reason 'operation has no book hours', hours NULL, never 0.
-- Grain: one labor_operations row (code PK). Writer: this migration. Recomputes on every read; no stored output.
-- Test: supabase/sql/test_vehicle_labor_appraisal_pairs.sql (PG17).
--
-- REVERT. Redefine the function without labor_pair_ops_v1 (restore the three anchors); the column can stay.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.labor_operations
  ADD COLUMN IF NOT EXISTS max_per_vehicle integer CHECK (max_per_vehicle IS NULL OR max_per_vehicle > 0);
COMMENT ON COLUMN public.labor_operations.max_per_vehicle IS
  'labor_pair_ops_v1: how many times one vehicle can need this operation (NULL = once per piece). 1 on operations priced for a pair or set.';

UPDATE public.labor_operations SET max_per_vehicle = 1
 WHERE max_per_vehicle IS NULL
   AND code IN ('DISASM-BED', 'DISASM-DOORS', 'DISASM-GLASS-ALL', 'ELEC-HEADLIGHTS', 'ELEC-TAILLIGHTS',
                'EXH-CUTOUT-INSTALL', 'EXH-TURNDOWN-INSTALL', 'INT-CARPET-RR', 'INT-DASH-RR', 'INT-DOOR-PANELS',
                'INT-SEATS-RR', 'MECH-BRAKES-ALL', 'PAINT-COMPLETE-CAB', 'PAINT-COMPLETE-TRUCK', 'PAINT-JAMBS',
                'REASSM-DOORS', 'TRIM-MIRRORS', 'TRIM-MOLDINGS-SIDE', 'BODY-REPLACE-HOOD', 'TRIM-BUMPERS-REAR',
                'INT-HEADLINER-RR');

DO $patch$
DECLARE
  d text;
  n integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124194000.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124205500.1';
$r$;
  a_decl text := $a$  base_h numeric;
$a$;
  r_decl text := $r$  base_h numeric;
  op_cap integer; /* labor_pair_ops_v1 */
$r$;
  a_sel text := $a$          SELECT o.base_hours INTO base_h
            FROM labor_operations o
           WHERE o.code = op_code
$a$;
  r_sel text := $r$          SELECT o.base_hours, o.max_per_vehicle INTO base_h, op_cap
            FROM labor_operations o
           WHERE o.code = op_code
$r$;
  a_nohours text := $a$              'operation_code', op_code,
              'hours', NULL,
              'reason', 'no book operation'
$a$;
  r_nohours text := $r$              'operation_code', op_code,
              'hours', NULL,
              'reason', 'operation has no book hours' /* labor_pair_ops_v1 */
$r$;
  a_paid text := $a$            matched_n := matched_n + 1;
            piece_hours := piece_hours + base_h;
            pieces_matched := pieces_matched || jsonb_build_object(
              'judgment_id', piece.judgment_id,
              'item_id', piece.item_id,
              'image_id', img_id,
              'operation_code', op_code,
              'system', public.receipt_line_system(piece.description),
              'hours', base_h
            );
$a$;
  r_paid text := $r$            matched_n := matched_n + 1;
            -- labor_pair_ops_v1: an operation priced for a pair or set is paid at most max_per_vehicle times
            IF op_cap IS NOT NULL
               AND (SELECT count(*) FROM jsonb_array_elements(pieces_matched) m
                     WHERE m ->> 'operation_code' = op_code) >= op_cap THEN
              pieces_matched := pieces_matched || jsonb_build_object(
                'judgment_id', piece.judgment_id,
                'item_id', piece.item_id,
                'image_id', img_id,
                'operation_code', op_code,
                'system', public.receipt_line_system(piece.description),
                'hours', 0,
                'counted_in_operation', op_code
              );
            ELSE
              piece_hours := piece_hours + base_h;
              pieces_matched := pieces_matched || jsonb_build_object(
                'judgment_id', piece.judgment_id,
                'item_id', piece.item_id,
                'image_id', img_id,
                'operation_code', op_code,
                'system', public.receipt_line_system(piece.description),
                'hours', base_h
              );
            END IF;
$r$;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_pair_ops_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_witness_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124194000; rebase this migration';
  END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a_ver, a_decl, a_sel, a_nohours, a_paid]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'labor pair ops anchor drifted: % matches', n; END IF;
  END LOOP;
  EXECUTE replace(replace(replace(replace(replace(d, a_ver, r_ver), a_decl, r_decl), a_sel, r_sel), a_nohours, r_nohours), a_paid, r_paid);
END $patch$;
