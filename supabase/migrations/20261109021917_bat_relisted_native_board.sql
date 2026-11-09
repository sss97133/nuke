-- Read relisted native auction evidence under existing public RLS. No identity,
-- historical listing, grant, collector or cadence changes.
SELECT current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout \gset bat_board_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0' OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0' OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE
 old_native text:=$old$recent_native AS MATERIALIZED (
 SELECT DISTINCT o.vehicle_id FROM public.vehicle_observations o
 WHERE o.ingested_at>statement_timestamp()-interval '30 minutes'
   AND o.extraction_method='bat_public_live_v1' AND o.source_identifier LIKE 'public-live:%'
   AND NOT coalesce(o.is_superseded,false)
), native AS MATERIALIZED (
 SELECT DISTINCT ON(v.id) v.id,v.year,coalesce(cm.canonical_name,v.make) make,v.model,v.title,
   v.created_at listed_at,v.primary_image_url image_url,v.listing_url,v.sale_status,
   coalesce((v.origin_metadata->>'no_reserve')::boolean,false) no_reserve,
   e.id auction_event_id,e.outcome,e.high_bid native_bid,e.auction_end_date ends_at,
   EXISTS(SELECT 1 FROM public.auction_events_canonical closed
     WHERE closed.vehicle_id=v.id AND closed.source='bat'
       AND closed.source_url IN(rtrim(v.listing_url,'/'),rtrim(v.listing_url,'/')||'/')
       AND closed.outcome IN('sold','reserve_not_met','cancelled')) has_terminal,
   o.id observation_id,o.observed_at source_observed_at,o.ingested_at,
   receipt.received_at received_at
 FROM recent_native recent JOIN public.vehicles v ON v.id=recent.vehicle_id
 JOIN public.auction_events_canonical e ON e.vehicle_id=v.id
   AND e.source='bat' AND e.source_url IN(rtrim(v.listing_url,'/'),rtrim(v.listing_url,'/')||'/')
 JOIN public.vehicle_observations o ON o.id=CASE WHEN pg_input_is_valid(e.raw_data#>>'{live_stream,observation_id}','uuid')
   THEN (e.raw_data#>>'{live_stream,observation_id}')::uuid END AND o.vehicle_id=v.id
 CROSS JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(o.structured_data->>'received_at','timestamp with time zone')
   THEN (o.structured_data->>'received_at')::timestamptz END received_at) receipt
 LEFT JOIN public.canonical_makes cm ON cm.id=v.canonical_make_id
 WHERE o.ingested_at>statement_timestamp()-interval '30 minutes'
   AND o.extraction_method='bat_public_live_v1' AND o.source_identifier LIKE 'public-live:%'
   AND NOT coalesce(o.is_superseded,false) AND o.structured_data->>'projection_error' IS NULL
   AND public.observation_is_public(o.kind,o.structured_data)
   AND v.is_public AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   AND v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
   AND rtrim(o.source_url,'/')=rtrim(v.listing_url,'/')
   AND v.origin_metadata->>'source'='bat_auctions_page'
   AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
   AND v.origin_metadata->>'external_id'=o.structured_data->>'native_post_id'
   AND e.outcome IN('live','sold','reserve_not_met','cancelled')
   AND isfinite(receipt.received_at) AND receipt.received_at<=statement_timestamp()+interval '1 minute'
   AND receipt.received_at>statement_timestamp()-interval '30 minutes'
   AND (e.outcome<>'live' OR (
     CASE WHEN pg_input_is_valid(v.origin_metadata->>'last_sync','timestamp with time zone')
       THEN receipt.received_at>(v.origin_metadata->>'last_sync')::timestamptz ELSE true END
     AND CASE WHEN pg_input_is_valid(e.raw_data#>>'{source_read,at}','timestamp with time zone')
       THEN receipt.received_at>(e.raw_data#>>'{source_read,at}')::timestamptz ELSE true END))
 ORDER BY v.id,receipt.received_at DESC,o.ingested_at DESC,o.id
)$old$;
 new_native text:=$new$recent_native AS MATERIALIZED (
 SELECT DISTINCT o.vehicle_id FROM public.vehicle_observations o
 WHERE o.ingested_at>statement_timestamp()-interval '30 minutes'
   AND o.extraction_method='bat_public_live_v1' AND o.source_identifier LIKE 'public-live:%'
   AND NOT coalesce(o.is_superseded,false)
), native AS MATERIALIZED (
 SELECT DISTINCT ON(v.id) v.id,coalesce(bound.year,v.year) AS year,
   CASE WHEN bound.id IS NOT NULL THEN bound.make ELSE coalesce(cm.canonical_name,v.make) END make,
   coalesce(bound.model,v.model) model,coalesce(bound.title,v.title) title,
   coalesce(bound.created_at,v.created_at) listed_at,coalesce(bound.primary_image_url,v.primary_image_url) image_url,
   e.source_url listing_url,coalesce(bound.sale_status,v.sale_status) sale_status,
   coalesce(((CASE WHEN bound.id IS NOT NULL THEN bound.origin_metadata ELSE v.origin_metadata END)->>'no_reserve')::boolean,false) no_reserve,
   e.id auction_event_id,e.outcome,e.high_bid native_bid,e.auction_end_date ends_at,
   EXISTS(SELECT 1 FROM public.auction_events_canonical closed
     WHERE closed.vehicle_id=v.id AND closed.source='bat'
       AND closed.source_url IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')
       AND closed.outcome IN('sold','reserve_not_met','cancelled')) has_terminal,
   o.id observation_id,o.observed_at source_observed_at,o.ingested_at,
   receipt.received_at received_at,
   CASE WHEN bound.id IS NOT NULL THEN jsonb_build_object('source_url',e.source_url,
     'monitor_vehicle_id',bound.id,'native_post_id',o.structured_data->>'native_post_id',
     'year',bound.year,'make',bound.make,'model',bound.model,'title',bound.title,
     'basis','admitted_relisted_lot_binding') END source_listing_claims,
   CASE WHEN bound.id IS NOT NULL THEN jsonb_build_object('year',v.year,'make',v.make,'model',v.model,'title',v.title) END canonical_identity
 FROM recent_native recent JOIN public.vehicles v ON v.id=recent.vehicle_id
 JOIN public.auction_events_canonical e ON e.vehicle_id=v.id AND e.source='bat'
 JOIN public.vehicle_observations o ON o.id=CASE WHEN pg_input_is_valid(e.raw_data#>>'{live_stream,observation_id}','uuid')
   THEN (e.raw_data#>>'{live_stream,observation_id}')::uuid END AND o.vehicle_id=v.id
 CROSS JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(o.structured_data->>'received_at','timestamp with time zone')
   THEN (o.structured_data->>'received_at')::timestamptz END received_at) receipt
 LEFT JOIN LATERAL (
   SELECT locator.id,locator.year,locator.make,locator.model,locator.title,
     locator.created_at,locator.primary_image_url,locator.sale_status,locator.origin_metadata
   FROM public.vehicles locator
   WHERE locator.id=CASE WHEN pg_input_is_valid(o.vehicle_match_signals->>'monitor_vehicle_id','uuid')
       THEN (o.vehicle_match_signals->>'monitor_vehicle_id')::uuid END
     AND locator.id<>v.id AND locator.is_public AND locator.deleted_at IS NULL
     AND locator.listing_kind IS DISTINCT FROM 'non_vehicle_item'
     AND o.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
     AND o.vehicle_match_signals->>'source_url_match'='true'
     AND o.source_id=__BAT_SOURCE_UUID__::uuid
     AND locator.origin_metadata->>'source'='bat_auctions_page'
     AND locator.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
     AND locator.origin_metadata->>'external_id'=o.structured_data->>'native_post_id'
     AND locator.listing_url IN(rtrim(o.source_url,'/'),rtrim(o.source_url,'/')||'/')
     AND EXISTS(SELECT 1 FROM public.vehicle_events episode WHERE episode.vehicle_id=v.id
       AND episode.source_platform='bat' AND episode.event_type='auction'
       AND (e.outcome<>'live' OR episode.event_status IN('active','live'))
       AND episode.source_url IN(rtrim(o.source_url,'/'),rtrim(o.source_url,'/')||'/'))
     AND NOT EXISTS(SELECT 1 FROM public.vehicle_events other_episode
       WHERE lower(substring(other_episode.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
         =lower(substring(o.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
       AND other_episode.source_platform='bat'
       AND other_episode.source_url IN(rtrim(o.source_url,'/'),rtrim(o.source_url,'/')||'/')
       AND other_episode.vehicle_id IS DISTINCT FROM v.id)
     AND NOT EXISTS(SELECT 1 FROM public.auction_events other_lot
       WHERE lower(substring(other_lot.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
         =lower(substring(o.source_url,'bringatrailer\.com/listing/([^/?#]+)'))
       AND other_lot.source_url IN(rtrim(o.source_url,'/'),rtrim(o.source_url,'/')||'/')
       AND other_lot.vehicle_id IS DISTINCT FROM v.id)
 ) bound ON true
 LEFT JOIN public.canonical_makes cm ON cm.id=v.canonical_make_id
 WHERE o.ingested_at>statement_timestamp()-interval '30 minutes'
   AND o.extraction_method='bat_public_live_v1' AND o.source_identifier LIKE 'public-live:%'
   AND NOT coalesce(o.is_superseded,false) AND o.structured_data->>'projection_error' IS NULL
   AND public.observation_is_public(o.kind,o.structured_data)
   AND v.is_public AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   AND e.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
   AND rtrim(o.source_url,'/')=rtrim(e.source_url,'/')
   AND (bound.id IS NOT NULL OR (
     e.source_url IN(rtrim(v.listing_url,'/'),rtrim(v.listing_url,'/')||'/')
     AND v.origin_metadata->>'source'='bat_auctions_page'
     AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
     AND v.origin_metadata->>'external_id'=o.structured_data->>'native_post_id'))
   AND e.outcome IN('live','sold','reserve_not_met','cancelled')
   AND isfinite(receipt.received_at) AND receipt.received_at<=statement_timestamp()+interval '1 minute'
   AND receipt.received_at>statement_timestamp()-interval '30 minutes'
   AND (e.outcome<>'live' OR (
     CASE WHEN pg_input_is_valid((CASE WHEN bound.id IS NOT NULL THEN bound.origin_metadata ELSE v.origin_metadata END)->>'last_sync','timestamp with time zone')
       THEN receipt.received_at>((CASE WHEN bound.id IS NOT NULL THEN bound.origin_metadata ELSE v.origin_metadata END)->>'last_sync')::timestamptz ELSE true END
     AND CASE WHEN pg_input_is_valid(e.raw_data#>>'{source_read,at}','timestamp with time zone')
       THEN receipt.received_at>(e.raw_data#>>'{source_read,at}')::timestamptz OR (
         bound.id IS NOT NULL AND receipt.received_at=(e.raw_data#>>'{source_read,at}')::timestamptz
         AND e.raw_data->>'extractor'='extract-bat-core'
         AND e.raw_data#>>'{source_read,clock_version}'='1'
         AND e.raw_data#>>'{source_read,bid_amount_version}'='1'
         AND e.raw_data#>'{source_read,bid_amount}'=to_jsonb(e.high_bid)
         AND e.raw_data->>'listing_url' IN(rtrim(e.source_url,'/'),rtrim(e.source_url,'/')||'/')) ELSE true END))
 ORDER BY v.id,receipt.received_at DESC,o.ingested_at DESC,o.id
)$new$;
 old_eligibility text:=$eligible$    AND v.sale_status = 'auction_live' AND (v.platform_source = 'bringatrailer' OR (
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
$eligible$;
 new_eligibility text;
 source_uuid uuid;
 target regprocedure;
 body text;
BEGIN
 -- The registry has no anonymous read policy. Resolve its exact existing source
 -- during deployment, retaining only its already-public observation source key.
 SELECT id INTO STRICT source_uuid FROM public.observation_sources
 WHERE slug='bat' AND species='timed_auction' AND 'bid'=ANY(supported_observations);
 new_native:=replace(new_native,'__BAT_SOURCE_UUID__',quote_literal(source_uuid::text));
 new_eligibility:='    AND (n.id IS NOT NULL OR ('||substr(old_eligibility,9)||'    ))'||chr(10);
 FOREACH target IN ARRAY ARRAY['public.market_pulse_live()'::regprocedure,'public.market_lot_activity(uuid[],integer)'::regprocedure] LOOP
   body:=pg_get_functiondef(target);
   IF strpos(body,new_native)>0 THEN CONTINUE; END IF;
   IF (length(body)-length(replace(body,old_native,'')))/length(old_native)<>1 THEN
     RAISE EXCEPTION 'Native board body drifted for %; inspect before applying',target;
   END IF;
   body:=replace(body,old_native,new_native);
   IF target='public.market_lot_activity(uuid[],integer)'::regprocedure THEN
     IF strpos(body,old_eligibility)=0 OR strpos(body,'SELECT v.id, rtrim(v.listing_url, ''/'') AS lot_url,')=0 THEN
       RAISE EXCEPTION 'Native activity eligibility drifted';
     END IF;
     body:=replace(body,old_eligibility,new_eligibility);
     body:=replace(body,'SELECT v.id, rtrim(v.listing_url, ''/'') AS lot_url,','SELECT v.id, rtrim(coalesce(n.listing_url,v.listing_url), ''/'') AS lot_url,');
     body:=replace(body,$url$    AND v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
), lots AS$url$,$url$    AND coalesce(n.listing_url,v.listing_url) ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
), lots AS$url$);
   ELSE
     IF strpos(body,'WHERE n.id::text=a->>0')=0 THEN RAISE EXCEPTION 'Native board deduplication drifted'; END IF;
     body:=replace(body,'WHERE n.id::text=a->>0','WHERE rtrim(n.listing_url,''/'')=rtrim(a->>10,''/'')');
   END IF;
   body:=replace(body,'''basis'',''canonical_native_fold'',''currency'',''USD''',
     '''basis'',''canonical_native_fold'',''currency'',''USD'',''source_listing_claims'',n.source_listing_claims,''canonical_identity'',n.canonical_identity');
   EXECUTE body;
 END LOOP;
END $repair$;
SET statement_timeout = :'bat_board_prior_statement_timeout';
SET lock_timeout = :'bat_board_prior_lock_timeout';
