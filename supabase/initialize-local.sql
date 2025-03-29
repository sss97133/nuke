-- Comprehensive Supabase local initialization script
-- This fixes auth schema and user configuration properly

-- 1. Ensure the auth schema is correctly configured
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;

-- 2. Ensure the correct roles exist with proper permissions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT;
  END IF;
END
$$;

-- 3. Ensure proper permissions are set for public schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- 4. Fix auth.users table if it exists but has issues
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    -- Delete any problematic user records
    DELETE FROM auth.users WHERE email = 'skylar@nukemannerheim.com';
    
    -- Reset all sequences to make new insertions clean
    PERFORM setval(pg_get_serial_sequence('auth.users', 'id'), 1, false);
  END IF;
END
$$;

-- 5. Create a test user with proper credentials
INSERT INTO auth.users (
  instance_id, 
  id, 
  aud, 
  role, 
  email, 
  encrypted_password, 
  email_confirmed_at, 
  raw_app_meta_data, 
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  confirmation_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',  -- instance_id
  uuid_generate_v4(),                       -- id (generate a new UUID)
  'authenticated',                          -- aud
  'authenticated',                          -- role
  'skylar@nukemannerheim.com',              -- email
  -- Encrypted password for 'password123'
  '$2a$10$pBPrRzB4h/qAHbpAqTxMI.lS8EJw5lZZ5YbOgIhYbVDQeQNXQJ7hK',
  NOW(),                                    -- email_confirmed_at (now)
  '{"provider": "email", "providers": ["email"]}', -- raw_app_meta_data
  '{}',                                     -- raw_user_meta_data  
  false,                                    -- is_sso_user
  false,                                    -- is_anonymous
  NULL                                      -- confirmation_token (NULL as we're confirming it)
) ON CONFLICT (id) DO NOTHING;

-- 6. Create a profiles record for the test user
DO $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id FROM auth.users WHERE email = 'skylar@nukemannerheim.com';
  
  IF user_id IS NOT NULL THEN
    -- Create a profile if it doesn't exist
    INSERT INTO public.profiles (
      id, 
      username, 
      user_type, 
      reputation_score, 
      created_at, 
      updated_at, 
      social_links, 
      streaming_links, 
      home_location, 
      onboarding_completed, 
      onboarding_step,
      skills
    ) VALUES (
      user_id,
      'skylar_local',
      'viewer',
      0,
      NOW(),
      NOW(),
      '{}',
      '{}',
      '{"lat": 40.7128, "lng": -74.0060}',
      false,
      0,
      '{}'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
