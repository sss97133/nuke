\set ON_ERROR_STOP on
-- PostgreSQL 17 contract for 20261014091000_schema_atlas_writer_skip_scan.sql.
-- Installs the live v_schema_atlas of 2026-10-14 (supabase/sql/helpers/v_schema_atlas_live_20261014.sql) over a
-- write_receipts table shaped as on prod, keeps a copy as the reference, applies the migration as a non-superuser deploy
-- role (the CONCURRENTLY build in autocommit, then the view), and proves:
--   1. every row and column equals the live definition: writers inside and outside 30 days, undeclared counts, tables
--      whose receipts are all older than 30 days, one writer with thousands of receipts beside a rare one, receipts that
--      share one transaction clock, writer names whose order depends on collation, and the 30-day edge;
--   2. the skip scan reads idx_write_receipts_tbl_writer_at, which is valid with the expected definition;
--   3. columns, owner and grants are unchanged.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable dm_refinement_* database required'; END IF;
END $$;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true, jobname text);
GRANT USAGE ON SCHEMA cron TO dm_contract_deployer;
GRANT SELECT ON cron.job TO dm_contract_deployer;
INSERT INTO cron.job (jobname, schedule, command, active) VALUES
  ('touch-alpha', '* * * * *', 'UPDATE public.alpha SET n = n', true),
  ('touch-beta', '* * * * *', 'SELECT count(*) FROM public.beta', false);

SET ROLE dm_contract_deployer;
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text, owned_by text NOT NULL,
  description text NOT NULL, do_not_write_directly boolean NOT NULL DEFAULT false, write_via text);
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL,
  op text NOT NULL, rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL, app_name text, txid bigint NOT NULL);
CREATE INDEX idx_write_receipts_at ON public.write_receipts USING btree (at DESC);
CREATE INDEX idx_write_receipts_tbl ON public.write_receipts USING btree (tbl, at DESC);
CREATE TABLE public.alpha (id bigint PRIMARY KEY, n integer);
CREATE TABLE public.beta (id bigint PRIMARY KEY, alpha_id bigint REFERENCES public.alpha (id));
CREATE TABLE public.gamma (id bigint PRIMARY KEY, note text);
CREATE TABLE public.delta (id bigint PRIMARY KEY);
COMMENT ON TABLE public.alpha IS 'contract table';
COMMENT ON COLUMN public.alpha.n IS 'a counter';
CREATE FUNCTION public.contract_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER gamma_touch BEFORE UPDATE ON public.gamma FOR EACH ROW EXECUTE FUNCTION public.contract_touch();
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description) VALUES
  ('alpha', 'n', 'alpha_writer', 'counter'), ('alpha', NULL, 'alpha_owner', 'table'), ('gamma', NULL, 'gamma_owner', 'table');

INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, txid)
SELECT v.at, v.tbl, 'INSERT', 1, v.writer, 'postgres', 1
  FROM (VALUES
    (now() - interval '40 days', 'alpha', 'a-first'),
    (now() - interval '1 hour', 'alpha', 'a-first'),
    (now() - interval '1 hour', 'alpha', 'w1'),
    (now() - interval '2 days', 'alpha', 'w1'),
    (now() - interval '31 days', 'alpha', 'w2'),
    (now() - interval '29 days 23 hours 55 minutes', 'alpha', 'edge-inside'),
    (now() - interval '30 days 5 minutes', 'alpha', 'edge-outside'),
    (now() - interval '35 days', 'beta', 'old-writer'),
    (now() - interval '40 days', 'beta', 'undeclared'),
    (now() - interval '3 hours', 'gamma', 'rare'),
    (now() - interval '45 days', 'gamma', 'rare'),
    (now() - interval '10 minutes', 'zz_not_public', 'ghost'),
    (now() - interval '5 hours', 'delta', 'Writer'),
    (now() - interval '5 hours', 'delta', 'writer'),
    (now() - interval '5 hours', 'delta', 'a b'),
    (now() - interval '5 hours', 'delta', 'écrire'),
    (now() - interval '5 hours', 'delta', 'Écrire'),
    (now() - interval '5 hours', 'delta', '_lead')) v(at, tbl, writer);
INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, txid)
SELECT now() - (k % 40) * interval '1 day' - interval '1 minute', 'alpha', 'INSERT', 1, 'undeclared', 'postgres', k
  FROM generate_series(1, 400) k;
INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, txid)
SELECT now() - (k % 20) * interval '1 hour' - interval '1 minute', 'gamma', 'UPDATE', 1, 'bulk', 'postgres', k
  FROM generate_series(1, 6000) k;
INSERT INTO public.write_receipts (at, tbl, op, rows, writer, db_role, txid)
SELECT now() - interval '6 hours', 'delta', 'INSERT', 1, 'one-transaction', 'postgres', 7 FROM generate_series(1, 500);
ANALYZE public.write_receipts;

