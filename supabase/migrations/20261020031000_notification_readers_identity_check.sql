-- Notification readers answer only for the caller (P3.7 pattern, as mark_notification_read already does).
-- get_unread_notification_count ran as owner with no identity check, so any signed-in account could read another
-- account's unread count. get_recent_notifications had the same hole and also selected three columns
-- user_notifications does not have (related_user_id, is_responded, priority), so it always failed; it now reads
-- from_user_id as related_user_id and returns is_responded and priority as unknown (null), keeping its signature.
-- Only end-user JWTs are judged; service_role and JWT-less sessions are exempt, as in the P3.7 writers.
-- Contract: supabase/sql/test_notification_readers_identity_check.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_unread_notification_count: you can only count your own notifications' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM public.user_notifications
  WHERE user_id = p_user_id
    AND is_read = false;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_recent_notifications(p_user_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, type text, title text, message text, vehicle_id uuid, organization_id uuid, related_user_id uuid,
   is_read boolean, is_responded boolean, priority integer, created_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_recent_notifications: you can only read your own notifications' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN QUERY
  SELECT un.id, un.type, un.title, un.message, un.vehicle_id, un.organization_id, un.from_user_id,
    un.is_read, NULL::boolean, NULL::integer, un.created_at, un.metadata
  FROM public.user_notifications un
  WHERE un.user_id = p_user_id
  ORDER BY un.is_read ASC, un.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$function$;

COMMENT ON FUNCTION public.get_unread_notification_count(uuid) IS 'Unread user_notifications for the caller only (end-user JWTs must pass their own id); service role exempt.';
COMMENT ON FUNCTION public.get_recent_notifications(uuid, integer) IS 'The caller''s recent user_notifications, unread first then newest, at most 100. related_user_id is from_user_id; is_responded and priority are not recorded (null).';
NOTIFY pgrst, 'reload schema';
COMMIT;
