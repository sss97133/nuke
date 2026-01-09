-- Missing Infrastructure for Platform-Native Tier System
-- Adds missing tables, columns, and relationships needed by tier calculation functions

-- =====================================================
-- 1. VEHICLE_RECEIPTS - Ensure it exists (table or view)
-- =====================================================

-- Drop existing view if it exists (we'll recreate it)
DROP VIEW IF EXISTS vehicle_receipts CASCADE;

-- Create vehicle_receipts as a view that filters receipts for vehicles
-- This allows the tier system to query vehicle_receipts directly
CREATE VIEW vehicle_receipts AS
SELECT 
  r.id,
  r.vehicle_id,
  r.user_id,
  r.file_url as receipt_image_url,
  r.vendor_name,
  COALESCE(r.receipt_date, r.purchase_date) as receipt_date,
  r.total_amount,
  r.tax_amount,
  r.metadata,
  r.timeline_event_id,
  r.part_number,
  r.created_at,
  r.updated_at
FROM receipts r
WHERE r.vehicle_id IS NOT NULL;

COMMENT ON VIEW vehicle_receipts IS 'View of receipts filtered to vehicle-related receipts for tier calculations';

-- Add missing columns to receipts table for tier system
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'receipts'
  ) THEN
    -- Add missing columns to receipts table for tier system
    ALTER TABLE receipts 
      ADD COLUMN IF NOT EXISTS timeline_event_id UUID REFERENCES vehicle_timeline_events(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS part_number TEXT,
      ADD COLUMN IF NOT EXISTS receipt_date DATE;
    
    -- Sync receipt_date with purchase_date
    CREATE OR REPLACE FUNCTION sync_receipt_date()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.receipt_date IS NULL AND NEW.purchase_date IS NOT NULL THEN
        NEW.receipt_date := NEW.purchase_date;
      ELSIF NEW.purchase_date IS NULL AND NEW.receipt_date IS NOT NULL THEN
        NEW.purchase_date := NEW.receipt_date;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    
    DROP TRIGGER IF EXISTS sync_receipt_date_trigger ON receipts;
    CREATE TRIGGER sync_receipt_date_trigger
      BEFORE INSERT OR UPDATE ON receipts
      FOR EACH ROW
      EXECUTE FUNCTION sync_receipt_date();
      
    -- Update existing rows
    UPDATE receipts 
    SET receipt_date = purchase_date 
    WHERE receipt_date IS NULL AND purchase_date IS NOT NULL;
    
    -- Also extract part_number from metadata if it exists there
    UPDATE receipts
    SET part_number = metadata->>'part_number'
    WHERE part_number IS NULL 
      AND metadata ? 'part_number'
      AND metadata->>'part_number' IS NOT NULL;
    
    CREATE INDEX IF NOT EXISTS idx_receipts_timeline_event ON receipts(timeline_event_id) WHERE timeline_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_receipts_part_number ON receipts(part_number) WHERE part_number IS NOT NULL;
  END IF;
END $$;

-- =====================================================
-- 2. IMAGE_TAGS TABLE - Add missing columns
-- =====================================================

DO $$
BEGIN
  -- Ensure image_tags has all columns needed by tier system
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'image_tags'
  ) THEN
    ALTER TABLE image_tags
      ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS tag_name TEXT,  -- Alias/backfill from tag_text
      ADD COLUMN IF NOT EXISTS oem_part_number TEXT,
      ADD COLUMN IF NOT EXISTS part_type TEXT CHECK (part_type IN ('OEM', 'OES', 'NOS', 'Aftermarket', 'Generic'));
    
    -- Backfill tag_name from tag_text if missing
    UPDATE image_tags
    SET tag_name = tag_text
    WHERE tag_name IS NULL AND tag_text IS NOT NULL;
    
    -- Backfill vehicle_id from image_id if possible
    UPDATE image_tags it
    SET vehicle_id = vi.vehicle_id
    FROM vehicle_images vi
    WHERE it.image_id = vi.id
      AND it.vehicle_id IS NULL;
    
    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_image_tags_vehicle_id ON image_tags(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_image_tags_tag_name ON image_tags(tag_name);
    CREATE INDEX IF NOT EXISTS idx_image_tags_oem_part ON image_tags(oem_part_number) WHERE oem_part_number IS NOT NULL;
    
    COMMENT ON COLUMN image_tags.vehicle_id IS 'Direct reference to vehicle for faster queries (also accessible via image_id -> vehicle_images -> vehicle_id)';
    COMMENT ON COLUMN image_tags.tag_name IS 'Normalized tag name (synced with tag_text)';
    COMMENT ON COLUMN image_tags.oem_part_number IS 'OEM part number if this tag represents a specific part';
  END IF;
END $$;

-- =====================================================
-- 3. VEHICLE_TIMELINE_EVENTS - Handle event_date type
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'vehicle_timeline_events'
  ) THEN
    -- Check if event_date exists and what type it is
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'vehicle_timeline_events' 
        AND column_name = 'event_date'
        AND data_type = 'timestamp with time zone'
    ) THEN
      -- event_date is TIMESTAMPTZ, tier system can use DATE(event_date) in queries
      -- No schema change needed, but add a comment
      COMMENT ON COLUMN vehicle_timeline_events.event_date IS 'Date/time of the event (TIMESTAMPTZ). Tier calculations use DATE(event_date) for date comparisons.';
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'vehicle_timeline_events' 
        AND column_name = 'event_date'
        AND data_type = 'date'
    ) THEN
      -- Already DATE, perfect
      COMMENT ON COLUMN vehicle_timeline_events.event_date IS 'Date of the event (DATE type for tier calculations)';
    ELSE
      -- event_date doesn't exist, create it as DATE
      ALTER TABLE vehicle_timeline_events
        ADD COLUMN IF NOT EXISTS event_date DATE DEFAULT CURRENT_DATE;
      
      COMMENT ON COLUMN vehicle_timeline_events.event_date IS 'Date of the event (DATE type for tier calculations)';
    END IF;
    
    -- Ensure metadata can store exif_date (it's JSONB, so no change needed)
    -- The tier system will check metadata->>'exif_date' in queries
  END IF;
END $$;

-- =====================================================
-- 4. VEHICLE_IMAGES - Add taken_at column for EXIF dates
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'vehicle_images'
  ) THEN
    ALTER TABLE vehicle_images
      ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ,  -- EXIF date/time
      ADD COLUMN IF NOT EXISTS timeline_event_id UUID REFERENCES vehicle_timeline_events(id) ON DELETE SET NULL;
    
    -- Extract taken_at from metadata if it exists
    UPDATE vehicle_images
    SET taken_at = (metadata->>'taken_at')::TIMESTAMPTZ
    WHERE taken_at IS NULL 
      AND metadata ? 'taken_at'
      AND metadata->>'taken_at' IS NOT NULL;
    
    -- Also check for common EXIF metadata keys
    UPDATE vehicle_images
    SET taken_at = COALESCE(
      (metadata->>'exif_date')::TIMESTAMPTZ,
      (metadata->>'date_taken')::TIMESTAMPTZ,
      (metadata->>'original_date')::TIMESTAMPTZ
    )
    WHERE taken_at IS NULL
      AND (
        metadata ? 'exif_date' OR
        metadata ? 'date_taken' OR
        metadata ? 'original_date'
      );
    
    CREATE INDEX IF NOT EXISTS idx_vehicle_images_taken_at ON vehicle_images(taken_at) WHERE taken_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_vehicle_images_timeline_event ON vehicle_images(timeline_event_id) WHERE timeline_event_id IS NOT NULL;
    
    COMMENT ON COLUMN vehicle_images.taken_at IS 'EXIF date/time when photo was taken (for temporal value calculations)';
    COMMENT ON COLUMN vehicle_images.timeline_event_id IS 'Link image to specific timeline event';
  END IF;
