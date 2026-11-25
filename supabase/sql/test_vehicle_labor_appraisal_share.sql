-- Disposable PG17: a stage-priced segment's witnessed hours come piece by piece from its evidence parts
-- (labor_fitted_share_v1): a fitted piece with an operation counts its book hours, a fitted piece without book hours
-- is unknown (never 0), unwitnessed and cannot_tell pieces are counted, the stage range stays in
-- with_unwitnessed_purchases. No threshold. Builds on the edges contract. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_edges.sql
RESET ROLE;
\ir ../migrations/20261124214500_labor_fitted_share.sql
\ir ../migrations/20261124214500_labor_fitted_share.sql

-- Chassis on vehicle 1: ball joint seen fitted (its operation has no book row), tie rods cannot_tell, brake pads
-- never asked.
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description, part_number, total_price) VALUES
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000060', 'part', 'tie rods', NULL, 40);
INSERT INTO evidence_judgment_requests(vehicle_id, question_kind, status, params, answer) VALUES
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"ball joint","item_id":"c0000000-0000-0000-0000-000000000004"}', '{"installed":"yes"}'),
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"tie rods","item_id":"c0000000-0000-0000-0000-000000000060"}', '{"installed":"cannot_tell"}');

SET test.auth_role = 'anon';
DO $$
DECLARE d text; s jsonb; i jsonb; e jsonb; a jsonb; p jsonb;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  PERFORM public.assert(position('fitted_share_min' IN d) = 0, 'no threshold');
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261124214500.1', 'logic version');

  s := public._seg('10000000-0000-0000-0000-000000000001', 'chassis');
  PERFORM public.assert((s#>>'{witness_share,evidence_parts}')::int = 3
                        AND (s#>>'{witness_share,fitted_with_operation}')::int = 0
                        AND (s#>>'{witness_share,fitted_without_operation}')::int = 1
                        AND (s#>>'{witness_share,cannot_tell}')::int = 1
                        AND (s#>>'{witness_share,unwitnessed}')::int = 1
                        AND (s#>>'{witness_share,none_raised}')::int = 1, format('four counts: %s', s->'witness_share'));
  PERFORM public.assert(position('fitted_share_min' IN d) = 0
                        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'labor_stage_rules'
                                         AND column_name IN ('fitted_share_min', 'fitted_share_basis')), 'no threshold column');
  SELECT x INTO p FROM jsonb_array_elements(s#>'{witness_share,pieces}') x WHERE x->>'witness' = 'fitted';
  PERFORM public.assert(p->>'reason' = 'fitted, no book hours' AND NOT (p ? 'hours'), format('fitted, no hours, never 0: %s', p));
  PERFORM public.assert(s->'witnessed_hours_min' = 'null'::jsonb AND s->'witnessed_hours_typical' = 'null'::jsonb
                        AND (s->>'witnessed_hours_max')::numeric = (s->>'hours_max')::numeric,
    format('witnessed min unknown, max = stage max: %s', s));
  PERFORM public.assert((s->>'hours_min')::numeric IS NOT NULL, 'stage range stays in with_unwitnessed_purchases');
  PERFORM public.assert((a#>>'{totals,witnessed,unknown_min_segments}')::int >= 1, format('totals say a witnessed min is unknown: %s', a->'totals'));

  -- Electrical: nothing fitted, nothing answered -> unknown ('not witnessed'), never a zero for unasked parts.
  e := public._seg('10000000-0000-0000-0000-000000000001', 'electrical');
  PERFORM public.assert(e->'witnessed_hours_min' = 'null'::jsonb AND e->'witnessed_hours_typical' = 'null'::jsonb
                        AND (e->>'witnessed_hours_max')::numeric = (e->>'hours_max')::numeric
                        AND e->>'witnessed_reason' = 'not witnessed' AND (e#>>'{witness_share,unwitnessed}')::int = 2,
    format('electrical not witnessed: %s', e));
  -- Skeptic criterion 4: fitted = 0 and not every part answered not fitted -> witnessed min unknown, on every segment.
  PERFORM public.assert(NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a->'segments') x
     WHERE x ? 'witness_share'
       AND (x#>>'{witness_share,fitted_with_operation}')::int + (x#>>'{witness_share,fitted_without_operation}')::int = 0
       AND (x#>>'{witness_share,not_fitted}')::int < (x#>>'{witness_share,evidence_parts}')::int
       AND x->'witnessed_hours_min' <> 'null'::jsonb), format('no zero for unasked parts: %s', a->'segments'));
  PERFORM public.assert(NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a->'segments') x
     WHERE x->>'counts_in' = 'unwitnessed_purchase' AND x->'witnessed_hours_min' <> 'null'::jsonb), 'bought, unanswered: unknown');

  -- Interior: seat foam fitted (INT-SEATS-RR 4.0 h), carpet set unwitnessed.
  i := public._seg('10000000-0000-0000-0000-000000000001', 'interior');
  PERFORM public.assert((i->>'witnessed_hours_min')::numeric = 4 AND (i->>'witnessed_hours_typical')::numeric = 4
                        AND (i#>>'{witness_share,fitted_share}')::numeric = 0.5, format('interior by piece: %s', i));
END $$;
RESET ROLE;

-- Evidence lands: brake pads seen fitted (MECH-BRAKES-FRONT 2.5 h) -> the witnessed min becomes known.
INSERT INTO evidence_judgment_requests(vehicle_id, question_kind, status, params, answer) VALUES
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"front brake pads","item_id":"c0000000-0000-0000-0000-000000000012"}', '{"installed":"yes"}');
SET test.auth_role = 'anon';
DO $$
DECLARE s jsonb;
BEGIN
  s := public._seg('10000000-0000-0000-0000-000000000001', 'chassis');
  PERFORM public.assert((s#>>'{witness_share,fitted_with_operation}')::int = 1
                        AND (s->>'witnessed_hours_min')::numeric = 2.5 AND (s->>'witnessed_hours_typical')::numeric = 2.5
                        AND (s->>'witnessed_hours_max')::numeric = (s->>'hours_max')::numeric, format('2.5 h witnessed: %s', s));
END $$;
RESET ROLE;
\echo vehicle_labor_appraisal_share: ok
