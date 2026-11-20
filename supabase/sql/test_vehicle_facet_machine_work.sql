-- Disposable PG17: the engine panel's machine_work item reads machine-shop work lines (facet_machine_work_v1).
-- Reuses the facet fixture, stubs vehicle_build_reconstruction (its own contract is test_vehicle_build_reconstruction.sql)
-- with a function returning synthetic systems, and proves: present as a claim (never established) with one source per
-- shop, line ids as witness, date span and printed hours; no amounts, descriptions or contact details; bore stays
-- missing; a car without machining lines stays missing; other dimensions do not call the reconstruction; the patch
-- applies once. Every fixture is synthetic.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;

CREATE TABLE public.t_recon_calls (n integer);
CREATE FUNCTION public.vehicle_build_reconstruction(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.t_recon_calls VALUES (1);
  IF p_vehicle_id <> '10000000-0000-0000-0000-000000000001' THEN
    RETURN jsonb_build_object('systems', jsonb_build_array(jsonb_build_object('system_key', 'brakes', 'lines', '[]'::jsonb)));
  END IF;
  RETURN jsonb_build_object('amounts_visible', false, 'systems', jsonb_build_array(
    jsonb_build_object('system_key', 'machining', 'lines', jsonb_build_array(
      jsonb_build_object('item_id', 'a0000000-0000-0000-0000-000000000001', 'kind', 'labor', 'day', '2024-09-26',
        'source', 'Fixture Machine Co', 'description', 'Bore cylinders .060 call 702-555-0100', 'paper_hours', 3.5, 'amount', NULL),
      jsonb_build_object('item_id', 'a0000000-0000-0000-0000-000000000002', 'kind', 'labor', 'day', '2024-12-18',
        'source', 'Fixture Machine Co', 'description', 'Hone cylinders', 'paper_hours', 2, 'amount', NULL),
      jsonb_build_object('item_id', 'a0000000-0000-0000-0000-000000000003', 'kind', 'service', 'day', '2025-01-13',
        'source', 'Fixture Machine Co', 'description', 'Valve Job', 'paper_hours', NULL, 'amount', NULL),
      jsonb_build_object('item_id', 'a0000000-0000-0000-0000-000000000004', 'kind', 'service', 'day', '2025-02-01',
        'source', 'Second Shop', 'description', 'Surface Heads', 'paper_hours', NULL, 'amount', NULL),
      jsonb_build_object('item_id', 'a0000000-0000-0000-0000-000000000005', 'kind', 'part', 'day', '2025-02-01',
        'source', 'Parts Supplier', 'description', 'Cam bearings', 'paper_hours', NULL, 'amount', NULL))),
    jsonb_build_object('system_key', 'brakes', 'lines', '[]'::jsonb)));
END $$;
GRANT EXECUTE ON FUNCTION public.vehicle_build_reconstruction(uuid) TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.t_recon_calls TO anon, authenticated, service_role;

-- The patch applies once; a second run is a no-op.
\ir ../migrations/20261120010000_facet_engine_machine_work.sql
\ir ../migrations/20261120010000_facet_engine_machine_work.sql

SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE item jsonb; bore jsonb; txt text; n0 integer;
BEGIN
  PERFORM public.t_assert((length(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure))
      - length(replace(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure), 'facet_machine_work_v1_end', '')))
      / length('facet_machine_work_v1_end') = 1, 'machine work branch patched once');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.machine_work');
  PERFORM public.t_assert(item->>'status' = 'claim', format('present as a claim, never established; got %s', item->>'status'));
  PERFORM public.t_assert(jsonb_array_length(item->'sources') = 2, 'one source per shop (parts lines excluded)');
  PERFORM public.t_assert(item->'needed' IS NOT NULL AND item->>'needed' LIKE '%keyed to this engine%', 'the engine-keyed work order is still needed');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s->>'label' = 'Fixture Machine Co' AND s#>>'{decoded,lines}' = '3' AND s#>>'{decoded,first_day}' = '2024-09-26'
        AND s#>>'{decoded,last_day}' = '2025-01-13' AND (s#>>'{decoded,printed_hours}')::numeric = 5.5
        AND jsonb_array_length(s#>'{witness,ids}') = 3 AND s#>>'{witness,id}' = 'a0000000-0000-0000-0000-000000000001'
        AND s->>'value' = '3 work lines, 2024-09-26 to 2025-01-13, 5.5 printed hours'
        AND s->>'limitation' LIKE '%by serial%' AND s->>'class' = 'claim'),
    format('shop source carries lines, span, hours and witness ids; got %s', item->'sources'));
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s->>'label' = 'Second Shop' AND s->>'value' = '1 work line, 2025-02-01' AND s#>'{decoded,printed_hours}' IS NULL),
    'single line, no printed hours, no hours text');
  txt := item::text;
  PERFORM public.t_assert(txt !~* '(amount|price|\$|702-555|call|bore cylinders|Parts Supplier)', format('no amounts, description text, contacts or parts supplier; got %s', txt));
  -- Bore is not derived from "bore .060": its base is not on the paper.
  bore := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.bore');
  PERFORM public.t_assert(bore->>'status' = 'missing' AND bore->'value' = 'null'::jsonb, 'bore stays missing');
  -- A car with no machining lines stays missing.
  item := public.t_item('10000000-0000-0000-0000-000000000002', 'engine', 'engine.current.machine_work');
  PERFORM public.t_assert(item->>'status' = 'missing' AND jsonb_array_length(item->'sources') = 0, 'no machining lines: missing');
  -- The masthead and the whole read carry it; other dimensions do not call the reconstruction.
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'masthead')->'engine') x
    WHERE x->>'key' = 'engine.current.machine_work' AND x->>'status' = 'claim'), 'masthead carries the item');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001')->'engine') x
    WHERE x->>'key' = 'engine.current.machine_work' AND x->>'status' = 'claim'), 'whole read carries the item');
  SELECT count(*) INTO n0 FROM public.t_recon_calls;
  PERFORM public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'transmission');
  PERFORM public.t_assert((SELECT count(*) FROM public.t_recon_calls) = n0, 'transmission dimension does not call the reconstruction');
END $$;
RESET ROLE;
SELECT 'vehicle facet machine work: PASS' AS result;
