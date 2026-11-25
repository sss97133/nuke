-- mv_market_pulse_public_test_v1: the market pulse matview states the whole visibility test on vehicles.
--
-- WHY. mv_market_pulse feeds market_pulse (SECURITY DEFINER, executed by anon: the iOS market treemap), and anon can
-- SELECT the matview directly. Its vehicle set was `WHERE veh.is_public`, with no deleted_at test, so deleted cars were
-- counted in every dimension (make, model, year, metro, day of week, colour, price, mileage, popularity), entered the
-- medians, and could supply a dimension's image_url.
--
-- WHAT CHANGES. The same definition (pg_get_viewdef, 2026-11-25) with `WHERE veh.is_public AND veh.deleted_at IS NULL`.
-- It is built beside the old one as mv_market_pulse_next with its unique (dim, name) index, then swapped in by one DO
-- block (drop the old, rename the new and its index, restore grants), so market_pulse never sees a missing relation.
-- Build bound: 120 s, the bound refresh-market-views-nightly already gives this refresh. market_pulse needs no change.
-- Contract: supabase/sql/test_mv_market_pulse_public_test.sql.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DROP MATERIALIZED VIEW IF EXISTS public.mv_market_pulse_next;
CREATE MATERIALIZED VIEW public.mv_market_pulse_next AS
 WITH pairs AS (
         SELECT DISTINCT mk.id AS make_id,
            cm.canonical_model
           FROM (canonical_models cm
             JOIN canonical_makes mk ON (((lower(cm.make) = lower(mk.canonical_name)) OR (lower(cm.make) = lower(mk.display_name)))))
        ), v AS (
         SELECT COALESCE(mk.display_name, mk.canonical_name) AS canon_make,
                CASE
                    WHEN (p.canonical_model IS NOT NULL) THEN ((COALESCE(mk.display_name, mk.canonical_name) || ' '::text) || veh.normalized_model)
                    ELSE NULL::text
                END AS canon_model,
            veh.year,
            veh.city,
            veh.state,
            veh.sale_date,
            veh.color_family,
            veh.mileage,
            veh.bat_watchers AS watchers,
            COALESCE((veh.sale_price)::numeric, (veh.sold_price)::numeric, veh.canonical_sold_price) AS price,
            veh.primary_image_url AS img,
                CASE
                    WHEN (veh.canonical_platform = ANY (ARRAY['bat'::text, 'cars-and-bids'::text, 'barrett-jackson'::text, 'mecum'::text, 'bonhams'::text, 'classiccars-com'::text, 'gooding'::text, 'rm-sothebys'::text, 'broad-arrow'::text])) THEN 0
                    ELSE 1
                END AS plat_rank
           FROM ((vehicles veh
             LEFT JOIN canonical_makes mk ON ((mk.id = veh.canonical_make_id)))
             LEFT JOIN pairs p ON (((p.make_id = veh.canonical_make_id) AND (p.canonical_model = veh.normalized_model))))
          WHERE veh.is_public AND veh.deleted_at IS NULL
        )
 SELECT dim,
    name,
    count,
    median_price,
    image_url
   FROM ( SELECT 'make'::text AS dim,
            COALESCE(v.canon_make, 'Unresolved'::text) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          GROUP BY COALESCE(v.canon_make, 'Unresolved'::text)
        UNION ALL
         SELECT 'model'::text AS dim,
            COALESCE(v.canon_model, 'Unresolved'::text) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          GROUP BY COALESCE(v.canon_model, 'Unresolved'::text)
        UNION ALL
         SELECT 'year'::text AS dim,
            (v.year)::text AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE ((v.year >= 1885) AND (v.year <= 2027))
          GROUP BY (v.year)::text
        UNION ALL
         SELECT 'metro'::text AS dim,
            ((v.city || ', '::text) || v.state) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE ((v.city IS NOT NULL) AND (v.state IS NOT NULL))
          GROUP BY ((v.city || ', '::text) || v.state)
        UNION ALL
         SELECT 'dow'::text AS dim,
            to_char((v.sale_date)::timestamp with time zone, 'Dy'::text) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.sale_date IS NOT NULL)
          GROUP BY (to_char((v.sale_date)::timestamp with time zone, 'Dy'::text))
        UNION ALL
         SELECT 'color'::text AS dim,
            v.color_family AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.color_family IS NOT NULL)
          GROUP BY v.color_family
        UNION ALL
         SELECT 'price'::text AS dim,
                CASE
                    WHEN (v.price IS NULL) THEN NULL::text
                    WHEN (v.price < (10000)::numeric) THEN '<$10k'::text
                    WHEN (v.price < (25000)::numeric) THEN '$10-25k'::text
                    WHEN (v.price < (50000)::numeric) THEN '$25-50k'::text
                    WHEN (v.price < (100000)::numeric) THEN '$50-100k'::text
                    WHEN (v.price < (250000)::numeric) THEN '$100-250k'::text
                    WHEN (v.price < (1000000)::numeric) THEN '$250k-1M'::text
                    ELSE '$1M+'::text
                END AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.price IS NOT NULL)
          GROUP BY
                CASE
                    WHEN (v.price IS NULL) THEN NULL::text
                    WHEN (v.price < (10000)::numeric) THEN '<$10k'::text
                    WHEN (v.price < (25000)::numeric) THEN '$10-25k'::text
                    WHEN (v.price < (50000)::numeric) THEN '$25-50k'::text
                    WHEN (v.price < (100000)::numeric) THEN '$50-100k'::text
                    WHEN (v.price < (250000)::numeric) THEN '$100-250k'::text
                    WHEN (v.price < (1000000)::numeric) THEN '$250k-1M'::text
                    ELSE '$1M+'::text
                END
        UNION ALL
         SELECT 'mileage'::text AS dim,
                CASE
                    WHEN (v.mileage IS NULL) THEN NULL::text
                    WHEN (v.mileage < 1000) THEN 'Under 1k mi'::text
                    WHEN (v.mileage < 10000) THEN '1-10k mi'::text
                    WHEN (v.mileage < 50000) THEN '10-50k mi'::text
                    WHEN (v.mileage < 100000) THEN '50-100k mi'::text
                    WHEN (v.mileage < 150000) THEN '100-150k mi'::text
                    ELSE '150k+ mi'::text
                END AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE ((v.mileage IS NOT NULL) AND (v.mileage >= 0))
          GROUP BY
                CASE
                    WHEN (v.mileage IS NULL) THEN NULL::text
                    WHEN (v.mileage < 1000) THEN 'Under 1k mi'::text
                    WHEN (v.mileage < 10000) THEN '1-10k mi'::text
                    WHEN (v.mileage < 50000) THEN '10-50k mi'::text
                    WHEN (v.mileage < 100000) THEN '50-100k mi'::text
                    WHEN (v.mileage < 150000) THEN '100-150k mi'::text
                    ELSE '150k+ mi'::text
                END
        UNION ALL
         SELECT 'popularity'::text AS dim,
                CASE
                    WHEN (v.watchers IS NULL) THEN NULL::text
                    WHEN (v.watchers >= 500) THEN '500+ watching'::text
                    WHEN (v.watchers >= 200) THEN '200-499 watching'::text
                    WHEN (v.watchers >= 100) THEN '100-199 watching'::text
                    WHEN (v.watchers >= 50) THEN '50-99 watching'::text
                    WHEN (v.watchers >= 10) THEN '10-49 watching'::text
                    ELSE 'Under 10 watching'::text
                END AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.watchers IS NOT NULL)
          GROUP BY
                CASE
                    WHEN (v.watchers IS NULL) THEN NULL::text
                    WHEN (v.watchers >= 500) THEN '500+ watching'::text
                    WHEN (v.watchers >= 200) THEN '200-499 watching'::text
                    WHEN (v.watchers >= 100) THEN '100-199 watching'::text
                    WHEN (v.watchers >= 50) THEN '50-99 watching'::text
                    WHEN (v.watchers >= 10) THEN '10-49 watching'::text
                    ELSE 'Under 10 watching'::text
                END) s
  WHERE ((name IS NOT NULL) AND (name <> ''::text));
CREATE UNIQUE INDEX mv_market_pulse_next_pk ON public.mv_market_pulse_next USING btree (dim, name);

DO $swap$
BEGIN
  DROP MATERIALIZED VIEW public.mv_market_pulse;
  ALTER MATERIALIZED VIEW public.mv_market_pulse_next RENAME TO mv_market_pulse;
  ALTER INDEX public.mv_market_pulse_next_pk RENAME TO mv_market_pulse_pk;
  REVOKE ALL ON public.mv_market_pulse FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON public.mv_market_pulse TO anon, authenticated, service_role;
END
$swap$;
