-- Check what values exist in the user_type enum
SELECT 
    t.typname AS enum_name,
    e.enumlabel AS enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname = 'user_type'
ORDER BY e.enumsortorder;

-- Also check if the enum exists at all
SELECT 
    typname,
    typtype
FROM pg_type 
WHERE typname = 'user_type'; 