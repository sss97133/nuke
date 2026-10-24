-- mv_treemap_outcomes.sold_amount on trusted USD: untrusted sale_price (vehicle_sale_price_untrusted_ids) -> NULL; non-USD sale_price -> sale_price_usd;
-- winning_bid/bat_sold_price/sold_price fallbacks only for USD rows. Rebuilds the 9 dependent views/matviews with unchanged definitions, indexes, comments, grants.
-- USER-FACING (market map). Approved by Skylar 2026-10-24.
--
-- As applied to live (the full build exceeds the SQL API's 2-minute limit, so no DROP/CREATE in place):
--   Part 1 ran as one-off pg_cron job 674 (SET LOCAL statement_timeout raises the postgres role's 10s default):
--     builds every object under a <name>_new name, indexes as <index>_tmp. Live objects were untouched while it ran.
--   Part 2 ran as one short transaction (lock_timeout 5s): renames live objects to <name>_bak / <index>_bak, then
--     <name>_new -> <name> and <index>_tmp -> <index>. Dependents follow their parents by OID, so the _bak set stays a
--     consistent copy of the previous state. Rollback: supabase/rollbacks/20261026030000_treemap_outcomes_usd_trusted_down.sql
--     (rename swap back while the _bak set exists) or ..._down_rebuild.sql (full rebuild of the old definitions).

-- Part 1: build
SET LOCAL statement_timeout = '3600s';
CREATE MATERIALIZED VIEW public.mv_treemap_outcomes_new AS
 SELECT id,
    brand_name,
    model,
    year,
    market_venue_label(auction_source, canonical_platform) AS source_name,
        CASE
            WHEN sale_basis IS NOT NULL THEN 'sold'::text
            ELSE 'not_sold'::text
        END AS outcome,
    sale_basis,
        CASE
            WHEN sale_basis IS NOT NULL AND price_untrusted THEN NULL::numeric
            WHEN sale_basis IS NOT NULL AND NULLIF(sale_price, 0) IS NOT NULL THEN
                CASE WHEN COALESCE(sale_price_currency, 'USD'::text) = 'USD'::text THEN sale_price::numeric ELSE round(sale_price_usd) END
            WHEN sale_basis IS NOT NULL AND COALESCE(sale_price_currency, 'USD'::text) = 'USD'::text THEN COALESCE(NULLIF(winning_bid, 0)::numeric, NULLIF(bat_sold_price, 0::numeric)::numeric, NULLIF(sold_price, 0)::numeric)
            ELSE NULL::numeric
        END AS sold_amount,
    bat_bids,
    bat_watchers
   FROM ( SELECT v.id,
            COALESCE(cm.display_name, initcap(v.make)) AS brand_name,
            v.model,
            v.year,
            v.auction_source,
            v.canonical_platform,
            v.sale_status,
            v.auction_outcome,
            v.reserve_status,
            v.sale_price,
            v.winning_bid,
            v.bat_sold_price,
            v.sold_price,
            v.sale_price_currency,
            v.sale_price_usd,
            uu.vehicle_id IS NOT NULL AS price_untrusted,
            v.bat_bids,
            v.bat_watchers,
            vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url, v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata, v.created_at) AS sale_basis
           FROM vehicles v
             LEFT JOIN canonical_makes cm ON cm.id = v.canonical_make_id
             LEFT JOIN vehicle_sale_price_untrusted_ids uu ON uu.vehicle_id = v.id
          WHERE v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text AND v.make IS NOT NULL AND (cm.id IS NOT NULL OR length(v.make) > 2 AND v.make !~* '^[0-9]'::text AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'::text)
         OFFSET 0) s
  WHERE sale_basis IS NOT NULL OR (sale_status = ANY (ARRAY['not_sold'::text, 'unsold'::text, 'bid_to'::text])) OR reserve_status = 'reserve_not_met'::text OR (auction_outcome = ANY (ARRAY['reserve_not_met'::text, 'no_sale'::text]))
WITH DATA;
CREATE UNIQUE INDEX mv_treemap_outcomes_id_tmp ON public.mv_treemap_outcomes_new USING btree (id);
CREATE INDEX mv_treemap_outcomes_cell_tmp ON public.mv_treemap_outcomes_new USING btree (lower(brand_name), lower(model), year);
COMMENT ON MATERIALIZED VIEW public.mv_treemap_outcomes_new IS 'The market map''s fold: one row per public vehicle record (is_public, undeleted, not a non_vehicle_item lot, a make that resolves to canonical_makes or passes the text filter) with a known outcome. outcome = sold when vehicle_sale_basis() is not null (sale_basis says which basis), else not_sold for vehicle_price_facts'' no-sale states; unknown outcomes are not here. sold_amount is vehicle_price_facts'' sold_amount (nominal, no currency on the row). Refreshed by treemap_refresh_all (daily, job 175). 2026-10-14. source_name = market_venue_label(auction_source, canonical_platform) (20261016153000).';
REVOKE ALL ON public.mv_treemap_outcomes_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_treemap_outcomes_new TO service_role;
GRANT SELECT ON public.mv_treemap_outcomes_new TO anon;
GRANT SELECT ON public.mv_treemap_outcomes_new TO authenticated;
CREATE MATERIALIZED VIEW public.mv_brand_market_new AS
 WITH o AS (
         SELECT o.brand_name,
            o.outcome,
            o.sold_amount,
            o.year,
            COALESCE(v.sale_date, v.bat_sale_date) AS sale_date
           FROM mv_treemap_outcomes_new o
             JOIN vehicles v ON v.id = o.id
        ), b AS (
         SELECT o.brand_name AS name,
            count(*) FILTER (WHERE o.sold_amount > 0::numeric) AS sold,
            count(*) FILTER (WHERE o.outcome = 'sold'::text) AS sold_any,
            count(*) AS offered,
            sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0::numeric)::bigint AS usd,
            percentile_cont(0.1::double precision) WITHIN GROUP (ORDER BY (o.sold_amount::double precision)) FILTER (WHERE o.sold_amount > 0::numeric) AS q10,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (o.sold_amount::double precision)) FILTER (WHERE o.sold_amount > 0::numeric) AS q50,
            percentile_cont(0.9::double precision) WITHIN GROUP (ORDER BY (o.sold_amount::double precision)) FILTER (WHERE o.sold_amount > 0::numeric) AS q90,
            count(*) FILTER (WHERE o.sold_amount > 0::numeric AND o.year IS NOT NULL) AS with_year,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY o.year) FILTER (WHERE o.sold_amount > 0::numeric AND o.year IS NOT NULL) AS y50,
            count(*) FILTER (WHERE o.sold_amount > 0::numeric AND o.sale_date IS NOT NULL) AS dated,
            count(*) FILTER (WHERE o.sold_amount > 0::numeric AND o.sale_date > (CURRENT_DATE - 365) AND o.sale_date <= CURRENT_DATE) AS sold_12m,
            count(*) FILTER (WHERE o.sold_amount > 0::numeric AND o.sale_date > (CURRENT_DATE - 730) AND o.sale_date <= (CURRENT_DATE - 365)) AS sold_prior_12m,
            sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0::numeric AND o.sale_date > (CURRENT_DATE - 365) AND o.sale_date <= CURRENT_DATE)::bigint AS usd_12m,
            sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0::numeric AND o.sale_date > (CURRENT_DATE - 730) AND o.sale_date <= (CURRENT_DATE - 365))::bigint AS usd_prior_12m
           FROM o
          GROUP BY o.brand_name
         HAVING count(*) FILTER (WHERE o.sold_amount > 0::numeric) >= 5
        )
 SELECT name,
    sold,
    sold_any,
    offered,
    usd,
        CASE
            WHEN sold >= 20 THEN q10::bigint
            ELSE NULL::bigint
        END AS p10,
    q50::bigint AS p50,
        CASE
            WHEN sold >= 20 THEN q90::bigint
            ELSE NULL::bigint
        END AS p90,
        CASE
            WHEN with_year >= 5 THEN y50
            ELSE NULL::integer
        END AS year_p50,
    dated,
    sold_12m,
    sold_prior_12m,
    usd_12m,
    usd_prior_12m,
    now() AS as_of
   FROM b
