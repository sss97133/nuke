-- ebay-motors-discover: eBay Motors through Firecrawl on eBay's public search and item pages (no eBay developer account).
-- Created INACTIVE: it stays off until the 10-item gate passes (land 10 tier-1 private-seller items, compare the raw page against
-- the model field by field, run the duplicate-vehicle check) and the owner's credit budget is confirmed.
-- Two jobs, one daily item-page cap (60) shared by both. Search pages are 1 Firecrawl credit each (240 cards; every new card is
-- kept as an unresolved listing observation); item pages are 1 credit each, read in this order: tier 1 private, tier 1 not
-- specified, tier 2 private.
--   ebay-motors-discover-t1   every 6 h: tier 1 (1964-1973), facet For Sale By = Private Seller        4 search credits/day
--   ebay-motors-discover-t2   every 12 h: tier 1 Not Specified + tier 2 (1974-1991) Private Seller      4 search credits/day
-- Bound: 8 + 60 = 68 Firecrawl credits a day at most (owner-approved 2026-10-15).
-- Switch on:  select cron.alter_job(job_id := jobid, active := true) from cron.job where jobname like 'ebay-motors-discover%';
-- Stop rule:  the same with active := false.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-discover-t1') THEN
    PERFORM cron.schedule('ebay-motors-discover-t1', '17 */6 * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "discover", "tiers": [1], "facets": ["private"], "pages": 1, "deep_max": 15, "daily_item_cap": 60}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-discover-t2') THEN
    PERFORM cron.schedule('ebay-motors-discover-t2', '47 */12 * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "discover", "jobs": [{"tiers": [1], "facets": ["unspecified"]}, {"tiers": [2], "facets": ["private"]}], "pages": 1, "deep_max": 15, "daily_item_cap": 60}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
  PERFORM cron.alter_job(job_id := jobid, active := false) FROM cron.job WHERE jobname LIKE 'ebay-motors-discover%';
END $job$;

UPDATE public.observation_sources
SET trust_factors = jsonb_set(trust_factors, '{collection}', trust_factors->'collection' || jsonb_build_object(
  'firecrawl_door', jsonb_build_object(
    'runner', 'pg_cron ebay-motors-discover-t1 every 6 h and -t2 every 12 h (INACTIVE until the gate passes); Browse API jobs stay inactive (no developer account)',
    'enumeration', 'eBay search pages, 240 cards, newest first, category 6001 with the Model Year facet per tier and the For Sale By facet (Private Seller); every new card kept as an unresolved listing observation',
    'depth', 'item page by Firecrawl (1 credit): full gallery (data-zoom-src, s-l1600), description, item specifics incl. VIN, seller and feedback, location; the Firecrawl response is kept in listing_page_snapshots',
    'seller_class', 'eBay shows and filters a seller-declared item specific, For Sale By (Private Seller | Dealer | Not Specified); the class stored with a listing is a Nuke claim citing it, never a platform fact',
    'revisit', 'not built: Firecrawl item pages cost a credit each; see the owner report for the proposal',
    'not_collected', 'Dealer and Not Specified facets (read only when asked), tiers 3-4, sold prices')))
WHERE slug = 'ebay_motors';

DO $check$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname LIKE 'ebay-motors-discover%' AND NOT active) <> 2 THEN
    RAISE EXCEPTION 'ebay-motors-discover jobs must exist and be inactive';
  END IF;
END $check$;
COMMIT;
