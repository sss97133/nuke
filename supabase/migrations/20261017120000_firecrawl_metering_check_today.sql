-- v_firecrawl_metering_check gains a same-day test (owner-lead 2026-10-15): the 24 h comparison only shows an unmetered path after the
-- day has passed, and the meter started blind (C&B's slice made 30 scrapes between 21:58 and 22:29Z with none logged). Appended
-- columns: today's snapshot fetches (UTC day), today's logged credits (historical excluded), and unmetered_today = fetches exceed
-- credits by more than 2. A source that shows unmetered_today = true has a paid path that does not go through firecrawlScrape, or a
-- lane that spent without recording; it appears the same day.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE VIEW public.v_firecrawl_metering_check WITH (security_invoker = true) AS
WITH d AS (SELECT date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day_start),
snap AS (
  SELECT sp.source, count(*) fetches, count(*) FILTER (WHERE s.fetched_at >= d.day_start) fetches_today
    FROM public.listing_page_snapshots s CROSS JOIN d JOIN public.firecrawl_source_params sp ON s.platform = ANY (sp.snapshot_platforms)
   WHERE s.fetch_method = 'firecrawl' AND s.fetched_at >= now() - interval '24 hours' GROUP BY sp.source
), spent AS (
  SELECT l.source, sum(l.credits) FILTER (WHERE NOT l.historical) credits, sum(l.credits) FILTER (WHERE l.historical) historical_credits,
         sum(l.credits) FILTER (WHERE NOT l.historical AND l.spent_at >= d.day_start) credits_today
    FROM public.firecrawl_spend_log l CROSS JOIN d WHERE l.spent_at >= now() - interval '24 hours' GROUP BY l.source
)
SELECT coalesce(a.source, b.source) AS source,
       coalesce(a.fetches, 0) AS snapshot_fetches,
       coalesce(b.credits, 0) AS logged_credits,
       coalesce(b.historical_credits, 0) AS historical_credits,
       coalesce(b.credits, 0) - coalesce(a.fetches, 0) AS difference,
       abs(coalesce(b.credits, 0) - coalesce(a.fetches, 0)) <= 2 AS within_2,
       CASE WHEN coalesce(a.source, b.source) = '(unmapped)' THEN 0 ELSE public.firecrawl_allowance(coalesce(a.source, b.source)) END AS allowance_today,
       coalesce(a.fetches_today, 0) AS snapshot_fetches_today,
       coalesce(b.credits_today, 0) AS logged_credits_today,
       coalesce(a.fetches_today, 0) - coalesce(b.credits_today, 0) > 2 AS unmetered_today
  FROM snap a FULL JOIN spent b ON b.source = a.source;
REVOKE ALL ON public.v_firecrawl_metering_check FROM anon, authenticated;
COMMENT ON VIEW public.v_firecrawl_metering_check IS 'Per Firecrawl source over 24 h: snapshot fetches against logged credits (within 2 is the acceptance), historical credits, today''s allowance, and the same-day test: unmetered_today when today''s snapshot fetches exceed today''s logged credits by more than 2.';
COMMIT;