WITH DATA;
CREATE UNIQUE INDEX mv_brand_market_name_tmp ON public.mv_brand_market_new USING btree (name);
COMMENT ON MATERIALIZED VIEW public.mv_brand_market_new IS 'One row per brand from confirmed sales: dollars, sell-through, the p10-p90 price band, the model year that trades, and the last 12 months against the 12 before. Refreshed by treemap_refresh_all.';
REVOKE ALL ON public.mv_brand_market_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_brand_market_new TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_brand_market_new TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_brand_market_new TO service_role;
CREATE MATERIALIZED VIEW public.mv_family_market_new AS
 WITH name_map AS MATERIALIZED (
         SELECT u.make_k,
            u.model_l,
            (array_agg(u.family_id ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS family_id,
            (array_agg(u.family ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS family,
            (array_agg(u.year_start ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS year_start,
            (array_agg(u.year_end ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS year_end
           FROM ( SELECT n.make_l AS make_k,
                    n.model_l,
                    n.family_id,
                    n.family,
                    n.year_start,
                    n.year_end,
                    n.vehicles,
                    1 AS ord
                   FROM mv_model_family_names n
                  WHERE n.family_id IS NOT NULL
                UNION ALL
                 SELECT lower(n.make) AS make_k,
                    n.model_l,
                    n.family_id,
                    n.family,
                    n.year_start,
                    n.year_end,
                    n.vehicles,
                    2 AS ord
                   FROM mv_model_family_names n
                  WHERE n.family_id IS NOT NULL AND n.make IS NOT NULL AND lower(n.make) <> n.make_l) u
          GROUP BY u.make_k, u.model_l
        ), o AS (
         SELECT o.brand_name,
            o.model,
            o.outcome,
            o.sold_amount,
            o.year,
            COALESCE(v.sale_date, v.bat_sale_date) AS sale_date,
            lower(o.brand_name) AS brand_l,
            lower(v.make) AS make_l,
            lower(btrim(COALESCE(o.model, ''::text))) AS model_l,
            (o.source_name = ANY (ARRAY['Bring a Trailer'::text, 'Mecum'::text, 'Bonhams'::text])) AND o.sold_amount > 0::numeric AS bat
           FROM mv_treemap_outcomes_new o
             JOIN vehicles v ON v.id = o.id
        ), f AS (
         SELECT o.brand_name,
            o.model,
            o.outcome,
            o.sold_amount,
            o.year,
            o.sale_date,
            o.brand_l,
            o.make_l,
            o.model_l,
            o.bat,
                CASE
                    WHEN COALESCE(nb.family_id, nm.family_id) IS NOT NULL AND (o.year IS NULL OR COALESCE(nb.year_start, nm.year_start) IS NULL OR o.year >= (COALESCE(nb.year_start, nm.year_start) - 1)) AND (o.year IS NULL OR COALESCE(nb.year_end, nm.year_end) IS NULL OR o.year <= (COALESCE(nb.year_end, nm.year_end) + 1)) THEN COALESCE(nb.family_id, nm.family_id)
                    ELSE NULL::uuid
                END AS family_id,
            COALESCE(nb.family, nm.family) AS family
           FROM o
             LEFT JOIN name_map nb ON nb.make_k = o.brand_l AND nb.model_l = o.model_l
             LEFT JOIN name_map nm ON nm.make_k = o.make_l AND nm.model_l = o.model_l
        ), g AS (
         SELECT f.brand_name,
            f.family_id,
            f.model_l AS model_key,
            mode() WITHIN GROUP (ORDER BY f.model) AS model,
            min(f.family) FILTER (WHERE f.family_id IS NOT NULL) AS family,
            count(*) FILTER (WHERE f.sold_amount > 0::numeric) AS sold,
            count(*) FILTER (WHERE f.outcome = 'sold'::text) AS sold_any,
            count(*) AS offered,
            sum(f.sold_amount) FILTER (WHERE f.sold_amount > 0::numeric)::bigint AS usd,
            count(*) FILTER (WHERE f.bat) AS bat_dated,
            count(*) FILTER (WHERE f.bat AND f.sale_date > (CURRENT_DATE - 365) AND f.sale_date <= CURRENT_DATE) AS bat_sold_12m,
            count(*) FILTER (WHERE f.bat AND f.sale_date > (CURRENT_DATE - 730) AND f.sale_date <= (CURRENT_DATE - 365)) AS bat_sold_prior_12m,
            sum(f.sold_amount) FILTER (WHERE f.bat AND f.sale_date > (CURRENT_DATE - 365) AND f.sale_date <= CURRENT_DATE)::bigint AS bat_usd_12m,
            sum(f.sold_amount) FILTER (WHERE f.bat AND f.sale_date > (CURRENT_DATE - 730) AND f.sale_date <= (CURRENT_DATE - 365))::bigint AS bat_usd_prior_12m
           FROM f
          GROUP BY f.brand_name, f.family_id, f.model_l
        ), k AS (
         SELECT g.brand_name,
            g.family_id,
            g.model_key,
            g.model,
            g.family,
            g.sold,
            g.sold_any,
            g.offered,
            g.usd,
            g.bat_dated,
            g.bat_sold_12m,
            g.bat_sold_prior_12m,
            g.bat_usd_12m,
            g.bat_usd_prior_12m,
            g.family_id IS NULL OR sum(g.sold) OVER (PARTITION BY g.brand_name, g.family_id) < 3::numeric AS other
           FROM g
        )
 SELECT brand_name AS brand,
        CASE
            WHEN other THEN 'other'::text
            ELSE family_id::text
        END AS family_key,
        CASE
            WHEN other THEN NULL::text
            ELSE max(family)
        END AS family,
    model_key,
    mode() WITHIN GROUP (ORDER BY k.model) AS model,
    sum(sold)::bigint AS sold,
    sum(sold_any)::bigint AS sold_any,
    sum(offered)::bigint AS offered,
    sum(usd)::bigint AS usd,
    sum(bat_dated)::bigint AS bat_dated,
    sum(bat_sold_12m)::bigint AS bat_sold_12m,
    sum(bat_sold_prior_12m)::bigint AS bat_sold_prior_12m,
    sum(bat_usd_12m)::bigint AS bat_usd_12m,
    sum(bat_usd_prior_12m)::bigint AS bat_usd_prior_12m,
    now() AS as_of
   FROM k
  GROUP BY brand_name, other, (
        CASE
            WHEN other THEN 'other'::text
            ELSE family_id::text
        END), model_key
WITH DATA;
CREATE UNIQUE INDEX mv_family_market_key_tmp ON public.mv_family_market_new USING btree (brand, family_key, model_key);
COMMENT ON MATERIALIZED VIEW public.mv_family_market_new IS 'One row per brand, factory model family (canonical_models key, or "other": no family, or under 3 sales in the brand) and model name (lower(btrim(model))) from confirmed sales: dollars, sold, sell-through inputs, and (bat_*) the last 12 months against the 12 before on the measured houses (Bring a Trailer, Mecum, Bonhams).';
REVOKE ALL ON public.mv_family_market_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_market_new TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_market_new TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_market_new TO service_role;
CREATE MATERIALIZED VIEW public.mv_family_sales_new AS
 WITH name_map AS MATERIALIZED (
         SELECT u.make_k,
            u.model_l,
            (array_agg(u.family_id ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS family_id,
            (array_agg(u.year_start ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS year_start,
            (array_agg(u.year_end ORDER BY u.ord, u.vehicles DESC NULLS LAST, u.family_id))[1] AS year_end
           FROM ( SELECT n.make_l AS make_k,
                    n.model_l,
                    n.family_id,
                    n.year_start,
                    n.year_end,
                    n.vehicles,
                    1 AS ord
                   FROM mv_model_family_names n
                  WHERE n.family_id IS NOT NULL
                UNION ALL
                 SELECT lower(n.make) AS make_k,
                    n.model_l,
                    n.family_id,
                    n.year_start,
                    n.year_end,
                    n.vehicles,
                    2 AS ord
                   FROM mv_model_family_names n
                  WHERE n.family_id IS NOT NULL AND n.make IS NOT NULL AND lower(n.make) <> n.make_l) u
          GROUP BY u.make_k, u.model_l
        ), o AS (
         SELECT o.id,
            o.brand_name,
            o.model,
            o.year,
            o.source_name,
            o.sold_amount,
            COALESCE(v.sale_date, v.bat_sale_date) AS sale_date,
            lower(o.brand_name) AS brand_l,
            lower(v.make) AS make_l,
            lower(btrim(COALESCE(o.model, ''::text))) AS model_l
           FROM mv_treemap_outcomes_new o
             JOIN vehicles v ON v.id = o.id
          WHERE o.sold_amount > 0::numeric AND COALESCE(v.sale_date, v.bat_sale_date) IS NOT NULL
        ), f AS (
         SELECT o.id,
            o.brand_name,
            o.model,
            o.year,
            o.source_name,
            o.sold_amount,
            o.sale_date,
            o.brand_l,
            o.make_l,
            o.model_l,
                CASE
                    WHEN COALESCE(nb.family_id, nm.family_id) IS NOT NULL AND (o.year IS NULL OR COALESCE(nb.year_start, nm.year_start) IS NULL OR o.year >= (COALESCE(nb.year_start, nm.year_start) - 1)) AND (o.year IS NULL OR COALESCE(nb.year_end, nm.year_end) IS NULL OR o.year <= (COALESCE(nb.year_end, nm.year_end) + 1)) THEN COALESCE(nb.family_id, nm.family_id)::text
                    ELSE NULL::text
                END AS family_id
           FROM o
             LEFT JOIN name_map nb ON nb.make_k = o.brand_l AND nb.model_l = o.model_l
             LEFT JOIN name_map nm ON nm.make_k = o.make_l AND nm.model_l = o.model_l
        ), named AS (
         SELECT DISTINCT mv_family_market_new.brand,
            mv_family_market_new.family_key
           FROM mv_family_market_new
          WHERE mv_family_market_new.family_key <> 'other'::text
        )
 SELECT f.id AS vehicle_id,
    f.brand_name AS brand,
    COALESCE(named.family_key, 'other'::text) AS family_key,
    f.model,
    f.year,
    f.source_name AS source,
    f.sold_amount::bigint AS usd,
    f.sale_date
   FROM f
     LEFT JOIN named ON named.brand = f.brand_name AND named.family_key = f.family_id
WITH DATA;
CREATE UNIQUE INDEX mv_family_sales_vehicle_tmp ON public.mv_family_sales_new USING btree (vehicle_id);
CREATE INDEX mv_family_sales_family_date_tmp ON public.mv_family_sales_new USING btree (brand, family_key, sale_date DESC);
COMMENT ON MATERIALIZED VIEW public.mv_family_sales_new IS 'Dated confirmed sales with an amount, keyed to (brand, family_key) the way mv_family_market keys them.';
REVOKE ALL ON public.mv_family_sales_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_sales_new TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_sales_new TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_sales_new TO service_role;
CREATE MATERIALIZED VIEW public.mv_family_year_prices_new AS
 WITH listing AS (
         SELECT m.vehicle_id,
            m.price::numeric AS price,
            'Facebook Marketplace'::text AS source,
            m.first_seen_at::date AS priced_on,
            m.first_seen_at AS seen_at,
            m.mileage AS miles
           FROM marketplace_listings m
          WHERE m.vehicle_id IS NOT NULL AND m.price > 0 AND (COALESCE(m.status, ''::text) <> ALL (ARRAY['duplicate'::text, 'blocked'::text])) AND m.first_seen_at >= (CURRENT_DATE - 365) AND m.first_seen_at < CURRENT_DATE
        UNION ALL
         SELECT e.vehicle_id,
            e.current_price,
                CASE e.source_platform
                    WHEN 'craigslist'::text THEN 'Craigslist'::text
                    WHEN 'ksl'::text THEN 'KSL'::text
                    ELSE 'Facebook Marketplace'::text
                END AS "case",
            e.created_at::date AS created_at,
            e.created_at,
            NULL::integer AS int4
           FROM vehicle_events e
          WHERE (e.source_platform = ANY (ARRAY['craigslist'::text, 'facebook_marketplace'::text, 'ksl'::text])) AND e.vehicle_id IS NOT NULL AND e.current_price > 0::numeric AND e.created_at >= (CURRENT_DATE - 365) AND e.created_at < CURRENT_DATE
        ), vehicle_rows AS MATERIALIZED (
         SELECT v.id,
            v.year,
            v.make,
            v.model,
            COALESCE(v.sale_date, v.bat_sale_date) AS sold_on,
            COALESCE(v.listing_url, v.discovery_url) AS page,
            v.mileage,
            v.deleted_at IS NULL AND v.is_public IS TRUE AND v.year IS NOT NULL AND (v.listing_kind IS NULL OR v.listing_kind <> 'non_vehicle_item'::text) AS listable
           FROM vehicles v
          WHERE (v.id IN ( SELECT o.id
                   FROM mv_treemap_outcomes_new o
                  WHERE o.year IS NOT NULL
                UNION
                 SELECT l.vehicle_id
                   FROM listing l))
        ), sold AS (
         SELECT 'sold'::text AS basis,
            o.year,
            o.sold_amount AS price,
            o.outcome,
            COALESCE(o.source_name, 'Other'::text) AS source,
            v.sold_on AS priced_on,
            lower(v.make) AS make_l,
            lower(COALESCE(v.model, ''::text)) AS model_l,
            v.page,
            v.mileage AS miles
           FROM mv_treemap_outcomes_new o
             JOIN vehicle_rows v ON v.id = o.id
          WHERE o.year IS NOT NULL
        ), asked AS (
         SELECT DISTINCT ON (a_1.vehicle_id) 'asked'::text AS basis,
            v.year,
            a_1.price,
            NULL::text AS outcome,
            a_1.source,
            a_1.priced_on,
            lower(v.make) AS make_l,
            lower(COALESCE(v.model, ''::text)) AS model_l,
            NULL::text AS page,
            COALESCE(a_1.miles, v.mileage) AS miles
           FROM listing a_1
             JOIN vehicle_rows v ON v.id = a_1.vehicle_id AND v.listable
          ORDER BY a_1.vehicle_id, a_1.seen_at DESC
        ), words AS (
         SELECT f.family_id,
            array_agg(DISTINCT n.w) AS words
           FROM ( SELECT DISTINCT mv_model_family_names.family_id
                   FROM mv_model_family_names
                  WHERE mv_model_family_names.family_id IS NOT NULL) f
             JOIN canonical_models m0 ON m0.id = f.family_id
             JOIN canonical_models m ON lower(m.canonical_model) = lower(m0.canonical_model) AND regexp_replace(lower(m.make), '[^a-z0-9]'::text, ''::text, 'g'::text) = regexp_replace(lower(m0.make), '[^a-z0-9]'::text, ''::text, 'g'::text)
             CROSS JOIN LATERAL unnest(array_append(COALESCE(m.aliases, '{}'::text[]), m.canonical_model)) a_1(x)
             CROSS JOIN LATERAL ( SELECT btrim(regexp_replace(lower(a_1.x), '[^a-z0-9]+'::text, ' '::text, 'g'::text)) AS w) n
          WHERE length(n.w) >= 3 OR length(n.w) = 2 AND n.w ~ '[0-9]'::text
          GROUP BY f.family_id
        ), pool AS (
         SELECT f.family_id,
            NULLIF(btrim(m.platform), ''::text) AS platform,
            COALESCE('platform:'::text || NULLIF(btrim(m.platform), ''::text), 'family:'::text || f.family_id::text) AS pool
           FROM ( SELECT DISTINCT mv_model_family_names.family_id
                   FROM mv_model_family_names
                  WHERE mv_model_family_names.family_id IS NOT NULL) f
             LEFT JOIN canonical_models m ON m.id = f.family_id
        ), named AS MATERIALIZED (
         SELECT x_1.basis,
            n.family_id,
            pl.pool,
            x_1.year,
            x_1.price,
            x_1.outcome,
            x_1.source,
            x_1.priced_on,
            x_1.miles,
            array_append(COALESCE(wd.words, '{}'::text[]), n.matched) AS words,
            (' '::text || btrim(regexp_replace(lower(regexp_replace(x_1.page, '^.*/([^/]+)/?$'::text, '\1'::text)), '[^a-z0-9]+'::text, ' '::text, 'g'::text))) || ' '::text AS slug
           FROM ( SELECT sold.basis,
                    sold.year,
                    sold.price,
                    sold.outcome,
                    sold.source,
                    sold.priced_on,
                    sold.make_l,
                    sold.model_l,
                    sold.page,
                    sold.miles
                   FROM sold
                UNION ALL
                 SELECT asked.basis,
                    asked.year,
                    asked.price,
                    asked.outcome,
                    asked.source,
                    asked.priced_on,
                    asked.make_l,
                    asked.model_l,
                    asked.page,
                    asked.miles
                   FROM asked) x_1
             JOIN mv_model_family_names n ON n.make_l = x_1.make_l AND n.model_l = x_1.model_l
             LEFT JOIN words wd ON wd.family_id = n.family_id
             JOIN pool pl ON pl.family_id = n.family_id
          WHERE n.family_id IS NOT NULL AND (n.year_start IS NULL OR x_1.year >= (n.year_start - 1)) AND (n.year_end IS NULL OR x_1.year <= (n.year_end + 1))
        ), p AS MATERIALIZED (
         SELECT named.basis,
            named.pool,
            named.year,
            named.price,
            named.outcome,
            named.source,
            named.priced_on,
                CASE
                    WHEN named.miles > 0 AND named.miles < 2000000 THEN named.miles
                    ELSE NULL::integer
                END AS miles,
            COALESCE(named.basis = 'sold'::text AND named.slug ~~ (('% '::text || named.year) || ' %'::text) AND NOT (EXISTS ( SELECT 1
                   FROM unnest(named.words) w(w)
                  WHERE POSITION(((' '::text || w.w) || ' '::text) IN (named.slug)) > 0 OR POSITION((replace(w.w, ' '::text, ''::text)) IN (replace(named.slug, ' '::text, ''::text))) > 0)), false) AS conflict
           FROM named
        ), yr AS (
         SELECT p.basis,
            p.pool,
            p.year,
            count(*) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS n,
            count(*) FILTER (WHERE NOT p.conflict) AS offered,
            count(*) FILTER (WHERE p.conflict) AS conflicts,
            array_agg(p.price ORDER BY p.price) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS prices,
            array_agg(p.source ORDER BY p.price) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS sources,
            array_agg(p.miles) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict AND p.miles IS NOT NULL) AS miles,
            count(*) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict AND p.priced_on IS NOT NULL) AS dated,
            min(p.priced_on) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS first_on,
            max(p.priced_on) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS last_on,
            count(*) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict AND p.priced_on > (CURRENT_DATE - 730) AND p.priced_on <= CURRENT_DATE) AS n_24m
           FROM p
          GROUP BY p.basis, p.pool, p.year
        ), t AS (
         SELECT DISTINCT yr.basis,
            yr.pool,
            yr.year + d.d AS year
           FROM yr,
            generate_series('-5'::integer, 5) d(d)
          WHERE yr.n > 0
        ), tw AS (
         SELECT t.basis,
            t.pool,
            t.year,
                CASE
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE yr.year = t.year), 0::numeric) >= 10::numeric THEN 0
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 1), 0::numeric) >= 10::numeric THEN 1
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 2), 0::numeric) >= 10::numeric THEN 2
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 3), 0::numeric) >= 10::numeric THEN 3
                    ELSE 5
                END AS w
           FROM t
             JOIN yr ON yr.basis = t.basis AND yr.pool = t.pool AND yr.year >= (t.year - 5) AND yr.year <= (t.year + 5)
          GROUP BY t.basis, t.pool, t.year
        ), mx AS (
         SELECT tw.basis,
            tw.pool,
            tw.year,
            array_agg(m.m ORDER BY m.m) AS miles
           FROM tw
             JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year >= (tw.year - tw.w) AND yr.year <= (tw.year + tw.w)
             CROSS JOIN LATERAL unnest(yr.miles) m(m)
          GROUP BY tw.basis, tw.pool, tw.year
        ), vs AS (
         SELECT tw.basis,
            tw.pool,
            tw.year,
            u.s AS source,
            count(*)::integer AS n,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (u.x::double precision)) AS p50
           FROM tw
             JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year >= (tw.year - tw.w) AND yr.year <= (tw.year + tw.w)
             CROSS JOIN LATERAL UNNEST(yr.prices, yr.sources) u(x, s)
          GROUP BY tw.basis, tw.pool, tw.year, u.s
        ), vsj AS (
         SELECT vs.basis,
            vs.pool,
            vs.year,
            jsonb_object_agg(vs.source, jsonb_build_object('n', vs.n, 'p50',
                CASE
                    WHEN vs.n >= 5 THEN round(vs.p50)::integer
                    ELSE NULL::integer
                END) ORDER BY vs.source) AS venues
           FROM vs
          GROUP BY vs.basis, vs.pool, vs.year
        ), agg AS (
         SELECT tw.basis,
            tw.pool,
            tw.year,
            tw.w,
            count(u.x)::integer AS n,
            sum(yr.offered) FILTER (WHERE u.i = 1)::integer AS offered,
            sum(yr.conflicts) FILTER (WHERE u.i = 1)::integer AS conflicts,
            sum(yr.dated) FILTER (WHERE u.i = 1)::integer AS dated,
            min(yr.first_on) AS first_on,
            max(yr.last_on) AS last_on,
            sum(yr.n_24m) FILTER (WHERE u.i = 1)::integer AS n_24m,
            percentile_cont(ARRAY[0.1::double precision, 0.25::double precision, 0.5::double precision, 0.75::double precision, 0.9::double precision]) WITHIN GROUP (ORDER BY (u.x::double precision)) AS q,
            array_agg(round(u.x)::integer ORDER BY u.x) FILTER (WHERE u.x IS NOT NULL) AS prices,
            array_agg(u.s) FILTER (WHERE u.x IS NOT NULL) AS sources
           FROM tw
             JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year >= (tw.year - tw.w) AND yr.year <= (tw.year + tw.w)
             CROSS JOIN LATERAL UNNEST(COALESCE(yr.prices, ARRAY[NULL::numeric]), COALESCE(yr.sources, ARRAY[NULL::text])) WITH ORDINALITY u(x, s, i)
          GROUP BY tw.basis, tw.pool, tw.year, tw.w
        )
 SELECT pm.family_id,
    a.year,
    a.basis,
    a.year - a.w AS year_from,
    a.year + a.w AS year_to,
    pm.platform,
    a.n,
        CASE
            WHEN a.basis = 'sold'::text THEN a.offered
            ELSE NULL::integer
        END AS offered,
        CASE
            WHEN a.basis = 'sold'::text THEN a.conflicts
            ELSE NULL::integer
        END AS conflicts,
    a.n < 10 AS thin,
        CASE
            WHEN a.n >= 10 THEN round(a.q[1])::integer
            ELSE NULL::integer
        END AS p10,
        CASE
            WHEN a.n >= 10 THEN round(a.q[2])::integer
            ELSE NULL::integer
        END AS p25,
        CASE
            WHEN a.n >= 10 THEN round(a.q[3])::integer
            ELSE NULL::integer
        END AS p50,
        CASE
            WHEN a.n >= 10 THEN round(a.q[4])::integer
            ELSE NULL::integer
        END AS p75,
        CASE
            WHEN a.n >= 10 THEN round(a.q[5])::integer
            ELSE NULL::integer
        END AS p90,
    a.prices,
    a.dated,
    a.first_on,
    a.last_on,
    a.n_24m,
    COALESCE(cardinality(x.miles), 0) AS n_miles,
    COALESCE(x.miles, '{}'::integer[]) AS miles,
        CASE
            WHEN cardinality(x.miles) >= 10 THEN x.miles[(cardinality(x.miles) + 1) / 2]
            ELSE NULL::integer
        END AS miles_p50,
    ( SELECT COALESCE(jsonb_object_agg(z.s, z.c ORDER BY z.s), '{}'::jsonb) AS "coalesce"
           FROM ( SELECT s.s,
                    count(*)::integer AS c
                   FROM unnest(a.sources) s(s)
                  GROUP BY s.s) z) AS by_source,
    COALESCE(vj.venues, '{}'::jsonb) AS venues,
    now() AS as_of
   FROM agg a
     JOIN pool pm ON pm.pool = a.pool
     LEFT JOIN mx x ON x.basis = a.basis AND x.pool = a.pool AND x.year = a.year
     LEFT JOIN vsj vj ON vj.basis = a.basis AND vj.pool = a.pool AND vj.year = a.year
  WHERE a.n > 0