END $$;

-- =====================================================
-- 5. BUSINESS_OWNERSHIP - Link to organizations table
-- =====================================================

DO $$
BEGIN
  -- Check if business_ownership references businesses but tier system needs organizations
  -- Create a view or mapping
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'business_ownership'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    -- Check if business_ownership.business_id references organizations or businesses
    -- For now, we'll assume businesses.id = organizations.id or create a mapping
    -- The tier system checks business_ownership, so we need to ensure it works
    
    -- Add organization_id if businesses and organizations are separate
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'business_ownership' AND column_name = 'organization_id'
    ) THEN
      -- Check if businesses table has a corresponding organizations entry
      -- For simplicity, assume business_id can be used as organization_id if they're the same
      -- If not, we'd need a mapping table (out of scope for now)
      ALTER TABLE business_ownership
        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
      
      -- Try to backfill organization_id from businesses if they're linked
      -- This assumes businesses.id might match organizations.id or there's a relationship
      -- If not, leave NULL and handle in application logic
    END IF;
  END IF;
END $$;

-- =====================================================
-- 6. ORGANIZATIONS - Ensure is_verified column exists
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
    
    CREATE INDEX IF NOT EXISTS idx_organizations_verified ON organizations(is_verified) WHERE is_verified = TRUE;
    
    COMMENT ON COLUMN organizations.is_verified IS 'Whether this organization has been verified for builder verification tier calculations';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'businesses'
  ) THEN
    -- If organizations doesn't exist but businesses does, create organizations view or add is_verified to businesses
    ALTER TABLE businesses
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
    
    CREATE INDEX IF NOT EXISTS idx_businesses_verified ON businesses(is_verified) WHERE is_verified = TRUE;
    
    -- Create organizations as view/alias of businesses if needed
    CREATE OR REPLACE VIEW organizations AS
    SELECT 
      id,
      name,
      is_verified,
      created_at,
      updated_at
    FROM businesses;
  END IF;
