-- ============================================================================
-- PERSONAL IMAGE PRIVACY — close the personal-library leak
-- Filed: 2026-06-10
--
-- Probed live: anon (the public key shipped in every browser) can enumerate
-- vehicle_images rows with vehicle_id IS NULL — the personal library,
-- including bulk drive dumps (source ssd_export / ssd-blast) — with public
-- storage URLs. The committed SELECT policies are correctly scoped (owner /
-- public-vehicle, both requiring a vehicle join), so prod carries an
-- over-broad permissive policy that exists in no migration (drift).
--
-- Fix strategy: permissive policies OR together, so the only cure is
-- dropping the broad one. Its name is unknown → drop by SHAPE: any
-- permissive SELECT policy on vehicle_images whose USING qual is literally
-- 'true'. Then ensure the scoped trio exists.
--
-- LIMIT OF THIS FIX (flagged, not silent): the storage bucket is public, so
-- already-minted URLs keep working for anyone who possesses them. True
-- at-rest privacy needs a private bucket + signed URLs for personal images
-- — a planned refactor. This migration stops ENUMERATION, which is the
-- attack that matters (guessing UUID paths is not practical).
-- ============================================================================

-- 1. Drop any USING(true) SELECT policy on vehicle_images, whatever its name
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_images'
      AND cmd = 'SELECT'
      AND qual = 'true'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.vehicle_images', pol.policyname);
    RAISE NOTICE 'Dropped over-broad vehicle_images SELECT policy: %', pol.policyname;
  END LOOP;
END $$;

-- 2. Ensure RLS is on and the scoped policies exist
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- Public can see images of public vehicles (what the site needs)
DROP POLICY IF EXISTS "Users can view images for public vehicles" ON vehicle_images;
CREATE POLICY "Users can view images for public vehicles" ON vehicle_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_images.vehicle_id
        AND vehicles.is_public = true
    )
  );

-- Owners see images of their vehicles
DROP POLICY IF EXISTS "Users can view images for vehicles they own" ON vehicle_images;
CREATE POLICY "Users can view images for vehicles they own" ON vehicle_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_images.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.uploaded_by = auth.uid() OR vehicles.owner_id = auth.uid())
    )
  );

-- Personal library (no vehicle yet): visible ONLY to its uploader.
DROP POLICY IF EXISTS "users_can_view_own_unorganized_images" ON vehicle_images;
CREATE POLICY "users_can_view_own_unorganized_images" ON vehicle_images
  FOR SELECT USING (
    vehicle_id IS NULL
    AND (user_id = auth.uid() OR documented_by_user_id = auth.uid())
  );
