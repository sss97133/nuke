-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Hole 4 (MODEL.md section 9, SPEC H6): work_order_assignments has RLS enabled and NO policy at all (no row in the 2026-11-12 policy
-- snapshot), so every client read is denied: an assigned technician cannot read their own assignment and a client cannot see who is
-- working on their order. 9 rows live (exact, 2026-11-12). No web, iOS or edge-function source reads the table by name today
-- (grep, VISIBILITY.md section 4), so adding reads breaks nobody; the trigger work_order_assignment_guard keeps guarding writes.
--
-- After:
--   * work_order_assignments SELECT (authenticated): the row's own technician (technicians.user_id, accepted_by_user_id or
--     cosigner_user_id = you), the active owner of the work order's organization, and the owner (rank 100) of a garage that operates
--     or hosts that organization. The row carries payout terms (payout_rate, payout_percentage, estimated/actual payout, hashes), so the
--     client and managers do NOT read the table.
--   * work_order_assignment_parties (view): who is assigned to a work order, with status and clocks and NO money, for the order's
--     parties (work_order_is_accessible: customer, org owner, vehicle owner, admin). It runs as its owner (it needs the base table)
--     and gates every row on that function, grants SELECT only (no write grant), so view_write_guard has nothing to object to.
-- Money rule (SPEC section 9.2): owner-only by default; a manager's operational view is open question Q5.
--
-- Rollback at the bottom.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.work_assignment_money_reader(p_work_order uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = p_work_order AND wo.organization_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.business_ownership bo
              WHERE bo.business_id = wo.organization_id AND bo.owner_id = p_user AND bo.status = 'active')
      OR EXISTS (SELECT 1 FROM public.garage_organizations go
                 WHERE go.organization_id = wo.organization_id AND go.valid_to IS NULL
                   AND public.garage_member_rank(go.garage_id, p_user) >= 100)
    )
  )
$$;
REVOKE EXECUTE ON FUNCTION public.work_assignment_money_reader(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_assignment_money_reader(uuid, uuid) TO authenticated, service_role;

GRANT SELECT ON public.work_order_assignments TO authenticated;

CREATE POLICY work_order_assignments_select ON public.work_order_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    accepted_by_user_id = (SELECT auth.uid())
    OR cosigner_user_id = (SELECT auth.uid())
    OR technician_id IN (SELECT t.id FROM public.technicians t WHERE t.user_id = (SELECT auth.uid()))
    OR public.work_assignment_money_reader(work_order_id, (SELECT auth.uid()))
  );

CREATE OR REPLACE VIEW public.work_order_assignment_parties AS
  SELECT a.id AS assignment_id, a.work_order_id, a.technician_id, a.role, a.status, a.job_op_code,
         a.offered_at, a.accepted_at, a.declined_at, a.started_at, a.completed_at
  FROM public.work_order_assignments a
  WHERE public.work_order_is_accessible(a.work_order_id);
REVOKE ALL ON public.work_order_assignment_parties FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_order_assignment_parties TO authenticated;
COMMENT ON VIEW public.work_order_assignment_parties IS
  'Who is assigned to a work order the viewer may see, with status and clocks and no payout columns. Owner-run by design; gated per row by work_order_is_accessible().';

-- Rollback:
--   DROP VIEW public.work_order_assignment_parties;
--   DROP POLICY work_order_assignments_select ON public.work_order_assignments;
--   DROP FUNCTION public.work_assignment_money_reader(uuid, uuid);
--   (REVOKE SELECT ON public.work_order_assignments FROM authenticated only if it was not granted before this migration)
