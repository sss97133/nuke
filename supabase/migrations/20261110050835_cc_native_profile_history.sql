-- Add a closed public-source projection to the existing sanitized profile owner.
-- Raw observations retain their name-sensitive RLS; no testimony or grants change.
DO $migration$
DECLARE definition text; replacement text; old_statement text:=current_setting('statement_timeout');
 old_lock text:=current_setting('lock_timeout');
BEGIN
 PERFORM set_config('statement_timeout',CASE WHEN old_statement='0' OR old_statement::interval>interval '10 seconds' THEN '10s' ELSE old_statement END,true);
 PERFORM set_config('lock_timeout',CASE WHEN old_lock='0' OR old_lock::interval>interval '2 seconds' THEN '2s' ELSE old_lock END,true);
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE id='892f9062-8d05-4281-8119-9a197135d593'
  AND slug='collecting-cars' AND species='timed_auction' AND requires_auth=false
  AND 'listing'=ANY(supported_observations)) THEN RAISE EXCEPTION 'CC public source contract changed'; END IF;
 SELECT pg_get_functiondef('public.get_vehicle_specs(uuid[],boolean,jsonb)'::regprocedure) INTO definition;
 replacement:=$body$
 -- cc_native_profile_history_v1: publisher quantities, never verified sales.
 -- Choose the latest capture before closed/withdrawal qualification.
 WITH recent AS MATERIALIZED (
  SELECT o.* FROM public.vehicle_observations o
  WHERE o.vehicle_id=vehicle AND o.kind='listing'
   AND o.source_id='892f9062-8d05-4281-8119-9a197135d593'
   AND o.extraction_method='cc_native_listing_v1'
   AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=vehicle AND v.is_public=true
    AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND v.status IS DISTINCT FROM 'merged'
    AND coalesce(v.listing_kind,'')<>'non_vehicle_item')
  ORDER BY o.observed_at DESC NULLS LAST,o.ingested_at DESC,o.id DESC LIMIT 51
 ), bounded AS MATERIALIZED (
  SELECT * FROM recent ORDER BY observed_at DESC NULLS LAST,ingested_at DESC,id DESC LIMIT 50
 ), latest AS MATERIALIZED (
  SELECT DISTINCT ON (rtrim(source_url,'/')) * FROM bounded
  ORDER BY rtrim(source_url,'/'),observed_at DESC NULLS LAST,ingested_at DESC,id DESC
 ), qualified AS MATERIALIZED (
  SELECT o.*,o.structured_data AS d FROM latest o
  JOIN public.observation_sources source ON source.id=o.source_id AND source.slug='collecting-cars'
   AND source.species='timed_auction' AND source.requires_auth=false AND 'listing'=ANY(source.supported_observations)
  JOIN public.listing_page_snapshots s ON s.id=CASE
   WHEN pg_input_is_valid(o.extraction_metadata#>>'{source_capture,snapshot_id}','uuid')
   THEN (o.extraction_metadata#>>'{source_capture,snapshot_id}')::uuid END
  WHERE o.is_superseded=false AND o.superseded_by IS NULL AND o.subject_type='vehicle' AND o.subject_id IS NULL AND o.submitted_by_user_id IS NULL
   AND o.source_url ~ '^https://collectingcars[.]com/for-sale/[a-zA-Z0-9+-]+$'
   AND o.structured_data->>'url'=o.source_url AND o.structured_data->>'listing_url'=o.source_url
   AND o.structured_data->>'listing_id' ~ '^[0-9]+$' AND o.structured_data->>'lot_type'='car'
   AND o.structured_data->'source_claims_only'='true'::jsonb AND o.structured_data->>'capture_kind'='listing_page'
   AND o.structured_data->>'stage' IN ('sold','unsold')
   AND (o.structured_data->>'sale_outcome'=o.structured_data->>'stage'
    OR (o.structured_data->>'stage'='unsold' AND o.structured_data->>'sale_outcome'='sealed_unsold'))
   AND o.raw_source_ref='listing_page_snapshots:'||s.id::text
   AND s.platform='collectingcars' AND s.listing_url=o.source_url AND s.success=true AND s.http_status=200
   AND s.html_sha256 ~ '^[0-9a-f]{64}$' AND s.html_sha256=o.extraction_metadata#>>'{source_capture,sha256}'
   AND coalesce(s.metadata->>'rows_only','false')='false' AND coalesce(s.metadata->>'withdrawn','false')='false'
   AND s.fetched_at=o.observed_at AND s.created_at>=s.fetched_at AND s.created_at<=statement_timestamp()
   AND o.extraction_metadata#>>'{source_capture,source_url}'=o.source_url
   AND CASE WHEN pg_input_is_valid(o.extraction_metadata#>>'{source_capture,source_read_at}','timestamptz')
    THEN (o.extraction_metadata#>>'{source_capture,source_read_at}')::timestamptz=o.observed_at ELSE false END
   AND isfinite(o.observed_at) AND o.observed_at<=statement_timestamp()
   AND o.ingested_at>=o.observed_at AND o.ingested_at<=statement_timestamp()
 ), entries AS (
  SELECT jsonb_build_object('observation_id',id,'source_url',source_url,'source_listing_id',d->>'listing_id',
   'source','collecting-cars','qualification','publisher_reported_unverified',
   'reported_outcome',d->>'stage',
   'reported_amount_kind',CASE WHEN d->>'stage'='sold' AND d->>'price_kind'='sold' THEN 'sale_price'
    WHEN d->>'stage'='unsold' AND d->>'price_kind'='high_bid' THEN 'high_bid' END,
   'reported_amount',CASE WHEN ((d->>'stage'='sold' AND d->>'price_kind'='sold') OR (d->>'stage'='unsold' AND d->>'price_kind'='high_bid'))
    AND jsonb_typeof(d->'price_amount')='number' THEN CASE WHEN (d->>'price_amount')::numeric>0
     THEN d->'price_amount' END END,
   'currency',CASE WHEN d->>'currency' IN ('USD','GBP','EUR','AUD','CAD','CHF','JPY','HKD','SGD','NZD','AED','ZAR','SEK','NOK','DKK') THEN d->>'currency' END,
   'reported_event_at',CASE WHEN coalesce(d->>'sold_at',d->>'auction_end_at') ~ '^\d{4}-\d{2}-\d{2}T'
    AND pg_input_is_valid(CASE WHEN d->>'stage'='sold' THEN d->>'sold_at' ELSE d->>'auction_end_at' END,'timestamptz')
    THEN CASE WHEN (CASE WHEN d->>'stage'='sold' THEN d->>'sold_at' ELSE d->>'auction_end_at' END)::timestamptz<=observed_at
     THEN (CASE WHEN d->>'stage'='sold' THEN d->>'sold_at' ELSE d->>'auction_end_at' END)::timestamptz END END,
   -- Extractor mileage is normalized miles even when mileage_unit retains km.
   -- Use the original explicit native reading, not that mixed-unit pair.
   'mileage',CASE WHEN m.parts IS NOT NULL AND replace(m.parts[1],',','')::numeric<10000000
    AND ((m.parts[2] IN ('mi','mile','miles') AND d->>'mileage_unit'='mi')
     OR (m.parts[2] IN ('km','kilometres','kilometers') AND d->>'mileage_unit'='km'))
    THEN replace(m.parts[1],',','')::numeric END,
   'mileage_unit',CASE WHEN m.parts IS NOT NULL AND replace(m.parts[1],',','')::numeric<10000000
    AND ((m.parts[2] IN ('mi','mile','miles') AND d->>'mileage_unit'='mi')
     OR (m.parts[2] IN ('km','kilometres','kilometers') AND d->>'mileage_unit'='km'))
    THEN d->>'mileage_unit' END,
   'bid_count',CASE WHEN jsonb_typeof(d->'bid_count')='number' THEN CASE
    WHEN (d->>'bid_count')::numeric BETWEEN 0 AND 10000000 AND (d->>'bid_count')::numeric=trunc((d->>'bid_count')::numeric)
    THEN d->'bid_count' END END,
   'source_captured_at',observed_at,'ingested_at',ingested_at) AS entry,observed_at,id
  FROM qualified
  CROSS JOIN LATERAL (SELECT regexp_match(lower(btrim(d->>'mileage_raw')),
   '^([0-9]{1,7}|[0-9]{1,3}(,[0-9]{3}){1,2})[ ]*(mi|mile|miles|km|kilometres|kilometers)([ ]+\(indicated\))?$') AS raw_parts) raw
  CROSS JOIN LATERAL (SELECT CASE WHEN raw.raw_parts IS NOT NULL THEN ARRAY[raw.raw_parts[1],raw.raw_parts[3]] END AS parts) m
 ) SELECT jsonb_build_object('reader','cc_native_profile_history_v1','entries',
  coalesce((SELECT jsonb_agg(entry ORDER BY observed_at DESC,id DESC) FROM entries),'[]'::jsonb),
  'capture_limit',50,'has_more_captures',(SELECT count(*)>50 FROM recent)) INTO native_history;
 RETURN NEXT base||jsonb_build_object('native_listing_history',native_history,'typed_claims_status'$body$;
 IF position('-- cc_native_profile_history_v1' in definition)>0 THEN
  IF position(replacement in definition)=0 OR position('DECLARE native_history jsonb; base jsonb;' in definition)=0 THEN
   RAISE EXCEPTION 'CC profile history replay drift'; END IF;
 ELSE
  IF md5(definition)<>'72ca776a720d456f7928ffe7adbd598d' THEN RAISE EXCEPTION 'Profile source reader changed'; END IF;
  definition:=replace(definition,'DECLARE base jsonb;','DECLARE native_history jsonb; base jsonb;');
  definition:=replace(definition,' RETURN NEXT base||jsonb_build_object(''typed_claims_status''',replacement);
  EXECUTE definition;
 END IF;
 PERFORM set_config('statement_timeout',old_statement,true);
 PERFORM set_config('lock_timeout',old_lock,true);
END $migration$;
