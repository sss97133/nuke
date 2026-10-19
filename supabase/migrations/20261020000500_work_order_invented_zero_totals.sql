-- Clear the invented historical $0 totals (doctrine: never invent; a $0 nobody stated is unknown). Before 20261019170000,
-- calculate_work_order_estimate wrote estimated_total / actual_total = COALESCE(labor, 0) + COALESCE(parts, 0), so a work
-- order with neither component stated carried a $0 nobody gave; 20261019170000 stopped new ones and kept the old rows.
--   Predicate (no priced basis anywhere):
--     estimated_total = 0, estimated_labor_cost and estimated_parts_cost NULL, estimated_cost_cents NULL, no priced
--       work_order_labor (total_cost or hourly_rate) or work_order_parts (total_price or unit_price) row, no quote;
--     actual_total = 0, actual_labor_cost and actual_parts_cost NULL, no priced labor or part row, no work_order_payments
--       row; and the work order is not in status paid (payment meaning is left as it is).
--   Each UPDATE re-checks the predicate on the row it changes (value still 0, still no basis) and writes one
--   work_order_scalar_corrections row per changed value in the same statement. The trigger keeps NULL when no component is
--   stated (20261019170000), so the values are not rewritten. Rerunning changes nothing.
-- Contract: supabase/sql/test_work_order_invented_zero_totals.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE IF NOT EXISTS public.work_order_scalar_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  column_name text NOT NULL CHECK (column_name IN ('estimated_total','actual_total')),
  old_value numeric,
  new_value numeric,
  reason text NOT NULL CHECK (reason IN ('invented_zero_no_priced_basis')),
  migration_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS work_order_scalar_corrections_work_order ON public.work_order_scalar_corrections(work_order_id);
COMMENT ON TABLE public.work_order_scalar_corrections IS 'Audit of corrections to work_orders scalar totals (old value, new value, reason, migration). Append-only.';
ALTER TABLE public.work_order_scalar_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_scalar_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_order_scalar_corrections TO service_role;
DROP POLICY IF EXISTS work_order_scalar_corrections_service_read ON public.work_order_scalar_corrections;
CREATE POLICY work_order_scalar_corrections_service_read ON public.work_order_scalar_corrections FOR SELECT TO service_role USING (true);
CREATE OR REPLACE FUNCTION public.work_order_scalar_corrections_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'work_order_scalar_corrections is append-only'; END $$;
REVOKE ALL ON FUNCTION public.work_order_scalar_corrections_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS work_order_scalar_corrections_append_only ON public.work_order_scalar_corrections;
CREATE TRIGGER work_order_scalar_corrections_append_only BEFORE UPDATE OR DELETE ON public.work_order_scalar_corrections
  FOR EACH ROW EXECUTE FUNCTION public.work_order_scalar_corrections_append_only();

WITH changed AS (
  UPDATE public.work_orders w SET estimated_total = NULL
  WHERE w.estimated_total = 0 AND w.estimated_labor_cost IS NULL AND w.estimated_parts_cost IS NULL AND w.estimated_cost_cents IS NULL
    AND COALESCE(w.status, '') <> 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.work_order_labor l WHERE l.work_order_id = w.id AND (COALESCE(l.total_cost, 0) <> 0 OR COALESCE(l.hourly_rate, 0) <> 0))
    AND NOT EXISTS (SELECT 1 FROM public.work_order_parts p WHERE p.work_order_id = w.id AND (COALESCE(p.total_price, 0) <> 0 OR COALESCE(p.unit_price, 0) <> 0))
    AND NOT EXISTS (SELECT 1 FROM public.work_order_quotes q WHERE q.work_order_id = w.id)
  RETURNING w.id)
INSERT INTO public.work_order_scalar_corrections(work_order_id, column_name, old_value, new_value, reason, migration_version)
SELECT id, 'estimated_total', 0, NULL, 'invented_zero_no_priced_basis', '20261020000500' FROM changed;

WITH changed AS (
  UPDATE public.work_orders w SET actual_total = NULL
  WHERE w.actual_total = 0 AND w.actual_labor_cost IS NULL AND w.actual_parts_cost IS NULL
    AND COALESCE(w.status, '') <> 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.work_order_labor l WHERE l.work_order_id = w.id AND (COALESCE(l.total_cost, 0) <> 0 OR COALESCE(l.hourly_rate, 0) <> 0))
    AND NOT EXISTS (SELECT 1 FROM public.work_order_parts p WHERE p.work_order_id = w.id AND (COALESCE(p.total_price, 0) <> 0 OR COALESCE(p.unit_price, 0) <> 0))
    AND NOT EXISTS (SELECT 1 FROM public.work_order_payments pm WHERE pm.work_order_id = w.id)
  RETURNING w.id)
INSERT INTO public.work_order_scalar_corrections(work_order_id, column_name, old_value, new_value, reason, migration_version)
SELECT id, 'actual_total', 0, NULL, 'invented_zero_no_priced_basis', '20261020000500' FROM changed;

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'work_order_scalar_corrections', 'id', '20261020000500_work_order_invented_zero_totals', 'Audit rows of reviewed scalar corrections to work_orders totals; written only by the reviewed migration that makes the change.', true, 'reviewed migration'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = 'work_order_scalar_corrections' AND r.column_name = 'id');
COMMIT;
