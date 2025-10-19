-- Hotfix for schema mismatches found during migration

-- 1. Add missing columns to receipts table
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS purchase_date DATE;

CREATE INDEX IF NOT EXISTS idx_receipts_vehicle_id ON receipts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_receipts_purchase_date ON receipts(purchase_date);

-- 2. Fix vehicles table owner column (if needed)
DO $$
BEGIN
  -- Check if owner_id exists, if not add it
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicles' AND column_name = 'owner_id') THEN
    ALTER TABLE vehicles ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    
    -- Copy user_id to owner_id if user_id exists
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'vehicles' AND column_name = 'user_id') THEN
      UPDATE vehicles SET owner_id = user_id WHERE owner_id IS NULL;
    END IF;
  END IF;
END $$;

-- 3. Fix work_sessions RLS policy (use correct column)
DROP POLICY IF EXISTS "Users can view work sessions for vehicles they have access to" ON work_sessions;
CREATE POLICY "Users can view work sessions for vehicles they have access to" 
ON work_sessions FOR SELECT 
USING (
  auth.uid() = user_id 
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = work_sessions.vehicle_id 
    AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
  )
);

-- 4. Fix vehicle_images RLS policies (handle both owner_id and user_id)
DROP POLICY IF EXISTS "Users can upload images to vehicles" ON vehicle_images;
CREATE POLICY "Users can upload images to vehicles" 
ON vehicle_images FOR INSERT 
WITH CHECK (
  auth.uid() = user_id
  AND (
    -- Vehicle owner (try both columns)
    EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_images.vehicle_id 
      AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
    )
    -- OR contributor
    OR EXISTS (
      SELECT 1 FROM vehicle_contributor_roles vcr
      WHERE vcr.vehicle_id = vehicle_images.vehicle_id
      AND vcr.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Users can update own images" ON vehicle_images;
CREATE POLICY "Users can update own images" 
ON vehicle_images FOR UPDATE 
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = vehicle_images.vehicle_id 
    AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can delete images" ON vehicle_images;
CREATE POLICY "Users can delete images" 
ON vehicle_images FOR DELETE 
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = vehicle_images.vehicle_id 
    AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
  )
);

-- 5. Ensure completion trigger is non-blocking (reapply in case it failed)
CREATE OR REPLACE FUNCTION update_vehicle_completion()
RETURNS TRIGGER AS $$
DECLARE
  completion_data JSONB;
BEGIN
  BEGIN
    completion_data := calculate_vehicle_completion_algorithmic(NEW.id);
    IF completion_data IS NOT NULL AND completion_data->>'completion_percentage' IS NOT NULL THEN
      NEW.completion_percentage := (completion_data->>'completion_percentage')::INTEGER;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to calculate completion for vehicle %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON MIGRATION IS 'Hotfix: Add missing columns, fix RLS policies with correct column names';

