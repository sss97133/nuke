-- Contract: library_coverage_v1. Library count stays NULL ("unknown_no_census") until a census exists and is
-- never derived from Nuke rows. Census must add up. Ledger states bucket by capture month. Inventory drain states
-- map to kept_as_evidence / counted_elsewhere / pending / gave_up. Unowned-but-linked rows are counted.
-- Privileges: coverage and *_for functions are service-only, and the app can only report a phone census.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_library_coverage%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_library_coverage* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role, anon;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, is_external boolean DEFAULT false, documented_by_user_id uuid, imported_by uuid, exif_data jsonb);
-- The coverage function consumes the official ledger; here a fixture table stands in for its states.
CREATE TABLE public._fixture_ledger(image_id uuid PRIMARY KEY, state text);
CREATE FUNCTION public.capture_ledger_states(p_uid uuid, p_tz text, p_from date, p_to date)
RETURNS TABLE(image_id uuid, day date, state text, reason text, vehicle_id uuid, set_key text)
LANGUAGE sql STABLE AS $$
  SELECT f.image_id, NULL::date, f.state, NULL::text, NULL::uuid, NULL::text
  FROM public._fixture_ledger f JOIN public.vehicle_images vi ON vi.id = f.image_id WHERE vi.user_id = p_uid $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261112000000_library_inventory.sql
\i supabase/migrations/20261117140000_library_coverage_v1.sql

-- privileges
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_library_coverage_v1(uuid,text,date,date,text[])', 'EXECUTE'), 'anon cannot read coverage');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.capture_library_coverage_v1(uuid,text,date,date,text[])', 'EXECUTE'), 'authenticated cannot read another uid coverage');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_library_coverage_v1(uuid,text,date,date,text[])', 'EXECUTE'), 'service_role reads coverage');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.library_inventory_record_census_for(uuid,jsonb)', 'EXECUTE'), 'authenticated cannot census for another user');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.library_inventory_upsert_for(uuid,text,jsonb,uuid)', 'EXECUTE'), 'authenticated cannot upsert for another user');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.library_inventory_record_census(jsonb)', 'EXECUTE'), 'app reports census');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public._library_census_row(uuid,jsonb)', 'EXECUTE'), 'census helper is private');

INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-0000000000aa'), ('00000000-0000-4000-8000-0000000000bb');
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000aa', NULL, NULL),
                            ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-0000000000bb', NULL, NULL);
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, source, documented_by_user_id, is_external) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', NULL, '2017-03-10 18:00+00', 'iphoto', NULL, false),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2017-03-11 18:00+00', 'iphoto', NULL, false),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', NULL, '2017-03-12 18:00+00', 'iphoto', NULL, false),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2017-04-02 18:00+00', 'iphoto', NULL, false),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'user_upload', NULL, false),
 -- month boundary: 2017-05-01 03:00 UTC is still April in Los Angeles
 ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', NULL, '2017-05-01 03:00+00', 'iphoto', NULL, false),
 -- unowned but linked: documented_by, and on own vehicle; plus non-linked and external controls
 ('00000000-0000-4000-8000-000000000011', NULL, '00000000-0000-4000-8000-00000000f002', '2017-03-05 18:00+00', 'hd_archive', '00000000-0000-4000-8000-0000000000aa', false),
 ('00000000-0000-4000-8000-000000000012', NULL, '00000000-0000-4000-8000-00000000f001', '2017-03-06 18:00+00', 'ssd_blast', NULL, false),
 ('00000000-0000-4000-8000-000000000013', NULL, NULL, '2017-03-06 18:00+00', 'ssd_blast', NULL, false),
 ('00000000-0000-4000-8000-000000000014', NULL, '00000000-0000-4000-8000-00000000f001', '2017-03-06 18:00+00', 'bat_import', NULL, true),
 -- another user's photo never counts
 ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000bb', NULL, '2017-03-10 18:00+00', 'iphoto', NULL, false);
INSERT INTO _fixture_ledger VALUES
 ('00000000-0000-4000-8000-000000000001', 'on_vehicle'), ('00000000-0000-4000-8000-000000000002', 'private'),
 ('00000000-0000-4000-8000-000000000003', 'held'), ('00000000-0000-4000-8000-000000000004', 'unsorted'),
 ('00000000-0000-4000-8000-000000000005', 'duplicate'), ('00000000-0000-4000-8000-000000000006', 'unverified'),
 ('00000000-0000-4000-8000-000000000021', 'unsorted');

