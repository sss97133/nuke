-- guardrail-allow(center-key-fk): pending_vehicle_assignments.vehicle_id: synthetic fixture table in a throwaway contract database, never deployed
-- Isolated PostgreSQL 17 contract for 20261126031500_organization_vehicle_link_grants_fail_closed.sql.
-- It first runs test_user_can_edit_vehicle_tied_grantor.sql, which builds the live edit-check fixture, the self-made
-- organization chain and the live organization_vehicles write policy, and applies 20261126011500. Then it adds what that
-- fixture leaves out: trg_stamp_organization_vehicle_linker with its live body (md5-checked), and
-- pending_vehicle_assignments with its live SELECT and UPDATE policies (fingerprint-checked). Cases:
--   * without the stamp trigger, under 20261126011500 alone, a self-made organization owner writes the car owner as the
--     linker, or no linker, and passes the edit check on someone else's car (the dependency, shown);
--   * with the trigger, a forged linker is overwritten with the caller;
--   * before: a manager of an organization an untied user linked the car into reads and rewrites its pending assignments;
--   * after: that link grants neither; a link made by the owner or a service path still grants edit and the assignments;
--   * fail closed: with the trigger dropped, disabled, or its function body changed, no organization link grants edit
--     or assignment access; restoring it restores them;
--   * the limit, stated as a case: a link forged while the trigger was absent counts again once the trigger returns;
--     the private-row watch is what catches that window;
--   * re-applying the migration changes nothing.
\ir test_user_can_edit_vehicle_tied_grantor.sql

\set N  '''0d000000-0000-0000-0000-0000000000d1'''
\set F  'f0000000-0000-0000-0000-00000000000f'
\set F2 'f2000000-0000-0000-0000-00000000000f'
\set F3 'f3000000-0000-0000-0000-00000000000f'
\set F4 'f4000000-0000-0000-0000-00000000000f'
\set ZORG '''92000000-0000-0000-0000-000000000029'''
INSERT INTO vehicles(id, user_id, owner_id) VALUES (:'F', :O, :O), (:'F2', :O, :O), (:'F3', :O, :O), (:'F4', :O, :O);
-- N manages G (A linked by the stranger X; D by a service path) and H (B linked by its owner O).
INSERT INTO organization_contributors(organization_id, user_id, role, status) VALUES (:G, :N, 'manager', 'active'),
  (:H, :N, 'manager', 'active');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$a$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') $a$;
GRANT UPDATE ON public.organization_vehicles TO authenticated;

