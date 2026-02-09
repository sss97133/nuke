-- Fix new user sign-up failures: username unique constraint violations.
-- handle_new_user used email local part (e.g. "john") which can duplicate across users.
-- Ensure we always assign a unique username so the profiles INSERT never fails.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- Keep function, replace with version that guarantees unique username

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
  v_candidate TEXT := COALESCE(
    NEW.raw_user_meta_data->>'preferred_username',
    NEW.raw_user_meta_data->>'user_name',
    CASE WHEN v_email IS NOT NULL THEN split_part(v_email, '@', 1) ELSE NULL END
  );
  v_username TEXT;
BEGIN
  -- Guarantee unique username: use candidate if available and not taken, else uuid-based
  IF v_candidate IS NOT NULL AND trim(v_candidate) != '' THEN
    v_username := trim(v_candidate);
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username AND id <> NEW.id) THEN
      v_username := trim(v_candidate) || '_' || substr(replace(NEW.id::text, '-', ''), 1, 8);
    END IF;
  ELSE
    v_username := 'u' || replace(NEW.id::text, '-', '');
  END IF;

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
