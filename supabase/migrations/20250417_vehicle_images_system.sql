-- Advanced Vehicle Image System for Nuke
-- Supports timeline-based image aggregation with attribution and evaluation capabilities

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

-- Function to process captures into vehicle_images
CREATE OR REPLACE FUNCTION public.process_captures_to_vehicle_images()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  capture_record RECORD;
  vehicle_record RECORD;
  image_url TEXT;
  image_array JSONB;
BEGIN
  -- Get each capture that hasn't been processed to vehicle_images
  FOR capture_record IN 
    SELECT c.id AS capture_id, c.user_id, c.images, c.meta,
           e.vehicle_id, c.url AS capture_url
    FROM public.captures c
    JOIN public.vehicle_timeline_events e ON c.id = e.capture_id
    WHERE e.vehicle_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_images vi 
      WHERE vi.capture_id = c.id
    )
  LOOP
    -- Check if we got valid image array
    IF capture_record.images IS NOT NULL AND jsonb_array_length(capture_record.images) > 0 THEN
      image_array := capture_record.images;
      
      -- Extract information about the vehicle
      SELECT make, model, year INTO vehicle_record
      FROM public.vehicles
      WHERE id = capture_record.vehicle_id;
      
      -- Add each image to the vehicle_images table
      FOR i IN 0..jsonb_array_length(image_array) - 1 LOOP
        image_url := image_array->>i;
        
        -- Skip if empty or invalid URL
        IF image_url IS NOT NULL AND image_url != '' THEN
          INSERT INTO public.vehicle_images (
            vehicle_id,
            url,
            user_id,
            capture_id,
            metadata,
            description,
            image_type,
            moderation_status
          ) VALUES (
            capture_record.vehicle_id,
            image_url,
            capture_record.user_id,
            capture_record.capture_id,
            jsonb_build_object(
              'source', capture_record.meta->>'source_site',
              'source_url', capture_record.capture_url,
              'capture_date', now(),
              'vehicle_info', jsonb_build_object(
                'make', vehicle_record.make,
                'model', vehicle_record.model,
                'year', vehicle_record.year
              )
            ),
            -- Auto-generate basic description
            CASE 
              WHEN vehicle_record.make IS NOT NULL AND vehicle_record.model IS NOT NULL 
              THEN 'Image of ' || vehicle_record.year || ' ' || vehicle_record.make || ' ' || vehicle_record.model
              ELSE 'Vehicle image from capture'
            END,
            -- Guess image type (can be refined by AI later)
            CASE 
              WHEN i = 0 THEN 'exterior_primary'
              ELSE 'exterior'
            END,
            'pending'
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- Function to update the primary image for a vehicle
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

-- Create a view for easy access to vehicle images with their metadata
CREATE OR REPLACE VIEW public.vehicle_images_view AS
SELECT 
  vi.id,
  vi.vehicle_id,
  v.make,
  v.model,
  v.year,
  vi.url,
  vi.user_id,
  u.email as user_email,
  vi.capture_id,
  vi.uploaded_at,
  vi.description,
  vi.ai_description,
  vi.quality_score,
  vi.authenticity_score,
  vi.relevance_score,
  vi.image_type,
  vi.is_primary,
  vi.moderation_status
FROM 
  public.vehicle_images vi
JOIN 
  public.vehicles v ON vi.vehicle_id = v.id
LEFT JOIN 
  auth.users u ON vi.user_id = u.id;

-- Ensure our existing capture processing also adds images  
DROP TRIGGER IF EXISTS image_process_trigger ON public.vehicle_timeline_events;

CREATE TRIGGER image_process_trigger
AFTER INSERT ON public.vehicle_timeline_events
FOR EACH ROW
WHEN (NEW.event_type = 'capture_processed')
EXECUTE FUNCTION public.process_captures_to_vehicle_images();

-- Grant permissions
GRANT ALL ON TABLE public.vehicle_images TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_images_view TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_captures_to_vehicle_images() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_primary_vehicle_image(UUID, UUID) TO authenticated, service_role;

-- Process any existing captures
SELECT public.process_captures_to_vehicle_images();
