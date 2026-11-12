-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Garage model, VISIBILITY lane, migration 300: the two visibility helpers every later policy and reader uses.
--   garage_member_rank(garage, user)         same signature and meaning as the core draft (0 unless an active member);
--                                            re-created here with its index so this file is the one place that owns it.
--   garage_vehicle_visibility(vehicle, user) 'full' | 'summary' | 'none', the answer to "may this person see this car
--                                            (its media, work, evidence) through a garage". garage_now fills my_visibility
--                                            from it.
--   can_see_vehicle_via_garage(vehicle, user) true exactly when the visibility is 'full' (replaces the core's fail-closed stub).
-- The matrix is docs/garage-model/VISIBILITY.md section 2 (SPEC.md section 9.2). Requires migration 20261112100000.
--
-- Rules implemented (rank = garage_role_rank of the viewer's ACTIVE membership; "stay" = garage_vehicle_stays row):
--   rank >= 80 (manager, owner)  full on any car that has a stay in the garage (any relationship, any age).
--   rank >= 40 (staff, technician) full on a car that is "here" (open stay, last seen within 365 days, no newer 'left' or
--                                'not_here' assertion) when its relationship is owned, customer_work, storage or
--                                passing_through. Never dealer_inventory, consignment or unknown by rank alone.
--   rank >= 30 (photographer ..) full on ANY relationship with a GRANT: an active, unexpired, unrevoked vehicle_user_permissions
--                                row that someone else gave them (granted_by is not null and is not the user: a
--                                self-granted row does not count), or, for rank >= 50, an assignment (a work_order_assignments
--                                row, not declined, on a work order for that car, reaching them through technicians.user_id or
--                                accepted_by_user_id). A grant or an assignment still needs a stay in a garage they belong to.
--   rank >= 20 (customer)        full on their OWN car (vehicles.user_id or owner_id, or an active vehicle_user_permissions
--                                owner / co_owner row) that has a stay in the garage, unless the stay is dealer_inventory.
--   rank >= 40, otherwise        'summary': the car is in the place, no media, no money.
--   everyone else                'none' (viewers rank 10 see counts through garage_now, never a car).
-- Originators always see their own contributions: that arm lives in each reader/policy (it is about the row's author, not
-- the car), not here.
--
-- Cost. The function is called once per car by garage_now (tens of cars) and once per attempted vehicle_images INSERT as the
-- LAST arm of the insert predicate. It must never be an arm of a vehicle_images SELECT policy (64M rows). It reads only
-- indexed keys: garage_members (user_id, garage_id) partial index below; garage_vehicle_stays_vehicle_idx (core);
-- garage_stay_assertions_current_idx (core); vehicle_user_permissions (vehicle_id, user_id); work_orders (vehicle_id);
-- work_order_assignments (technician_id); technicians (user_id). The last four are tiny tables live (116 / 26 / 9 / 3 rows,
-- exact reads 2026-11-12, plus the catalog estimate for technicians), so IF NOT EXISTS indexes are free.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS garage_members_active_user_idx
  ON public.garage_members (user_id, garage_id) INCLUDE (role)
  WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicle_user_permissions_vehicle_user_idx ON public.vehicle_user_permissions (vehicle_id, user_id);
CREATE INDEX IF NOT EXISTS work_orders_vehicle_idx ON public.work_orders (vehicle_id);
CREATE INDEX IF NOT EXISTS work_order_assignments_technician_idx ON public.work_order_assignments (technician_id);
CREATE INDEX IF NOT EXISTS technicians_user_idx ON public.technicians (user_id);

-- Rank of a user in a garage: 0 unless an active member. SECURITY DEFINER so policies on garage_members can call it
-- without recursing into their own RLS.
CREATE OR REPLACE FUNCTION public.garage_member_rank(p_garage uuid, p_user uuid DEFAULT auth.uid())
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(max(public.garage_role_rank(m.role)), 0)
  FROM public.garage_members m
  WHERE m.garage_id = p_garage AND m.user_id = p_user AND m.status = 'active'
    AND p_user IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.garage_vehicle_visibility(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_best int;
  v_assigned boolean;
  v_granted boolean;
  v_own boolean;
BEGIN
  IF p_user IS NULL OR p_vehicle IS NULL THEN RETURN 'none'; END IF;

  -- The viewer's best rank in any garage that holds this car (stays of any age). 0 when there is none.
  SELECT coalesce(max(public.garage_role_rank(m.role)), 0) INTO v_best
  FROM public.garage_vehicle_stays s
  JOIN public.garage_members m ON m.garage_id = s.garage_id AND m.user_id = p_user AND m.status = 'active'
  WHERE s.vehicle_id = p_vehicle;
  IF v_best = 0 THEN RETURN 'none'; END IF;

  -- Managers and the owner: the whole place.
  IF v_best >= 80 THEN RETURN 'full'; END IF;

  -- Staff and technicians: cars that are here, by relationship.
  IF v_best >= 40 AND EXISTS (
    SELECT 1
    FROM public.garage_vehicle_stays s
    JOIN public.garage_members m ON m.garage_id = s.garage_id AND m.user_id = p_user AND m.status = 'active'
    WHERE s.vehicle_id = p_vehicle
      AND public.garage_role_rank(m.role) >= 40
      AND s.departed_at IS NULL
      AND s.last_seen_at > now() - interval '365 days'
      AND s.relationship IN ('owned', 'customer_work', 'storage', 'passing_through')
      AND NOT EXISTS (
        SELECT 1 FROM public.garage_stay_assertions a
        WHERE a.garage_id = s.garage_id AND a.vehicle_id = s.vehicle_id AND a.superseded_by IS NULL
          AND a.kind IN ('left', 'not_here') AND a.asserted_at >= s.last_seen_at)
  ) THEN RETURN 'full'; END IF;

  -- A grant someone else gave, or an assignment (rank >= 30 / >= 50), on any relationship.
  IF v_best >= 30 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vehicle_user_permissions vup
      WHERE vup.vehicle_id = p_vehicle AND vup.user_id = p_user
        AND coalesce(vup.is_active, true) AND vup.revoked_at IS NULL
        AND (vup.expires_at IS NULL OR vup.expires_at > now())
        AND vup.granted_by IS NOT NULL AND vup.granted_by <> vup.user_id
        AND vup.role IN ('owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
                         'dealer_rep', 'sales_agent', 'consigned')
    ) INTO v_granted;
    IF v_granted THEN RETURN 'full'; END IF;
  END IF;
  IF v_best >= 50 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.work_order_assignments a
      JOIN public.work_orders wo ON wo.id = a.work_order_id
      LEFT JOIN public.technicians t ON t.id = a.technician_id
      WHERE wo.vehicle_id = p_vehicle AND a.declined_at IS NULL
        AND (t.user_id = p_user OR a.accepted_by_user_id = p_user)
    ) INTO v_assigned;
    IF v_assigned THEN RETURN 'full'; END IF;
  END IF;

  -- A customer's own car, unless the place holds it as dealer inventory.
  IF v_best >= 20 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle AND (v.user_id = p_user OR v.owner_id = p_user)
    ) OR EXISTS (
      SELECT 1 FROM public.vehicle_user_permissions vup
      WHERE vup.vehicle_id = p_vehicle AND vup.user_id = p_user AND vup.role IN ('owner', 'co_owner')
        AND coalesce(vup.is_active, true) AND vup.revoked_at IS NULL AND (vup.expires_at IS NULL OR vup.expires_at > now())
    ) INTO v_own;
    IF v_own AND EXISTS (
      SELECT 1 FROM public.garage_vehicle_stays s
      JOIN public.garage_members m ON m.garage_id = s.garage_id AND m.user_id = p_user AND m.status = 'active'
      WHERE s.vehicle_id = p_vehicle AND s.relationship <> 'dealer_inventory'
    ) THEN RETURN 'full'; END IF;
  END IF;

  IF v_best >= 40 THEN RETURN 'summary'; END IF;
  RETURN 'none';
END $$;
COMMENT ON FUNCTION public.garage_vehicle_visibility(uuid, uuid) IS
  'full | summary | none: may this user see this car (media, work, evidence) through a garage. docs/garage-model/VISIBILITY.md section 2.';

CREATE OR REPLACE FUNCTION public.can_see_vehicle_via_garage(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.garage_vehicle_visibility(p_vehicle, p_user) = 'full' $$;

REVOKE EXECUTE ON FUNCTION public.garage_member_rank(uuid, uuid), public.garage_vehicle_visibility(uuid, uuid),
  public.can_see_vehicle_via_garage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garage_member_rank(uuid, uuid), public.garage_vehicle_visibility(uuid, uuid),
  public.can_see_vehicle_via_garage(uuid, uuid) TO authenticated, service_role;

-- Rollback (restores the core draft's fail-closed stub; the indexes are harmless and stay):
--   DROP FUNCTION public.garage_vehicle_visibility(uuid, uuid);
--   CREATE OR REPLACE FUNCTION public.can_see_vehicle_via_garage(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
--     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT false $f$;
