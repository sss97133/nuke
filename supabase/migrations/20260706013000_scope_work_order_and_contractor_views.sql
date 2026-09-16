-- ============================================================================
-- Close a live PII/financial-data leak found by independent audit (2026-07-05
-- night, same audit pass that produced 20260706000000_lock_down_vehicles_qb_
-- receipts_rls.sql on fable5/vehicles-rls-fix): two views —
-- work_order_receipt_unified and contractor_profile_stats — were readable by
-- ANY authenticated user for ANY vehicle_id / contractor_user_id, not just
-- the actual owner/verified-owner/contributor/contractor. Proven live by
-- minting a synthetic authenticated JWT for a nonexistent user and pulling
-- real customer PII (name/email/phone) and a real contractor's revenue.
--
-- Root cause (both views): neither view had `security_invoker = true`, so
-- each ran with the DEFINER's (view owner's) privileges and completely
-- bypassed Postgres RLS on every base table it selected from — even where
-- the base table's own RLS was written correctly. The ownership gate that
-- actually exists (isRowOwner || isVerifiedOwner || hasContributorAccess)
-- lives ONLY in nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
-- (a client-side render gate for InvestmentLedger/VehicleLedgerDocumentsCard)
-- — it was never enforced by the database, so anyone with a valid session
-- could call the REST endpoint directly and skip the gate entirely.
--
-- Confirmed via grep: work_order_receipt_unified backs InvestmentLedger /
-- useInvestmentLedger.ts and useBuildStatus.ts, both queried
-- `.eq('vehicle_id', vehicleId)` — and per WorkspaceContent.tsx line 218,
-- InvestmentLedger only ever renders for
-- `isRowOwner || isVerifiedOwner || hasContributorAccess`. There is NO
-- legitimate public/anon consumer of this view — confirmed zero other
-- call sites. contractor_profile_stats has zero frontend consumers at all
-- today (grep clean) but its own comment ("Only visible to the contractor")
-- states the intended access model, which was never real.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PART 1 — work_order_receipt_unified
--
-- Base tables (from pg_get_viewdef): work_orders, work_order_parts,
-- work_order_labor, work_order_payments. ALL FOUR had a `USING (true)`
-- "Public can view ..." / "Public read ..." PERMISSIVE SELECT policy —
-- meaning even direct REST queries against the base tables themselves (not
-- just the view) were wide open to any authenticated caller. This is the
-- same defeated-by-OR-of-PERMISSIVE-policies pattern the sibling migration
-- fixed on vehicles/qb_transactions/receipts.
--
-- The real ownership model (mirroring nuke_frontend's isRowOwner /
-- isVerifiedOwner / hasContributorAccess, sourced from
-- OwnershipService.getOwnershipStatus + useVehiclePermissions):
--   - vehicles.user_id / owner_id / uploaded_by = auth.uid()   (uploader/creator)
--   - vehicle_user_has_access(vehicle_id, auth.uid())          (the exact
--     SECURITY DEFINER function vehicles_private_select already uses —
--     covers vehicle_user_permissions roles, vehicle_contributors, and
--     organization_vehicles + organization_contributors, and approved
--     ownership_verifications — i.e. every path the frontend treats as
--     "has access")
--   - work_orders.customer_id = auth.uid()                    (the customer
--     who requested the work order — they should see their own invoice)
--   - work_orders.organization_id owned by auth.uid() via business_ownership
--     (already granted broader ALL access via "Org owners can manage work
--     orders" — included here too for SELECT-policy self-containedness)
--   - admin_users.is_active                                    (parity with
--     the Admin full access policies already on the 3 child tables)
-- ----------------------------------------------------------------------------

-- Reusable accessor for the 3 child tables (they only carry work_order_id,
-- not vehicle_id) — one definition, used by all three policies below.
CREATE OR REPLACE FUNCTION public.work_order_is_accessible(p_work_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM work_orders wo
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    WHERE wo.id = p_work_order_id
      AND auth.uid() IS NOT NULL
      AND (
        wo.customer_id = auth.uid()
        OR wo.organization_id IN (
          SELECT business_ownership.business_id FROM business_ownership
          WHERE business_ownership.owner_id = auth.uid()
            AND business_ownership.status = 'active'
        )
        OR (
          v.id IS NOT NULL AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR v.uploaded_by = auth.uid()
            OR vehicle_user_has_access(v.id, auth.uid())
          )
        )
        OR EXISTS (
          SELECT 1 FROM admin_users au
          WHERE au.user_id = auth.uid() AND au.is_active
        )
      )
  );
$$;

COMMENT ON FUNCTION public.work_order_is_accessible(uuid) IS
  'True iff auth.uid() is the work order customer, an org owner of it (business_ownership), has vehicle-level access to its vehicle (same model as vehicles_private_select: uploader/owner + vehicle_user_has_access), or is an active admin. Backs RLS on work_orders + its 3 child tables (parts/labor/payments) and the security_invoker work_order_receipt_unified view.';

-- work_orders itself: has vehicle_id directly, no need for the helper.
DROP POLICY IF EXISTS "Public can view work orders" ON work_orders;

