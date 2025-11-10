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
DROP POLICY IF EXISTS "select_work_sessions_by_org_or_self" ON work_sessions;
CREATE POLICY "select_work_sessions_by_org_or_self" 
ON work_sessions FOR SELECT 
USING (
  auth.uid() = user_id 
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = work_sessions.vehicle_id 
      AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM vehicle_user_permissions vup
    WHERE vup.vehicle_id = work_sessions.vehicle_id
      AND vup.user_id = auth.uid()
      AND COALESCE(vup.is_active, true) = true
      AND vup.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')
  )
);

-- 4. Fix vehicle_images RLS policies (handle both owner_id and user_id)
DROP POLICY IF EXISTS "Vehicle owners and contributors can insert images" ON vehicle_images;
CREATE POLICY "Vehicle owners and contributors can insert images" 
ON vehicle_images FOR INSERT 
WITH CHECK (
  auth.uid() = user_id
  AND (
    EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_images.vehicle_id 
        AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM vehicle_user_permissions vup
      WHERE vup.vehicle_id = vehicle_images.vehicle_id
        AND vup.user_id = auth.uid()
        AND COALESCE(vup.is_active, true) = true
        AND vup.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')
    )
  )
);

DROP POLICY IF EXISTS "Vehicle owners and contributors can update images" ON vehicle_images;
CREATE POLICY "Vehicle owners and contributors can update images" 
ON vehicle_images FOR UPDATE 
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = vehicle_images.vehicle_id 
      AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM vehicle_user_permissions vup
    WHERE vup.vehicle_id = vehicle_images.vehicle_id
      AND vup.user_id = auth.uid()
      AND COALESCE(vup.is_active, true) = true
      AND vup.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')
  )
);

DROP POLICY IF EXISTS "Vehicle owners and contributors can delete images" ON vehicle_images;
CREATE POLICY "Vehicle owners and contributors can delete images" 
ON vehicle_images FOR DELETE 
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM vehicles v 
    WHERE v.id = vehicle_images.vehicle_id 
      AND (v.owner_id = auth.uid() OR v.user_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM vehicle_user_permissions vup
    WHERE vup.vehicle_id = vehicle_images.vehicle_id
      AND vup.user_id = auth.uid()
      AND COALESCE(vup.is_active, true) = true
      AND vup.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')
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

