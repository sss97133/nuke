-- asset_profile_read(asset): one typed read for the artwork profile page (/assets/:id). Owner, 2026-11-08: "the artwork is the
-- endpoint the artwork carries its history". The page renders this and nothing else (kit rule: one typed read, one viewer,
-- one clock). Public: everything here is the house's published catalogue and Nuke's own counts; a holder is never named.
--   asset      the assets row: type, title, the house's category as a claim, identity basis, first seen
--   image_url  the house's main image URL (never bytes)
--   lots       the current statement of each presentation Nuke holds (auction_lot rows not superseded), newest clock first:
--              house, sale, lot number, department, result, prices as the house stated them with their basis, the catalogue
--              lines as laid out, the description, the footnotes split into the house's own headed sections (Provenance,
--              Literature, Exhibited ...; an unheaded block is the house's essay), symbols, URL, clocks
--   history    every statement ever landed for the asset, superseded ones included, oldest first: the record's own history
--   creation   the creation claims with their party (printed name, qualifier, whether a user has claimed the row, the
--              party's direct lots and priced lots across Nuke) and the executor when printed
--   coverage   what Nuke holds for this asset: presentations, statements, claims, sources, as of now
-- Null for an unknown id or a non-public asset. Anon, authenticated and service_role may read it.
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.art_printed_sections(p_footnotes text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  -- The house separates footnote sections with a blank line and heads each with one word on its own line.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'heading', CASE WHEN lines[1] ~ '^(Provenance|Literature|Exhibited|Exhibition|Exhibitions|Engraved|Note|Notes|Footnotes?|Condition|Bibliography)$' THEN lines[1] END,
           'lines', to_jsonb(CASE WHEN lines[1] ~ '^(Provenance|Literature|Exhibited|Exhibition|Exhibitions|Engraved|Note|Notes|Footnotes?|Condition|Bibliography)$' THEN lines[2:] ELSE lines END))
           ORDER BY ord), '[]'::jsonb)
  FROM (SELECT ord, ARRAY(SELECT btrim(l) FROM unnest(string_to_array(block, E'\n')) l WHERE btrim(l) <> '') AS lines
        FROM unnest(string_to_array(coalesce(p_footnotes, ''), E'\n\n')) WITH ORDINALITY AS b(block, ord)
        WHERE btrim(block) <> '') s
  WHERE cardinality(lines) > 0
$$;
COMMENT ON FUNCTION public.art_printed_sections(text) IS 'A house''s footnotes as it laid them out: blank-line blocks, each headed by one of the trade''s '
  'section words (Provenance, Literature, Exhibited, ...) or unheaded (the essay). Lines kept as printed.';

