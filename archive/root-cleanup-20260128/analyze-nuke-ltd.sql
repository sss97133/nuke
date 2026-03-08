-- Nuke Ltd Analysis Queries
-- Part 1: Find Nuke Ltd or related organizations

-- Find Nuke Ltd or related
SELECT * FROM businesses
WHERE business_name ILIKE '%nuke%'
   OR legal_name ILIKE '%nuke%';

-- Get full businesses table schema
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'businesses'
ORDER BY ordinal_position;
