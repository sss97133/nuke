-- Disposable PG17: a segment's witnessed_hours_max is the witnessed work only (labor_witnessed_max_v1). Builds on the
-- line-edges contract. Checks: nothing moves but the witnessed max fields; a segment that counts with unwitnessed
-- purchases has no witnessed max (vehicle 1 electrical, was its stage max); totals.witnessed.hours_max is the sum of
-- the known segment values and unknown_max_segments counts the rest; no known value exceeds its segment's max; the
-- witnessed total sits below the with-purchases total when a segment is unknown. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_line_edges.sql
RESET ROLE;

-- the line-edges contract ends with vehicle 1's edges deleted; put them back
INSERT INTO public.receipt_line_edges (receipt_item_id, classifier, rule_id, system_key)
  SELECT f.item_id, 'system', 'fixture', public.receipt_line_system(f.description)
    FROM public._fixture_receipt_lines f WHERE f.item_id IS NOT NULL AND public.receipt_line_system(f.description) IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO public.receipt_line_edges (receipt_item_id, classifier, rule_id, operation_code)
  SELECT f.item_id, 'labor_operation', 'fixture', public.receipt_line_labor_operation(f.description)
    FROM public._fixture_receipt_lines f WHERE f.item_id IS NOT NULL AND public.receipt_line_labor_operation(f.description) IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO public.receipt_line_edges (receipt_item_id, classifier, rule_id, line_kind)
  SELECT f.item_id, 'line_kind', h.rule_id, h.output_key
    FROM public._fixture_receipt_lines f
    CROSS JOIN LATERAL public.receipt_line_rule_hit('line_kind', f.description, f.part_number, NULL) h
   WHERE f.item_id IS NOT NULL
  ON CONFLICT DO NOTHING;

CREATE FUNCTION public._strip_wmax(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT (j - 'as_of' - 'logic_version' - 'segments') #- '{totals,witnessed}'
         || jsonb_build_object('segments', (
              SELECT coalesce(jsonb_agg((s - 'witnessed_hours_max' - 'witnessed_reason')
                       || CASE WHEN s ? 'stage_steps' THEN jsonb_build_object('stage_steps', (s -> 'stage_steps') #- '{0,witnessed_hours}')
                               ELSE '{}'::jsonb END ORDER BY i), '[]'::jsonb)
                FROM jsonb_array_elements(j -> 'segments') WITH ORDINALITY t(s, i)))
$$;

SET test.auth_role = 'anon';
CREATE TEMP TABLE _wmax_before AS
  SELECT v, public.vehicle_labor_appraisal(v) AS j
    FROM unnest(ARRAY['10000000-0000-0000-0000-000000000001',
                      '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004']::uuid[]) v;
RESET ROLE;
\ir ../migrations/20261125033000_labor_witnessed_max.sql
\ir ../migrations/20261125033000_labor_witnessed_max.sql

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb; s jsonb; b jsonb; known numeric; n_unknown int;
BEGIN
  PERFORM public.assert((length(d) - length(replace(d, 'labor_witnessed_max_v1', ''))) / 22 = 1, 'patched once')
    FROM (SELECT pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure) d) x;
  FOR r IN SELECT * FROM _wmax_before LOOP
    a := public.vehicle_labor_appraisal(r.v);
    PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261125033000.1', 'version');
    PERFORM public.assert(public._strip_wmax(a) = public._strip_wmax(r.j), format('vehicle %s: only witnessed max fields move', r.v));
    PERFORM public.assert((a #> '{totals,witnessed,hours_min}') IS NOT DISTINCT FROM (r.j #> '{totals,witnessed,hours_min}')
                          AND (a #> '{totals,witnessed,hours_typical}') IS NOT DISTINCT FROM (r.j #> '{totals,witnessed,hours_typical}'),
                          'witnessed min and typical unchanged');
    known := NULL; n_unknown := 0;
    FOR s IN SELECT x FROM jsonb_array_elements(a->'segments') x WHERE x ? 'witnessed_hours_max' LOOP
      IF s->>'witnessed_hours_max' IS NULL THEN
        n_unknown := n_unknown + 1;
      ELSE
        known := coalesce(known, 0) + (s->>'witnessed_hours_max')::numeric;
        PERFORM public.assert((s->>'witnessed_hours_max')::numeric <= (s->>'hours_max')::numeric, 'witnessed max within segment: ' || s::text);
      END IF;
      IF s->>'counts_in' = 'unwitnessed_purchase' AND s #> '{stage_steps,0,witnessed_hours}' IS NULL THEN
        PERFORM public.assert(s->>'witnessed_hours_max' IS NULL, 'unwitnessed purchase has no witnessed max: ' || s::text);
      END IF;
    END LOOP;
    IF a->'totals'->'witnessed' <> 'null'::jsonb THEN
      PERFORM public.assert((a #>> '{totals,witnessed,hours_max}')::numeric IS NOT DISTINCT FROM known, 'total is the known sum: ' || (a->'totals')::text);
      PERFORM public.assert((a #>> '{totals,witnessed,unknown_max_segments}')::int = n_unknown, 'unknown max counted');
    END IF;
  END LOOP;

  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  SELECT j INTO b FROM _wmax_before WHERE v = '10000000-0000-0000-0000-000000000001';
  s := public._seg('10000000-0000-0000-0000-000000000001', 'electrical');
  PERFORM public.assert(s->>'counts_in' = 'unwitnessed_purchase' AND s->>'witnessed_hours_max' IS NULL
                        AND (s->>'hours_max')::numeric = 20, 'electrical: bought, not witnessed, no witnessed max: ' || s::text);
  -- chassis: one fitted piece with book hours (2.5 h) and one fitted with none, so its max is unknown, not 24
  s := public._seg('10000000-0000-0000-0000-000000000001', 'chassis');
  PERFORM public.assert(s->>'witnessed_hours_max' IS NULL AND (s->>'witnessed_hours_min')::numeric = 2.5, 'chassis: ' || s::text);
  -- interior: the fitted pieces' book hours, not greatest(stage max, them)
  s := public._seg('10000000-0000-0000-0000-000000000001', 'interior');
  PERFORM public.assert((s->>'witnessed_hours_max')::numeric = 4 AND (s->>'hours_max')::numeric = 40, 'interior: ' || s::text);
  -- 186.25 before (chassis 24 + electrical 20 + interior 40 as ceilings) -> engine 53.75 + gearbox_rebuild 16 + paint 32
  -- + reassembly 0.5 + interior 4
  PERFORM public.assert((b #>> '{totals,witnessed,hours_max}')::numeric = 186.25
                        AND (a #>> '{totals,witnessed,hours_max}')::numeric = 106.25
                        AND (a #>> '{totals,witnessed,unknown_max_segments}')::int = 2, 'vehicle 1 totals: ' || (a->'totals')::text);
  PERFORM public.assert((a #>> '{totals,witnessed,hours_max}')::numeric < (a #>> '{totals,with_unwitnessed_purchases,hours_max}')::numeric,
                        'witnessed below with purchases');
END $$;
RESET ROLE;
\echo labor_witnessed_max: ok
