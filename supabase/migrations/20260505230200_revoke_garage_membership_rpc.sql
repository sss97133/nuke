-- revoke_garage_membership: per-card eject affordance for the garage UI.
--
-- The user pressing "× NOT MINE" on a vehicle card calls this RPC.
-- It supersedes (not deletes) the user's claim on the vehicle by
-- flipping is_active=false on vehicle_user_permissions and
-- discovered_vehicles. Testimony tables (vehicle_observations,
-- vehicle_images, auction_comments, etc.) are NEVER touched.
-- ownership_verifications is NEVER touched here — verifications
-- require formal revocation (separate flow).
--
-- Per agent-trust-invariants.md: "testimony is never deleted." A
-- contributor row remains, but is_active=false; can be reinstated.

CREATE OR REPLACE FUNCTION public.revoke_garage_membership(
  p_vehicle_id uuid,
  p_reason text DEFAULT 'user_eject_from_garage'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_perms_revoked int := 0;
  v_discovered_revoked int := 0;
  v_now timestamptz := now();
  v_context jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'revoke_garage_membership requires an authenticated user';
  END IF;

  v_context := jsonb_build_object(
    'eject_from_garage', true,
    'reason', p_reason,
    'revoked_at', v_now
  );

  -- Supersede vehicle_user_permissions (any role; safe because the
  -- enforce_user_vehicle_evidence trigger now allows revocations).
  WITH r AS (
    UPDATE public.vehicle_user_permissions
    SET is_active = false,
        revoked_at = v_now,
        revoked_by = v_user_id,
        context = COALESCE(context, '{}'::jsonb) || v_context
    WHERE vehicle_id = p_vehicle_id
      AND user_id = v_user_id
      AND is_active = true
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_perms_revoked FROM r;

  -- Supersede discovered_vehicles entries (passive system-discovered
  -- relationships). discovered_vehicles has no revoked_at column —
  -- the schema uses is_active as the soft-delete flag.
  WITH r AS (
    UPDATE public.discovered_vehicles
    SET is_active = false
    WHERE vehicle_id = p_vehicle_id
      AND user_id = v_user_id
      AND is_active = true
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_discovered_revoked FROM r;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'user_id', v_user_id,
    'perms_revoked', v_perms_revoked,
    'discovered_revoked', v_discovered_revoked,
    'reason', p_reason,
    'revoked_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_garage_membership(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.revoke_garage_membership(uuid, text) IS
  'Eject a vehicle from the calling user''s garage. Supersedes vehicle_user_permissions and discovered_vehicles via is_active=false. Does not touch ownership_verifications, vehicle_contributors, or testimony tables. Reversible — re-add via the normal claim flow.';
