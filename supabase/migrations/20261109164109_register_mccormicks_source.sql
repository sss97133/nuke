BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- McCormick auction intake and evidence-based classification; no testimony or grants change.
-- Examined public current and archived lot details across auctions 47, 60, 79, 80 and 81.
-- Preserve the existing classifier and add only this source's auction/showroom URL rules.
INSERT INTO public.observation_sources
  (slug, display_name, category, base_url, url_patterns, supported_observations,
   requires_auth, notes, species, species_set, species_evidence)
VALUES
  ('mccormicks', 'McCormick’s Palm Springs Classic Car Auctions', 'auction', 'https://www.classic-carauction.com',
   ARRAY['https://www.classic-carauction.com/auction-cars*', 'https://www.classic-carauction.com/featured-cars*', 'https://www.classic-carauction.com/auction-results*'],
   ARRAY['listing']::public.observation_kind[], false,
   'Public lot catalogs. Seller-supplied claims are attributed, not verified. Archived high bids are not sales. Figures retain unknown currency and fee basis until separately evidenced. No paid extraction or recurring collection configured.',
   'block_house', ARRAY['block_house','dealer']::public.source_species[],
   jsonb_build_object(
     'examined_at', '2026-11-09',
     'examined', jsonb_build_array('https://www.classic-carauction.com/auction-cars?auctionid=15318',
       'https://www.classic-carauction.com/auction-results?auctionnbr=47&auctionid=3632',
       'https://www.classic-carauction.com/auction-results?auctionnbr=80&auctionid=15164',
       'https://www.classic-carauction.com/Showroom-Inventory'),
     'seen', 'Named auction events and lot numbers; upcoming catalog and archived sold/high-bid results. The archive template omits VINs and extra photos; the public detail alias for the same native ID may expose them. Its current-auction header is decorative, not evidence that an archived lot is upcoming. Specifications and component condition ratings occupy separate sections. Descriptions and photos are consignor claims. Showroom inventory separately labels owners asking prices and says vehicles may or may not enter an auction.',
     'doc', 'docs/ledger/theory/data-machine-cases.md section 6: block houses',
     'extractor', 'ingest:mccormick_html_v1',
     'listing_rule', 'auction-cars or featured-cars URL with one numeric auctionid; auction-results also requires auctionnbr. One auctionid is one appearance; a sold result is a source claim, not current availability or ownership. Showroom-Inventory is dealer species and excluded from this block-house intake adapter.'))
ON CONFLICT (slug) DO NOTHING;
CREATE OR REPLACE FUNCTION public.listing_species_from_evidence(p_source_slug text, p_url text, p_metadata jsonb)
RETURNS public.source_species LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT (CASE
    -- the row's own URL names the site it lives on
    WHEN p_url ~* '^https?://(www\.)?bringatrailer\.com/listing/' THEN 'timed_auction'
    WHEN p_url ~* '^https?://(www\.)?barrett-jackson\.com/.+/docket/' THEN 'block_house'
    WHEN p_url ~* '^https?://(www\.)?mecum\.com/lots/' THEN 'block_house'
    -- McCormick publishes block-house lots and a separate consignment showroom.
    WHEN p_source_slug = 'mccormicks' AND p_url ~* '^https?://(www\.)?classic-carauction\.com/(auction-cars|featured-cars|auction-results)/?(\?|$)' THEN 'block_house'
    WHEN p_source_slug = 'mccormicks' AND p_url ~* '^https?://(www\.)?classic-carauction\.com/Showroom-Inventory/?(\?|$)' THEN 'dealer'
    -- sources with more than one species, by what the listing itself shows
    WHEN p_source_slug = 'barnfinds' AND p_url ~* 'barnfinds\.com/bf-exclusive' THEN 'classifieds'
    WHEN p_source_slug = 'barnfinds' AND p_url ~* 'barnfinds\.com/' THEN 'aggregator'
    WHEN p_source_slug = 'hagerty-marketplace' AND p_url ~* 'hagerty\.com/marketplace/auction/' THEN 'timed_auction'
    WHEN p_source_slug = 'hemmings' AND p_url ~* 'hemmings\.com/auction/' THEN 'timed_auction'
    WHEN p_source_slug = 'ebay_motors' AND coalesce(p_metadata -> 'buying_options', '[]'::jsonb) ? 'CLASSIFIED_AD'
      THEN 'classifieds'
  END)::public.source_species $$;

COMMIT;
