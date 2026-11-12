-- Current canonical lot eligibility does not depend on a historical vehicle sale scalar.
SELECT current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout \gset bat_activity_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0' OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0' OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE body text;source_uuid uuid;old_parts text[];new_parts text[];i integer;
BEGIN
 SELECT id INTO STRICT source_uuid FROM public.observation_sources WHERE slug='bat' AND species='timed_auction' AND 'bid'=ANY(supported_observations);
 body:=pg_get_functiondef('public.market_lot_activity(uuid[],integer)'::regprocedure);
 old_parts:=ARRAY[$old$), eligible AS MATERIALIZED ($old$,$old$eligible AS MATERIALIZED (
  SELECT v.id, rtrim(coalesce(n.listing_url,v.listing_url), '/') AS lot_url,
    CASE WHEN (CASE WHEN n.id IS NOT NULL THEN n.native_bid WHEN v.platform_source = 'bringatrailer' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END) >= 0 THEN (CASE WHEN n.id IS NOT NULL THEN n.native_bid WHEN v.platform_source = 'bringatrailer' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END) END AS current_bid_at_capture
  FROM selected r JOIN public.vehicles v ON v.id = r.id LEFT JOIN native n ON n.id=v.id CROSS JOIN settings s
  WHERE v.is_public AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND (n.id IS NOT NULL OR (v.sale_status = 'auction_live' AND (v.platform_source = 'bringatrailer' OR (
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
      ))
    ))
    AND (n.id IS NULL OR (n.outcome='live' AND NOT n.has_terminal)) AND CASE WHEN n.id IS NOT NULL THEN n.ends_at ELSE v.auction_end_date::timestamptz END > s.as_of
    AND coalesce(n.listing_url,v.listing_url) ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
)$old$,$old$'current_bid_at_capture', current_bid_at_capture,$old$,$old$FROM native n WHERE n.id=lots.id)$old$];
 new_parts:=ARRAY[$new$), qualified AS MATERIALIZED ( /* bat-current-episode-activity-v1 */
 SELECT v.id,rtrim(e.source_url,'/') lot_url,e.id auction_event_id,episode.id episode_id,
   bound.locator_id,bound.observation_id,bound.current_bid,bound.ends_at
 FROM selected r JOIN public.vehicles v ON v.id=r.id CROSS JOIN settings s
 JOIN public.auction_events_canonical e ON e.vehicle_id=v.id AND e.source='bat'
 JOIN LATERAL (
   SELECT episode.id FROM public.vehicle_events episode
   WHERE episode.vehicle_id=v.id AND episode.source_platform='bat' AND episode.event_type='auction'
     AND episode.source_url IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')
     AND episode.event_status IN('active','live') AND episode.sold_at IS NULL
     AND episode.duplicate_of_event_id IS NULL AND episode.ended_at>s.as_of
     AND NOT EXISTS(SELECT 1 FROM public.vehicle_events other WHERE other.vehicle_id=v.id
       AND other.source_platform='bat' AND other.event_type='auction' AND other.event_status IN('active','live')
       AND other.sold_at IS NULL AND other.duplicate_of_event_id IS NULL AND other.ended_at>s.as_of AND other.id<>episode.id)
     AND NOT EXISTS(SELECT 1 FROM public.vehicle_events other WHERE other.source_platform='bat'
       AND other.event_type='auction' AND other.duplicate_of_event_id IS NULL
       AND other.source_url IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/') AND other.id<>episode.id)
   OFFSET 0
 ) episode ON true
 JOIN LATERAL (
   SELECT candidates.*,count(*) OVER() locator_count FROM (
     SELECT DISTINCT ON(locator.id) locator.id locator_id,o.id observation_id,
       CASE WHEN locator.high_bid>=0 AND locator.high_bid<'Infinity'::numeric THEN locator.high_bid END current_bid,
       locator.auction_end_date::timestamptz ends_at
     FROM public.vehicle_observations o
     JOIN LATERAL (
       SELECT locator.id,locator.high_bid,locator.auction_end_date FROM public.vehicles locator
       WHERE locator.id=CASE WHEN pg_input_is_valid(o.vehicle_match_signals->>'monitor_vehicle_id','uuid')
         THEN (o.vehicle_match_signals->>'monitor_vehicle_id')::uuid END
         AND locator.id<>v.id AND locator.is_public AND locator.deleted_at IS NULL
         AND locator.merged_into_vehicle_id IS NULL AND locator.status IS DISTINCT FROM 'merged' AND locator.listing_kind IS DISTINCT FROM 'non_vehicle_item'
         AND locator.sale_status='auction_live'
         AND locator.listing_url IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')
         AND locator.origin_metadata->>'source'='bat_auctions_page' AND locator.origin_metadata->>'platform'='bringatrailer'
         AND locator.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
         AND locator.origin_metadata->>'external_id'=o.structured_data->>'native_post_id'
         AND CASE WHEN pg_input_is_valid(locator.auction_end_date,'timestamp with time zone')
           THEN locator.auction_end_date::timestamptz>s.as_of ELSE false END
       OFFSET 0
     ) locator ON true
     WHERE o.vehicle_id=v.id AND o.kind='bid' AND o.source_id=__BAT_SOURCE_UUID__::uuid
       AND o.source_url IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')
       AND o.extraction_method='bat_public_live_v1' AND o.source_identifier LIKE 'public-live:%'
       AND NOT coalesce(o.is_superseded,false) AND o.structured_data->>'projection_error' IS NULL
       AND public.observation_is_public(o.kind,o.structured_data)
       AND o.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
       AND o.vehicle_match_signals->>'source_url_match'='true'
     ORDER BY locator.id,o.ingested_at DESC,o.id
   ) candidates
 ) bound ON bound.locator_count=1
 WHERE v.is_public AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND v.status IS DISTINCT FROM 'merged'
   AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   AND e.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
   AND e.outcome='live' AND e.auction_end_date>s.as_of
   AND NOT EXISTS(SELECT 1 FROM public.auction_events_canonical other
     WHERE other.vehicle_id=v.id AND other.source='bat' AND other.outcome='live' AND other.auction_end_date>s.as_of AND other.id<>e.id)
   AND NOT EXISTS(SELECT 1 FROM public.auction_events_canonical other
     WHERE other.source='bat' AND other.source_url IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/') AND other.id<>e.id)
), eligible AS MATERIALIZED ($new$,$new$eligible AS MATERIALIZED (
  SELECT v.id, rtrim(coalesce(n.listing_url,q.lot_url,v.listing_url), '/') AS lot_url,
    CASE WHEN (CASE WHEN n.id IS NOT NULL THEN n.native_bid WHEN q.id IS NOT NULL THEN q.current_bid WHEN v.platform_source = 'bringatrailer' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END) >= 0 THEN (CASE WHEN n.id IS NOT NULL THEN n.native_bid WHEN q.id IS NOT NULL THEN q.current_bid WHEN v.platform_source = 'bringatrailer' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END) END AS current_bid_at_capture
  FROM selected r JOIN public.vehicles v ON v.id = r.id LEFT JOIN qualified q ON q.id=v.id LEFT JOIN native n ON n.id=v.id AND (q.id IS NULL OR rtrim(n.listing_url,'/')=q.lot_url) CROSS JOIN settings s
  WHERE v.is_public AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND (n.id IS NOT NULL OR q.id IS NOT NULL OR (v.sale_status = 'auction_live' AND (v.platform_source = 'bringatrailer' OR (
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
      ))
    ))
    AND (n.id IS NULL OR (n.outcome='live' AND NOT n.has_terminal)) AND CASE WHEN n.id IS NOT NULL THEN n.ends_at WHEN q.id IS NOT NULL THEN q.ends_at ELSE v.auction_end_date::timestamptz END > s.as_of
    AND coalesce(n.listing_url,q.lot_url,v.listing_url) ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
)$new$,$new$'current_bid_at_capture', current_bid_at_capture, 'current_lot_identity', (SELECT jsonb_build_object('basis','retained_native_current_episode','locator_vehicle_id',q.locator_id,'episode_id',q.episode_id,'auction_event_id',q.auction_event_id,'observation_id',q.observation_id) FROM qualified q WHERE q.id=lots.id),$new$,$new$FROM native n WHERE n.id=lots.id AND rtrim(n.listing_url,'/')=lots.lot_url)$new$];
 IF strpos(body,'bat-current-episode-activity-v1')>0 THEN
  FOR i IN 1..array_length(new_parts,1) LOOP
   IF strpos(body,replace(new_parts[i],'__BAT_SOURCE_UUID__',quote_literal(source_uuid::text)))=0 THEN
    RAISE EXCEPTION 'Previously applied current lot reader drifted at fragment %',i;
   END IF;
  END LOOP;
  RETURN;
 END IF;
 FOR i IN 1..array_length(old_parts,1) LOOP
  IF (length(body)-length(replace(body,old_parts[i],'')))/length(old_parts[i])<>1 THEN RAISE EXCEPTION 'Current lot reader drifted at fragment %',i; END IF;
  body:=replace(body,old_parts[i],replace(new_parts[i],'__BAT_SOURCE_UUID__',quote_literal(source_uuid::text)));
 END LOOP;
 EXECUTE body;
END $repair$;
SET statement_timeout = :'bat_activity_prior_statement_timeout';
SET lock_timeout = :'bat_activity_prior_lock_timeout';
