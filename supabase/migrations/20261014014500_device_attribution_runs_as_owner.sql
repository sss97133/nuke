-- Phone photos have not landed since 2026-06-21: the device-attribution trigger ran as the phone's user.
--
-- vehicle_images' AFTER INSERT trigger trg_auto_attribute_device calls auto_attribute_image_to_device(), an
-- invoker function that, through get_or_create_ghost_user(), reads, updates and inserts ghost_users and inserts
-- device_attributions. Both tables have row security and no insert policy. Until 2026-06-21 every frame from the
-- phone (source capture_relay_ios) fingerprinted to 'Unknown-Unknown-Unknown-Unknown' and the function returned
-- early; migration 20260621140000_device_signature_from_ios_exif.sql (applied 2026-06-21 21:58Z) taught the
-- fingerprint to read the phone's flat EXIF keys, so from then on the function proceeded, the phone's
-- authenticated insert was refused by row security, and the whole image insert rolled back. The service role (the
-- Mac photo sync) bypasses row security, so its frames kept landing and the gap stayed silent.
--
-- Measured 2026-10-14 01:35Z: the last capture_relay_ios row landed 2026-06-21 10:28Z (get_user_sync_status
-- agrees); 4,755 phone uploads reached storage (users/<id>/capture-relay/) after that row, the last on 2026-07-08,
-- each with no vehicle_images row. Each app open retried the queue: original bytes, on-device triage, a storage
-- upload that already existed, an insert that failed. The phone ran hot (owner, 2026-10-13).
--
-- Fix: run the trigger function as its owner, as the other enrichment functions do. No body change, no lock on
-- vehicle_images (ALTER FUNCTION touches pg_proc only). The phone's queued frames land on its next sync.
-- Contract: supabase/sql/test_device_attribution_as_owner.sql (the authenticated insert fails before, lands after).

set lock_timeout = '5s';
set statement_timeout = '30s';

-- The body this file was reviewed against (sha256 of prosrc, base64, 2026-10-14 01:40Z).
DO $guard$
DECLARE a text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a
    FROM pg_proc WHERE oid = 'public.auto_attribute_image_to_device()'::regprocedure;
  IF a <> 'ygr2cVFVzy2fJG/ILq5CiyO96BhmuUXodH06fdtDQMY=' THEN
    RAISE EXCEPTION 'auto_attribute_image_to_device differs from the reviewed definition (%)', a;
  END IF;
END $guard$;

ALTER FUNCTION public.auto_attribute_image_to_device() SECURITY DEFINER;
ALTER FUNCTION public.auto_attribute_image_to_device() SET search_path = public;

COMMENT ON FUNCTION public.auto_attribute_image_to_device() IS
  'AFTER INSERT on vehicle_images: signs the frame''s device into ghost_users and device_attributions. Runs as its owner (2026-10-14): as the inserting user it was refused by row security and rolled back every phone photo insert from 2026-06-21.';
