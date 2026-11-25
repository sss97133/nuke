-- Disposable PG17: vehicle_labor_appraisal witness policy (labor_witness_v1). Two named totals side by side (witnessed,
-- with_unwitnessed_purchases) folded over labor_evidence_grade_policy rows, panels price per piece by their own witness
-- and each unwitnessed piece names its witness question state, a returned purchase is
-- no evidence, the gearbox prices what its evidence proves (remove and refit vs rebuild, one exclusive group), nothing
-- priced means unknown totals, and grades sit only on segments with evidence. Builds on the fast-reader contract (which
-- builds on the labor appraisal fixture) plus the evidence-grade and no-grade-without-evidence patches. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_fast.sql
RESET ROLE;
\ir ../migrations/20261124120000_labor_appraisal_evidence_grade.sql
\ir ../migrations/20261124200000_labor_grade_none_without_evidence.sql

-- Receipt lines carry an amount from here on (returns are negative charges).
ALTER TABLE _fixture_receipt_lines ADD COLUMN total_price numeric;
CREATE OR REPLACE FUNCTION public.receipt_work_lines(p_vehicle_id uuid, p_window_days int DEFAULT 90, p_max_images int DEFAULT 8)
RETURNS TABLE (
  item_id uuid, receipt_id uuid, line_kind text, anchor_date date, vendor_name text,
  description text, part_number text, total_price numeric, printed_hours numeric, printed_performer text
) LANGUAGE sql STABLE AS $$
  SELECT f.item_id, NULL::uuid, f.line_kind, CURRENT_DATE, NULL::text,
         f.description, f.part_number, f.total_price, f.printed_hours, NULL::text
    FROM public._fixture_receipt_lines f WHERE f.vehicle_id = p_vehicle_id
$$;
INSERT INTO labor_operations(code, name, base_hours, system) VALUES ('MECH-TRANS-RR', 'Transmission R&R', 6.0, 'mechanical');

\ir ../migrations/20261124194000_labor_witness_policy.sql
\ir ../migrations/20261124194000_labor_witness_policy.sql