WITH DATA;
CREATE UNIQUE INDEX mv_family_year_prices_key_tmp ON public.mv_family_year_prices_new USING btree (family_id, year, basis);
COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices_new IS 'Private unbuilt beside copy: same year-price rules; cache named and conflict expressions once. Reader stays on populated original until separately validated build and rename.';
REVOKE ALL ON public.mv_family_year_prices_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_family_year_prices_new TO service_role;
GRANT SELECT ON public.mv_family_year_prices_new TO anon;
GRANT SELECT ON public.mv_family_year_prices_new TO authenticated;
CREATE MATERIALIZED VIEW public.mv_family_year_prices_v1_new AS
 WITH listing AS (
         SELECT m.vehicle_id,
            m.price::numeric AS price,
            'Facebook Marketplace'::text AS source,
            m.first_seen_at::date AS priced_on,
            m.first_seen_at AS seen_at,
            m.mileage AS miles
           FROM marketplace_listings m
          WHERE m.vehicle_id IS NOT NULL AND m.price > 0 AND (COALESCE(m.status, ''::text) <> ALL (ARRAY['duplicate'::text, 'blocked'::text])) AND m.first_seen_at >= (CURRENT_DATE - 365) AND m.first_seen_at < CURRENT_DATE
        UNION ALL
         SELECT e.vehicle_id,
            e.current_price,
                CASE e.source_platform
                    WHEN 'craigslist'::text THEN 'Craigslist'::text
                    WHEN 'ksl'::text THEN 'KSL'::text
                    ELSE 'Facebook Marketplace'::text
                END AS "case",
            e.created_at::date AS created_at,
            e.created_at,
            NULL::integer AS int4
           FROM vehicle_events e
          WHERE (e.source_platform = ANY (ARRAY['craigslist'::text, 'facebook_marketplace'::text, 'ksl'::text])) AND e.vehicle_id IS NOT NULL AND e.current_price > 0::numeric AND e.created_at >= (CURRENT_DATE - 365) AND e.created_at < CURRENT_DATE
        ), vehicle_rows AS MATERIALIZED (
         SELECT v.id,
            v.year,
            v.make,
            v.model,
            COALESCE(v.sale_date, v.bat_sale_date) AS sold_on,
            COALESCE(v.listing_url, v.discovery_url) AS page,
            v.mileage,
            v.deleted_at IS NULL AND v.is_public IS TRUE AND v.year IS NOT NULL AND (v.listing_kind IS NULL OR v.listing_kind <> 'non_vehicle_item'::text) AS listable
           FROM vehicles v
          WHERE (v.id IN ( SELECT o.id
                   FROM mv_treemap_outcomes_new o
                  WHERE o.year IS NOT NULL
                UNION
                 SELECT l.vehicle_id
                   FROM listing l))
        ), sold AS (
         SELECT 'sold'::text AS basis,
            o.year,
            o.sold_amount AS price,
            o.outcome,
            COALESCE(o.source_name, 'Other'::text) AS source,
            v.sold_on AS priced_on,
            lower(v.make) AS make_l,
            lower(COALESCE(v.model, ''::text)) AS model_l,
            v.page,
            v.mileage AS miles
           FROM mv_treemap_outcomes_new o
             JOIN vehicle_rows v ON v.id = o.id
          WHERE o.year IS NOT NULL
        ), asked AS (
         SELECT DISTINCT ON (a_1.vehicle_id) 'asked'::text AS basis,
            v.year,
            a_1.price,
            NULL::text AS outcome,
            a_1.source,
            a_1.priced_on,
            lower(v.make) AS make_l,
            lower(COALESCE(v.model, ''::text)) AS model_l,
            NULL::text AS page,
            COALESCE(a_1.miles, v.mileage) AS miles
           FROM listing a_1
             JOIN vehicle_rows v ON v.id = a_1.vehicle_id AND v.listable
          ORDER BY a_1.vehicle_id, a_1.seen_at DESC
        ), words AS (
         SELECT f.family_id,
            array_agg(DISTINCT n.w) AS words
           FROM ( SELECT DISTINCT mv_model_family_names.family_id
                   FROM mv_model_family_names
                  WHERE mv_model_family_names.family_id IS NOT NULL) f
             JOIN canonical_models m0 ON m0.id = f.family_id
             JOIN canonical_models m ON lower(m.canonical_model) = lower(m0.canonical_model) AND regexp_replace(lower(m.make), '[^a-z0-9]'::text, ''::text, 'g'::text) = regexp_replace(lower(m0.make), '[^a-z0-9]'::text, ''::text, 'g'::text)
             CROSS JOIN LATERAL unnest(array_append(COALESCE(m.aliases, '{}'::text[]), m.canonical_model)) a_1(x)
             CROSS JOIN LATERAL ( SELECT btrim(regexp_replace(lower(a_1.x), '[^a-z0-9]+'::text, ' '::text, 'g'::text)) AS w) n
          WHERE length(n.w) >= 3 OR length(n.w) = 2 AND n.w ~ '[0-9]'::text
          GROUP BY f.family_id
        ), pool AS (
         SELECT f.family_id,
            NULLIF(btrim(m.platform), ''::text) AS platform,
            COALESCE('platform:'::text || NULLIF(btrim(m.platform), ''::text), 'family:'::text || f.family_id::text) AS pool
           FROM ( SELECT DISTINCT mv_model_family_names.family_id
                   FROM mv_model_family_names
                  WHERE mv_model_family_names.family_id IS NOT NULL) f
             LEFT JOIN canonical_models m ON m.id = f.family_id
        ), named AS (
         SELECT x_1.basis,
            n.family_id,
            pl.pool,
            x_1.year,
            x_1.price,
            x_1.outcome,
            x_1.source,
            x_1.priced_on,
            x_1.miles,
            array_append(COALESCE(wd.words, '{}'::text[]), n.matched) AS words,
            (' '::text || btrim(regexp_replace(lower(regexp_replace(x_1.page, '^.*/([^/]+)/?$'::text, '\1'::text)), '[^a-z0-9]+'::text, ' '::text, 'g'::text))) || ' '::text AS slug
           FROM ( SELECT sold.basis,
                    sold.year,
                    sold.price,
                    sold.outcome,
                    sold.source,
                    sold.priced_on,
                    sold.make_l,
                    sold.model_l,
                    sold.page,
                    sold.miles
                   FROM sold
                UNION ALL
                 SELECT asked.basis,
                    asked.year,
                    asked.price,
                    asked.outcome,
                    asked.source,
                    asked.priced_on,
                    asked.make_l,
                    asked.model_l,
                    asked.page,
                    asked.miles
                   FROM asked) x_1
             JOIN mv_model_family_names n ON n.make_l = x_1.make_l AND n.model_l = x_1.model_l
             LEFT JOIN words wd ON wd.family_id = n.family_id
             JOIN pool pl ON pl.family_id = n.family_id
          WHERE n.family_id IS NOT NULL AND (n.year_start IS NULL OR x_1.year >= (n.year_start - 1)) AND (n.year_end IS NULL OR x_1.year <= (n.year_end + 1))
        ), p AS (
         SELECT named.basis,
            named.pool,
            named.year,
            named.price,
            named.outcome,
            named.source,
            named.priced_on,
                CASE
                    WHEN named.miles > 0 AND named.miles < 2000000 THEN named.miles
                    ELSE NULL::integer
                END AS miles,
            COALESCE(named.basis = 'sold'::text AND named.slug ~~ (('% '::text || named.year) || ' %'::text) AND NOT (EXISTS ( SELECT 1
                   FROM unnest(named.words) w(w)
                  WHERE POSITION(((' '::text || w.w) || ' '::text) IN (named.slug)) > 0 OR POSITION((replace(w.w, ' '::text, ''::text)) IN (replace(named.slug, ' '::text, ''::text))) > 0)), false) AS conflict
           FROM named
        ), yr AS (
         SELECT p.basis,
            p.pool,
            p.year,
            count(*) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS n,
            count(*) FILTER (WHERE NOT p.conflict) AS offered,
            count(*) FILTER (WHERE p.conflict) AS conflicts,
            array_agg(p.price ORDER BY p.price) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS prices,
            array_agg(p.source ORDER BY p.price) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS sources,
            array_agg(p.miles) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict AND p.miles IS NOT NULL) AS miles,
            count(*) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict AND p.priced_on IS NOT NULL) AS dated,
            min(p.priced_on) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS first_on,
            max(p.priced_on) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict) AS last_on,
            count(*) FILTER (WHERE p.price > 0::numeric AND NOT p.conflict AND p.priced_on > (CURRENT_DATE - 730) AND p.priced_on <= CURRENT_DATE) AS n_24m
           FROM p
          GROUP BY p.basis, p.pool, p.year
        ), t AS (
         SELECT DISTINCT yr.basis,
            yr.pool,
            yr.year + d.d AS year
           FROM yr,
            generate_series('-5'::integer, 5) d(d)
          WHERE yr.n > 0
        ), tw AS (
         SELECT t.basis,
            t.pool,
            t.year,
                CASE
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE yr.year = t.year), 0::numeric) >= 10::numeric THEN 0
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 1), 0::numeric) >= 10::numeric THEN 1
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 2), 0::numeric) >= 10::numeric THEN 2
                    WHEN COALESCE(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 3), 0::numeric) >= 10::numeric THEN 3
                    ELSE 5
                END AS w
           FROM t
             JOIN yr ON yr.basis = t.basis AND yr.pool = t.pool AND yr.year >= (t.year - 5) AND yr.year <= (t.year + 5)
          GROUP BY t.basis, t.pool, t.year
        ), mx AS (
         SELECT tw.basis,
            tw.pool,
            tw.year,
            array_agg(m.m ORDER BY m.m) AS miles
           FROM tw
             JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year >= (tw.year - tw.w) AND yr.year <= (tw.year + tw.w)
             CROSS JOIN LATERAL unnest(yr.miles) m(m)
          GROUP BY tw.basis, tw.pool, tw.year
        ), vs AS (
         SELECT tw.basis,
            tw.pool,
            tw.year,
            u.s AS source,
            count(*)::integer AS n,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (u.x::double precision)) AS p50
           FROM tw
             JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year >= (tw.year - tw.w) AND yr.year <= (tw.year + tw.w)
             CROSS JOIN LATERAL UNNEST(yr.prices, yr.sources) u(x, s)
          GROUP BY tw.basis, tw.pool, tw.year, u.s
        ), vsj AS (
         SELECT vs.basis,
            vs.pool,
            vs.year,
            jsonb_object_agg(vs.source, jsonb_build_object('n', vs.n, 'p50',
                CASE
                    WHEN vs.n >= 5 THEN round(vs.p50)::integer
                    ELSE NULL::integer
                END) ORDER BY vs.source) AS venues
           FROM vs
          GROUP BY vs.basis, vs.pool, vs.year
        ), agg AS (
         SELECT tw.basis,
            tw.pool,
            tw.year,
            tw.w,
            count(u.x)::integer AS n,
            sum(yr.offered) FILTER (WHERE u.i = 1)::integer AS offered,
            sum(yr.conflicts) FILTER (WHERE u.i = 1)::integer AS conflicts,
            sum(yr.dated) FILTER (WHERE u.i = 1)::integer AS dated,
            min(yr.first_on) AS first_on,
            max(yr.last_on) AS last_on,
            sum(yr.n_24m) FILTER (WHERE u.i = 1)::integer AS n_24m,
            percentile_cont(ARRAY[0.1::double precision, 0.25::double precision, 0.5::double precision, 0.75::double precision, 0.9::double precision]) WITHIN GROUP (ORDER BY (u.x::double precision)) AS q,
            array_agg(round(u.x)::integer ORDER BY u.x) FILTER (WHERE u.x IS NOT NULL) AS prices,
            array_agg(u.s) FILTER (WHERE u.x IS NOT NULL) AS sources
           FROM tw
             JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year >= (tw.year - tw.w) AND yr.year <= (tw.year + tw.w)
             CROSS JOIN LATERAL UNNEST(COALESCE(yr.prices, ARRAY[NULL::numeric]), COALESCE(yr.sources, ARRAY[NULL::text])) WITH ORDINALITY u(x, s, i)
          GROUP BY tw.basis, tw.pool, tw.year, tw.w
        )
 SELECT pm.family_id,
    a.year,
    a.basis,
    a.year - a.w AS year_from,
    a.year + a.w AS year_to,
    pm.platform,
    a.n,
        CASE
            WHEN a.basis = 'sold'::text THEN a.offered
            ELSE NULL::integer
        END AS offered,
        CASE
            WHEN a.basis = 'sold'::text THEN a.conflicts
            ELSE NULL::integer
        END AS conflicts,
    a.n < 10 AS thin,
        CASE
            WHEN a.n >= 10 THEN round(a.q[1])::integer
            ELSE NULL::integer
        END AS p10,
        CASE
            WHEN a.n >= 10 THEN round(a.q[2])::integer
            ELSE NULL::integer
        END AS p25,
        CASE
            WHEN a.n >= 10 THEN round(a.q[3])::integer
            ELSE NULL::integer
        END AS p50,
        CASE
            WHEN a.n >= 10 THEN round(a.q[4])::integer
            ELSE NULL::integer
        END AS p75,
        CASE
            WHEN a.n >= 10 THEN round(a.q[5])::integer
            ELSE NULL::integer
        END AS p90,
    a.prices,
    a.dated,
    a.first_on,
    a.last_on,
    a.n_24m,
    COALESCE(cardinality(x.miles), 0) AS n_miles,
    COALESCE(x.miles, '{}'::integer[]) AS miles,
        CASE
            WHEN cardinality(x.miles) >= 10 THEN x.miles[(cardinality(x.miles) + 1) / 2]
            ELSE NULL::integer
        END AS miles_p50,
    ( SELECT COALESCE(jsonb_object_agg(z.s, z.c ORDER BY z.s), '{}'::jsonb) AS "coalesce"
           FROM ( SELECT s.s,
                    count(*)::integer AS c
                   FROM unnest(a.sources) s(s)
                  GROUP BY s.s) z) AS by_source,
    COALESCE(vj.venues, '{}'::jsonb) AS venues,
    now() AS as_of
   FROM agg a
     JOIN pool pm ON pm.pool = a.pool
     LEFT JOIN mx x ON x.basis = a.basis AND x.pool = a.pool AND x.year = a.year
     LEFT JOIN vsj vj ON vj.basis = a.basis AND vj.pool = a.pool AND vj.year = a.year
  WHERE a.n > 0
