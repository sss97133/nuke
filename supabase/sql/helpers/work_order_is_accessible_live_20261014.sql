-- The live definition of public.work_order_is_accessible(uuid) as read from production on 2026-10-14
-- (pg_get_functiondef text plus a semicolon). Unchanged by the migration; for the contract test only.
CREATE OR REPLACE FUNCTION public.work_order_is_accessible(p_work_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
