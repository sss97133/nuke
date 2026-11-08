BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

INSERT INTO public.observation_sources
  (slug, display_name, category, base_url, base_trust_score, supported_observations,
   requires_auth, notes, species, species_set, species_evidence)
VALUES ('purplewave', 'Purple Wave', 'auction', 'https://www.purplewave.com', 0.60,
  ARRAY['listing']::public.observation_kind[], false,
  'Public native auction-state snapshots. Source claims only; no individual bid history or confirmed sale inferred. Existing feed allocation and cadence preserved.',
  'timed_auction', ARRAY['timed_auction']::public.source_species[],
  jsonb_build_object('examined_at', '2026-11-08',
    'examined', jsonb_build_array('https://www.purplewave.com/search',
      'https://www.purplewave.com/v1/search/search?searchType=all&dateType=upcoming&filters=industry_category_id%3A277&page=1&perPage=25&showHalted=false'),
    'seen', '25 public passenger-vehicle inventory records: native auction/item identity, current bid/count, winning bid timestamp, endtime and extension flags. Source payload has 148 fields. Snapshot does not establish each intervening bid.',
    'extractor', 'poll-listing-feeds:purplewave_public_snapshot_v1',
    'listing_rule', '/auction/YYMMDD[optional letter]/item/AA1234 is a timed lot; inventory scope is publisher industry_category_id 277'))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.live_board_houses(house,label,host_pattern,enabled,note)
VALUES ('purplewave','Purple Wave','^https://(www[.])?purplewave[.]com/auction/',true,
  'Existing listing-feed cadence and allocation; bounded public API passenger-vehicle snapshots, not a complete bid stream. Source currency USD per publisher payment terms.')
ON CONFLICT (house) DO NOTHING;

-- Replace only the broken existing renderer route. Do not enable feeds or alter budgets/cadence.
UPDATE public.listing_feeds SET search_criteria = search_criteria || jsonb_build_object(
  'fetch_strategy', 'purplewave_public_json', 'native_page', 1, 'native_offset', 0), updated_at = now()
WHERE id = '2b413532-64b4-4756-9840-7ec8ffd45f6e' AND source_slug = 'purplewave'
  AND feed_url = 'https://www.purplewave.com/search'
  AND search_criteria->>'fetch_strategy' = 'firecrawl_html';
COMMIT;
