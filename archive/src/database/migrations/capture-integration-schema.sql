-- Capture Integration Schema Migrations
-- This file contains SQL migrations needed to support the Chrome extension capture integration

-- Update captured_vehicles table to track processing status
ALTER TABLE IF EXISTS public.captured_vehicles 
ADD COLUMN IF NOT EXISTS processed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id);

-- Add columns to vehicles table to better track capture source data
ALTER TABLE IF EXISTS public.vehicles
ADD COLUMN IF NOT EXISTS capture_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_capture_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_capture_source text,
ADD COLUMN IF NOT EXISTS original_capture_id uuid REFERENCES public.captured_vehicles(id);

-- Create or replace a function that will be used by our database trigger
CREATE OR REPLACE FUNCTION public.process_new_capture()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle_id uuid;
  v_current_time timestamp with time zone := now();
BEGIN
  -- Check if a vehicle with this VIN already exists
  SELECT id INTO v_vehicle_id FROM public.vehicles WHERE vin = NEW.vin LIMIT 1;
  
  IF v_vehicle_id IS NOT NULL THEN
    -- Update existing vehicle with capture information
    UPDATE public.vehicles SET
      updated_at = v_current_time,
      capture_count = COALESCE(capture_count, 0) + 1,
      last_capture_date = v_current_time,
      last_capture_source = NEW.source
    WHERE id = v_vehicle_id;
    
    -- Update the capture record to mark it as processed
    UPDATE public.captured_vehicles SET
      processed = true,
      processed_at = v_current_time,
      vehicle_id = v_vehicle_id
    WHERE id = NEW.id;
    
    -- Create a timeline event for this capture
    INSERT INTO public.vehicle_timeline_events (
      id,
      vehicle_id,
      event_type,
      source,
      event_date,
      title,
      description,
      confidence_score,
      metadata,
      source_url,
      image_urls,
      created_at,
      updated_at
    ) VALUES (
      uuid_generate_v4(),
      v_vehicle_id,
      'capture',
      COALESCE(NEW.source, 'chrome_extension'),
      COALESCE(NEW.created_at, v_current_time),
      'Vehicle Spotted',
      CONCAT(NEW.year, ' ', NEW.make, ' ', NEW.model, ' spotted on ', COALESCE(NEW.source, 'unknown source')),
      85,
      jsonb_build_object(
        'capture_id', NEW.id,
        'capture_url', NEW.capture_url,
        'price', NEW.price
      ),
      NEW.capture_url,
      CASE WHEN NEW.image_url IS NOT NULL THEN array[NEW.image_url] ELSE array[]::text[] END,
      v_current_time,
      v_current_time
    );
    
  ELSE
    -- Create a new vehicle entry
    INSERT INTO public.vehicles (
      id,
      make,
      model,
      year,
      vin,
      color,
      trim,
      image_url,
      user_id,
      capture_count,
      last_capture_date,
      last_capture_source,
      original_capture_id,
      created_at,
      updated_at,
      status
    ) VALUES (
      uuid_generate_v4(),
      NEW.make,
      NEW.model,
      NEW.year,
      NEW.vin,
      NEW.color,
      NEW.trim,
      NEW.image_url,
      COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'), -- Anonymous user if none provided
      1,
      v_current_time,
      COALESCE(NEW.source, 'chrome_extension'),
      NEW.id,
      v_current_time,
      v_current_time,
      'unverified'
    )
    RETURNING id INTO v_vehicle_id;
    
    -- Update the capture record to mark it as processed
    UPDATE public.captured_vehicles SET
      processed = true,
      processed_at = v_current_time,
      vehicle_id = v_vehicle_id
    WHERE id = NEW.id;
    
    -- Create initial timeline events
    -- 1. Create a manufacture event
    INSERT INTO public.vehicle_timeline_events (
      id,
      vehicle_id,
      event_type,
      source,
      event_date,
      title,
      description,
      confidence_score,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      uuid_generate_v4(),
      v_vehicle_id,
      'manufacture',
      'vehicle_record',
      make_date(NEW.year, 1, 1),
      'Vehicle Manufactured',
      CONCAT(NEW.year, ' ', NEW.make, ' ', NEW.model, ' manufactured'),
      75,
      jsonb_build_object(
        'year', NEW.year,
        'make', NEW.make,
        'model', NEW.model,
        'vin', NEW.vin
      ),
      v_current_time,
      v_current_time
    );
    
    -- 2. Create a capture event
    INSERT INTO public.vehicle_timeline_events (
      id,
      vehicle_id,
      event_type,
      source,
      event_date,
      title,
      description,
      confidence_score,
      metadata,
      source_url,
      image_urls,
      created_at,
      updated_at
    ) VALUES (
      uuid_generate_v4(),
      v_vehicle_id,
      'capture',
      COALESCE(NEW.source, 'chrome_extension'),
      COALESCE(NEW.created_at, v_current_time),
      'Vehicle Added to Nuke Platform',
      CONCAT('First sighting of ', NEW.year, ' ', NEW.make, ' ', NEW.model, ' from ', COALESCE(NEW.source, 'chrome extension')),
      90,
      jsonb_build_object(
        'capture_id', NEW.id,
        'capture_url', NEW.capture_url,
        'price', NEW.price
      ),
      NEW.capture_url,
      CASE WHEN NEW.image_url IS NOT NULL THEN array[NEW.image_url] ELSE array[]::text[] END,
      v_current_time,
      v_current_time
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_new_capture ON public.captured_vehicles;

-- Create a trigger that fires when a new capture is inserted
CREATE TRIGGER on_new_capture
AFTER INSERT ON public.captured_vehicles
FOR EACH ROW EXECUTE FUNCTION public.process_new_capture();
