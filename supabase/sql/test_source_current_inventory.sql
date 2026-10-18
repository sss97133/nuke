-- Disposable PG17 only; extends the existing board contract and executes the actual census writer and reader patch.
\ir test_source_species.sql
ALTER TABLE public.source_census ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS by_year jsonb DEFAULT '{}', ADD COLUMN IF NOT EXISTS by_make jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS next_census_at timestamptz;
-- Existing record_census (20260127_source_census_system.sql), verified against live on 2026-10-18.
CREATE OR REPLACE FUNCTION public.record_census(p_source_slug text, p_universe_total integer, p_universe_active integer DEFAULT NULL::integer, p_census_method text DEFAULT 'manual'::text, p_census_confidence numeric DEFAULT 0.80, p_census_url text DEFAULT NULL::text, p_by_year jsonb DEFAULT '{}'::jsonb, p_by_make jsonb DEFAULT '{}'::jsonb, p_raw_response jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_source_id UUID;
  v_census_id UUID;
BEGIN
  -- Get source ID
  SELECT id INTO v_source_id
  FROM observation_sources
  WHERE slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'Source not found: %', p_source_slug;
  END IF;

  -- Insert census record
  INSERT INTO source_census (
    source_id,
    universe_total,
    universe_active,
    universe_historical,
    census_method,
    census_confidence,
    census_url,
    by_year,
    by_make,
    raw_response,
    next_census_at
  ) VALUES (
    v_source_id,
    p_universe_total,
    p_universe_active,
    p_universe_total - COALESCE(p_universe_active, 0),
    p_census_method,
    p_census_confidence,
    p_census_url,
    p_by_year,
    p_by_make,
    p_raw_response,
    NOW() + INTERVAL '24 hours'  -- Default: recount daily
  )
  RETURNING id INTO v_census_id;

  RETURN v_census_id;
END;
$function$
;

CREATE TEMP TABLE before_inventory AS SELECT public.market_sources_read() - 'as_of' AS payload;
\ir ../migrations/20261018211330_source_current_inventory_witness.sql
\ir ../migrations/20261018211330_source_current_inventory_witness.sql
SELECT pg_temp.ok('the KSL witness is idempotent and never invents total or historical counts',
  (SELECT count(*) = 1 AND bool_and(universe_total IS NULL AND universe_historical IS NULL AND universe_active = 67878)
   FROM public.source_census WHERE raw_response ->> 'receipt' = 'ksl-search-count-20261018'));
SELECT pg_temp.ok('the existing source board and telemetry remain unchanged',
  (SELECT public.market_sources_read() - 'as_of' - 'current_inventory' = payload FROM before_inventory));
SELECT pg_temp.ok('the reader exposes the exact current result count, observation date and source URL',
  (public.market_sources_read() #> '{current_inventory,ksl}') @>
    '{"count":67878,"observed_at":"2026-10-18","url":"https://cars.ksl.com/","method":"search_result_count"}'::jsonb);
-- A later filtered result count and a historical census cannot replace current inventory.
SELECT public.record_census('ksl', NULL, 1174, 'search_result_count', 1,
  'https://cars.ksl.com/search/yearFrom/1900/yearTo/1991', p_raw_response =>
  '{"scope":"filtered","observed_at":"2026-10-19","years":[1900,1991]}');
SELECT public.record_census('ksl', 80000, NULL, 'owner_reference', 0.4);
SELECT pg_temp.ok('a newer filtered count never becomes the whole current-inventory count',
  (public.market_sources_read() #>> '{current_inventory,ksl,count}')::int = 67878);
SELECT public.record_census('ksl', NULL, 0, 'search_result_count', 1, 'https://cars.ksl.com/search',
  p_raw_response => '{"scope":"all_current","observed_at":"2026-10-20"}');
SELECT pg_temp.ok('a source-confirmed empty inventory is zero, not unknown or an earlier positive count',
  (public.market_sources_read() #>> '{current_inventory,ksl,count}')::int = 0);
SET ROLE anon;
SELECT pg_temp.ok('the existing anonymous board reader includes the qualified count',
  (public.market_sources_read() #>> '{current_inventory,ksl,count}')::int = 0);
RESET ROLE;
