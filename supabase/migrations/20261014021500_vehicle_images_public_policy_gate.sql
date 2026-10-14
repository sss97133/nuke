-- vehicle_images: strangers no longer read frames the vision gate rejected or holds for review.
--
-- The public read policy "Users can view images for public vehicles" admitted every frame of a public vehicle
-- that was neither sensitive nor superseded, whatever the vision gate decided. On 2026-10-14 the K5
-- (e08bf694) carried 259 rejected_personal and 66 rejected_misattributed frames, and anyone with the public
-- anon key could list them with their storage URLs. The web hides those two verdicts with a client filter
-- (useVehicleImages, ProImageViewer, VehicleThumbnail, DiscoveryFeed), which is presentation, not a control.
-- The gallery rule vehicle_image_gallery_eligible already shows none of the three statuses.
--
-- After this migration a stranger (anon, or a signed-in non-owner) reads a public vehicle's frame only if its
-- gate status is null, approved or pending. review_needed is held back as well: the gate could not decide, and
-- 4,795 such frames on public vehicles (ssd_blast 3,792, iphoto 394, 2026-10-14) come from camera-roll archives.
-- Owners keep every frame through "Users can view their own images" and "Users can view images for vehicles
-- they own"; organization members keep theirs through their own policy. No row changes.
--
-- ALTER POLICY takes an ACCESS EXCLUSIVE lock on a hot table (about 38.9 million rows), so the lock wait is
-- capped at 2 s and the change refuses to start behind lock waiters or idle transactions. The policy is
-- altered only from its known definition; any other definition stops the migration for inspection.
-- Contract: supabase/sql/test_vehicle_images_public_policy_gate.sql (CI job vehicle-images-policy-contract).
SET lock_timeout = '2s';
SET statement_timeout = '30s';

DO $gate$
DECLARE
  pol_name constant text := 'Users can view images for public vehicles';
  known constant text := '((COALESCE(is_sensitive,false)=false)AND(COALESCE(is_superseded,false)=false)AND(EXISTS(SELECT1FROMvehiclesWHERE((vehicles.id=vehicle_images.vehicle_id)AND(vehicles.is_public=true)))))';
  cur text;
BEGIN
  PERFORM set_config('search_path', 'public', true);
  SELECT regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', '', 'g') INTO cur
    FROM pg_policy p
   WHERE p.polrelid = 'public.vehicle_images'::regclass AND p.polname = pol_name
     AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY[0::oid];
  IF cur IS NULL THEN
    RAISE EXCEPTION 'Policy "%" is missing or no longer a permissive SELECT for public; inspect before retry', pol_name;
  END IF;
  IF cur LIKE '%rejected_personal%' AND cur LIKE '%rejected_misattributed%' AND cur LIKE '%review_needed%' THEN
    RAISE NOTICE 'Policy "%" already holds back gated frames; nothing to do', pol_name;
    RETURN;
  END IF;
  IF cur IS DISTINCT FROM known THEN
    RAISE EXCEPTION 'Policy "%" has drifted from its known definition; inspect before retry: %', pol_name, cur;
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)'))
  THEN
    RAISE EXCEPTION 'vehicle_images policy change requires no lock waiters and no idle transactions; retry';
  END IF;

  ALTER POLICY "Users can view images for public vehicles" ON public.vehicle_images
    USING (
      COALESCE(is_sensitive, false) = false
      AND COALESCE(is_superseded, false) = false
      AND (vision_gate_status IS NULL
           OR vision_gate_status NOT IN ('rejected_personal'::public.vision_gate_status,
                                         'rejected_misattributed'::public.vision_gate_status,
                                         'review_needed'::public.vision_gate_status))
      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true)
    );

  SELECT regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', '', 'g') INTO cur
    FROM pg_policy p WHERE p.polrelid = 'public.vehicle_images'::regclass AND p.polname = pol_name;
  IF NOT (cur LIKE '%rejected_personal%' AND cur LIKE '%rejected_misattributed%' AND cur LIKE '%review_needed%'
          AND cur LIKE '%is_public=true%' AND cur LIKE '%COALESCE(is_sensitive,false)=false%'
          AND cur LIKE '%COALESCE(is_superseded,false)=false%') THEN
    RAISE EXCEPTION 'Policy "%" did not take the expected definition: %', pol_name, cur;
  END IF;
END
$gate$;

RESET statement_timeout;
RESET lock_timeout;
