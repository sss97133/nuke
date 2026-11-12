-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Hole 5 (MODEL.md section 9, SPEC H5): work_sessions SELECT policies ("Users can view their own work sessions",
-- "Users can view work sessions for vehicles they have access to", select_work_sessions_by_org_or_self) recognize the session's
-- own user, vehicles.owner_id / user_id and vehicle_user_permissions. None recognizes an organization or a garage, so the owner of
-- the place cannot read a technician's session on a customer car sitting in his shop. 1,925 rows live (exact, 2026-11-12);
-- place_id is not null on 0 of them and technician_id on 1, so a place_id-based rule would match nothing today: the rule uses stays.
--
-- After: one added SELECT policy, work_sessions_garage_owner_read (authenticated): the owner (rank 100, active) of a garage that
-- has a stay for the session's vehicle (any relationship, any age) reads it. The existing three policies are untouched and OR with it.
-- Why owner only and not manager: the row carries labor_rate_per_hour, quoted_price, final_invoice, profit_margin and the total_*
-- cost columns, and an RLS policy cannot hide columns. SPEC section 9.2 keeps money owner-only; managers read the same sessions
-- through garage_inbound_feed (PRESENCE lane), which projects no money. If Skylar decides managers see money (Q5) change the 100 to 80.
--
-- Caution kept for PRESENCE: work_sessions INSERT has no vehicle standing check (WITH CHECK is user_id = auth.uid() only), so a
-- signed-in user can write a session on ANY vehicle (extra hole H9, VISIBILITY.md section 3; not fixed here). A session is therefore
-- a claim, not proof, that a car was in a garage: do not let one alone start a stay.
-- Callers: nuke_frontend / iOS reads of work_sessions as the shop owner now return more rows (VISIBILITY.md section 4).
--
-- Rollback at the bottom.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.garage_owner_of_vehicle(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND p_vehicle IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.garage_vehicle_stays s
    JOIN public.garage_members m ON m.garage_id = s.garage_id AND m.user_id = p_user AND m.status = 'active' AND m.role = 'owner'
    WHERE s.vehicle_id = p_vehicle)
$$;
REVOKE EXECUTE ON FUNCTION public.garage_owner_of_vehicle(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garage_owner_of_vehicle(uuid, uuid) TO authenticated, service_role;

CREATE POLICY work_sessions_garage_owner_read ON public.work_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.garage_owner_of_vehicle(vehicle_id, (SELECT auth.uid())));

-- Rollback:
--   DROP POLICY work_sessions_garage_owner_read ON public.work_sessions;
--   DROP FUNCTION public.garage_owner_of_vehicle(uuid, uuid);