-- 1. no census: library_count NULL, status unknown, coverage NULL, nuke side still reported
DO $$
DECLARE r record; n int;
BEGIN
  SELECT count(*) INTO n FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30');
  PERFORM pg_temp.assert_true(n = 7, 'six months plus undated, got ' || n);
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-03';
  PERFORM pg_temp.assert_true(r.library_count IS NULL AND r.library_count_status = 'unknown_no_census' AND r.coverage_pct IS NULL, 'no census means unknown');
  PERFORM pg_temp.assert_true(r.nuke_rows = 3 AND r.sorted = 2 AND r.sorted_on_vehicle = 1 AND r.held_for_review = 1 AND r.in_nuke_unsorted = 0, 'march nuke states');
  PERFORM pg_temp.assert_true(r.unowned_linked_rows = 2, 'march unowned linked = documented_by + own vehicle, got ' || r.unowned_linked_rows);
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-04';
  PERFORM pg_temp.assert_true(r.nuke_rows = 2 AND r.in_nuke_unsorted = 1 AND r.held_for_review = 1, 'april incl LA boundary');
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = 'undated';
  PERFORM pg_temp.assert_true(r.nuke_rows = 1 AND r.sorted = 1, 'undated row');
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-05';
  PERFORM pg_temp.assert_true(r.nuke_rows = 0 AND r.library_count IS NULL, 'may empty, still unknown not zero');
END $$;

-- 2. census validation and app origin restriction
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000aa', false);
DO $$ BEGIN
  PERFORM library_inventory_record_census('{"run_id":"00000000-0000-4000-8000-00000000c001","origin_source":"ios_photokit","total_count":10,"month_counts":{"2017-03":4},"undated_count":1,"finished_at":"2026-11-17T12:00:00Z","producer":"test"}');
  RAISE EXCEPTION 'expected add-up failure';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%does not add up%' THEN RAISE; END IF; END $$;
