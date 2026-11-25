-- labor_names_v1: vehicle_labor_appraisal returns the names of the keys it cites, read from their own rows, so a
-- renderer prints words without parsing citation text or making three calls.
--
-- WHY. The renderer took rule citations and operation codes off the page (the UI is never raw text) and asked for
-- words per stage step and per operation. Both already exist as keyed rows the read points at:
-- stage_transition_labor_map.description by transition_id, labor_operations.name by operation_code.
--
-- WHAT CHANGES. One new top-level key, names:
--   names.transitions  {transition_id: {label, category, from_stage, to_stage}}  every transition_id in the read
--   names.operations   {operation_code: {name}}                                   every operation_code in the read
-- Read with jsonb_path_query over the finished segments, joined by primary key; ids with no row are left out. No other
-- field changes. No citation title is returned: the map's hours have no source row to cite yet.
-- Test: supabase/sql/test_vehicle_labor_appraisal_names.sql (PG17).
--
-- REVERT. Swap the anchors and replacements below and EXECUTE the body.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261125063000.1';$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261125073000.1';$r$;
  a_ret text := $a$    'logic_version', version,
    'as_of', now()
  );$a$;
  r_ret text := $r$    -- labor_names_v1: words for the keys this read cites, from their own rows
    'names', jsonb_build_object(
      'transitions', (SELECT coalesce(jsonb_object_agg(m.id, jsonb_build_object(
                                'label', m.description, 'category', m.category,
                                'from_stage', m.from_stage, 'to_stage', m.to_stage)), '{}'::jsonb)
                        FROM stage_transition_labor_map m
                       WHERE m.id::text IN (SELECT x #>> '{}' FROM jsonb_path_query(segments, 'lax $.**.transition_id') x
                                             WHERE jsonb_typeof(x) = 'string')),
      'operations', (SELECT coalesce(jsonb_object_agg(o.code, jsonb_build_object('name', o.name)), '{}'::jsonb)
                       FROM labor_operations o
                      WHERE o.code IN (SELECT x #>> '{}' FROM jsonb_path_query(segments, 'lax $.**.operation_code') x
                                        WHERE jsonb_typeof(x) = 'string'))),
    'logic_version', version,
    'as_of', now()
  );$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_names_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_grade_rows_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261125063000; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_ret];
  repls := ARRAY[r_ver, r_ret];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor names anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;
