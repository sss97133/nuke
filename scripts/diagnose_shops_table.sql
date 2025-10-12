-- Diagnose shops table issues

-- Check if shops table exists and its structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'shops'
ORDER BY ordinal_position;

-- Check constraints
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'shops'::regclass;

-- Try to fix the ID column if needed
ALTER TABLE shops 
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Add missing columns with proper defaults
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS org_type TEXT DEFAULT 'shop',
ADD COLUMN IF NOT EXISTS legal_entity_name TEXT,
ADD COLUMN IF NOT EXISTS dba_name TEXT,
ADD COLUMN IF NOT EXISTS ein TEXT,
ALTER COLUMN business_type SET DEFAULT 'LLC';

-- Show final structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'shops'
ORDER BY ordinal_position;
