-- REVERT of 20261126020000_vehicle_row_read_stub_target.sql: restores 20261125214500's vehicle_row_read body
-- (sha256 cdd2d17f...), which redirects an outsider from a merged stub even when the target is private. Apply only through
-- a migration that copies it.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
  v_redirect uuid;
BEGIN
  -- vehicle_row_read_deleted_gate_v1: public means vehicle_publicly_readable; a deleted merged car is a redirect only.
  SELECT to_jsonb(v.*),
         public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id),
         CASE WHEN v.deleted_at IS NOT NULL THEN v.merged_into_vehicle_id END,
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_redirect, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  IF v_redirect IS NOT NULL THEN
    RETURN jsonb_build_object('id', p_vehicle_id, 'merged_into_vehicle_id', v_redirect);
  END IF;
  RETURN public.vehicle_row_public_projection(v_row);
END;
$function$;

COMMIT;
