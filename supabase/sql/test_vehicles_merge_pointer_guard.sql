-- guardrail-allow(center-key-fk): vehicles.merged_into_vehicle_id: synthetic fixture column in a throwaway contract database, never deployed
-- vehicles.merged_into_vehicle_id is set only by the merge writers (20261126061500). Runs the chains of 20261126034500 and
-- 20261126051500 first, then swaps their identity stand-in for the live vehicle_merge_terminal body. -- ALLOW_RAW_TESTIMONY_WRITE
\ir test_user_associated_vehicle_ids_tied_link.sql

ALTER TABLE public.vehicles ADD COLUMN merged_into_vehicle_id uuid, ADD COLUMN deleted_at timestamptz, ADD COLUMN status text;
GRANT SELECT, INSERT, UPDATE ON public.vehicles TO authenticated;
-- The live client write policies on vehicles, verbatim (pg_policies, 2026-11-25).
CREATE POLICY vehicles_authenticated_insert ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = uploaded_by) OR (( SELECT auth.uid() AS uid) = user_id)) OR (( SELECT auth.uid() AS uid) = owner_id));
CREATE POLICY vehicles_simple_update_policy ON public.vehicles FOR UPDATE
  USING (((( SELECT auth.uid() AS uid) = uploaded_by) OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id)));

-- The live body, verbatim (pg_get_functiondef, 2026-11-25).
CREATE OR REPLACE FUNCTION public.vehicle_merge_terminal(p_vehicle_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Merges held for an un-merge: nothing follows them (evidence in 20261016221500's header).
  c_held_merges CONSTANT uuid[] := ARRAY['eeb9fa61-01e8-49a6-8eab-a7cc0e23d30f']::uuid[];
  v uuid := p_vehicle_id;
  v_next uuid;
  v_deleted_at timestamptz;
  v_status text;
BEGIN
  IF p_vehicle_id IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..10 LOOP
    IF v = ANY (c_held_merges) THEN RETURN NULL; END IF;
    SELECT x.merged_into_vehicle_id, x.deleted_at, x.status INTO v_next, v_deleted_at, v_status
      FROM vehicles x WHERE x.id = v;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_next IS NULL THEN
      IF v_deleted_at IS NOT NULL OR v_status IN ('deleted', 'merged') THEN RETURN NULL; END IF;
      RETURN v;
    END IF;
    v := v_next;
  END LOOP;
  RETURN NULL;
END
$function$;

\set E '''0e100000-0000-0000-0000-0000000000e1'''
CREATE FUNCTION public.write_as(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'refused';
  END;
  RESET ROLE;
  RETURN 'written';
END $f$;

-- Before: a stranger points a car of its own at the private car P, and the gate files onto P.
SELECT t_assert(public.gate_as(:E, :P) = 'refused_not_associated', 'before: a stranger is refused');
SELECT t_assert(public.write_as(:E, format('INSERT INTO public.vehicles(id, user_id, merged_into_vehicle_id) VALUES (%L, %L, %L)',
    'e1000000-0000-0000-0000-0000000000e1', :E, :P)) = 'written', 'before: the client insert with a merge pointer is accepted');
SELECT t_assert(public.gate_as(:E, :P) = 'filed', 'before: through its stub the stranger files a capture onto the private car');

\ir ../migrations/20261126061500_vehicles_merge_pointer_guard.sql

SELECT t_assert(public.write_as(:E, format('INSERT INTO public.vehicles(id, user_id, merged_into_vehicle_id) VALUES (%L, %L, %L)',
    'e2000000-0000-0000-0000-0000000000e2', :E, :P)) = 'refused', 'after: a client insert with a merge pointer is refused');
SELECT t_assert(public.write_as(:E, format('INSERT INTO public.vehicles(id, user_id) VALUES (%L, %L)',
    'e3000000-0000-0000-0000-0000000000e3', :E)) = 'written', 'after: a client insert without one is accepted');
SELECT t_assert(public.write_as(:E, format('UPDATE public.vehicles SET merged_into_vehicle_id = %L WHERE id = %L',
    :P, 'e3000000-0000-0000-0000-0000000000e3')) = 'refused', 'after: a client update that sets the pointer is refused');
SELECT t_assert(public.write_as(:E, format('UPDATE public.vehicles SET merged_into_vehicle_id = %L WHERE id = %L',
    'e3000000-0000-0000-0000-0000000000e3', 'e1000000-0000-0000-0000-0000000000e1')) = 'refused',
  'after: a client update that moves the pointer is refused');
SELECT t_assert(public.write_as(:E, format('UPDATE public.vehicles SET status = %L WHERE id = %L',
    'active', 'e1000000-0000-0000-0000-0000000000e1')) = 'written',
  'after: a client update of another column on a merged row is accepted');
SELECT t_assert(public.write_as(:E, format('UPDATE public.vehicles SET merged_into_vehicle_id = NULL WHERE id = %L',
    'e1000000-0000-0000-0000-0000000000e1')) = 'refused', 'after: a client update that clears the pointer is refused');
SELECT t_assert((SELECT merged_into_vehicle_id FROM public.vehicles WHERE id = 'e1000000-0000-0000-0000-0000000000e1') = :P,
  'the refused clear left the pointer in place');
-- An invoker writer shaped like unmerge_vehicle: refused when a signed-in user calls it, passes as a system role.
CREATE FUNCTION public.fixture_unmerge(p_dup uuid) RETURNS void LANGUAGE sql SET search_path TO 'public' AS
$f$ UPDATE public.vehicles SET merged_into_vehicle_id = NULL, deleted_at = NULL WHERE id = p_dup $f$;
GRANT EXECUTE ON FUNCTION public.fixture_unmerge(uuid) TO authenticated;
SELECT t_assert(public.write_as(:E, format('SELECT public.fixture_unmerge(%L)', 'e1000000-0000-0000-0000-0000000000e1')) = 'refused',
  'after: an invoker unmerge called by a signed-in user is refused');
SELECT public.fixture_unmerge('e1000000-0000-0000-0000-0000000000e1');
SELECT t_assert((SELECT merged_into_vehicle_id FROM public.vehicles WHERE id = 'e1000000-0000-0000-0000-0000000000e1') IS NULL,
  'the invoker unmerge run by a system role clears the pointer');
SELECT t_assert(public.gate_as(:E, :P) = 'refused_not_associated', 'after: the stub cleared, the stranger is refused again');

-- A merge writer: SECURITY DEFINER, owned by the migration role, called by a signed-in user.
CREATE FUNCTION public.fixture_merge(p_dup uuid, p_into uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS
$f$ UPDATE public.vehicles SET merged_into_vehicle_id = p_into WHERE id = p_dup $f$;
GRANT EXECUTE ON FUNCTION public.fixture_merge(uuid, uuid) TO authenticated;
SELECT t_assert(public.write_as(:E, format('SELECT public.fixture_merge(%L, %L)', 'e3000000-0000-0000-0000-0000000000e3', :P)) = 'written',
  'after: a definer merge writer called by a signed-in user still sets the pointer');
SELECT t_assert((SELECT merged_into_vehicle_id FROM public.vehicles WHERE id = 'e3000000-0000-0000-0000-0000000000e3') = :P,
  'the definer merge landed');
-- Re-apply.
\ir ../migrations/20261126061500_vehicles_merge_pointer_guard.sql
SELECT t_assert((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicles'::regclass AND tgname = 'vehicles_merge_pointer_guard') = 1,
  're-applying the migration leaves one guard trigger');
