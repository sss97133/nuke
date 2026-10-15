-- Seed an ownership transfer only for a recent sale, not for every historical lot a backfill lands.
--
-- trg_auto_create_transfer_on_auction_close (AFTER INSERT OR UPDATE OF outcome ON auction_events) asks
-- transfer-automator to seed an in_progress transfer, with milestones and deadlines, for every row that becomes sold.
-- Backfills land years-old sales: on 2026-10-15 the Mecum index walk, the BaT backlog loader and the Bonhams undated
-- walk created 71,435 ownership_transfers and 71,793 transfer_milestones since 03:00Z (5,739 in the 13:00Z hour),
-- each insert also running persist_vehicle_grade synchronously (trg_regrade_on_transfer). About 33,000 s of database
-- time, on rows that describe transfers completed long ago as "in progress".
--
-- Change: skip when the auction has no end date or ended more than 30 days ago. Live sales (BaT, Mecum, C&B, PCar
-- closing now) are unchanged. app.seed_transfers='off' still works. CREATE OR REPLACE FUNCTION only: no table lock.
-- Existing historical transfers are left as they are (the transfer system's owner decides how to close them).
-- Revert: re-create the function without the v_end block (body in 20261014060000_transfer_seed_sends_cron_key.sql).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

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
  IF TG_OP = 'UPDATE' AND OLD.outcome = 'sold' THEN
    RETURN NEW;
  END IF;
  -- Historical lots (no end date, or ended over 30 days ago) are backfill, not a transfer in progress.
  IF NEW.auction_end_date IS NULL OR NEW.auction_end_date < now() - interval '30 days' THEN
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

DO $$
BEGIN
  IF pg_get_functiondef('public.auto_create_transfer_on_auction_close'::regproc) NOT ILIKE '%interval ''30 days''%' THEN
    RAISE EXCEPTION 'auto_create_transfer_on_auction_close was not replaced';
  END IF;
END $$;
