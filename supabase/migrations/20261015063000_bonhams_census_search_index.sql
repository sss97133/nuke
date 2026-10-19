-- Bonhams population from its own search index: lane-bonhams counted 34,101 car lots in the Typesense index
-- (api01.bonhams.com) at about 2026-10-15 00:45Z. The count covers car lots in the index and may exclude older sales
-- the index does not hold, so confidence is 0.80. The earlier 'unknown' row (same day) is superseded, not edited:
-- source_target_coverage reads the latest census row. The exact count and filter are lane-bonhams' to confirm.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, census_at)
SELECT s.id, 34101, 34101, 'search_index', 0.80, 'https://api01.bonhams.com (Typesense search index)',
       'Car lots counted in Bonhams'' Typesense index by lane-bonhams at about 2026-10-15 00:45Z. Covers car lots in the index; older sales the index does not hold may be missing, so the true population could be higher. Exact count and filter pending confirmation from lane-bonhams. Replaces the unknown row of 2026-10-15 01:00Z.',
       '2026-10-15 01:45:00+00'::timestamptz
FROM public.observation_sources s WHERE s.slug = 'bonhams'
ON CONFLICT (source_id, census_at) DO NOTHING;
COMMIT;
