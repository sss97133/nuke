-- treemap_family_sales returns one value: the family's whole five years, not the API's first 1,000 rows.
--
-- MEASURED 2026-10-15 07:40Z, logged out: the reader of 20261015213000 returned a set, and the API returns at most
-- 1,000 rows of any set (content-range: 0-999/*), so the 911's sales chart would have drawn its newest 1,000 sales
-- (2026-06-09 .. 10-14) of 10,703 in five years, and the reader's own limit of 5,000 would have cut it at about two and
-- a half years anyway. The largest families over five years (mv_family_sales, 07:42Z): Porsche 911 10,703, Chevrolet
-- 7,074, Ford 5,419, Mercedes-Benz 4,284.
--
-- CHANGE: the reader returns a single jsonb, {n, returned, truncated, window_from, rows}, rows newest first as
-- [vehicle_id, sale_date, usd, source, year, model], up to 12,000 (every family today). Same window (the last five
-- years), same order, same grants. Nothing reads the old shape yet: its chart (PR #1443) is unmerged.
-- Contract: supabase/sql/test_family_sales_one_value.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc
   WHERE oid = to_regprocedure('public.treemap_family_sales(text,text,integer)');
  IF v IS DISTINCT FROM 'ofYqsB3JbWc/x+UxbB0tZne0cI6xWmtWzONTr907VR8=' AND v IS DISTINCT FROM '58labjUYxZ4gQymFa195wibpeTvHNOGo8iAMwJGF/Gc=' THEN
    RAISE EXCEPTION 'treemap_family_sales is not the 20261015213000 definition this replaces (sha256 %)', v;
  END IF;
END $guard$;

DROP FUNCTION IF EXISTS public.treemap_family_sales(text, text, integer);
CREATE FUNCTION public.treemap_family_sales(p_brand text, p_family_key text, p_limit integer DEFAULT 12000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH w AS (
    SELECT vehicle_id, sale_date, usd, source, year, model
    FROM public.mv_family_sales
    WHERE brand = p_brand AND family_key = p_family_key AND sale_date > current_date - 1826 AND sale_date <= current_date
  ), page AS (
    SELECT * FROM w ORDER BY sale_date DESC, vehicle_id LIMIT least(greatest(p_limit, 1), 12000)
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM w),
    'returned', (SELECT count(*) FROM page),
    'truncated', (SELECT count(*) FROM w) > (SELECT count(*) FROM page),
    'window_from', current_date - 1825,
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source, year, model)
                                        ORDER BY sale_date DESC, vehicle_id) FROM page), '[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_sales(text, text, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_sales(text, text, integer) IS
  'One model family''s confirmed sales with a date in the last five years (mv_family_sales) as one jsonb: n in the '
  'window, returned (at most 12,000), truncated, window_from, and rows newest first as [vehicle_id, sale_date, usd, '
  'source, year, model]: the dots of its sales chart. One value, so the API''s 1,000-row cap does not apply. 2026-10-15.';

COMMIT;
