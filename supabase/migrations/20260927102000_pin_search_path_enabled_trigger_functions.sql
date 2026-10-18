-- Trigger functions must not hand an empty search_path to the triggers they fire.
-- Session cb179857, 2026-09-27.
--
-- MEASURED: after 20260927101000 fixed the first layer, sync-live-auctions' mirror still failed every chunk at 20:15Z with
-- 'relation "timeline_event_conflicts" does not exist' — the table exists in public; detect_timeline_conflicts (a
-- timeline_events trigger with no search_path of its own) ran nested under a vehicle_listings trigger whose function has
-- search_path='' and inherited it. An earlier blanket hardening pass set search_path='' on 33 trigger functions; 14 are
-- attached to enabled triggers. Each is fine on its own if its body is qualified, but every trigger it fires inherits ''.
-- Fix: pin those trigger functions to public, pg_temp — setting only, no body change. Left as is: notify_payment_received
-- (cash_transactions; the money path stays dark per P3.7). Only functions still on '' are touched.

SET statement_timeout = '120s';

DO $do$
DECLARE
  f text;
  n int := 0;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'apply_auction_listing_outcome_to_vehicle_timeline', 'auto_create_work_approval_notification',
    'auto_grant_owner_on_verification', 'create_initial_business_ownership', 'notify_sale_completed',
    'set_contribution_type_id', 'touch_profile_image_insights', 'trg_audit_shop_invitations',
    'trg_audit_shop_licenses', 'trg_audit_shop_locations', 'trigger_organization_image_analysis',
    'trigger_vin_decode', 'update_platform_integration_timestamp'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p
               WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f
                 AND p.prorettype = 'trigger'::regtype
                 AND array_to_string(p.proconfig, ',') = 'search_path=""') THEN
      EXECUTE format('ALTER FUNCTION public.%I() SET search_path = public, pg_temp', f);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'pinned % trigger functions to public, pg_temp', n;
END
$do$;

RESET statement_timeout;

-- POST-APPLY: the next sync-live-auctions run logs "Mirrored N live rows into vehicle_listings";
--   SELECT count(*) FROM pg_proc p WHERE p.prorettype='trigger'::regtype AND array_to_string(p.proconfig, ',')='search_path=""'
--     AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND t.tgenabled <> 'D');   -- 1 (notify_payment_received)
