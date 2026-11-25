-- Empty disposable PG17 only:
--   createdb dm_refinement_ov_readable; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ov_readable -f this-file.sql
--   (-v ovmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261126071500_organization_vehicles_vehicle_readable.sql: organization_vehicles.vehicle_readable is
-- vehicle_publicly_readable() of the link's car on every insert and every write of vehicle_id or vehicle_readable,
-- whatever value the caller sends; rows that existed before stay NULL until written; a change to a car's is_public,
-- deleted_at or merged_into_vehicle_id is relayed to all its links, including links the updating owner cannot write;
-- nothing else on vehicles fires the relay; linked_by_user_id is left alone; the functions are not executable by
-- PUBLIC, anon or authenticated; the migration runs twice; the revert removes it.
-- Fixture: the shared profile fixture (live columns and vehicle_id foreign keys), plus, as read live on 2026-11-25:
-- the predicate and its ACL, the vehicles read and update policies and table grants, organization_vehicles' grants,
-- column SELECT grants, RLS policies and its two BEFORE triggers that act on organization_vehicles rows
-- (stamp_organization_vehicle_linker, update_days_on_lot). Its two AFTER triggers are left out:
-- trigger_update_primary_focus returns at once for this table and update_organization_stats fires on INSERT and DELETE
-- only, which this migration does not add.
\set ON_ERROR_STOP on
\if :{?ovmig}
\else
  \set ovmig ../migrations/20261126071500_organization_vehicles_vehicle_readable.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql
SET track_functions = 'all';

CREATE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz, p_merged_into_vehicle_id uuid)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vehicle_user_has_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;
-- Live default privileges for functions postgres creates in public: postgres and service_role only.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- vehicles: live read and update policies; table grants anon wdxt, authenticated awdxt (relacl, 2026-11-25).
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
GRANT INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT UPDATE, DELETE ON public.vehicles TO anon;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (((is_public = true) OR (auth.role() = 'service_role'::text)));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL)
  AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by)
       OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
CREATE POLICY vehicles_simple_update_policy ON public.vehicles FOR UPDATE
  USING ((( SELECT auth.uid() AS uid) = uploaded_by) OR (( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id));

-- organization_contributors: live grants (anon and authenticated arwdDxt); RLS not under test here.
GRANT ALL ON public.organization_contributors TO anon, authenticated;

-- organization_vehicles: live table grants (anon wdxt, authenticated awdxt), SELECT on 36 of 40 columns (not
-- asking_price, cost_basis, sale_price, internal_notes), RLS and its three live policies.
GRANT UPDATE, DELETE ON public.organization_vehicles TO anon;
GRANT INSERT, UPDATE, DELETE ON public.organization_vehicles TO authenticated;
GRANT ALL ON public.organization_vehicles TO service_role;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.organization_vehicles'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('asking_price', 'cost_basis', 'sale_price', 'internal_notes');
  EXECUTE format('GRANT SELECT (%s) ON public.organization_vehicles TO anon, authenticated', cols);
END $$;
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone views org-vehicle links" ON public.organization_vehicles FOR SELECT USING (true);
CREATE POLICY organization_vehicles_select ON public.organization_vehicles FOR SELECT USING (true);
CREATE POLICY "Users/owners manage links" ON public.organization_vehicles
  USING ((linked_by_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = organization_vehicles.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_vehicles.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'manager'::text, 'board_member'::text])) AND (oc.status = 'active'::text)))));

-- The live BEFORE triggers on organization_vehicles, bodies verbatim (pg_get_functiondef, 2026-11-25).
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
CREATE OR REPLACE FUNCTION public.update_days_on_lot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.listing_status IN ('for_sale', 'new_arrival', 'in_build', 'consignment') THEN
    NEW.days_on_lot := EXTRACT(DAY FROM (NOW() - NEW.created_at));
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organization_vehicle_linker();
CREATE TRIGGER trg_update_days_on_lot BEFORE UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_days_on_lot();