WITH DATA;
CREATE UNIQUE INDEX mv_family_year_prices_key_v1_tmp ON public.mv_family_year_prices_v1_new USING btree (family_id, year, basis);
COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices_v1_new IS 'Pre-optimization year-price fold retained privately for reversible rename; no public readers.';
REVOKE ALL ON public.mv_family_year_prices_v1_new FROM PUBLIC, anon, authenticated, service_role;
CREATE MATERIALIZED VIEW public.mv_treemap_sale_brands_new AS
 SELECT brand_name AS name,
    count(*) FILTER (WHERE sold_amount > 0::numeric) AS count,
    sum(sold_amount) FILTER (WHERE sold_amount > 0::numeric)::bigint AS value,
        CASE
            WHEN count(*) FILTER (WHERE sold_amount > 0::numeric) >= 5 THEN percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (sold_amount::double precision)) FILTER (WHERE sold_amount > 0::numeric)::bigint
            ELSE NULL::bigint
        END AS median_price,
    min(sold_amount) FILTER (WHERE sold_amount > 0::numeric)::bigint AS min_price,
    max(sold_amount) FILTER (WHERE sold_amount > 0::numeric)::bigint AS max_price,
    count(*) FILTER (WHERE outcome = 'sold'::text) AS sold_count,
    count(*) AS auction_count,
    round(avg(bat_bids) FILTER (WHERE sold_amount > 0::numeric AND bat_bids > 0))::integer AS avg_bids,
    round(avg(bat_watchers) FILTER (WHERE sold_amount > 0::numeric AND bat_watchers > 0))::integer AS avg_watchers
   FROM mv_treemap_outcomes_new o
  GROUP BY brand_name
 HAVING count(*) FILTER (WHERE sold_amount > 0::numeric) >= 5
