-- Manually create profile for the test user
INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
VALUES (
    'f8175a33-6d2d-4b64-9480-db03e046fa64',
    'test@example.com',
    'Test User',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    updated_at = NOW();

-- Verify it was created
SELECT id, email, full_name FROM profiles;
