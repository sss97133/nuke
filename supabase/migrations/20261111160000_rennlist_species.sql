-- rennlist: the one source holding data on the Sources board with no species. The deploy gate ("Every source holding
-- data declares its species with evidence") failed run 42373863846 (2026-11-07 12:45Z) on it: market_source_days
-- 2026-11-07 shows rennlist with 261 landed lots (landed_at 10:27Z) after its vehicle_events rows were touched at 09:14Z.
-- What we hold (vehicle_events source_platform rennlist, measured 2026-11-07): 261 rows, every source_url
-- https://rennlist.com/forums/market/<post id>, 260 with sale_truth_role 'ask' and a price, 0 with bids, 0 with an
-- end time; extraction_method orphan-backfill-v1, landed 2026-02-02. The live page answers 403 to a plain fetch.
-- Seller posts in a forum's marketplace section, keyed by post id, with an asking price and no close: classifieds
-- (the rule's own words for the species; Craigslist and KSL are the named peers). The forum's threads, if ever held,
-- are media_forum_video; the held rows are not threads. Idempotent.
SET statement_timeout = '30s';
SET lock_timeout = '5s';
BEGIN;
UPDATE public.observation_sources
   SET species = 'classifieds', species_set = '{classifieds}', updated_at = now(),
       species_evidence = '{"examined_at": "2026-11-07", "examined": ["vehicle_events rennlist: 261 rows, all https://rennlist.com/forums/market/<post id>, e.g. https://rennlist.com/forums/market/1465178 (final_price 27000, sale_truth_role ask, no bids, no end)", "market_source_days 2026-11-07 rennlist: 261 landed lots, landed_at 10:27Z", "observation_sources rennlist notes: Rennlist (Porsche) forum, category forum, tier 4"], "seen": "Held rows are the forum marketplace''s seller posts: an asking price (260 of 261), 0 with bids, 0 with an end time, keyed by post id. The live page answers 403 to an unauthenticated fetch, so the rows themselves are the evidence.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names seller posts with no close under Classifieds", "listing_rule": "held rows are asks (sale_truth_role ask); the forum''s discussion threads would be media_forum_video and are not held"}'::jsonb
 WHERE slug = 'rennlist' AND species IS NULL;
COMMIT;
