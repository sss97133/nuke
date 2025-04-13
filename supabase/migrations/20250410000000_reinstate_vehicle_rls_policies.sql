-- Migration: Reinstate standard RLS policies for the vehicles table

-- First, check if the vehicles table exists at all and create it if needed
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
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

-- Ensure owner_id column exists before applying policies that depend on it
-- Do this as a separate statement to ensure it completes before policies
DO $$
BEGIN
  -- Add the owner_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'vehicles' 
    AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE public.vehicles
    ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- Create index on owner_id for performance if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles(owner_id);

-- Enable Row Level Security on the vehicles table
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert vehicles for themselves
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;
CREATE POLICY "Users can insert their own vehicles" 
  ON public.vehicles 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (auth.uid() = owner_id);

-- Allow authenticated users to view their own vehicles
DROP POLICY IF EXISTS "Users can view their own vehicles" ON public.vehicles;
CREATE POLICY "Users can view their own vehicles" 
  ON public.vehicles 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = owner_id);

-- Allow authenticated users to update their own vehicles
DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;
CREATE POLICY "Users can update their own vehicles" 
  ON public.vehicles 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = owner_id) 
  WITH CHECK (auth.uid() = owner_id);

-- Allow authenticated users to delete their own vehicles
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;
CREATE POLICY "Users can delete their own vehicles" 
  ON public.vehicles 
  FOR DELETE 
  TO authenticated 
  USING (auth.uid() = owner_id); 