WITH DATA;
CREATE UNIQUE INDEX mv_treemap_sale_brands_name_tmp ON public.mv_treemap_sale_brands_new USING btree (name);
COMMENT ON MATERIALIZED VIEW public.mv_treemap_sale_brands_new IS 'The map''s makes, from mv_treemap_outcomes: count = confirmed sales with an amount (the area), median_price = their median, null under 5 sales (the color), value/min/max over the same sales, sold_count = confirmed sales, auction_count = known outcomes. Makes with fewer than 5 sales are left out. 2026-10-14.';
REVOKE ALL ON public.mv_treemap_sale_brands_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_treemap_sale_brands_new TO service_role;
GRANT SELECT ON public.mv_treemap_sale_brands_new TO anon;
GRANT SELECT ON public.mv_treemap_sale_brands_new TO authenticated;
CREATE MATERIALIZED VIEW public.mv_treemap_sale_models_new AS
 SELECT brand_name,
    model AS name,
    count(*) FILTER (WHERE sold_amount > 0::numeric) AS count,
    sum(sold_amount) FILTER (WHERE sold_amount > 0::numeric)::bigint AS value,
        CASE
            WHEN count(*) FILTER (WHERE sold_amount > 0::numeric) >= 5 THEN percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (sold_amount::double precision)) FILTER (WHERE sold_amount > 0::numeric)::bigint
            ELSE NULL::bigint
        END AS median_price,
    min(sold_amount) FILTER (WHERE sold_amount > 0::numeric)::bigint AS min_price,
    max(sold_amount) FILTER (WHERE sold_amount > 0::numeric)::bigint AS max_price,
    count(*) FILTER (WHERE outcome = 'sold'::text) AS sold_count,
    count(*) AS auction_count,
    round(avg(bat_bids) FILTER (WHERE sold_amount > 0::numeric AND bat_bids > 0))::integer AS avg_bids,
    round(avg(bat_watchers) FILTER (WHERE sold_amount > 0::numeric AND bat_watchers > 0))::integer AS avg_watchers
   FROM mv_treemap_outcomes_new o
  WHERE model IS NOT NULL
  GROUP BY brand_name, model
 HAVING count(*) FILTER (WHERE sold_amount > 0::numeric) > 0
