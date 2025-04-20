-- Fix for Capture to Vehicle Migration Process
-- This migration ensures captures are properly migrated to vehicles

-- First, check if trigger exists and remove it to reapply correctly
DROP TRIGGER IF EXISTS capture_added_trigger ON public.captures;
DROP FUNCTION IF EXISTS process_capture_trigger;

-- Create improved trigger function with better error handling
CREATE OR REPLACE FUNCTION process_capture_trigger()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Log the trigger execution for debugging
    RAISE NOTICE 'Processing capture %', NEW.id;
    
    -- Call the process function but handle any errors
    BEGIN
        PERFORM process_captures_to_vehicles();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Error processing vehicle capture: %', SQLERRM;
        -- Still return NEW to allow the insert even if processing fails
    END;
    
    RETURN NEW;
END;
$$;

-- Create the trigger with immediate execution
CREATE TRIGGER capture_added_trigger
AFTER INSERT ON public.captures
FOR EACH ROW
EXECUTE FUNCTION process_capture_trigger();

-- Ensure the process_captures_to_vehicles function logs more info
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
    capture_count INTEGER;
BEGIN
    -- First log how many unprocessed captures we have
    SELECT COUNT(*) INTO capture_count
    FROM public.captures 
    WHERE id NOT IN (
        SELECT COALESCE(capture_id, '00000000-0000-0000-0000-000000000000') 
        FROM public.vehicle_timeline_events 
        WHERE event_type = 'capture_processed'
        AND capture_id IS NOT NULL
    );
    
    RAISE NOTICE 'Processing % unprocessed captures', capture_count;
    
    -- Process each unprocessed capture
    FOR capture_record IN 
        SELECT id, meta, images, user_id, url, captured_at
        FROM public.captures 
        WHERE id NOT IN (
            SELECT COALESCE(capture_id, '00000000-0000-0000-0000-000000000000') 
            FROM public.vehicle_timeline_events 
            WHERE event_type = 'capture_processed'
            AND capture_id IS NOT NULL
        )
        ORDER BY captured_at
    LOOP
        RAISE NOTICE 'Processing capture: %', capture_record.id;
        
        -- Extract normalized data from meta field
        meta_data := capture_record.meta;
        extract_vin := meta_data->>'vin';
        extract_make := meta_data->>'make';
        extract_model := meta_data->>'model';
        extract_year := meta_data->>'year';
        
        RAISE NOTICE 'Extracted data: make=%, model=%, year=%', extract_make, extract_model, extract_year;
        
        -- Handle year conversion carefully
        IF extract_year IS NOT NULL AND extract_year != '' THEN
            BEGIN
                extract_year_int := safe_cast(extract_year, 0);
                IF extract_year_int = 0 THEN
                    extract_year_int := NULL;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                extract_year_int := NULL;
                RAISE NOTICE 'Error converting year: %', SQLERRM;
            END;
        ELSE
            extract_year_int := NULL;
        END IF;
        
        image_urls := capture_record.images;
        new_vehicle := TRUE;
        
        -- Try to find existing vehicle by VIN first (most reliable match)
        IF extract_vin IS NOT NULL AND extract_vin != '' THEN
            SELECT id INTO vehicle_id FROM public.vehicles WHERE vin = extract_vin;
            
            IF FOUND THEN
                RAISE NOTICE 'Found existing vehicle by VIN: %', vehicle_id;
                
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
                RAISE NOTICE 'Found existing vehicle by make/model/year: %', vehicle_id;
                
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
            RAISE NOTICE 'Creating new vehicle with make=%, model=%', extract_make, extract_model;
            
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
                    ELSE 'Vehicle from ' || COALESCE(meta_data->>'source_site', 'unknown source')
                  END
                )
            )
            RETURNING id INTO vehicle_id;
            
            RAISE NOTICE 'Created new vehicle with ID: %', vehicle_id;
        END IF;
        
        -- Add to vehicle timeline (building the vehicle history)
        IF vehicle_id IS NOT NULL THEN
            RAISE NOTICE 'Adding timeline event for vehicle: %', vehicle_id;
            
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
                COALESCE(meta_data->>'source_site', 'extension capture'),
                jsonb_build_object(
                    'url', capture_record.url,
                    'source', meta_data->>'source_site',
                    'captured_data', meta_data,
                    'images', image_urls
                ),
                capture_record.id,
                capture_record.user_id
            );
            
            RAISE NOTICE 'Timeline event added for capture: %', capture_record.id;
        ELSE
            RAISE WARNING 'Failed to process capture: % - no vehicle ID generated', capture_record.id;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Capture processing complete';
END;
$$;

-- Run the function once to process existing captures
SELECT process_captures_to_vehicles();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.process_captures_to_vehicles() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_capture_trigger() TO anon, authenticated, service_role;
