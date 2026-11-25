-- Disposable PG17: vehicle_labor_appraisal reads the return kind from receipt_line_rules (labor_return_rule_v1).
-- receipt_line_rule_hit is stubbed over a fixture rule table (its real contract is test_receipt_line_rules).
-- With the return rule row the read equals the read before the patch; with the row gone the returned purchase counts
-- again, so the decision lives in the row, not in the body. Builds on the part-names contract. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_part_names.sql
RESET ROLE;

CREATE TABLE public._fixture_kind_rules (rule_id text PRIMARY KEY, pattern text NOT NULL);
INSERT INTO public._fixture_kind_rules VALUES ('line_kind.100.return', '^(?!.*\mcore\M).*\mreturn');
CREATE FUNCTION public.receipt_line_rule_hit(p_classifier text, p_text text, p_part_number text DEFAULT NULL,
  p_vendor text DEFAULT NULL, p_make text DEFAULT NULL, p_year int DEFAULT NULL)
RETURNS TABLE (rule_id text, output_key text) LANGUAGE sql STABLE AS $$
  -- stub of the live reader at receipt_line_kind_rule_v1: line_kind rules only
  SELECT r.rule_id, 'return' FROM public._fixture_kind_rules r
   WHERE p_classifier = 'line_kind' AND lower(coalesce(p_text, '')) ~ r.pattern
   ORDER BY r.rule_id LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.receipt_line_rule_hit(text, text, text, text, text, int) TO anon, authenticated;

SET test.auth_role = 'anon';
CREATE TEMP TABLE _ret_before AS
  SELECT v, public.vehicle_labor_appraisal(v) AS j
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
                      '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261124222000_labor_return_rule.sql
\ir ../migrations/20261124222000_labor_return_rule.sql

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb; s jsonb;
BEGIN
  PERFORM public.assert((length(d) - length(replace(d, 'labor_return_rule_v1', ''))) / 20 = 1, 'patched once')
    FROM (SELECT pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure) d) x;
  PERFORM public.assert(position('\mreturn' IN pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure)) = 0,
                        'the return regex left the reader body');
  FOR r IN SELECT * FROM _ret_before LOOP
    a := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261124222000.1', 'version');
    PERFORM public.assert((a - 'as_of' - 'logic_version') = (r.j - 'as_of' - 'logic_version'),
                          format('vehicle %s read changed with the rule row in place', r.v));
  END LOOP;
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert((a->'totals'->>'returned_lines')::int = 1, 'one return nets: ' || (a->'totals')::text);
  s := public._seg('10000000-0000-0000-0000-000000000001', 'body_metal');
  PERFORM public.assert(NOT (s->'evidence_ids' ? 'c0000000-0000-0000-0000-000000000031'), 'returned panel is not evidence');
END $$;
RESET ROLE;

-- The row decides: with the return rule gone, nothing nets and the returned panel is evidence again.
DELETE FROM public._fixture_kind_rules;
SET test.auth_role = 'anon';
DO $$
DECLARE a jsonb; s jsonb;
BEGIN
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert((a->'totals'->>'returned_lines')::int = 0, 'no rule, no return: ' || (a->'totals')::text);
  s := public._seg('10000000-0000-0000-0000-000000000001', 'body_metal');
  PERFORM public.assert(s->'evidence_ids' ? 'c0000000-0000-0000-0000-000000000031', 'panel counts again without the rule');
END $$;
RESET ROLE;
\echo labor_return_rule: ok
