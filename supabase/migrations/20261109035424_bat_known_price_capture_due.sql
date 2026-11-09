-- Recover known changed inventory prices through existing slots, never synthetic bid events.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset bat_price_prior_
SELECT set_config('statement_timeout',
  CASE WHEN current_setting('statement_timeout')::interval = interval '0'
    OR current_setting('statement_timeout')::interval > interval '10 seconds'
    THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout',
  CASE WHEN current_setting('lock_timeout')::interval = interval '0'
    OR current_setting('lock_timeout')::interval > interval '2 seconds'
    THEN '2s' ELSE current_setting('lock_timeout') END, false);
DO $repair$
DECLARE
 body text:=pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure);
 source_uuid uuid;
 anchor text:=$old$AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now$old$;
 replacement text:=$new$AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               -- Known inventory price change; one existing-slot attempt per retained source clock.
               OR (m.sync_latency_ms IS NOT NULL
                   AND m.last_comment_synced_at >= m.last_synced_at
                   AND m.last_synced_at <= v_now - interval '150 seconds'
                   AND m.auction_end_time > v_now + interval '10 minutes'
                   AND EXISTS (
                     SELECT 1 FROM public.vehicles locator
                     JOIN public.listing_page_snapshots inventory ON inventory.id=CASE
                       WHEN pg_input_is_valid(locator.origin_metadata->>'source_snapshot_id','uuid')
                       THEN (locator.origin_metadata->>'source_snapshot_id')::uuid END
                     JOIN public.vehicle_observations receipt ON receipt.id=CASE
                       WHEN pg_input_is_valid(m.stream_state->>'last_observation_id','uuid')
                       THEN (m.stream_state->>'last_observation_id')::uuid END
                     JOIN public.vehicles canonical ON canonical.id=receipt.vehicle_id
                     JOIN public.auction_events_canonical captured ON captured.vehicle_id=canonical.id
                       AND captured.source='bat'
                       AND captured.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                     WHERE locator.id=m.vehicle_id AND locator.deleted_at IS NULL
                       AND locator.merged_into_vehicle_id IS NULL AND locator.status IS DISTINCT FROM 'merged'
                       AND canonical.deleted_at IS NULL AND canonical.merged_into_vehicle_id IS NULL
                       AND canonical.status IS DISTINCT FROM 'merged'
                       AND m.external_auction_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
                       AND locator.listing_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                       AND locator.origin_metadata->>'source'='bat_auctions_page'
                       AND locator.origin_metadata->>'platform'='bringatrailer'
                       AND locator.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
                       AND inventory.platform='bat' AND inventory.success AND inventory.http_status=200
                       AND inventory.listing_url IN('https://bringatrailer.com/auctions','https://bringatrailer.com/auctions/')
                       AND inventory.fetched_at=CASE WHEN pg_input_is_valid(locator.origin_metadata->>'source_read_at','timestamp with time zone')
                         THEN (locator.origin_metadata->>'source_read_at')::timestamptz END
                       AND inventory.fetched_at>m.last_synced_at AND inventory.fetched_at<=v_now
                       AND receipt.source_id=__BAT_SOURCE_UUID__::uuid
                       AND receipt.extraction_method='bat_public_live_v1' AND receipt.is_superseded IS NOT TRUE
                       AND receipt.structured_data->>'projection_error' IS NULL
                       AND receipt.structured_data->>'native_post_id'=locator.origin_metadata->>'external_id'
                       AND receipt.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                       AND (receipt.vehicle_id=m.vehicle_id OR (
                         receipt.vehicle_match_signals->>'monitor_vehicle_id'=m.vehicle_id::text
                         AND receipt.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
                         AND receipt.vehicle_match_signals->>'source_url_match'='true'))
                       AND inventory.fetched_at>CASE WHEN pg_input_is_valid(receipt.structured_data->>'received_at','timestamp with time zone')
                         THEN (receipt.structured_data->>'received_at')::timestamptz END
                       AND (captured.raw_data#>>'{source_read,at}' IS NULL
                         OR pg_input_is_valid(captured.raw_data#>>'{source_read,at}','timestamp with time zone'))
                       AND (captured.raw_data#>>'{live_stream,last_frame_received_at}' IS NULL
                         OR pg_input_is_valid(captured.raw_data#>>'{live_stream,last_frame_received_at}','timestamp with time zone'))
                       AND inventory.fetched_at>greatest(
                         CASE WHEN pg_input_is_valid(captured.raw_data#>>'{source_read,at}','timestamp with time zone')
                           THEN (captured.raw_data#>>'{source_read,at}')::timestamptz END,
                         CASE WHEN pg_input_is_valid(captured.raw_data#>>'{live_stream,last_frame_received_at}','timestamp with time zone')
                           THEN (captured.raw_data#>>'{live_stream,last_frame_received_at}')::timestamptz END)
                       AND captured.outcome='live' AND captured.auction_end_date>v_now
                       AND CASE WHEN jsonb_typeof(locator.origin_metadata->'source_current_bid')='number'
                         THEN (locator.origin_metadata->>'source_current_bid')::numeric>0
                           AND (locator.origin_metadata->>'source_current_bid')::numeric<'Infinity'::numeric
                           AND (locator.origin_metadata->>'source_current_bid')::numeric<>captured.high_bid
                         ELSE false END
                       AND captured.high_bid>0 AND captured.high_bid<'Infinity'::numeric
                       AND NOT EXISTS(SELECT 1 FROM public.auction_events_canonical other
                         WHERE other.source='bat' AND other.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                           AND other.id<>captured.id)
                       AND EXISTS(SELECT 1 FROM public.vehicle_events episode
                         WHERE episode.vehicle_id=canonical.id AND episode.source_platform='bat' AND episode.event_type='auction'
                           AND episode.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                           AND episode.event_status IN('active','live') AND episode.sold_at IS NULL
                           AND episode.duplicate_of_event_id IS NULL AND episode.ended_at>v_now
                           AND NOT EXISTS(SELECT 1 FROM public.vehicle_events other
                             WHERE other.source_platform='bat' AND other.event_type='auction'
                               AND other.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                               AND other.duplicate_of_event_id IS NULL AND other.id<>episode.id))))$new$;
BEGIN
 SELECT id INTO STRICT source_uuid FROM public.observation_sources
 WHERE slug='bat' AND species='timed_auction' AND 'bid'=ANY(supported_observations);
 replacement:=replace(replacement,'__BAT_SOURCE_UUID__',quote_literal(source_uuid::text));
 IF strpos(body,replacement)>0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1
   OR strpos(body,'Known inventory price change;')>0 THEN
  RAISE EXCEPTION 'BaT due predicate drifted; inspect before applying';
 END IF;
 EXECUTE replace(body,anchor,replacement);
END $repair$;
SET statement_timeout = :'bat_price_prior_statement_timeout';
SET lock_timeout = :'bat_price_prior_lock_timeout';
