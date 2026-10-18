-- treemap_family_monthly: Bring a Trailer sales per month-length bin over two years, for the map's movers.
--
-- The movers strip (treemap_family_movers) says how a family's last 12 months on BaT compare with the 12 before
-- ("Ferrari 360 ▲186% 46→92 sold"). The owner, 2026-10-15: the 12-month move is the interest, but it needs expansion and
-- clarity. A sparkline of the two years shows the shape behind the two numbers: a steady climb, one big month, a fall.
--
-- Reader: treemap_family_monthly(p_families jsonb) takes [{brand, family_key}, ...] (at most 40) and returns one jsonb:
-- {anchor, window_days 730, bin_days, families: [{brand, family_key, bins[24]}]}, bins oldest first. Bin i counts the
-- family's BaT sales in mv_family_sales whose age in days (anchor - sale_date, 0..729) falls in the i-th of 24 equal
-- slices, so bins 12..23 are exactly sale_date in (anchor - 365, anchor] and bins 0..11 the 365 days before: the same
-- windows, source and date rule (coalesce(sale_date, bat_sale_date)) as mv_family_market's bat_sold_12m and
-- bat_sold_prior_12m. The anchor is current_date. One jsonb value, so the API's 1,000-row cap does not apply.
-- Contract: supabase/sql/test_family_monthly_bins.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_sales_family_date') IS NULL THEN
    RAISE EXCEPTION 'mv_family_sales and its family index are missing; apply 20261015213000_family_sales_fold.sql first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.treemap_family_monthly(p_families jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH req AS (
    SELECT DISTINCT ON (x->>'brand', x->>'family_key') x->>'brand' AS brand, x->>'family_key' AS family_key, o
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_families) = 'array' THEN p_families ELSE '[]'::jsonb END)
         WITH ORDINALITY AS a(x, o)
    WHERE x->>'brand' IS NOT NULL AND x->>'family_key' IS NOT NULL
    ORDER BY x->>'brand', x->>'family_key', o
  ), capped AS (
    SELECT * FROM req ORDER BY o LIMIT 40
  ), b AS (
    SELECT c.brand, c.family_key, 23 - ((current_date - s.sale_date) * 24 / 730) AS bin, count(*) AS n
    FROM capped c
    JOIN public.mv_family_sales s ON s.brand = c.brand AND s.family_key = c.family_key
    WHERE s.source = 'Bring a Trailer' AND s.sale_date > current_date - 730 AND s.sale_date <= current_date
    GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'anchor', current_date, 'window_days', 730, 'bin_days', round(730 / 24.0, 2),
    'families', coalesce((
      SELECT jsonb_agg(jsonb_build_object('brand', c.brand, 'family_key', c.family_key,
        'bins', (SELECT jsonb_agg(coalesce(b.n, 0) ORDER BY g)
                 FROM generate_series(0, 23) g
                 LEFT JOIN b ON b.brand = c.brand AND b.family_key = c.family_key AND b.bin = g)) ORDER BY c.o)
      FROM capped c), '[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_monthly(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_monthly(jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_monthly(jsonb) IS
  'Bring a Trailer sales per family in 24 equal bins over the last 730 days (bins 12..23 = the last 365 days, as '
  'mv_family_market.bat_sold_12m), oldest first, for up to 40 [{brand, family_key}]: the movers'' sparklines. 2026-10-15.';

COMMIT;
