-- labor_return_rule_v1: vehicle_labor_appraisal reads which receipt line is a return from receipt_line_rules.
--
-- WHY. The reader's return netting (labor_witness_v1, 20261124194000) decided "this line is a return" with its own
-- regex ('\mreturn', not core) inside its body: a rule no other reader saw and no gate measured. 20261124221500 gave
-- receipt_line_rules a line_kind classifier; rule line_kind.100.return carries the same test as a row, promoted
-- through receipt_line_rule_propose with its evidence lines and stored measurement.
--
-- WHAT CHANGES. One condition: a line is a return when receipt_line_rule_hit('line_kind', description, part_number,
-- vendor) = 'return'. Unchanged: only a negative charge counts, it cancels one purchase line with the same part number
-- from the same vendor, oldest item id first. Grain: receipt_items.id -> receipt_line_rules.rule_id (computed edge,
-- per read). Recompute: per read; a new or retired line_kind rule changes the next read, no code change.
-- Proof vehicle, live 2026-11-24: line_kind.100.return is active (promoted, 4 lines filled, 575 compared); the
-- reader must still net returned_lines 3, with every hour unchanged.
-- Test: supabase/sql/test_vehicle_labor_appraisal_return_rule.sql (PG17).
--
-- REVERT. Redefine the function with the regex restored at the anchor below.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124220000.1';
$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261124222000.1';
$r$;
  a_ret text := $a$AND lower(x.description) ~ '\mreturn' AND lower(x.description) !~ '\mcore\M')$a$;
  r_ret text := $r$AND x.kind_rule = 'return')  -- labor_return_rule_v1: receipt_line_rules classifier line_kind$r$;
  a_src text := $a$        FROM public.receipt_work_lines(p_vehicle_id, 90, 0) x
       WHERE x.item_id IS NOT NULL) w;$a$;
  r_src text := $r$        FROM (SELECT y.*, (SELECT h.output_key
                             FROM public.receipt_line_rule_hit('line_kind', y.description, y.part_number, y.vendor_name) h) AS kind_rule
                FROM public.receipt_work_lines(p_vehicle_id, 90, 0) y) x
       WHERE x.item_id IS NOT NULL) w;$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_return_rule_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_part_names_v1' IN d) = 0 OR position('receipt_line_kind_rule_v1' IN
       pg_get_functiondef('public.receipt_line_rule_hit(text, text, text, text, text, integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124220000 or 20261124221500 is not applied; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_ret, a_src];
  repls := ARRAY[r_ver, r_ret, r_src];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor return rule anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;
