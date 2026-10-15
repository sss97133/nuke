-- The two generic eBay search feeds in listing_feeds ("Truck Auctions (newest)", "Car BIN (newest)": keyword truck/car, no year filter)
-- are replaced by the tiered private-seller discovery (extract-ebay-motors ebay-motors-discover-t1/-t2, gate passed 2026-10-15).
-- Left on, they would read the same listings through the older ingest -> Firecrawl path and double-land them. Disabled, not deleted.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
UPDATE public.listing_feeds SET enabled = false, updated_at = now() WHERE source_slug = 'ebay' AND enabled;
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.listing_feeds WHERE source_slug = 'ebay' AND enabled) THEN
    RAISE EXCEPTION 'an ebay feed is still enabled';
  END IF;
END $check$;
COMMIT;
