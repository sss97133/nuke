-- A vehicle keeps its earlier source identity while a later BaT listing becomes current.
-- Qualify that listing from its exact active episode AND the native inventory identity witness;
-- never rewrite the vehicle's platform or borrow its historical sale price as a current bid.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $patch$
DECLARE
  target regprocedure;
  definition text;
  body_hash text;
  old_gate constant text := $old$AND v.platform_source = 'bringatrailer'$old$;
  new_gate constant text := $new$AND (v.platform_source = 'bringatrailer' OR (
        /* canonical-bat-episode-v1 */
        v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
        AND v.origin_metadata->>'platform' = 'bringatrailer'
        AND v.origin_metadata->>'source' = 'bat_auctions_page'
        -- last_sync advances on changed scalar state only; it proves identity, not read freshness.
        AND CASE WHEN pg_input_is_valid(v.origin_metadata->>'last_sync', 'timestamp with time zone')
          THEN (v.origin_metadata->>'last_sync')::timestamptz <= now()+interval '1 minute'
          ELSE false END
        AND EXISTS (
          SELECT 1 FROM public.vehicle_events current_episode
          WHERE current_episode.vehicle_id=v.id AND current_episode.source_platform='bat'
            AND current_episode.event_status IN ('active','live')
            AND rtrim(current_episode.source_url,'/')=rtrim(v.listing_url,'/'))
      ))$new$;
BEGIN
  FOREACH target IN ARRAY ARRAY['public.market_pulse_live_build()'::regprocedure,
    'public.market_lot_activity(uuid[],integer)'::regprocedure] LOOP
    SELECT pg_get_functiondef(target) INTO definition;
    IF position('canonical-bat-episode-v1' IN definition)>0 THEN CONTINUE; END IF;
    SELECT md5(prosrc) INTO body_hash FROM pg_proc WHERE oid=target;
    IF body_hash IS DISTINCT FROM (CASE WHEN target='public.market_pulse_live_build()'::regprocedure
      THEN '71ac3437a8bca49a20d7827a5df26e0d' ELSE '491efa2935232e8de4f081bb9e77374b' END) THEN
      RAISE EXCEPTION 'BaT reader % drifted from reviewed source body; re-read before applying',target;
    END IF;
    IF (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate) <> 1
      OR position('COALESCE(v.high_bid, v.sale_price)' IN definition)=0 THEN
      RAISE EXCEPTION 'BaT reader % no longer matches the reviewed eligibility/amount contract',target;
    END IF;
    definition := replace(definition,old_gate,new_gate);
    definition := replace(definition,'COALESCE(v.high_bid, v.sale_price)',
      '(CASE WHEN v.platform_source = ''bringatrailer'' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END)');
    EXECUTE definition;
  END LOOP;
END $patch$;
-- Refresh only the existing derived cache; retain its existing two-minute job and public contract.
SELECT public.refresh_market_pulse_live_snapshot();
COMMIT;
