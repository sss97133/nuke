-- "Service role manages <table>" on 105 empty tables: the policy goes TO service_role, and anon and authenticated
-- lose their write grants.
--
-- Read on production 2026-10-14: 105 tables, all empty. They are the digital-twin subsystem tables of
-- docs/archive/database/migrations/digital_twin_*.sql, plus labor_rate_history, overhead_costs and
-- project_economics. Each has one read policy (USING true) and one ALL policy named "Service role manages <table>"
-- with no TO clause, so it applied to PUBLIC with USING (true) and WITH CHECK (true). INSERT, UPDATE, DELETE and
-- TRUNCATE were granted to anon and authenticated. Nothing writes them: the web app, the iOS app, edge functions,
-- scripts and SQL function bodies have no write reference to any of them (seats is read, never written). The service
-- role bypasses row security; the policy now names it. Reads are unchanged.
-- Contract: supabase/sql/test_service_role_catalog_policies.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE owp_catalog_tables (tbl text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO owp_catalog_tables (tbl) VALUES
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

-- Each table carries one write policy, "Service role manages <table>", as read on 2026-10-14 (PUBLIC) or as this
-- migration leaves it (service_role), with USING (true) and WITH CHECK (true). Anything else is drift, and nothing
-- changes.
DO $$
DECLARE
  v_drift text;
BEGIN
  SELECT string_agg(t.tbl, ', ' ORDER BY t.tbl) INTO v_drift
  FROM owp_catalog_tables t
  WHERE to_regclass('public.' || quote_ident(t.tbl)) IS NULL
    OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = to_regclass('public.' || quote_ident(t.tbl)) AND p.polcmd <> 'r') <> 1
    OR NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = to_regclass('public.' || quote_ident(t.tbl))
        AND p.polname = 'Service role manages ' || t.tbl AND p.polcmd = '*' AND p.polpermissive
        AND (p.polroles = '{0}'::oid[] OR p.polroles = ARRAY['service_role'::regrole::oid])
        AND pg_get_expr(p.polqual, p.polrelid) = 'true' AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true');
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'service-role catalog policies drifted from the 2026-10-14 read (%); not changing them', v_drift;
  END IF;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tbl FROM owp_catalog_tables ORDER BY tbl LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO service_role', 'Service role manages ' || r.tbl, r.tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', r.tbl);
  END LOOP;
END $$;

-- After: row security is on, no write policy admits PUBLIC, anon or authenticated, and neither API role holds a
-- write grant.
DO $$
DECLARE
  v_open text;
BEGIN
  SELECT string_agg(problem, '; ') INTO v_open FROM (
    SELECT t.tbl || ': row security off' AS problem
    FROM owp_catalog_tables t JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(t.tbl))
    WHERE NOT c.relrowsecurity
    UNION ALL
    SELECT t.tbl || '.' || p.polname || ' admits an API role'
    FROM owp_catalog_tables t JOIN pg_policy p ON p.polrelid = to_regclass('public.' || quote_ident(t.tbl))
    WHERE p.polcmd <> 'r' AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid]
    UNION ALL
    SELECT t.tbl || ': ' || r.rolname || ' holds ' || g.priv
    FROM owp_catalog_tables t CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
      CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) g(priv)
    WHERE has_table_privilege(r.rolname, to_regclass('public.' || quote_ident(t.tbl)), g.priv)
  ) found;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'service-role catalog policies: still open after the change: %', v_open;
  END IF;
END $$;

COMMIT;
