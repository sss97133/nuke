\set ON_ERROR_STOP on
-- Disposable synthetic contract for 20261106100000_legacy_owner_views_revoked.sql. The three legacy owner views are rebuilt here as
-- plain views over one synthetic table, with the grants Supabase's default privileges gave them on prod. Nothing real is read.
-- Covered: after the migration no API role (and not PUBLIC) holds any privilege on the three views; the owner role and service_role
-- keep reading them; the dependent view that reads one of them still answers; a database without the views is left unchanged
-- (the migration is replay-safe); a re-apply changes nothing.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Requires a disposable dm_refinement_* database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- A database without the views: the migration changes nothing and does not fail.
\ir ../migrations/20261106100000_legacy_owner_views_revoked.sql

CREATE TABLE public.synthetic_schedule_c_source(tax_year integer, line text, amount numeric);
INSERT INTO public.synthetic_schedule_c_source VALUES (2024, '1', 100), (2024, '28', 40);
CREATE VIEW public.schedule_c_detail AS SELECT * FROM public.synthetic_schedule_c_source;
CREATE VIEW public.skylar_schedule_c AS SELECT tax_year, sum(amount) AS total FROM public.schedule_c_detail GROUP BY tax_year;
CREATE VIEW public.skylar_income_statement AS SELECT tax_year, sum(amount) AS revenue FROM public.synthetic_schedule_c_source GROUP BY tax_year;
-- What prod showed (read-only, 2026-10-29): SELECT and write bits for authenticated, write bits for anon, service_role everything.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.schedule_c_detail, public.skylar_schedule_c, public.skylar_income_statement TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.schedule_c_detail, public.skylar_schedule_c, public.skylar_income_statement TO anon;
SELECT pg_temp.ok('before the migration a signed-in account can read all three views (the leak)',
  has_table_privilege('authenticated', 'public.skylar_income_statement', 'SELECT') AND has_table_privilege('authenticated', 'public.schedule_c_detail', 'SELECT')
  AND has_table_privilege('authenticated', 'public.skylar_schedule_c', 'SELECT'));

\ir ../migrations/20261106100000_legacy_owner_views_revoked.sql
\ir ../migrations/20261106100000_legacy_owner_views_revoked.sql

SELECT pg_temp.ok('after the migration anon and authenticated hold no privilege at all on any of the three views',
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['skylar_schedule_c', 'schedule_c_detail', 'skylar_income_statement']) v,
                   unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p,
                   unnest(ARRAY['anon', 'authenticated']) r
              WHERE has_table_privilege(r, 'public.' || v, p)));
SELECT pg_temp.ok('service_role keeps its access (the owner role is the view owner and reads as before)',
  has_table_privilege('service_role', 'public.skylar_income_statement', 'SELECT') AND has_table_privilege('service_role', 'public.schedule_c_detail', 'SELECT')
  AND has_table_privilege('service_role', 'public.skylar_schedule_c', 'SELECT'));
SELECT pg_temp.ok('the dependent view still answers (it runs as its owner, which kept its rights)',
  (SELECT total FROM public.skylar_schedule_c WHERE tax_year = 2024) = 140 AND (SELECT revenue FROM public.skylar_income_statement WHERE tax_year = 2024) = 140);
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM * FROM public.skylar_income_statement; RAISE EXCEPTION 'a signed-in account read the income statement'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.schedule_c_detail; RAISE EXCEPTION 'a signed-in account read schedule_c_detail'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN PERFORM * FROM public.skylar_schedule_c; RAISE EXCEPTION 'anon read the schedule c view'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'PASS a signed-in account and anon are refused with insufficient_privilege (42501)';
END $$;
