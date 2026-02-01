-- ============================================================
-- Ownership Hierarchy Fix: Title vs Physical Possession
-- ============================================================
--
-- Real-world ownership hierarchy:
-- 1. TITLE = Definitive legal ownership (name on paper)
-- 2. PHYSICAL POSSESSION = Who has the car (evidenced by content creation)
--
-- This migration:
-- - Extends device_attributions with EXIF data columns
-- - Adds device_fingerprint to vehicle_images for quick lookups
-- - Adds ownership_type to distinguish title vs possession
-- - Adds verification_category to ownership_verifications
-- - Creates sync triggers between the three ownership systems
--
-- ============================================================

BEGIN;

-- ============================================
-- 1) Extend device_attributions with EXIF columns
-- ============================================
-- Table already exists for ghost user tracking
-- Add EXIF-specific columns for physical possession signals

DO $$
BEGIN
  -- Camera identification from EXIF
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'camera_make') THEN
    ALTER TABLE device_attributions ADD COLUMN camera_make TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'camera_model') THEN
    ALTER TABLE device_attributions ADD COLUMN camera_model TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'camera_serial') THEN
    ALTER TABLE device_attributions ADD COLUMN camera_serial TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'software') THEN
    ALTER TABLE device_attributions ADD COLUMN software TEXT;
  END IF;

  -- Location from EXIF
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'latitude') THEN
    ALTER TABLE device_attributions ADD COLUMN latitude DOUBLE PRECISION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'longitude') THEN
    ALTER TABLE device_attributions ADD COLUMN longitude DOUBLE PRECISION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'altitude') THEN
    ALTER TABLE device_attributions ADD COLUMN altitude DOUBLE PRECISION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'gps_timestamp') THEN
    ALTER TABLE device_attributions ADD COLUMN gps_timestamp TIMESTAMPTZ;
  END IF;

  -- Time from EXIF
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'datetime_original') THEN
    ALTER TABLE device_attributions ADD COLUMN datetime_original TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'datetime_digitized') THEN
    ALTER TABLE device_attributions ADD COLUMN datetime_digitized TIMESTAMPTZ;
  END IF;

  -- Extraction method (extend existing attribution_source concept)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'extraction_method') THEN
    ALTER TABLE device_attributions ADD COLUMN extraction_method TEXT DEFAULT 'exif';
  END IF;

  -- Full EXIF dump for future analysis
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'raw_exif') THEN
    ALTER TABLE device_attributions ADD COLUMN raw_exif JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_attributions' AND column_name = 'updated_at') THEN
    ALTER TABLE device_attributions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Add indexes for EXIF-based queries
CREATE INDEX IF NOT EXISTS idx_device_attr_datetime ON device_attributions(datetime_original) WHERE datetime_original IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_attr_location ON device_attributions(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON TABLE device_attributions IS 'Device fingerprints for content attribution and physical possession verification. Extended with EXIF data.';


-- ============================================
-- 2) Add device_fingerprint to vehicle_images
-- ============================================
-- Quick lookup without joining device_attributions

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_images' AND column_name = 'device_fingerprint'
  ) THEN
    ALTER TABLE vehicle_images ADD COLUMN device_fingerprint TEXT;
  END IF;

  -- Location confidence for EXIF validation
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_images' AND column_name = 'location_confidence'
  ) THEN
    ALTER TABLE vehicle_images ADD COLUMN location_confidence DECIMAL(3,2);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_device_fingerprint
  ON vehicle_images(device_fingerprint) WHERE device_fingerprint IS NOT NULL;


-- ============================================
-- 3) Add verification_category to ownership_verifications
-- ============================================
-- Distinguishes HOW ownership was verified

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ownership_verifications' AND column_name = 'verification_category'
  ) THEN
    ALTER TABLE ownership_verifications ADD COLUMN verification_category TEXT;
  END IF;

  -- Add check constraint if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ownership_verifications_verification_category_check'
  ) THEN
    ALTER TABLE ownership_verifications ADD CONSTRAINT ownership_verifications_verification_category_check
      CHECK (verification_category IS NULL OR verification_category IN (
        'title_document',        -- Legal title verification (strongest)
        'custody_evidence',      -- Physical possession proof (EXIF, device, location)
        'third_party_verified',  -- Shop/org/dealer verified
        'self_claimed'           -- User claim (weakest, needs other signals)
      ));
  END IF;

  -- Track where the claim came from
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ownership_verifications' AND column_name = 'claim_source'
  ) THEN
    ALTER TABLE ownership_verifications ADD COLUMN claim_source TEXT;
  END IF;

  -- Add check constraint if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ownership_verifications_claim_source_check'
  ) THEN
    ALTER TABLE ownership_verifications ADD CONSTRAINT ownership_verifications_claim_source_check
      CHECK (claim_source IS NULL OR claim_source IN (
        'user_input',       -- User submitted docs
        'content_analysis', -- Inferred from content creation patterns
        'organization',     -- Org vouched for user
        'ai_detection',     -- AI determined from signals
        'title_transfer'    -- Result of a title transfer
      ));
  END IF;
