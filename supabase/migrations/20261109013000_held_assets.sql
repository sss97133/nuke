-- A holder declares a work. Owner, 2026-11-08 (case ledger §21.1): his own archive is the first holder case; "lets just look at
-- the numbers". Each physical work is one assets row declared by its holder, with the holder as creator (the artist takes the
-- shape of a user) and holder, private by default. No market figure is ever invented: a declared work with no public sale shows
-- "no public sale recorded" beside its ledger of events. Extends existing owners; no new table.
--   * declare_held_asset(type, title, medium, year, dimensions, edition, notes, visibility): Sign-tier (auth.uid()), the signer
--     becomes creator_id and owner_id; identity_basis holder_declaration; identity_key 'holder:<user>:<hash of the declared
--     fields>' so the same declaration twice returns the same row. Writes one asset_observations row of kind holder_declaration
--     (source owner-input) and one creation_claim with the party as a user (party_user_id), attribution direct, layout
--     holder_declaration. Year is text as declared ("1965", "c. 1965", "1960s", "1998-2001"); nothing is parsed further.
--   * held_assets_read(limit): the signed-in holder's own works (creator or owner), newest first, with counts by type and
--     whether any public sale is recorded. Authenticated only.
--   * asset_profile_read: now viewer-aware. A private or unlisted asset is readable by its creator or owner (auth.uid()); anyone
--     else gets null as before. The creation block names a user party from profiles (full_name, else username). A 'declared'
--     block carries the holder's own words (medium, year, dimensions, edition, notes) and 'viewer' says whether the reader is the
--     holder. 'market' says 'none_public' when no lot exists for the asset.
-- Version 20261109013000: 20261109010000 was taken on main by grade_closed_hammer_predictions.
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- assets.asset_type already admits publication (2026-07) and artwork, automobilia, memorabilia (20261108170000); no CHECK change.
-- assets holds ~82k rows (2026-11-08): a plain build is sub-second under the 2 s lock_timeout; the deploy role cannot run CONCURRENTLY.
CREATE INDEX IF NOT EXISTS assets_holder_idx ON public.assets (owner_id, created_at DESC) WHERE owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.declare_held_asset(p_asset_type text, p_title text, p_medium text DEFAULT NULL, p_year text DEFAULT NULL,
  p_dimensions text DEFAULT NULL, p_edition text DEFAULT NULL, p_notes text DEFAULT NULL, p_visibility text DEFAULT 'private')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid(); signed timestamptz := now(); owner_source uuid; aid uuid; was_new boolean; ikey text; declared jsonb;
  title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  medium text := nullif(btrim(coalesce(p_medium, '')), ''); yr text := nullif(btrim(coalesce(p_year, '')), '');
  dims text := nullif(btrim(coalesce(p_dimensions, '')), ''); edition text := nullif(btrim(coalesce(p_edition, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), ''); vis text := coalesce(nullif(btrim(p_visibility), ''), 'private');
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_asset_type IS NULL OR p_asset_type NOT IN ('artwork', 'automobilia', 'memorabilia', 'publication') THEN
    RAISE EXCEPTION 'Type must be artwork, automobilia, memorabilia or publication' USING ERRCODE = '22023';
  END IF;
  IF length(title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title must be 1 to 200 characters' USING ERRCODE = '22023'; END IF;
  IF medium IS NOT NULL AND length(medium) > 200 THEN RAISE EXCEPTION 'Medium is at most 200 characters' USING ERRCODE = '22023'; END IF;
  IF yr IS NOT NULL AND yr !~ '^(c\.\s?)?(1[0-9]{3}|20[0-9]{2})(s|\s?-\s?(1[0-9]{3}|20[0-9]{2}))?$' THEN
    RAISE EXCEPTION 'Year must read like 1965, c. 1965, 1960s or 1998-2001' USING ERRCODE = '22023';
  END IF;
  IF dims IS NOT NULL AND length(dims) > 120 THEN RAISE EXCEPTION 'Dimensions are at most 120 characters' USING ERRCODE = '22023'; END IF;
  IF edition IS NOT NULL AND length(edition) > 80 THEN RAISE EXCEPTION 'Edition is at most 80 characters' USING ERRCODE = '22023'; END IF;
  IF notes IS NOT NULL AND length(notes) > 4000 THEN RAISE EXCEPTION 'Notes are at most 4000 characters' USING ERRCODE = '22023'; END IF;
  IF vis NOT IN ('private', 'unlisted', 'public') THEN RAISE EXCEPTION 'Visibility must be private, unlisted or public' USING ERRCODE = '22023'; END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;

  declared := jsonb_strip_nulls(jsonb_build_object('medium', medium, 'year', yr, 'dimensions', dims, 'edition', edition, 'notes', notes));
  ikey := 'holder:' || signer::text || ':' || md5(lower(title) || '|' || coalesce(lower(medium), '') || '|' || coalesce(yr, '') || '|' || coalesce(lower(dims), '') || '|' || coalesce(lower(edition), ''));
  INSERT INTO public.assets (asset_type, title, description, creator_id, owner_id, status, visibility, attributes)
  VALUES (p_asset_type, title, notes, signer, signer, 'active', vis,
    jsonb_build_object('identity_key', ikey, 'identity_basis', 'holder_declaration', 'source', 'owner-input', 'declared', declared,
      'declared_at', signed, 'declared_by_user_id', signer))
  ON CONFLICT ((attributes->>'identity_key')) WHERE attributes ? 'identity_key' DO NOTHING
  RETURNING id INTO aid;
  was_new := aid IS NOT NULL;
  IF NOT was_new THEN
    SELECT a.id INTO aid FROM public.assets a WHERE a.attributes->>'identity_key' = ikey;
    RETURN jsonb_build_object('asset_id', aid, 'duplicate', true, 'visibility', (SELECT a.visibility FROM public.assets a WHERE a.id = aid));
  END IF;

  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method)
  VALUES (aid, owner_source, 'holder_declaration', signed,
    format('The holder declared a %s: "%s"%s.', p_asset_type, title, CASE WHEN yr IS NULL THEN '' ELSE ' (' || yr || ')' END),
    jsonb_build_object('signer_user_id', signer, 'asset_type', p_asset_type, 'title', title, 'declared', declared, 'visibility', vis, 'version', 1),
    md5(ikey || '|declaration|' || signed::text), 0.95, ikey, 'holder_declaration_sign_v1');
  INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash, confidence,
    source_identifier, extraction_method)
  VALUES (aid, owner_source, 'creation_claim', signed, title,
    jsonb_build_object('role', 'creator', 'attribution', 'direct', 'layout', 'holder_declaration', 'party_user_id', signer,
      'name_as_printed', (SELECT coalesce(nullif(p.full_name, ''), p.username) FROM public.profiles p WHERE p.id = signer)),
    md5(aid::text || '|' || ikey || '|holder_declaration_sign_v1|' || signer::text), 0.95, ikey, 'holder_declaration_sign_v1');
  RETURN jsonb_build_object('asset_id', aid, 'duplicate', false, 'visibility', vis);
