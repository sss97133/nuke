-- The creation fold: who made the artwork, as the house printed it. Owner, 2026-11-08: "the artwork is a creation of the
-- artist, the technician, the artist is the one with the highest claim to origin. the artist can be an entity or org or
-- user. the artist takes on the same shape as the user it is a user." Case ledger §21; design asset-entity-model.md 11-08.
-- Follows 20261108170000_asset_lots.sql. Extends existing owners; no new table.
--
--   * The party is an external_identities row (the shape a party has before it is a user: BaT handles live there and are
--     claimable by a user through request_external_identity_claim). platform 'art_catalogue', handle = the artist key
--     (the printed name, lower-cased and space-normalised, plus the printed life dates when the house gives them), display_name
--     = the name as printed, metadata.qualifier_as_printed = the house's dates/nationality line. An artist, an estate or a
--     foundation later claims the row; the claim moves the party, never the claims below.
--   * asset_observations kind 'creation_claim': one row per asset x lot x method, the house's statement of origin: role
--     creator, attribution as printed (direct | after | attributed_to | circle_of | school_of | follower_of | manner_of |
--     studio_of | workshop_of | style_of: the house's own ladder of claim strength, kept as words, never a number), the party
--     id, and when the house prints "by <name> (dates)" after the artist, the executor (the technician: the printer,
--     the lithographer) as a second party with role executor. observed_at = the lot's clock. Nothing is parsed from free
--     text: the house's styledDescription lays the lines out (first line the artist, second the qualifier, third the title)
--     and only those lines are read.
--   * fold_asset_creation_claims(source, limit): service-only, bounded; folds current artwork lots without a current claim.
--     Called by extract-bonhams-typesense after each art_land page, and runnable by hand.
--   * asset_creators(source, limit): the market by party, like the make table for cars: lots the house gave the party
--     directly, lots "after" them, priced lots, hammer min/median/max per currency as the house stated them, sale years.
--     asset_creation_read(asset_id): one asset's claims. Counts and printed names only; anon may read.
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE UNIQUE INDEX IF NOT EXISTS asset_observations_creation_claim_uidx
  ON public.asset_observations (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim';
CREATE INDEX IF NOT EXISTS asset_observations_creation_party_idx
  ON public.asset_observations (((structured_data->>'party_identity_id')::uuid)) WHERE kind = 'creation_claim' AND superseded_by IS NULL;

CREATE OR REPLACE FUNCTION public.art_attribution_from_line(p_line text)
RETURNS TABLE (attribution text, name_as_printed text) LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (SELECT btrim(regexp_replace(coalesce(p_line, ''), '\s+', ' ', 'g')) AS l),
  q AS (SELECT l, lower(substring(l FROM '^(After|Attributed to|Circle of|School of|Follower of|Manner of|Studio of|Workshop of|Style of)\s')) AS pre FROM m)
  SELECT CASE WHEN pre IS NULL THEN 'direct' ELSE replace(pre, ' ', '_') END,
         nullif(btrim(CASE WHEN pre IS NULL THEN l ELSE substring(l FROM length(pre) + 2) END), '')
  FROM q
$$;
COMMENT ON FUNCTION public.art_attribution_from_line(text) IS 'The house''s first catalogue line split into its attribution word (direct, after, '
  'attributed_to, circle_of, school_of, follower_of, manner_of, studio_of, workshop_of, style_of) and the name as printed. No other parsing.';

CREATE OR REPLACE FUNCTION public.art_party_key(p_name text, p_qualifier text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(concat_ws('|', lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))),
    nullif(array_to_string(ARRAY(SELECT (regexp_matches(coalesce(p_qualifier, ''), '(\d{4})', 'g'))[1]), '-'), '')), '')
$$;
COMMENT ON FUNCTION public.art_party_key(text, text) IS 'external_identities.handle for a printed artist: lower-cased, space-normalised name, then the '
  'four-digit years the house printed beside it (born 1927 -> 1927; 1928-1987 -> 1928-1987). Two spellings of one artist stay two rows until a claim joins them.';