END $$;

-- Backfill existing approved verifications as title_document (they required title upload)
-- Disable triggers temporarily to avoid cascading function calls
SET session_replication_role = replica;

UPDATE ownership_verifications
SET verification_category = 'title_document',
    claim_source = 'user_input'
WHERE status = 'approved'
  AND verification_category IS NULL;

SET session_replication_role = DEFAULT;


-- ============================================
-- 4) Add ownership_type to vehicle_ownerships
-- ============================================
-- Distinguishes title holder from physical possessor

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_ownerships' AND column_name = 'ownership_type'
  ) THEN
    ALTER TABLE vehicle_ownerships ADD COLUMN ownership_type TEXT;
  END IF;

  -- Add check constraint if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_ownerships_ownership_type_check'
  ) THEN
    ALTER TABLE vehicle_ownerships ADD CONSTRAINT vehicle_ownerships_ownership_type_check
      CHECK (ownership_type IS NULL OR ownership_type IN (
        'legal_title',         -- Verified via title doc (highest)
        'physical_possession', -- Verified via custody signals (secondary)
        'operational_custody', -- Has receipts/maintenance records
        'claimed_unverified'   -- User claim, no proof yet
      ));
  END IF;

  -- Link to the verification that established this ownership
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_ownerships' AND column_name = 'verification_id'
  ) THEN
    ALTER TABLE vehicle_ownerships ADD COLUMN verification_id UUID;
  END IF;

  -- Add FK if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_ownerships_verification_id_fkey'
  ) THEN
    ALTER TABLE vehicle_ownerships ADD CONSTRAINT vehicle_ownerships_verification_id_fkey
      FOREIGN KEY (verification_id) REFERENCES ownership_verifications(id) ON DELETE SET NULL;
  END IF;

  -- Confidence score (from authority scoring)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_ownerships' AND column_name = 'authority_score'
  ) THEN
    ALTER TABLE vehicle_ownerships ADD COLUMN authority_score INTEGER;
  END IF;

  -- Add check constraint if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_ownerships_authority_score_check'
  ) THEN
    ALTER TABLE vehicle_ownerships ADD CONSTRAINT vehicle_ownerships_authority_score_check
      CHECK (authority_score IS NULL OR (authority_score >= 0 AND authority_score <= 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicle_ownerships_type ON vehicle_ownerships(ownership_type) WHERE ownership_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_ownerships_verification ON vehicle_ownerships(verification_id) WHERE verification_id IS NOT NULL;


-- ============================================
-- 5) Sync: ownership_verifications -> vehicle_ownerships
-- ============================================
-- When a verification is approved, create/update vehicle_ownership record

CREATE OR REPLACE FUNCTION sync_verification_to_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ownership_type TEXT;
  v_profile_id UUID;
BEGIN
  -- Only act on approval
  IF NEW.status != 'approved' OR (OLD IS NOT NULL AND OLD.status = 'approved') THEN
    RETURN NEW;
  END IF;

  -- Map verification_category to ownership_type
  v_ownership_type := CASE NEW.verification_category
    WHEN 'title_document' THEN 'legal_title'
    WHEN 'custody_evidence' THEN 'physical_possession'
    WHEN 'third_party_verified' THEN 'operational_custody'
    ELSE 'claimed_unverified'
  END;

  -- Get profile_id from user_id (profiles.id = auth.users.id in this schema)
  v_profile_id := NEW.user_id;

  -- Check if profiles table exists and has the user
  BEGIN
    PERFORM 1 FROM profiles WHERE id = NEW.user_id;
    IF NOT FOUND THEN
      -- No profile yet, skip
      RETURN NEW;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    -- profiles table doesn't exist
    RETURN NEW;
  END;

  -- Upsert vehicle_ownership record
  INSERT INTO vehicle_ownerships (
    vehicle_id,
    owner_profile_id,
    role,
    is_current,
    ownership_type,
    verification_id,
    start_date
  ) VALUES (
    NEW.vehicle_id,
    v_profile_id,
    'owner',
    true,
    v_ownership_type,
    NEW.id,
    COALESCE(NEW.approved_at::date, CURRENT_DATE)
  )
  ON CONFLICT (vehicle_id, owner_profile_id) DO UPDATE SET
    is_current = true,
    ownership_type = EXCLUDED.ownership_type,
    verification_id = EXCLUDED.verification_id,
    start_date = COALESCE(vehicle_ownerships.start_date, EXCLUDED.start_date),
    updated_at = NOW()
  WHERE vehicle_ownerships.role = 'owner';

  RETURN NEW;
EXCEPTION WHEN undefined_table THEN
  -- Tables don't exist yet
  RETURN NEW;
WHEN others THEN
  -- Log but don't fail the verification
  RAISE WARNING 'sync_verification_to_ownership failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_verification_to_ownership ON ownership_verifications;
CREATE TRIGGER trg_sync_verification_to_ownership
  AFTER UPDATE ON ownership_verifications
  FOR EACH ROW
  EXECUTE FUNCTION sync_verification_to_ownership();


-- ============================================
-- 6) Sync: ownership_transfers -> vehicle_ownerships
-- ============================================
-- When a title transfer completes, update ownership records

