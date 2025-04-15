-- Add all missing columns needed by the vehicle form
ALTER TABLE public.vehicles
ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS added TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN IF NOT EXISTS ownership_status TEXT DEFAULT 'owned',
ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS year INTEGER,
ADD COLUMN IF NOT EXISTS make TEXT,
ADD COLUMN IF NOT EXISTS model TEXT,
ADD COLUMN IF NOT EXISTS trim TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS vin TEXT,
ADD COLUMN IF NOT EXISTS license_plate TEXT,
ADD COLUMN IF NOT EXISTS mileage INTEGER,
ADD COLUMN IF NOT EXISTS purchase_price DECIMAL,
ADD COLUMN IF NOT EXISTS purchase_location TEXT,
ADD COLUMN IF NOT EXISTS condition TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Ensure the vehicles table has proper RLS policies for security
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Allow users to select their own vehicles
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles"
  ON public.vehicles
  FOR SELECT
  USING (owner_id = auth.uid());
  
-- Allow users to insert their own vehicles
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;
CREATE POLICY "Users can insert their own vehicles"
  ON public.vehicles
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());
  
-- Allow users to update their own vehicles
DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;
CREATE POLICY "Users can update their own vehicles"
  ON public.vehicles
  FOR UPDATE
  USING (owner_id = auth.uid());
  
-- Allow users to delete their own vehicles
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;
CREATE POLICY "Users can delete their own vehicles"
  ON public.vehicles
  FOR DELETE
  USING (owner_id = auth.uid());
  
-- Create an index on owner_id for faster lookups
CREATE INDEX IF NOT EXISTS vehicles_owner_id_idx ON public.vehicles (owner_id);

-- Create trigger to automatically set the owner_id to the current user on insert
CREATE OR REPLACE FUNCTION public.set_vehicle_owner()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if auth.uid() is available
  IF auth.uid() IS NOT NULL THEN
    NEW.owner_id = auth.uid();
  ELSE
    -- Log the issue and use a default value or raise an exception
    -- We choose to raise an exception as it's safer for production
    -- If logging is desired, a separate logging table (e.g., auth_errors) would need to be created.
    RAISE EXCEPTION 'Authentication required to add vehicles. auth.uid() was null.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_vehicle_owner_trigger ON public.vehicles;
CREATE TRIGGER set_vehicle_owner_trigger
  BEFORE INSERT ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_vehicle_owner();

-- Create index on owner_id for performance
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles(owner_id);