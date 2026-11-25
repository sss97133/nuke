-- Disposable PG17: the not-witnessed total is named 'unwitnessed', and a part answered not fitted adds no hours
-- (labor_unwitnessed_v1). Builds on the names contract. Checks: the policy holds no 'unwitnessed_purchase' and its
-- CHECK refuses it; every read equals the read before apart from the renamed value, graded_pieces.not_fitted and the
-- new totals keys; the old totals keys equal the new ones; a segment whose evidence parts are all answered not fitted
-- (vehicle 1 electrical) is unpriced and leaves with_unwitnessed by exactly its hours. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_names.sql
RESET ROLE;

SET test.auth_role = 'anon';
CREATE TEMP TABLE _unw_before AS
  SELECT v, public.vehicle_labor_appraisal(v) AS j
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001',
                      '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261125110500_labor_unwitnessed.sql
\ir ../migrations/20261125110500_labor_unwitnessed.sql

CREATE FUNCTION public._norm_unw(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT ((j - 'as_of' - 'logic_version' - 'segments') #- '{totals,with_unwitnessed}' #- '{totals,unwitnessed_segments}')
         || jsonb_build_object('segments', (
              SELECT coalesce(jsonb_agg(s #- '{graded_pieces,not_fitted}' ORDER BY i), '[]'::jsonb)
                FROM jsonb_array_elements(j -> 'segments') WITH ORDINALITY t(s, i)))
$$;

DO $$
BEGIN
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM labor_evidence_grade_policy WHERE counts_in = 'unwitnessed_purchase')
                        AND (SELECT counts_in FROM labor_evidence_grade_policy WHERE grade = 'parts_bought') = 'unwitnessed'
                        AND (SELECT counts_in FROM labor_evidence_grade_policy WHERE grade = 'photo_key_reading') = 'unwitnessed',
                        'policy renamed');
  BEGIN
    UPDATE labor_evidence_grade_policy SET counts_in = 'unwitnessed_purchase' WHERE grade = 'parts_bought';
    RAISE EXCEPTION 'counts_in CHECK did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.assert(position('''unwitnessed_purchase''' IN pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure)) = 0,
                        'no old literal left in the body');
END $$;

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb;
BEGIN
  FOR r IN SELECT * FROM _unw_before LOOP
    a := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261125110500.1', 'version');
    PERFORM public.assert(public._norm_unw(a) = public._norm_unw(replace(r.j::text, '"unwitnessed_purchase"', '"unwitnessed"')::jsonb),
                          format('vehicle %s: only the rename and the new keys', r.v));
    PERFORM public.assert((a #> '{totals,with_unwitnessed}') IS NOT DISTINCT FROM (a #> '{totals,with_unwitnessed_purchases}')
                          AND (a #> '{totals,unwitnessed_segments}') IS NOT DISTINCT FROM (a #> '{totals,unwitnessed_purchase_segments}'),
                          'aliases equal');
  END LOOP;
END $$;
RESET ROLE;

-- The review case, step 1: one of the two evidence parts of vehicle 1's electrical segment (a stage-priced segment)
-- answered not fitted beside one still unwitnessed. That piece adds 0 h: the segment and the totals are unchanged,
-- only the piece counts move. (Per-piece segments already price only fitted + unwitnessed pieces: witness contract,
-- '3 x 4/6/12' with one panel not fitted.)
CREATE TEMP TABLE _elec_before AS SELECT public._seg('10000000-0000-0000-0000-000000000001', 'electrical') AS s,
  public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001') -> 'totals' AS t;
CREATE TEMP TABLE _elec_parts AS
  SELECT f.item_id, row_number() OVER (ORDER BY f.item_id) AS n
    FROM _elec_before b, jsonb_array_elements_text(b.s -> 'evidence_ids') e
    JOIN public._fixture_receipt_lines f ON f.item_id::text = e
   WHERE f.line_kind = 'part';
INSERT INTO evidence_judgment_requests(vehicle_id, question_kind, status, params, answer)
  SELECT '10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
         jsonb_build_object('item_id', p.item_id), '{"installed":"no"}'
    FROM _elec_parts p WHERE p.n = 1;
SET test.auth_role = 'anon';
DO $$
DECLARE b jsonb; t0 jsonb; s jsonb; t jsonb;
BEGIN
  SELECT x.s, x.t INTO b, t0 FROM _elec_before x;
  PERFORM public.assert((SELECT count(*) FROM _elec_parts) = 2 AND (b #>> '{graded_pieces,unwitnessed}')::int = 2,
                        'fixture: two unwitnessed evidence parts: ' || b::text);
  s := public._seg('10000000-0000-0000-0000-000000000001', 'electrical');
  t := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001') -> 'totals';
  PERFORM public.assert((s->>'hours_min')::numeric = (b->>'hours_min')::numeric AND (s->>'hours_max')::numeric = (b->>'hours_max')::numeric
                        AND (s #>> '{graded_pieces,not_fitted}')::int = 1 AND (s #>> '{graded_pieces,unwitnessed}')::int = 1
                        AND NOT (s -> 'graded_pieces' ? 'unpriced'), 'one not fitted beside one unwitnessed: ' || s::text);
  PERFORM public.assert(t -> 'with_unwitnessed' = t0 -> 'with_unwitnessed' AND t -> 'by_grade' = t0 -> 'by_grade',
                        'the not-fitted piece adds 0 h: ' || t::text);
END $$;
RESET ROLE;

-- Step 2: the other part answered not fitted too; nothing in the segment is work.
INSERT INTO evidence_judgment_requests(vehicle_id, question_kind, status, params, answer)
  SELECT '10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
         jsonb_build_object('item_id', p.item_id), '{"installed":"no"}'
    FROM _elec_parts p WHERE p.n = 2;
SET test.auth_role = 'anon';
DO $$
DECLARE b jsonb; t0 jsonb; s jsonb; t jsonb;
BEGIN
  SELECT x.s, x.t INTO b, t0 FROM _elec_before x;
  PERFORM public.assert((b->>'hours_min')::numeric > 0 AND (b #>> '{graded_pieces,unwitnessed}')::int > 0, 'electrical was priced: ' || b::text);
  s := public._seg('10000000-0000-0000-0000-000000000001', 'electrical');
  t := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001') -> 'totals';
  PERFORM public.assert(s->>'hours_min' IS NULL AND s->>'status' = 'no evidence'
                        AND (s #>> '{graded_pieces,not_fitted}')::int = (b #>> '{graded_pieces,unwitnessed}')::int
                        AND s #>> '{graded_pieces,unpriced}' = 'every evidence part answered not fitted', 'not fitted is no work: ' || s::text);
  PERFORM public.assert((t #>> '{with_unwitnessed,hours_min}')::numeric = (t0 #>> '{with_unwitnessed,hours_min}')::numeric - (b->>'hours_min')::numeric
                        AND (t #>> '{with_unwitnessed,hours_max}')::numeric = (t0 #>> '{with_unwitnessed,hours_max}')::numeric - (b->>'hours_max')::numeric,
                        'with_unwitnessed loses exactly the segment: ' || t::text);
  PERFORM public.assert(NOT (t -> 'by_grade' ? 'parts_bought')
                        OR (t #>> '{by_grade,parts_bought,hours_min}')::numeric
                           = (t0 #>> '{by_grade,parts_bought,hours_min}')::numeric - (b->>'hours_min')::numeric, 'by_grade drops it');
END $$;
RESET ROLE;
\echo labor_unwitnessed: ok