CREATE OR REPLACE FUNCTION sync_transfer_to_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark previous owner as not current
  IF NEW.from_owner_id IS NOT NULL THEN
    UPDATE vehicle_ownerships
    SET is_current = false,
        end_date = NEW.transfer_date,
        updated_at = NOW()
    WHERE vehicle_id = NEW.vehicle_id
      AND owner_profile_id = NEW.from_owner_id
      AND is_current = true;
  END IF;

  -- Create/update new owner record
  IF NEW.to_owner_id IS NOT NULL THEN
    INSERT INTO vehicle_ownerships (
      vehicle_id,
      owner_profile_id,
      role,
      is_current,
      ownership_type,
      start_date
    ) VALUES (
      NEW.vehicle_id,
      NEW.to_owner_id,
      'owner',
      true,
      'legal_title',  -- Transfers are title-based
      NEW.transfer_date
    )
    ON CONFLICT (vehicle_id, owner_profile_id) DO UPDATE SET
      is_current = true,
      ownership_type = 'legal_title',
      start_date = EXCLUDED.start_date,
      end_date = NULL,
      updated_at = NOW()
    WHERE vehicle_ownerships.role = 'owner';
  END IF;

  RETURN NEW;
EXCEPTION WHEN undefined_table THEN
  RETURN NEW;
WHEN others THEN
  RAISE WARNING 'sync_transfer_to_ownership failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_transfer_to_ownership ON ownership_transfers;
CREATE TRIGGER trg_sync_transfer_to_ownership
  AFTER INSERT ON ownership_transfers
  FOR EACH ROW
  EXECUTE FUNCTION sync_transfer_to_ownership();


-- ============================================
-- 7) Extract EXIF on image insert
-- ============================================
-- Placeholder trigger - actual extraction happens in edge function

CREATE OR REPLACE FUNCTION mark_image_for_exif_extraction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If exif_data is null and this looks like an original upload,
  -- mark for EXIF extraction (picked up by background worker)
  IF NEW.exif_data IS NULL AND NEW.source = 'user_upload' THEN
    NEW.ai_processing_status := COALESCE(NEW.ai_processing_status, 'pending_exif');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_exif_extraction ON vehicle_images;
CREATE TRIGGER trg_mark_exif_extraction
  BEFORE INSERT ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION mark_image_for_exif_extraction();


-- ============================================
-- 8) Function: Calculate physical possession score
-- ============================================
-- Based on content creation patterns

