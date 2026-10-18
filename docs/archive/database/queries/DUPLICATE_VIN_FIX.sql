-- DUPLICATE VIN ISSUE FIX
-- This addresses the specific VIN constraint violation preventing vehicle saves
-- Execute this in Supabase SQL Editor

-- ============================================================================
-- STEP 1: Investigate the Duplicate VIN Issue
-- ============================================================================

-- Check if the VIN already exists in the database
SELECT 
    id,
    user_id,
    make,
    model,
    year,
    vin,
    created_at,
    updated_at
FROM public.vehicles 
WHERE vin = '40837S108672';

-- Check how many vehicles have this VIN
SELECT COUNT(*) as duplicate_count
FROM public.vehicles 
WHERE vin = '40837S108672';

-- ============================================================================
-- STEP 2: Handle the Duplicate VIN (Choose ONE option below)
-- ============================================================================

-- OPTION A: Remove the duplicate VIN to allow the new save
-- (Use this if the existing record is a test/duplicate entry)
-- DELETE FROM public.vehicles WHERE vin = '40837S108672';

-- OPTION B: Update the existing vehicle instead of creating new one
-- (Use this if you want to update the existing record)
-- UPDATE public.vehicles 
-- SET 
--     user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4',
--     make = 'CHEVROLET',
--     model = 'C10', 
--     year = 1964,
--     updated_at = NOW()
-- WHERE vin = '40837S108672';

-- OPTION C: Make VIN constraint less restrictive (allow duplicates)
-- (Use this if multiple people should be able to have same VIN)
-- ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_vin_key;

-- ============================================================================
-- STEP 3: Improve Frontend VIN Handling (Recommended)
-- ============================================================================

-- Create a function to handle VIN conflicts gracefully
CREATE OR REPLACE FUNCTION public.handle_vehicle_with_vin(
    p_user_id UUID,
    p_make TEXT,
    p_model TEXT,
    p_year INTEGER,
    p_vin TEXT,
    p_color TEXT DEFAULT NULL,
    p_mileage INTEGER DEFAULT NULL,
    p_fuel_type TEXT DEFAULT NULL,
    p_transmission TEXT DEFAULT NULL,
    p_engine_size TEXT DEFAULT NULL,
    p_drivetrain TEXT DEFAULT NULL,
    p_body_style TEXT DEFAULT NULL,
    p_doors INTEGER DEFAULT NULL,
    p_seats INTEGER DEFAULT NULL,
    p_msrp DECIMAL DEFAULT NULL,
    p_current_value DECIMAL DEFAULT NULL,
    p_purchase_price DECIMAL DEFAULT NULL,
    p_purchase_date DATE DEFAULT NULL,
    p_purchase_location TEXT DEFAULT NULL,
    p_is_public BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    vehicle_id UUID,
    action_taken TEXT,
    message TEXT
) AS $$
DECLARE
    existing_vehicle_id UUID;
    existing_user_id UUID;
    new_vehicle_id UUID;
BEGIN
    -- Check if VIN already exists
    SELECT id, user_id INTO existing_vehicle_id, existing_user_id
    FROM public.vehicles 
    WHERE vin = p_vin;
    
    IF existing_vehicle_id IS NOT NULL THEN
        -- VIN already exists
        IF existing_user_id = p_user_id THEN
            -- Same user owns it, update the existing record
            UPDATE public.vehicles 
            SET 
                make = p_make,
                model = p_model,
                year = p_year,
                color = COALESCE(p_color, color),
                mileage = COALESCE(p_mileage, mileage),
                fuel_type = COALESCE(p_fuel_type, fuel_type),
                transmission = COALESCE(p_transmission, transmission),
                engine_size = COALESCE(p_engine_size, engine_size),
                drivetrain = COALESCE(p_drivetrain, drivetrain),
                body_style = COALESCE(p_body_style, body_style),
                doors = COALESCE(p_doors, doors),
                seats = COALESCE(p_seats, seats),
                msrp = COALESCE(p_msrp, msrp),
                current_value = COALESCE(p_current_value, current_value),
                purchase_price = COALESCE(p_purchase_price, purchase_price),
                purchase_date = COALESCE(p_purchase_date, purchase_date),
                purchase_location = COALESCE(p_purchase_location, purchase_location),
                is_public = p_is_public,
                updated_at = NOW()
            WHERE id = existing_vehicle_id;
            
            RETURN QUERY SELECT existing_vehicle_id, 'updated'::TEXT, 'Updated your existing vehicle with this VIN'::TEXT;
        ELSE
            -- Different user owns it, create without VIN
            INSERT INTO public.vehicles (
                user_id, make, model, year, vin, color, mileage, fuel_type,
                transmission, engine_size, drivetrain, body_style, doors, seats,
                msrp, current_value, purchase_price, purchase_date, purchase_location, is_public
            ) VALUES (
                p_user_id, p_make, p_model, p_year, NULL, p_color, p_mileage, p_fuel_type,
                p_transmission, p_engine_size, p_drivetrain, p_body_style, p_doors, p_seats,
                p_msrp, p_current_value, p_purchase_price, p_purchase_date, p_purchase_location, p_is_public
            ) RETURNING id INTO new_vehicle_id;
            
            RETURN QUERY SELECT new_vehicle_id, 'created_without_vin'::TEXT, 'Created vehicle without VIN (VIN already exists for another user)'::TEXT;
        END IF;
    ELSE
        -- VIN doesn't exist, create normally
        INSERT INTO public.vehicles (
            user_id, make, model, year, vin, color, mileage, fuel_type,
            transmission, engine_size, drivetrain, body_style, doors, seats,
            msrp, current_value, purchase_price, purchase_date, purchase_location, is_public
        ) VALUES (
            p_user_id, p_make, p_model, p_year, p_vin, p_color, p_mileage, p_fuel_type,
            p_transmission, p_engine_size, p_drivetrain, p_body_style, p_doors, p_seats,
            p_msrp, p_current_value, p_purchase_price, p_purchase_date, p_purchase_location, p_is_public
        ) RETURNING id INTO new_vehicle_id;
        
        RETURN QUERY SELECT new_vehicle_id, 'created'::TEXT, 'Vehicle created successfully'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.handle_vehicle_with_vin TO authenticated;

-- ============================================================================
-- STEP 4: Test the Function
-- ============================================================================

-- Test the function with the problematic VIN
SELECT * FROM public.handle_vehicle_with_vin(
    '0b9f107a-d124-49de-9ded-94698f63c1c4'::UUID,
    'CHEVROLET',
    'C10',
    1964,
    '40837S108672',
    NULL, -- color
    NULL, -- mileage
    NULL, -- fuel_type
    NULL, -- transmission
    NULL, -- engine_size
    NULL, -- drivetrain
    NULL, -- body_style
    NULL, -- doors
    NULL, -- seats
    NULL, -- msrp
    NULL, -- current_value
    NULL, -- purchase_price
    NULL, -- purchase_date
    NULL, -- purchase_location
    TRUE  -- is_public
);

-- ============================================================================
-- COMPLETION
-- ============================================================================
SELECT 'VIN conflict handling system installed. Check function result above.' as status;
