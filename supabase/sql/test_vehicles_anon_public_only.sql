-- Disposable PG17: 20261125174100 answers a logged-out request for non-public vehicles empty at plan time, and changes
-- no answer for anon, a signed-in owner or a signed-in stranger. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_* database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean NOT NULL, deleted_at timestamptz,
                              user_id uuid, owner_id uuid, uploaded_by uuid);
INSERT INTO public.vehicles VALUES
  ('10000000-0000-0000-0000-000000000001', true,  NULL,  NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000002', true,  now(), NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000003', false, NULL,  '30000000-0000-0000-0000-000000000001', NULL, NULL),
  ('10000000-0000-0000-0000-000000000004', false, NULL,  NULL, NULL, NULL);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
GRANT SELECT ON public.vehicles TO anon, authenticated;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
-- the two live SELECT policies, as read on 2026-11-25
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'::text));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL)
  AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by)
       OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid))));

-- what each viewer sees, before
CREATE FUNCTION pg_temp.seen(p_role text, p_claims text, p_filter text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE format('SELECT coalesce(string_agg(right(id::text, 1), '','' ORDER BY id), '''') FROM public.vehicles WHERE %s', p_filter) INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE TEMP TABLE viewers (role text, claims text, filter text, before text, after text);
INSERT INTO viewers (role, claims, filter) VALUES
  ('anon', '{"role":"anon"}', 'true'),
  ('anon', '{"role":"anon"}', 'is_public = false'),
  ('authenticated', '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000001"}', 'true'),
  ('authenticated', '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000001"}', 'is_public = false'),
  ('authenticated', '{"role":"authenticated","sub":"30000000-0000-0000-0000-000000000009"}', 'true');
BEGIN; UPDATE viewers SET before = pg_temp.seen(role, claims, filter); COMMIT;

-- policy copies (20261125204500's table and hash, as deployed): a vehicles copy whose hash is current is re-recorded
-- by the migration and again by the revert; a copy that had already drifted is left for the watch
CREATE TABLE IF NOT EXISTS public.private_row_policy_copies (
  reader text NOT NULL, relation text NOT NULL, policy_filter text NOT NULL, recorded_hash text NOT NULL,
  owner_lane text NOT NULL, note text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true, PRIMARY KEY (reader, relation, policy_filter));
CREATE OR REPLACE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $h$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $h$;
INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
SELECT 'vehicle_plates_read(uuid[])', 'vehicles', 'p.cmd IN (''SELECT'', ''ALL'')', h.policy_hash, 'test', 'current'
  FROM public.private_row_policy_hash('vehicles', 'p.cmd IN (''SELECT'', ''ALL'')') h
UNION ALL
SELECT 'stale_reader(uuid)', 'vehicles', 'p.cmd IN (''SELECT'', ''ALL'')', md5('drifted'), 'test', 'stale';
CREATE TEMP TABLE copy_hash_before AS SELECT policy_hash FROM public.private_row_policy_hash('vehicles', 'p.cmd IN (''SELECT'', ''ALL'')');

\ir ../migrations/20261125174100_vehicles_anon_public_only.sql
\ir ../migrations/20261125174100_vehicles_anon_public_only.sql
RESET lock_timeout; RESET statement_timeout;

DO $$ DECLARE live text; BEGIN
  SELECT policy_hash INTO live FROM public.private_row_policy_hash('vehicles', 'p.cmd IN (''SELECT'', ''ALL'')');
  IF live = (SELECT policy_hash FROM copy_hash_before) THEN RAISE EXCEPTION 'fixture: vehicles hash did not change'; END IF;
  IF (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'vehicle_plates_read(uuid[])') <> live THEN
    RAISE EXCEPTION 'current vehicles copy not re-recorded'; END IF;
  IF (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'stale_reader(uuid)') <> md5('drifted') THEN
    RAISE EXCEPTION 'drifted vehicles copy was re-recorded'; END IF;
  IF (SELECT count(*) FROM public.private_row_policy_copies WHERE note LIKE '%re-recorded by 20261125174100%' AND note NOT LIKE '%20261125174100%20261125174100%') <> 1 THEN
    RAISE EXCEPTION 'second apply re-recorded twice or not at all'; END IF;
END $$;

DO $$ DECLARE s text[]; plan text; BEGIN
  SELECT setconfig INTO s FROM pg_db_role_setting WHERE setrole = 'anon'::regrole AND setdatabase = 0;
  IF NOT 'constraint_exclusion=on' = ANY (coalesce(s, '{}')) THEN RAISE EXCEPTION 'anon role setting missing: %', s; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'vehicles' AND policyname = 'vehicles_anon_public_only'
        AND permissive = 'RESTRICTIVE' AND roles = '{anon}') <> 1 THEN RAISE EXCEPTION 'restrictive anon policy missing'; END IF;
END $$;

-- answers unchanged for every viewer (role settings applied the way PostgREST applies them: per request, set_config)
BEGIN;
SELECT set_config(split_part(c, '=', 1), split_part(c, '=', 2), true)
  FROM pg_db_role_setting, unnest(setconfig) c WHERE setrole = 'anon'::regrole AND setdatabase = 0;
UPDATE viewers SET after = pg_temp.seen(role, claims, filter);
COMMIT;
DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(format('%s %s %s: %s -> %s', role, claims, filter, before, after), '; ') INTO bad FROM viewers WHERE before IS DISTINCT FROM after;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'answers changed: %', bad; END IF;
  IF (SELECT after FROM viewers WHERE role = 'authenticated' AND filter = 'is_public = false' AND claims LIKE '%0001"}') <> '3' THEN
    RAISE EXCEPTION 'owner lost the private car'; END IF;
END $$;

-- the plan: a logged-out request for non-public rows is answered without touching the table
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('constraint_exclusion', 'on', true);
SET LOCAL ROLE anon;
CREATE TEMP TABLE IF NOT EXISTS plan_lines (line text);
DO $$ DECLARE r record; n int := 0; BEGIN
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT id FROM public.vehicles WHERE is_public = false LIMIT 1' LOOP
    IF r."QUERY PLAN" LIKE '%One-Time Filter: false%' THEN n := n + 1; END IF;
    IF r."QUERY PLAN" LIKE '%Scan on vehicles%' THEN RAISE EXCEPTION 'anon non-public read still scans: %', r."QUERY PLAN"; END IF;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'no One-Time Filter: false in the anon plan'; END IF;
END $$;
ROLLBACK;

-- the revert removes both
\ir revert_20261125174100_vehicles_anon_public_only.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'vehicles_anon_public_only') THEN RAISE EXCEPTION 'revert left the policy'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting, unnest(setconfig) c WHERE setrole = 'anon'::regrole AND c LIKE 'constraint_exclusion=%') THEN
    RAISE EXCEPTION 'revert left the role setting'; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'vehicle_plates_read(uuid[])')
     <> (SELECT policy_hash FROM copy_hash_before) THEN RAISE EXCEPTION 'revert did not re-record the copy back'; END IF;
  IF (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'stale_reader(uuid)') <> md5('drifted') THEN
    RAISE EXCEPTION 'revert re-recorded the drifted copy'; END IF;
END $$;
\echo vehicles_anon_public_only: ok
