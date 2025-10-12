-- Insert 1971 Chevrolet C10 directly into database
-- Run this SQL script to add the vehicle that's been failing to save from the frontend

BEGIN;

-- Insert the vehicle
INSERT INTO vehicles (
    id,
    user_id,
    make,
    model,
    year,
    mileage,
    color,
    body_style,
    condition_rating,
    notes,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    '0b9f107a-d124-49de-9ded-94698f63c1c4',
    'chevrolet',
    'c10',
    1971,
    NULL, -- Mileage not provided
    NULL, -- Color not provided
    'pickup', -- Body style for C10
    NULL, -- Condition rating not provided
    'Added via direct SQL insert - 1971 Chevrolet C10 pickup truck',
    NOW(),
    NOW()
);

-- Verify the insert
SELECT 
    id,
    make,
    model,
    year,
    user_id,
    created_at
FROM vehicles 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4' 
    AND make = 'chevrolet' 
    AND model = 'c10' 
    AND year = 1971;

-- Check if achievements were awarded
SELECT 
    achievement_type,
    achievement_title,
    points_awarded,
    earned_at
FROM profile_achievements 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

-- Check profile stats
SELECT 
    total_vehicles,
    updated_at
FROM profile_stats 
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4';

COMMIT;
