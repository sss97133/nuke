-- McCormick's existing publisher, organization, feed scheduler and calendar.
-- A complete catalog reading is retained before any bounded detail refresh.
BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '2s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations
    WHERE id='07fbc081-986c-43bc-ab9d-df24c24e513b' AND business_name='McCormick''s Auto Auctions'
      AND is_public AND is_active)
    OR NOT EXISTS (SELECT 1 FROM public.observation_sources
      WHERE id='006f01c3-e5fb-44f5-ab40-e55b0654de1c' AND slug='mccormicks' AND species='block_house') THEN
    RAISE EXCEPTION 'McCormick publisher/organization identity changed; inspect before linking';
  END IF;
  IF EXISTS (SELECT 1 FROM public.listing_feeds WHERE (source_slug='mccormicks' OR feed_url='https://www.classic-carauction.com/Home')
    AND (source_slug<>'mccormicks' OR feed_url<>'https://www.classic-carauction.com/Home'
      OR search_criteria->>'fetch_strategy' IS DISTINCT FROM 'mccormick_live'
      OR search_criteria->>'organization_id' IS DISTINCT FROM '07fbc081-986c-43bc-ab9d-df24c24e513b')) THEN
    RAISE EXCEPTION 'McCormick feed already configured differently';
  END IF;
END $$;
INSERT INTO public.listing_feeds (source_slug,display_name,feed_url,feed_type,search_criteria,enabled,poll_interval_minutes)
VALUES ('mccormicks','McCormick’s schedule and current inventory','https://www.classic-carauction.com/Home','html',
  '{"fetch_strategy":"mccormick_live","organization_id":"07fbc081-986c-43bc-ab9d-df24c24e513b","tier":1}',true,15)
ON CONFLICT (feed_url) DO NOTHING;

-- Extend the existing census writer for a complete native house roster. Keep
-- the nine-argument API unchanged; this overload has no default arguments.
CREATE OR REPLACE FUNCTION public.record_census(p_source_slug text,p_universe_total integer,
  p_universe_active integer,p_census_method text,p_census_confidence numeric,p_census_url text,
  p_by_year jsonb,p_by_make jsonb,p_raw_response jsonb,p_by_category jsonb,p_checked_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,public AS $census$
DECLARE result uuid;
BEGIN
  IF p_source_slug IS DISTINCT FROM 'mccormicks' OR p_census_method IS DISTINCT FROM 'house_roster_facet'
    OR p_census_url IS DISTINCT FROM 'https://www.classic-carauction.com/Home'
    OR p_raw_response->>'method' IS DISTINCT FROM 'mccormick_live_v1'
    OR p_checked_at IS NULL OR p_checked_at>now()+interval '1 minute' OR p_checked_at<now()-interval '5 minutes'
    OR jsonb_typeof(p_raw_response->'inventory') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_raw_response->'inventory') NOT BETWEEN 1 AND 1200
    OR p_universe_total IS DISTINCT FROM jsonb_array_length(p_raw_response->'inventory')
    OR p_universe_active IS NULL OR p_universe_active NOT BETWEEN 0 AND p_universe_total
    OR jsonb_typeof(p_by_category) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid complete McCormick census';
  END IF;
  INSERT INTO public.source_census(source_id,universe_total,universe_active,universe_historical,
    census_method,census_confidence,census_url,by_year,by_make,by_category,raw_response,census_at,next_census_at)
  SELECT s.id,p_universe_total,p_universe_active,p_universe_total-p_universe_active,
    p_census_method,p_census_confidence,p_census_url,p_by_year,p_by_make,p_by_category,p_raw_response,
    p_checked_at,p_checked_at+interval '15 minutes'
  FROM public.observation_sources s WHERE s.slug=p_source_slug
  RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'census publisher unavailable'; END IF;
  RETURN result;
