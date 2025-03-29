-- Seed data for local development

-- Ensure the test user exists in auth.users
-- This might require specific roles or disabling RLS temporarily in some setups.
-- For local dev, direct insert often works.
INSERT INTO auth.users (id, email, role, aud, raw_app_meta_data, raw_user_meta_data, instance_id, confirmation_token)
VALUES (
    'b72f868c-6be7-4084-93a9-79ac7e7e9ade',
    'skylar@nukemannerheim.com',
    'authenticated', -- Default role
    'authenticated', -- Default audience
    '{"provider":"email","providers":["email"]}', -- Basic meta data
    '{}',
    '00000000-0000-0000-0000-000000000000', -- Default instance ID for local dev
    'dummy_token' -- Workaround for GoTrue v2.170.0 NULL scan error
    -- Let Supabase handle confirmed_at
)
ON CONFLICT (id) DO NOTHING;

-- Ensure the test user profile exists
INSERT INTO public.profiles (id, username)
VALUES ('b72f868c-6be7-4084-93a9-79ac7e7e9ade', 'skylar_local')
ON CONFLICT (id) DO NOTHING;

-- Add any other necessary seed data below