WITH DATA;
CREATE UNIQUE INDEX mv_treemap_sale_models_brand_name_tmp ON public.mv_treemap_sale_models_new USING btree (brand_name, name);
COMMENT ON MATERIALIZED VIEW public.mv_treemap_sale_models_new IS 'The map''s models per make, from mv_treemap_outcomes, with the columns of mv_treemap_sale_brands; every model with at least one confirmed sale with an amount. 2026-10-14.';
REVOKE ALL ON public.mv_treemap_sale_models_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mv_treemap_sale_models_new TO service_role;
GRANT SELECT ON public.mv_treemap_sale_models_new TO anon;
GRANT SELECT ON public.mv_treemap_sale_models_new TO authenticated;
CREATE VIEW public.v_market_house_coverage_new AS
 WITH pop AS (
         SELECT DISTINCT ON ((market_venue_label(o_1.slug))) o_1.slug AS source_slug,
            market_venue_label(o_1.slug) AS house,
            c.universe_total,
            c.census_method,
            c.census_confidence,
            c.census_at
           FROM source_census c
             JOIN observation_sources o_1 ON o_1.id = c.source_id
          WHERE market_venue_label(o_1.slug) IS NOT NULL AND (c.universe_total IS NULL OR c.universe_historical IS NOT NULL)
          ORDER BY (market_venue_label(o_1.slug)), c.census_at DESC
        ), byr AS (
         SELECT DISTINCT ON ((market_venue_label(o_1.slug))) market_venue_label(o_1.slug) AS house,
            c.universe_total AS by_year_total,
                CASE
                    WHEN jsonb_typeof(c.by_year) = 'object'::text AND c.by_year <> '{}'::jsonb THEN c.by_year
                    ELSE NULL::jsonb
                END AS by_year
           FROM source_census c
             JOIN observation_sources o_1 ON o_1.id = c.source_id
          WHERE market_venue_label(o_1.slug) IS NOT NULL AND c.by_year IS NOT NULL AND c.by_year <> '{}'::jsonb
          ORDER BY (market_venue_label(o_1.slug)), c.census_at DESC
        ), lan AS (
         SELECT market_venue_label(mv_source_target_landed.source_slug) AS house,
            max(mv_source_target_landed.landed) AS landed_targets,
            max(mv_source_target_landed.landed_lots) AS landed_lots
           FROM mv_source_target_landed
          WHERE market_venue_label(mv_source_target_landed.source_slug) IS NOT NULL
          GROUP BY (market_venue_label(mv_source_target_landed.source_slug))
        ), outc AS (
         SELECT mv_treemap_outcomes_new.source_name AS house,
            count(*) FILTER (WHERE mv_treemap_outcomes_new.sold_amount > 0::numeric) AS confirmed_sold,
            sum(mv_treemap_outcomes_new.sold_amount) FILTER (WHERE mv_treemap_outcomes_new.sold_amount > 0::numeric)::bigint AS confirmed_usd
           FROM mv_treemap_outcomes_new
          WHERE mv_treemap_outcomes_new.source_name IS NOT NULL
          GROUP BY mv_treemap_outcomes_new.source_name
        ), dated AS (
         SELECT mv_family_sales_new.source AS house,
            count(*) AS dated_sold,
            count(*) FILTER (WHERE mv_family_sales_new.sale_date > (CURRENT_DATE - 365) AND mv_family_sales_new.sale_date <= CURRENT_DATE) AS sold_12m,
            count(*) FILTER (WHERE mv_family_sales_new.sale_date > (CURRENT_DATE - 730) AND mv_family_sales_new.sale_date <= (CURRENT_DATE - 365)) AS sold_prior_12m,
            sum(mv_family_sales_new.usd) FILTER (WHERE mv_family_sales_new.sale_date > (CURRENT_DATE - 365) AND mv_family_sales_new.sale_date <= CURRENT_DATE)::bigint AS usd_12m,
            sum(mv_family_sales_new.usd) FILTER (WHERE mv_family_sales_new.sale_date > (CURRENT_DATE - 730) AND mv_family_sales_new.sale_date <= (CURRENT_DATE - 365))::bigint AS usd_prior_12m
           FROM mv_family_sales_new
          GROUP BY mv_family_sales_new.source
        )
 SELECT o.house,
    p.source_slug,
    COALESCE(b.by_year_total, p.universe_total) AS census_total,
    p.census_method,
    p.census_confidence,
    l.landed_lots,
    round(100.0 * l.landed_lots::numeric / NULLIF(COALESCE(b.by_year_total, p.universe_total), 0)::numeric, 1) AS landed_pct,
    b.by_year IS NOT NULL AS has_by_year,
    o.confirmed_sold,
    o.confirmed_usd,
    COALESCE(d.dated_sold, 0::bigint) AS dated_sold,
    round(100.0 * COALESCE(d.dated_sold, 0::bigint)::numeric / NULLIF(o.confirmed_sold, 0)::numeric, 1) AS dated_pct,
    COALESCE(d.sold_12m, 0::bigint) AS sold_12m,
    COALESCE(d.sold_prior_12m, 0::bigint) AS sold_prior_12m,
    COALESCE(d.usd_12m, 0::bigint) AS usd_12m,
    COALESCE(d.usd_prior_12m, 0::bigint) AS usd_prior_12m,
    b.by_year IS NOT NULL AND COALESCE(b.by_year_total, p.universe_total) > 0 AND l.landed_lots::numeric >= (0.90 * COALESCE(b.by_year_total, p.universe_total)::numeric) AS qualified_measured
   FROM outc o
     LEFT JOIN pop p ON p.house = o.house
     LEFT JOIN byr b ON b.house = o.house
     LEFT JOIN lan l ON l.house = o.house
     LEFT JOIN dated d ON d.house = o.house
  ORDER BY o.confirmed_sold DESC, o.house;
