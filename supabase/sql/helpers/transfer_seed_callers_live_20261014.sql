-- The live auction-close transfer seeders as read from production on 2026-10-14 05:52Z (pg_get_functiondef, bodies
-- byte for byte; migration 20261014060000_transfer_seed_sends_cron_key.sql checks their sha256). For the contract
-- test only. Both send the key from public._app_secrets / settings to transfer-automator.
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

  v_key := COALESCE(
    (SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true),
    current_setting('app.service_role_key', true)
  );

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
AS $function$ DECLARE v_row record; v_key text; v_url text := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator'; v_count integer := 0; BEGIN v_key := COALESCE((SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1), current_setting('app.settings.service_role_key', true), current_setting('app.service_role_key', true)); FOR v_row IN SELECT ae.id, ae.vehicle_id FROM public.auction_events ae WHERE ae.outcome = 'sold' AND NOT EXISTS (SELECT 1 FROM public.ownership_transfers ot WHERE ot.trigger_id = ae.id AND ot.trigger_table = 'auction_events') ORDER BY ae.auction_end_date DESC LIMIT batch_size LOOP BEGIN PERFORM net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || COALESCE(v_key, '')), body := jsonb_build_object('action', 'seed_from_auction', 'auction_event_id', v_row.id::text, 'suppress_notifications', true), timeout_milliseconds := 30000); v_count := v_count + 1; EXCEPTION WHEN OTHERS THEN RAISE WARNING '[backfill_transfers] pg_net call failed for %: %', v_row.id, SQLERRM; END; END LOOP; RETURN jsonb_build_object('queued', v_count, 'ran_at', NOW(), 'suppress_notifications', true); END; $function$;
