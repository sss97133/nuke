-- receipt_item_labor_value_retired_v1: retire compute_receipt_item_labor_value(uuid) and its trigger function,
-- with the reason on the functions, without dropping them (deletion is the owner's call).
--
-- WHY. Measured live 2026-11-24:
--   * compute_receipt_item_labor_value reads public.part_to_operation_map and joins labor_operations.id: the table does
--     not exist and labor_operations has no id column (its key is code). It writes public.receipt_item_labor, which
--     does not exist. Every call fails.
--   * Its only caller, trg_receipt_item_labor_recompute(), is attached to no table (0 pg_trigger rows), no cron job
--     names either function, no other function or repository code calls them, and pg_stat_user_functions records 0
--     calls.
--   * It would invent hours if it ran: 0.5 h x quantity when no operation is found, at a default 50/h rate. Book hours
--     for receipt lines come from labor_operations through receipt_line_edges (20261124234000) and the labor reader.
-- So it is not repaired: a repair would publish invented hours. It is retired: no role but the owner of the schema can
-- execute it, and the comment says why and what replaces it.
--
-- REVERT. GRANT EXECUTE ON FUNCTION public.compute_receipt_item_labor_value(uuid) TO service_role;
-- COMMENT ON FUNCTION ... IS NULL for both.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.compute_receipt_item_labor_value(uuid)') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgfoid = 'public.trg_receipt_item_labor_recompute()'::regprocedure) THEN
      RAISE EXCEPTION 'trg_receipt_item_labor_recompute is attached to a table: not retiring';
    END IF;
    REVOKE ALL ON FUNCTION public.compute_receipt_item_labor_value(uuid) FROM PUBLIC, anon, authenticated, service_role;
    COMMENT ON FUNCTION public.compute_receipt_item_labor_value(uuid) IS
      'RETIRED 2026-11-24 (20261124234500): reads part_to_operation_map and writes receipt_item_labor (neither exists), joins labor_operations.id (no such column), and would invent 0.5 h x quantity at a default rate. Receipt-line operations are stored in receipt_line_edges; hours come from labor_operations through the labor reader. Not dropped: deletion is the owner''s call.';
  END IF;
  IF to_regprocedure('public.trg_receipt_item_labor_recompute()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trg_receipt_item_labor_recompute() FROM PUBLIC, anon, authenticated, service_role;
    COMMENT ON FUNCTION public.trg_receipt_item_labor_recompute() IS
      'RETIRED 2026-11-24 (20261124234500): attached to no table; its only call is the retired compute_receipt_item_labor_value. Not dropped: deletion is the owner''s call.';
  END IF;
END $$;