COMMENT ON VIEW public.v_market_house_coverage_new IS 'Per-venue market qualification fold joining source_census (population & per-year by_year enumeration), mv_source_target_landed (landed lots), mv_treemap_outcomes (confirmed sales), and mv_family_sales (dated sales). A house earns qualified_measured = true when it has a per-year census and we hold >=90% of its enumerated lots.';
REVOKE ALL ON public.v_market_house_coverage_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_market_house_coverage_new TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_market_house_coverage_new TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_market_house_coverage_new TO service_role;
CREATE VIEW public.v_market_measurement_coverage_new AS
 WITH hc AS (
         SELECT count(*) AS total_houses,
            count(*) FILTER (WHERE v_market_house_coverage_new.qualified_measured) AS measured_houses,
            sum(v_market_house_coverage_new.confirmed_sold)::bigint AS total_sold,
            sum(v_market_house_coverage_new.dated_sold)::bigint AS total_dated_sold,
            sum(v_market_house_coverage_new.confirmed_sold) FILTER (WHERE v_market_house_coverage_new.qualified_measured)::bigint AS measured_house_sold,
            sum(v_market_house_coverage_new.dated_sold) FILTER (WHERE v_market_house_coverage_new.qualified_measured)::bigint AS measured_house_dated_sold
           FROM v_market_house_coverage_new
        ), outc_id AS (
         SELECT count(*) FILTER (WHERE mv_treemap_outcomes_new.sold_amount > 0::numeric) AS sold_total,
            count(*) FILTER (WHERE mv_treemap_outcomes_new.sold_amount > 0::numeric AND NULLIF(btrim(mv_treemap_outcomes_new.model), ''::text) IS NOT NULL) AS sold_with_model,
            count(*) FILTER (WHERE mv_treemap_outcomes_new.sold_amount > 0::numeric AND NULLIF(btrim(mv_treemap_outcomes_new.model), ''::text) IS NULL) AS sold_null_model
           FROM mv_treemap_outcomes_new
        ), fam_cov AS (
         SELECT sum(m.sold)::bigint AS total_sold,
            sum(m.sold) FILTER (WHERE m.family_key <> 'other'::text)::bigint AS keyed_sold,
            sum(m.usd)::bigint AS total_usd,
            sum(m.usd) FILTER (WHERE m.family_key <> 'other'::text)::bigint AS keyed_usd,
            count(DISTINCT ROW(m.brand, m.family_key)) FILTER (WHERE m.family_key <> 'other'::text) AS total_families,
            count(DISTINCT ROW(m.brand, m.family_key)) FILTER (WHERE m.family_key <> 'other'::text AND m.f_sold_12m >= 20::numeric AND m.f_sold_prior_12m >= 20::numeric) AS families_passing_count,
            count(DISTINCT ROW(m.brand, m.family_key)) FILTER (WHERE m.family_key <> 'other'::text AND m.f_sold_12m >= 20::numeric AND m.f_sold_prior_12m >= 20::numeric AND m.f_dated >= (0.5 * m.f_sold)) AS families_colored
           FROM ( SELECT mv_family_market_new.brand,
                    mv_family_market_new.family_key,
                    mv_family_market_new.sold,
                    mv_family_market_new.usd,
                    sum(mv_family_market_new.sold) OVER (PARTITION BY mv_family_market_new.brand, mv_family_market_new.family_key) AS f_sold,
                    sum(mv_family_market_new.bat_dated) OVER (PARTITION BY mv_family_market_new.brand, mv_family_market_new.family_key) AS f_dated,
                    sum(mv_family_market_new.bat_sold_12m) OVER (PARTITION BY mv_family_market_new.brand, mv_family_market_new.family_key) AS f_sold_12m,
                    sum(mv_family_market_new.bat_sold_prior_12m) OVER (PARTITION BY mv_family_market_new.brand, mv_family_market_new.family_key) AS f_sold_prior_12m
                   FROM mv_family_market_new) m
        ), brand_cov AS (
         SELECT count(*) AS total_brands,
            count(*) FILTER (WHERE treemap_brand_market.sold_12m >= 20 AND treemap_brand_market.sold_prior_12m >= 20) AS brands_passing_count,
            count(*) FILTER (WHERE treemap_brand_market.sold_12m >= 20 AND treemap_brand_market.sold_prior_12m >= 20 AND treemap_brand_market.dated::numeric >= (0.5 * treemap_brand_market.sold::numeric)) AS brands_colored
           FROM treemap_brand_market() treemap_brand_market(name, sold, sold_any, offered, usd, p10, p50, p90, year_p50, dated, sold_12m, sold_prior_12m, usd_12m, usd_prior_12m, as_of)
        ), hed_cov AS (
         SELECT count(*) AS eligible_families,
            ( SELECT count(*) AS count
                   FROM family_price_change
                  WHERE family_price_change.method = 'hedonic_v1'::text AND family_price_change.change_12m IS NOT NULL) AS fitted_families
           FROM ( SELECT mv_family_sales_new.brand,
                    mv_family_sales_new.family_key
                   FROM mv_family_sales_new
                  WHERE mv_family_sales_new.family_key <> 'other'::text AND mv_family_sales_new.usd >= 500 AND mv_family_sales_new.sale_date >= '2016-01-01'::date AND mv_family_sales_new.sale_date <= CURRENT_DATE
                  GROUP BY mv_family_sales_new.brand, mv_family_sales_new.family_key
                 HAVING count(*) >= 150 AND count(*) FILTER (WHERE mv_family_sales_new.sale_date > (CURRENT_DATE - 365)) >= 30 AND count(*) FILTER (WHERE mv_family_sales_new.sale_date > (CURRENT_DATE - 730) AND mv_family_sales_new.sale_date <= (CURRENT_DATE - 365)) >= 30) e
        )
 SELECT layer,
    measure,
    numerator,
    denominator,
    round(100.0 * numerator::numeric / NULLIF(denominator, 0)::numeric, 1) AS pct,
    grain
   FROM ( SELECT 'baseline'::text AS layer,
            'auction houses qualified as measured (>=90% census & by_year)'::text AS measure,
            hc.measured_houses AS numerator,
            hc.total_houses AS denominator,
            'houses'::text AS grain
           FROM hc
        UNION ALL
         SELECT 'log'::text,
            'confirmed sales carrying a sale_date on vehicles'::text,
            hc.total_dated_sold,
            hc.total_sold,
            'sales'::text
           FROM hc
        UNION ALL
         SELECT 'log'::text,
            'confirmed sales at measured houses carrying a sale_date'::text,
            hc.measured_house_dated_sold,
            hc.measured_house_sold,
            'sales'::text
           FROM hc
        UNION ALL
         SELECT 'dimension'::text,
            'confirmed sales carrying a non-null model'::text,
            outc_id.sold_with_model,
            outc_id.sold_total,
            'sales'::text
           FROM outc_id
        UNION ALL
         SELECT 'residual'::text,
            'confirmed sales missing model (must approach 0)'::text,
            outc_id.sold_null_model,
            outc_id.sold_total,
            'sales'::text
           FROM outc_id
        UNION ALL
         SELECT 'key'::text,
            'confirmed sales keyed to a named canonical model family'::text,
            fam_cov.keyed_sold,
            fam_cov.total_sold,
            'sales'::text
           FROM fam_cov
        UNION ALL
         SELECT 'key'::text,
            'confirmed sale dollars keyed to a named canonical model family'::text,
            fam_cov.keyed_usd,
            fam_cov.total_usd,
            'usd'::text
           FROM fam_cov
        UNION ALL
         SELECT 'fold'::text,
            'brands with >=20 sales/yr passing the 50% measured-house share gate'::text,
            brand_cov.brands_colored,
            brand_cov.brands_passing_count,
            'brands'::text
           FROM brand_cov
        UNION ALL
         SELECT 'fold'::text,
            'named families with >=20 sales/yr passing the 50% measured-house share gate'::text,
            fam_cov.families_colored,
            fam_cov.families_passing_count,
            'families'::text
           FROM fam_cov
        UNION ALL
         SELECT 'prediction'::text,
            'eligible model families (30/30/150 floor) fitted with hedonic_v1 price index'::text,
            hed_cov.fitted_families,
            hed_cov.eligible_families,
            'families'::text
           FROM hed_cov) s;