END $$;
REVOKE ALL ON FUNCTION public.declare_held_asset(text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_held_asset(text, text, text, text, text, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.declare_held_asset(text, text, text, text, text, text, text, text) IS 'Sign-tier: the signed-in holder declares a work '
  '(artwork, automobilia, memorabilia, publication) in their own words. One assets row (creator and owner = the signer, private by default, '
  'identity_basis holder_declaration), one holder_declaration observation and one creation_claim naming the signer as the party. The same '
  'declaration twice returns the same row. No price, no value: a declared work carries no market figure until a public sale is recorded.';

CREATE OR REPLACE FUNCTION public.held_assets_read(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  mine AS (
    SELECT a.* FROM public.assets a, me WHERE me.uid IS NOT NULL AND (a.owner_id = me.uid OR a.creator_id = me.uid)
      AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication') AND a.status <> 'archived'),
  rows_ AS (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', m.id, 'asset_type', m.asset_type, 'title', m.title, 'visibility', m.visibility, 'created_at', m.created_at,
      'declared', m.attributes->'declared', 'identity_basis', m.attributes->>'identity_basis',
      'presentations', (SELECT count(*) FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL),
      'public_sale_recorded', EXISTS (SELECT 1 FROM public.asset_observations o WHERE o.asset_id = m.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL
                                        AND (o.structured_data->>'hammer_price')::numeric > 0))) ORDER BY m.created_at DESC) AS v
    FROM (SELECT * FROM mine ORDER BY created_at DESC LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))) m)
  SELECT CASE WHEN (SELECT uid FROM me) IS NULL THEN NULL ELSE jsonb_build_object(
    'assets', coalesce((SELECT v FROM rows_), '[]'::jsonb),
    'total', (SELECT count(*) FROM mine),
    'by_type', coalesce((SELECT jsonb_object_agg(asset_type, n) FROM (SELECT asset_type, count(*) n FROM mine GROUP BY 1) t), '{}'::jsonb),
    'as_of', now()) END
