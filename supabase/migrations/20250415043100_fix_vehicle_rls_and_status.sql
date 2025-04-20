-- Migration: Fix Vehicle RLS policies for user_id/owner_id separation and set ownership_status default

BEGIN;

-- 1. Ensure ownership_status column has a default value of 'unclaimed'
ALTER TABLE public.vehicles
ALTER COLUMN ownership_status SET DEFAULT 'unclaimed';

-- Update existing NULL statuses to 'unclaimed' for safety
UPDATE public.vehicles
SET ownership_status = 'unclaimed'
WHERE ownership_status IS NULL;

-- 2. Fix INSERT policy: Check user_id instead of owner_id
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;
CREATE POLICY "Users can insert their own vehicles" 
  ON public.vehicles 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = user_id); -- Check the user_id being inserted

-- 3. Fix SELECT policy: Allow access based on user_id + unclaimed OR owner_id + verified
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles" 
  ON public.vehicles 
  FOR SELECT 
  TO authenticated 
  USING (
    (ownership_status = 'unclaimed' AND user_id = auth.uid()) OR
    (ownership_status = 'verified' AND owner_id = auth.uid()) -- Assuming 'verified' is the status for owned vehicles
    -- Add other statuses/roles as needed, e.g., allowing admins to see all
  );

-- 4. Fix UPDATE policy: Use the same logic for USING and WITH CHECK
DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;
CREATE POLICY "Users can update their own vehicles" 
  ON public.vehicles 
  FOR UPDATE 
  TO authenticated 
  USING (
    (ownership_status = 'unclaimed' AND user_id = auth.uid()) OR
    (ownership_status = 'verified' AND owner_id = auth.uid())
  ) 
  WITH CHECK (
    (ownership_status = 'unclaimed' AND user_id = auth.uid()) OR
    (ownership_status = 'verified' AND owner_id = auth.uid())
  );

-- 5. Fix DELETE policy: Use the same logic for USING
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;
CREATE POLICY "Users can delete their own vehicles" 
  ON public.vehicles 
  FOR DELETE 
  TO authenticated 
  USING (
    (ownership_status = 'unclaimed' AND user_id = auth.uid()) OR
    (ownership_status = 'verified' AND owner_id = auth.uid())
  );

COMMIT;