CREATE OR REPLACE FUNCTION calculate_possession_score(
  p_vehicle_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_image_count INTEGER := 0;
  v_device_count INTEGER := 0;
  v_distinct_devices INTEGER := 0;
  v_recent_images INTEGER := 0;  -- Last 90 days
  v_location_consistent BOOLEAN := false;
  v_score INTEGER := 0;
  v_signals JSONB := '[]'::jsonb;
BEGIN
  -- Count images from this user for this vehicle
  SELECT COUNT(*) INTO v_image_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id;

  -- Count recent images (last 90 days = active possession)
  SELECT COUNT(*) INTO v_recent_images
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND user_id = p_user_id
    AND created_at > NOW() - INTERVAL '90 days';

  -- Device fingerprint analysis
  SELECT
    COUNT(*),
    COUNT(DISTINCT device_fingerprint)
  INTO v_device_count, v_distinct_devices
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND user_id = p_user_id
    AND device_fingerprint IS NOT NULL;

  -- Check location consistency (if we have EXIF locations)
  SELECT
    COUNT(DISTINCT
      ROUND(latitude::numeric, 2)::text || ',' || ROUND(longitude::numeric, 2)::text
    ) <= 3  -- Allow up to 3 distinct locations (home, work, shop)
  INTO v_location_consistent
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND user_id = p_user_id
    AND latitude IS NOT NULL;

  -- Calculate score (0-100)
  -- Base: image count (max 30 points)
  v_score := LEAST(30, v_image_count * 2);
  v_signals := v_signals || jsonb_build_object(
    'signal', 'image_count',
    'value', v_image_count,
    'points', LEAST(30, v_image_count * 2)
  );

  -- Recent activity bonus (max 25 points)
  IF v_recent_images > 0 THEN
    v_score := v_score + LEAST(25, v_recent_images * 5);
    v_signals := v_signals || jsonb_build_object(
      'signal', 'recent_activity',
      'value', v_recent_images,
      'points', LEAST(25, v_recent_images * 5)
    );
  END IF;

  -- Device consistency bonus (max 25 points)
  IF v_device_count >= 3 THEN
    IF v_distinct_devices = 1 THEN
      v_score := v_score + 25;  -- Same device = strong signal
      v_signals := v_signals || jsonb_build_object(
        'signal', 'device_consistency',
        'value', '1 device',
        'points', 25
      );
    ELSIF v_distinct_devices = 2 THEN
      v_score := v_score + 15;  -- 2 devices = decent
      v_signals := v_signals || jsonb_build_object(
        'signal', 'device_consistency',
        'value', '2 devices',
        'points', 15
      );
    ELSE
      v_score := v_score + 5;   -- Many devices = weak
      v_signals := v_signals || jsonb_build_object(
        'signal', 'device_consistency',
        'value', v_distinct_devices || ' devices',
        'points', 5
      );
    END IF;
  END IF;

  -- Location consistency bonus (max 20 points)
  IF v_location_consistent AND v_device_count >= 3 THEN
    v_score := v_score + 20;
    v_signals := v_signals || jsonb_build_object(
      'signal', 'location_consistency',
      'value', true,
      'points', 20
    );
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'user_id', p_user_id,
    'possession_score', LEAST(100, v_score),
    'image_count', v_image_count,
    'recent_images', v_recent_images,
    'distinct_devices', v_distinct_devices,
    'location_consistent', v_location_consistent,
    'signals', v_signals,
    'computed_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_possession_score(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_possession_score(UUID, UUID) TO service_role;


-- ============================================
-- 9) Update authority scoring to use new signals
-- ============================================
-- Add new signal weights for possession scoring (if table exists)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'authority_signal_weights') THEN
    INSERT INTO authority_signal_weights (signal_key, category_key, weight_points, notes)
    VALUES
      ('recent_images', 'custody_presence', 15, 'Images uploaded in last 90 days (scaled).'),
      ('location_consistency', 'custody_presence', 10, 'EXIF locations are consistent (home/work/shop).')
    ON CONFLICT (signal_key) DO UPDATE SET
      category_key = EXCLUDED.category_key,
      weight_points = EXCLUDED.weight_points,
      notes = EXCLUDED.notes,
      updated_at = NOW();
  END IF;
END $$;


-- ============================================
-- 10) View: Current ownership status
-- ============================================
-- Unified view of who owns what, by what authority

DROP VIEW IF EXISTS v_vehicle_ownership_status;
CREATE VIEW v_vehicle_ownership_status AS
SELECT
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.vin,

  -- Title owner (from ownership_verifications)
  ov_title.user_id as title_holder_id,
  ov_title.status as title_status,
  ov_title.approved_at as title_verified_at,

  -- Current owner (from vehicle_ownerships)
  vo.owner_profile_id as current_owner_id,
  vo.ownership_type,
  vo.authority_score,
  vo.start_date as ownership_start,

  -- Physical possessor (from content patterns)
  (
    SELECT user_id
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
    GROUP BY user_id
    ORDER BY COUNT(*) DESC, MAX(created_at) DESC
    LIMIT 1
  ) as likely_possessor_id,

  -- Conflict detection
  CASE
    WHEN ov_title.user_id IS NOT NULL
         AND vo.owner_profile_id IS NOT NULL
         AND ov_title.user_id != vo.owner_profile_id
    THEN true
    ELSE false
  END as has_ownership_conflict

FROM vehicles v
LEFT JOIN ownership_verifications ov_title
  ON ov_title.vehicle_id = v.id
  AND ov_title.status = 'approved'
  AND ov_title.verification_category = 'title_document'
LEFT JOIN vehicle_ownerships vo
  ON vo.vehicle_id = v.id
  AND vo.is_current = true
  AND vo.role IN ('owner', 'verified_owner');

COMMENT ON VIEW v_vehicle_ownership_status IS
  'Unified view of vehicle ownership: title holder, current owner, likely possessor, and conflicts';


COMMIT;
