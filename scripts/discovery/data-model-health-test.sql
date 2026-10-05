-- Disposable PG17 acceptance for the actual metadata SELECT. Never run in prod.
-- psql -X -v ON_ERROR_STOP=1 -d dm_model_health_<suffix> -f scripts/discovery/data-model-health-test.sql
\set ON_ERROR_STOP on
SET timezone = 'UTC';
SET statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_model_health_%'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR to_regclass('public.vehicles') IS NOT NULL
     OR to_regclass('public.v_schema_atlas') IS NOT NULL
     OR to_regclass('public.v_job_health') IS NOT NULL
     OR to_regnamespace('auth') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_model_health_* PG17 database';
  END IF;
END $$;
BEGIN;
CREATE TABLE public.vehicles(id integer PRIMARY KEY);
CREATE TABLE public.vehicle_observations(id integer PRIMARY KEY, vehicle_id integer);
INSERT INTO public.vehicle_observations VALUES (1, 99);
ALTER TABLE public.vehicle_observations ADD CONSTRAINT observation_vehicle_fk
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) NOT VALID;
CREATE TABLE public.vehicle_events(id integer PRIMARY KEY);
CREATE TABLE public.listing_page_snapshots(id integer);
CREATE TABLE public.vehicle_field_consensus(id integer PRIMARY KEY);
CREATE TABLE public.observation_properties(id integer PRIMARY KEY);
-- schema_proposals is intentionally absent; observation_properties lacks atlas
-- metadata despite existing in the catalog, so these gaps cannot be conflated.
CREATE TABLE public.v_schema_atlas(
  table_name text, activity text, est_rows bigint, n_cols bigint,
  n_cols_described bigint, registry_owners text[], registry_fields bigint,
  last_write timestamptz
);
INSERT INTO public.v_schema_atlas VALUES
  ('vehicles', 'written', 100, 4, 2, ARRAY['canonical_fixture_writer'], 2, '2026-01-01Z'),
  ('vehicle_observations', 'written', 200, 3, 0, NULL, NULL, NULL),
  ('vehicle_events', 'idle', 0, 2, 2, NULL, NULL, NULL),
  ('listing_page_snapshots', 'written', 300, 2, 2, ARRAY['archiveFetch'], 1, NULL),
  ('vehicle_field_consensus', 'written', 100, 2, 2, ARRAY['detect_field_conflicts'], 1, '2026-01-01Z');
CREATE TABLE public.v_job_health(
  jobid bigint, jobname text, schedule text, active boolean, last_status text,
  last_run_at timestamptz, runs_24h bigint, failed_24h bigint,
  consecutive_failures bigint, assay_status text, health_status text,
  command text DEFAULT 'PRIVATE_COMMAND_MARKER', last_error text DEFAULT 'PRIVATE_ERROR_MARKER',
  assay jsonb DEFAULT '{"operator_payload":"PRIVATE_ASSAY_MARKER"}'
);
INSERT INTO public.v_job_health
  (jobid, jobname, schedule, active, last_status, last_run_at, runs_24h,
   failed_24h, consecutive_failures, assay_status, health_status)
VALUES
  (1, 'drain-vehicle-derived-queues', '*/5 * * * *', true, 'succeeded', now(), 288, 0, 0, 'failed', 'failed'),
  (2, 'derivation-queue-drain', '*/10 * * * *', true, 'succeeded', now(), 144, 0, 0, NULL, 'passed'),
  (3, 'derive-vehicle-image-attribution', '*/5 * * * *', false, 'failed', now(), 2, 1, 1, NULL, 'paused'),
  (4, 'bat-live-pull', '* * * * *', true, 'succeeded', now(), 1440, 0, 0, 'idle', 'idle');
CREATE TEMP TABLE query_text(line text);
\copy query_text FROM 'scripts/discovery/data-model-health.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02')
CREATE FUNCTION pg_temp.measure() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; sql text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY ctid) INTO sql FROM query_text;
  EXECUTE sql INTO result;
  RETURN result;
