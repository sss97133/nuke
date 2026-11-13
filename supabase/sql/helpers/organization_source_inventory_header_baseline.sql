-- Existing reader snapshot for disposable contract replay; no testimony or new owner.
CREATE OR REPLACE FUNCTION public.organization_source_inventory_read(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH publisher AS (
  SELECT os.id source_id, f.id feed_id, f.last_polled_at, f.last_error
  FROM public.organizations o
  JOIN public.listing_feeds f ON f.search_criteria->>'organization_id'=o.id::text
    AND f.source_slug='mccormicks' AND f.feed_url='https://www.classic-carauction.com/Home'
    AND f.search_criteria->>'fetch_strategy'='mccormick_live'
  JOIN public.observation_sources os ON os.slug=f.source_slug
  WHERE o.id=p_organization_id AND o.is_public AND o.is_active
), census AS MATERIALIZED (
  SELECT c.* FROM public.source_census c JOIN publisher p ON p.source_id=c.source_id
  WHERE c.census_method='house_roster_facet' AND c.raw_response->>'method'='mccormick_live_v1'
    AND c.raw_response->>'organization_id'=p_organization_id::text
  ORDER BY c.census_at DESC,c.id DESC LIMIT 1
), sales AS MATERIALIZED (
  SELECT s.* FROM census c,
    jsonb_to_recordset((SELECT jsonb_agg(value) FROM jsonb_each(c.raw_response->'sales')))
      AS s(sale_key text,name text,starts_on date,ends_on date,location text,source_url text,lots_listed integer)
  WHERE s.ends_on >= current_date AND s.sale_key ~ '^mccormicks-[0-9]+$'
    AND s.source_url ~ '^https://www[.]classic-carauction[.]com/(Auction-[0-9]+|news_stories[.]cfm[?]newsid=[0-9]+)$'
), roster AS MATERIALIZED (
  SELECT r.* FROM census c, jsonb_to_recordset(c.raw_response->'inventory')
    AS r(native_id text,source_url text,inventory_kind text,sale_key text,lot_number text,year integer,
      make text,model text,title text,source_status text,asking_amount numeric,currency text,run_on date)
  WHERE (r.inventory_kind='auction' AND r.native_id ~ '^[0-9]+$'
      AND r.source_url='https://www.classic-carauction.com/auction-cars?auctionid='||r.native_id
      AND EXISTS (SELECT 1 FROM sales s WHERE s.sale_key=r.sale_key))
    OR (r.inventory_kind='showroom' AND r.native_id ~ '^showroom:[0-9]+$'
      AND r.source_url='https://www.classic-carauction.com/Showroom-Inventory?sp=1&id='||substring(r.native_id from 10)
      AND r.source_status IN ('available','sold'))
), matching AS MATERIALIZED (
  SELECT r.native_id, o.id, o.vehicle_id, o.observed_at,
    row_number() OVER (PARTITION BY r.native_id ORDER BY o.observed_at DESC,o.ingested_at DESC,o.id DESC) rank,
    v.is_public AND v.deleted_at IS NULL AND COALESCE(v.listing_kind,'vehicle')<>'non_vehicle_item' eligible
  FROM publisher p JOIN public.vehicle_observations o ON o.source_id=p.source_id
    AND o.kind='listing' AND NOT o.is_superseded
  JOIN roster r ON o.structured_data->>'source_id'=r.native_id
    AND (o.source_url=r.source_url OR (r.inventory_kind='auction'
      AND o.source_url='https://www.classic-carauction.com/auction-cars'
      AND o.structured_data->>'evidence_scope'='catalog_row'
      AND o.structured_data->>'parser'='mccormick_catalog_v1'))
    AND upper(regexp_replace(o.structured_data->>'title','\s+',' ','g'))=upper(regexp_replace(r.title,'\s+',' ','g'))
  LEFT JOIN public.vehicles v ON v.id=o.vehicle_id
), binding AS (
  SELECT native_id,count(DISTINCT vehicle_id) parents,
    max(vehicle_id::text) FILTER (WHERE eligible) public_vehicle_id,
    max(id::text) FILTER (WHERE eligible AND rank=1) observation_id,
    max(observed_at) detail_captured_at
  FROM matching GROUP BY native_id
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM publisher) THEN NULL ELSE jsonb_build_object(
  'source','mccormicks','checked_at',(SELECT census_at FROM census),
  'last_attempt_at',(SELECT last_polled_at FROM publisher LIMIT 1),
  'refresh_failed',COALESCE((SELECT last_error IS NOT NULL FROM publisher LIMIT 1),false),
  'stale',COALESCE((SELECT census_at < now()-interval '60 minutes' FROM census),true),
  'sales',COALESCE((SELECT jsonb_agg(jsonb_build_object('sale_key',sale_key,'name',name,
    'starts_on',starts_on,'ends_on',ends_on,'location',location,'source_url',source_url,'lots_listed',lots_listed)
    ORDER BY starts_on,sale_key) FROM sales),'[]'::jsonb),
  'inventory',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'native_id',r.native_id,'source_url',r.source_url,'inventory_kind',r.inventory_kind,'sale_key',r.sale_key,
    'lot_number',r.lot_number,'year',r.year,'make',r.make,'model',r.model,'title',r.title,
    'source_status',r.source_status,'asking_amount',r.asking_amount,'currency',NULL,'run_on',r.run_on,
    'vehicle_id',CASE WHEN b.parents=1 AND b.observation_id IS NOT NULL THEN b.public_vehicle_id END,
    'observation_id',CASE WHEN b.parents=1 AND b.observation_id IS NOT NULL THEN b.observation_id END,
    'detail_captured_at',b.detail_captured_at)
    ORDER BY r.inventory_kind,r.run_on NULLS LAST,r.lot_number,r.native_id)
    FROM roster r LEFT JOIN binding b USING(native_id)),'[]'::jsonb)) END;
$function$;
