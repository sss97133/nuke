-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_service_role_catalog -f this-file.sql
-- Proves that after 20261014191500_service_role_catalog_policies.sql anon and signed-in callers can no longer
-- insert, update, delete or truncate any of the 105 tables whose "Service role manages <table>" policy applied to
-- PUBLIC, that the service role still writes them and the public reads survive, and that the live policy let anon
-- write every row. Starts from the live policies and grants as read on 2026-10-14 (one read policy and that ALL
-- policy per table). The seeds are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.alternators_generators') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;

CREATE TABLE public.t_catalog_tables (tbl text PRIMARY KEY);
INSERT INTO public.t_catalog_tables (tbl) VALUES
    ('alternators_generators'), ('audio_systems'), ('axle_bearings'), ('batteries'), ('body_bumpers'),
    ('body_convertible_tops'), ('body_emblems_badges'), ('body_glass'), ('body_lighting'), ('body_mirrors'),
    ('body_panels'), ('body_structure'), ('body_trim_chrome'), ('body_weatherstripping'), ('brake_calipers'),
    ('brake_drums'), ('brake_lines'), ('brake_pads_and_shoes'), ('brake_rotors'), ('brake_systems'), ('carpeting'),
    ('catalytic_converters'), ('comfort_electrical'), ('consoles'), ('coolant_hoses'), ('cooling_fans'),
    ('crash_structure'), ('cv_joints_or_u_joints'), ('dash_assemblies'), ('differentials'), ('door_panels'),
    ('driveshafts'), ('emissions_systems'), ('engine_accessories'), ('engine_connecting_rods'),
    ('engine_cooling_interfaces'), ('engine_cylinder_measurements'), ('engine_fuel_injection'), ('engine_hardware'),
    ('engine_pistons'), ('exhaust_pipes'), ('exhaust_tips'), ('exterior_lighting_electrical'), ('front_axles'),
    ('front_control_arms'), ('front_dampers'), ('front_springs'), ('front_steering_knuckles'),
    ('front_suspension_config'), ('front_sway_bars'), ('fuel_filters'), ('fuel_lines'), ('fuel_pumps'),
    ('fuel_system_electronics'), ('fuel_tanks'), ('fuse_panels'), ('gauges_instruments'), ('headliners'),
    ('heater_cores'), ('hubs_and_wheel_bearings'), ('hvac_systems'), ('ignition_switches'), ('intercoolers'),
    ('interior_trim'), ('labor_rate_history'), ('mufflers'), ('overflow_systems'), ('overhead_costs'),
    ('paint_systems'), ('power_steering_systems'), ('project_economics'), ('radiators'), ('rear_axles'),
    ('rear_cargo_areas'), ('rear_dampers'), ('rear_springs'), ('rear_suspension_config'), ('rear_sway_bars'),
    ('rear_trailing_arms_and_links'), ('safety_equipment'), ('seats'), ('sound_deadening'), ('spare_wheel_tire'),
    ('starters'), ('steering_columns'), ('steering_gearboxes'), ('steering_linkage'), ('steering_wheels'), ('tires'),
    ('transfer_case_controls'), ('transfer_case_internals'), ('transfer_cases'), ('transmission_cases'),
    ('transmission_clutch_systems'), ('transmission_controllers'), ('transmission_coolers'), ('transmission_gears'),
    ('transmission_internals'), ('transmission_shifters'), ('transmission_torque_converters'), ('truck_beds'),
    ('ventilation'), ('vin_plates_tags'), ('wheels'), ('wiring_harnesses')
;
GRANT SELECT ON public.t_catalog_tables TO anon, authenticated, service_role, owp_table_owner;

-- The 105 tables as live: a read policy, the ALL policy with no TO clause, row security on, every privilege granted
-- to the API roles; one row each. Owned like production's by a non-superuser.
SET ROLE owp_table_owner;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_catalog_tables LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text)', r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', 'Anyone can view ' || r.tbl, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)', 'Service role manages ' || r.tbl, r.tbl);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', r.tbl);
    EXECUTE format($f$INSERT INTO public.%I (note) VALUES ('seed')$f$, r.tbl);
  END LOOP;
