-- Disposable PG17: vehicle_labor_appraisal names the keys it cites from their own rows (labor_names_v1). Builds on the
-- grade-rows contract. Checks: nothing else in the read moves; every transition_id and operation_code in the read that
-- has a row is named, with the row's own words; a renamed row renames the read (the row decides). Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_grade_rows.sql
RESET ROLE;

SET test.auth_role = 'anon';
CREATE TEMP TABLE _labor_names_before AS
  SELECT v, public.vehicle_labor_appraisal(v) AS j
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001',
                      '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261125073000_labor_names.sql
\ir ../migrations/20261125073000_labor_names.sql

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb; k text; n_tr int := 0; n_op int := 0;
BEGIN
  FOR r IN SELECT * FROM _labor_names_before LOOP
    a := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261125073000.1', 'version');
    PERFORM public.assert((a - 'as_of' - 'logic_version' - 'names') = (r.j - 'as_of' - 'logic_version'),
                          format('vehicle %s: only names added', r.v));
    FOR k IN SELECT DISTINCT x #>> '{}' FROM jsonb_path_query(a->'segments', 'lax $.**.transition_id') x WHERE jsonb_typeof(x) = 'string' LOOP
      PERFORM public.assert(a #>> ARRAY['names', 'transitions', k, 'label']
                            = (SELECT description FROM stage_transition_labor_map WHERE id::text = k), 'transition named: ' || k);
      n_tr := n_tr + 1;
    END LOOP;
    FOR k IN SELECT DISTINCT x #>> '{}' FROM jsonb_path_query(a->'segments', 'lax $.**.operation_code') x WHERE jsonb_typeof(x) = 'string' LOOP
      IF EXISTS (SELECT 1 FROM labor_operations WHERE code = k) THEN
        PERFORM public.assert(a #>> ARRAY['names', 'operations', k, 'name'] = (SELECT name FROM labor_operations WHERE code = k),
                              'operation named: ' || k);
        n_op := n_op + 1;
      ELSE
        PERFORM public.assert(NOT (a #> '{names,operations}' ? k), 'no row, no name: ' || k);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM public.assert(n_tr > 0 AND n_op > 0, format('fixture names something: %s transitions, %s operations', n_tr, n_op));
END $$;
RESET ROLE;

-- The row decides: rename a transition and the read says the new words.
UPDATE stage_transition_labor_map SET description = 'Engine rebuilt from the original block' WHERE to_stage = 'rebuilt_original';
SET test.auth_role = 'anon';
DO $$
DECLARE a jsonb;
BEGIN
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert(EXISTS (SELECT 1 FROM jsonb_each(a #> '{names,transitions}') e
                                 WHERE e.value->>'label' = 'Engine rebuilt from the original block'), 'renamed row renames the read');
END $$;
RESET ROLE;
\echo labor_names: ok
