-- Nuke Vehicle Integration System: Final Version
-- Captures → Vehicles Integration supporting Nuke's vehicle-centric architecture

-- First, add necessary columns if they don't exist
DO $$
BEGIN
  -- Add capture_id to vehicle_timeline_events
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'vehicle_timeline_events'
    AND column_name = 'capture_id'
  ) THEN
    ALTER TABLE public.vehicle_timeline_events
    ADD COLUMN capture_id UUID;
  END IF;
  
  -- Add metadata column to vehicles if needed
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'vehicles'
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.vehicles
    ADD COLUMN metadata JSONB;
  END IF;
  
  -- Add last_spotted_date to vehicles if needed
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'vehicles'
    AND column_name = 'last_spotted_date'
  ) THEN
    ALTER TABLE public.vehicles
    ADD COLUMN last_spotted_date TIMESTAMPTZ;
  END IF;
END $$;

-- Function for safe type casting
CREATE OR REPLACE FUNCTION safe_cast(p_in text, p_default anyelement)
RETURNS anyelement AS
$$
BEGIN
    BEGIN
        RETURN CAST(p_in AS pg_typeof(p_default));
    EXCEPTION WHEN OTHERS THEN
        RETURN p_default;
    END;
END;
$$
LANGUAGE plpgsql IMMUTABLE;

-- Main function to process captures into the vehicle-centric database
CREATE OR REPLACE FUNCTION public.process_captures_to_vehicles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    capture_record RECORD;
    vehicle_id UUID;
    meta_data JSONB;
    extract_vin TEXT;
    extract_make TEXT;
    extract_model TEXT;
    extract_year TEXT;
    extract_year_int INTEGER;
    image_urls JSONB;
    vehicle_status TEXT := 'available';
    new_vehicle BOOLEAN;
BEGIN
    -- Process each unprocessed capture
    FOR capture_record IN 
        SELECT id, meta, images, user_id, url
        FROM public.captures 
        WHERE id NOT IN (
            SELECT COALESCE(capture_id, '00000000-0000-0000-0000-000000000000') 
            FROM public.vehicle_timeline_events 
            WHERE event_type = 'capture_processed'
            AND capture_id IS NOT NULL
        )
        ORDER BY captured_at
    LOOP
        -- Extract normalized data from meta field
        meta_data := capture_record.meta;
        extract_vin := meta_data->>'vin';
        extract_make := meta_data->>'make';
        extract_model := meta_data->>'model';
        extract_year := meta_data->>'year';
        
        -- Handle year conversion carefully
        IF extract_year IS NOT NULL AND extract_year != '' THEN
            extract_year_int := safe_cast(extract_year, 0);
            IF extract_year_int = 0 THEN
                extract_year_int := NULL;
            END IF;
        ELSE
            extract_year_int := NULL;
        END IF;
        
        image_urls := capture_record.images;
        new_vehicle := TRUE;
        
        -- Try to find existing vehicle by VIN first (most reliable match)
        IF extract_vin IS NOT NULL AND extract_vin != '' THEN
            SELECT id INTO vehicle_id FROM public.vehicles WHERE vin = extract_vin;
            
            IF FOUND THEN
                -- Vehicle exists - update with new data (supporting persistent identity)
                UPDATE public.vehicles 
                SET 
                    updated_at = now(),
                    last_spotted_date = now(),
                    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                        'latest_capture', meta_data,
                        'latest_capture_url', capture_record.url
                    )
                WHERE id = vehicle_id;
                
                new_vehicle := FALSE;
            END IF;
        END IF;
        
        -- If no VIN match, try make+model+year
        IF new_vehicle AND extract_make IS NOT NULL AND extract_model IS NOT NULL AND extract_year_int IS NOT NULL THEN
            SELECT id INTO vehicle_id 
            FROM public.vehicles
            WHERE 
                make = extract_make AND
                model = extract_model AND
                year = extract_year_int
            LIMIT 1;
            
            IF FOUND THEN
                -- Vehicle exists - update with new data (supporting persistent identity)
                UPDATE public.vehicles 
                SET 
                    updated_at = now(),
                    vin = COALESCE(extract_vin, vin),
                    last_spotted_date = now(),
                    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                        'latest_capture', meta_data,
                        'latest_capture_url', capture_record.url
                    )
                WHERE id = vehicle_id;
                
                new_vehicle := FALSE;
            END IF;
        END IF;
        
        -- If no match found, create new vehicle (new digital identity)
        IF new_vehicle THEN
            INSERT INTO public.vehicles (
                make, model, year, vin, 
                status, created_at, updated_at,
                last_spotted_date, metadata,
                title
            ) VALUES (
                extract_make, 
                extract_model, 
                extract_year_int, 
                extract_vin,
                vehicle_status,
                now(),
                now(),
                now(),
                jsonb_build_object(
                    'source_url', capture_record.url,
                    'source_site', meta_data->>'source_site',
                    'extracted_data', meta_data,
                    'images', image_urls
                ),
                COALESCE(meta_data->>'title', 
                  CASE 
                    WHEN extract_year_int IS NOT NULL AND extract_make IS NOT NULL AND extract_model IS NOT NULL
                    THEN extract_year_int::text || ' ' || extract_make || ' ' || extract_model
                    ELSE 'Vehicle from ' || meta_data->>'source_site'
                  END
                )
            )
            RETURNING id INTO vehicle_id;
        END IF;
        
        -- Add to vehicle timeline (building the vehicle history)
        IF vehicle_id IS NOT NULL THEN
            INSERT INTO public.vehicle_timeline_events (
                vehicle_id,
                event_type,
                event_date,
                source,
                data,
                capture_id,
                user_id
            ) VALUES (
                vehicle_id,
                'capture_processed',
                now(),
                meta_data->>'source_site',
                jsonb_build_object(
                    'url', capture_record.url,
                    'source', meta_data->>'source_site',
                    'captured_data', meta_data,
                    'images', image_urls
                ),
                capture_record.id,
                capture_record.user_id
            );
        END IF;
    END LOOP;
END;
$$;

-- Create trigger to automatically process new captures
CREATE OR REPLACE FUNCTION process_capture_trigger()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM process_captures_to_vehicles();
    RETURN NEW;
END;
$$;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS capture_added_trigger ON public.captures;

-- Create the trigger
CREATE TRIGGER capture_added_trigger
AFTER INSERT ON public.captures
FOR EACH ROW
EXECUTE FUNCTION process_capture_trigger();

-- Give everyone access to execute the functions
GRANT EXECUTE ON FUNCTION public.process_captures_to_vehicles() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_capture_trigger() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_cast(text, anyelement) TO anon, authenticated, service_role;

-- Run the function once to process existing captures
SELECT process_captures_to_vehicles();
