-- Fix "Database error saving new user" for phone sign-in and ensure triggers run with correct privileges.
-- 1. handle_new_user: support phone-only users (email NULL); use phone for full_name/username fallback; SECURITY DEFINER + search_path.
-- 2. update_profile_completion_trigger: SECURITY DEFINER + search_path so profile_completion insert always succeeds after profile create.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := NEW.email;
  v_phone TEXT := NEW.phone;
  v_full_name TEXT := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    v_phone,
    CASE WHEN v_email IS NOT NULL THEN split_part(v_email, '@', 1) ELSE NULL END,
    'User'
  );
  v_username TEXT := COALESCE(
    NEW.raw_user_meta_data->>'preferred_username',
    NEW.raw_user_meta_data->>'user_name',
    CASE WHEN v_email IS NOT NULL THEN split_part(v_email, '@', 1) ELSE NULL END,
    'u' || replace(NEW.id::text, '-', '')
  );
BEGIN
  INSERT INTO public.profiles (id, email, full_name, username, created_at, updated_at)
  VALUES (NEW.id, v_email, v_full_name, v_username, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    username = COALESCE(EXCLUDED.username, public.profiles.username),
    updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Ensure profile_completion trigger can insert (RLS may block otherwise when auth context is not yet the new user)
DROP TRIGGER IF EXISTS profile_completion_trigger ON public.profiles;

CREATE OR REPLACE FUNCTION public.update_profile_completion_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_completion (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.profile_completion SET
    basic_info_complete = (NEW.full_name IS NOT NULL AND NEW.full_name != ''),
    avatar_uploaded = (NEW.avatar_url IS NOT NULL AND NEW.avatar_url != ''),
    bio_added = (NEW.bio IS NOT NULL AND NEW.bio != ''),
    location_added = (NEW.location IS NOT NULL AND NEW.location != ''),
    social_links_added = (NEW.website_url IS NOT NULL OR NEW.github_url IS NOT NULL OR NEW.linkedin_url IS NOT NULL),
    last_updated = NOW()
  WHERE user_id = NEW.id;

  UPDATE public.profile_completion SET
    total_completion_percentage = calculate_profile_completion(NEW.id)
  WHERE user_id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profile_completion_trigger
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_profile_completion_trigger();
