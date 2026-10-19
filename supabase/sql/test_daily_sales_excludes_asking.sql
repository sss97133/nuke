-- Empty disposable PG17 only. Historical fixture proves the old contaminated result first.
\ir test_family_horizon_movers.sql
CREATE TEMP TABLE unchanged_horizons AS
SELECT h, public.family_share_movers_build(5,0,h) - 'as_of' AS payload
FROM unnest(ARRAY['upcoming','1w','1m','3m','6m','1y','5y']) h;
CREATE TEMP TABLE owner_before AS
SELECT oid,proowner,proacl FROM pg_proc
WHERE oid='public.family_share_movers_build(integer,integer,text)'::regprocedure;
CREATE TEMP TABLE sources_before AS
SELECT jsonb_agg(to_jsonb(m) ORDER BY id) AS payload FROM public.marketplace_listings m;
\ir ../migrations/20261019004500_exclude_asking_captures_from_daily_sales.sql
\ir ../migrations/20261019004500_exclude_asking_captures_from_daily_sales.sql
SELECT public.family_share_movers_build(5,0,'1d')::text AS daily \gset
SELECT pg_temp.ok('1d counts confirmed sales only, including correct sold dollars and prior window',
  (:'daily')::jsonb->'brand_moves'->'Ford' = '[10,1,550000,50000]'::jsonb
  AND (:'daily')::jsonb->'family_moves'->'Ford|mustang' = '[10,1,550000,50000]'::jsonb
  AND (:'daily')::jsonb->'bat' = '{"sold_12m":12,"sold_prior_12m":11,"usd_12m":790000,"usd_prior_12m":1250000}'::jsonb);
SELECT pg_temp.ok('daily sparkline retains every confirmed Ford sale and excludes both asks',
  (SELECT sum(value::int) FROM jsonb_array_elements_text((:'daily')::jsonb->'gaining'->0->'bins'))=11
  AND jsonb_array_length((:'daily')::jsonb->'gaining'->0->'bins')=24);
SELECT pg_temp.ok('other seven horizon payloads remain identical',
  NOT EXISTS (SELECT FROM unchanged_horizons WHERE payload IS DISTINCT FROM public.family_share_movers_build(5,0,h)-'as_of'));
SELECT pg_temp.ok('existing function identity owner and grants remain identical',
  (SELECT ROW(p.oid,p.proowner,p.proacl) IS NOT DISTINCT FROM ROW(b.oid,b.proowner,b.proacl)
   FROM pg_proc p CROSS JOIN owner_before b WHERE p.oid=b.oid));
SELECT pg_temp.ok('source asking rows remain byte-equivalent',
  (SELECT payload FROM sources_before)=(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.marketplace_listings m));
SELECT pg_temp.ok('Facebook remains in supporting supply reader',
  (public.treemap_family_upcoming_supply('Ford','mustang')->'counts'->>'facebook_marketplace')::int=2);
-- Different capture states, prices and capture windows cannot affect confirmed sales.
INSERT INTO public.marketplace_listings (parsed_make,parsed_model,price,current_price,scraped_at,status)
VALUES ('Ford','Mustang',999999,999999,now()-interval '30 hours','sold'),
       ('Ford','Mustang',1,1,now()-interval '1 hour','active');
SELECT pg_temp.ok('asking amounts, capture recency and classified status cannot alter daily sale measure',
  (:'daily')::jsonb-'as_of'=public.family_share_movers_build(5,0,'1d')-'as_of');
-- Exercise the original low-live-volume fallback without touching synthetic testimony.
ALTER TABLE public.vehicle_events RENAME TO vehicle_events_fixture;
CREATE TABLE public.vehicle_events (LIKE public.vehicle_events_fixture);
SELECT pg_temp.ok('below ten live events uses existing stored-sale fallback',
  (public.family_share_movers_build(5,0,'1d')->'brand_moves'->'Lexus'->>0)::int=
  (SELECT count(*) FROM public.mv_family_sales WHERE brand='Lexus' AND sale_date=current_date));
DROP TABLE public.vehicle_events;
ALTER TABLE public.vehicle_events_fixture RENAME TO vehicle_events;
REFRESH MATERIALIZED VIEW public.mv_family_share_movers;
SELECT pg_temp.ok('default anonymous consumer cache carries repaired daily count',
  (public.treemap_family_share_movers(5,NULL,'1d')->'brand_moves'->'Ford'->>0)::int=10);
