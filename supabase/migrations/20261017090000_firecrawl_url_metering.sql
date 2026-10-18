-- Metering at the one chokepoint (2026-10-15, owner-lead): a paid Firecrawl scrape must ask for an allowance and be recorded, whatever
-- code makes it. Measured at 22:05Z over 24 h: 1,903 Firecrawl snapshots against 1,206 rows in firecrawl_spend_log; mecum, hagerty,
-- ksl and C&B scrapes ran outside any allowance because archiveFetch's firecrawlAllowed hook is optional and nothing recorded spend
-- unless a lane did it by hand. _shared/firecrawl.ts firecrawlScrape now asks firecrawl_allowance_for_url(url) before the call and
-- records firecrawl_record_url_spend(url, ...) after it; these functions map the URL's host to a source row, here, once, in
-- firecrawl_source_params.hosts. An unmapped host has allowance 0 and its spend is recorded under '(unmapped)'.
-- Also: the pipeline cron tick moves to minute offset 2 of the 5-minute cycle ('2-59/5'), which carries the least (owner-lead).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.firecrawl_source_params ADD COLUMN IF NOT EXISTS hosts text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.firecrawl_source_params.hosts IS 'Domains whose pages count as this source for metering (host or any subdomain, www ignored). firecrawl_source_for_url reads it.';

UPDATE public.firecrawl_source_params SET hosts = CASE source
  WHEN 'bat' THEN '{bringatrailer.com}' WHEN 'mecum' THEN '{mecum.com}' WHEN 'barrett-jackson' THEN '{barrett-jackson.com}'
  WHEN 'gooding' THEN '{goodingco.com}' WHEN 'pcarmarket' THEN '{pcarmarket.com}' WHEN 'broad-arrow' THEN '{broadarrowauctions.com}'
  WHEN 'rm-sothebys' THEN '{rmsothebys.com}' WHEN 'barnfinds' THEN '{barnfinds.com}' WHEN 'craigslist' THEN '{craigslist.org}'
  WHEN 'facebook_marketplace' THEN '{facebook.com}' WHEN 'bonhams' THEN '{bonhams.com}' WHEN 'collecting-cars' THEN '{collectingcars.com}'
  WHEN 'cars_and_bids' THEN '{carsandbids.com}' WHEN 'ksl' THEN '{ksl.com}' WHEN 'ebay_motors' THEN '{ebay.com}'
  WHEN 'hemmings' THEN '{hemmings.com}' WHEN 'hagerty' THEN '{hagerty.com}' ELSE hosts END;

CREATE OR REPLACE FUNCTION public.firecrawl_source_for_url(p_url text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH h AS (SELECT regexp_replace(lower(substring(p_url FROM '^[a-z]+://([^/:?#]+)')), '^www\.', '') host)
  SELECT s.source FROM public.firecrawl_source_params s, h
   WHERE h.host IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(s.hosts) d WHERE h.host = d OR h.host LIKE '%.' || d)
   ORDER BY length((SELECT max(d) FROM unnest(s.hosts) d WHERE h.host = d OR h.host LIKE '%.' || d)) DESC NULLS LAST
   LIMIT 1
$$;

-- Credits a scrape of this URL may spend today: the source's firecrawl_allowance; 0 for a host no source row names.
CREATE OR REPLACE FUNCTION public.firecrawl_allowance_for_url(p_url text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce((SELECT public.firecrawl_allowance(public.firecrawl_source_for_url(p_url))
                    WHERE public.firecrawl_source_for_url(p_url) IS NOT NULL), 0)
$$;

-- One row per paid scrape, success or failure, under the URL's source ('(unmapped)' for an unknown host, so the spend is visible).
CREATE OR REPLACE FUNCTION public.firecrawl_record_url_spend(p_url text, p_credits numeric DEFAULT 1, p_lane text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  INSERT INTO public.firecrawl_spend_log (source, credits, lots, lane, note)
  VALUES (coalesce(public.firecrawl_source_for_url(p_url), '(unmapped)'), p_credits, 0, p_lane,
          left(coalesce(p_note, '') || CASE WHEN public.firecrawl_source_for_url(p_url) IS NULL THEN ' host=' || coalesce(substring(p_url FROM '^[a-z]+://([^/:?#]+)'), '?') ELSE '' END, 300))
  RETURNING id
$$;

REVOKE ALL ON FUNCTION public.firecrawl_source_for_url(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_allowance_for_url(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_record_url_spend(text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_source_for_url(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_allowance_for_url(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_record_url_spend(text, numeric, text, text) TO service_role;

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'firecrawl-target-allocation-weekly'),
  schedule := '2-59/5 * * * *');
COMMIT;
