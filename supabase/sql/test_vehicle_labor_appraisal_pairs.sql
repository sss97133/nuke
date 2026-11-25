-- Disposable PG17: a book operation priced for a pair is paid once in reassembly (labor_pair_ops_v1). Builds on the
-- witness contract (which builds on the fast-reader and base appraisal fixtures). Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_witness.sql
RESET ROLE;

-- Two taillight lens lines seen fitted on vehicle 1, one pair operation; two front brake pad sets on vehicle 1 stay
-- per piece (no max_per_vehicle).
INSERT INTO labor_operations(code, name, base_hours, system, notes) VALUES
  ('ELEC-TAILLIGHTS', 'Taillight assembly (pair)', 0.5, 'electrical', 'Both taillights');
INSERT INTO evidence_judgment_requests(id, vehicle_id, question_kind, status, params, answer) VALUES
  ('d0000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"tail lamp lens lh","item_id":"c0000000-0000-0000-0000-000000000051"}', '{"installed":"yes"}'),
  ('d0000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"tail lamp lens rh","item_id":"c0000000-0000-0000-0000-000000000052"}', '{"installed":"yes"}');

SET test.auth_role = 'anon';
CREATE TEMP TABLE _pairs_before AS
SELECT public._seg('10000000-0000-0000-0000-000000000001', 'reassembly') AS s;
RESET ROLE;

\ir ../migrations/20261124205500_labor_pair_operations.sql
\ir ../migrations/20261124205500_labor_pair_operations.sql

SET test.auth_role = 'anon';
DO $$
DECLARE d text; b jsonb; s jsonb; tl numeric; tl0 numeric; capped int; brakes numeric;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  PERFORM public.assert((length(d) - length(replace(d, 'labor_pair_ops_v1', ''))) / length('labor_pair_ops_v1') = 3,
    'patched once');
  PERFORM public.assert((SELECT max_per_vehicle FROM labor_operations WHERE code = 'ELEC-TAILLIGHTS') = 1, 'seeded');
  PERFORM public.assert((SELECT max_per_vehicle FROM labor_operations WHERE code = 'MECH-BRAKES-FRONT') IS NULL,
    'per-piece operation left alone');

  SELECT _pairs_before.s INTO b FROM _pairs_before;
  s := public._seg('10000000-0000-0000-0000-000000000001', 'reassembly');
  SELECT sum((p->>'hours')::numeric) INTO tl0 FROM jsonb_array_elements(b#>'{reassembly,matched}') p
   WHERE p->>'operation_code' = 'ELEC-TAILLIGHTS';
  SELECT sum((p->>'hours')::numeric), count(*) FILTER (WHERE p->>'counted_in_operation' = 'ELEC-TAILLIGHTS')
    INTO tl, capped FROM jsonb_array_elements(s#>'{reassembly,matched}') p WHERE p->>'operation_code' = 'ELEC-TAILLIGHTS';
  PERFORM public.assert(tl0 = 1.0, format('before: the pair paid twice (%s)', tl0));
  PERFORM public.assert(tl = 0.5 AND capped = 1, format('after: the pair paid once, one piece counted in it: %s', s->'reassembly'));
  PERFORM public.assert((s#>>'{reassembly,matched_count}')::int = (b#>>'{reassembly,matched_count}')::int,
    'every fitted piece still listed');
  PERFORM public.assert(coalesce((s->>'hours_typical')::numeric, 0) = coalesce((b->>'hours_typical')::numeric, 0) - 0.5,
    format('reassembly hours drop by one taillight: before %s after %s', b->>'hours_typical', s->>'hours_typical'));
  SELECT sum((p->>'hours')::numeric) INTO brakes FROM jsonb_array_elements(s#>'{reassembly,matched}') p
   WHERE p->>'operation_code' = 'MECH-BRAKES-FRONT';
  PERFORM public.assert(brakes IS NOT DISTINCT FROM (SELECT sum((p->>'hours')::numeric) FROM jsonb_array_elements(b#>'{reassembly,matched}') p
                          WHERE p->>'operation_code' = 'MECH-BRAKES-FRONT'), 'uncapped operation unchanged');
  PERFORM public.assert(s->>'logic_version' IS NULL, 'segment carries no version');
  PERFORM public.assert(public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001')->>'logic_version'
                        = 'vehicle_labor_appraisal/20261124205500.1', 'logic version');
END $$;
RESET ROLE;
-- A fitted piece whose operation exists with no book hours: keyed, unpriced, never 0.
INSERT INTO labor_operations(code, name, base_hours, system) VALUES ('MECH-RADIATOR-RR', 'Radiator R&R', NULL, 'cooling');
INSERT INTO evidence_judgment_requests(id, vehicle_id, question_kind, status, params, answer) VALUES
  ('d0000000-0000-0000-0000-000000000053', '10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'answered',
   '{"description":"radiator","item_id":"c0000000-0000-0000-0000-000000000053"}', '{"installed":"yes"}');
SET test.auth_role = 'anon';
DO $$
DECLARE s jsonb; p jsonb;
BEGIN
  s := public._seg('10000000-0000-0000-0000-000000000001', 'reassembly');
  SELECT x INTO p FROM jsonb_array_elements(s#>'{reassembly,unmatched}') x WHERE x->>'operation_code' = 'MECH-RADIATOR-RR';
  PERFORM public.assert(p->>'reason' = 'operation has no book hours' AND p->'hours' = 'null'::jsonb, format('no book hours: %s', s->'reassembly'));
END $$;
RESET ROLE;
\echo vehicle_labor_appraisal_pairs: ok
