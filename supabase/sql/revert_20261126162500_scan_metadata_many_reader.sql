-- Revert of 20261126162500_scan_metadata_many_reader.sql: vehicle_image_scan_metadata(uuid) back to its 2026-11-25 live
-- body (20261125200000; prosrc md5 1930b342245ec8baa829ddee4ab34111, pg_get_functiondef md5
-- 724d2e2c15f50d57e977ab4516ac6b1d), vehicle_image_scan_metadata_many(uuid[]) and its platform_config row removed.
-- Apply only after every caller of vehicle_image_scan_metadata_many has left (the web gallery reads, PR B).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.vehicle_image_scan_metadata_many(uuid[]);
DELETE FROM public.platform_config WHERE config_key = 'vehicle_image_scan_metadata_many';
CREATE OR REPLACE FUNCTION public.vehicle_image_scan_metadata(p_image_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER COST 1
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  vi public.vehicle_images;
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_rules public.image_scan_rule[];
BEGIN
  SELECT * INTO vi FROM public.vehicle_images i WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_role = 'service_role' OR (v_role IS NULL AND session_user <> 'authenticator') THEN
    RETURN vi.ai_scan_metadata;
  END IF;
  -- definer_readers_visibility_v1 (scan_metadata_withheld_paths): the uploader, or shown on a public non-deleted car
  -- and gallery-eligible, or tied; every term COALESCEd so a NULL never admits
  IF NOT (COALESCE(v_uid IS NOT NULL AND vi.user_id = v_uid, false)
          OR COALESCE(COALESCE(vi.is_sensitive, false) = false
                      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL)
                      AND public.vehicle_image_gallery_eligible(vi), false)
          OR COALESCE(public.vehicle_viewer_tied(vi.vehicle_id), false)) THEN
    RETURN NULL;
  END IF;
  SELECT c.rules INTO v_rules FROM public.image_scan_rules_compiled c WHERE c.surface = 'vehicle_images.ai_scan_metadata';
  IF v_rules IS NULL THEN
    v_rules := public.image_scan_rules('vehicle_images.ai_scan_metadata');
  END IF;
  RETURN public.image_scan_metadata_for_viewer(vi.ai_scan_metadata, vi.user_id, vi.vehicle_id, v_rules);
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_image_scan_metadata(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_scan_metadata(uuid) TO anon, authenticated, service_role;
DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure)
     IS DISTINCT FROM '1930b342245ec8baa829ddee4ab34111' THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata is not the 2026-11-25 live body after the revert';
  END IF;
END
$verify$;
COMMIT;
