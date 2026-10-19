-- Live on production 2026-10-14 (pg_get_viewdef, sha256 base64 FUJLg2PUd+m3EverI9QR5l2Wjyfcn3IK7Q0dHXIQ1Q0=): the per-make market
-- fold over public vehicles, refreshed CONCURRENTLY by refresh-market-views-nightly, and its unique index.
CREATE MATERIALIZED VIEW public.mv_market_position AS
 WITH v AS (
         SELECT COALESCE(mk.display_name, mk.canonical_name, 'Unresolved'::text) AS canon_make,
            veh.bat_watchers AS watch,
            veh.year,
            COALESCE((veh.sale_price)::numeric, (veh.sold_price)::numeric, veh.canonical_sold_price) AS price,
            ((veh.sale_status = 'sold'::text) OR (veh.auction_status = 'sold'::text)) AS is_sold,
            (lower(veh.source) = ANY (ARRAY['bat'::text, 'bring_a_trailer'::text, 'bringatrailer'::text, 'mecum'::text, 'barrett-jackson'::text, 'cars_and_bids'::text, 'bonhams'::text, 'rm-sothebys'::text, 'gooding'::text, 'leake'::text, 'silver-auctions'::text, 'kruse'::text, 'auctions-america'::text, 'mccormicks'::text, 'russo-and-steele'::text, 'pcarmarket'::text, 'gaa-classic-cars'::text, 'palm-springs-exotic'::text, 'themarket-bonhams'::text, 'h-and-h'::text, 'coys'::text, 'worldwide-auctioneers'::text, 'shannons'::text, 'broad_arrow'::text, 'artcurial'::text, 'collecting_cars'::text, 'branson-auctions'::text, 'midamerica'::text, 'gpk-auctions'::text, 'historics'::text, 'hollywood-car-auction'::text, 'sbx-cars'::text, 'grand-prix-classics'::text, 'carlisle'::text])) AS is_auction,
            (lower(veh.source) = ANY (ARRAY['facebook_marketplace'::text, 'facebook-marketplace'::text, 'facebook-saved'::text, 'classiccars-com'::text, 'classiccars.com'::text, 'craigslist'::text, 'ksl'::text, 'jamesedition'::text, 'erclassics'::text, 'hemmings'::text, 'ebay'::text, 'classic-com'::text, 'dealer_website'::text, 'barnfinds'::text, 'classic-driver'::text, 'dupont registry'::text, 'autotrader'::text, 'cars_com'::text])) AS is_marketplace
           FROM (vehicles veh
             LEFT JOIN canonical_makes mk ON ((mk.id = veh.canonical_make_id)))
          WHERE veh.is_public
        )
 SELECT 'make'::text AS dim,
    canon_make AS name,
    count(*) AS volume,
    (round(((100.0 * (count(*) FILTER (WHERE is_sold))::numeric) / (count(*))::numeric)))::integer AS sell_through,
    (round(avg(watch)))::integer AS demand,
    (round(avg(year)))::integer AS avg_year,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((price)::double precision)))::bigint AS median_price,
    (sum(price) FILTER (WHERE (price IS NOT NULL)))::bigint AS total_value,
    (percentile_cont((0.25)::double precision) WITHIN GROUP (ORDER BY ((price)::double precision)))::bigint AS p25,
    (percentile_cont((0.50)::double precision) WITHIN GROUP (ORDER BY ((price)::double precision)))::bigint AS p50,
    (percentile_cont((0.75)::double precision) WITHIN GROUP (ORDER BY ((price)::double precision)))::bigint AS p75,
    (count(*) FILTER (WHERE (price IS NOT NULL)))::integer AS price_n,
    sum(watch) FILTER (WHERE (watch IS NOT NULL)) AS watch_sum,
    (count(*) FILTER (WHERE (watch IS NOT NULL)))::integer AS watch_n,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((price)::double precision)) FILTER (WHERE is_auction))::bigint AS auction_med,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((price)::double precision)) FILTER (WHERE is_marketplace))::bigint AS market_med
   FROM v
  GROUP BY canon_make;
CREATE UNIQUE INDEX mv_market_position_pk ON public.mv_market_position USING btree (dim, name);
