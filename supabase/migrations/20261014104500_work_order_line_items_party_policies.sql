-- work_order_line_items: a work order's parties read and update its line items; nobody else reads or writes them.
--
-- Live on 2026-10-14: "Anyone can view work_order_line_items" (SELECT, PUBLIC, USING true) and "Service role manages
-- work_order_line_items" (ALL, PUBLIC: no TO clause, USING true, WITH CHECK true), with INSERT, UPDATE, DELETE and
-- TRUNCATE granted to anon and authenticated. With the publishable key and no sign-in, a caller read every line
-- item's labor rate, parts and total cost and could update or delete any row: a PATCH as anon on a filter matching
-- no row returned 200. Population: 18 rows on 2 work orders.
--
-- After:
--   * SELECT and UPDATE for callers that public.work_order_is_accessible(work_order_id) admits: the work order's
--     customer, the shop's active owners, the vehicle's insiders and active admins. It is the rule
--     work_order_payments and work_order_parts are already read by. Owners toggle a line item's status from the
--     vehicle page (WorkOrderProgress), so UPDATE stays open to them.
--   * The service role keeps its policy, now TO service_role.
--   * anon keeps SELECT only (the rule admits no anon caller); INSERT, DELETE and TRUNCATE are revoked from anon and
--     authenticated, UPDATE from anon. Nothing in the web app inserts or deletes line items.
-- Contract: supabase/sql/test_work_order_line_items_party_policies.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_live int;
  v_done int;
  v_all int;
BEGIN
  IF to_regprocedure('public.work_order_is_accessible(uuid)') IS NULL THEN
    RAISE EXCEPTION 'work_order_line_items policies: public.work_order_is_accessible(uuid) is missing';
  END IF;
  SELECT count(*) INTO v_all FROM pg_policy WHERE polrelid = 'public.work_order_line_items'::regclass;
  -- the two live policies, exactly as read on 2026-10-14
  SELECT count(*) INTO v_live FROM pg_policy p
  WHERE p.polrelid = 'public.work_order_line_items'::regclass
    AND p.polroles = '{0}'::oid[]
    AND pg_get_expr(p.polqual, p.polrelid) = 'true'
    AND ((p.polname = 'Anyone can view work_order_line_items' AND p.polcmd = 'r' AND p.polwithcheck IS NULL)
      OR (p.polname = 'Service role manages work_order_line_items' AND p.polcmd = '*'
          AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true'));
  -- this migration's three policies (a re-run)
  SELECT count(*) INTO v_done FROM pg_policy p
  WHERE p.polrelid = 'public.work_order_line_items'::regclass
    AND ((p.polname = 'work_order_line_items_select_scoped' AND p.polcmd = 'r')
      OR (p.polname = 'work_order_line_items_update_parties' AND p.polcmd = 'w')
      OR (p.polname = 'Service role manages work_order_line_items' AND p.polcmd = '*'
          AND p.polroles = ARRAY['service_role'::regrole::oid]));
  IF NOT ((v_all = 2 AND v_live = 2) OR (v_all = 3 AND v_done = 3)) THEN
    RAISE EXCEPTION 'work_order_line_items policies drifted from the 2026-10-14 read (% policies, % live, % new); not changing them',
      v_all, v_live, v_done;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view work_order_line_items" ON public.work_order_line_items;
DROP POLICY IF EXISTS "Service role manages work_order_line_items" ON public.work_order_line_items;
DROP POLICY IF EXISTS work_order_line_items_select_scoped ON public.work_order_line_items;
DROP POLICY IF EXISTS work_order_line_items_update_parties ON public.work_order_line_items;

CREATE POLICY work_order_line_items_select_scoped ON public.work_order_line_items
  FOR SELECT USING (public.work_order_is_accessible(work_order_id));
CREATE POLICY work_order_line_items_update_parties ON public.work_order_line_items
  FOR UPDATE TO authenticated
  USING (public.work_order_is_accessible(work_order_id))
  WITH CHECK (public.work_order_is_accessible(work_order_id));
CREATE POLICY "Service role manages work_order_line_items" ON public.work_order_line_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.work_order_line_items FROM anon;
REVOKE INSERT, DELETE, TRUNCATE ON public.work_order_line_items FROM authenticated;

COMMIT;