CREATE OR REPLACE FUNCTION public.fold_asset_creation_claims(p_source_slug text, p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET "TimeZone" = 'UTC' AS $$
DECLARE
  src record; r record; att record; key text; pid uuid; was_new boolean; exec_name text; exec_dates text; exec_key text; exec_pid uuid; qual text; hash text;
  method constant text := 'house_catalogue_lines_v1';
  n_read integer := 0; n_claims integer := 0; n_same integer := 0; n_parties_new integer := 0; n_skipped integer := 0; new_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'fold_asset_creation_claims is service-only' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.slug, coalesce(s.base_trust_score, 0.5) AS trust INTO src FROM public.observation_sources s WHERE s.slug = p_source_slug;
  IF src.id IS NULL THEN RAISE EXCEPTION 'unknown observation source %', p_source_slug USING ERRCODE = '22023'; END IF;

  FOR r IN
    SELECT o.id AS lot_obs_id, o.asset_id, o.source_identifier, o.source_url, o.observed_at,
           o.structured_data->'lines'->>0 AS line1, o.structured_data->'lines'->>1 AS line2, o.structured_data->>'department_code' AS dept
    FROM public.asset_observations o
    JOIN public.assets a ON a.id = o.asset_id
    WHERE o.source_id = src.id AND o.kind = 'auction_lot' AND o.superseded_by IS NULL AND a.asset_type = 'artwork'
      AND NOT EXISTS (SELECT 1 FROM public.asset_observations c WHERE c.asset_id = o.asset_id AND c.kind = 'creation_claim'
                        AND c.source_identifier = o.source_identifier AND c.extraction_method = method AND c.superseded_by IS NULL)
    ORDER BY o.created_at
    LIMIT greatest(1, least(coalesce(p_limit, 500), 5000))
  LOOP
    n_read := n_read + 1;
    SELECT * INTO att FROM public.art_attribution_from_line(r.line1);
    -- A party needs a name; a line that is a title (no second line, or no parenthesised qualifier) is not a party line.
    qual := nullif(btrim(substring(coalesce(r.line2, '') FROM '^\(([^)]*)\)')), '');
    IF att.name_as_printed IS NULL OR length(att.name_as_printed) < 2 OR length(att.name_as_printed) > 120 OR qual IS NULL THEN
      n_skipped := n_skipped + 1; CONTINUE;
    END IF;
    key := public.art_party_key(att.name_as_printed, qual);
    INSERT INTO public.external_identities (platform, handle, display_name, metadata, first_seen_at, last_seen_at)
    VALUES ('art_catalogue', key, att.name_as_printed,
            jsonb_build_object('qualifier_as_printed', qual, 'first_source', src.slug, 'role', 'artist'), r.observed_at, r.observed_at)
    ON CONFLICT (platform, handle) DO UPDATE SET last_seen_at = greatest(public.external_identities.last_seen_at, EXCLUDED.last_seen_at)
    RETURNING id, (xmax = 0) INTO pid, was_new;
    IF was_new THEN n_parties_new := n_parties_new + 1; END IF;

    -- The technician: "(dates) by <name> (dates)" after the artist line.
    exec_name := nullif(btrim(substring(coalesce(r.line2, '') FROM '^\([^)]*\)\s+by\s+([^(]+)')), '');
    exec_dates := nullif(btrim(substring(coalesce(r.line2, '') FROM '^\([^)]*\)\s+by\s+[^(]+\(([^)]*)\)')), '');
    exec_pid := NULL;
    IF exec_name IS NOT NULL AND length(exec_name) BETWEEN 2 AND 120 THEN
      exec_key := public.art_party_key(exec_name, exec_dates);
      INSERT INTO public.external_identities (platform, handle, display_name, metadata, first_seen_at, last_seen_at)
      VALUES ('art_catalogue', exec_key, exec_name,
              jsonb_build_object('qualifier_as_printed', exec_dates, 'first_source', src.slug, 'role', 'executor'), r.observed_at, r.observed_at)
      ON CONFLICT (platform, handle) DO UPDATE SET last_seen_at = greatest(public.external_identities.last_seen_at, EXCLUDED.last_seen_at)
      RETURNING id INTO exec_pid;
    END IF;

    hash := md5(concat_ws('|', r.asset_id::text, r.source_identifier, method, key, att.attribution, coalesce(exec_key, '')));
    INSERT INTO public.asset_observations (asset_id, source_id, kind, observed_at, content_text, structured_data, content_hash,
      confidence, source_url, source_identifier, extraction_method)
    VALUES (r.asset_id, src.id, 'creation_claim', r.observed_at, concat_ws(E'\n', r.line1, r.line2),
      jsonb_strip_nulls(jsonb_build_object(
        'role', 'creator', 'attribution', att.attribution, 'name_as_printed', att.name_as_printed, 'qualifier_as_printed', qual,
        'party_identity_id', pid, 'party_key', key, 'lot_observation_id', r.lot_obs_id, 'department_code', r.dept,
        'executor', CASE WHEN exec_pid IS NULL THEN NULL ELSE jsonb_build_object('role', 'executor', 'name_as_printed', exec_name,
                      'qualifier_as_printed', exec_dates, 'party_identity_id', exec_pid, 'party_key', exec_key) END)),
      hash, src.trust, r.source_url, r.source_identifier, method)
    ON CONFLICT (asset_id, source_identifier, extraction_method, content_hash) WHERE kind = 'creation_claim' DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NULL THEN n_same := n_same + 1; ELSE n_claims := n_claims + 1; END IF;
    new_id := NULL; exec_key := NULL;
  END LOOP;
  RETURN jsonb_build_object('source', src.slug, 'lots_read', n_read, 'claims_new', n_claims, 'claims_same', n_same,
    'parties_new', n_parties_new, 'skipped_no_party_line', n_skipped);
END $$;
REVOKE ALL ON FUNCTION public.fold_asset_creation_claims(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_asset_creation_claims(text, integer) TO service_role;
COMMENT ON FUNCTION public.fold_asset_creation_claims(text, integer) IS 'Folds current artwork lots into creation_claim observations: the party '
  '(external_identities, platform art_catalogue) with the house''s attribution word, and the executor when the house prints "by <name>". '
  'Bounded, service-only, idempotent.';

CREATE OR REPLACE FUNCTION public.asset_creators(p_source_slug text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (party_identity_id uuid, name_as_printed text, qualifier_as_printed text, lots_direct bigint, lots_after bigint, lots_other_attribution bigint,
               priced_lots bigint, by_currency jsonb, first_sale_year integer, last_sale_year integer, sources text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH claims AS (
    SELECT (c.structured_data->>'party_identity_id')::uuid AS pid, c.structured_data->>'attribution' AS attribution, c.asset_id, c.observed_at,
           s.slug AS source, l.structured_data->>'currency' AS currency, (l.structured_data->>'hammer_price')::numeric AS hammer
    FROM public.asset_observations c
    JOIN public.observation_sources s ON s.id = c.source_id
    LEFT JOIN public.asset_observations l ON l.id = (c.structured_data->>'lot_observation_id')::uuid
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL AND (p_source_slug IS NULL OR s.slug = p_source_slug)),
  per AS (
    SELECT pid,
           count(*) FILTER (WHERE attribution = 'direct') AS lots_direct,
           count(*) FILTER (WHERE attribution = 'after') AS lots_after,
           count(*) FILTER (WHERE attribution NOT IN ('direct', 'after')) AS lots_other,
           count(*) FILTER (WHERE hammer > 0 AND attribution = 'direct') AS priced,
           min(extract(year FROM observed_at)) FILTER (WHERE hammer > 0)::integer AS first_year,
           max(extract(year FROM observed_at)) FILTER (WHERE hammer > 0)::integer AS last_year,
           array_agg(DISTINCT source) AS sources
    FROM claims GROUP BY pid),
  cur AS (
    SELECT pid, jsonb_object_agg(currency, jsonb_build_object('n', n, 'min', mn, 'median', med, 'max', mx)) AS by_currency
    FROM (SELECT pid, currency, count(*) n, min(hammer) mn, percentile_cont(0.5) WITHIN GROUP (ORDER BY hammer) med, max(hammer) mx
          FROM claims WHERE hammer > 0 AND attribution = 'direct' AND currency IS NOT NULL GROUP BY pid, currency) x
    GROUP BY pid)
  SELECT per.pid, e.display_name, e.metadata->>'qualifier_as_printed', per.lots_direct, per.lots_after, per.lots_other, per.priced,
         coalesce(cur.by_currency, '{}'::jsonb), per.first_year, per.last_year, per.sources
  FROM per JOIN public.external_identities e ON e.id = per.pid LEFT JOIN cur ON cur.pid = per.pid
  ORDER BY per.priced DESC, per.lots_direct DESC, e.display_name
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
$$;
GRANT EXECUTE ON FUNCTION public.asset_creators(text, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.asset_creators(text, integer) IS 'The art market by party, as the houses printed it: lots attributed directly, lots "after", '
  'other attributions, priced direct lots, hammer min/median/max per currency as stated (no conversion, premium not adjusted), sale years, sources. '
  'Grain: one external_identities row (platform art_catalogue). Printed names only.';

CREATE OR REPLACE FUNCTION public.asset_creation_read(p_asset_id uuid)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.structured_data || jsonb_build_object('observed_at', c.observed_at, 'source', s.slug, 'confidence', c.confidence, 'claim_id', c.id,
           'party', jsonb_build_object('display_name', e.display_name, 'claimed_by_user_id', e.claimed_by_user_id, 'user_id', e.user_id))
  FROM public.asset_observations c
  JOIN public.observation_sources s ON s.id = c.source_id
  LEFT JOIN public.external_identities e ON e.id = (c.structured_data->>'party_identity_id')::uuid
  WHERE c.asset_id = p_asset_id AND c.kind = 'creation_claim' AND c.superseded_by IS NULL
  ORDER BY c.observed_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.asset_creation_read(uuid) TO anon, authenticated, service_role;

COMMIT;
