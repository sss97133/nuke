-- Art and automobilia lots land as asset entities. Owner direction 2026-10-16 (non-vehicle items are asset entities a
-- holder develops) and 2026-11-08 ("the artwork is the endpoint, the artwork carries its history"; case ledger §21).
-- Design: docs/ledger/theory/asset-entity-model.md (2026-10-16, extended 2026-11-08). Extends existing owners; no new table.
--
--   * assets.asset_type gains artwork, automobilia, memorabilia (the house's own label stays a claim in attributes).
--   * assets_identity_key_uidx: one asset row per source presentation, keyed attributes.identity_key = '<source>:<lot id>'
--     (identity_basis lot_presentation). The same object across sales is resolved later by supersession, as vehicles are.
--   * asset_observations kind 'auction_lot': one row per asset x lot x extraction method x content hash. A changed result
--     (upcoming -> hammer published) appends a new row that supersedes the previous one; nothing is overwritten.
--     observed_at is the event clock (hammer time when the sale ended, the index read otherwise; basis recorded).
--   * record_asset_lots(source_slug, lots): service-only writer, at most 500 lots a call, receipted. Refuses an unknown
--     source, a type outside the three, a malformed identity key or a lot without its clocks.
--   * asset_lot_walk_cursor(source_slug, department_code, method): the furthest index page a walk has landed, so a run
--     resumes where the last one stopped (service-only).
--   * asset_lot_coverage(source_slug): lots landed against the house's own department facet (the latest source_census
--     row with census_method house_department_facet): house lots, house priced lots, landed, landed priced, sale years.
--     Counts only; readable by anon, authenticated and service_role.
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.assets DROP CONSTRAINT assets_asset_type_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_asset_type_check CHECK (asset_type = ANY (ARRAY['image'::text, 'vehicle'::text,
  'garment'::text, 'publication'::text, 'issue'::text, 'article'::text, 'shoot'::text, 'equipment'::text, 'tool'::text, 'part'::text,
  'material'::text, 'goods'::text, 'artwork'::text, 'automobilia'::text, 'memorabilia'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS assets_identity_key_uidx ON public.assets ((attributes->>'identity_key'))
  WHERE attributes ? 'identity_key';
CREATE UNIQUE INDEX IF NOT EXISTS asset_observations_auction_lot_uidx
  ON public.asset_observations (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'auction_lot';
CREATE INDEX IF NOT EXISTS asset_observations_auction_lot_walk_idx
  ON public.asset_observations (source_id, (structured_data->>'department_code'), ((structured_data->>'ts_page')::integer))
  WHERE kind = 'auction_lot';

COMMENT ON INDEX public.assets_identity_key_uidx IS 'One asset row per source presentation: attributes.identity_key = <source slug>:<lot id>. '
  'identity_basis lot_presentation; the same physical object across sales is resolved later by supersession, never by overwriting.';
COMMENT ON COLUMN public.assets.asset_type IS 'Our small type list. image, vehicle, garment, publication, issue, article, shoot (2026-07); '
  'equipment, tool, part, material, goods (photo work ledger 2026-10-28); artwork, automobilia, memorabilia (lots as assets 2026-11-08). '
  'A house category (Mecum lot_type, Bonhams department) is a claim in attributes.house_category, never the type: houses disagree.';

CREATE OR REPLACE FUNCTION public.record_asset_lots(p_source_slug text, p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  src record; l jsonb; aid uuid; prior_id uuid; ikey text; atype text; sid text; method text; hash text; obs_at timestamptz;
  obs_basis text; sd jsonb; inserted_asset boolean; new_obs uuid;
  n_in integer := 0; n_assets_new integer := 0; n_assets_existing integer := 0; n_obs_new integer := 0; n_obs_same integer := 0;
  n_superseded integer := 0; n_refused integer := 0; refused jsonb := '[]'::jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_asset_lots is service-only' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lots) > 500 THEN
    RAISE EXCEPTION 'p_lots must be a JSON array of at most 500 lots' USING ERRCODE = '22023';
  END IF;
  SELECT s.id, s.slug, coalesce(s.base_trust_score, 0.5) AS trust INTO src FROM public.observation_sources s WHERE s.slug = p_source_slug;
  IF src.id IS NULL THEN
    RAISE EXCEPTION 'unknown observation source %', p_source_slug USING ERRCODE = '22023';
  END IF;

  FOR l IN SELECT x FROM jsonb_array_elements(p_lots) x LOOP
    n_in := n_in + 1;
    ikey := nullif(btrim(l->>'identity_key'), '');
    atype := nullif(btrim(l->>'asset_type'), '');
    sid := nullif(btrim(l->>'source_identifier'), '');
    method := coalesce(nullif(btrim(l->>'extraction_method'), ''), 'asset_lot_v1');
    IF ikey IS NULL OR ikey !~ ('^' || src.slug || ':[A-Za-z0-9_.-]{1,80}$')
       OR atype IS NULL OR atype NOT IN ('artwork', 'automobilia', 'memorabilia')
       OR sid IS NULL OR nullif(btrim(l->>'title'), '') IS NULL
       OR NOT ((l->>'observed_at') ~ '^\d{4}-\d{2}-\d{2}T') THEN
      n_refused := n_refused + 1;
      refused := refused || jsonb_build_array(left(coalesce(ikey, sid, '?'), 120));
      CONTINUE;
    END IF;
    obs_at := (l->>'observed_at')::timestamptz;
    obs_basis := coalesce(nullif(l->>'observed_at_basis', ''), 'index_read');

    -- The asset: one row per presentation. The house's category is a claim in attributes; the type is ours.
    inserted_asset := false;
    INSERT INTO public.assets (asset_type, title, description, status, visibility, attributes)
    VALUES (atype, left(l->>'title', 500), NULL, 'active', 'public',
      jsonb_strip_nulls(jsonb_build_object(
        'identity_key', ikey, 'identity_basis', 'lot_presentation', 'source', src.slug,
        'house_category', l->>'department_name', 'house_category_code', l->>'department_code',
        'first_lot', sid, 'first_seen_at', obs_at)))
    ON CONFLICT ((attributes->>'identity_key')) WHERE attributes ? 'identity_key' DO NOTHING
    RETURNING id INTO aid;
    IF aid IS NOT NULL THEN
      inserted_asset := true; n_assets_new := n_assets_new + 1;
    ELSE
      SELECT a.id INTO aid FROM public.assets a WHERE a.attributes->>'identity_key' = ikey;
      n_assets_existing := n_assets_existing + 1;
    END IF;

    -- The lot as testimony. The hash is the result as the house states it; a changed result appends and supersedes.
    sd := jsonb_strip_nulls(jsonb_build_object(
      'department_code', l->>'department_code', 'department_name', l->>'department_name',
      'house_group', l->>'house_group', 'lot_number', l->>'lot_number',
      'sale_key', l->>'sale_key', 'sale_name', l->>'sale_name', 'sale_ends_at', l->>'sale_ends_at',
      'result', coalesce(l->>'result', 'unknown'), 'price_basis', l->>'price_basis',
      'hammer_price', l->'hammer_price', 'hammer_premium', l->'hammer_premium',
      'estimate_low', l->'estimate_low', 'estimate_high', l->'estimate_high', 'currency', l->>'currency',
      'lines', l->'lines', 'symbols', l->'symbols', 'image_url', l->>'image_url', 'footnotes', l->>'footnotes',
      'country', l->>'country', 'observed_at_basis', obs_basis, 'ts_page', l->'ts_page', 'ts_pass', l->'ts_pass',
      'identity_basis', 'lot_presentation'));
    hash := md5(concat_ws('|', ikey, sid, method, sd->>'result', sd->>'hammer_price', sd->>'hammer_premium',
      sd->>'estimate_low', sd->>'estimate_high', sd->>'sale_ends_at'));

    SELECT o.id INTO prior_id FROM public.asset_observations o
      WHERE o.asset_id = aid AND o.kind = 'auction_lot' AND o.source_identifier = sid AND o.extraction_method = method
        AND o.superseded_by IS NULL
      ORDER BY o.created_at DESC LIMIT 1;

    INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
      confidence, source_url, source_identifier, extraction_method, supersedes)
    VALUES (aid, src.id, 'auction_lot', obs_at, left(l->>'catalog_text', 8000), sd, hash, src.trust, l->>'source_url', sid, method,
      CASE WHEN prior_id IS NOT NULL THEN prior_id END)
    ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'auction_lot' DO NOTHING
    RETURNING id INTO new_obs;
    IF new_obs IS NULL THEN
      n_obs_same := n_obs_same + 1;
    ELSE
      n_obs_new := n_obs_new + 1;
      IF prior_id IS NOT NULL THEN
        UPDATE public.asset_observations SET superseded_by = new_obs WHERE id = prior_id AND superseded_by IS NULL;
        n_superseded := n_superseded + 1;
      END IF;
      IF NOT inserted_asset THEN UPDATE public.assets SET updated_at = now() WHERE id = aid; END IF;
    END IF;
    aid := NULL; prior_id := NULL; new_obs := NULL;
  END LOOP;

  RETURN jsonb_build_object('source_id', src.id, 'source_slug', src.slug, 'in', n_in, 'assets_new', n_assets_new,
    'assets_existing', n_assets_existing, 'observations_new', n_obs_new, 'observations_same', n_obs_same,
    'observations_superseded', n_superseded, 'refused', n_refused, 'refused_keys', refused);
END $$;
REVOKE ALL ON FUNCTION public.record_asset_lots(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_asset_lots(text, jsonb) TO service_role;
COMMENT ON FUNCTION public.record_asset_lots(text, jsonb) IS 'Sanctioned writer for auction lots of non-vehicle assets (artwork, automobilia, '
  'memorabilia): upserts one assets row per source presentation (attributes.identity_key) and appends one asset_observations row of kind '
  'auction_lot per changed result (supersession, never overwrite). Service-only; at most 500 lots a call; returns a receipt with counts and '
  'refused keys. Prices are the house''s stated figures with their basis; buyer''s premium is not adjusted.';

CREATE OR REPLACE FUNCTION public.asset_lot_walk_cursor(p_source_slug text, p_department_code text, p_method text DEFAULT 'asset_lot_v1')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN auth.role() IS DISTINCT FROM 'service_role' THEN NULL ELSE
    coalesce((SELECT jsonb_build_object('last_page', (o.structured_data->>'ts_page')::integer, 'pass', coalesce((o.structured_data->>'ts_pass')::integer, 0),
                                        'landed_at', o.created_at)
      FROM public.asset_observations o JOIN public.observation_sources s ON s.id = o.source_id
      WHERE s.slug = p_source_slug AND o.kind = 'auction_lot' AND o.extraction_method = p_method
        AND o.structured_data->>'department_code' = p_department_code AND (o.structured_data->>'ts_page') ~ '^[0-9]+$'
      ORDER BY coalesce((o.structured_data->>'ts_pass')::integer, 0) DESC, (o.structured_data->>'ts_page')::integer DESC LIMIT 1),
      jsonb_build_object('last_page', 0, 'pass', 0)) END
$$;
REVOKE ALL ON FUNCTION public.asset_lot_walk_cursor(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_lot_walk_cursor(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.asset_lot_coverage(p_source_slug text)
RETURNS TABLE (department_code text, department_name text, house_lots integer, house_priced_lots integer, landed_lots bigint,
               landed_priced_lots bigint, first_sale_year integer, last_sale_year integer, census_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH src AS (SELECT s.id FROM public.observation_sources s WHERE s.slug = p_source_slug),
  census AS (
    SELECT c.by_category, c.raw_response, c.census_at FROM public.source_census c JOIN src ON src.id = c.source_id
    WHERE c.census_method = 'house_department_facet' ORDER BY c.census_at DESC LIMIT 1),
  house AS (
    SELECT kv.key AS code, (kv.value)::text::integer AS lots,
           nullif(census.raw_response->'priced'->>kv.key, '')::integer AS priced,
           census.raw_response->'names'->>kv.key AS name, census.census_at
    FROM census, jsonb_each(census.by_category) kv),
  landed AS (
    SELECT o.structured_data->>'department_code' AS code,
           count(DISTINCT o.asset_id) AS lots,
           count(DISTINCT o.asset_id) FILTER (WHERE (o.structured_data->>'hammer_price')::numeric > 0) AS priced,
           min(extract(year FROM o.observed_at))::integer AS first_year, max(extract(year FROM o.observed_at))::integer AS last_year
    FROM public.asset_observations o JOIN src ON src.id = o.source_id
    WHERE o.kind = 'auction_lot' AND o.superseded_by IS NULL
    GROUP BY 1)
  SELECT coalesce(house.code, landed.code), house.name, house.lots, house.priced,
         coalesce(landed.lots, 0), coalesce(landed.priced, 0), landed.first_year, landed.last_year, house.census_at
  FROM house FULL OUTER JOIN landed ON landed.code = house.code
  ORDER BY coalesce(landed.lots, 0) DESC, house.lots DESC NULLS LAST
$$;
GRANT EXECUTE ON FUNCTION public.asset_lot_coverage(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.asset_lot_coverage(text) IS 'Fleet-relative coverage of asset lots for one source: the house''s own department facet '
  '(latest source_census row, census_method house_department_facet; by_category = lots per department code, raw_response.priced = lots with a '
  'published hammer, raw_response.names = department names) beside the lots landed as assets with a current auction_lot observation. '
  'Counts and years only. A department with landed lots and no census row shows null house counts.';

COMMIT;
