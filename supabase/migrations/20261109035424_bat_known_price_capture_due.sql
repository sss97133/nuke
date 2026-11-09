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
 reconcile_old text:=$old$AND other_lot.vehicle_id IS DISTINCT FROM native.vehicle_id)$old$;
 reconcile_new text:=$new$AND other_lot.duplicate_of IS NULL
              AND other_lot.vehicle_id IS DISTINCT FROM native.vehicle_id)$new$;
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
                         AND receipt.vehicle_match_signals->>'source_url_match'='true') OR (
                         -- A sanctioned correction preserves original capture signals.
                         -- Prove that lineage separately; never reinterpret them as lot_slug.
                         receipt.merged_from_vehicle_id=m.vehicle_id
                         AND receipt.vehicle_match_signals->>'binding'='bat_auctions_page'
                         AND receipt.vehicle_match_signals->>'source_url_match'='true'
                         AND receipt.raw_source_ref='bat:public-live:post:'||(locator.origin_metadata->>'external_id')
                         AND captured.raw_data#>>'{link_correction,canonical_event_id}'=captured.id::text
                         AND captured.raw_data#>>'{link_correction,native_post_id}'=locator.origin_metadata->>'external_id'
                         AND nullif(captured.raw_data#>>'{link_correction,run_id}','') IS NOT NULL
                         AND (receipt.auction_event_id IS NULL OR receipt.auction_event_id=captured.id)
                         AND (receipt.structured_data->>'auction_event_id' IS NULL OR receipt.structured_data->>'auction_event_id'=captured.id::text)
                         AND (receipt.structured_data->>'source_auction_event_id' IS NULL OR receipt.structured_data->>'source_auction_event_id'=captured.id::text)
                         AND EXISTS(SELECT 1 FROM public.auction_event_duplicate_mark correction
                           JOIN public.auction_events duplicate ON duplicate.id=correction.event_id
                           WHERE correction.run_id=captured.raw_data#>>'{link_correction,run_id}'
                             AND correction.retired_at IS NULL AND correction.duplicate_of=captured.id
                             AND correction.vehicle_id=m.vehicle_id AND correction.source='bat'
                             AND correction.canonical_listing_url=rtrim(m.external_auction_url,'/')
                             AND duplicate.duplicate_of=captured.id AND duplicate.vehicle_id=m.vehicle_id
                             AND duplicate.source='bat' AND duplicate.source_listing_id=captured.source_listing_id
                             AND duplicate.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                             AND EXISTS(SELECT 1 FROM public.superseded_rows before_image
                               WHERE before_image.source_table='vehicle_observations' AND before_image.row_id=receipt.id
                                 AND before_image.restored_at IS NULL
                                 AND before_image.source=captured.raw_data->'link_correction'
                                 AND before_image.row_data->>'id'=receipt.id::text
                                 AND before_image.row_data->>'vehicle_id'=m.vehicle_id::text
                                 AND (before_image.row_data->>'auction_event_id' IS NULL OR before_image.row_data->>'auction_event_id' IN(duplicate.id::text,captured.id::text))
                                 AND (before_image.row_data#>>'{structured_data,auction_event_id}' IS NULL OR before_image.row_data#>>'{structured_data,auction_event_id}' IN(duplicate.id::text,captured.id::text))
                                 AND (before_image.row_data#>>'{structured_data,source_auction_event_id}' IS NULL OR before_image.row_data#>>'{structured_data,source_auction_event_id}' IN(duplicate.id::text,captured.id::text))
                                 AND before_image.row_data-ARRAY['vehicle_id','subject_id','merged_from_vehicle_id','auction_event_id','structured_data']
                                   =to_jsonb(receipt)-ARRAY['vehicle_id','subject_id','merged_from_vehicle_id','auction_event_id','structured_data']
                                 AND (before_image.row_data->'structured_data')-ARRAY['auction_event_id','source_auction_event_id']
                                   =receipt.structured_data-ARRAY['auction_event_id','source_auction_event_id']))
                         AND EXISTS(SELECT 1 FROM public.vehicle_events corrected_episode
                           WHERE corrected_episode.vehicle_id=canonical.id AND corrected_episode.source_platform='bat'
                             AND corrected_episode.event_type='auction' AND corrected_episode.merged_from_vehicle_id=m.vehicle_id
                             AND corrected_episode.source_url IN(rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                             AND corrected_episode.event_status IN('active','live') AND corrected_episode.sold_at IS NULL
                             AND corrected_episode.duplicate_of_event_id IS NULL AND corrected_episode.ended_at>v_now)))
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
 IF strpos(body,replacement)=0 THEN
  IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1
    OR strpos(body,'Known inventory price change;')>0 THEN
   RAISE EXCEPTION 'BaT due predicate drifted; inspect before applying';
  END IF;
  body:=replace(body,anchor,replacement);
 END IF;
 IF strpos(body,reconcile_new)=0 THEN
  IF (length(body)-length(replace(body,reconcile_old,'')))/length(reconcile_old)<>1 THEN
   RAISE EXCEPTION 'BaT canonical reconciliation ambiguity guard drifted; inspect before applying';
  END IF;
  body:=replace(body,reconcile_old,reconcile_new);
 END IF;
 EXECUTE body;
END $repair$;
SET statement_timeout = :'bat_price_prior_statement_timeout';
SET lock_timeout = :'bat_price_prior_lock_timeout';
