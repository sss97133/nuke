-- Disposable PG17: 20261124234510 retires compute_receipt_item_labor_value and its unattached trigger function
-- (no role can execute them, the comment says why), refuses while the trigger function is attached, and re-runs.
-- Run from the repo root in an empty database named dm_refinement_<name>. Synthetic stubs only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION public.compute_receipt_item_labor_value(p uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION public.trg_receipt_item_labor_recompute() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
GRANT EXECUTE ON FUNCTION public.compute_receipt_item_labor_value(uuid) TO service_role;
-- Attached: refused.
CREATE TABLE public.t (id int);
CREATE TRIGGER t_trg AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION public.trg_receipt_item_labor_recompute();
\set mig `cat supabase/migrations/20261124234510_retire_receipt_item_labor_value.sql`
SELECT set_config('test.mig', :'mig', false) IS NOT NULL AS loaded;
DO $$ BEGIN
  BEGIN
    EXECUTE current_setting('test.mig');
    RAISE EXCEPTION 'FAIL: retired while attached';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
END $$;
DROP TRIGGER t_trg ON public.t;
\i supabase/migrations/20261124234510_retire_receipt_item_labor_value.sql
\i supabase/migrations/20261124234510_retire_receipt_item_labor_value.sql
DO $$ BEGIN
  IF has_function_privilege('service_role', 'public.compute_receipt_item_labor_value(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.compute_receipt_item_labor_value(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.trg_receipt_item_labor_recompute()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: a role can still execute a retired function';
  END IF;
  IF obj_description('public.compute_receipt_item_labor_value(uuid)'::regprocedure) NOT LIKE 'RETIRED 2026-11-24%'
     OR obj_description('public.trg_receipt_item_labor_recompute()'::regprocedure) NOT LIKE 'RETIRED 2026-11-24%' THEN
    RAISE EXCEPTION 'FAIL: reason comment missing';
  END IF;
END $$;
\echo 'test_retire_receipt_item_labor_value: PASS'
