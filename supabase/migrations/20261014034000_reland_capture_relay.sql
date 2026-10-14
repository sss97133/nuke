-- reland_capture_relay_frame: give the phone's stranded frames the image row the phone tried to write.
--
-- Measured 2026-10-14 03:20Z: storage bucket vehicle-photos holds 9,000 objects under users/<uid>/capture-relay/
-- (the phone's upload path, apps/nuke-capture-ios SupabaseService.uploadPhoto), and 4,777 of them (uploaded
-- 2026-06-12..07-08) have no vehicle_images row. From 2026-06-21 every phone insert rolled back: the AFTER INSERT
-- trigger auto_attribute_image_to_device() ran as the invoker and wrote ghost_users / device_attributions, which
-- have row security and no insert policy (fixed by PR #1105, deployed 2026-10-14 02:07Z). The bytes reached
-- storage after the phone's on-device VisionEngine had passed them; only the row was lost.
--
-- Two service-role-only functions, nothing else:
--   capture_relay_orphans(p_after, p_limit)  the objects with no row, keyset-paged by path.
--   reland_capture_relay_frame(p_frame)      one row per object, the phone's own row shape, idempotent by path.
-- The writer accepts only a path under users/<uuid>/capture-relay/ that exists in storage, takes the uploader from
-- the path (never from the caller), writes source 'capture_relay_ios' and exif_data.synced_by 'capture-relay-ios'
-- so the device trigger fingerprints it as the phone would, and records in exif_data.relanded what could not be
-- recovered from the object (the Photos localIdentifier, Apple's on-device labels, the PHAsset source type).
-- It takes a per-path advisory lock and returns 'exists' when any capture_relay_ios row already has the path, so
-- a rerun or a phone retry that lands first cannot produce a second row from this writer.
-- The rows land as the phone's did: vehicle_id null, ai_processing_status 'pending', vision gate pending.
-- No table, policy, trigger, cron or grant changes beyond EXECUTE for service_role on these two functions.
--
-- -- ALLOW_RAW_TESTIMONY_WRITE: the INSERT below is this writer's own body, the narrow door the PR introduces.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regprocedure('public.get_service_url()') IS NULL THEN
    RAISE EXCEPTION 'reland_capture_relay_frame builds the public URL with get_service_url(); it is missing';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.capture_relay_orphans(p_after text DEFAULT '', p_limit integer DEFAULT 500)
RETURNS TABLE (storage_path text, user_id uuid, object_created_at timestamptz, size_bytes bigint, mimetype text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH have AS MATERIALIZED (
    SELECT i.storage_path FROM public.vehicle_images i
     WHERE i.source = 'capture_relay_ios' AND i.storage_path IS NOT NULL
  )
  SELECT o.name, split_part(o.name, '/', 2)::uuid, o.created_at, (o.metadata->>'size')::bigint, o.metadata->>'mimetype'
    FROM storage.objects o
   WHERE o.bucket_id = 'vehicle-photos'
     AND o.name ~ '^users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/capture-relay/[^/]+$'
     AND o.name > coalesce(p_after, '')
     AND NOT EXISTS (SELECT 1 FROM have WHERE have.storage_path = o.name)
   ORDER BY o.name
   LIMIT least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;

CREATE OR REPLACE FUNCTION public.reland_capture_relay_frame(p_frame jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_path text := p_frame->>'storage_path';
  v_hash text := lower(p_frame->>'file_hash');
  v_make text := nullif(btrim(p_frame->>'camera_make'), '');
  v_model text := nullif(btrim(p_frame->>'camera_model'), '');
  v_uid uuid;
  v_name text;
  v_obj record;
  v_id uuid;
BEGIN
  IF v_path IS NULL
     OR v_path !~ '^users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/capture-relay/[^/]+$' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not a capture-relay object path', 'storage_path', v_path);
  END IF;
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'file_hash must be the sha-256 hex of the object bytes', 'storage_path', v_path);
  END IF;
  v_uid := split_part(v_path, '/', 2)::uuid;
  v_name := split_part(v_path, '/', 4);

  SELECT o.created_at, (o.metadata->>'size')::bigint AS size, o.metadata->>'mimetype' AS mimetype
    INTO v_obj
    FROM storage.objects o
   WHERE o.bucket_id = 'vehicle-photos' AND o.name = v_path;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'no such object in vehicle-photos', 'storage_path', v_path);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('reland_capture_relay:' || v_path));
  SELECT i.id INTO v_id FROM public.vehicle_images i
   WHERE i.source = 'capture_relay_ios' AND i.storage_path = v_path
   ORDER BY i.created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'exists', 'id', v_id, 'storage_path', v_path);
  END IF;

  INSERT INTO public.vehicle_images (
    image_url, storage_path, source, mime_type, file_name, file_size, is_external, ai_processing_status,
    user_id, documented_by_user_id, latitude, longitude, taken_at, file_hash, apple_ml_labels, exif_data)
  VALUES (
    public.get_service_url() || '/storage/v1/object/public/vehicle-photos/' || v_path,
    v_path,
    'capture_relay_ios',
    coalesce(v_obj.mimetype, p_frame->>'mime_type'),
    v_name,
    v_obj.size,
    false,
    'pending',
    v_uid,
    v_uid,
    (p_frame->>'latitude')::numeric,
    (p_frame->>'longitude')::numeric,
    (p_frame->>'taken_at')::timestamptz,
    v_hash,
    NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'original_filename', v_name,
      'synced_by', 'capture-relay-ios',
      'camera_make', v_make,
      'camera_model', v_model,
      'owner_verified', coalesce(v_make = 'Apple', false),
      'relanded', jsonb_build_object(
        'by', 'reland_capture_relay_frame',
        'at', now(),
        'object_uploaded_at', v_obj.created_at,
        'why', 'the phone uploaded this object but its row insert was refused (auto_attribute_image_to_device, 2026-06-21..2026-10-14, fixed by PR #1105)',
        'exif_from', 'the object bytes',
        'not_recoverable', jsonb_build_array('exif_data.uuid', 'apple_ml_labels', 'exif_data.source_type'),
        'taken_at_basis', CASE WHEN p_frame->>'taken_at' IS NULL THEN 'absent from the object EXIF' ELSE 'EXIF DateTimeOriginal' END
      )
    ))
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'landed', 'id', v_id, 'storage_path', v_path);
END $$;

REVOKE ALL ON FUNCTION public.capture_relay_orphans(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reland_capture_relay_frame(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_relay_orphans(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reland_capture_relay_frame(jsonb) TO service_role;

COMMENT ON FUNCTION public.capture_relay_orphans(text, integer) IS
  'Objects under vehicle-photos/users/<uid>/capture-relay/ with no capture_relay_ios image row, keyset-paged by path. Service role only. Feeds scripts/photos/reland-capture-relay.mjs.';
COMMENT ON FUNCTION public.reland_capture_relay_frame(jsonb) IS
  'One vehicle_images row for a stranded phone frame, in the phone''s own row shape (SupabaseService.uploadPhoto), uploader from the path, idempotent by storage_path, provenance in exif_data.relanded. Service role only.';

COMMIT;
