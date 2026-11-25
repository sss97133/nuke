-- labor_line_edges_v1: vehicle_labor_appraisal reads each receipt line's system, labor operation and line kind from the
-- stored receipt_line_edges row (20261124234000) instead of running receipt_line_rule_hit three times per line per read.
--
-- WHY. Measured live 2026-11-24 (server, warm, after 20261124223000): the reader takes 1.4-2.1 s on the proof vehicle
-- 20d21fb0 and 1.7 s on e08bf694. Per-step timing in a pg_temp copy: 1.08 s of it is the one receipt-lines statement,
-- and removing the two text classifiers from that statement takes it from 1.09 s to 0.12 s (receipt_line_system +
-- receipt_line_labor_operation, each a receipt_line_rule_hit per line; 34 active operation rules exceed the compiled-
-- regex cache). receipt_line_edges holds the same answers as rows keyed (receipt_item_id, classifier), with an FK to
-- the rule that produced each one, kept by row triggers on receipt_items, statement triggers on receipt_line_rules and
-- an hourly re-verify (receipt-line-edges-verify).
-- Equality, measured live the same day: for every receipt_work_lines line of 20d21fb0 (285) and e08bf694 (185), the
-- stored edge equals the reader's current expression for system, labor_operation and line_kind: 0 differences.
-- It holds by construction while every active rule reads description and is unscoped (57 of 57 today); the DO block
-- refuses to switch otherwise, since the wrappers pass description only and the edge writer reads part_number.
--
-- WHAT CHANGES. Only the receipt-lines statement: three primary-key lookups on receipt_line_edges per line replace the
-- three classifier calls. No line, no edge row = no rule matched (null), as before. The piece loop over answered
-- receipt_part_visible judgments keeps the text wrappers: its text comes from the judgment's params, not the line.
-- Version 20261125030000.1. Every other field of the read is unchanged.
-- Test: supabase/sql/test_vehicle_labor_appraisal_line_edges.sql (PG17).
--
-- REVERT. Swap each anchor and replacement below and EXECUTE the body.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261124223000.1';$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261125030000.1';$r$;
  a_out text := $a$           'system', public.receipt_line_system(w.description),
           'op', public.receipt_line_labor_operation(w.description),$a$;
  r_out text := $r$           'system', w.edge_system,  -- labor_line_edges_v1: the stored edge, keyed by the line
           'op', w.edge_op,$r$;
  a_kind text := $a$        FROM (SELECT y.*, (SELECT h.output_key
                             FROM public.receipt_line_rule_hit('line_kind', y.description, y.part_number, y.vendor_name) h) AS kind_rule$a$;
  r_kind text := $r$        FROM (SELECT y.*,
                     (SELECT e.line_kind FROM public.receipt_line_edges e
                       WHERE e.receipt_item_id = y.item_id AND e.classifier = 'line_kind') AS kind_rule,
                     (SELECT e.system_key FROM public.receipt_line_edges e
                       WHERE e.receipt_item_id = y.item_id AND e.classifier = 'system') AS edge_system,
                     (SELECT e.operation_code FROM public.receipt_line_edges e
                       WHERE e.receipt_item_id = y.item_id AND e.classifier = 'labor_operation') AS edge_op$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_line_edges_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_photo_key_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261124223000; rebase this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.receipt_line_rules r
              WHERE r.status = 'active'
                AND (r.field IS DISTINCT FROM 'description' OR r.scope_vendor_pattern IS NOT NULL OR r.scope_make IS NOT NULL
                     OR r.scope_year_min IS NOT NULL OR r.scope_year_max IS NOT NULL)) THEN
    RAISE EXCEPTION 'an active receipt_line_rules row is scoped or reads part_number: the stored edge would differ from the read it replaces';
  END IF;
  anchors := ARRAY[a_ver, a_out, a_kind];
  repls := ARRAY[r_ver, r_out, r_kind];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor line edges anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;
