-- Check if auth.users table exists and has proper structure
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'auth' 
    AND table_name = 'users'
) as auth_users_exists;

-- Check for any errors in auth schema
SELECT 
    schemaname,
    tablename,
    tableowner,
    hasindexes,
    hasrules,
    hastriggers
FROM pg_tables 
WHERE schemaname = 'auth'
ORDER BY tablename;

-- Check if profiles table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles'
) as profiles_table_exists;

-- Check the trigger that creates profiles on user signup
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth' 
AND event_object_table = 'users';

-- Check if there are any broken foreign key constraints
SELECT
    tc.constraint_name, 
    tc.table_schema, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_schema IN ('auth', 'public');

-- Try to manually create a test user (if this fails, we know where the problem is)
-- First, check if we can insert into auth.users directly
-- DO $$
-- BEGIN
--     INSERT INTO auth.users (
--         id,
--         email,
--         encrypted_password,
--         email_confirmed_at,
--         created_at,
--         updated_at
--     ) VALUES (
--         gen_random_uuid(),
--         'manual_test_' || extract(epoch from now())::text || '@example.com',
--         crypt('TestPassword123!', gen_salt('bf')),
--         now(),
--         now(),
--         now()
--     );
--     RAISE NOTICE 'Test user created successfully';
-- EXCEPTION
--     WHEN OTHERS THEN
--         RAISE NOTICE 'Error creating test user: %', SQLERRM;
-- END $$;
