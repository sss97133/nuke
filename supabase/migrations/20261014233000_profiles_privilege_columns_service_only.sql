-- A signed-in account can no longer make itself an admin: profiles.user_type and role may be set or changed only by
-- the service role (or the table owner / admin maintenance roles). A BEFORE trigger enforces it.
--
-- Live on 2026-10-14, is_admin_or_moderator(), is_global_admin(), is_shop_admin() and assert_admin() read
-- profiles.user_type / role; authenticated held column UPDATE and INSERT on both, the four own-row profile policies
-- cap no columns, and no trigger guarded them. So any signed-in account (anonymous sign-in is on, so "signed in" is
-- effectively public) could update its own profile to user_type 'admin' or role 'admin' and pass those checks —
-- gaining profiles_admin_update over every profile, secure_documents read/update, and eight admin-only RPCs
-- (merge_duplicate_vehicles, unmerge_vehicle, approve/reject_pending_assignment, add_dynamic_vehicle_field,
-- set_primary_document, admin_image_radar, generate_invite_code). Today 1 of 19 profiles holds an admin value.
--
-- Fix: a BEFORE INSERT OR UPDATE trigger (preferred over revoking and re-granting profiles' 55 columns, which would
-- need a re-grant for every future column). It raises 42501 when user_type or role is set to a non-default value on
-- insert, or changed on update, unless the caller is the service role, postgres or supabase_admin. Every other
-- profile column stays writable by the owner. No web or iOS code sets user_type or role (verified 2026-10-14:
-- updateProfile upserts only edit fields; the verification flows set id_verification_status / verification_level,
-- never these), so nothing legitimate breaks; admins are still made by the service role. This does NOT change who is
-- admin — the one existing admin row is untouched (the trigger only blocks CHANGES).
-- Contract: supabase/sql/test_profiles_privilege_columns_service_only.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

-- The INSERT check compares against the live defaults; if a default changes, re-review this trigger.
DO $guard$
DECLARE v_ut text; v_role text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_ut FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.profiles'::regclass AND a.attname='user_type';
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_role FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.profiles'::regclass AND a.attname='role';
  IF v_ut IS DISTINCT FROM '''user''::user_type' OR v_role IS DISTINCT FROM '''user''::text' THEN
    RAISE EXCEPTION 'profiles.user_type/role defaults changed (% / %); re-review the privilege guard', v_ut, v_role;
  END IF;
END $guard$;

-- SECURITY INVOKER (the default) is required: the guard reads current_user to identify the caller, and a
-- SECURITY DEFINER function would see its own owner (postgres) instead and never block anyone.
CREATE OR REPLACE FUNCTION public.guard_profile_privilege_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The service role, the table owner and admin maintenance roles may set or change these; nobody else may.
  -- current_user is the real caller here (INVOKER): 'authenticated'/'anon' for the web, 'service_role' for the
  -- service key, 'postgres'/'supabase_admin' for migrations and the console. A service-key JWT also reads as
  -- auth.role() = 'service_role'. A direct admin connection carries no JWT (auth.role() NULL), hence current_user.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR coalesce((SELECT auth.role()), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_type IS DISTINCT FROM 'user'::public.user_type OR NEW.role IS DISTINCT FROM 'user' THEN
      RAISE EXCEPTION 'profiles.user_type and role are set by the service role only' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_type IS DISTINCT FROM OLD.user_type OR NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'profiles.user_type and role are changed by the service role only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_profile_privilege_columns ON public.profiles;
CREATE TRIGGER trg_guard_profile_privilege_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privilege_columns();

COMMIT;