$$;
REVOKE ALL ON FUNCTION public.held_assets_read(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.held_assets_read(integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.held_assets_read(integer) IS 'The signed-in holder''s own works (creator or owner), newest first, with the declared words, '
  'presentation count and whether a public sale is recorded; totals by type. Null for anon.';

CREATE OR REPLACE FUNCTION public.asset_profile_read(p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
  WITH viewer AS (SELECT auth.uid() AS uid),
  a AS (
    SELECT a.* FROM public.assets a, viewer v WHERE a.id = p_asset_id AND a.asset_type IN ('artwork', 'automobilia', 'memorabilia', 'publication')
      AND (a.visibility = 'public' OR (v.uid IS NOT NULL AND (a.owner_id = v.uid OR a.creator_id = v.uid)))),
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
      'party', CASE
        WHEN e.id IS NOT NULL THEN jsonb_build_object(
          'id', e.id, 'kind', 'catalogue', 'display_name', e.display_name, 'qualifier_as_printed', e.metadata->>'qualifier_as_printed',
          'claimed', (e.claimed_by_user_id IS NOT NULL OR e.user_id IS NOT NULL),
          'lots_direct', (SELECT count(*) FROM public.asset_observations x WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL
                            AND x.structured_data->>'party_identity_id' = e.id::text AND x.structured_data->>'attribution' = 'direct'),
          'priced_lots', (SELECT count(*) FROM public.asset_observations x
                            JOIN public.asset_observations y ON y.asset_id = x.asset_id AND y.kind = 'auction_lot' AND y.source_id = x.source_id
                              AND y.source_identifier = x.source_identifier AND y.superseded_by IS NULL
                            WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL AND x.structured_data->>'party_identity_id' = e.id::text
                              AND x.structured_data->>'attribution' = 'direct' AND (y.structured_data->>'hammer_price')::numeric > 0))
        WHEN p.id IS NOT NULL THEN jsonb_build_object(
          'id', p.id, 'kind', 'user', 'display_name', coalesce(nullif(p.full_name, ''), p.username, 'a Nuke user'), 'claimed', true,
          'lots_direct', (SELECT count(*) FROM public.asset_observations x WHERE x.kind = 'creation_claim' AND x.superseded_by IS NULL
                            AND x.structured_data->>'party_user_id' = p.id::text AND x.structured_data->>'attribution' = 'direct'),
          'priced_lots', 0)
        ELSE NULL END,
      'executor', c.structured_data->'executor',
      'source', s.slug, 'observed_at', c.observed_at, 'confidence', c.confidence)) ORDER BY c.observed_at DESC) AS v
    FROM public.asset_observations c JOIN a ON a.id = c.asset_id
    LEFT JOIN public.observation_sources s ON s.id = c.source_id
    LEFT JOIN public.external_identities e ON e.id = (c.structured_data->>'party_identity_id')::uuid
    LEFT JOIN public.profiles p ON p.id = (c.structured_data->>'party_user_id')::uuid
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL)
  SELECT CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
    'asset', jsonb_strip_nulls(jsonb_build_object(
      'id', a.id, 'asset_type', a.asset_type, 'title', a.title, 'house_category', a.attributes->>'house_category',
      'house_category_code', a.attributes->>'house_category_code', 'source', a.attributes->>'source',
      'identity_basis', a.attributes->>'identity_basis', 'first_seen_at', a.attributes->>'first_seen_at', 'created_at', a.created_at,
      'visibility', a.visibility)),
    'viewer', jsonb_build_object('is_holder', (v.uid IS NOT NULL AND (a.owner_id = v.uid OR a.creator_id = v.uid))),
    'declared', a.attributes->'declared',
    'market', CASE WHEN EXISTS (SELECT 1 FROM lots) THEN 'recorded' ELSE 'none_public' END,
    'image_url', (SELECT l.structured_data->>'image_url' FROM lots l WHERE l.superseded_by IS NULL AND l.structured_data ? 'image_url' ORDER BY l.observed_at DESC LIMIT 1),
    'lots', coalesce((SELECT cl.v FROM current_lots cl), '[]'::jsonb),
    'history', coalesce((SELECT h.v FROM history h), '[]'::jsonb),
    'creation', coalesce((SELECT cr.v FROM creation cr), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'presentations', (SELECT count(*) FROM lots l WHERE l.superseded_by IS NULL),
      'statements', (SELECT count(*) FROM lots),
      'claims', (SELECT count(*) FROM public.asset_observations c WHERE c.asset_id = a.id AND c.kind = 'creation_claim' AND c.superseded_by IS NULL
                   AND (c.structured_data ? 'party_identity_id' OR c.structured_data ? 'party_user_id')),
      'sources', (SELECT coalesce(jsonb_agg(DISTINCT l.source_slug), '[]'::jsonb) FROM lots l),
      'as_of', now())) END
  FROM a, viewer v
$$;
GRANT EXECUTE ON FUNCTION public.asset_profile_read(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.asset_profile_read(uuid) IS 'The asset profile''s one typed read, viewer-aware: public assets for anyone, a private or '
  'unlisted asset for its creator or owner. The asset, the house''s main image URL, the current statement of each presentation, every statement '
  'ever landed, the creation claims with their party (a catalogue party from external_identities or a user party from profiles) and executor, the '
  'holder''s declared words, market = recorded | none_public, and coverage.';
COMMIT;
