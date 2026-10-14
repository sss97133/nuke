-- The live get_service_role_key_for_cron() as read from production on 2026-10-14 05:41Z (pg_get_functiondef, body
-- byte for byte; migration 20261014054500_cron_key_from_vault.sql checks its sha256). For the contract test only.
-- It returns the key that pg_cron jobs send to edge functions; the value lives in the database, never here.
CREATE OR REPLACE FUNCTION public.get_service_role_key_for_cron()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_key TEXT;
BEGIN
  -- Try to get from secrets table first (most reliable)
  SELECT value INTO v_key
  FROM public._app_secrets
  WHERE key = 'service_role_key'
  LIMIT 1;
  
  -- If found and valid, return it
  IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
    RETURN v_key;
  END IF;
  
  -- Fallback: try database setting
  BEGIN
    v_key := current_setting('app.settings.service_role_key', true);
    IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Continue to next fallback
  END;
  
  -- Fallback: try alternate setting name
  BEGIN
    v_key := current_setting('app.service_role_key', true);
    IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Continue
  END;
  
  -- If still not found, return NULL (cron jobs will handle this with COALESCE)
  RETURN NULL;
END;
$function$;
