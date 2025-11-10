-- Fix frontend query mismatches with database schema

-- 1. Add FK constraint so PostgREST can resolve profiles:uploaded_by relationship
ALTER TABLE vehicles 
DROP CONSTRAINT IF EXISTS fk_vehicles_uploaded_by;

DO $$
BEGIN
  BEGIN
    ALTER TABLE vehicles 
      ADD CONSTRAINT fk_vehicles_uploaded_by 
      FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Skipping fk_vehicles_uploaded_by: %', SQLERRM;
  END;
END $$;

-- 2. Add missing GPS columns to vehicle_images (or we can just rename in frontend)
-- Option A: Add aliases (database keeps latitude/longitude, add gps_* as computed columns)
-- Option B: Just fix the frontend to use correct names (PREFERRED)

-- For now, let's add the FK constraint and let frontend fixes handle column names

-- 3. Verify profiles table has username and full_name columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'username') THEN
    ALTER TABLE profiles ADD COLUMN username TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique ON profiles(username) WHERE username IS NOT NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'full_name') THEN
    ALTER TABLE profiles ADD COLUMN full_name TEXT;
  END IF;
END $$;

-- 4. Add user_id FK if not exists (for vehicles)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                 WHERE constraint_name = 'fk_vehicles_user_id') THEN
    BEGIN
      ALTER TABLE vehicles 
        ADD CONSTRAINT fk_vehicles_user_id 
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping fk_vehicles_user_id: %', SQLERRM;
    END;
  END IF;
END $$;

-- 5. Add owner_id FK if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                 WHERE constraint_name = 'fk_vehicles_owner_id') THEN
    BEGIN
      ALTER TABLE vehicles 
        ADD CONSTRAINT fk_vehicles_owner_id 
        FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping fk_vehicles_owner_id: %', SQLERRM;
    END;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_vehicles_uploaded_by ON vehicles IS 
'Allows PostgREST to resolve profiles:uploaded_by relationship queries from frontend';

