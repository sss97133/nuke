-- Vehicle insider access comes from the owner, a verified claim or staff of the owning business, never a self-grant.
--
-- vehicle_user_has_access(vehicle, user) is the insider check behind vehicle_row_read (owner_name, owner_contact,
-- purchase price, date and place), vehicles_private_select (private vehicles), work_orders_select_scoped, the owner books,
-- investment proofs, price signals, daily work receipts and 20 more readers. Live on 2026-10-19 it accepted two rows any
-- signed-in account can write for itself:
--   1. vehicle_user_permissions: vup_insert_own and "Vehicle owners can manage permissions" (USING ... OR auth.uid() =
--      user_id) let an account add its own contributor or co_owner row; enforce_user_vehicle_evidence asks only for one
--      photo of the vehicle by that account, and "Authenticated users can upload images to any vehicle" admits one.
--      Today a direct photo insert fails on vehicle_completion_recompute_queue's policy; nothing else stops the chain.
--      granted_by must be set (chk_granted_by_not_null) but is whatever the writer sends, the owner's id included.
--   2. organization_vehicles: an active owner, manager or board member of any organization (the founder of a new one
--      takes that seat) may link any vehicle to it in any relationship, and the check admitted every active member
--      (contributor and photographer included) of every organization linked to the vehicle, in any relationship
--      (auction_platform, service_provider, sold_by: 700,000 automatic links).
-- vehicle_contributors is unchanged: an account that is not the vehicle's owner can only file a pending row there.
--
-- After:
--   * vehicle_user_permissions counts only when the vehicle's owner (user_id, owner_id or uploaded_by) granted it to
--     someone else. A trigger stamps granted_by (and granted_at) with the writing account on every API write that
--     creates or changes a grant, so a self-written row records itself as its grantor.
--   * organization_vehicles counts only for active owner, co_founder, board_member, manager or employee members, on an
--     active owner or consigner link written by the system or by the vehicle's owner. A trigger stamps
--     linked_by_user_id with the writing account on every API write that creates or changes a link's vehicle,
--     organization, relationship or status.
--   * The vehicle's own accounts and active admin_users count directly (callers already admit the former; the admins are
--     the two accounts whose access came only through the paths above).
--   * Approved ownership_verifications and active vehicle_contributors count as before.
-- Population (read 2026-10-19): 65 active permission rows (all granted_by null), 442 organization pairs, 128
-- contributor pairs; every pair that loses access belongs to an active admin, who keeps it.
-- Contract: supabase/sql/test_vehicle_access_requires_provenance.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
DECLARE v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_hash
  FROM pg_proc WHERE oid = to_regprocedure('public.vehicle_user_has_access(uuid,uuid)');
  IF v_hash IS DISTINCT FROM 'wKtebkwWlkgg+H0gXZxGVZAQFlilu5O2FTZeaGazL7Y=' AND v_hash IS DISTINCT FROM 'kAl3Z/lUqX+Vjwpuv8vaoTQsEAK57PqOpTY4sIlA7zA=' THEN
    RAISE EXCEPTION 'vehicle_user_has_access differs from the 2026-10-19 read (%); not changing it', v_hash;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
$function$;

-- Who wrote a grant or a link, as the record of who granted it. Writes without an API role (service role, migrations,
-- definer jobs run by the system) keep what they set.
CREATE OR REPLACE FUNCTION public.stamp_vehicle_permission_grantor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.granted_by := auth.uid(); NEW.granted_at := now();
  ELSIF (NEW.vehicle_id, NEW.user_id, NEW.role, NEW.granted_by) IS DISTINCT FROM (OLD.vehicle_id, OLD.user_id, OLD.role, OLD.granted_by)
     OR (coalesce(NEW.is_active, true) AND NOT coalesce(OLD.is_active, true)) THEN
    NEW.granted_by := auth.uid(); NEW.granted_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_vehicle_permission_grantor ON public.vehicle_user_permissions;
CREATE TRIGGER trg_stamp_vehicle_permission_grantor BEFORE INSERT OR UPDATE ON public.vehicle_user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_vehicle_permission_grantor();

CREATE OR REPLACE FUNCTION public.stamp_organization_vehicle_linker() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.linked_by_user_id := auth.uid();
  ELSIF (NEW.vehicle_id, NEW.organization_id, NEW.relationship_type, NEW.status, NEW.linked_by_user_id)
        IS DISTINCT FROM (OLD.vehicle_id, OLD.organization_id, OLD.relationship_type, OLD.status, OLD.linked_by_user_id) THEN
    NEW.linked_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_organization_vehicle_linker ON public.organization_vehicles;
CREATE TRIGGER trg_stamp_organization_vehicle_linker BEFORE INSERT OR UPDATE ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_organization_vehicle_linker();
REVOKE ALL ON FUNCTION public.stamp_vehicle_permission_grantor(), public.stamp_organization_vehicle_linker() FROM PUBLIC, anon, authenticated;

COMMIT;