-- Made-up rows in an empty disposable PG17 database, never production.
-- Users: 0a owns car 2 (user_id) and car 6 (owner_id only); 0b is a stranger who links cars; 0c manages org f1.
-- Cars: 1 public live; 2 private; 3 public, deleted, unmerged; 4 public, deleted, merged into 1; 5 is_public NULL;
--       6 private, owner_id 0a only (0a may update the car but not its links).
INSERT INTO auth.users (id) SELECT ('00000000-0000-4000-8000-0000000000' || x)::uuid FROM unnest(ARRAY['0a','0b','0c']) x;
INSERT INTO public.profiles (id) SELECT id FROM auth.users;
INSERT INTO public.vehicles (id, is_public, deleted_at, merged_into_vehicle_id, user_id, owner_id, make, model, year) VALUES
  ('11111111-1111-4111-8111-111111111111', true,  NULL,  NULL, NULL, NULL, 'Fixture', 'Public', 1970),
  ('22222222-2222-4222-8222-222222222222', false, NULL,  NULL, '00000000-0000-4000-8000-00000000000a', NULL, 'Fixture', 'Private', 1971),
  ('33333333-3333-4333-8333-333333333333', true,  now(), NULL, NULL, NULL, 'Fixture', 'Deleted', 1972),
  ('44444444-4444-4444-8444-444444444444', true,  now(), '11111111-1111-4111-8111-111111111111', NULL, NULL, 'Fixture', 'Stub', 1973),
  ('55555555-5555-4555-8555-555555555555', NULL,  NULL,  NULL, NULL, NULL, 'Fixture', 'NullPublic', 1974),
  ('66666666-6666-4666-8666-666666666666', false, NULL,  NULL, NULL, '00000000-0000-4000-8000-00000000000a', 'Fixture', 'OwnerOnly', 1975);
