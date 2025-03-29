-- Create auth schema and required extensions for Supabase
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- Create essential extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- Create auth.users table required by the seed.sql
CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text UNIQUE,
    role text,
    aud text,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    instance_id uuid,
    confirmation_token text,
    confirmed_at timestamp with time zone
);
