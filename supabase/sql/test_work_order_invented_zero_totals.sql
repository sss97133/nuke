-- Disposable PG17 only. Proves 20261020000500_work_order_invented_zero_totals.sql: only $0 totals with no priced basis become
-- NULL, each change writes one audit row, rows with any stated amount or payment meaning are untouched, the estimate trigger
-- does not rewrite them, and a rerun changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.work_orders') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE public.work_orders(id uuid PRIMARY KEY, title text, status text, estimated_labor_cost numeric, estimated_parts_cost numeric,
  estimated_total numeric, estimated_cost_cents integer, actual_labor_cost numeric, actual_parts_cost numeric, actual_total numeric, updated_at timestamptz);
CREATE TABLE public.work_order_labor(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, hours numeric, hourly_rate numeric, total_cost numeric);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, part_name text, unit_price numeric, total_price numeric);
CREATE TABLE public.work_order_quotes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid);
CREATE TABLE public.work_order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, status text);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(), table_name text, column_name text, owned_by text, description text,
  do_not_write_directly boolean, write_via text, UNIQUE(table_name, column_name));
-- The live trigger after 20261019170000.
CREATE FUNCTION public.calculate_work_order_estimate() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.estimated_labor_cost IS NOT NULL OR NEW.estimated_parts_cost IS NOT NULL THEN
    NEW.estimated_total := COALESCE(NEW.estimated_labor_cost, 0) + COALESCE(NEW.estimated_parts_cost, 0);
  END IF;
  IF NEW.actual_labor_cost IS NOT NULL OR NEW.actual_parts_cost IS NOT NULL THEN
    NEW.actual_total := COALESCE(NEW.actual_labor_cost, 0) + COALESCE(NEW.actual_parts_cost, 0);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_calculate_work_order_estimate BEFORE INSERT OR UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.calculate_work_order_estimate();
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;

INSERT INTO work_orders(id, title, status, estimated_labor_cost, estimated_parts_cost, estimated_total, estimated_cost_cents, actual_labor_cost, actual_parts_cost, actual_total) VALUES
 ('00000000-0000-0000-0000-0000000000e1', 'invented zeros', 'pending', NULL, NULL, 0, NULL, NULL, NULL, 0),
 ('00000000-0000-0000-0000-0000000000e2', 'stated zero labor', 'pending', 0, NULL, 0, NULL, 0, NULL, 0),
 ('00000000-0000-0000-0000-0000000000e3', 'priced labor row', 'in_progress', NULL, NULL, 0, NULL, NULL, NULL, 0),
 ('00000000-0000-0000-0000-0000000000e4', 'quoted', 'quoted', NULL, NULL, 0, NULL, NULL, NULL, 0),
 ('00000000-0000-0000-0000-0000000000e5', 'real amount', 'completed', NULL, NULL, 150, NULL, NULL, NULL, 140),
 ('00000000-0000-0000-0000-0000000000e6', 'cents estimate', 'pending', NULL, NULL, 0, 5000, NULL, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000e7', 'payment row', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, 0),
 ('00000000-0000-0000-0000-0000000000e8', 'paid status', 'paid', NULL, NULL, 0, NULL, NULL, NULL, 0),
 ('00000000-0000-0000-0000-0000000000e9', 'priced part row', 'pending', NULL, NULL, 0, NULL, NULL, NULL, 0);
INSERT INTO work_order_labor(work_order_id, hours, hourly_rate, total_cost) VALUES ('00000000-0000-0000-0000-0000000000e3', 2, 150, 300);
INSERT INTO work_order_parts(work_order_id, part_name, unit_price, total_price) VALUES ('00000000-0000-0000-0000-0000000000e9', 'Gasket', 12, 12);
INSERT INTO work_order_quotes(work_order_id) VALUES ('00000000-0000-0000-0000-0000000000e4');
INSERT INTO work_order_payments(work_order_id, status) VALUES ('00000000-0000-0000-0000-0000000000e7', 'completed');
SELECT jsonb_object_agg(id, jsonb_build_array(estimated_total, actual_total)) AS before FROM work_orders \gset

\ir ../migrations/20261020000500_work_order_invented_zero_totals.sql

SELECT t_assert((SELECT estimated_total IS NULL AND actual_total IS NULL FROM work_orders WHERE id = '00000000-0000-0000-0000-0000000000e1'),
 'a work order with no priced basis: both invented zeros become unknown');
SELECT t_assert((SELECT jsonb_object_agg(id, jsonb_build_array(estimated_total, actual_total)) FROM work_orders WHERE id <> '00000000-0000-0000-0000-0000000000e1')
   = ((:'before'::jsonb) - '00000000-0000-0000-0000-0000000000e1') || jsonb_build_object('00000000-0000-0000-0000-0000000000e4', jsonb_build_array(0, NULL)),
 'stated components, priced labor or part rows, cents estimates, payment rows, paid status and real amounts untouched; a quoted job keeps its estimate and loses only the invented actual');
SELECT t_assert((SELECT jsonb_agg(jsonb_build_array(work_order_id, column_name, old_value, new_value, reason, migration_version) ORDER BY work_order_id, column_name) FROM work_order_scalar_corrections)
   = '[["00000000-0000-0000-0000-0000000000e1","actual_total",0,null,"invented_zero_no_priced_basis","20261020000500"],
       ["00000000-0000-0000-0000-0000000000e1","estimated_total",0,null,"invented_zero_no_priced_basis","20261020000500"],
       ["00000000-0000-0000-0000-0000000000e4","actual_total",0,null,"invented_zero_no_priced_basis","20261020000500"]]'::jsonb,
 'exactly one audit row per changed value');
SELECT count(*) AS n_audit FROM work_order_scalar_corrections \gset
UPDATE work_orders SET title = 'touched later' WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT t_assert((SELECT estimated_total IS NULL AND actual_total IS NULL FROM work_orders WHERE id = '00000000-0000-0000-0000-0000000000e1'),
 'a later update without components keeps them unknown (the trigger invents nothing)');

\ir ../migrations/20261020000500_work_order_invented_zero_totals.sql
SELECT t_assert((SELECT count(*) FROM work_order_scalar_corrections) = (:'n_audit')::bigint,'rerun changes nothing and writes no audit rows');
SELECT t_assert(t_refused($q$DELETE FROM work_order_scalar_corrections$q$) AND t_refused($q$UPDATE work_order_scalar_corrections SET new_value = 0$q$)
 AND NOT has_table_privilege('anon','public.work_order_scalar_corrections','SELECT') AND NOT has_table_privilege('authenticated','public.work_order_scalar_corrections','SELECT'),
 'audit is append-only and service-only');