CREATE OR REPLACE FUNCTION public.asset_profile_read(p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH a AS (
    SELECT * FROM public.assets WHERE id = p_asset_id AND visibility = 'public' AND asset_type IN ('artwork', 'automobilia', 'memorabilia')),
  lots AS (
    SELECT o.*, s.slug AS source_slug, s.display_name AS source_name, coalesce(s.base_trust_score, 0.5) AS source_trust
    FROM public.asset_observations o JOIN a ON a.id = o.asset_id
    LEFT JOIN public.observation_sources s ON s.id = o.source_id
    WHERE o.kind = 'auction_lot'),
  current_lots AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'statement_id', l.id, 'source', jsonb_build_object('slug', l.source_slug, 'name', l.source_name, 'trust', l.source_trust),
      'house_category', l.structured_data->>'department_name', 'department_code', l.structured_data->>'department_code',
      'house_group', l.structured_data->>'house_group', 'lot_number', l.structured_data->>'lot_number',
      'sale_key', l.structured_data->>'sale_key', 'sale_name', l.structured_data->>'sale_name', 'sale_ends_at', l.structured_data->>'sale_ends_at',
      'result', l.structured_data->>'result', 'price_basis', l.structured_data->>'price_basis',
      'hammer_price', l.structured_data->'hammer_price', 'hammer_premium', l.structured_data->'hammer_premium', 'high_bid', l.structured_data->'high_bid',
      'estimate_low', l.structured_data->'estimate_low', 'estimate_high', l.structured_data->'estimate_high', 'currency', l.structured_data->>'currency',
      'observed_at', l.observed_at, 'observed_at_basis', l.structured_data->>'observed_at_basis', 'url', l.source_url,
      'lines', l.structured_data->'lines', 'catalog_text', l.content_text,
      'printed_sections', public.art_printed_sections(l.structured_data->>'footnotes'),
      'symbols', l.structured_data->'symbols', 'image_url', l.structured_data->>'image_url', 'country', l.structured_data->>'country',
      'landed_at', l.created_at)) ORDER BY l.observed_at DESC) AS v
    FROM lots l WHERE l.superseded_by IS NULL),
  history AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'statement_id', l.id, 'source', l.source_slug, 'observed_at', l.observed_at, 'observed_at_basis', l.structured_data->>'observed_at_basis',
      'result', l.structured_data->>'result', 'hammer_price', l.structured_data->'hammer_price', 'high_bid', l.structured_data->'high_bid',
      'estimate_low', l.structured_data->'estimate_low', 'estimate_high', l.structured_data->'estimate_high', 'currency', l.structured_data->>'currency',
      'landed_at', l.created_at, 'superseded', (l.superseded_by IS NOT NULL))) ORDER BY l.created_at, l.observed_at) AS v
    FROM lots l),
  creation AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'claim_id', c.id, 'attribution', c.structured_data->>'attribution', 'layout', c.structured_data->>'layout',
      'name_as_printed', c.structured_data->>'name_as_printed', 'qualifier_as_printed', c.structured_data->>'qualifier_as_printed',
      'party', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', e.id, 'display_name', e.display_name, 'qualifier_as_printed', e.metadata->>'qualifier_as_printed',
        'claimed', (e.claimed_by_user_id IS NOT NULL OR e.user_id IS NOT NULL),
        'lots_direct', (SELECT count(*) FROM public.asset_observations x WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL
                          AND x.structured_data->>'party_identity_id' = e.id::text AND x.structured_data->>'attribution' = 'direct'),
        'priced_lots', (SELECT count(*) FROM public.asset_observations x
                          JOIN public.asset_observations y ON y.asset_id = x.asset_id AND y.kind = 'auction_lot' AND y.source_id = x.source_id
                            AND y.source_identifier = x.source_identifier AND y.superseded_by IS NULL
                          WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL AND x.structured_data->>'party_identity_id' = e.id::text
                            AND x.structured_data->>'attribution' = 'direct' AND (y.structured_data->>'hammer_price')::numeric > 0)) END,
      'executor', c.structured_data->'executor',
      'source', s.slug, 'observed_at', c.observed_at, 'confidence', c.confidence)) ORDER BY c.observed_at DESC) AS v
    FROM public.asset_observations c JOIN a ON a.id = c.asset_id
    LEFT JOIN public.observation_sources s ON s.id = c.source_id
    LEFT JOIN public.external_identities e ON e.id = (c.structured_data->>'party_identity_id')::uuid
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL)
  SELECT CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
    'asset', jsonb_strip_nulls(jsonb_build_object(
      'id', a.id, 'asset_type', a.asset_type, 'title', a.title, 'house_category', a.attributes->>'house_category',
      'house_category_code', a.attributes->>'house_category_code', 'source', a.attributes->>'source',
      'identity_basis', a.attributes->>'identity_basis', 'first_seen_at', a.attributes->>'first_seen_at', 'created_at', a.created_at)),
    'image_url', (SELECT l.structured_data->>'image_url' FROM lots l WHERE l.superseded_by IS NULL AND l.structured_data ? 'image_url' ORDER BY l.observed_at DESC LIMIT 1),
    'lots', coalesce((SELECT v FROM current_lots), '[]'::jsonb),
    'history', coalesce((SELECT v FROM history), '[]'::jsonb),
    'creation', coalesce((SELECT v FROM creation), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'presentations', (SELECT count(*) FROM lots l WHERE l.superseded_by IS NULL),
      'statements', (SELECT count(*) FROM lots),
      'claims', (SELECT count(*) FROM public.asset_observations c WHERE c.asset_id = a.id AND c.kind = 'creation_claim' AND c.superseded_by IS NULL AND c.structured_data ? 'party_identity_id'),
      'sources', (SELECT coalesce(jsonb_agg(DISTINCT l.source_slug), '[]'::jsonb) FROM lots l),
      'as_of', now())) END
  FROM a
$$;
GRANT EXECUTE ON FUNCTION public.asset_profile_read(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.asset_profile_read(uuid) IS 'The artwork profile''s one typed read: the asset, the house''s main image URL, the current '
  'statement of each presentation (prices as stated, catalogue lines, description, footnotes as headed sections), every statement ever landed '
  '(the record''s history), the creation claims with their party and executor, and what Nuke holds for the asset. Public assets only.';
COMMIT;
