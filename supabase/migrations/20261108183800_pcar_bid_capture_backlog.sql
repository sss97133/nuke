-- Read capture debt from retained bids, not the board's already-advanced counter.
SET statement_timeout = '10s';
SET lock_timeout = '2s';
CREATE OR REPLACE FUNCTION public.pcarmarket_bid_capture_backlog(p_limit integer DEFAULT 8)
RETURNS TABLE(url text, vehicle_id uuid, expected_bids integer, retained_bids bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
SET statement_timeout TO '5s'
AS $function$
 SELECT m.external_auction_url, m.vehicle_id, m.bid_count, held.n
 FROM public.monitored_auctions m
 JOIN public.live_auction_sources s ON s.id=m.source_id AND s.slug='pcarmarket'
 JOIN public.vehicles v ON v.id=m.vehicle_id AND v.deleted_at IS NULL
 CROSS JOIN LATERAL (
   SELECT count(DISTINCT o.source_identifier) AS n
   FROM public.vehicle_observations o
   WHERE o.vehicle_id=m.vehicle_id AND o.kind='bid'
     AND o.source_identifier LIKE 'pcarmarket-bid:%'
     AND rtrim(replace(o.source_url,'https://www.pcarmarket.com/','https://pcarmarket.com/'),'/')
       = rtrim(replace(m.external_auction_url,'https://www.pcarmarket.com/','https://pcarmarket.com/'),'/')
 ) held
 WHERE m.bid_count > held.n
   AND (m.is_live OR m.auction_end_time >= now()-interval '7 days')
 ORDER BY m.auction_end_time ASC NULLS LAST, m.id
 LIMIT greatest(0,least(coalesce(p_limit,8),32));
$function$;
REVOKE ALL ON FUNCTION public.pcarmarket_bid_capture_backlog(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pcarmarket_bid_capture_backlog(integer) TO service_role;
COMMENT ON FUNCTION public.pcarmarket_bid_capture_backlog(integer) IS
 'sync-live-auctions read-only retry selection: a published board count remains capture debt until distinct bids for the exact PCar lot are retained. Includes recently ended lots; does not assert publisher completeness or discover unobserved final bids.';
