-- Closed relisted BaT lots: qualify the canonical terminal receipt; never rekey testimony.
-- Evidence, 2026-10-21: three locator-stub monitors have native terminal receipts and closed lots on
-- canonical vehicles. Health misses them and the scheduler reactivates them. Transport is repaired.
-- Change only four closed-result predicates in two existing functions. Keep direct bindings,
-- historical lateness/settlement failures, source cadence/budgets, slots/locks and permissions.
-- Fallback: an unsuperseded native sale-result receipt proving this stub and exact lot URL,
-- a closed lot on its holder, and no contradictory vehicle-event/auction-event holder.
-- Existing vehicle/source and lot-slug indexes bound those checks. No new tables or helpers.
-- Exact measured function hashes fence drift; full after hashes make replay a no-op.
-- These are SHA-256/Base64 checksums of public function definitions, not credentials.
-- PREPARED ONLY: production SQL rollout is separate from the already approved Edge rollout.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE
  signature text;
  body text;
  before_attributes jsonb;
  after_attributes jsonb;
BEGIN

  signature := 'public.get_live_auction_health(date)';
  SELECT pg_get_functiondef(signature::regprocedure) INTO body;
  IF encode(sha256(convert_to(body,'UTF8')),'base64')='SzX+m9aqafIfhbEkolg4DZFT8UwSqOPH1GzoTy0cUUY=' THEN
    NULL; -- Exact reviewed post-state, already applied.
  ELSIF encode(sha256(convert_to(body,'UTF8')),'base64')='Y+jsm6o9HtKazOy3EOuZBO0vi5fk9S2ayItr/jc+rYM=' THEN
    SELECT jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig)
      INTO STRICT before_attributes FROM pg_proc WHERE oid=signature::regprocedure;
    body := replace(body,$old0$NOT EXISTS(SELECT 1 FROM public.auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled'))$old0$,$new0$NOT (EXISTS(SELECT 1 FROM public.auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled')) OR EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=m.vehicle_id
        WHERE native_receipt.id=nullif(m.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM m.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=m.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)))$new0$);
    EXECUTE body;
    IF encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'base64')<>'SzX+m9aqafIfhbEkolg4DZFT8UwSqOPH1GzoTy0cUUY=' THEN
      RAISE EXCEPTION 'Unexpected function post-state: %',signature;
    END IF;
    SELECT jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig)
      INTO STRICT after_attributes FROM pg_proc WHERE oid=signature::regprocedure;
    IF after_attributes IS DISTINCT FROM before_attributes THEN
      RAISE EXCEPTION 'Function authority changed: %',signature;
    END IF;
  ELSE
    RAISE EXCEPTION 'Refusing drifted function: %',signature;
  END IF;

  signature := 'public.bat_live_pull_run(integer,boolean)';
  SELECT pg_get_functiondef(signature::regprocedure) INTO body;
  IF encode(sha256(convert_to(body,'UTF8')),'base64')='6jqJFhx4pMWoJ9tczKi2djKQTlGmafhgtGu9Rn876ow=' THEN
    NULL; -- Exact reviewed post-state, already applied.
  ELSIF encode(sha256(convert_to(body,'UTF8')),'base64')='5ABW2FzRmY8Tx90UEZ/76R/zaJsOwRd4oLOpJHJTruw=' THEN
    SELECT jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig)
      INTO STRICT before_attributes FROM pg_proc WHERE oid=signature::regprocedure;
    body := replace(body,$old0$EXISTS (
      SELECT 1 FROM auction_events a WHERE a.vehicle_id=m2.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(m2.external_auction_url,'/')
        AND a.outcome IN ('sold','reserve_not_met','cancelled'))$old0$,$new0$(EXISTS (
      SELECT 1 FROM auction_events a WHERE a.vehicle_id=m2.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(m2.external_auction_url,'/')
        AND a.outcome IN ('sold','reserve_not_met','cancelled')) OR EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=m2.vehicle_id
        WHERE native_receipt.id=nullif(m2.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM m2.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=m2.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m2.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)))$new0$);
    body := replace(body,$old1$NOT EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id = v.id
                        AND rtrim(a.source_url, '/') = rtrim(v.listing_url, '/')
                        AND a.outcome IN ('sold', 'reserve_not_met'))$old1$,$new1$NOT (EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id = v.id
                        AND rtrim(a.source_url, '/') = rtrim(v.listing_url, '/')
                        AND a.outcome IN ('sold', 'reserve_not_met')) OR EXISTS (
      SELECT 1 FROM public.monitored_auctions closed_monitor
      WHERE closed_monitor.source_id=v_src
        AND closed_monitor.external_auction_id=substring(v.listing_url from '/listing/([^/?]+)')
        AND closed_monitor.vehicle_id=v.id
        AND closed_monitor.external_auction_url IN (rtrim(v.listing_url,'/'),rtrim(v.listing_url,'/')||'/')
        AND EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=closed_monitor.vehicle_id
        WHERE native_receipt.id=nullif(closed_monitor.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM closed_monitor.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=closed_monitor.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(closed_monitor.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(closed_monitor.external_auction_url,'/'),rtrim(closed_monitor.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id))))$new1$);
    body := replace(body,$old2$NOT EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id=m2.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(m2.external_auction_url,'/')
        AND a.outcome IN ('sold','reserve_not_met','cancelled'))$old2$,$new2$NOT (EXISTS (SELECT 1 FROM auction_events a WHERE a.vehicle_id=m2.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(m2.external_auction_url,'/')
        AND a.outcome IN ('sold','reserve_not_met','cancelled')) OR EXISTS (
        SELECT 1 FROM public.vehicle_observations native_receipt
        JOIN public.auction_events native_lot ON native_lot.vehicle_id=native_receipt.vehicle_id
        JOIN public.vehicles locator ON locator.id=m2.vehicle_id
        WHERE native_receipt.id=nullif(m2.stream_state->>'terminal_observation_id','')::uuid
          AND locator.deleted_at IS NULL
          AND locator.origin_metadata->>'source'='bat_auctions_page'
          AND locator.origin_metadata->>'external_id'=native_receipt.structured_data->>'native_post_id'
          AND locator.listing_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_receipt.kind='sale_result'
          AND native_receipt.extraction_method='bat_public_live_v1'
          AND native_receipt.is_superseded IS NOT TRUE
          AND native_receipt.vehicle_id IS DISTINCT FROM m2.vehicle_id
          AND native_receipt.vehicle_match_signals->>'monitor_vehicle_id'=m2.vehicle_id::text
          AND native_receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
          AND native_receipt.vehicle_match_signals->>'source_url_match'='true'
          AND native_receipt.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
          AND native_lot.outcome IN ('sold','reserve_not_met','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.vehicle_events other_event
            WHERE other_event.source_platform='bat'
              AND other_event.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_event.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.auction_events other_lot
            WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
              =lower(substring(m2.external_auction_url,'bringatrailer\.com/listing/([^/?#]+)'))
              AND other_lot.source_url IN (rtrim(m2.external_auction_url,'/'),rtrim(m2.external_auction_url,'/')||'/')
              AND other_lot.vehicle_id IS DISTINCT FROM native_receipt.vehicle_id)))$new2$);
    EXECUTE body;
    IF encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'base64')<>'6jqJFhx4pMWoJ9tczKi2djKQTlGmafhgtGu9Rn876ow=' THEN
      RAISE EXCEPTION 'Unexpected function post-state: %',signature;
    END IF;
    SELECT jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig)
      INTO STRICT after_attributes FROM pg_proc WHERE oid=signature::regprocedure;
    IF after_attributes IS DISTINCT FROM before_attributes THEN
      RAISE EXCEPTION 'Function authority changed: %',signature;
    END IF;
  ELSE
    RAISE EXCEPTION 'Refusing drifted function: %',signature;
  END IF;
END
$patch$;
COMMIT;
