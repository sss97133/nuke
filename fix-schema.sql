-- Fix schema script for Nuke local development

-- Create vehicles table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  ownership_status TEXT,
  year TEXT,
  make TEXT,
  model TEXT,
  trim TEXT,
  vin TEXT,
  notes TEXT,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index on owner_id
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles(owner_id);

-- Enable RLS
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;
CREATE POLICY "Users can insert their own vehicles" 
  ON public.vehicles 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = owner_id);
  
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles" 
  ON public.vehicles 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = owner_id);
  
DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;
CREATE POLICY "Users can update their own vehicles" 
  ON public.vehicles 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
  
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;
CREATE POLICY "Users can delete their own vehicles" 
  ON public.vehicles 
  FOR DELETE 
  TO authenticated 
  USING (auth.uid() = owner_id);
