-- Barn Finds is a curator, not a marketplace: each post is an editorial feature of a car listed elsewhere (eBay, Craigslist,
-- Facebook Marketplace...), with commentary and readers' comments, and links to that listing. Its own notes already say
-- "editorial+classifieds aggregator". Filed as 'marketplace', the Sources board (record_market_source_day /
-- market_sources_read rank auction, marketplace and dealer sources) counted its posts as listings held. As 'aggregator' it
-- moves to the board's non-ranked group from the next daily record, and its posts are read as citations of the listings
-- they link to (extract-barn-finds-listing: citations.ts, bind.ts). No observation is changed.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';

UPDATE public.observation_sources
   SET category = 'aggregator',
       notes = 'Barn Finds: editorial curator. A post features a car listed elsewhere and links to that listing (the cited listing, '
            || 'recorded on the post''s vehicle_events metadata: cited_listing, featured_by); the post lands on the listing''s vehicle '
            || 'when the listing is held. Not a venue: its posts are not listings held.'
 WHERE slug = 'barnfinds'
   AND category IS DISTINCT FROM 'aggregator';

COMMIT;
