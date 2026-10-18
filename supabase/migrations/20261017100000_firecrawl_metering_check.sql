-- The acceptance check for metering (owner-lead 2026-10-15): over the last 24 hours, the credits in firecrawl_spend_log must equal the
-- Firecrawl fetches in listing_page_snapshots, within 2, per source, and no source may spend above its allowance. One row per
-- source (an '(unmapped)' row shows spend on a host no source names). snapshot_fetches counts snapshot rows with
-- fetch_method = firecrawl (a byte-identical re-fetch is not stored, so it is a floor); logged_credits excludes spend flagged
-- historical; within_2 is the acceptance test.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE VIEW public.v_firecrawl_metering_check WITH (security_invoker = true) AS
WITH snap AS (
  SELECT sp.source, count(*) fetches
    FROM public.listing_page_snapshots s JOIN public.firecrawl_source_params sp ON s.platform = ANY (sp.snapshot_platforms)
   WHERE s.fetch_method = 'firecrawl' AND s.fetched_at >= now() - interval '24 hours' GROUP BY sp.source
), spent AS (
  SELECT source, sum(credits) FILTER (WHERE NOT historical) credits, sum(credits) FILTER (WHERE historical) historical_credits
    FROM public.firecrawl_spend_log WHERE spent_at >= now() - interval '24 hours' GROUP BY source
)
SELECT coalesce(a.source, b.source) AS source,
       coalesce(a.fetches, 0) AS snapshot_fetches,
       coalesce(b.credits, 0) AS logged_credits,
       coalesce(b.historical_credits, 0) AS historical_credits,
       coalesce(b.credits, 0) - coalesce(a.fetches, 0) AS difference,
       abs(coalesce(b.credits, 0) - coalesce(a.fetches, 0)) <= 2 AS within_2,
       CASE WHEN coalesce(a.source, b.source) = '(unmapped)' THEN 0 ELSE public.firecrawl_allowance(coalesce(a.source, b.source)) END AS allowance_today
  FROM snap a FULL JOIN spent b ON b.source = a.source;
REVOKE ALL ON public.v_firecrawl_metering_check FROM anon, authenticated;
COMMENT ON VIEW public.v_firecrawl_metering_check IS 'Per Firecrawl source over 24 h: snapshot fetches against logged credits (within 2 is the acceptance), historical credits and today''s allowance.';
COMMIT;
