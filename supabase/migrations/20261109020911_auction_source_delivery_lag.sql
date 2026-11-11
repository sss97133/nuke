-- Public aggregate delivery evidence only; no raw queue, identifiers, feed URLs or grants.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset delivery_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0'
 OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0'
 OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE body text:=pg_get_functiondef('public.live_bid_tape(integer)'::regprocedure);
 old_start text:='WITH catalog(house,label,feed_slug,native_slug) AS (VALUES';
 new_start text:=$cte$WITH ebay_queue AS MATERIALIZED (
 SELECT CASE WHEN valid THEN jsonb_build_object('state','recorded','queued_receipts',n,
   'state_updated_at',updated_at,'measured_at',statement_timestamp(),'oldest_source_read_at',oldest)
   ELSE jsonb_build_object('state','invalid','measured_at',statement_timestamp()) END summary
 FROM (
  SELECT s.updated_at,count(e.item) n,min(e.read_at) oldest,
   s.value->'version'='1'::jsonb AND jsonb_typeof(s.value->'entries')='array'
   AND CASE WHEN jsonb_typeof(s.value->'entries')='array' THEN jsonb_array_length(s.value->'entries')<=1000 ELSE false END
   AND isfinite(s.updated_at) AND s.updated_at<=statement_timestamp()
   AND count(DISTINCT e.item->>'key')=count(e.item)
   AND coalesce(bool_and(e.valid AND isfinite(e.read_at) AND e.read_at<=s.updated_at) FILTER(WHERE e.item IS NOT NULL),true) valid
  FROM public.system_state s
  LEFT JOIN LATERAL (
   SELECT item,CASE WHEN pg_input_is_valid(item->>'readAt','timestamp with time zone')
     THEN (item->>'readAt')::timestamptz END read_at,
    coalesce(jsonb_typeof(item)='object' AND item->>'key' ~ '^[0-9]{9,15}$'
     AND item->>'vehicleId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     AND item->>'snapshotId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     AND item->>'sha256' ~ '^[0-9a-f]{64}$'
     AND item->>'readAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
     AND item->>'endAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
     AND pg_input_is_valid(item->>'readAt','timestamp with time zone')
     AND pg_input_is_valid(item->>'endAt','timestamp with time zone')
     AND CASE WHEN pg_input_is_valid(item->>'endAt','timestamp with time zone') THEN isfinite((item->>'endAt')::timestamptz) ELSE false END
     AND item->>'method' IN ('search','getItem')
     AND item->>'url' IN ('https://ebay.com/itm/'||(item->>'key'),'https://www.ebay.com/itm/'||(item->>'key'))
     AND item->>'pageUrl' LIKE 'https://api.ebay.com/buy/browse/v1/%',false) valid
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.value->'entries')='array'
     THEN CASE WHEN jsonb_array_length(s.value->'entries')<=1000 THEN s.value->'entries' ELSE '[]'::jsonb END
     ELSE '[]'::jsonb END) item
  ) e ON true
  WHERE s.key='ebay_auction_snapshot_replay_v1'
  GROUP BY s.updated_at,s.value
 ) checked
), catalog(house,label,feed_slug,native_slug) AS (VALUES$cte$;
 old_status text:=$old$'collection_state',collection_state,$old$;
 new_status text:=$new$'collection_state',CASE WHEN house='ebay-motors' AND EXISTS(
     SELECT FROM cron.job WHERE jobname='ebay-motors-auctions' AND active) THEN 'scheduled' ELSE collection_state END,
   'delivery_queue',CASE WHEN house='ebay-motors' THEN coalesce((SELECT summary FROM ebay_queue),
     jsonb_build_object('state','unrecorded','measured_at',statement_timestamp())) END,
   'native_poll_minutes',CASE WHEN house='purplewave' THEN (
     SELECT CASE WHEN count(*)>0 AND count(DISTINCT poll_interval_minutes)=1
       AND bool_and(poll_interval_minutes>0 AND poll_interval_minutes<=10080) THEN min(poll_interval_minutes) END
     FROM public.listing_feeds WHERE source_slug='purplewave' AND enabled
       AND search_criteria->>'fetch_strategy'='purplewave_public_json') END,$new$;
BEGIN
 IF strpos(body,new_start)>0 AND strpos(body,new_status)>0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,old_start,'')))/length(old_start)<>1
 OR (length(body)-length(replace(body,old_status,'')))/length(old_status)<>1 THEN
   RAISE EXCEPTION 'Source status contract drifted; inspect before applying delivery evidence';
 END IF;
 EXECUTE replace(replace(body,old_start,new_start),old_status,new_status);
END;
$repair$;
SET statement_timeout = :'delivery_prior_statement_timeout';
SET lock_timeout = :'delivery_prior_lock_timeout';