END $census$;
REVOKE ALL ON FUNCTION public.record_census(text,integer,integer,text,numeric,text,jsonb,jsonb,jsonb,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_census(text,integer,integer,text,numeric,text,jsonb,jsonb,jsonb,jsonb,timestamptz) TO service_role;

-- Definer rights are limited to this closed projection of the protected source
-- census. No raw response, contact details, private parent IDs or errors escape.
CREATE OR REPLACE FUNCTION public.organization_source_inventory_read(p_organization_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $reader$
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
$reader$;
REVOKE ALL ON FUNCTION public.organization_source_inventory_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_source_inventory_read(uuid) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.organization_source_inventory_read(uuid) IS
  'Closed public publisher schedule/current catalog projection. Source-only rows remain visible; parent links require an unambiguous active native/title observation and public undeleted vehicle. No inferred sale or physical availability.';

-- Extend the existing calendar without replacing unrelated house behavior.
DO $patch$
DECLARE definition text; before text; after text;
BEGIN
  SELECT pg_get_functiondef('public.auction_calendar_read(integer,text,text,integer,integer)'::regprocedure) INTO definition;
  IF position('mccormick_live_calendar_v1' IN definition)>0 THEN RETURN; END IF;
  before := 'WHERE jsonb_typeof(k.value) = ''number''';
  after := $fragment$WHERE (jsonb_typeof(k.value) = 'number' OR (cs.house='mccormicks' AND k.value='null'::jsonb))
      AND (cs.house<>'mccormicks' OR (cs.raw_response->'sales'->k.key->>'ends_on')::date >= current_date)
      -- mccormick_live_calendar_v1$fragment$;
  IF (length(definition)-length(replace(definition,before,'')))/length(before)<>1 THEN RAISE EXCEPTION 'calendar listed anchor changed'; END IF;
  definition:=replace(definition,before,after);
  before:='COALESCE(li.meta ->> ''name'', initcap(replace(li.sale_key, ''-'', '' ''))), NULL,';
  after:='COALESCE(li.meta ->> ''name'', initcap(replace(li.sale_key, ''-'', '' ''))), li.meta ->> ''location'',';
  IF position(before IN definition)=0 THEN RAISE EXCEPTION 'calendar location anchor changed'; END IF;
  definition:=replace(definition,before,after);
  before:='''run_days'', COALESCE(r.days, ''[]''::jsonb), ''prior_sale'', s.prior_sale)';
  after:='''organization_id'', (SELECT o.id FROM listed li JOIN public.organizations o ON o.id::text=li.meta->>''organization_id'' WHERE li.hk=s.hk AND li.sale_key=s.sale_key AND o.is_public AND o.is_active LIMIT 1), ''source_url'', (SELECT li.meta->>''source_url'' FROM listed li WHERE li.hk=s.hk AND li.sale_key=s.sale_key LIMIT 1), '||before;
  IF position(before IN definition)=0 THEN RAISE EXCEPTION 'calendar source anchor changed'; END IF;
  definition:=replace(definition,before,after);
  EXECUTE definition;
END $patch$;

-- The existing correction owner only accepts past terminal clocks. A publisher's
-- scheduled run day is a different claim: permit this one native future clock
-- only when the latest admitted complete census, captured catalog and closed
-- public binding reader all agree. Keep the original rejection for other clocks.
DO $scheduled$
DECLARE definition text; before text; after text;
BEGIN
  SELECT pg_get_functiondef('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)'::regprocedure) INTO definition;
  IF position('mccormick_scheduled_clock_v1' IN definition)>0 THEN RETURN; END IF;
  before:='IF NOT isfinite(v_new) OR v_new > now() THEN';
  after:=$fragment$IF NOT isfinite(v_new) OR (v_new > now() AND NOT COALESCE((
        -- mccormick_scheduled_clock_v1: future scheduled testimony, never a result.
        v_field='ended_at' AND v_spec->>'precision'='day'
        AND p_source->>'type'='mccormick_scheduled_catalog_day'
        AND p_source->>'basis'='scheduled_run_day'
        AND v_new <= now()+interval '400 days'
        AND (v_new AT TIME ZONE 'UTC')::time = time '12:00:00'
        AND EXISTS (
          SELECT 1 FROM public.source_census c
          JOIN public.vehicle_events e ON e.id=p_event_id
          CROSS JOIN LATERAL jsonb_array_elements(public.organization_source_inventory_read(
            '07fbc081-986c-43bc-ab9d-df24c24e513b'::uuid)->'inventory') r
          WHERE c.id::text=p_source->>'census_id'
            AND c.source_id='006f01c3-e5fb-44f5-ab40-e55b0654de1c'
            AND c.census_method='house_roster_facet' AND c.raw_response->>'method'='mccormick_live_v1'
            AND c.census_at BETWEEN now()-interval '5 minutes' AND now()+interval '1 minute'
            AND NOT EXISTS (SELECT 1 FROM public.source_census newer WHERE newer.source_id=c.source_id
              AND newer.census_method=c.census_method AND newer.census_at>c.census_at)
            AND c.raw_response->'captures' @> jsonb_build_array(jsonb_build_object(
              'snapshot_id',p_source->>'snapshot_id','url','https://www.classic-carauction.com/auction-cars'))
            AND e.source_platform='mccormicks' AND e.event_status IN ('upcoming','pending')
            AND e.metadata->>'projection_method'='mccormick_live_v1'
            AND e.source_listing_id=(r->>'sale_key')||':'||(r->>'native_id')
            AND e.vehicle_id::text=r->>'vehicle_id' AND e.metadata->>'native_id'=r->>'native_id'
            AND e.source_url=r->>'source_url' AND p_source->>'ref'=e.source_url
            AND r->>'run_on'=to_char(v_new AT TIME ZONE 'UTC','YYYY-MM-DD')
        )), false)) THEN$fragment$;
  IF (length(definition)-length(replace(definition,before,'')))/length(before)<>1 THEN
    RAISE EXCEPTION 'supersession future-clock guard changed; inspect before extending';
  END IF;
  EXECUTE replace(definition,before,after);
END $scheduled$;
COMMIT;
