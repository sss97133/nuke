-- eBay Motors through eBay's official Browse API (extract-ebay-motors, actions sweep / revisit).
-- 1. The source declaration for observations (slug ebay_motors).
-- 2. Two pg_cron jobs, created INACTIVE. They stay off until the eBay keys exist and the 10-item gate passes
--    (land 10 tier-1 items, compare raw against model field by field, run the duplicate-vehicle check).
--    Switch on:  select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ebay-motors-sweep'), active := true);
--    Stop rule:  the same call with active := false.
-- Quota: the Browse API allows about 5,000 calls a day per app (eBay API call limits page); a sweep reads eBay's own remaining
-- counter (Analytics getRateLimits) and spends only what is left above a 400-call reserve for the daily revisit.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.observation_sources (slug, display_name, category, base_url, base_trust_score, tier, supported_observations, decay_half_life_days, veracity, consecration, notes, trust_factors)
SELECT 'ebay_motors', 'eBay Motors (Browse API)', 'marketplace', 'https://www.ebay.com/b/Cars-Trucks/6001', 0.50, 3, '{listing,media}', 30, 0.50, 0.25,
  'eBay Motors Cars & Trucks listings read through the official Browse API. The seller is a business or an individual, but eBay US does not say which (sellerAccountTypes and seller.sellerAccountType exist only on the European sites), so the private/dealer class is a Nuke claim from stated signals, stored beside them. An ask, never a sale: an ended listing is marked ended with no outcome.',
  jsonb_build_object('collection', jsonb_build_object(
    'depth', 'search summary, then getItem: full description, every photo at s-l1600, item specifics (VIN, mileage, make, model, year, trim, engine, transmission, colours), location, price and buying options, seller username and feedback, start and end times; the raw getItem JSON is kept as a listing_page_snapshots row',
    'pacing', 'Browse API quota about 5,000 calls/day per app; sweep reads the remaining counter and keeps a 400-call reserve; at most 25 getItem calls per run',
    'runner', 'pg_cron ebay-motors-sweep every 15 min and ebay-motors-revisit daily (both INACTIVE until the gate passes)',
    'channel', 'eBay Motors category 6001 (Cars & Trucks), sorted newest first',
    'markets', 'EBAY_MOTORS_US',
    'enumeration', 'item_summary/search with the category Year aspect filter (the aspect name is read from the category refinements, not assumed), 200 per page, paged until a page holds only items already held',
    'order', 'tier 1 years 1964-1973, tier 2 1974-1991, then 1930-1963, then 1992-2005; inside a tier likely-private sellers first',
    'revisit', 'daily getItem on the oldest-checked live listings: 404 or past its end date -> ended (not a sale); a changed price is logged',
    'declared_on', '2026-10-15',
    'not_collected', 'model years outside 1930-2005, other categories, sold prices (Browse does not return them)'))
WHERE NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'ebay_motors');

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-sweep') THEN
    PERFORM cron.schedule('ebay-motors-sweep', '*/15 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "sweep", "max_items": 25, "max_search_pages": 3}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-revisit') THEN
    PERFORM cron.schedule('ebay-motors-revisit', '20 11 * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "revisit", "max": 150}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
  -- inactive on creation; only an owner-approved gate turns them on
  PERFORM cron.alter_job(job_id := jobid, active := false) FROM cron.job WHERE jobname IN ('ebay-motors-sweep', 'ebay-motors-revisit');
END $job$;

DO $check$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('ebay-motors-sweep', 'ebay-motors-revisit') AND NOT active) <> 2 THEN
    RAISE EXCEPTION 'ebay-motors cron jobs must exist and be inactive';
  END IF;
END $check$;
COMMIT;
