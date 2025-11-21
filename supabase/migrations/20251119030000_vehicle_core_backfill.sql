-- Vehicle core schema backfill and access helpers

-- ============================================================================
-- Access helper functions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_perm boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Direct vehicle-level permissions
  SELECT true
    INTO has_perm
    FROM vehicle_user_permissions vup
   WHERE vup.vehicle_id = p_vehicle_id
     AND vup.user_id = p_user_id
     AND COALESCE(vup.is_active, true) = true
     AND vup.role = ANY (
       ARRAY['owner','co_owner','mechanic','appraiser','moderator',
             'contributor','photographer','dealer_rep','sales_agent',
             'restorer','consigner','board_member']::text[]
     )
   LIMIT 1;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Vehicle contributors table (legacy collaborators)
  SELECT true
    INTO has_perm
    FROM vehicle_contributors vc
   WHERE vc.vehicle_id = p_vehicle_id
     AND vc.user_id = p_user_id
     AND COALESCE(vc.status, 'active') = 'active'
     AND vc.role = ANY (
       ARRAY['owner','co_owner','restorer','moderator','consigner',
             'mechanic','appraiser','photographer','sales_agent']::text[]
     )
   LIMIT 1;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Organization contributors linked to this vehicle
  SELECT true
    INTO has_perm
    FROM organization_vehicles ov
    JOIN organization_contributors oc
      ON oc.organization_id = ov.organization_id
   WHERE ov.vehicle_id = p_vehicle_id
     AND oc.user_id = p_user_id
     AND oc.status = 'active'
     AND oc.role = ANY (
       ARRAY['owner','co_founder','board_member','manager','employee',
             'technician','contractor','moderator','contributor','photographer']::text[]
     )
   LIMIT 1;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Verified ownership records
  SELECT true
    INTO has_perm
    FROM ownership_verifications ov
   WHERE ov.vehicle_id = p_vehicle_id
     AND ov.user_id = p_user_id
     AND ov.status = 'approved'
   LIMIT 1;

  RETURN COALESCE(has_perm, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.vehicle_can_view(p_vehicle_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
BEGIN
  SELECT user_id, owner_id, uploaded_by, is_public
    INTO v_record
    FROM vehicles
   WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_record.is_public THEN
    RETURN true;
  END IF;

  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_user_id = v_record.user_id
     OR p_user_id = v_record.owner_id
     OR (v_record.uploaded_by IS NOT NULL AND p_user_id = v_record.uploaded_by) THEN
    RETURN true;
  END IF;

  RETURN vehicle_user_has_access(p_vehicle_id, p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_can_view(uuid, uuid) TO anon, authenticated, service_role;

-- ============================================================================
-- Relationship helpers for profile joins
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'share_holdings_holder_profile_fkey'
  ) THEN
    ALTER TABLE share_holdings
      ADD CONSTRAINT share_holdings_holder_profile_fkey
        FOREIGN KEY (holder_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vehicle_support_profile_fkey'
  ) THEN
    ALTER TABLE vehicle_support
      ADD CONSTRAINT vehicle_support_profile_fkey
        FOREIGN KEY (supporter_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- Column backfill for vehicle_images
-- ============================================================================
ALTER TABLE IF EXISTS vehicle_images
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;

UPDATE vehicle_images
   SET uploaded_at = created_at
 WHERE uploaded_at IS NULL;

ALTER TABLE vehicle_images
  ALTER COLUMN uploaded_at SET DEFAULT now();

-- ============================================================================
-- Column backfill for market_data timestamps
-- ============================================================================
ALTER TABLE IF EXISTS market_data
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE market_data
   SET created_at = COALESCE(created_at, inserted_at)
 WHERE created_at IS NULL;

ALTER TABLE IF EXISTS market_data
  ALTER COLUMN created_at SET DEFAULT now();

-- ============================================================================
-- Column backfill for vehicle_transactions
-- ============================================================================
ALTER TABLE IF EXISTS vehicle_transactions
  ADD COLUMN IF NOT EXISTS transaction_type text,
  ADD COLUMN IF NOT EXISTS transaction_date date,
  ADD COLUMN IF NOT EXISTS is_estimate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_approximate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_level integer,
  ADD COLUMN IF NOT EXISTS proof_type text,
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS proof_document_id uuid REFERENCES vehicle_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS logged_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS logged_as text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE vehicle_transactions
   SET transaction_date = COALESCE(transaction_date, (created_at AT TIME ZONE 'UTC')::date)
 WHERE transaction_date IS NULL;

-- ============================================================================
-- Policy updates using helper functions
-- ============================================================================
DROP POLICY IF EXISTS "Vehicle collaborators can view transactions" ON vehicle_transactions;

CREATE POLICY "Vehicle collaborators can view transactions"
  ON vehicle_transactions
  FOR SELECT
  USING (
    vehicle_can_view(vehicle_transactions.vehicle_id, auth.uid())
  );

DROP POLICY IF EXISTS "Vehicle collaborators can view holdings" ON share_holdings;

CREATE POLICY "Vehicle collaborators can view holdings"
  ON share_holdings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM vehicle_offerings vo
       WHERE vo.id = share_holdings.offering_id
         AND vehicle_can_view(vo.vehicle_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Vehicle participants can view image assets" ON vehicle_image_assets;

CREATE POLICY "Vehicle participants can view image assets"
  ON vehicle_image_assets
  FOR SELECT
  USING (
    vehicle_can_view(vehicle_image_assets.vehicle_id, auth.uid())
    OR auth.uid() = vehicle_image_assets.uploader_id
  );

DROP POLICY IF EXISTS "Vehicle participants can insert image assets" ON vehicle_image_assets;

CREATE POLICY "Vehicle participants can insert image assets"
  ON vehicle_image_assets
  FOR INSERT
  WITH CHECK (
    auth.uid() = uploader_id
    AND vehicle_user_has_access(vehicle_image_assets.vehicle_id, auth.uid())
  );

DROP POLICY IF EXISTS "Vehicle participants can update image assets" ON vehicle_image_assets;

CREATE POLICY "Vehicle participants can update image assets"
  ON vehicle_image_assets
  FOR UPDATE
  USING (
    auth.uid() = uploader_id
    OR vehicle_user_has_access(vehicle_image_assets.vehicle_id, auth.uid())
  )
  WITH CHECK (
    auth.uid() = uploader_id
    OR vehicle_user_has_access(vehicle_image_assets.vehicle_id, auth.uid())
  );

DROP POLICY IF EXISTS "Vehicle participants can delete image assets" ON vehicle_image_assets;

CREATE POLICY "Vehicle participants can delete image assets"
  ON vehicle_image_assets
  FOR DELETE
  USING (
    auth.uid() = uploader_id
    OR vehicle_user_has_access(vehicle_image_assets.vehicle_id, auth.uid())
  );

-- Success notice
DO $$
BEGIN
  RAISE NOTICE '✅ Vehicle core schema backfill complete.';
END $$;

