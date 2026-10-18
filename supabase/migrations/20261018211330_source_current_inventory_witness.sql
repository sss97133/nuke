-- Keep current inventory distinct from the all-time retained catalogue. Extend the existing reader in place so its
-- independently maintained source/species and landing rules are not copied into another owner.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

-- This is the published search count observed in Chrome on October 18, not a census of KSL's historical listings.
-- record_census is the existing census writer; NULL total also keeps universe_historical unknown.
SELECT public.record_census(
  p_source_slug => 'ksl', p_universe_total => NULL, p_universe_active => 67878,
  p_census_method => 'search_result_count', p_census_confidence => 1.00,
  p_census_url => 'https://cars.ksl.com/',
  p_raw_response => '{"scope":"all_current","observed_at":"2026-10-18","witness":"Show 67,878 results","method":"manual_browser_read","receipt":"ksl-search-count-20261018","filtered_example":{"url":"https://cars.ksl.com/search/yearFrom/1900/yearTo/1991","count":1174,"years":[1900,1991]}}'::jsonb
) WHERE NOT EXISTS (
  SELECT 1 FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
  WHERE o.slug = 'ksl' AND c.raw_response ->> 'receipt' = 'ksl-search-count-20261018'
);

DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.market_sources_read()'::regprocedure);
  anchor text := $anchor$    'day', (SELECT day FROM d),$anchor$;
  addition text := $addition$
    'current_inventory', coalesce((
      SELECT jsonb_object_agg(w.slug, jsonb_build_object(
        'count', w.universe_active, 'observed_at', w.observed_at,
        'recorded_at', w.census_at, 'url', w.census_url, 'method', w.census_method
      )) FROM (
        SELECT DISTINCT ON (o.slug) o.slug, c.universe_active, c.census_at, c.census_url, c.census_method,
               coalesce(c.raw_response ->> 'observed_at', c.census_at::text) AS observed_at
        FROM public.observation_sources o
        JOIN ranked r ON r.source_slug = o.slug
        JOIN public.source_census c ON c.source_id = o.id
        WHERE c.census_method = 'search_result_count' AND c.raw_response ->> 'scope' = 'all_current'
          AND c.universe_total IS NULL AND c.universe_historical IS NULL AND c.universe_active >= 0
        ORDER BY o.slug, coalesce(c.raw_response ->> 'observed_at', c.census_at::text) DESC, c.census_at DESC
      ) w
    ), '{}'::jsonb),$addition$;
BEGIN
  IF position($marker$'current_inventory'$marker$ IN definition) > 0 THEN RETURN; END IF;
  IF position(anchor IN definition) = 0 THEN RAISE EXCEPTION 'market_sources_read output anchor changed'; END IF;
  EXECUTE replace(definition, anchor, anchor || addition);
END;
$migration$;
COMMIT;
