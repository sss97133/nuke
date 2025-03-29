-- Fix for auth schema issues

-- Ensure auth schema exists and has correct extensions
CREATE SCHEMA IF NOT EXISTS auth;

-- Make sure auth.users table has correct structure
-- If missing, create it with required columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    CREATE TABLE auth.users (
      instance_id UUID,
      id UUID PRIMARY KEY,
      aud VARCHAR(255),
      role VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      encrypted_password VARCHAR(255),
      email_confirmed_at TIMESTAMP WITH TIME ZONE,
      invited_at TIMESTAMP WITH TIME ZONE,
      confirmation_token VARCHAR(255),
      confirmation_sent_at TIMESTAMP WITH TIME ZONE,
      recovery_token VARCHAR(255),
      recovery_sent_at TIMESTAMP WITH TIME ZONE,
      email_change_token VARCHAR(255),
      email_change VARCHAR(255),
      email_change_sent_at TIMESTAMP WITH TIME ZONE,
      last_sign_in_at TIMESTAMP WITH TIME ZONE,
      raw_app_meta_data JSONB,
      raw_user_meta_data JSONB,
      is_super_admin BOOLEAN,
      created_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE,
      phone VARCHAR(255) UNIQUE DEFAULT NULL,
      phone_confirmed_at TIMESTAMP WITH TIME ZONE,
      phone_change VARCHAR(255) DEFAULT '',
      phone_change_token VARCHAR(255) DEFAULT '',
      phone_change_sent_at TIMESTAMP WITH TIME ZONE,
      confirmed_at TIMESTAMP WITH TIME ZONE,
      email_change_confirm_status SMALLINT DEFAULT 0,
      banned_until TIMESTAMP WITH TIME ZONE,
      reauthentication_token VARCHAR(255) DEFAULT '',
      reauthentication_sent_at TIMESTAMP WITH TIME ZONE,
      is_sso_user BOOLEAN DEFAULT FALSE,
      is_anonymous BOOLEAN DEFAULT FALSE
    );
  END IF;
END $$;

-- Clean up the user we're working with to prevent conflicts
DELETE FROM auth.users WHERE email = 'skylar@nukemannerheim.com';

-- Create a test user with proper credentials
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
  confirmation_token,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',  -- instance_id
  gen_random_uuid(),                        -- id (generate a new UUID)
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
  NULL,                                     -- confirmation_token (NULL as we're confirming it)
  NOW(),                                    -- created_at
  NOW()                                     -- updated_at
);

-- Ensure profiles table is properly linked to users
DO $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id FROM auth.users WHERE email = 'skylar@nukemannerheim.com';
  
  IF user_id IS NOT NULL THEN
    -- Delete any existing profile to avoid conflicts
    DELETE FROM public.profiles WHERE id = user_id;
    
    -- Create a new profile
    INSERT INTO public.profiles (
      id,
      username, 
      created_at,
      updated_at,
      user_type,
      reputation_score,
      social_links,
      streaming_links,
      home_location,
      onboarding_completed,
      onboarding_step,
      skills
    ) VALUES (
      user_id,
      'skylar_test',
      NOW(),
      NOW(),
      'viewer',
      0,
      '{}',
      '{}',
      '{"lat": 40.7128, "lng": -74.0060}',
      false,
      0,
      '{}'
    );
  END IF;
END $$;
