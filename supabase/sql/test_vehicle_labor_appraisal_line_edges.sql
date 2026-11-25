-- Disposable PG17: vehicle_labor_appraisal reads each receipt line's system, labor operation and line kind from stored
-- receipt_line_edges rows (labor_line_edges_v1). Builds on the photo-key contract. The edge rows here are written from
-- the same stub classifiers the earlier contracts use, so the read must be identical after the switch; then the rows
-- decide: deleting a line's edges changes the read, and the classifier calls are gone from the receipt-lines
-- statement. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_photo_key.sql
RESET ROLE;

CREATE TABLE public.receipt_line_rules (
  rule_id text PRIMARY KEY, classifier text NOT NULL, status text NOT NULL, field text NOT NULL DEFAULT 'description',
  scope_vendor_pattern text, scope_make text, scope_year_min int, scope_year_max int);
INSERT INTO public.receipt_line_rules (rule_id, classifier, status) VALUES ('fixture.system', 'system', 'active');

-- guardrail-allow(center-key-fk): receipt_line_edges.receipt_item_id: synthetic fixture table in a disposable test database
CREATE TABLE public.receipt_line_edges (
  receipt_item_id uuid NOT NULL, classifier text NOT NULL, rule_id text, system_key text, operation_code text,
  line_kind text, PRIMARY KEY (receipt_item_id, classifier));
INSERT INTO public.receipt_line_edges (receipt_item_id, classifier, rule_id, system_key)
  SELECT f.item_id, 'system', 'fixture', public.receipt_line_system(f.description)
    FROM public._fixture_receipt_lines f WHERE f.item_id IS NOT NULL AND public.receipt_line_system(f.description) IS NOT NULL;
INSERT INTO public.receipt_line_edges (receipt_item_id, classifier, rule_id, operation_code)
  SELECT f.item_id, 'labor_operation', 'fixture', public.receipt_line_labor_operation(f.description)
    FROM public._fixture_receipt_lines f WHERE f.item_id IS NOT NULL AND public.receipt_line_labor_operation(f.description) IS NOT NULL;
INSERT INTO public.receipt_line_edges (receipt_item_id, classifier, rule_id, line_kind)
  SELECT f.item_id, 'line_kind', h.rule_id, h.output_key
    FROM public._fixture_receipt_lines f
    CROSS JOIN LATERAL public.receipt_line_rule_hit('line_kind', f.description, f.part_number, NULL) h
   WHERE f.item_id IS NOT NULL;

SET test.auth_role = 'anon';
CREATE TEMP TABLE _line_edges_before AS
  SELECT v, public.vehicle_labor_appraisal(v) AS j
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001',
                      '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261125030000_labor_reads_line_edges.sql
\ir ../migrations/20261125030000_labor_reads_line_edges.sql

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb; d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  PERFORM public.assert((length(d) - length(replace(d, 'labor_line_edges_v1', ''))) / 19 = 1, 'patched once');
  PERFORM public.assert(position('public.receipt_line_system(w.description)' IN d) = 0
                        AND position('receipt_line_rule_hit(''line_kind''' IN d) = 0, 'line classifier calls left the statement');
  FOR r IN SELECT * FROM _line_edges_before LOOP
    a := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261125030000.1', 'version');
    PERFORM public.assert((a - 'as_of' - 'logic_version') = (r.j - 'as_of' - 'logic_version'),
                          format('vehicle %s read changed when its edges equal the classifiers', r.v));
  END LOOP;
END $$;
RESET ROLE;

-- The rows decide: with vehicle 1's edges gone its lines carry no system or operation, so its read changes, and a
-- return line with no line_kind edge no longer nets.
DELETE FROM public.receipt_line_edges e USING public._fixture_receipt_lines f
 WHERE f.item_id = e.receipt_item_id AND f.vehicle_id = '10000000-0000-0000-0000-000000000001';
SET test.auth_role = 'anon';
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  SELECT j INTO b FROM _line_edges_before WHERE v = '10000000-0000-0000-0000-000000000001';
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert((a - 'as_of' - 'logic_version') <> (b - 'as_of' - 'logic_version'), 'edges decide the read');
  PERFORM public.assert((a->'totals'->>'returned_lines')::int = 0, 'no line_kind edge, no return: ' || (a->'totals')::text);
END $$;
RESET ROLE;
\echo labor_line_edges: ok
