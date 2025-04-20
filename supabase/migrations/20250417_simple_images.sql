-- Simple Vehicle Images System for Nuke
-- Creates a dedicated table for vehicle images with attribution and evaluation

-- Create a dedicated vehicle_images table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  capture_id UUID REFERENCES public.captures(id),
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  
  -- Metadata for image evaluation
  metadata JSONB DEFAULT '{}'::jsonb,
  description TEXT,
  ai_description TEXT,
  
  -- Evaluation metrics
  quality_score INT,
  authenticity_score INT,
  relevance_score INT,
  
  -- Content classification
  image_type TEXT, -- e.g., 'exterior', 'interior', 'engine', 'damage', 'document'
  is_primary BOOLEAN DEFAULT false,
  
  -- Moderation
  moderation_status TEXT DEFAULT 'pending',
  moderated_by UUID REFERENCES auth.users(id),
  moderated_at TIMESTAMPTZ
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON public.vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_id ON public.vehicle_images(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_uploaded_at ON public.vehicle_images(uploaded_at);

-- Add RLS policies
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;

-- Everyone can view approved images
CREATE POLICY "Anyone can view approved vehicle images" 
ON public.vehicle_images FOR SELECT 
USING (moderation_status = 'approved' OR moderation_status = 'pending');

-- Users can upload their own images
CREATE POLICY "Users can upload their own vehicle images" 
ON public.vehicle_images FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own images
CREATE POLICY "Users can update their own vehicle images" 
ON public.vehicle_images FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

-- Function to set the primary image for a vehicle
CREATE OR REPLACE FUNCTION public.set_primary_vehicle_image(p_vehicle_id UUID, p_image_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- First, unset any existing primary images
  UPDATE public.vehicle_images
  SET is_primary = false
  WHERE vehicle_id = p_vehicle_id AND is_primary = true;
  
  -- Set the new primary image
  UPDATE public.vehicle_images
  SET is_primary = true
  WHERE id = p_image_id AND vehicle_id = p_vehicle_id;
  
  RETURN FOUND;
END;
$$;

-- Grant permissions
GRANT ALL ON TABLE public.vehicle_images TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_primary_vehicle_image(UUID, UUID) TO authenticated, service_role;
