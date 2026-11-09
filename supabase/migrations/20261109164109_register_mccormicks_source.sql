BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- Owner requested McCormick ingestion. Registry configuration only; no testimony or grants change.
-- Examined public current and archived lot details across auctions 47, 60, 79, 80 and 81.
-- Registry configuration only: no schema, grants, schedules or existing testimony change.
INSERT INTO public.observation_sources
  (slug, display_name, category, base_url, url_patterns, supported_observations,
   requires_auth, notes, species, species_set, species_evidence)
VALUES
  ('mccormicks', 'McCormick’s Palm Springs Classic Car Auctions', 'auction', 'https://www.classic-carauction.com',
   ARRAY['https://www.classic-carauction.com/auction-cars*', 'https://www.classic-carauction.com/featured-cars*', 'https://www.classic-carauction.com/auction-results*'],
   ARRAY['listing']::public.observation_kind[], false,
   'Public lot catalogs. Seller-supplied claims are attributed, not verified. Archived high bids are not sales. Figures retain unknown currency and fee basis until separately evidenced. No paid extraction or recurring collection configured.',
   'block_house', ARRAY['block_house']::public.source_species[],
   jsonb_build_object(
     'examined_at', '2026-11-09',
     'examined', jsonb_build_array('https://www.classic-carauction.com/auction-cars?auctionid=15318',
       'https://www.classic-carauction.com/auction-results?auctionnbr=47&auctionid=3632',
       'https://www.classic-carauction.com/auction-results?auctionnbr=80&auctionid=15164'),
     'seen', 'Named auction events and lot numbers; upcoming catalog and archived sold/high-bid results. Current detail pages may name VINs; archives omit them. Specifications and component condition ratings occupy separate sections. Descriptions and photos are consignor claims.',
     'doc', 'docs/ledger/theory/data-machine-cases.md section 6: block houses',
     'extractor', 'ingest:mccormick_html_v1',
     'listing_rule', 'auction-cars or featured-cars URL with one numeric auctionid; auction-results also requires auctionnbr. One auctionid is one appearance; a sold result is a source claim, not current availability or ownership. Showroom inventory is excluded from this block-house adapter.'))
ON CONFLICT (slug) DO NOTHING;
COMMIT;