DO $$ BEGIN
  PERFORM library_inventory_record_census('{"run_id":"00000000-0000-4000-8000-00000000c001","origin_source":"mac_photos","total_count":0,"finished_at":"2026-11-17T12:00:00Z","producer":"test"}');
  RAISE EXCEPTION 'expected origin failure';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%only report origin_source ios_photokit%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true(library_inventory_record_census(
  ('{"run_id":"00000000-0000-4000-8000-00000000c001","origin_source":"ios_photokit","origin_scope":"full","total_count":12,'
   || '"month_counts":{"2017-03":5,"2017-04":4,"2017-06":2},"undated_count":1,"started_at":"2026-11-17T11:00:00Z",'
   || '"finished_at":"' || to_char((now() - interval '2 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || '","producer":"test"}')::jsonb) IS NOT NULL, 'phone census recorded');
-- inventory rows with cloud identifier, plus outcomes
SELECT pg_temp.assert_true(library_inventory_upsert(
  '[{"asset_local_id":"A1/L0/001","creation_date":"2017-03-10T18:00:00Z","gate_verdict":"off_site","cloud_identifier":"CL1"},
    {"asset_local_id":"A2/L0/001","creation_date":"2017-03-11T18:00:00Z","gate_verdict":"at_site"},
    {"asset_local_id":"A3/L0/001","creation_date":"2017-03-12T18:00:00Z","gate_verdict":"at_site"},
    {"asset_local_id":"A4/L0/001","creation_date":"2017-06-12T18:00:00Z","gate_verdict":"at_site"}]'::jsonb, NULL) = 4, 'upsert 4');
SELECT pg_temp.assert_true(library_inventory_upsert('[{"asset_local_id":"A1/L0/001","creation_date":"2017-03-10T18:00:00Z","gate_verdict":"off_site"}]'::jsonb, NULL) = 1, 'reupsert');
SELECT pg_temp.assert_true(library_inventory_record_outcomes(
  '[{"asset_local_id":"A1/L0/001","state":"off_site"},{"asset_local_id":"A2/L0/001","state":"deduped"},{"asset_local_id":"A4/L0/001","state":"gave_up","reason":"x"}]'::jsonb) = 3, 'outcomes');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT cloud_identifier FROM library_inventory WHERE asset_local_id = 'A1/L0/001') = 'CL1', 'cloud id kept when a later page omits it');

-- 3. with census: L from census, coverage = (sorted + kept + deduped) / L
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-03';
  PERFORM pg_temp.assert_true(r.library_count = 5 AND r.library_count_status = 'census' AND r.census_origins = 1, 'march L=5');
  PERFORM pg_temp.assert_true(r.kept_as_evidence = 1 AND r.counted_elsewhere = 1 AND r.pending = 1 AND r.inventoried = 3, 'march inventory states');
  PERFORM pg_temp.assert_true(r.coverage_pct = 80.0, 'march coverage (2+1+1)/5 = 80, got ' || r.coverage_pct);
  PERFORM pg_temp.assert_true(r.census_age_hours BETWEEN 1.9 AND 2.1, 'census age ~2h');
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-05';
  PERFORM pg_temp.assert_true(r.library_count = 0 AND r.coverage_pct IS NULL, 'census month absent = 0, coverage undefined');
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-06';
  PERFORM pg_temp.assert_true(r.library_count = 2 AND r.gave_up = 1, 'june gave_up');
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000bb', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-03';
  PERFORM pg_temp.assert_true(r.library_count IS NULL AND r.nuke_rows = 1, 'other user has no census');
END $$;

-- 4. service Mac census: prefix enforced, limited scope disables coverage, second origin is lower bound
DO $$ BEGIN
  PERFORM library_inventory_upsert_for('00000000-0000-4000-8000-0000000000aa', 'mac_photos', '[{"asset_local_id":"UUID-1"}]'::jsonb, NULL);
  RAISE EXCEPTION 'expected prefix failure';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%must start with%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true(library_inventory_upsert_for('00000000-0000-4000-8000-0000000000aa', 'mac_photos',
  '[{"asset_local_id":"mac_photos:UUID-1","creation_date":"2017-03-10T18:00:00Z"}]'::jsonb, NULL) = 1, 'mac upsert');
SELECT pg_temp.assert_true((SELECT origin_source FROM library_inventory WHERE asset_local_id='mac_photos:UUID-1') = 'mac_photos', 'origin stamped');
SELECT pg_temp.assert_true(library_inventory_record_census_for('00000000-0000-4000-8000-0000000000aa',
  ('{"run_id":"00000000-0000-4000-8000-00000000c002","origin_source":"mac_photos","origin_scope":"full","total_count":7,'
   || '"month_counts":{"2017-03":7},"undated_count":0,"finished_at":"' || to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || '","producer":"test"}')::jsonb) IS NOT NULL, 'mac census');
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-03';
  PERFORM pg_temp.assert_true(r.library_count = 7 AND r.library_count_status = 'max_of_origins_lower_bound' AND r.census_origins = 2, 'max of origins');
END $$;
DO $$ BEGIN
  PERFORM library_inventory_record_census_for('00000000-0000-4000-8000-0000000000aa', '{"run_id":"00000000-0000-4000-8000-00000000c003","origin_source":"ios_photokit","total_count":0,"finished_at":"2026-11-17T12:00:00Z","producer":"x"}');
  RAISE EXCEPTION 'expected phone-from-service failure';
EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%comes from the app%' THEN RAISE; END IF; END $$;
SELECT pg_temp.assert_true(library_inventory_record_census_for('00000000-0000-4000-8000-0000000000aa',
  ('{"run_id":"00000000-0000-4000-8000-00000000c004","origin_source":"mac_photos","origin_scope":"limited","total_count":1,'
   || '"month_counts":{"2017-03":1},"finished_at":"' || to_char((now() + interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || '","producer":"test"}')::jsonb) IS NOT NULL, 'limited census');
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM capture_library_coverage_v1('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', '2017-01-01', '2017-06-30') WHERE month = '2017-03';
  PERFORM pg_temp.assert_true(r.library_count_status = 'limited_scope_lower_bound' AND r.coverage_pct IS NULL, 'limited scope never yields coverage');
END $$;

-- 5. revert refuses while reported rows exist; the disposable fixture rows are cleared first
DO $$ BEGIN
  PERFORM 1; -- census rows exist here
  BEGIN
    EXECUTE 'DO $x$ BEGIN IF (SELECT count(*) FROM public.library_inventory_census) > 0 THEN RAISE EXCEPTION ''library_inventory_census has rows''; END IF; END $x$';
    RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%has rows%' THEN RAISE; END IF; END;
END $$;
DELETE FROM library_inventory_census;
DELETE FROM library_inventory WHERE origin_source <> 'ios_photokit';
\i supabase/sql/revert_20261117140000_library_coverage_v1.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_library_coverage_v1(uuid,text,date,date,text[])') IS NULL, 'reverted');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_inventory' AND column_name='cloud_identifier'), 'column dropped');
SELECT pg_temp.assert_true(library_inventory_upsert IS NOT NULL, 'parent upsert restored') FROM (SELECT 1) x, LATERAL (SELECT to_regprocedure('public.library_inventory_upsert(jsonb,uuid)') AS library_inventory_upsert) y;
\echo TEST_EXIT:0
