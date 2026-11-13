-- Disposable PG17 only. The facet items contract (which composes vehicle_profile_read and vehicle_facet_items), then
-- 20261116057600: an engine_type holding a listing's "Chassis: <id>" line is not read as an engine value. Kept in its
-- own file so the base contracts and the contracts that include them keep their composed bodies.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;
-- c1: chassis line beside a real engine size; c2: chassis line and nothing else; c3: an ordinary engine_type that
-- merely mentions a chassis later in the text stays as it is.
INSERT INTO public.vehicles (id, year, make, model, vin, engine_type, engine_size) VALUES
 ('10000000-0000-0000-0000-0000000000c1', 1973, 'Synthetic', 'Coupe', 'ZZ1VIN000001', 'Chassis: ZZ1VIN000001', '455ci V8'),
 ('10000000-0000-0000-0000-0000000000c2', 1974, 'Synthetic', 'Coupe', NULL, ' chassis : ZZ2VIN000002', NULL),
 ('10000000-0000-0000-0000-0000000000c3', 1975, 'Synthetic', 'Coupe', NULL, 'V8 (chassis: tube frame)', NULL);
CREATE TABLE public.t_engine_snap (vid uuid, items jsonb, profile jsonb);
INSERT INTO public.t_engine_snap SELECT v.id, public.vehicle_facet_items(v.id, 'engine'), public.vehicle_profile_read(v.id)
FROM public.vehicles v;
DO $$ BEGIN
  PERFORM public.t_assert((SELECT items::text ILIKE '%chassis: zz1vin%' FROM public.t_engine_snap
    WHERE vid = '10000000-0000-0000-0000-0000000000c1'), 'before: the chassis line reads as the engine');
END $$;
\ir ../migrations/20261116057600_engine_type_not_chassis.sql
\ir ../migrations/20261116057600_engine_type_not_chassis.sql
DO $$
DECLARE i jsonb;
BEGIN
  PERFORM public.t_assert((length(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure))
      - length(replace(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure), 'engine_type_not_chassis_v1', '')))
      / length('engine_type_not_chassis_v1') = 1, 'facet items patched once');
  PERFORM public.t_assert((length(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure))
      - length(replace(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure), 'engine_type_not_chassis_v1', '')))
      / length('engine_type_not_chassis_v1') = 1, 'profile read patched once');
  -- No chassis line reaches either reader for c1 or c2.
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicles v
    WHERE v.id IN ('10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2')
      AND (public.vehicle_facet_items(v.id, 'engine')::text ILIKE '%chassis%'
        OR public.vehicle_profile_read(v.id)::text ILIKE '%chassis%')), 'no chassis line in the engine items or the profile');
  i := public.t_item('10000000-0000-0000-0000-0000000000c1', 'engine', 'engine.current.family');
  PERFORM public.t_assert(i->>'value' = '455ci V8', format('c1 engine family is its size alone; got %s', i));
  -- c3 and every fixture vehicle without a chassis line read exactly as before.
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.t_engine_snap s
    WHERE s.vid NOT IN ('10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2')
      AND (s.items IS DISTINCT FROM public.vehicle_facet_items(s.vid, 'engine')
        OR s.profile IS DISTINCT FROM public.vehicle_profile_read(s.vid))), 'other vehicles unchanged');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-0000000000c3', 'engine')::text LIKE '%V8 (chassis: tube frame)%',
    'an engine value that only mentions a chassis is kept');
END $$;
SELECT 'engine_type not chassis contract: PASS' AS result;
