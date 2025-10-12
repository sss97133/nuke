-- Align existing shops table with shops_core.sql expectations

-- Add missing owner_user_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'shops' AND column_name = 'owner_user_id') THEN
    ALTER TABLE shops ADD COLUMN owner_user_id UUID;
    
    -- If created_by exists, copy it to owner_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'shops' AND column_name = 'created_by') THEN
      UPDATE shops SET owner_user_id = created_by WHERE created_by IS NOT NULL;
    END IF;
    
    -- Add foreign key constraint
    ALTER TABLE shops ADD CONSTRAINT shops_owner_user_id_fkey 
      FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add other missing columns that shops_core.sql expects
ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;

-- Ensure email, phone, website_url exist (may have different names)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Rename columns if they exist with different names
DO $$
BEGIN
  -- Rename website to website_url if it exists and website_url doesn't
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'shops' AND column_name = 'website')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name = 'shops' AND column_name = 'website_url') THEN
    ALTER TABLE shops RENAME COLUMN website TO website_url;
  END IF;
END $$;

-- Ensure location columns match shops_core.sql naming
ALTER TABLE shops ADD COLUMN IF NOT EXISTS location_city TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS location_state TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS location_country TEXT;

-- Copy data from existing city/state/country columns if they exist
UPDATE shops SET location_city = city WHERE location_city IS NULL AND city IS NOT NULL;
UPDATE shops SET location_state = state WHERE location_state IS NULL AND state IS NOT NULL;
UPDATE shops SET location_country = country WHERE location_country IS NULL AND country IS NOT NULL;

-- Ensure updated_at has proper default
ALTER TABLE shops ALTER COLUMN updated_at SET DEFAULT NOW();

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops(slug);

COMMENT ON COLUMN shops.owner_user_id IS 'Primary owner/creator of the shop - used by shops_core.sql';
COMMENT ON COLUMN shops.created_by IS 'Legacy column - shop creator, may be same as owner_user_id';
