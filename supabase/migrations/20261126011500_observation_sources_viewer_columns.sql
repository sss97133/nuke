-- observation_sources: end-user roles read the 23 viewer columns only; notes, trust_factors and species_evidence are
-- internal.
--
-- DEFECT (lead ruling 2026-11-25). The table's one policy, allow_authenticated_read_observation_sources, is USING (true)
-- for authenticated, and authenticated holds a table-level SELECT, so any signed-in user reads all 26 columns. Three are
-- internal: notes (free text; non-empty on 196 of 239 rows, 2026-11-25), trust_factors (keys such as cost,
-- investment_required, our_advantage, thesis, todo, user_notes, blocker; 68 of 239) and species_evidence (examined URLs
-- and pages; 99 of 239). anon also holds a table-level SELECT, with no policy (0 rows).
--
-- FIX. Table-level SELECT is revoked from anon and authenticated and granted again on the 23 viewer columns. Rows and the
-- policy are unchanged. service_role and postgres are unchanged; definer readers (owner postgres) are unchanged.
--
-- CONSUMERS (origin/main bf4fb2777 and production, 2026-11-25). Web: 6 reads; the one select('*'), the image page's
-- substrate panel, selects the viewer columns since #3967, which deploys first. iOS 0. Edge functions: 30 selects, all name
-- viewer columns. PostgREST embeds: 4, all (display_name, slug). Invoker views (pg_depend column dependencies):
-- v_daily_capture_scoreboard, v_listing_species, v_observations_needing_refresh, vehicle_comments_unified and
-- vehicle_current_state use only viewer columns. Invoker functions executable by anon or authenticated (19, including the
-- retained matchers: id, slug, supported_observations): none reads the three columns or a whole registry row.
--
-- GUARD. Refuses unless the table has exactly the 26 columns read on 2026-11-25. A new column must be classed (viewer
-- or internal) before this applies, or it would be withheld from every page without anyone deciding so.
-- REVERT: supabase/sql/revert_20261126011500_observation_sources_viewer_columns.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $grant$
DECLARE
  viewer constant text[] := ARRAY['id', 'slug', 'display_name', 'category', 'base_url', 'url_patterns', 'base_trust_score',
    'supported_observations', 'requires_auth', 'rate_limit_per_hour', 'makes_covered', 'years_covered', 'regions_covered',
    'created_at', 'updated_at', 'business_id', 'tier', 'decay_half_life_days', 'veracity', 'consecration', 'market_slug',
    'species', 'species_set'];
  internal constant text[] := ARRAY['notes', 'trust_factors', 'species_evidence'];
  live text[];
BEGIN
  SELECT array_agg(attname::text ORDER BY attname) INTO live FROM pg_attribute
   WHERE attrelid = 'public.observation_sources'::regclass AND attnum > 0 AND NOT attisdropped;
  IF live IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(viewer || internal) c) THEN
    RAISE EXCEPTION 'observation_sources columns differ from the 26 classed on 2026-11-25 (%); class the new column first', live;
  END IF;
  REVOKE SELECT ON public.observation_sources FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.observation_sources TO anon, authenticated',
                 (SELECT string_agg(quote_ident(c), ', ') FROM unnest(viewer) c));
END
$grant$;

COMMENT ON COLUMN public.observation_sources.notes IS
  'Free text about the source: what it is, its trust reasoning, and the spelling aliases its rows carry elsewhere. Internal: not granted to anon or authenticated (20261126011500).';
COMMENT ON COLUMN public.observation_sources.trust_factors IS
  'Named adjustments to the base trust, free-shape jsonb (default {}). Internal: not granted to anon or authenticated (20261126011500).';
COMMENT ON COLUMN public.observation_sources.species_evidence IS
  'What the species was read from: {examined_at, examined, seen, ...}. Internal: not granted to anon or authenticated (20261126011500).';
