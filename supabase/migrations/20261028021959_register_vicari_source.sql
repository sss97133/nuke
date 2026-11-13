BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- Owner requested Vicari ingestion. Registry configuration only; no testimony or grants change.
-- Examined 29 public lot pages across eight archived and 21 current post-auction presentations.
INSERT INTO public.observation_sources
  (slug, display_name, category, base_url, url_patterns, base_trust_score, supported_observations,
   requires_auth, notes, species, species_set, species_evidence)
VALUES
  ('vicari', 'Vicari Auction Company', 'auction', 'https://www.vicariauction.com',
   ARRAY['https://www.vicariauction.com/auction-house/*', 'https://vicariauction.com/auction-house*'],
   0.60, ARRAY['listing']::public.observation_kind[], false,
   'Public lot catalogs. Seller-supplied claims are attributed, not verified. Archive and high bid do not establish a sale. No paid extraction or recurring collection configured.',
   'block_house', ARRAY['block_house']::public.source_species[],
   jsonb_build_object(
     'examined_at', '2026-10-28',
     'examined', jsonb_build_array('https://www.vicariauction.com/auction-house/?ahid=27895',
       'https://www.vicariauction.com/auction-house/?ahid=12926',
       'https://www.vicariauction.com/auction-house/?ahid=25733'),
     'seen', 'Named auction events and lot numbers; archived presentations and post-auction offers quoting high bids. Listings say descriptions and photos are supplied by consignors.',
     'doc', 'docs/ledger/theory/data-machine-cases.md section 6: block houses',
     'extractor', 'ingest:vicari_html_v1',
     'listing_rule', 'auction-house URL with one numeric ahid; post-auction availability stays testimony on the original block-house lot'))
ON CONFLICT (slug) DO NOTHING;
COMMIT;
