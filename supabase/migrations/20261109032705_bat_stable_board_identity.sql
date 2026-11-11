-- Stable canonical profile attribution is independent of quote freshness.
-- Only array slot zero changes; source quote, clocks and identity claims remain intact.
SELECT current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout \gset bat_stable_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0' OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0' OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE
 body text; source_uuid uuid; old_fragments text[]; new_fragments text[]; i integer;
BEGIN
 SELECT id INTO STRICT source_uuid FROM public.observation_sources
 WHERE slug='bat' AND species='timed_auction' AND 'bid'=ANY(supported_observations);
 body:=pg_get_functiondef('public.market_pulse_live()'::regprocedure);
 IF strpos(body,'stable_links AS MATERIALIZED')>0 THEN RETURN; END IF;
 old_fragments:=ARRAY[$old$ ), rows AS ($old$,$old$   SELECT a FROM base,jsonb_array_elements(p->'auctions') a
     WHERE (a->>5)::timestamptz>now() AND NOT EXISTS(SELECT 1 FROM native n WHERE rtrim(n.listing_url,'/')=rtrim(a->>10,'/'))$old$,$old$ FROM base
 $old$];
 new_fragments:=ARRAY[$new$ ), stable_inventory AS MATERIALIZED (
 SELECT DISTINCT (a->>0)::uuid locator_id, rtrim(a->>10,'/') lot_url
 FROM base CROSS JOIN LATERAL jsonb_array_elements(p->'auctions') a
 WHERE (a->>5)::timestamptz>now() AND pg_input_is_valid(a->>0,'uuid')
 AND a->>10 ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
), stable_candidates AS MATERIALIZED (
 SELECT i.locator_id,i.lot_url,c.id canonical_vehicle_id,ep.id episode_id,e.id auction_event_id,witness.id observation_id
 FROM stable_inventory i
 JOIN public.vehicles locator ON locator.id=i.locator_id
 CROSS JOIN LATERAL (
  SELECT ep.id,ep.vehicle_id FROM public.vehicle_events ep
  WHERE ep.source_platform='bat' AND ep.event_type='auction' AND ep.event_status IN('active','live')
   AND ep.sold_at IS NULL AND ep.duplicate_of_event_id IS NULL AND ep.ended_at>now()
   AND ep.source_url IN(i.lot_url,i.lot_url||'/') AND ep.vehicle_id<>locator.id
   AND NOT EXISTS(SELECT 1 FROM public.vehicle_events other WHERE other.source_platform='bat'
    AND other.event_type='auction' AND other.event_status IN('active','live') AND other.sold_at IS NULL
    AND other.duplicate_of_event_id IS NULL AND other.source_url IN(i.lot_url,i.lot_url||'/') AND other.id<>ep.id)
  OFFSET 0
 ) ep
 JOIN public.vehicles c ON c.id=ep.vehicle_id
 CROSS JOIN LATERAL (
  SELECT e.id FROM public.auction_events_canonical e
  WHERE e.vehicle_id=c.id AND e.source='bat' AND e.source_url IN(i.lot_url,i.lot_url||'/')
   AND e.outcome='live' AND e.auction_end_date>now()
   AND NOT EXISTS(SELECT 1 FROM public.auction_events_canonical other
    WHERE other.source='bat' AND other.source_url IN(i.lot_url,i.lot_url||'/') AND other.id<>e.id)
  OFFSET 0
 ) e
 CROSS JOIN LATERAL (
  SELECT o.id FROM public.vehicle_observations o
  WHERE o.vehicle_id=c.id AND o.kind='bid'
   AND o.source_id=__BAT_SOURCE_UUID__::uuid
   AND o.source_url IN(i.lot_url,i.lot_url||'/') AND o.extraction_method='bat_public_live_v1'
   AND o.source_identifier LIKE 'public-live:%' AND NOT coalesce(o.is_superseded,false)
   AND o.structured_data->>'projection_error' IS NULL AND public.observation_is_public(o.kind,o.structured_data)
   AND o.structured_data->>'native_post_id'=locator.origin_metadata->>'external_id'
   AND o.vehicle_match_signals->>'monitor_vehicle_id'=locator.id::text
   AND o.vehicle_match_signals->>'binding_resolved_by'='lot_slug'
   AND o.vehicle_match_signals->>'source_url_match'='true'
  LIMIT 1
 ) witness
 WHERE locator.is_public AND locator.deleted_at IS NULL AND locator.merged_into_vehicle_id IS NULL
  AND locator.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  AND locator.origin_metadata->>'source'='bat_auctions_page'
  AND locator.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
  AND locator.listing_url IN(i.lot_url,i.lot_url||'/')
  AND c.is_public AND c.deleted_at IS NULL AND c.merged_into_vehicle_id IS NULL
  AND c.listing_kind IS DISTINCT FROM 'non_vehicle_item'
) , stable_links AS MATERIALIZED (
 SELECT candidate.*,CASE WHEN EXISTS(SELECT 1 FROM stable_inventory other
   WHERE other.lot_url=candidate.lot_url AND other.locator_id<>candidate.locator_id)
 THEN 'ambiguous_inventory_locator' WHEN EXISTS(
   SELECT 1 FROM base CROSS JOIN LATERAL jsonb_array_elements(p->'auctions') other
   WHERE other->>0=candidate.canonical_vehicle_id::text
    AND rtrim(other->>10,'/') IS DISTINCT FROM candidate.lot_url)
   OR EXISTS(SELECT 1 FROM stable_candidates other
    WHERE other.canonical_vehicle_id=candidate.canonical_vehicle_id AND other.lot_url<>candidate.lot_url)
   OR EXISTS(SELECT 1 FROM native_rows other
    WHERE other.id=candidate.canonical_vehicle_id AND rtrim(other.a->>10,'/')<>candidate.lot_url)
 THEN 'multiple_lot_presentations' END refusal_reason
 FROM stable_candidates candidate
), rows AS ($new$,$new$   SELECT CASE WHEN link.canonical_vehicle_id IS NOT NULL AND link.refusal_reason IS NULL
     THEN jsonb_set(a,'{0}',to_jsonb(link.canonical_vehicle_id::text)) ELSE a END a
   FROM base CROSS JOIN LATERAL jsonb_array_elements(p->'auctions') a
   LEFT JOIN stable_links link ON link.locator_id::text=a->>0 AND link.lot_url=rtrim(a->>10,'/')
     WHERE (a->>5)::timestamptz>now() AND NOT EXISTS(SELECT 1 FROM native n WHERE rtrim(n.listing_url,'/')=rtrim(a->>10,'/'))$new$,$new$   ||jsonb_build_object('identity_links',coalesce((SELECT jsonb_object_agg(link.lot_url,
     CASE WHEN link.refusal_reason='ambiguous_inventory_locator' THEN jsonb_build_object('applied',false,'refusal_reason',link.refusal_reason) ELSE jsonb_build_object('locator_vehicle_id',link.locator_id,'canonical_vehicle_id',link.canonical_vehicle_id,
       'episode_id',link.episode_id,'auction_event_id',link.auction_event_id,'observation_id',link.observation_id,
       'basis','retained_native_current_episode','applied',link.refusal_reason IS NULL,'refusal_reason',link.refusal_reason) END)
     FROM stable_links link WHERE NOT EXISTS(SELECT 1 FROM native n WHERE rtrim(n.listing_url,'/')=link.lot_url)),'{}'::jsonb))
 FROM base
 $new$];
 FOR i IN 1..array_length(old_fragments,1) LOOP
  IF (length(body)-length(replace(body,old_fragments[i],'')))/length(old_fragments[i])<>1 THEN
   RAISE EXCEPTION 'Stable board identity body drifted at fragment %; inspect before applying',i;
  END IF;
  body:=replace(body,old_fragments[i],replace(new_fragments[i],'__BAT_SOURCE_UUID__',quote_literal(source_uuid::text)));
 END LOOP;
 EXECUTE body;
END $repair$;
SET statement_timeout = :'bat_stable_prior_statement_timeout';
SET lock_timeout = :'bat_stable_prior_lock_timeout';
