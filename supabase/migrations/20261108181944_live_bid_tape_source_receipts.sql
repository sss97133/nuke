-- Preserve each source receipt and its clocks; a polled high bid is not an individual bid event.
SET lock_timeout = '3s';
SET statement_timeout = '10s';
CREATE OR REPLACE FUNCTION public.live_bid_tape(p_minutes integer DEFAULT 5)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '5s'
AS $function$
WITH raw AS MATERIALIZED (
  SELECT o.id observation_id, o.vehicle_id, o.source_id, o.source_url, o.source_identifier,
    o.observed_at, o.ingested_at, o.structured_data d, o.extraction_metadata m,
    o.structured_data #>> '{public_live_frame,data,comment,id}' comment_id,
    CASE WHEN o.source_identifier LIKE 'public-live:%' THEN 'bringatrailer'
      WHEN o.source_identifier LIKE 'pcarmarket-bid:%' THEN 'pcarmarket'
      WHEN o.source_identifier LIKE 'collecting-cars-bid:%' THEN 'collecting-cars'
      WHEN o.extraction_method='ebay_browse_auction_snapshot_v1' THEN 'ebay-motors'
      WHEN o.extraction_method='purplewave_public_snapshot_v1' THEN 'purplewave' END house
  FROM public.vehicle_observations o
  JOIN public.vehicles v ON v.id=o.vehicle_id AND v.is_public=true AND v.deleted_at IS NULL
  WHERE ((o.kind='bid' AND (o.source_identifier LIKE 'public-live:%' OR o.source_identifier LIKE 'collecting-cars-bid:%' OR o.source_identifier LIKE 'pcarmarket-bid:%'))
      OR (o.kind='listing' AND o.extraction_method='ebay_browse_auction_snapshot_v1' AND o.structured_data->>'capture_kind'='auction_bid_snapshot')
      OR (o.kind='listing' AND o.extraction_method='purplewave_public_snapshot_v1' AND o.structured_data->>'capture_kind'='auction_state_snapshot'))
    AND o.ingested_at > statement_timestamp()-make_interval(mins=>least(greatest(coalesce(p_minutes,5),1),30))
    AND o.observed_at <= statement_timestamp()+interval '1 minute'
    AND NOT coalesce(o.is_superseded,false)
    AND o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'
    AND public.observation_is_public(o.kind,o.structured_data)
), shaped AS (
  SELECT *, CASE WHEN house='bringatrailer' THEN d #>> '{public_live_frame,data,comment,bidAmount}' WHEN house IN ('ebay-motors','purplewave') THEN d->>'current_bid' ELSE d->>'amount' END amount_text,
    CASE WHEN house='bringatrailer' THEN 'USD' ELSE d->>'currency' END currency,
    CASE WHEN house IN ('bringatrailer','pcarmarket') THEN 'bid'
      WHEN house IN ('ebay-motors','purplewave') AND coalesce(d->>'bid_count','') !~ '^[1-9][0-9]{0,8}$' THEN 'price_snapshot'
      ELSE 'bid_snapshot' END event_kind,
    CASE WHEN house='bringatrailer' THEN source_id::text||':'||comment_id ELSE source_id::text||':'||source_identifier END receipt_key
  FROM raw WHERE house IS NOT NULL
), bids AS (
  SELECT DISTINCT ON (receipt_key) * FROM shaped
  WHERE CASE WHEN amount_text ~ '^[0-9]{1,10}([.][0-9]{1,8})?$' THEN amount_text::numeric>0 ELSE false END
    AND currency ~ '^[A-Z]{3}$'
    AND source_url ~ CASE house WHEN 'bringatrailer' THEN '^https://(www[.])?bringatrailer[.]com/listing/'
      WHEN 'pcarmarket' THEN '^https://(www[.])?pcarmarket[.]com/auction/'
      WHEN 'collecting-cars' THEN '^https://(www[.])?collectingcars[.]com/for-sale/'
      WHEN 'purplewave' THEN '^https://(www[.])?purplewave[.]com/auction/[0-9]{6}[A-Z]?/item/[A-Z]{2}[0-9]{4}/?$'
      WHEN 'ebay-motors' THEN '^https://(www[.])?ebay[.]com/itm/' END
    AND (house<>'bringatrailer' OR comment_id ~ '^[0-9]{1,12}$')
    AND (house<>'pcarmarket' OR (d->>'clock'='source_event_time' AND d->>'bid_id' ~ '^[0-9a-f-]{36}$'))
  ORDER BY receipt_key, ingested_at, observation_id
)
SELECT jsonb_build_object('receipt_version',2,'as_of',statement_timestamp(),'minutes',least(greatest(coalesce(p_minutes,5),1),30),
 'sources',(SELECT jsonb_agg(house ORDER BY house) FROM public.live_board_houses WHERE enabled),
 'source_status',(SELECT jsonb_agg(jsonb_build_object('house',h.house,'label',h.label,
   'read_at',s.scraping_config #>> '{live_board,last_run,at}',
   'lots',s.scraping_config #> '{live_board,last_run,lots}',
   'state',CASE WHEN nullif(s.scraping_config #>> '{live_board,last_run,state}','') IS NOT NULL THEN 'source_scope_limited' END,
   'has_error',s.last_sync_error IS NOT NULL) ORDER BY h.house)
   FROM public.live_board_houses h LEFT JOIN public.live_auction_sources s ON s.slug=h.house WHERE h.enabled),
 'source','Public auction receipts admitted during this window; snapshots are not individual bids; source completeness is unverified',
 'bids',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',receipt_key,'observation_id',observation_id,'vehicle_id',vehicle_id,'house',house,'source_url',source_url,
   'amount',amount_text::numeric,'currency',currency,'event_kind',event_kind,
   'bid_at',observed_at,'ingested_at',ingested_at,'received_at',coalesce(d->>'received_at',m->>'received_at'),'latest_bid_at',d->>'latest_bid_at',
   'clock_basis',CASE WHEN house='purplewave' THEN 'public_api_received_at' ELSE coalesce(d->>'clock_basis',d->>'clock') END,
   'bid_count',CASE WHEN d->>'bid_count' ~ '^[0-9]{1,9}$' THEN (d->>'bid_count')::int END,
   'end_at',CASE WHEN house='bringatrailer' AND d #>> '{public_live_frame,data,comment,end_timestamp}' ~ '^[0-9]{9,11}$'
     THEN to_timestamp((d #>> '{public_live_frame,data,comment,end_timestamp}')::bigint) END,
   'listing_end_at',CASE WHEN house='ebay-motors' THEN d->>'item_end_date' WHEN house='collecting-cars' THEN d->>'ends' WHEN house='purplewave' THEN d->>'auction_end_date' END,
   'source_event_id',CASE WHEN house='purplewave' THEN (d->>'auction_id')||':'||(d->>'native_item_id') ELSE coalesce(comment_id,d->>'bid_id',d->>'auction_id',d->>'item_id') END,
   'projection_error',CASE WHEN nullif(d->>'projection_error','') IS NOT NULL THEN 'Projection pending' END,'transport',CASE WHEN house='pcarmarket' THEN 'polled_history' ELSE d->>'transport' END,
   'recovered',(house='bringatrailer' AND coalesce(d->>'transport','')<>'public_pusher') OR (house='pcarmarket' AND observed_at < ingested_at-interval '1 minute')) ORDER BY ingested_at DESC,receipt_key) FROM bids),'[]'::jsonb));
$function$;
COMMENT ON FUNCTION public.live_bid_tape(integer) IS 'Public, undeleted vehicle bid receipts by ingestion window, deduplicated by source and native event identity. BaT and PCarMarket native bids, Collecting Cars, Purple Wave and eBay snapshots and qualified opening/unknown price quotes retain source URL, currency, source and admission clocks. Does not assert source completeness or expose bidder names/raw frames. Existing anon execute contract retained.';