-- 1. The dependency: no stamp trigger, 20261126011500 applied. The self-made organization owner Z writes links itself.
SELECT set_config('request.jwt.claims', json_build_object('sub', :Z, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO organization_vehicles(organization_id, vehicle_id, relationship_type, status, linked_by_user_id)
VALUES (:ZORG, :'F', 'service_provider', 'active', :O), (:ZORG, :'F2', 'service_provider', 'active', NULL);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT t_assert(user_can_edit_vehicle(:'F', :Z) AND user_can_edit_vehicle(:'F2', :Z),
  'without the stamp trigger, a forged owner or a NULL linker passes the edit check under 20261126011500');

-- 2. The live trigger, verbatim.
CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.linked_by_user_id := auth.uid();
  ELSIF (NEW.vehicle_id, NEW.organization_id, NEW.relationship_type, NEW.status, NEW.linked_by_user_id)
        IS DISTINCT FROM (OLD.vehicle_id, OLD.organization_id, OLD.relationship_type, OLD.status, OLD.linked_by_user_id) THEN
    NEW.linked_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organization_vehicle_linker();
SELECT t_assert(md5(prosrc) = '9e8299a8e5024d4404e03d55ced96413', 'the fixture reproduces the live stamp function body') -- gitleaks:allow (function-body fingerprint, not a secret)
FROM pg_proc WHERE proname = 'stamp_organization_vehicle_linker';

SELECT set_config('request.jwt.claims', json_build_object('sub', :Z, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO organization_vehicles(organization_id, vehicle_id, relationship_type, status, linked_by_user_id)
VALUES (:ZORG, :'F3', 'service_provider', 'active', :O);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT t_assert((SELECT linked_by_user_id FROM organization_vehicles WHERE vehicle_id = :'F3') = :Z::uuid
  AND NOT user_can_edit_vehicle(:'F3', :Z), 'with the trigger, a forged linker is overwritten with the caller and grants no edit');

-- 3. pending_vehicle_assignments with its live SELECT and UPDATE policies, verbatim.
CREATE TABLE public.pending_vehicle_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  organization_id uuid, status text DEFAULT 'pending', review_notes text);
ALTER TABLE public.pending_vehicle_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.pending_vehicle_assignments TO authenticated;
GRANT SELECT (id, uploaded_by) ON public.vehicles TO authenticated;
CREATE POLICY "Users can update pending assignments for their vehicles" ON public.pending_vehicle_assignments FOR UPDATE USING (((vehicle_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))) OR (vehicle_id IN ( SELECT ov.vehicle_id
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text) AND (oc.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));
CREATE POLICY "Users can view pending assignments for their vehicles" ON public.pending_vehicle_assignments FOR SELECT USING (((vehicle_id IN ( SELECT vehicles.id
   FROM vehicles
  WHERE (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))) OR (vehicle_id IN ( SELECT ov.vehicle_id
   FROM (organization_vehicles ov
     JOIN organization_contributors oc ON ((oc.organization_id = ov.organization_id)))
  WHERE ((oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text))))));
SELECT t_assert(md5(string_agg(polname || ':' || coalesce(pg_get_expr(polqual, polrelid), ''), '|' ORDER BY polname))
  = 'cc81088e1ea9ac6cf87af2199b1c2780', 'the fixture reproduces the live pending_vehicle_assignments policies') -- gitleaks:allow (policy fingerprint, not a secret)
FROM pg_policy WHERE polrelid = 'public.pending_vehicle_assignments'::regclass AND polcmd IN ('r', 'w');
INSERT INTO pending_vehicle_assignments(vehicle_id, organization_id) VALUES (:A, :H), (:B, :G), (:D, :H);

CREATE FUNCTION public.pva_as(p_user uuid, p_vehicle uuid, OUT seen boolean, OUT rewritten boolean) LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  seen := EXISTS (SELECT 1 FROM public.pending_vehicle_assignments WHERE vehicle_id = p_vehicle);
  UPDATE public.pending_vehicle_assignments SET review_notes = 'contract' WHERE vehicle_id = p_vehicle;
  GET DIAGNOSTICS n = ROW_COUNT;
  rewritten := n > 0;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $f$;
SELECT t_assert((SELECT seen AND rewritten FROM pva_as(:N, :A)),
  'before: a manager of the organization an untied user linked car A into reads and rewrites its pending assignments');

-- 4. The migration.
\ir ../migrations/20261126031500_organization_vehicle_link_grants_fail_closed.sql

SELECT t_assert(NOT user_can_edit_vehicle(:A, :M) AND user_can_edit_vehicle(:B, :M) AND user_can_edit_vehicle(:D, :M),
  'edit: the untied link grants none; the owner''s link and the service link still grant');
SELECT t_assert((SELECT NOT seen AND NOT rewritten FROM pva_as(:N, :A)),
  'after: the untied link grants no read or rewrite of the car''s pending assignments');
SELECT t_assert((SELECT seen AND rewritten FROM pva_as(:N, :B)) AND (SELECT seen AND rewritten FROM pva_as(:N, :D)),
  'after: a link made by the owner, or by a service path, still does');
SELECT t_assert((SELECT seen AND rewritten FROM pva_as(:U, :A)), 'after: the uploader still reads and rewrites');
SELECT t_assert((SELECT NOT seen AND NOT rewritten FROM pva_as(:X, :B)), 'after: a stranger does neither');
SELECT t_assert(NOT has_function_privilege('anon', 'public.organization_vehicle_link_grants(uuid,uuid)', 'execute')
  AND (SELECT prosecdef FROM pg_proc WHERE proname = 'organization_vehicle_link_grants'),
  'the rule is SECURITY DEFINER and not executable by anon');
SELECT t_assert((SELECT bool_and(polroles = ARRAY['authenticated'::regrole::oid]) FROM pg_policy
  WHERE polrelid = 'public.pending_vehicle_assignments'::regclass), 'both assignment policies apply to authenticated only');

-- 5. Fail closed. Dropped:
DROP TRIGGER trg_stamp_organization_vehicle_linker ON public.organization_vehicles;
SELECT t_assert(NOT user_can_edit_vehicle(:B, :M) AND NOT user_can_edit_vehicle(:D, :M) AND NOT user_can_edit_vehicle(:'F', :Z),
  'trigger dropped: no organization link grants edit');
SELECT t_assert((SELECT NOT seen AND NOT rewritten FROM pva_as(:N, :B)), 'trigger dropped: no link grants assignment access');
SELECT set_config('request.jwt.claims', json_build_object('sub', :Z, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO organization_vehicles(organization_id, vehicle_id, relationship_type, status, linked_by_user_id)
VALUES (:ZORG, :'F4', 'service_provider', 'active', :O);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT t_assert(NOT user_can_edit_vehicle(:'F4', :Z), 'trigger dropped: a link forged now (owner as linker) grants no edit');
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organization_vehicle_linker();
SELECT t_assert(user_can_edit_vehicle(:B, :M) AND user_can_edit_vehicle(:D, :M), 'trigger restored: the tied and service links grant again');
-- The limit: links written while the trigger was absent are trusted again once it returns.
SELECT t_assert(user_can_edit_vehicle(:'F', :Z) AND user_can_edit_vehicle(:'F4', :Z),
  'limit: a link forged while the trigger was absent grants again once it returns; the private-row watch catches the window');

-- Disabled (fixture database only):
ALTER TABLE public.organization_vehicles DISABLE TRIGGER trg_stamp_organization_vehicle_linker;
SELECT t_assert(NOT user_can_edit_vehicle(:B, :M), 'trigger disabled: no organization link grants edit');
ALTER TABLE public.organization_vehicles ENABLE TRIGGER trg_stamp_organization_vehicle_linker;
SELECT t_assert(user_can_edit_vehicle(:B, :M), 'trigger enabled again: grants return');

-- Body changed (a stamp that no longer overwrites the linker):
CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public' AS $function$ BEGIN RETURN NEW; END $function$;
SELECT t_assert(NOT user_can_edit_vehicle(:B, :M), 'stamp body changed: no organization link grants edit');
CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.linked_by_user_id := auth.uid();
  ELSIF (NEW.vehicle_id, NEW.organization_id, NEW.relationship_type, NEW.status, NEW.linked_by_user_id)
        IS DISTINCT FROM (OLD.vehicle_id, OLD.organization_id, OLD.relationship_type, OLD.status, OLD.linked_by_user_id) THEN
    NEW.linked_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $function$;
SELECT t_assert(user_can_edit_vehicle(:B, :M), 'stamp body restored: grants return');

-- 6. Re-apply.
SELECT md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)) AS after_ucev,
       md5(pg_get_functiondef('public.organization_vehicle_link_grants(uuid,uuid)'::regprocedure)) AS after_rule \gset
\ir ../migrations/20261126031500_organization_vehicle_link_grants_fail_closed.sql
SELECT t_assert(md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)) = :'after_ucev'
  AND md5(pg_get_functiondef('public.organization_vehicle_link_grants(uuid,uuid)'::regprocedure)) = :'after_rule',
  're-applying the migration changes nothing');
