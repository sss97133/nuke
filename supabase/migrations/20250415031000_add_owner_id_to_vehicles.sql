-- Add owner_id column to vehicles table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_attribute 
    WHERE attrelid = 'public.vehicles'::regclass 
    AND attname = 'owner_id'
  ) THEN
    ALTER TABLE public.vehicles ADD COLUMN owner_id UUID DEFAULT auth.uid();
  END IF;
END
$$;

-- Update the policy for vehicles
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles"
  ON public.vehicles
  FOR SELECT
  USING (owner_id = auth.uid());