\ir helpers/v_schema_atlas_live_20261014.sql
REVOKE ALL ON public.v_schema_atlas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_schema_atlas TO service_role;
SELECT format('CREATE VIEW public.v_schema_atlas_reference AS %s', pg_get_viewdef('public.v_schema_atlas'::regclass, true)) \gexec
DO $$ BEGIN
  IF encode(sha256(convert_to(pg_get_viewdef('public.v_schema_atlas'::regclass, true), 'UTF8')), 'base64')
     <> '9HlM42Hc0M4rA6FDQltdavnEUJoToVG8NeXHCQJFxNk=' THEN
    RAISE EXCEPTION 'fixture definition does not reproduce the prod hash of 2026-10-14';
  END IF;
END $$;

\ir ../migrations/20261014091000_schema_atlas_writer_skip_scan.sql
RESET ROLE;

-- 1. Same rows and columns as the live definition ---------------------------------------------------------------------
DO $$ DECLARE n_new bigint; n_ref bigint; BEGIN
  SELECT count(*) INTO n_new FROM (SELECT * FROM public.v_schema_atlas EXCEPT ALL SELECT * FROM public.v_schema_atlas_reference) x;
  SELECT count(*) INTO n_ref FROM (SELECT * FROM public.v_schema_atlas_reference EXCEPT ALL SELECT * FROM public.v_schema_atlas) x;
  IF n_new <> 0 OR n_ref <> 0 OR (SELECT count(*) FROM public.v_schema_atlas) < 6 THEN
    RAISE EXCEPTION 'v_schema_atlas differs from the live definition (% new-only, % live-only)', n_new, n_ref;
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT writers_30d FROM public.v_schema_atlas WHERE table_name = 'alpha') <> ARRAY['a-first', 'edge-inside', 'undeclared', 'w1']
     OR (SELECT undeclared_stmts_30d FROM public.v_schema_atlas WHERE table_name = 'alpha')
        <> (SELECT count(*) FROM public.write_receipts WHERE tbl = 'alpha' AND writer = 'undeclared' AND at > now() - interval '30 days')
     OR (SELECT writers_30d FROM public.v_schema_atlas WHERE table_name = 'beta') IS NOT NULL
     OR (SELECT last_write FROM public.v_schema_atlas WHERE table_name = 'beta') IS NOT NULL
     OR (SELECT writers_30d FROM public.v_schema_atlas WHERE table_name = 'gamma') <> ARRAY['bulk', 'rare']
     OR (SELECT undeclared_stmts_30d FROM public.v_schema_atlas WHERE table_name = 'gamma') <> 0
     OR (SELECT array_length(writers_30d, 1) FROM public.v_schema_atlas WHERE table_name = 'delta') <> 7
     OR (SELECT last_write FROM public.v_schema_atlas WHERE table_name = 'alpha')
        <> (SELECT max(at) FROM public.write_receipts WHERE tbl = 'alpha') THEN
    RAISE EXCEPTION 'fixture does not exercise the writer columns as intended';
  END IF;
END $$;

-- 2. The mechanism: a valid index, read by the skip scan --------------------------------------------------------------
DO $$ DECLARE plan text; BEGIN
  IF NOT coalesce((SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.idx_write_receipts_tbl_writer_at')), false)
     OR pg_get_indexdef(to_regclass('public.idx_write_receipts_tbl_writer_at')) NOT LIKE '% USING btree (tbl, writer, at DESC)' THEN
    RAISE EXCEPTION 'idx_write_receipts_tbl_writer_at missing or invalid';
  END IF;
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT writers_30d, undeclared_stmts_30d, last_write FROM public.v_schema_atlas' INTO plan;
  IF plan NOT LIKE '%idx_write_receipts_tbl_writer_at%' OR plan NOT LIKE '%Recursive Union%' THEN
    RAISE EXCEPTION 'the writer columns must be read by the skip scan over idx_write_receipts_tbl_writer_at';
  END IF;
END $$;

-- 3. Columns, owner and grants ----------------------------------------------------------------------------------------
DO $$ BEGIN
  IF (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_schema_atlas'::regclass AND attnum > 0)
     IS DISTINCT FROM (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_schema_atlas_reference'::regclass AND attnum > 0) THEN
    RAISE EXCEPTION 'v_schema_atlas columns changed';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.v_schema_atlas'::regclass)) <> 'dm_contract_deployer'
     OR NOT has_table_privilege('service_role', 'public.v_schema_atlas', 'SELECT')
     OR has_table_privilege('anon', 'public.v_schema_atlas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.v_schema_atlas', 'SELECT') THEN
    RAISE EXCEPTION 'v_schema_atlas owner or grants changed';
  END IF;
END $$;
BEGIN READ ONLY;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.v_schema_atlas WHERE writers_30d IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'service_role must read the writer columns';
  END IF;
END $$;
COMMIT;

SELECT 'schema atlas writers contract passed' AS result;
