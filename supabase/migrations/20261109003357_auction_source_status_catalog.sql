-- Extend only the existing public receipt status whitelist. No feed URLs, free-text
-- errors/configuration, private sources, grants, testimony or collection controls change.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset source_status_prior_
SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval = interval '0'
 OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout', CASE WHEN current_setting('lock_timeout')::interval = interval '0'
 OR current_setting('lock_timeout')::interval > interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END, false);
DO $repair$
DECLARE
 body text := pg_get_functiondef('public.live_bid_tape(integer)'::regprocedure);
 anchor text := $old$ 'sources',(SELECT jsonb_agg(house ORDER BY house) FROM public.live_board_houses WHERE enabled),
 'source_status',(SELECT jsonb_agg(jsonb_build_object('house',h.house,'label',h.label,
   'read_at',s.scraping_config #>> '{live_board,last_run,at}',
   'lots',s.scraping_config #> '{live_board,last_run,lots}',
   'state',CASE WHEN nullif(s.scraping_config #>> '{live_board,last_run,state}','') IS NOT NULL THEN 'source_scope_limited' END,
   'has_error',s.last_sync_error IS NOT NULL) ORDER BY h.house)
   FROM public.live_board_houses h LEFT JOIN public.live_auction_sources s ON s.slug=h.house WHERE h.enabled),
$old$;
 replacement text := $new$ 'sources',(SELECT jsonb_agg(house ORDER BY house) FROM configured),
 'source_status',(SELECT jsonb_agg(jsonb_build_object('house',house,'label',label,
   'read_at',scraping_config #>> '{live_board,last_run,at}',
   'lots',scraping_config #> '{live_board,last_run,lots}',
   'state',CASE WHEN nullif(scraping_config #>> '{live_board,last_run,state}','') IS NOT NULL THEN 'source_scope_limited' END,
   'has_error',last_sync_error IS NOT NULL,
   'collection_state',collection_state,
   'discovery_state',CASE WHEN feeds=0 THEN 'unrecorded' WHEN enabled_feeds=0 THEN 'disabled' ELSE coalesce(error_kind,'unverified') END,
   'discovery_attempt_at',attempt_at) ORDER BY house) FROM configured),
$new$;
 catalog_ctes text := $catalog$WITH catalog(house,label,feed_slug,native_slug) AS (VALUES
 ('bringatrailer','Bring a Trailer','bat','bat'),('ebay-motors','eBay Motors','ebay',NULL),
 ('pcarmarket','PCarMarket','pcarmarket','pcarmarket'),('collecting-cars','Collecting Cars','collecting-cars','collecting-cars'),
 ('purplewave','Purple Wave','purplewave',NULL),('bonhams','Bonhams','bonhams','bonhams'),
 ('broad-arrow','Broad Arrow','broadarrow','broad-arrow'),('gooding','Gooding Christie’s','gooding','gooding'),
 ('cars-and-bids','Cars & Bids','carsandbids','cars-and-bids'),('mecum','Mecum','mecum','mecum'),
 ('govdeals','GovDeals','govdeals',NULL),('barrett-jackson','Barrett-Jackson','barrettjackson','barrett-jackson'),
 ('rm-sothebys','RM Sotheby’s','rmsothebys','rm-sothebys'),('hagerty','Hagerty','hagerty','hagerty-marketplace'),
 ('allcollectorcars','All Collector Cars','allcollectorcars',NULL),('autohunter','AutoHunter','autohunter',NULL),
 ('carandclassic','Car & Classic','carandclassic',NULL),('classicdriver','Classic Driver','classicdriver',NULL),
 ('guyswithrides','Guys With Rides','guyswithrides',NULL),('hemmings','Hemmings','hemmings','hemmings')
), configured AS (
 SELECT c.*,s.scraping_config,s.last_sync_error,
  f.feeds,f.enabled_feeds,f.attempt_at,f.error_kind,
  CASE WHEN c.house='cars-and-bids' AND EXISTS(
   SELECT FROM cron.job WHERE jobname='cars-and-bids-15m' AND NOT active)
   THEN 'paused' END collection_state
 FROM catalog c
 LEFT JOIN public.live_board_houses h ON h.house=c.house
 LEFT JOIN public.live_auction_sources s ON s.slug=c.native_slug
 LEFT JOIN LATERAL (
  SELECT count(*) feeds,count(*) FILTER(WHERE enabled) enabled_feeds,
   coalesce(max(last_polled_at) FILTER(WHERE enabled),max(last_polled_at)) attempt_at,
   CASE WHEN bool_or(enabled AND last_error LIKE 'parsed_zero%') THEN 'no_listings_parsed'
    WHEN bool_or(enabled AND (last_error LIKE 'intake_backoff:%' OR last_error LIKE 'HTTP 403%')) THEN 'blocked'
    WHEN bool_or(enabled AND last_error IS NOT NULL) THEN 'error' END error_kind
  FROM public.listing_feeds WHERE source_slug=c.feed_slug
 ) f ON true
 WHERE h.house IS NOT NULL OR f.feeds>0
)
, raw AS MATERIALIZED ($catalog$;
BEGIN
 IF strpos(body,replacement)>0 AND strpos(body,catalog_ctes)>0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1
   OR strpos(body,'WITH raw AS MATERIALIZED (')=0 THEN
  RAISE EXCEPTION 'Unexpected live_bid_tape body; review status contract';
 END IF;
 body:=replace(body,'WITH raw AS MATERIALIZED (',catalog_ctes);
 EXECUTE replace(body,anchor,replacement);
END;
$repair$;
SET statement_timeout = :'source_status_prior_statement_timeout';
SET lock_timeout = :'source_status_prior_lock_timeout';