CREATE POLICY "work_orders_select_scoped" ON work_orders
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      customer_id = auth.uid()
      OR organization_id IN (
        SELECT business_ownership.business_id FROM business_ownership
        WHERE business_ownership.owner_id = auth.uid()
          AND business_ownership.status = 'active'
      )
      OR EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = work_orders.vehicle_id
          AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR v.uploaded_by = auth.uid()
            OR vehicle_user_has_access(v.id, auth.uid())
          )
      )
      OR EXISTS (
        SELECT 1 FROM admin_users au
        WHERE au.user_id = auth.uid() AND au.is_active
      )
    )
  );

-- The 3 child tables: only carry work_order_id, route through the helper.
DROP POLICY IF EXISTS "Public can view work order parts" ON work_order_parts;
CREATE POLICY "work_order_parts_select_scoped" ON work_order_parts
  FOR SELECT
  USING (work_order_is_accessible(work_order_id));

DROP POLICY IF EXISTS "Public can view work order labor" ON work_order_labor;
CREATE POLICY "work_order_labor_select_scoped" ON work_order_labor
  FOR SELECT
  USING (work_order_is_accessible(work_order_id));

DROP POLICY IF EXISTS "Public read work_order_payments" ON work_order_payments;
CREATE POLICY "work_order_payments_select_scoped" ON work_order_payments
  FOR SELECT
  USING (work_order_is_accessible(work_order_id));

-- Now make the view itself respect all of the above instead of running as
-- its (privileged) owner. security_invoker=true is the whole fix for the
-- view layer — the SELECT list/joins are unchanged.
ALTER VIEW work_order_receipt_unified SET (security_invoker = true);

COMMENT ON VIEW work_order_receipt_unified IS
  'Per-work-order financial rollup (parts/labor/payments) for one vehicle. security_invoker=true (2026-07-06): runs as the calling role so RLS on work_orders/work_order_parts/work_order_labor/work_order_payments is enforced — visible only to the vehicle owner/verified-owner/contributor, the work order customer, the org owner, or an admin. Matches nuke_frontend gating in WorkspaceContent.tsx (InvestmentLedger renders only for isRowOwner || isVerifiedOwner || hasContributorAccess) — that gate is now real at the database layer, not just in the React tree.';


-- ----------------------------------------------------------------------------
-- PART 2 — contractor_profile_stats
--
-- Base table: contractor_work_contributions. Its RLS was already correct
-- (contractor_view_own, org_view_contributions, public_view_contributions =
-- is_public = true) — the view comment even says "Only visible to the
-- contractor" for total_revenue_all — but the view had no security_invoker,
-- so it ran as owner and bypassed all of that RLS, and worse: total_revenue_
-- all and average_hourly_rate summed EVERY is_public=true row's real dollar
-- figures regardless of show_financial_details, so even a contractor who
-- explicitly opted OUT of showing $ on a public job still had that job's
-- exact revenue/rate exposed to any authenticated stranger querying by
-- contractor_user_id.
--
-- Fix: security_invoker=true (so is_public=false rows are never visible to
-- anyone but the contractor/org — defense in depth even though the view's
-- own WHERE already filters to is_public=true), AND make the financial
-- aggregates respect show_financial_details unless the caller IS the
-- contractor (auth.uid() = contractor_user_id) — which is what the existing
-- column comment actually promised. total_jobs/hours/shops/vehicles/
-- specializations/dates stay as public professional-profile signal (that's
-- the view's stated purpose and none of it is money).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW contractor_profile_stats
WITH (security_invoker = true) AS
SELECT
  contractor_user_id,
  count(*) AS total_jobs,
  count(DISTINCT organization_id) AS shops_worked_for,
  count(DISTINCT vehicle_id) AS vehicles_worked_on,
  sum(labor_hours) AS total_labor_hours,
  sum(
    CASE
      WHEN show_financial_details THEN total_value
      ELSE 0::numeric
    END
  ) AS public_revenue,
  sum(
    CASE
      WHEN show_financial_details OR contractor_user_id = auth.uid() THEN total_value
      ELSE 0::numeric
    END
  ) AS total_revenue_all,
  avg(
    CASE
      WHEN show_financial_details OR contractor_user_id = auth.uid() THEN hourly_rate
      ELSE NULL
    END
  ) AS average_hourly_rate,
  array_agg(DISTINCT work_category) FILTER (WHERE work_category IS NOT NULL) AS specializations,
  min(work_date) AS first_job_date,
  max(work_date) AS most_recent_job_date
FROM contractor_work_contributions
WHERE is_public = true
GROUP BY contractor_user_id;

COMMENT ON VIEW contractor_profile_stats IS
  'Aggregated contractor statistics for professional profiles. security_invoker=true (2026-07-06): runs as the calling role, so contractor_work_contributions RLS applies (a stranger can only ever see is_public=true rows via public_view_contributions; the contractor sees their own via contractor_view_own; their org sees theirs via org_view_contributions). total_revenue_all and average_hourly_rate additionally mask any row where show_financial_details=false UNLESS the caller is that contractor (auth.uid() = contractor_user_id) — making the pre-existing "Only visible to the contractor" column comment actually true instead of decorative.';
