-- Simple check of public.profiles table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'profiles'
ORDER BY ordinal_position;

-- Check if profiles table has any records
SELECT COUNT(*) as profile_count FROM public.profiles;

-- Check if there's a trigger to create profiles on user signup
SELECT 
    tgname as trigger_name,
    proname as function_name
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid = 'public.profiles'::regclass;

-- Create or replace the function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, email, created_at, updated_at)
    VALUES (
        new.id, 
        new.email,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        updated_at = now();
    
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if the trigger exists, if not create it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'on_auth_user_created' 
        AND tgrelid = 'auth.users'::regclass
    ) THEN
        -- This might fail due to permissions, but worth trying
        BEGIN
            CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW
            EXECUTE FUNCTION public.handle_new_user();
            RAISE NOTICE 'Trigger created successfully';
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Could not create trigger on auth.users: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'Trigger already exists';
    END IF;
END $$;

-- Create a test profile directly (this should work)
INSERT INTO public.profiles (id, email, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'test_' || extract(epoch from now())::text || '@example.com',
    now(),
    now()
)
ON CONFLICT (id) DO NOTHING
RETURNING id, email;
