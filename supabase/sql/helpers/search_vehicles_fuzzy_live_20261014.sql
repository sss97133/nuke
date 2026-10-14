-- search_vehicles_fuzzy as production had it on 2026-10-14 before 20261014223000_search_fuzzy_make_model_names.sql
-- (pg_get_functiondef). Loaded by supabase/sql/test_search_fuzzy_make_model_names.sql as the before state; it is also
-- the rollback text.
CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(vehicle_id uuid, year smallint, make text, model text, vin text, primary_image_url text, sale_price bigint, relevance real, match_source text, snippet text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF trim(p_query) = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.year::smallint,
    v.make,
    v.model,
    v.vin,
    v.primary_image_url,
    v.sale_price::bigint,
    (similarity(lower(v.make || ' ' || coalesce(v.model, '')), lower(trim(p_query))) * 0.8)::real,
    'fuzzy'::text,
    ''::text
  FROM vehicles v
  WHERE v.is_public = true
    AND v.make IS NOT NULL
    AND similarity(lower(v.make || ' ' || coalesce(v.model, '')), lower(trim(p_query))) > 0.25
  ORDER BY similarity(lower(v.make || ' ' || coalesce(v.model, '')), lower(trim(p_query))) DESC
  LIMIT p_limit;
END;
$function$
;
