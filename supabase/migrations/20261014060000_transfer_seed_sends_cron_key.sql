-- The auction-close transfer seeders send the key from get_service_role_key_for_cron(), not the legacy JWT.
--
-- auto_create_transfer_on_auction_close() (AFTER UPDATE trigger on auction_events) and
-- backfill_transfers_for_sold_auctions() call transfer-automator with a key they read themselves:
-- public._app_secrets 'service_role_key' (the legacy service_role JWT), then two settings. In the 24 hours to
-- 2026-10-14 05:50Z the trigger made 189 calls that answered 200, every one carrying that legacy HS256 token. The
-- legacy API keys were disabled and the legacy JWT secret revoked at 05:28Z; once transfer-automator runs the
-- writeGuard that asks the platform about HS256 tokens, those calls are refused.
--
-- Both now take the key from get_service_role_key_for_cron(): after 20261014054500_cron_key_from_vault.sql that is the
-- Vault secret supabase_service_role_key (the cron secret key) first, then the same secrets table and settings, so a
-- database without the Vault secret behaves as before. Only the line that reads the key changes; both stay owner-run.
-- Live definitions before this change: supabase/sql/helpers/transfer_seed_callers_live_20261014.sql.
-- Contract: supabase/sql/test_transfer_seed_cron_key.sql.

set lock_timeout = '5s';
set statement_timeout = '30s';

-- The bodies this file was reviewed against (sha256 of prosrc, base64, read 2026-10-14 05:52Z), or this file's own
-- bodies when it is applied a second time.
DO $guard$
DECLARE a text; b text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a
    FROM pg_proc WHERE oid = 'public.auto_create_transfer_on_auction_close()'::regprocedure;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO b
    FROM pg_proc WHERE oid = 'public.backfill_transfers_for_sold_auctions(integer)'::regprocedure;
  IF a NOT IN ('yEw4Jxt97zRegAdNip624w86gpmGvRUUrrX9LjTDm+o=', 'xx9sL3M0hh+gkwlXg4rpPN8Sf1ittCMQvJWPsZQqejo=') THEN
    RAISE EXCEPTION 'auto_create_transfer_on_auction_close differs from the reviewed definition (%)', a;
  END IF;
  IF b NOT IN ('lMTRHYKzm6WNkhgnfPpRw1hD5l7M/S9W7XRYVALbl/o=', 'IXwNlOFbjgAN6BR8KLKMRTmMAjKdFfdkup6bvlDC5hY=') THEN
    RAISE EXCEPTION 'backfill_transfers_for_sold_auctions differs from the reviewed definition (%)', b;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.auto_create_transfer_on_auction_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- A transaction that set app.seed_transfers to 'off' (create_missing_bat_auction_events, p_fire_transfers false)
  -- seeds no transfer. Unset or any other value: the call below, as before.
  IF current_setting('app.seed_transfers', true) = 'off' THEN
    RETURN NEW;
  END IF;
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN
    RETURN NEW;
  END IF;
  IF OLD.outcome = 'sold' THEN
    RETURN NEW;
  END IF;

  -- The cron secret key from Vault first, then the secrets table and settings (get_service_role_key_for_cron).
  v_key := public.get_service_role_key_for_cron();

  v_url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator';

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_key, '')
      ),
      body := jsonb_build_object(
        'action', 'seed_from_auction',
        'auction_event_id', NEW.id::text
      ),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[auto_create_transfer] pg_net call failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_transfers_for_sold_auctions(batch_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE v_row record; v_key text; v_url text := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator'; v_count integer := 0; BEGIN v_key := public.get_service_role_key_for_cron(); FOR v_row IN SELECT ae.id, ae.vehicle_id FROM public.auction_events ae WHERE ae.outcome = 'sold' AND NOT EXISTS (SELECT 1 FROM public.ownership_transfers ot WHERE ot.trigger_id = ae.id AND ot.trigger_table = 'auction_events') ORDER BY ae.auction_end_date DESC LIMIT batch_size LOOP BEGIN PERFORM net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || COALESCE(v_key, '')), body := jsonb_build_object('action', 'seed_from_auction', 'auction_event_id', v_row.id::text, 'suppress_notifications', true), timeout_milliseconds := 30000); v_count := v_count + 1; EXCEPTION WHEN OTHERS THEN RAISE WARNING '[backfill_transfers] pg_net call failed for %: %', v_row.id, SQLERRM; END; END LOOP; RETURN jsonb_build_object('queued', v_count, 'ran_at', NOW(), 'suppress_notifications', true); END; $function$;

COMMENT ON FUNCTION public.auto_create_transfer_on_auction_close() IS
  'AFTER UPDATE on auction_events: a lot that becomes sold asks transfer-automator to seed its ownership transfer. Sends the key from get_service_role_key_for_cron() (the Vault cron secret key first, 2026-10-14).';