INSERT INTO public.organization_contributors (id, organization_id, user_id, role, status) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'manager', 'active');
-- Links that exist before the migration (they stay NULL until written).
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, linked_by_user_id, listing_status, created_at) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'dealer', 'active', '00000000-0000-4000-8000-00000000000b', 'for_sale', now() - interval '10 days'),
  ('e0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'dealer', 'active', '00000000-0000-4000-8000-00000000000b', NULL, now()),
  ('e0000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000002', '66666666-6666-4666-8666-666666666666', 'service', 'active', '00000000-0000-4000-8000-00000000000b', NULL, now());

\ir :ovmig
\ir :ovmig

CREATE FUNCTION pg_temp.vr(p_id text) RETURNS boolean LANGUAGE sql AS
$$ SELECT vehicle_readable FROM public.organization_vehicles WHERE id = ('e0000000-0000-4000-8000-0000000000' || p_id)::uuid $$;
CREATE FUNCTION pg_temp.calls(p_fn text) RETURNS bigint LANGUAGE sql AS
$$ SELECT coalesce(pg_stat_get_xact_function_calls(p_fn::regprocedure), 0) $$;

-- 1. Rows from before the migration are NULL; a write to another column leaves them NULL and linked_by alone.
DO $$ BEGIN
  ASSERT pg_temp.vr('01') IS NULL AND pg_temp.vr('02') IS NULL AND pg_temp.vr('06') IS NULL, '1 existing rows are NULL';
  UPDATE public.organization_vehicles SET notes = 'touched' WHERE id = 'e0000000-0000-4000-8000-000000000002';
  ASSERT pg_temp.vr('02') IS NULL, '1 a write to another column leaves NULL';
END $$;

-- 2. Insert stamps the predicate, whatever the caller sends, as the service path (postgres) and as a signed-in
--    stranger (0b) who cannot see the private car.
BEGIN;
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, vehicle_readable) VALUES
  ('e0000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'consigner', 'active', false),
  ('e0000000-0000-4000-8000-000000000013', 'f1000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'consigner', 'active', true),
  ('e0000000-0000-4000-8000-000000000014', 'f1000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'consigner', 'active', NULL),
  ('e0000000-0000-4000-8000-000000000015', 'f1000000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'consigner', 'active', true),
  ('e0000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000001', NULL, 'consigner', 'active', true);
SELECT public.t_claims('00000000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;
INSERT INTO public.organization_vehicles (id, organization_id, vehicle_id, relationship_type, status, vehicle_readable) VALUES
  ('e0000000-0000-4000-8000-000000000022', 'f3000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'spotted', 'active', true),
  ('e0000000-0000-4000-8000-000000000021', 'f3000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'spotted', 'active', false);
RESET ROLE;
SELECT public.t_claims('none');
DO $$ BEGIN
  ASSERT pg_temp.vr('11') = true,  '2 public live car: true (caller sent false)';
  ASSERT pg_temp.vr('13') = false, '2 deleted unmerged car: false (caller sent true)';
  ASSERT pg_temp.vr('14') = true,  '2 merged stub of a public car: true, as the predicate answers';
  ASSERT pg_temp.vr('15') = false, '2 is_public NULL: false (caller sent true)';
  ASSERT pg_temp.vr('10') = false, '2 no car: false, never NULL (caller sent true)';
  ASSERT pg_temp.vr('22') = false, '2 stranger linking a private car: false (sent true)';
  ASSERT pg_temp.vr('21') = true,  '2 stranger linking a public car: true (sent false)';
  ASSERT (SELECT linked_by_user_id FROM public.organization_vehicles WHERE id = 'e0000000-0000-4000-8000-000000000022')
       = '00000000-0000-4000-8000-00000000000b', '2 the linker stamp still runs';
END $$;
COMMIT;

-- 3. A caller cannot write the value: the stranger's UPDATE of vehicle_readable on their own link is recomputed; moving
--    a link to another car recomputes it; an UPDATE of another column leaves it.
BEGIN;
SELECT public.t_claims('00000000-0000-4000-8000-00000000000b');
SET LOCAL ROLE authenticated;
UPDATE public.organization_vehicles SET vehicle_readable = true WHERE id = 'e0000000-0000-4000-8000-000000000022';
RESET ROLE;
DO $$ BEGIN ASSERT pg_temp.vr('22') = false, '3 a caller''s true on a private car is recomputed to false'; END $$;
SET LOCAL ROLE authenticated;
UPDATE public.organization_vehicles SET vehicle_readable = NULL WHERE id = 'e0000000-0000-4000-8000-000000000021';
RESET ROLE;
DO $$ BEGIN ASSERT pg_temp.vr('21') = true, '3 a caller''s NULL is recomputed'; END $$;
SET LOCAL ROLE authenticated;
UPDATE public.organization_vehicles SET vehicle_id = '11111111-1111-4111-8111-111111111111' WHERE id = 'e0000000-0000-4000-8000-000000000022';
RESET ROLE;
DO $$ BEGIN ASSERT pg_temp.vr('22') = true, '3 a link moved to a public car follows it'; END $$;
SET LOCAL ROLE authenticated;
UPDATE public.organization_vehicles SET vehicle_id = '22222222-2222-4222-8222-222222222222' WHERE id = 'e0000000-0000-4000-8000-000000000022';
RESET ROLE;
DO $$ BEGIN ASSERT pg_temp.vr('22') = false, '3 and back to the private car'; END $$;
SET LOCAL ROLE authenticated;
RESET ROLE;
SELECT public.t_claims('none');
UPDATE public.organization_vehicles SET vehicle_readable = true WHERE id = 'e0000000-0000-4000-8000-000000000022';
DO $$ BEGIN ASSERT pg_temp.vr('22') = false, '3 the service path cannot write it either'; END $$;
COMMIT;

-- 4. The relay. Owner 0a, signed in, makes car 6 public: its link, which 0a may not write (linked by 0b, org f2, car
--    user_id unset), follows, and was NULL before. linked_by_user_id is left alone.
BEGIN;
SELECT public.t_claims('00000000-0000-4000-8000-00000000000a');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.organization_vehicles WHERE id = 'e0000000-0000-4000-8000-000000000006'
                     AND (linked_by_user_id = auth.uid() OR vehicle_id IN (SELECT id FROM public.vehicles WHERE user_id = auth.uid()))),
    '4 setup: 0a holds no write path to link 06';
END $$;
UPDATE public.vehicles SET is_public = true WHERE id = '66666666-6666-4666-8666-666666666666';
RESET ROLE;
SELECT public.t_claims('none');
DO $$ BEGIN
  ASSERT pg_temp.vr('06') = true, format('4 the owner''s flip reaches a link they cannot write: %s', pg_temp.vr('06'));
  ASSERT (SELECT linked_by_user_id FROM public.organization_vehicles WHERE id = 'e0000000-0000-4000-8000-000000000006')
       = '00000000-0000-4000-8000-00000000000b', '4 linked_by_user_id unchanged';
END $$;
COMMIT;

-- 5. Every predicate change is relayed to all of the car's links (car 1: links 01 (NULL before), 11, 21).
DO $$
DECLARE c0 bigint;
BEGIN
  UPDATE public.vehicles SET deleted_at = now() WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT pg_temp.vr('01') = false AND pg_temp.vr('11') = false AND pg_temp.vr('21') = false, '5 deleted: all links false';
  UPDATE public.vehicles SET merged_into_vehicle_id = '44444444-4444-4444-8444-444444444444' WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT pg_temp.vr('01') AND pg_temp.vr('11') AND pg_temp.vr('21'), '5 merged: true, as the predicate answers';
  UPDATE public.vehicles SET merged_into_vehicle_id = NULL, deleted_at = NULL, is_public = NULL WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT pg_temp.vr('01') = false AND pg_temp.vr('11') = false, '5 is_public NULL: false';
  UPDATE public.vehicles SET is_public = true WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT pg_temp.vr('01') AND pg_temp.vr('11') AND pg_temp.vr('21'), '5 public again: true';
  UPDATE public.vehicles SET is_public = true WHERE id = '22222222-2222-4222-8222-222222222222';
  ASSERT pg_temp.vr('02') AND pg_temp.vr('22'), '5 private car made public: its links true, NULL one included';
  UPDATE public.vehicles SET is_public = false WHERE id = '22222222-2222-4222-8222-222222222222';
  ASSERT pg_temp.vr('02') = false AND pg_temp.vr('22') = false, '5 and private again';
  -- Other links are untouched by car 2's flips.
  ASSERT pg_temp.vr('13') = false AND pg_temp.vr('14') AND pg_temp.vr('06'), '5 other cars'' links untouched';
  -- 6. Nothing else on vehicles fires the relay; a visibility column rewritten to an answer that does not change
  --    fires it but writes no link row (update_days_on_lot does not run).
  c0 := pg_temp.calls('public.vehicles_relay_readable_to_org_links()');
  UPDATE public.vehicles SET make = 'Fixture2', model = 'Renamed' WHERE id = '11111111-1111-4111-8111-111111111111';
  UPDATE public.vehicles SET is_public = true WHERE id = '11111111-1111-4111-8111-111111111111';
  ASSERT pg_temp.calls('public.vehicles_relay_readable_to_org_links()') = c0, '6 no relay when no visibility column changes';
  c0 := pg_temp.calls('public.update_days_on_lot()');
  UPDATE public.vehicles SET deleted_at = now() WHERE id = '33333333-3333-4333-8333-333333333333';
  ASSERT pg_temp.calls('public.update_days_on_lot()') = c0, '6 an unchanged answer writes no link row';
  ASSERT pg_temp.vr('13') = false, '6 still false';
END $$;

-- 7. Catalog: a nullable boolean with no default; the functions are definer, search_path '', not executable by
--    PUBLIC, anon or authenticated; anon and authenticated hold no SELECT on the column.
DO $$ BEGIN
  ASSERT (SELECT NOT attnotnull AND NOT atthasdef FROM pg_attribute WHERE attrelid = 'public.organization_vehicles'::regclass
          AND attname = 'vehicle_readable'), '7 nullable, no default';
  ASSERT NOT has_function_privilege('public', 'public.organization_vehicles_stamp_vehicle_readable()', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.organization_vehicles_stamp_vehicle_readable()', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.vehicles_relay_readable_to_org_links()', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.vehicles_relay_readable_to_org_links()', 'EXECUTE'), '7 EXECUTE withheld';
  ASSERT NOT has_column_privilege('anon', 'public.organization_vehicles', 'vehicle_readable', 'SELECT')
     AND NOT has_column_privilege('authenticated', 'public.organization_vehicles', 'vehicle_readable', 'SELECT'), '7 column not granted';
END $$;

-- 8. The revert removes both triggers, both functions and the column, and car flips no longer touch the links.
\ir revert_20261126071500_organization_vehicles_vehicle_readable.sql
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.organization_vehicles'::regclass
                     AND attname = 'vehicle_readable' AND NOT attisdropped), '8 column gone';
  ASSERT to_regprocedure('public.organization_vehicles_stamp_vehicle_readable()') IS NULL
     AND to_regprocedure('public.vehicles_relay_readable_to_org_links()') IS NULL, '8 functions gone';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_organization_vehicles_vehicle_readable',
                     'trg_vehicles_relay_readable_to_org_links')), '8 triggers gone';
  UPDATE public.vehicles SET is_public = false WHERE id = '11111111-1111-4111-8111-111111111111';
END $$;
SELECT 'PASS: organization_vehicles.vehicle_readable follows its car on every write' AS result;
