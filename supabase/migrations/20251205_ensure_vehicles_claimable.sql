-- ============================================
-- ENSURE ALL VEHICLES ARE CLAIMABLE
-- ============================================
-- Problem: Vehicles are showing as "claimed" when they shouldn't be
-- Solution: Only vehicles with approved ownership_verifications are "claimed"
-- All other vehicles should be claimable via the claim wizard

-- ============================================
-- 1. FUNCTION: Check if vehicle is claimed
-- ============================================
CREATE OR REPLACE FUNCTION is_vehicle_claimed(p_vehicle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_has_approved_verification BOOLEAN;
BEGIN
  -- Vehicle is ONLY claimed if there's an approved ownership verification
  SELECT EXISTS (
    SELECT 1
    FROM ownership_verifications
    WHERE vehicle_id = p_vehicle_id
      AND status = 'approved'
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_has_approved_verification;
  
  RETURN v_has_approved_verification;
END;
$$;

COMMENT ON FUNCTION is_vehicle_claimed IS 'Returns true ONLY if vehicle has an approved ownership verification. All other vehicles are claimable.';

-- ============================================
-- 2. VIEW: Claimable Vehicles
-- ============================================
CREATE OR REPLACE VIEW claimable_vehicles AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.uploaded_by,
  v.created_at,
  is_vehicle_claimed(v.id) as is_claimed,
  (
    SELECT COUNT(*)
    FROM ownership_verifications ov
    WHERE ov.vehicle_id = v.id
      AND ov.status = 'approved'
  ) as approved_claims_count,
  (
    SELECT COUNT(*)
    FROM ownership_verifications ov
    WHERE ov.vehicle_id = v.id
      AND ov.status = 'pending'
  ) as pending_claims_count
FROM vehicles v;

COMMENT ON VIEW claimable_vehicles IS 'Shows all vehicles with claim status. Only vehicles with approved ownership_verifications are considered claimed.';

-- ============================================
-- 3. FIX: Remove user_id from vehicle creation
-- ============================================
-- The user_id field should NOT be set during vehicle creation
-- Only uploaded_by should be set (tracks who uploaded, not who owns)
-- Ownership is determined ONLY by ownership_verifications table

-- Create a trigger to prevent user_id from being set on insert
CREATE OR REPLACE FUNCTION prevent_user_id_on_vehicle_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Clear user_id if it's set - ownership must go through verification
  IF NEW.user_id IS NOT NULL THEN
    RAISE WARNING 'user_id was set on vehicle insert. Clearing it - ownership must be verified via ownership_verifications table. Vehicle ID: %', NEW.id;
    NEW.user_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_user_id_on_vehicle_insert ON vehicles;
CREATE TRIGGER trg_prevent_user_id_on_vehicle_insert
  BEFORE INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_user_id_on_vehicle_insert();

COMMENT ON FUNCTION prevent_user_id_on_vehicle_insert IS 'Prevents user_id from being set on vehicle creation. Ownership must be verified via ownership_verifications table.';

-- ============================================
-- 4. FIX: Clear existing user_id that aren't verified
-- ============================================
-- Remove user_id from vehicles that don't have approved ownership verifications
UPDATE vehicles
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ownership_verifications ov
    WHERE ov.vehicle_id = vehicles.id
      AND ov.user_id = vehicles.user_id
      AND ov.status = 'approved'
  );

-- ============================================
-- 5. FUNCTION: Get vehicle claim status
-- ============================================
CREATE OR REPLACE FUNCTION get_vehicle_claim_status(
  p_vehicle_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_claimed BOOLEAN;
  v_user_has_claim BOOLEAN;
  v_user_claim_status TEXT;
  v_approved_claims JSONB;
BEGIN
  -- Check if vehicle is claimed by anyone
  v_is_claimed := is_vehicle_claimed(p_vehicle_id);
  
  -- Check if specific user has a claim
  IF p_user_id IS NOT NULL THEN
    SELECT 
      EXISTS (
        SELECT 1
        FROM ownership_verifications
        WHERE vehicle_id = p_vehicle_id
          AND user_id = p_user_id
          AND status = 'approved'
      ),
      status
    INTO v_user_has_claim, v_user_claim_status
    FROM ownership_verifications
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
    ORDER BY submitted_at DESC
    LIMIT 1;
  END IF;
  
  -- Get all approved claims
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', user_id,
      'verification_type', verification_type,
      'submitted_at', submitted_at,
      'reviewed_at', reviewed_at
    )
  )
  INTO v_approved_claims
  FROM ownership_verifications
  WHERE vehicle_id = p_vehicle_id
    AND status = 'approved';
  
  RETURN jsonb_build_object(
    'is_claimed', v_is_claimed,
    'user_has_claim', COALESCE(v_user_has_claim, false),
    'user_claim_status', COALESCE(v_user_claim_status, 'none'),
    'approved_claims', COALESCE(v_approved_claims, '[]'::jsonb),
    'is_claimable', NOT v_is_claimed OR (p_user_id IS NOT NULL AND NOT v_user_has_claim)
  );
END;
$$;

COMMENT ON FUNCTION get_vehicle_claim_status IS 'Returns comprehensive claim status for a vehicle. Only approved ownership_verifications count as claims.';