CREATE FUNCTION public._seg(p_vehicle uuid, p_segment text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT s FROM jsonb_array_elements(public.vehicle_labor_appraisal(p_vehicle)->'segments') s WHERE s->>'segment' = p_segment
$$;
SET test.auth_role = 'anon';

DO $$
DECLARE a jsonb; s jsonb; t jsonb; mn numeric; mx numeric; bad int;
BEGIN
  PERFORM public.assert((SELECT count(*) FROM labor_stage_rules WHERE segment_key = 'gearbox_rebuild') = 1, 'one gearbox_rebuild row');

  -- Body metal: 'tail panel' twice is one piece (same words, no part number); 'deck filler panel' is another.
  -- Nothing witnessed: priced as the two pieces, grade parts_bought, only in with_unwitnessed_purchases; no question raised.
  s := public._seg('10000000-0000-0000-0000-000000000001', 'body_metal');
  PERFORM public.assert(s->'stage_steps'->0->>'mode' = 'per_piece', format('per piece: %s', s));
  PERFORM public.assert((s->'stage_steps'->0->>'unwitnessed_count')::int = 2 AND (s->'stage_steps'->0->>'fitted_count')::int = 0,
    format('two unwitnessed pieces: %s', s->'stage_steps'));
  PERFORM public.assert((s->>'hours_min')::numeric = 8 AND (s->>'hours_typical')::numeric = 12 AND (s->>'hours_max')::numeric = 24,
    format('2 x 4/6/12: %s', s));
  PERFORM public.assert(s->>'evidence_grade' = 'parts_bought' AND s->>'counts_in' = 'unwitnessed_purchase'
                        AND (s->>'witnessed_hours_typical')::numeric = 0, format('unwitnessed purchase: %s', s));
  PERFORM public.assert((SELECT bool_and(p->>'question_state' = 'none_raised' AND jsonb_array_length(p->'question_ids') = 0)
                           FROM jsonb_array_elements(s#>'{stage_steps,0,pieces}') p), format('no question raised: %s', s#>'{stage_steps,0,pieces}'));

  -- Gearbox: a clutch-kit line proves remove and refit (labor_operations 6 h), not a rebuild.
  s := public._seg('10000000-0000-0000-0000-000000000001', 'gearbox');
  PERFORM public.assert(s->>'status' = 'ok' AND (s->>'hours_typical')::numeric = 6 AND (s->>'hours_max')::numeric = 6,
    format('gearbox remove and refit 6 h: %s', s));
  PERFORM public.assert(s->'stage_steps'->0->>'operation_code' = 'MECH-TRANS-RR', 'operation named');
  s := public._seg('10000000-0000-0000-0000-000000000001', 'gearbox_rebuild');
  PERFORM public.assert(s->>'status' = 'no evidence' AND s->>'hours_min' IS NULL AND s->>'evidence_grade' IS NULL,
    format('no rebuild without transmission paper: %s', s));

  -- Two named totals, each a fold over the policy rows; the top-level hours equal with_unwitnessed_purchases.
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  t := a->'totals';
  SELECT sum((x->>'witnessed_hours_min')::numeric),
         sum((x->>'hours_max')::numeric) FILTER (WHERE x->>'counts_in' IN ('witnessed', 'unwitnessed_purchase'))
    INTO mn, mx FROM jsonb_array_elements(a->'segments') x;
  PERFORM public.assert((t#>>'{witnessed,hours_min}')::numeric = mn, format('witnessed total: %s', t));
  PERFORM public.assert((t#>>'{with_unwitnessed_purchases,hours_max}')::numeric = mx, format('with purchases total: %s', t));
  PERFORM public.assert(t->'hours_min' = t#>'{with_unwitnessed_purchases,hours_min}'
                        AND t->'hours_typical' = t#>'{with_unwitnessed_purchases,hours_typical}'
                        AND t->'hours_max' = t#>'{with_unwitnessed_purchases,hours_max}', format('top level = with purchases: %s', t));
  PERFORM public.assert((t#>>'{witnessed,hours_typical}')::numeric < (t->>'hours_typical')::numeric, 'witnessed is the smaller');
  PERFORM public.assert((t->>'unwitnessed_purchase_segments')::int >= 2, format('body metal and gearbox are unwitnessed purchases: %s', t));
  SELECT count(*) INTO bad FROM jsonb_array_elements(a->'segments') x
   WHERE x->>'evidence_grade' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM labor_evidence_grade_policy p WHERE p.grade = x->>'evidence_grade');
  PERFORM public.assert(bad = 0, 'every emitted grade has a policy row');
  SELECT count(*) INTO bad FROM jsonb_array_elements(a->'segments') x WHERE x->>'hours_min' IS NULL AND x->>'evidence_grade' IS NOT NULL;
  PERFORM public.assert(bad = 0, format('no grade without hours: %s', a->'segments'));

  -- Thin car: nothing priced -> totals unknown, not zero; paint and reassembly carry no grade.
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000003');
  PERFORM public.assert(a->'totals'->>'hours_typical' IS NULL AND (a->'totals'->>'priced_segments')::int = 0
                        AND a->'totals'->'witnessed' = 'null'::jsonb AND a->'totals'->'with_unwitnessed_purchases' = 'null'::jsonb,
    format('unknown totals: %s', a->'totals'));
  s := public._seg('10000000-0000-0000-0000-000000000003', 'paint');
  PERFORM public.assert(s->>'evidence_grade' IS NULL, format('paint without evidence has no grade: %s', s));
  s := public._seg('10000000-0000-0000-0000-000000000003', 'reassembly');
  PERFORM public.assert(s->>'evidence_grade' IS NULL, format('reassembly without evidence has no grade: %s', s));
END $$;

RESET ROLE;
-- One panel seen fitted, the tail panel seen not fitted; a transmission shop line with hours; a returned purchase;
-- a fitted piece on the thin car with no book operation.
INSERT INTO evidence_judgment_requests(vehicle_id, question_kind, status, params, answer) VALUES
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"deck filler panel","item_id":"c0000000-0000-0000-0000-000000000014"}', '{"installed":"yes"}'),
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"tail panel","item_id":"c0000000-0000-0000-0000-000000000015"}', '{"installed":"no"}'),
  ('10000000-0000-0000-0000-000000000003', 'receipt_part_visible', 'answered',
   '{"description":"fan clutch","item_id":"c0000000-0000-0000-0000-000000000093"}', '{"installed":"yes"}');
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description, part_number, total_price, printed_hours) VALUES
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000030', 'labor', 'rebuild transmission clutch', NULL, NULL, 9),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000031', 'part', 'quarter panel', 'QP-1', 100, NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000032', 'charge', 'quarter panel return', 'QP-1', -100, NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000033', 'part', 'core charge', 'CC-1', 20, NULL),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000034', 'charge', 'core return', 'CC-1', -20, NULL);
SET test.auth_role = 'anon';

DO $$
DECLARE a jsonb; s jsonb; g jsonb;
BEGIN
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert((a->'totals'->>'returned_lines')::int = 1, format('one returned line (a core return is not one): %s', a->'totals'));
  s := public._seg('10000000-0000-0000-0000-000000000001', 'body_metal');
  PERFORM public.assert(NOT (s->'evidence_ids' ? 'c0000000-0000-0000-0000-000000000031'), 'returned panel is not evidence');
  -- deck filler fitted (4/6/12), tail panel not fitted (never priced), nothing unwitnessed left.
  PERFORM public.assert((s->'stage_steps'->0->>'fitted_count')::int = 1 AND (s->'stage_steps'->0->>'not_fitted_count')::int = 1
                        AND (s->'stage_steps'->0->>'unwitnessed_count')::int = 0, format('witness counts: %s', s->'stage_steps'));
  PERFORM public.assert((s->>'hours_min')::numeric = 4 AND (s->>'hours_typical')::numeric = 6 AND (s->>'hours_max')::numeric = 12,
    format('one fitted panel 4/6/12: %s', s));
  PERFORM public.assert(s->>'evidence_grade' = 'fitted_in_photos' AND s->>'counts_in' = 'witnessed'
                        AND (s->>'witnessed_hours_typical')::numeric = 6, format('fitted is witnessed: %s', s));

  -- Transmission shop paper opens the rebuild; the remove-and-refit segment is counted in it, not added.
  g := public._seg('10000000-0000-0000-0000-000000000001', 'gearbox_rebuild');
  PERFORM public.assert(g->>'status' = 'ok' AND (g->>'paper_hours')::numeric = 9 AND g->>'evidence_grade' = 'shop_paper',
    format('rebuild on paper: %s', g));
  s := public._seg('10000000-0000-0000-0000-000000000001', 'gearbox');
  PERFORM public.assert(s->>'status' = 'counted_in' AND s->>'counted_in' = 'gearbox_rebuild' AND s->>'hours_min' IS NULL,
    format('remove and refit counted in the rebuild: %s', s));

  -- A fitted piece with no book operation is evidence without an hours source.
  s := public._seg('10000000-0000-0000-0000-000000000003', 'reassembly');
  PERFORM public.assert(s->>'status' = 'no book hours' AND s->>'hours_min' IS NULL, format('fitted, no hours source: %s', s));
END $$;
RESET ROLE;
-- Mixed witness: two panels fitted, one unwitnessed with an open question, one not fitted -> 3 x 4/6/12, 2 x witnessed.
INSERT INTO _fixture_receipt_lines(vehicle_id, item_id, line_kind, description, part_number, total_price) VALUES
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000040', 'part', 'floor pan', 'FP-1', 50),
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000041', 'part', 'trunk pan', 'TP-1', 50);
INSERT INTO evidence_judgment_requests(vehicle_id, question_kind, status, params, answer) VALUES
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"floor pan","item_id":"c0000000-0000-0000-0000-000000000040"}', '{"installed":"yes"}'),
  ('10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'pending',
   '{"description":"trunk pan","item_id":"c0000000-0000-0000-0000-000000000041"}', NULL);
SET test.auth_role = 'anon';
DO $$
DECLARE s jsonb; p jsonb;
BEGIN
  s := public._seg('10000000-0000-0000-0000-000000000001', 'body_metal');
  SELECT x INTO p FROM jsonb_array_elements(s#>'{stage_steps,0,pieces}') x WHERE x->>'witness' = 'unwitnessed';
  PERFORM public.assert(p->>'question_state' = 'open' AND jsonb_array_length(p->'question_ids') = 1,
    format('the unwitnessed piece names its open question: %s', p));
  PERFORM public.assert((s->'stage_steps'->0->>'fitted_count')::int = 2 AND (s->'stage_steps'->0->>'unwitnessed_count')::int = 1
                        AND (s->'stage_steps'->0->>'not_fitted_count')::int = 1, format('2 fitted, 1 unwitnessed, 1 not: %s', s->'stage_steps'));
  PERFORM public.assert((s->>'hours_min')::numeric = 12 AND (s->>'hours_typical')::numeric = 18 AND (s->>'hours_max')::numeric = 36,
    format('3 x 4/6/12: %s', s));
  PERFORM public.assert((s->>'witnessed_hours_min')::numeric = 8 AND (s->>'witnessed_hours_typical')::numeric = 12
                        AND (s->>'witnessed_hours_max')::numeric = 24, format('2 x 4/6/12 witnessed: %s', s));
END $$;
RESET ROLE;
\echo vehicle_labor_appraisal_witness: ok