END $$;
CREATE TEMP TABLE reading AS SELECT pg_temp.measure() AS health;
CREATE FUNCTION pg_temp.table_reading(k text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT item FROM reading CROSS JOIN LATERAL jsonb_array_elements(health->'tables') item
  WHERE item->>'table_name' = k
$$;
CREATE FUNCTION pg_temp.job_reading(k text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT item FROM reading CROSS JOIN LATERAL jsonb_array_elements(health->'jobs') item
  WHERE item->>'job_name' = k
$$;
CREATE TEMP TABLE checks(label text);
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ASSERT ok IS TRUE, label;
  INSERT INTO checks VALUES (label);
END $$;
SELECT pg_temp.check((SELECT health->>'version' = 'data_model_health_v1'
  AND (health->>'measured_at')::timestamptz BETWEEN transaction_timestamp() AND clock_timestamp()
  FROM reading), 'versioned dated receipt');
SELECT pg_temp.check((SELECT jsonb_array_length(health->'tables') = 7
  AND jsonb_array_length(health->'scope'->'tables') = 7
  AND jsonb_array_length(health->'jobs') = 5
  AND jsonb_array_length(health->'scope'->'jobs') = 5 FROM reading), 'complete fixed scope includes missing objects');
SELECT pg_temp.check(pg_temp.table_reading('schema_proposals')->>'catalog_present' = 'false'
  AND pg_temp.table_reading('schema_proposals')->'constraints'->>'status' = 'unmeasured'
  AND pg_temp.table_reading('schema_proposals')->'constraints'->'total' = 'null'::jsonb,
  'missing table not mistaken for zero-constraint table');
SELECT pg_temp.check(pg_temp.table_reading('observation_properties')->>'catalog_present' = 'true'
  AND pg_temp.table_reading('observation_properties')->>'atlas_present' = 'false'
  AND pg_temp.table_reading('observation_properties')->'columns'->>'description_status' = 'unmeasured',
  'catalog presence distinct from missing atlas metadata');
SELECT pg_temp.check(pg_temp.table_reading('vehicle_observations')->'constraints'->>'status' = 'pending_validation'
  AND pg_temp.table_reading('vehicle_observations')->'constraints'->>'total' = '2'
  AND pg_temp.table_reading('vehicle_observations')->'constraints'->>'validated' = '1'
  AND pg_temp.table_reading('vehicle_observations')->'constraints'->'unvalidated'->0->>'name' = 'observation_vehicle_fk'
  AND pg_temp.table_reading('vehicle_observations')->'constraints'->'unvalidated'->0->>'type' = 'foreign_key',
  'existing invalid historical reference remains pending validation');
SELECT pg_temp.check(pg_temp.table_reading('vehicles')->'constraints'->>'status' = 'validated'
  AND pg_temp.table_reading('listing_page_snapshots')->'constraints'->>'status' = 'none_registered',
  'validated and no declared constraints remain distinct');
SELECT pg_temp.check(pg_temp.table_reading('vehicles')->'columns'->>'description_status' = 'partial'
  AND pg_temp.table_reading('vehicle_observations')->'columns'->>'description_status' = 'undocumented'
  AND pg_temp.table_reading('vehicle_events')->'columns'->>'description_status' = 'described',
  'description presence measured without semantic verification');
SELECT pg_temp.check(pg_temp.table_reading('vehicles')->'registry'->'owners' = '["canonical_fixture_writer"]'::jsonb
  AND pg_temp.table_reading('vehicle_observations')->'registry'->>'status' = 'unregistered'
  AND pg_temp.table_reading('observation_properties')->'registry'->>'status' = 'unmeasured',
  'registered ownership and unavailable registry evidence remain distinct');
SELECT pg_temp.check(pg_temp.table_reading('listing_page_snapshots')->>'activity' = 'written'
  AND pg_temp.table_reading('listing_page_snapshots')->'write_receipt'->>'status' = 'unmeasured'
  AND pg_temp.table_reading('vehicles')->'write_receipt'->>'status' = 'recorded',
  'missing receipt never means no writes');
SELECT pg_temp.check(pg_temp.job_reading('derivation-queue-drain')->'execution'->>'state' = 'succeeded'
  AND pg_temp.job_reading('derivation-queue-drain')->'assay'->>'state' = 'unmeasured'
  AND pg_temp.job_reading('derivation-queue-drain')->>'reported_health_status' = 'passed',
  'successful execution and source health cannot fabricate output verification');
SELECT pg_temp.check(pg_temp.job_reading('drain-vehicle-derived-queues')->'execution'->>'state' = 'succeeded'
  AND pg_temp.job_reading('drain-vehicle-derived-queues')->'assay'->>'state' = 'failed',
  'output assay failure survives successful job execution');
SELECT pg_temp.check(pg_temp.job_reading('derive-vehicle-image-attribution')->'execution'->>'state' = 'paused'
  AND pg_temp.job_reading('derive-vehicle-image-attribution')->'execution'->>'last_status' = 'failed',
  'paused job preserves last execution evidence without claiming current breakage');
SELECT pg_temp.check(pg_temp.job_reading('derive-vehicle-image-attribution-sweep')->>'present' = 'false'
  AND pg_temp.job_reading('derive-vehicle-image-attribution-sweep')->'execution'->>'state' = 'missing',
  'missing requested job retained in denominator');
SELECT pg_temp.check(pg_temp.job_reading('bat-live-pull')->'assay'->>'state' = 'idle',
  'no eligible assay sample is not a pass');
SELECT pg_temp.check((SELECT health::text NOT LIKE '%PRIVATE_%'
  AND NOT (health ? 'status') FROM reading), 'no private command error assay payload or blanket healthy flag');
-- A valid new row does not validate the older row; only a successful explicit
-- catalog validation after repairing this synthetic fixture changes its status.
INSERT INTO public.vehicles VALUES (99);
ALTER TABLE public.vehicle_observations VALIDATE CONSTRAINT observation_vehicle_fk;
UPDATE reading SET health = pg_temp.measure();
SELECT pg_temp.check(pg_temp.table_reading('vehicle_observations')->'constraints'->>'status' = 'validated'
  AND pg_temp.table_reading('vehicle_observations')->'constraints'->'unvalidated' = '[]'::jsonb,
  'constraint validation transition read from actual catalog');
UPDATE public.v_job_health SET assay_status = 'future_status' WHERE jobid = 1;
UPDATE reading SET health = pg_temp.measure();
SELECT pg_temp.check(pg_temp.job_reading('drain-vehicle-derived-queues')->'assay'->>'state' = 'unmeasured'
  AND pg_temp.job_reading('drain-vehicle-derived-queues')->'assay'->>'reported_status' = 'future_status',
  'unrecognized assay vocabulary preserved without a fabricated pass');
SELECT count(*) AS data_model_health_checks_passed FROM checks;
ROLLBACK;