COMMENT ON VIEW public.v_market_measurement_coverage_new IS 'Recursive self-improvement (RSI) coverage scoreboard for the market treemap & price-index stack across baseline, log, dimension, residual, key, fold, and prediction layers.';
REVOKE ALL ON public.v_market_measurement_coverage_new FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_market_measurement_coverage_new TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_market_measurement_coverage_new TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_market_measurement_coverage_new TO service_role;

-- Part 2: swap
SET LOCAL lock_timeout = '5s';
ALTER MATERIALIZED VIEW public.mv_treemap_outcomes RENAME TO mv_treemap_outcomes_bak;
ALTER MATERIALIZED VIEW public.mv_brand_market RENAME TO mv_brand_market_bak;
ALTER MATERIALIZED VIEW public.mv_family_market RENAME TO mv_family_market_bak;
ALTER MATERIALIZED VIEW public.mv_family_sales RENAME TO mv_family_sales_bak;
ALTER MATERIALIZED VIEW public.mv_family_year_prices RENAME TO mv_family_year_prices_bak;
ALTER MATERIALIZED VIEW public.mv_family_year_prices_v1 RENAME TO mv_family_year_prices_v1_bak;
ALTER MATERIALIZED VIEW public.mv_treemap_sale_brands RENAME TO mv_treemap_sale_brands_bak;
ALTER MATERIALIZED VIEW public.mv_treemap_sale_models RENAME TO mv_treemap_sale_models_bak;
ALTER VIEW public.v_market_house_coverage RENAME TO v_market_house_coverage_bak;
ALTER VIEW public.v_market_measurement_coverage RENAME TO v_market_measurement_coverage_bak;
ALTER INDEX public.mv_treemap_outcomes_id RENAME TO mv_treemap_outcomes_id_bak;
ALTER INDEX public.mv_treemap_outcomes_cell RENAME TO mv_treemap_outcomes_cell_bak;
ALTER INDEX public.mv_brand_market_name RENAME TO mv_brand_market_name_bak;
ALTER INDEX public.mv_family_market_key RENAME TO mv_family_market_key_bak;
ALTER INDEX public.mv_family_sales_vehicle RENAME TO mv_family_sales_vehicle_bak;
ALTER INDEX public.mv_family_sales_family_date RENAME TO mv_family_sales_family_date_bak;
ALTER INDEX public.mv_family_year_prices_key RENAME TO mv_family_year_prices_key_bak;
ALTER INDEX public.mv_family_year_prices_key_v1 RENAME TO mv_family_year_prices_key_v1_bak;
ALTER INDEX public.mv_treemap_sale_brands_name RENAME TO mv_treemap_sale_brands_name_bak;
ALTER INDEX public.mv_treemap_sale_models_brand_name RENAME TO mv_treemap_sale_models_brand_name_bak;
ALTER MATERIALIZED VIEW public.mv_treemap_outcomes_new RENAME TO mv_treemap_outcomes;
ALTER MATERIALIZED VIEW public.mv_brand_market_new RENAME TO mv_brand_market;
ALTER MATERIALIZED VIEW public.mv_family_market_new RENAME TO mv_family_market;
ALTER MATERIALIZED VIEW public.mv_family_sales_new RENAME TO mv_family_sales;
ALTER MATERIALIZED VIEW public.mv_family_year_prices_new RENAME TO mv_family_year_prices;
ALTER MATERIALIZED VIEW public.mv_family_year_prices_v1_new RENAME TO mv_family_year_prices_v1;
ALTER MATERIALIZED VIEW public.mv_treemap_sale_brands_new RENAME TO mv_treemap_sale_brands;
ALTER MATERIALIZED VIEW public.mv_treemap_sale_models_new RENAME TO mv_treemap_sale_models;
ALTER VIEW public.v_market_house_coverage_new RENAME TO v_market_house_coverage;
ALTER VIEW public.v_market_measurement_coverage_new RENAME TO v_market_measurement_coverage;
ALTER INDEX public.mv_treemap_outcomes_id_tmp RENAME TO mv_treemap_outcomes_id;
ALTER INDEX public.mv_treemap_outcomes_cell_tmp RENAME TO mv_treemap_outcomes_cell;
ALTER INDEX public.mv_brand_market_name_tmp RENAME TO mv_brand_market_name;
ALTER INDEX public.mv_family_market_key_tmp RENAME TO mv_family_market_key;
ALTER INDEX public.mv_family_sales_vehicle_tmp RENAME TO mv_family_sales_vehicle;
ALTER INDEX public.mv_family_sales_family_date_tmp RENAME TO mv_family_sales_family_date;
ALTER INDEX public.mv_family_year_prices_key_tmp RENAME TO mv_family_year_prices_key;
ALTER INDEX public.mv_family_year_prices_key_v1_tmp RENAME TO mv_family_year_prices_key_v1;
ALTER INDEX public.mv_treemap_sale_brands_name_tmp RENAME TO mv_treemap_sale_brands_name;
ALTER INDEX public.mv_treemap_sale_models_brand_name_tmp RENAME TO mv_treemap_sale_models_brand_name;
