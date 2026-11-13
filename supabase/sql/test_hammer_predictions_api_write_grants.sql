-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_hp_grants -f this-file.sql
-- Contract for 20261109011000_hammer_predictions_api_write_grants.sql. Synthetic rows only; never production.
-- The fixture carries the live grants (2026-11-08): table-level writes for anon and authenticated, SELECT on nine columns,
-- one model 31 read policy. After the migration: no write privilege for either role, the nine column reads unchanged and
-- still answered, the service role unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.hammer_predictions') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.hammer_predictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, model_version integer,
  price_tier text, comp_count integer, predicted_hammer numeric, predicted_low numeric, predicted_high numeric,
  predicted_at timestamptz DEFAULT now(), current_bid numeric, notes text);
ALTER TABLE public.hammer_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hammer_predictions_live_bands_read ON public.hammer_predictions FOR SELECT TO anon, authenticated USING (model_version = 31);
GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.hammer_predictions TO anon, authenticated;
GRANT SELECT (id, vehicle_id, price_tier, model_version, comp_count, predicted_hammer, predicted_low, predicted_high, predicted_at)
  ON public.hammer_predictions TO anon, authenticated;
GRANT ALL ON public.hammer_predictions TO service_role;
INSERT INTO public.hammer_predictions (model_version, predicted_hammer, predicted_low, predicted_high, current_bid) VALUES
  (31, 100, 80, 120, 50), (33, 200, 150, 250, 90);

SELECT pg_temp.ok('fixture: anon can truncate before', has_table_privilege('anon', 'public.hammer_predictions', 'TRUNCATE'));

\ir ../migrations/20261109011000_hammer_predictions_api_write_grants.sql

SELECT pg_temp.ok('no write privilege left for anon or authenticated',
  NOT has_table_privilege('anon', 'public.hammer_predictions', 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.hammer_predictions', 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES'));
SELECT pg_temp.ok('the nine column reads stay, the others stay closed',
  (SELECT count(*) FROM information_schema.column_privileges
   WHERE table_name = 'hammer_predictions' AND grantee = 'anon' AND privilege_type = 'SELECT') = 9
  AND NOT has_column_privilege('anon', 'public.hammer_predictions', 'current_bid', 'SELECT'));
SELECT pg_temp.ok('service_role keeps every privilege',
  has_table_privilege('service_role', 'public.hammer_predictions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'));

SET ROLE anon;
CREATE TEMP TABLE anon_read AS SELECT model_version, predicted_hammer FROM public.hammer_predictions;
RESET ROLE;
SELECT pg_temp.ok('anon still reads the model 31 band and only it',
  (SELECT count(*) = 1 AND min(model_version) = 31 AND min(predicted_hammer) = 100 FROM anon_read));

SET ROLE anon;
DO $$ BEGIN
  INSERT INTO public.hammer_predictions (model_version) VALUES (31);
  RAISE EXCEPTION 'Contract failed: anon inserted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon insert refused';
END $$;
DO $$ BEGIN
  TRUNCATE public.hammer_predictions;
  RAISE EXCEPTION 'Contract failed: anon truncated';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon truncate refused';
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  UPDATE public.hammer_predictions SET predicted_hammer = 1 WHERE model_version = 31;
  RAISE EXCEPTION 'Contract failed: authenticated updated';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS authenticated update refused';
END $$;
RESET ROLE;
SELECT pg_temp.ok('rows untouched', (SELECT count(*) FROM public.hammer_predictions) = 2);
