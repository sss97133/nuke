-- Scheduled calls to edge functions send the cron secret key from Vault, not the legacy service_role JWT.
--
-- get_service_role_key_for_cron() supplies the Authorization header of every scheduled edge-function call: 16 active
-- pg_cron jobs (2026-10-14 05:40Z) and the SQL functions bat_live_pull_run, ingest_bat_live_events,
-- trigger_photo_pipeline_orchestrator, activate_retained_listing_property_intake, run_valuation_batch_by_quality,
-- run_valuation_batch_by_quality_fast, trigger_agent_execution and call_mecum_extraction_edge_function. It returned
-- public._app_secrets 'service_role_key', the legacy service_role JWT. The legacy API keys were disabled and the legacy
-- JWT secret revoked on 2026-10-14 at 05:28Z, so that key must stop being the credential cron depends on.
--
-- It now reads the Vault secret supabase_service_role_key first: the secret key named cron, written there by the key
-- switch at 05:22:06Z (the url_inbox, import_queue and live-auction triggers already read that name). For a secret key
-- on the Authorization header of a function call, the API gateway hands the function a short-lived JWT it mints
-- (request header sb-api-key-compatibility: minted, measured 05:38Z), which the deployed functions already accept.
-- The secrets table and the two settings stay, unchanged, as fallbacks for a database without the Vault secret.
--
-- Also: it runs as its owner, so its search_path is pinned, and EXECUTE stays with the owner and service_role only.
-- Live definition before this change: supabase/sql/helpers/get_service_role_key_for_cron_live_20261014.sql.
-- Contract: supabase/sql/test_get_service_role_key_for_cron.sql.

set lock_timeout = '5s';
set statement_timeout = '30s';

-- The body this file was reviewed against (sha256 of prosrc, base64, read 2026-10-14 05:41Z), or this file's own
-- body when it is applied a second time.
DO $guard$
DECLARE a text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a
    FROM pg_proc WHERE oid = 'public.get_service_role_key_for_cron()'::regprocedure;
  IF a NOT IN ('mOrTBhc9eUa8tc6lXjezA3qZPcWn+73TttIbegaGT48=', 'CnBNmrHigp25hxrXINCLq6IZs/5rbXc98HgAygvMYs8=') THEN
    RAISE EXCEPTION 'get_service_role_key_for_cron differs from the reviewed definition (%)', a;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_service_role_key_for_cron()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_key TEXT;
BEGIN
  -- The cron secret key, kept in Vault (2026-10-14 key switch)
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- No Vault here: continue to the fallbacks
  END;

  -- Fallback: the secrets table
  SELECT value INTO v_key
  FROM public._app_secrets
  WHERE key = 'service_role_key'
  LIMIT 1;

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

REVOKE ALL ON FUNCTION public.get_service_role_key_for_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_role_key_for_cron() TO service_role;

COMMENT ON FUNCTION public.get_service_role_key_for_cron() IS
  'The key pg_cron jobs and SQL callers send to edge functions: the Vault secret supabase_service_role_key (the cron secret key, 2026-10-14), else public._app_secrets service_role_key, else the settings app.settings.service_role_key and app.service_role_key. Owner and service_role only.';
