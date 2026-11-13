-- Connect existing retained McCormick identity labels to the property owner.
-- No new source fetch, price promotion, vehicle rewrite or replay scheduler.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

UPDATE public.observation_sources
SET supported_observations=array_append(supported_observations,'specification'::public.observation_kind)
WHERE id='006f01c3-e5fb-44f5-ab40-e55b0654de1c' AND slug='mccormicks'
 AND species='block_house' AND NOT 'specification'::public.observation_kind=ANY(supported_observations);

DO $patch$
DECLARE f text;
BEGIN
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE id='006f01c3-e5fb-44f5-ab40-e55b0654de1c'
  AND slug='mccormicks' AND species='block_house' AND 'specification'=ANY(supported_observations)) THEN
  RAISE EXCEPTION 'McCormick registered owner changed';END IF;
 f:=pg_get_functiondef('public.retained_native_listing_source(public.vehicle_observations)'::regprocedure);
 IF position('mccormick_retained_identity_v1' IN f)>0 THEN RETURN;END IF;
 IF md5(f)<>'133985db34d3cfba4c8e318e5b98b0ee' THEN
  RAISE EXCEPTION 'Native retained source owner changed; reconcile before extension';END IF;
 IF (length(f)-length(replace(f,E'BEGIN\n','')))/length(E'BEGIN\n')<>1 THEN
  RAISE EXCEPTION 'Native retained source entry changed';END IF;
 f:=replace(f,E'BEGIN\n',$entry$BEGIN
 -- mccormick_retained_identity_v1. Only the original captured listing labels:
 -- all other native property fields must be absent in this parser profile.
 IF p.source_id='006f01c3-e5fb-44f5-ab40-e55b0654de1c'::uuid THEN
  RETURN coalesce(p.kind::text='listing' AND p.extraction_method='mccormick_html_v1'
   AND p.is_superseded IS FALSE AND p.property_id IS NULL
   AND p.subject_type='vehicle' AND p.subject_id IS NULL
   AND p.confidence_score BETWEEN 0.6 AND 1
   AND isfinite(p.ingested_at) AND p.ingested_at<=statement_timestamp()
   AND isfinite(p.observed_at) AND p.observed_at<=p.ingested_at
   AND p.structured_data->>'parser'='mccormick_html_v1'
   AND p.structured_data->'source_claims_only'='true'::jsonb
   AND p.structured_data->'source_event_at'='null'::jsonb
   AND p.structured_data->>'evidence_scope' IS NULL
   AND NOT p.structured_data ?| ARRAY['color','interior_color','engine_size','transmission','drivetrain','engine_family_label','mileage_miles']
   AND p.extraction_metadata->>'parser'='mccormick_html_v1'
   AND p.extraction_metadata->>'html_sha256' ~ '^[0-9a-f]{64}$'
   AND p.extraction_metadata->>'snapshot_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   AND p.raw_source_ref='listing_page_snapshots:'||(p.extraction_metadata->>'snapshot_id')
   AND p.source_identifier='auctionid:'||(p.structured_data->>'source_id')||':'||(p.extraction_metadata->>'html_sha256')
   AND (p.structured_data->>'source_captured_at')::timestamptz=p.observed_at
   AND p.source_url=CASE
    WHEN p.structured_data->>'presentation'='archive'
     AND p.structured_data->>'auction_number' ~ '^[1-9][0-9]{0,3}$'
     AND p.structured_data->>'source_id' ~ '^[1-9][0-9]{0,9}$'
    THEN 'https://www.classic-carauction.com/auction-results?auctionnbr='||(p.structured_data->>'auction_number')||'&auctionid='||(p.structured_data->>'source_id')
    WHEN p.structured_data->>'presentation'='unknown' AND p.structured_data->>'source_id' ~ '^[1-9][0-9]{0,9}$'
    THEN 'https://www.classic-carauction.com/auction-cars?auctionid='||(p.structured_data->>'source_id')
    WHEN p.structured_data->>'presentation'='showroom' AND p.structured_data->>'source_id' ~ '^showroom:[1-9][0-9]{0,9}$'
    THEN 'https://www.classic-carauction.com/Showroom-Inventory?sp=1&id='||substr(p.structured_data->>'source_id',10)
   END
   AND EXISTS(SELECT FROM public.vehicle_observations q
    JOIN public.vehicles v ON v.id=q.vehicle_id
    JOIN public.observation_sources r ON r.id=q.source_id AND r.slug='mccormicks' AND 'specification'=ANY(r.supported_observations)
    JOIN public.listing_page_snapshots s ON s.id=(p.extraction_metadata->>'snapshot_id')::uuid
    WHERE q.id=p.id AND q.vehicle_id=p.vehicle_id AND q.source_id=p.source_id AND q.source_url=p.source_url
     AND q.kind=p.kind AND q.is_superseded IS FALSE AND q.property_id IS NULL
     AND q.subject_type='vehicle' AND q.subject_id IS NULL
     AND q.extraction_method=p.extraction_method AND q.structured_data=p.structured_data
     AND q.extraction_metadata=p.extraction_metadata AND q.raw_source_ref=p.raw_source_ref
     AND q.source_identifier=p.source_identifier AND q.observed_at=p.observed_at
     AND q.ingested_at=p.ingested_at AND q.confidence_score=p.confidence_score
     AND public.observation_is_public(q.kind,q.structured_data)
     AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
     AND s.success IS TRUE AND s.http_status=200 AND s.platform='mccormicks'
     AND s.listing_url=p.source_url AND s.html_sha256=p.extraction_metadata->>'html_sha256'
     AND s.fetched_at=p.observed_at AND s.created_at<=p.ingested_at),false);
 END IF;
$entry$);
 EXECUTE f;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
