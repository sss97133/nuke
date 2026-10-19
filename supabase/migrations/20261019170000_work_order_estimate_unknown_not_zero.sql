-- calculate_work_order_estimate (BEFORE INSERT OR UPDATE on work_orders) set estimated_total and actual_total to
-- COALESCE(labor, 0) + COALESCE(parts, 0), so every work order without any priced basis carried a $0 estimate and a
-- $0 actual nobody gave (live 2026-10-19: 13 of 26 estimated_total = 0 with no labor or parts estimate; 12 of 26
-- actual_total = 0 with no actual labor or parts). The job path then read terms as 'partial' from that invented 0.
-- After: a total is computed only from at least one stated component; with neither component it keeps the value
-- the writer gave (NULL when none), so unknown stays unknown and a directly stated total is no longer overwritten.
-- Existing rows are not rewritten: an update that leaves both components NULL keeps the stored total, including the
-- historical zeros (no sanctioned correction path exists for these scalars; reported for the owner).
-- Contract: supabase/sql/test_work_order_estimate_unknown_not_zero.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.calculate_work_order_estimate()'::regprocedure))
      IS DISTINCT FROM md5(E'\nBEGIN\n  NEW.estimated_total := COALESCE(NEW.estimated_labor_cost, 0) + COALESCE(NEW.estimated_parts_cost, 0);\n  NEW.actual_total := COALESCE(NEW.actual_labor_cost, 0) + COALESCE(NEW.actual_parts_cost, 0);\n  NEW.updated_at := NOW();\n  RETURN NEW;\nEND;\n') THEN
    RAISE EXCEPTION 'calculate_work_order_estimate differs from the reviewed definition';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.calculate_work_order_estimate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
COMMENT ON FUNCTION public.calculate_work_order_estimate() IS 'work_orders trigger: estimated_total / actual_total = labor + parts when at least one component is stated; otherwise the stated total (NULL = unknown) is kept. Never invents a 0.';
COMMIT;
