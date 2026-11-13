-- Read-only, service-only cursor over the existing canonical admission log.
SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout \gset cc_prior_
SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval = interval '0' OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout', CASE WHEN current_setting('lock_timeout')::interval = interval '0' OR current_setting('lock_timeout')::interval > interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END, false);
CREATE OR REPLACE FUNCTION public.cc_latest_snapshot_states(p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public SET statement_timeout = '5s'
AS $fn$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(p_lots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lots)>200 THEN
  RAISE EXCEPTION 'At most 200 exact CC lot owners required';
 END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_lots) j WHERE jsonb_typeof(j) IS DISTINCT FROM 'object'
  OR coalesce(j->>'vehicle_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  OR coalesce(j->>'source_url','') !~ '^https://collectingcars[.]com/for-sale/[a-zA-Z0-9-]+$') THEN
  RAISE EXCEPTION 'Exact CC vehicle and source URL required';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO result
 FROM (SELECT DISTINCT (j->>'vehicle_id')::uuid vehicle_id,j->>'source_url' source_url FROM jsonb_array_elements(p_lots) j) lots
 CROSS JOIN public.observation_sources s
 CROSS JOIN LATERAL (
   SELECT v.id,v.vehicle_id,v.source_url,v.source_identifier,v.observed_at,v.extraction_method,v.structured_data
   FROM public.vehicle_observations v
   WHERE v.vehicle_id=lots.vehicle_id AND v.source_id=s.id AND v.kind='bid' AND v.source_url=lots.source_url
     AND v.is_superseded=false
     AND ((v.extraction_method='cc_typesense_board_bid_v1' AND v.source_identifier LIKE 'collecting-cars-bid:%')
       OR (v.extraction_method='cc_typesense_board_snapshot_v2' AND v.source_identifier LIKE 'collecting-cars-snapshot:v2:%' AND v.structured_data->>'capture_kind'='auction_bid_snapshot'))
   ORDER BY v.observed_at DESC,v.id DESC LIMIT 2
 ) o WHERE s.slug='collecting-cars';
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.cc_latest_snapshot_states(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cc_latest_snapshot_states(jsonb) TO service_role;
COMMENT ON FUNCTION public.cc_latest_snapshot_states(jsonb) IS 'Service-only read of at most two latest canonical CC bid/snapshot claims for each of <=200 exact vehicle/source URL pairs. No writes, source requests, identity creation or public access.';
SELECT set_config('statement_timeout', :'cc_prior_statement_timeout', false);
SELECT set_config('lock_timeout', :'cc_prior_lock_timeout', false);
