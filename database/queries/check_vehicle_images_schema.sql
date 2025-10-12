-- Check the actual schema of vehicle_images table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'vehicle_images' 
ORDER BY ordinal_position;
