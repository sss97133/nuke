-- Direct fix for missing profiles
-- This will create profiles for any auth.users that don't have one

-- Create profiles for existing users
INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
SELECT 
    au.id,
    au.email,
    COALESCE(
        au.raw_user_meta_data->>'full_name', 
        au.raw_user_meta_data->>'name',
        split_part(au.email, '@', 1),
        'User'
    ) as full_name,
    au.created_at,
    NOW()
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Check the result
SELECT 
    'Users:' as table_name,
    COUNT(*) as count
FROM auth.users
UNION ALL
SELECT 
    'Profiles:' as table_name,
    COUNT(*) as count
FROM public.profiles;