END $$;

-- =====================================================
-- 7. EXTERNAL_IDENTITIES - Ensure user_id column exists
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'external_identities'
  ) THEN
    -- Check if user_id exists (might be claimed_by_user_id)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'external_identities' AND column_name = 'user_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'external_identities' AND column_name = 'claimed_by_user_id'
    ) THEN
      -- Add user_id as alias/view column or computed column
      ALTER TABLE external_identities
        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
      
      -- Backfill from claimed_by_user_id
      UPDATE external_identities
      SET user_id = claimed_by_user_id
      WHERE user_id IS NULL AND claimed_by_user_id IS NOT NULL;
      
      -- Create trigger to keep them in sync
      CREATE OR REPLACE FUNCTION sync_external_identity_user_id()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.user_id IS NULL AND NEW.claimed_by_user_id IS NOT NULL THEN
          NEW.user_id := NEW.claimed_by_user_id;
        ELSIF NEW.claimed_by_user_id IS NULL AND NEW.user_id IS NOT NULL THEN
          NEW.claimed_by_user_id := NEW.user_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      DROP TRIGGER IF EXISTS sync_external_identity_user_id_trigger ON external_identities;
      CREATE TRIGGER sync_external_identity_user_id_trigger
        BEFORE INSERT OR UPDATE ON external_identities
        FOR EACH ROW
        EXECUTE FUNCTION sync_external_identity_user_id();
      
      CREATE INDEX IF NOT EXISTS idx_external_identities_user_id ON external_identities(user_id) WHERE user_id IS NOT NULL;
    END IF;
  END IF;
END $$;

-- =====================================================
-- 8. VEHICLE_QUALITY_SCORES - Ensure it exists with overall_score
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'vehicle_quality_scores'
  ) THEN
    -- Ensure overall_score column exists
    ALTER TABLE vehicle_quality_scores
      ADD COLUMN IF NOT EXISTS overall_score INTEGER DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 100);
    
    CREATE INDEX IF NOT EXISTS idx_vehicle_quality_scores_overall ON vehicle_quality_scores(overall_score);
  END IF;
END $$;

-- =====================================================
-- 9. PROFILES - Ensure username exists
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS username TEXT;
    
    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique ON profiles(username) WHERE username IS NOT NULL;
  END IF;
END $$;

-- =====================================================
-- 10. CREATE MISSING INDEXES FOR PERFORMANCE
-- =====================================================

-- Indexes for tier calculation queries

-- Vehicle images by user and date
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_created ON vehicle_images(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_created ON vehicle_images(vehicle_id, created_at);

-- Timeline events by user and date
CREATE INDEX IF NOT EXISTS idx_timeline_events_user_created ON vehicle_timeline_events(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_timeline_events_vehicle_date ON vehicle_timeline_events(vehicle_id, event_date);

-- Receipts by user and date
CREATE INDEX IF NOT EXISTS idx_receipts_user_created ON receipts(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_vehicle_date ON receipts(vehicle_id, receipt_date) WHERE vehicle_id IS NOT NULL;

-- Vehicles by user
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id) WHERE user_id IS NOT NULL;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE vehicle_receipts IS 'View of receipts filtered to vehicle-related receipts for tier calculations';
COMMENT ON COLUMN receipts.timeline_event_id IS 'Link receipt to specific timeline event for documentation quality scoring';
COMMENT ON COLUMN receipts.part_number IS 'Part number extracted from receipt (for material quality scoring)';
COMMENT ON COLUMN image_tags.vehicle_id IS 'Direct vehicle reference for faster tier calculation queries';
COMMENT ON COLUMN vehicle_images.taken_at IS 'EXIF date/time for temporal value calculations';
COMMENT ON COLUMN vehicle_timeline_events.event_date IS 'Date of event (DATE type) for build recency calculations';

