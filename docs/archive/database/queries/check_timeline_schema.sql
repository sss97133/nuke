-- Check the actual schema of timeline_events table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    ordinal_position
FROM information_schema.columns 
WHERE table_name = 'timeline_events' 
ORDER BY ordinal_position;
