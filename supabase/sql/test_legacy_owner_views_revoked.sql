\set ON_ERROR_STOP on
-- Disposable synthetic contract for 20261106100000_legacy_owner_views_revoked.sql. The eighteen owner-rights views of the journal (the three
-- legacy views and fifteen siblings) are rebuilt here as plain views over one synthetic table, with the grants Supabase's default privileges gave
-- them on prod. Nothing real is read.
-- Covered: after the migration no API role holds any privilege on any of the eighteen; the owner role and service_role keep reading them; the
-- views that read another view of the set still answer; a view outside the set is left alone; a database without the views is left unchanged
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
-- The set the migration names, written out once more here so a name dropped from the migration fails this contract.
CREATE TEMP TABLE revoked_set(name text PRIMARY KEY);
INSERT INTO revoked_set VALUES
  ('skylar_schedule_c'), ('schedule_c_detail'), ('skylar_income_statement'),
  ('balance_sheet'), ('cash_flow_summary'), ('daily_ledger'), ('expense_by_category_year'), ('income_statement'), ('income_statement_annual'),
  ('income_statement_monthly'), ('ledger_by_vendor'), ('ledger_cumulative'), ('ledger_monthly'), ('ledger_total'), ('platform_burn_rate'),
  ('qb_review_queue'), ('trial_balance'), ('viva_income_statement');
GRANT SELECT ON revoked_set TO PUBLIC;

-- A database without the views: the migration changes nothing and does not fail.
\ir ../migrations/20261106100000_legacy_owner_views_revoked.sql

CREATE TABLE public.synthetic_schedule_c_source(tax_year integer, line text, amount numeric);
INSERT INTO public.synthetic_schedule_c_source VALUES (2024, '1', 100), (2024, '28', 40);
-- Three of the set read another view of the set, as they do on prod: skylar_schedule_c reads schedule_c_detail; skylar_income_statement and
-- viva_income_statement read income_statement_annual.
CREATE VIEW public.schedule_c_detail AS SELECT * FROM public.synthetic_schedule_c_source;
CREATE VIEW public.income_statement_annual AS SELECT tax_year, sum(amount) AS revenue FROM public.synthetic_schedule_c_source GROUP BY tax_year;
CREATE VIEW public.skylar_schedule_c AS SELECT tax_year, sum(amount) AS total FROM public.schedule_c_detail GROUP BY tax_year;
CREATE VIEW public.skylar_income_statement AS SELECT tax_year, revenue FROM public.income_statement_annual;
CREATE VIEW public.viva_income_statement AS SELECT tax_year, revenue FROM public.income_statement_annual;
DO $$ DECLARE v text; BEGIN
  FOR v IN SELECT name FROM pg_temp.revoked_set WHERE to_regclass('public.' || name) IS NULL LOOP
    EXECUTE format('CREATE VIEW public.%I AS SELECT * FROM public.synthetic_schedule_c_source', v);
  END LOOP;
END $$;
-- A view of the same kind that is not in the set: the migration must leave it alone.
CREATE VIEW public.synthetic_unrelated_view AS SELECT * FROM public.synthetic_schedule_c_source;
-- What prod showed (read-only, 2026-10-29), the same on every one of the eighteen: SELECT and write bits for authenticated, write bits for anon,
-- service_role everything.
DO $$ DECLARE v text; BEGIN
  FOR v IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I TO authenticated, service_role', v);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I TO anon', v);
  END LOOP;
END $$;
SELECT pg_temp.ok('the set is eighteen views and every one exists in this synthetic database',
  (SELECT count(*) FROM pg_temp.revoked_set) = 18 AND NOT EXISTS (SELECT 1 FROM pg_temp.revoked_set WHERE to_regclass('public.' || name) IS NULL));
SELECT pg_temp.ok('before the migration a signed-in account can read all eighteen views (the leak)',
  NOT EXISTS (SELECT 1 FROM pg_temp.revoked_set WHERE NOT has_table_privilege('authenticated', 'public.' || name, 'SELECT')));

\ir ../migrations/20261106100000_legacy_owner_views_revoked.sql
\ir ../migrations/20261106100000_legacy_owner_views_revoked.sql

SELECT pg_temp.ok('after the migration anon and authenticated hold no privilege at all on any of the eighteen views',
  NOT EXISTS (SELECT 1 FROM pg_temp.revoked_set s,
                   unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p,
                   unnest(ARRAY['anon', 'authenticated']) r
              WHERE has_table_privilege(r, 'public.' || s.name, p)));
SELECT pg_temp.ok('service_role keeps its access to all eighteen (the owner role is the view owner and reads as before)',
  NOT EXISTS (SELECT 1 FROM pg_temp.revoked_set WHERE NOT has_table_privilege('service_role', 'public.' || name, 'SELECT')));
SELECT pg_temp.ok('a view outside the set keeps every grant it had',
  has_table_privilege('authenticated', 'public.synthetic_unrelated_view', 'SELECT') AND has_table_privilege('service_role', 'public.synthetic_unrelated_view', 'SELECT')
  AND has_table_privilege('anon', 'public.synthetic_unrelated_view', 'INSERT'));
SELECT pg_temp.ok('the views that read another view of the set still answer (they run as their owner, which kept its rights)',
  (SELECT total FROM public.skylar_schedule_c WHERE tax_year = 2024) = 140
  AND (SELECT revenue FROM public.skylar_income_statement WHERE tax_year = 2024) = 140
  AND (SELECT revenue FROM public.viva_income_statement WHERE tax_year = 2024) = 140);
DO $$ DECLARE v text; BEGIN
  SET LOCAL ROLE authenticated;
  FOR v IN SELECT name FROM pg_temp.revoked_set ORDER BY name LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I', v); RAISE EXCEPTION 'a signed-in account read %', v; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  RESET ROLE;
  SET LOCAL ROLE anon;
  FOR v IN SELECT name FROM pg_temp.revoked_set ORDER BY name LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I', v); RAISE EXCEPTION 'anon read %', v; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'PASS a signed-in account and anon are refused with insufficient_privilege (42501) on each of the eighteen';
END $$;
