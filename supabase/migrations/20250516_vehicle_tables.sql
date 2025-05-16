-- Create the vehicle_timeline table that was missing
CREATE TABLE IF NOT EXISTS public.vehicle_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on the timeline table
ALTER TABLE public.vehicle_timeline ENABLE ROW LEVEL SECURITY;

-- Create policy for vehicle_timeline table
CREATE POLICY "Users can view timeline for their vehicles" 
ON vehicle_timeline FOR SELECT 
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_timeline.vehicle_id 
    AND vehicles.user_id = auth.uid()
  )
);

CREATE POLICY "Users can add timeline entries for their vehicles" 
ON vehicle_timeline FOR INSERT 
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_timeline.vehicle_id 
    AND vehicles.user_id = auth.uid()
  )
);

-- Create a function to add import event to timeline
CREATE OR REPLACE FUNCTION public.add_vehicle_import_event(
  vehicle_id UUID,
  import_source TEXT,
  import_data JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  timeline_id UUID;
BEGIN
  -- Validate the vehicle belongs to the user
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicles
    WHERE id = vehicle_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Vehicle does not belong to authenticated user';
  END IF;
  
  -- Create timeline entry
  INSERT INTO public.vehicle_timeline (
    vehicle_id,
    event_type,
    event_date,
    data
  ) VALUES (
    vehicle_id,
    'import',
    NOW(),
    jsonb_build_object(
      'source', import_source,
      'data', import_data,
      'imported_by', auth.uid()
    )
  ) RETURNING id INTO timeline_id;
  
  RETURN timeline_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.add_vehicle_import_event TO authenticated;
