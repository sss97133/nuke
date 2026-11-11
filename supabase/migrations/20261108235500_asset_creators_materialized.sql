-- asset_creators: the three CTEs are MATERIALIZED. The planner estimated one row for the claims CTE and nested-looped the
-- per-currency percentile aggregate once per party (1,211 times over 2,063 claims): 4.8 s for 8 rows, 7.8 s through the
-- function (measured 2026-11-08 10:05 PT, EXPLAIN ANALYZE). Materialised, the same plan runs in 124 ms. Same signature, same
-- rows. Follows 20261108234500_asset_creators_current_lot.sql.
-- Contract: supabase/sql/test_asset_lots.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.asset_creators(p_source_slug text DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (party_identity_id uuid, name_as_printed text, qualifier_as_printed text, lots_direct bigint, lots_after bigint, lots_other_attribution bigint,
               priced_lots bigint, by_currency jsonb, first_sale_year integer, last_sale_year integer, sources text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH claims AS MATERIALIZED (
    SELECT (c.structured_data->>'party_identity_id')::uuid AS pid, c.structured_data->>'attribution' AS attribution, c.asset_id, c.observed_at,
           s.slug AS source, l.structured_data->>'currency' AS currency, (l.structured_data->>'hammer_price')::numeric AS hammer
    FROM public.asset_observations c
    JOIN public.observation_sources s ON s.id = c.source_id
    -- The lot's current statement, not the row the claim was folded from: a hammer published after the fold supersedes the
    -- upcoming row, and the claim must read the new one.
    LEFT JOIN public.asset_observations l ON l.asset_id = c.asset_id AND l.kind = 'auction_lot' AND l.source_id = c.source_id
      AND l.source_identifier = c.source_identifier AND l.superseded_by IS NULL
    WHERE c.kind = 'creation_claim' AND c.superseded_by IS NULL AND c.structured_data ? 'party_identity_id'
      AND (p_source_slug IS NULL OR s.slug = p_source_slug)),
  per AS MATERIALIZED (
    SELECT pid,
           count(*) FILTER (WHERE attribution = 'direct') AS lots_direct,
           count(*) FILTER (WHERE attribution = 'after') AS lots_after,
           count(*) FILTER (WHERE attribution NOT IN ('direct', 'after')) AS lots_other,
           count(*) FILTER (WHERE hammer > 0 AND attribution = 'direct') AS priced,
           min(extract(year FROM observed_at)) FILTER (WHERE hammer > 0)::integer AS first_year,
           max(extract(year FROM observed_at)) FILTER (WHERE hammer > 0)::integer AS last_year,
           array_agg(DISTINCT source) AS sources
    FROM claims GROUP BY pid),
  cur AS MATERIALIZED (
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

COMMIT;
