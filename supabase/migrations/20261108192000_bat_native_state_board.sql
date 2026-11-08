-- Read current native auction state without rewriting vehicle identity or reopening terminal lots.
-- The canonical live fold already protects metadata corrections from older/recovered comments.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 native_cte text := $native$recent_native AS MATERIALIZED (
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
)
$native$;
 definition text;
 target regprocedure:='public.market_lot_activity(uuid[],integer)'::regprocedure;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '12cdf28c670cfaa7c45e6cbb36f41eba' THEN
   RAISE EXCEPTION 'Native activity reader requires reviewed BaT episode reader; inspect drift before applying';
 END IF;
 SELECT pg_get_functiondef(target) INTO definition;
 definition:=replace(definition,'WITH settings AS MATERIALIZED (','WITH '||native_cte||', settings AS MATERIALIZED (');
 definition:=replace(definition,'FROM selected r JOIN public.vehicles v ON v.id = r.id CROSS JOIN settings s',
   'FROM selected r JOIN public.vehicles v ON v.id = r.id LEFT JOIN native n ON n.id=v.id CROSS JOIN settings s');
 definition:=replace(definition,'(CASE WHEN v.platform_source = ''bringatrailer'' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END)',
   '(CASE WHEN n.id IS NOT NULL THEN n.native_bid WHEN v.platform_source = ''bringatrailer'' THEN COALESCE(v.high_bid, v.sale_price) ELSE v.high_bid END)');
 definition:=replace(definition,'AND v.auction_end_date IS NOT NULL AND v.auction_end_date::timestamptz > s.as_of',
   'AND (n.id IS NULL OR (n.outcome=''live'' AND NOT n.has_terminal)) AND CASE WHEN n.id IS NOT NULL THEN n.ends_at ELSE v.auction_end_date::timestamptz END > s.as_of');
 definition:=replace(definition,'''current_bid_at_capture'', current_bid_at_capture,',
   '''current_bid_at_capture'', current_bid_at_capture, ''native_current_state'', (SELECT jsonb_build_object(''observation_id'',n.observation_id,''auction_event_id'',n.auction_event_id,''received_at'',n.received_at,''ingested_at'',n.ingested_at,''source_observed_at'',n.source_observed_at,''basis'',''canonical_native_fold'',''currency'',''USD'') FROM native n WHERE n.id=lots.id),');
 EXECUTE definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.market_pulse_live()'::regprocedure) IS DISTINCT FROM 'e265bd4c50a23cc7aa61ac290296f0ec' THEN
   RAISE EXCEPTION 'Live board wrapper drifted; inspect before applying native-state overlay';
 END IF;
 EXECUTE $wrapper$CREATE OR REPLACE FUNCTION public.market_pulse_live() RETURNS jsonb
 LANGUAGE sql STABLE SET search_path TO public,pg_temp SET statement_timeout TO '10s'
 AS $body$WITH $wrapper$||native_cte||$wrapper$,
 base AS MATERIALIZED (
   SELECT coalesce((SELECT payload FROM public.market_pulse_live_snapshot
     WHERE id=1 AND built_at>now()-interval '5 minutes'),public.market_pulse_live_build()) p
 ), native_rows AS (
   SELECT n.id,jsonb_build_array(n.id,n.year,n.make,n.model,
     CASE WHEN n.native_bid>=0 AND n.native_bid<'Infinity'::numeric THEN n.native_bid END,
     n.ends_at,n.received_at,n.listed_at,n.image_url,n.no_reserve,n.listing_url,n.title,
     hp.predicted_low,hp.predicted_hammer,hp.predicted_high,hp.price_tier,hp.comp_count,
     public.heat_of(n.native_bid::float8,hp.predicted_hammer::float8,hp.price_tier,n.ends_at,now())) a
   FROM native n LEFT JOIN LATERAL (
     SELECT predicted_low,predicted_hammer,predicted_high,price_tier,comp_count FROM public.hammer_predictions h
     WHERE h.vehicle_id=n.id AND h.model_version=31 ORDER BY h.predicted_at DESC LIMIT 1
   ) hp ON true
   WHERE n.outcome='live' AND NOT n.has_terminal AND n.sale_status='auction_live' AND n.ends_at>now()
 ), rows AS (
   SELECT a FROM base,jsonb_array_elements(p->'auctions') a
     WHERE (a->>5)::timestamptz>now() AND NOT EXISTS(SELECT 1 FROM native n WHERE n.id::text=a->>0)
   UNION ALL SELECT a FROM native_rows
 )
 SELECT jsonb_set(p,'{auctions}',coalesce((SELECT jsonb_agg(a ORDER BY (a->>5)::timestamptz) FROM rows),'[]'::jsonb))
   ||jsonb_build_object('native_state',coalesce((SELECT jsonb_object_agg(n.id::text,jsonb_build_object(
     'observation_id',n.observation_id,'auction_event_id',n.auction_event_id,'received_at',n.received_at,
     'ingested_at',n.ingested_at,'source_observed_at',n.source_observed_at,'basis','canonical_native_fold','currency','USD'))
     FROM native n JOIN native_rows r ON r.id=n.id),'{}'::jsonb))
 FROM base
 $body$;$wrapper$;
END $patch$;
COMMENT ON FUNCTION public.market_pulse_live() IS 'Existing v3 public board with bounded recent canonical native BaT state over the cached inventory. Exact episode/native post and admitted public receipt binding; terminal outcomes remain excluded. Row updated_at is native receipt clock for overlaid states; native_state retains source/admission provenance. No full inventory or gap-free source coverage claim.';
COMMIT;
