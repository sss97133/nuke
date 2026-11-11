-- Aggregate the single retained queue without sorting/comparing its full JSON for every entry.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset queue_cost_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0'
 OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0'
 OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE body text:=pg_get_functiondef('public.live_bid_tape(integer)'::regprocedure);
 old_cte text:=$old$WITH ebay_queue AS MATERIALIZED (
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
)$old$;
 new_cte text:=$new$WITH ebay_queue AS MATERIALIZED (
 SELECT CASE WHEN valid THEN jsonb_build_object('state','recorded','queued_receipts',n,
   'state_updated_at',updated_at,'measured_at',statement_timestamp(),'oldest_source_read_at',oldest)
   ELSE jsonb_build_object('state','invalid','measured_at',statement_timestamp()) END summary
 FROM (
  SELECT s.updated_at,e.n,e.oldest,
   s.value->'version'='1'::jsonb AND jsonb_typeof(s.value->'entries')='array'
   AND CASE WHEN jsonb_typeof(s.value->'entries')='array' THEN jsonb_array_length(s.value->'entries')<=1000 ELSE false END
   AND isfinite(s.updated_at) AND s.updated_at<=statement_timestamp()
   AND e.valid valid
  FROM public.system_state s
  CROSS JOIN LATERAL (
   SELECT count(item) n,min(read_at) oldest,
    count(DISTINCT item->>'key')=count(item)
    AND coalesce(bool_and(valid AND isfinite(read_at) AND read_at<=s.updated_at),true) valid
   FROM (
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
   ) entries
  ) e
  WHERE s.key='ebay_auction_snapshot_replay_v1'
 ) checked
)$new$;
BEGIN
 IF strpos(body,new_cte)>0 AND strpos(body,old_cte)=0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,old_cte,'')))/length(old_cte)<>1 THEN
  RAISE EXCEPTION 'Queue reader contract drifted; inspect before changing aggregation';
 END IF;
 EXECUTE replace(body,old_cte,new_cte);
END;
$repair$;
SET statement_timeout = :'queue_cost_prior_statement_timeout';
SET lock_timeout = :'queue_cost_prior_lock_timeout';
