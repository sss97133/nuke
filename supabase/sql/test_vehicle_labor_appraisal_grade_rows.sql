-- Disposable PG17: a segment's piece grade is read from labor_evidence_grade_policy rows (labor_grade_rows_v1).
-- Builds on the witnessed-max contract. Checks (review criteria C5 and C6): the policy columns and their CHECK; no
-- 'fitted_n > 0' grade left in the body; hours, witnessed and with-purchases totals unchanged; every piece-graded
-- segment is fitted_in_photos only when no piece is unwitnessed, else parts_bought; a mixed segment splits across
-- by_grade and by_grade still adds up to the totals; witnessed max never exceeds the segment max (C5); the rows decide
-- (re-ranking the policy rows re-grades the mixed segment). Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_witnessed_max.sql
RESET ROLE;

SET test.auth_role = 'anon';
CREATE TEMP TABLE _rows_before AS
  SELECT v, public.vehicle_labor_appraisal(v) AS j
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001',
                      '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261125063000_labor_grade_from_rows.sql
\ir ../migrations/20261125063000_labor_grade_from_rows.sql

DO $$
BEGIN
  PERFORM public.assert((SELECT piece_quantifier || '/' || unwitnessed_allowed FROM labor_evidence_grade_policy WHERE grade = 'fitted_in_photos') = 'all/false'
                        AND (SELECT piece_quantifier || '/' || unwitnessed_allowed FROM labor_evidence_grade_policy WHERE grade = 'parts_bought') = 'none/true',
                        'seeded quantifiers');
  BEGIN
    UPDATE labor_evidence_grade_policy SET piece_quantifier = 'most' WHERE grade = 'parts_bought';
    RAISE EXCEPTION 'quantifier CHECK did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE labor_evidence_grade_policy SET unwitnessed_allowed = NULL WHERE grade = 'parts_bought';
    RAISE EXCEPTION 'pair CHECK did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.assert(position('fitted_n > 0' IN pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure)) = 0,
                        'no any-one-fitted grade left in the body');
END $$;

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb; s jsonb; g jsonb; n_mixed int := 0; f int; u int;
BEGIN
  FOR r IN SELECT * FROM _rows_before LOOP
    a := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261125063000.1', 'version');
    PERFORM public.assert((a #> '{totals,witnessed}') IS NOT DISTINCT FROM (r.j #> '{totals,witnessed}')
                          AND (a #> '{totals,with_unwitnessed_purchases}') IS NOT DISTINCT FROM (r.j #> '{totals,with_unwitnessed_purchases}'),
                          format('vehicle %s totals unchanged', r.v));
    FOR s IN SELECT x FROM jsonb_array_elements(a->'segments') x WHERE x->>'hours_min' IS NOT NULL LOOP
      -- C5: witnessed max is witnessed work, within the segment
      PERFORM public.assert(s->>'witnessed_hours_max' IS NULL OR (s->>'witnessed_hours_max')::numeric <= (s->>'hours_max')::numeric,
                            'C5: ' || s::text);
      IF s ? 'graded_pieces' AND s->'graded_pieces' <> 'null'::jsonb THEN
        f := (s #>> '{graded_pieces,fitted}')::int;
        u := (s #>> '{graded_pieces,unwitnessed}')::int;
        -- C6: the grade follows the counts through the rows
        PERFORM public.assert(s->>'evidence_grade' = CASE WHEN f > 0 AND u = 0 THEN 'fitted_in_photos' ELSE 'parts_bought' END,
                              'C6 grade: ' || s::text);
        PERFORM public.assert((s #>> '{graded_pieces,witnessed_grade}' IS NOT NULL) = (f > 0 AND u > 0), 'mixed marker: ' || s::text);
        IF f > 0 AND u > 0 THEN n_mixed := n_mixed + 1; END IF;
      END IF;
    END LOOP;
    -- by_grade adds up to the totals
    IF a #> '{totals,with_unwitnessed_purchases}' <> 'null'::jsonb THEN
      SELECT jsonb_build_object('mn', sum((value->>'hours_min')::numeric), 'ty', sum((value->>'hours_typical')::numeric))
        INTO g FROM jsonb_each(a #> '{totals,by_grade}') WHERE key IN (SELECT grade FROM labor_evidence_grade_policy WHERE counts_in IN ('witnessed', 'unwitnessed_purchase'));
      PERFORM public.assert((g->>'mn')::numeric = (a #>> '{totals,with_unwitnessed_purchases,hours_min}')::numeric
                            AND (g->>'ty')::numeric = (a #>> '{totals,with_unwitnessed_purchases,hours_typical}')::numeric,
                            format('vehicle %s by_grade adds up: %s vs %s', r.v, g, a #> '{totals,with_unwitnessed_purchases}'));
    END IF;
  END LOOP;
  PERFORM public.assert(n_mixed > 0, 'the fixture holds a mixed segment');
END $$;
RESET ROLE;

-- The rows decide: rank fitted_in_photos below parts_bought and the mixed segment takes fitted_in_photos.
UPDATE labor_evidence_grade_policy SET rank = 10 WHERE grade = 'fitted_in_photos';
SET test.auth_role = 'anon';
DO $$
DECLARE s jsonb;
BEGIN
  SELECT x INTO s FROM jsonb_array_elements(public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001')->'segments') x
   WHERE x #>> '{graded_pieces,witnessed_grade}' IS NOT NULL LIMIT 1;
  PERFORM public.assert(s->>'evidence_grade' = 'fitted_in_photos', 'policy rank decides: ' || coalesce(s::text, 'no mixed segment'));
END $$;
RESET ROLE;
UPDATE labor_evidence_grade_policy SET rank = 3 WHERE grade = 'fitted_in_photos';
\echo labor_grade_rows: ok