END $$;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
-- Runs one statement as the current role; true when it raised insufficient_privilege, false when it ran.
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text), public.t_rows(text)
  TO anon, authenticated, service_role;

-- 1. Before: anon inserts, rewrites and deletes every row of every table.
SET ROLE anon;
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_catalog_tables LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)) = 1, format('before: anon inserts into %s', r.tbl));
    PERFORM public.t_assert(public.t_rows(format($f$UPDATE public.%I SET note = 'tampered'$f$, r.tbl)) = 2, format('before: anon rewrites every %s row', r.tbl));
    PERFORM public.t_assert(public.t_rows(format('DELETE FROM public.%I', r.tbl)) = 2, format('before: anon deletes every %s row', r.tbl));
  END LOOP;
END $$;
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014191500_service_role_catalog_policies.sql
\ir ../migrations/20261014191500_service_role_catalog_policies.sql
RESET ROLE;

-- 3. anon and authenticated: every write refused, the read intact; the service role writes.
DO $$
DECLARE r record; v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    FOR r IN SELECT tbl FROM public.t_catalog_tables LOOP
      PERFORM public.t_assert(public.t_refused(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)), format('%s insert refused on %s', v_role, r.tbl));
      PERFORM public.t_assert(public.t_refused(format($f$UPDATE public.%I SET note = 'tampered'$f$, r.tbl)), format('%s update refused on %s', v_role, r.tbl));
      PERFORM public.t_assert(public.t_refused(format('DELETE FROM public.%I', r.tbl)), format('%s delete refused on %s', v_role, r.tbl));
      PERFORM public.t_assert(public.t_refused(format('TRUNCATE public.%I', r.tbl)), format('%s truncate refused on %s', v_role, r.tbl));
      PERFORM public.t_assert(public.t_rows(format('SELECT 1 FROM public.%I', r.tbl)) = 1, format('%s still reads %s', v_role, r.tbl));
    END LOOP;
    RESET ROLE;
  END LOOP;
  SET LOCAL ROLE service_role;
  FOR r IN SELECT tbl FROM public.t_catalog_tables LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('service')$f$, r.tbl)) = 1, format('service role inserts into %s', r.tbl));
    PERFORM public.t_assert(public.t_rows(format($f$UPDATE public.%I SET note = 'service, updated' WHERE note = 'service'$f$, r.tbl)) = 1, format('service role updates %s', r.tbl));
    PERFORM public.t_assert(public.t_rows(format($f$DELETE FROM public.%I WHERE note = 'service, updated'$f$, r.tbl)) = 1, format('service role deletes from %s', r.tbl));
  END LOOP;
  RESET ROLE;
END $$;
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polroles = ARRAY['service_role'::regrole::oid] AND polname LIKE 'Service role manages %') = 105,
  'all 105 policies name the service role');
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polcmd = 'r' AND polname LIKE 'Anyone can view %') = 105, 'the 105 read policies are untouched');

-- 4. Drift stops the migration, and it changes nothing: (a) a second write policy on one table; (b) one policy's
--    expression changed.
SET ROLE owp_table_owner;
GRANT INSERT ON public.seats TO anon;
CREATE POLICY drifted_extra_write ON public.batteries FOR INSERT WITH CHECK (true);
\set ON_ERROR_STOP off
\ir ../migrations/20261014191500_service_role_catalog_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.seats', 'INSERT'), 'drift (a): the migration changed nothing');
DROP POLICY drifted_extra_write ON public.batteries;
ALTER POLICY "Service role manages tires" ON public.tires USING (false);
\set ON_ERROR_STOP off
\ir ../migrations/20261014191500_service_role_catalog_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.seats', 'INSERT'), 'drift (b): the migration changed nothing');
RESET ROLE;

SELECT 'service-role catalog policies contract: all checks passed' AS result;
