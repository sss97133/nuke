-- Source species: how a listing lives on a source, the physics of docs/ledger/theory/data-machine-cases.md §6
-- ("Monitoring by species"), made representable and applied with the evidence each label came from.
--   * source_category gains 'classifieds' (Craigslist, KSL: seller posts that live days, keyed by post id, no close).
--   * observation_sources.species / species_set / species_evidence: the source's primary species, every species its
--     listings take, and what was examined to say so (URLs or stored pages, what they showed, the day). A species
--     without evidence is refused by a CHECK.
--   * listing_species_from_evidence() and v_listing_species: a listing (vehicle_events row) takes its own species
--     where its URL or metadata says so (a Hagerty /marketplace/auction/ lot, a Barn Finds 'BF Exclusive' ad, an eBay
--     CLASSIFIED_AD); otherwise its source's primary species.
--   * source_species_gaps(): sources holding data with no species; the deploy run fails while any remain.
--   * market_sources_read() ranks the Sources board by species with the doc's names. Aggregators are listed apart and
--     do not count as listings held. Re-read from the live definition (20261018213000) on 2026-10-18; only the
--     grouping, ordering, not-ranked keys, board totals and four appended columns change.
-- Labels: 75 sources, each examined 2026-10-18 UTC. Replayable: every statement is idempotent.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

-- A new enum value is usable only once committed, so it is added before the transaction below.
DO $$ BEGIN
  IF to_regtype('public.source_category') IS NOT NULL THEN
    ALTER TYPE public.source_category ADD VALUE IF NOT EXISTS 'classifieds' AFTER 'marketplace';
  END IF;
END $$;

BEGIN;

DO $$ BEGIN
  IF to_regtype('public.source_species') IS NULL THEN
    CREATE TYPE public.source_species AS ENUM (
      'timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator',
      'media_forum_video', 'owner_private');
  END IF;
END $$;
COMMENT ON TYPE public.source_species IS
  'How a listing or testimony lives on a source (docs/ledger/theory/data-machine-cases.md §6, Monitoring by species): '
  'timed_auction = Timed with soft close (an end time and bids); block_house = Block houses (a sale event and lots); '
  'dealer = Dealer sites (inventory on the seller''s own site); classifieds = Classifieds (seller posts that live days and '
  'relist, keyed by post id, no close); auth_walled_marketplace = Auth-walled marketplaces (read only through a session '
  'or token); aggregator = Aggregators (a map of who exists, or a curator pointing at listings elsewhere; never the '
  'listing itself); media_forum_video = Media, forums, video; owner_private = Owner''s private data.';

-- observation_sources is read by every writer; long readers hold it, so the exclusive lock is retried in short waits
-- rather than queueing every reader behind one long wait.
DO $$
DECLARE attempt int := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '2s';
      ALTER TABLE public.observation_sources
        ADD COLUMN IF NOT EXISTS species public.source_species,
        ADD COLUMN IF NOT EXISTS species_set public.source_species[],
        ADD COLUMN IF NOT EXISTS species_evidence jsonb,
        DROP CONSTRAINT IF EXISTS observation_sources_species_evidenced,
        ADD CONSTRAINT observation_sources_species_evidenced CHECK (
          species IS NULL OR coalesce(
            species = ANY (species_set)
            AND jsonb_typeof(species_evidence) = 'object'
            AND jsonb_typeof(species_evidence -> 'examined') = 'array'
            AND jsonb_array_length(species_evidence -> 'examined') > 0
            AND length(coalesce(species_evidence ->> 'seen', '')) > 0
            AND coalesce(species_evidence ->> 'examined_at', '') ~ '^\d{4}-\d{2}-\d{2}', false));
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempt := attempt + 1;
      IF attempt >= 10 THEN RAISE; END IF;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;
SET LOCAL lock_timeout = '5s';

COMMENT ON COLUMN public.observation_sources.species IS
  'Primary species of the source: how its listings live on it (source_species; data-machine-cases.md §6). NULL = not yet '
  'examined, never a guess; a value requires species_set and species_evidence (CHECK observation_sources_species_evidenced). '
  'Set by a migration with the evidence. Grain: one source. Clock: species_evidence.examined_at.';
COMMENT ON COLUMN public.observation_sources.species_set IS
  'Every species the source''s listings take (Hagerty Marketplace: timed auctions and classifieds); contains species. '
  'A listing''s own species: listing_species_from_evidence() / v_listing_species. Grain: one source.';
COMMENT ON COLUMN public.observation_sources.species_evidence IS
  'What the species was read from: {examined_at (day), examined [URLs, stored pages or rows looked at], seen (what they '
  'showed), doc (the §6 assignment, when the doc names the source), extractor, listing_rule}. Grain: one source.';
COMMENT ON COLUMN public.observation_sources.category IS
  'Kind of source: source_category enum (auction, marketplace, classifieds, forum, social_media, registry, shop, '
  'documentation, owner, aggregator, media, event, internal, dealer, museum, agent). NOT NULL. For sources holding '
  'listings it follows the species (timed_auction and block_house -> auction, classifieds -> classifieds, '
  'auth_walled_marketplace -> marketplace, aggregator -> aggregator; 2026-10-18). The species column is the physics; '
  'this is the coarse kind. Unit: none (enum). Source: registration, relabelled with evidence. Grain: one source.';

CREATE OR REPLACE FUNCTION public.source_species_label(p public.source_species)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT CASE p::text
    WHEN 'timed_auction' THEN 'Timed with soft close'
    WHEN 'block_house' THEN 'Block houses'
    WHEN 'dealer' THEN 'Dealer sites'
    WHEN 'classifieds' THEN 'Classifieds'
    WHEN 'auth_walled_marketplace' THEN 'Auth-walled marketplaces'
    WHEN 'aggregator' THEN 'Aggregators'
    WHEN 'media_forum_video' THEN 'Media, forums, video'
    WHEN 'owner_private' THEN 'Owner''s private data'
  END $$;
COMMENT ON FUNCTION public.source_species_label(public.source_species) IS
  'The species'' name in data-machine-cases.md §6, the words the Sources board prints.';

CREATE OR REPLACE FUNCTION public.source_species_groups()
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT jsonb_agg(jsonb_build_object('species', s, 'label', public.source_species_label(s::public.source_species),
                                      'unit', u, 'counts_as_held', h) ORDER BY o)
  FROM (VALUES
    (1, 'timed_auction', 'lots held', true),
    (2, 'block_house', 'lots held', true),
    (3, 'dealer', 'vehicles held', true),
    (4, 'classifieds', 'posts held', true),
    (5, 'auth_walled_marketplace', 'listings held', true),
    (6, 'aggregator', 'pages read, not listings held', false)
  ) g(o, s, u, h) $$;
COMMENT ON FUNCTION public.source_species_groups() IS
  'The Sources board''s groups in order, with the doc''s names and the unit each counts; an aggregator''s pages point at '
  'listings elsewhere, so they are not listings held.';

CREATE OR REPLACE FUNCTION public.listing_species_from_evidence(p_source_slug text, p_url text, p_metadata jsonb)
RETURNS public.source_species LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT (CASE
    -- the row's own URL names the site it lives on
    WHEN p_url ~* '^https?://(www\.)?bringatrailer\.com/listing/' THEN 'timed_auction'
    WHEN p_url ~* '^https?://(www\.)?barrett-jackson\.com/.+/docket/' THEN 'block_house'
    WHEN p_url ~* '^https?://(www\.)?mecum\.com/lots/' THEN 'block_house'
    -- sources with more than one species, by what the listing itself shows
    WHEN p_source_slug = 'barnfinds' AND p_url ~* 'barnfinds\.com/bf-exclusive' THEN 'classifieds'
    WHEN p_source_slug = 'barnfinds' AND p_url ~* 'barnfinds\.com/' THEN 'aggregator'
    WHEN p_source_slug = 'hagerty-marketplace' AND p_url ~* 'hagerty\.com/marketplace/auction/' THEN 'timed_auction'
    WHEN p_source_slug = 'hemmings' AND p_url ~* 'hemmings\.com/auction/' THEN 'timed_auction'
    WHEN p_source_slug = 'ebay_motors' AND coalesce(p_metadata -> 'buying_options', '[]'::jsonb) ? 'CLASSIFIED_AD'
      THEN 'classifieds'
  END)::public.source_species $$;
COMMENT ON FUNCTION public.listing_species_from_evidence(text, text, jsonb) IS
  'A listing''s own species from its own URL or metadata, or NULL when the listing says nothing beyond its source (the '
  'caller then takes observation_sources.species). Rules and their evidence: observation_sources.species_evidence.listing_rule.';

CREATE OR REPLACE VIEW public.v_listing_species WITH (security_invoker = true) AS
WITH src AS (
  SELECT DISTINCT ON (s.nslug) s.nslug, s.slug, s.species
  FROM (SELECT regexp_replace(lower(slug), '[^a-z0-9]', '', 'g') AS nslug, slug, species, market_slug, created_at
        FROM public.observation_sources) s
  ORDER BY s.nslug, (s.market_slug IS NOT NULL), s.created_at, s.slug
)
SELECT e.id AS vehicle_event_id,
       e.source_platform,
       e.source_url,
       o.slug AS source_slug,
       o.species AS source_species,
       coalesce(x.own, o.species) AS species,
       CASE WHEN x.own IS NOT NULL THEN 'listing' WHEN o.species IS NOT NULL THEN 'source_primary' ELSE 'unknown' END
         AS species_basis
FROM public.vehicle_events e
CROSS JOIN LATERAL (
  SELECT regexp_replace(regexp_replace(lower(coalesce(e.source_platform, '')), '^www\.([a-z0-9-]+)\.(com|net|org)$', '\1'),
                        '[^a-z0-9]', '', 'g') AS raw
) r
CROSS JOIN LATERAL (
  SELECT CASE r.raw WHEN 'hagerty' THEN 'hagertymarketplace' WHEN 'ebay' THEN 'ebaymotors' WHEN 'sbx' THEN 'sbxcars'
                    WHEN 'classiccars' THEN 'classiccarscom' WHEN 'bringatrailer' THEN 'bat' ELSE r.raw END AS key
) k
LEFT JOIN src o ON o.nslug = k.key
CROSS JOIN LATERAL (SELECT public.listing_species_from_evidence(o.slug, e.source_url, e.metadata) AS own) x;
COMMENT ON VIEW public.v_listing_species IS
  'Each vehicle_events row with its species: its own (species_basis listing, from listing_species_from_evidence) or its '
  'source''s primary (source_primary); unknown when the platform maps to no labelled source. Computed, never stored.';
REVOKE ALL ON public.v_listing_species FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_listing_species TO service_role;

CREATE OR REPLACE FUNCTION public.source_species_gaps()
RETURNS TABLE (slug text, category text, holds text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.slug, o.category::text,
         CASE WHEN m.source_slug IS NOT NULL THEN 'held lots on the Sources board' ELSE 'observations' END
  FROM public.observation_sources o
  LEFT JOIN public.market_source_days m
    ON m.source_slug = o.slug AND m.day = (SELECT max(day) FROM public.market_source_days)
  WHERE o.species IS NULL
    AND (m.source_slug IS NOT NULL
         OR (o.category::text IN ('auction', 'marketplace', 'classifieds', 'dealer', 'aggregator', 'forum', 'social_media',
                                  'media', 'owner')
             AND EXISTS (SELECT 1 FROM public.vehicle_observations v WHERE v.source_id = o.id)))
  ORDER BY 1 $$;
COMMENT ON FUNCTION public.source_species_gaps() IS
  'Sources holding data with no species: every source on the latest market_source_days, and every listing, media or '
  'owner source with observations. Reference, derived and work-record kinds (registry, documentation, internal, agent, '
  'shop, museum, event) have no listing physics and are not asked. Empty is the contract; supabase-deploy.yml fails '
  'its run while any row remains.';
REVOKE ALL ON FUNCTION public.source_species_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.source_species_gaps() TO authenticated, service_role;

-- The labels, each with what it was read from.
UPDATE public.observation_sources o
   SET species = v.species::public.source_species,
       species_set = v.species_set::public.source_species[],
       species_evidence = v.evidence::jsonb,
       updated_at = now()
  FROM (VALUES
  ('1600veloce', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 2586 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.1600veloce.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 8, Private Party 7. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.1600veloce.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('355nation', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations 355nation: kind comment, e.g. https://www.355nation.net/threads/1988-s10-rally-truck-rebuild.193466/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('access-sb', 'aggregator', '{aggregator}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations access-sb (26), e.g. https://www.access.sb/en/st-barts/bars-clubs/juice-bars-en/kaz-a-juice-bar/"], "seen": "A St-Barth destination directory of businesses (sitemap + JSON-LD), not vehicle listings: a map of who exists."}'),
  ('aeg-motorsports', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 1461 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.aegmotorsports.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 3, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.aegmotorsports.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('allcollectorcars', 'timed_auction', '{timed_auction,classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["https://www.allcollectorcars.com/classic-car-auctions/auctions/ fetched 2026-10-18", "observation https://allcollectorcars.com/classic-car-auctions/vehicles/2014-bmw-x3-series-28i (now 404)"], "seen": "Auctions index lists lots with ''Current bid : $ 12,500'' (59 on the page) and a ''Bid Continues'' section; nav also offers ''Buy it Now'' and ''Nationwide Classified Listings''. Soft close not seen."}'),
  ('autotrader', 'classifieds', '{classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations autotrader (200): structured_data.issue ''AUTO TRADER OLD CAR BOOK'', U.S. National Edition, Feb 1988"], "seen": "Held rows are transcribed print ads (ad_key autotrader-print:...) with a seller''s asking price and mileage claim, e.g. 1962 Buick Electra 225 ''$1500''. Seller-posted ads, no auction."}'),
  ('avant-garde-collection', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 2737 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.a-gc.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 9, Private Party 1. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.a-gc.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('barnfinds', 'aggregator', '{aggregator,classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots barnfinds latest 200 posts (fetched 2026-10-18), e.g. https://barnfinds.com/wrx-powered-1955-porsche-550-replica", "listing_page_snapshots barnfinds https://barnfinds.com/bf-exclusive-1993-jeep-wrangler-renegade", "vehicle_events barnfinds metadata.seller_listing_platform (18,137 rows)"], "seen": "Posts are editorial write-ups of cars listed elsewhere: 190 of 200 saved posts say ''here on'' another site (145 eBay, 35 Craigslist, 3 Facebook), e.g. ''The 550 is listed here on eBay ... bids to $12,200''. Held rows name the destination: eBay 8,513, Craigslist 5,996, Facebook 1,897, Hemmings 46, other 24, none 1,661. ''BF Exclusive'' posts are classifieds hosted on Barn Finds (''Price: $18,500 ... Contact The Seller'' form; 136 held).", "extractor": "extract-barn-finds-listing", "listing_rule": "barnfinds.com/bf-exclusive... -> classifieds; other posts -> aggregator (a pointer to the listing''s own site)"}'),
  ('barrett-jackson', 'block_house', '{block_house}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots barrett-jackson https://www.barrett-jackson.com/las-vegas-2019/docket/vehicle/nicholas-cages-1957-chevrolet-bel-air-custom-2-door-post-234223 (fetched 2026-10-15)", "live_auction_sources barrett-jackson: live_event_online, has_soft_close false"], "seen": "Docket page under a sale event: ''Las Vegas 2019 No Reserve Status : Sold''.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-barrett-jackson"}'),
  ('bat', 'timed_auction', '{timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots bat https://bringatrailer.com/listing/1972-porsche-911t-coupe-32/ (fetched 2026-10-18)", "live_auction_sources bat: auction_format timed_online, has_soft_close true, soft_close_window_seconds 120"], "seen": "Saved lot page: ''sold for $330,000 on October 17, 2026 (Lot #269,077)''; sidebar ''Current Bid: USD $32,000 Ends in:''. Latest 300 vehicle_events: all auction rows, every one with ended_at.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Timed with soft close", "extractor": "extract-bat-core"}'),
  ('beverlyhillscarclub', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events ''Beverly Hills Car Club'' (1,968), e.g. https://www.beverlyhillscarclub.com/2005-bentley-mansory-gt63-c-4003.htm", "organization_vehicles: 1,345 sold_by sold, 657 consigner for_sale", "observation_sources notes: publisher listing testimony via email alerts"], "seen": "Its own site''s inventory pages (one .htm per car with a stock number) and its inventory alert emails: dealer stock.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('blue-chip-fleet', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events ''Blue Chip Fleet'' (21), e.g. https://www.bluechipfleet.com/listing/1956-porsche-356-a"], "seen": "Own-site per-car listing pages (/listing/<car>): dealer stock.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('bonhams', 'block_house', '{block_house,timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots bonhams https://cars.bonhams.com/auction/26119/lot/101/1927-crossley-209hp-chassis-no-40428 (fetched 2026-10-18)", "live_auction_sources bonhams: auction_format hybrid (online + live)"], "seen": "Lot page: ''Lot 101 1927 Crossley 20.9HP ... Bonhams MPH September Auction ... Estimate: £30,000 - £40,000''. Hybrid: some sales are online-only timed; a lot''s own page does not say which in what we hold.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-bonhams"}'),
  ('broad-arrow', 'block_house', '{block_house,timed_auction,dealer}',
   '{"examined_at": "2026-10-18", "examined": ["https://www.broadarrowauctions.com/vehicles/lv26_r0097/2015-mclaren-p1-gtr-by-lanzante fetched 2026-10-18", "vehicle_events broad_arrow (1,362 rows): lot codes jc22_, am24_, dg25_, lv25_, pb22_, zt25_ ...", "live_auction_sources broad-arrow: hybrid"], "seen": "Lot page title ''The Las Vegas Auction 2026''; lot ids carry the sale code (lv26_r0097). Nav also offers ''Private Sales'' (dealer-style inventory) and online bidding.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-broad-arrow"}'),
  ('broad_arrow', 'block_house', '{block_house,timed_auction,dealer}',
   '{"examined_at": "2026-10-18", "examined": ["observation_sources: separator-variant duplicate registration of broad-arrow"], "seen": "Duplicate registration of Broad Arrow; same venue. Its sampled observations carry barrett-jackson.com URLs (misattributed rows, reported, not relabelled here).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses"}'),
  ('broncozone', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations broncozone: kind comment, e.g. https://www.broncozone.com/threads/1988-bronco-project-in-pensacola-fl.29589/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('bullet-motorsports', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 911 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.bulletmotorsports.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 6, Private Party 3. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.bulletmotorsports.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('camaros', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations camaros: kind comment, e.g. https://www.camaros.net/threads/1968-camaro-disc-brake-caliper-hose-bracket-finish.496803/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('camaros-net', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations camaros-net: kind comment, e.g. https://www.camaros.net/threads/1968-camaro-ss-rs-rally-sport-vacuum-hidden-headlight-help.496928/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('cars-and-bids', 'timed_auction', '{timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events cars_and_bids latest 300 (e.g. https://carsandbids.com/auctions/3045GlkG/2018-chevrolet-corvette-grand-sport-coupe-2lt)", "live_auction_sources cars-and-bids: timed_online, has_soft_close true, 7 days"], "seen": "Every one of the latest 300 lots has an end time and bids (100% ended_at, 100% bid_count > 0); /auctions/<id>/ lot URLs.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Timed with soft close", "extractor": "extract-cars-and-bids-core"}'),
  ('cars_and_bids', 'timed_auction', '{timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["observation_sources notes: separator-variant duplicate registration of cars-and-bids"], "seen": "Duplicate registration of Cars & Bids; same venue, same physics. Its 200 sampled observations carry bringatrailer.com URLs (misattributed rows, reported, not relabelled here).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Timed with soft close"}'),
  ('classic-com', 'aggregator', '{aggregator}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events classic-com (82): https://classic.com/veh/<vin> pages, metadata.title e.g. ''1954 Ford F100 VIN: F10V4R17983 - CLASSIC.COM''", "https://classic.com/veh/1971-ford-f-250-highboy-f26yck14127-4DGOLAp fetched 2026-10-18 (HTTP 403)"], "seen": "Held rows are classic.com per-VIN vehicle pages that collect a car''s sales from other venues (importer import-classic-auction); classic.com is also read for its dealer index (scripts/index-classic-com-dealers.js).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Aggregators"}'),
  ('classiccars-com', 'aggregator', '{aggregator,classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots classiccars latest 100 /listings/view/ pages (fetched 2026-10-16..17), e.g. https://classiccars.com/listings/view/2119313/1978-chevrolet-corvette-for-sale-in-lenoir-city-tennessee-37772"], "seen": "Pages are dealer inventory syndicated in: ''Stock Number: 1088 ... Listed By: Smoky Mountain Traders ... View Our Listings Visit Our Website''. Of 100: 78 dealer (''Visit Our Website''), 17 private seller, 0 with bids.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Aggregators", "extractor": "extract-classiccars"}'),
  ('claude-extension', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations claude-extension: kinds and sample rows", "observation_sources claude-extension notes"], "seen": "Private, person-held evidence: observations users contributed through the Nuke Claude extension from their own sessions: condition, ownership, sighting.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('collectible-classics', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 3159 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.collectibleclassics.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 7, Private Party 1. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.collectibleclassics.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('collecting-cars', 'timed_auction', '{timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots collectingcars https://collectingcars.com/for-sale/1970-porsche-911-e-2-2-4 (fetched 2026-10-18)", "live_auction_sources collecting-cars: continuous_24_7, has_soft_close true, 7 days"], "seen": "Lot page: ''Ends in 5d 14h €20,255 Login to bid''. Soft close declared in live_auction_sources, not seen on the page.", "extractor": "extract-collecting-cars"}'),
  ('craigslist', 'classifieds', '{classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots craigslist https://www.craigslist.org/view/d/spokane-1989-volkswagen-cabriolet/hPzBQZyhqhsBjqzsTDDnr2 (fetched 2026-10-18)", "listing_page_snapshots craigslist latest 100 /view/ posts"], "seen": "Post page: ''cars & trucks - by owner ... reply ... post id: 7985432409 posted: 2026-10-17 16:14''. 100 of 100 saved posts carry a post id and posted time; none has a bid, a lot or a close time.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Classifieds", "extractor": "extract-craigslist"}'),
  ('craigslist_archive', 'classifieds', '{classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations craigslist_archive (e.g. https://losangeles.craigslist.org/ant/ctd/d/lancaster-1997-ford-explorer-miles/7899128966.html)", "observation_sources notes: saved 2017-2018 Craigslist listings; market_slug craigslist"], "seen": "Saved Craigslist posts keyed by post id in the URL; a capture channel of Craigslist.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Classifieds"}'),
  ('dean-laumbach', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 798 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, no website recorded"], "seen": "BaT''s seller line on sampled saved lots: Dealer 5, Private Party 8. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); no own site is recorded, so the dealer label rests on BaT''s seller line alone.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('desktop_archive', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations desktop_archive: kinds and sample rows", "observation_sources desktop_archive notes"], "seen": "Private, person-held evidence: files from the owner''s desktop archive: a specification observation.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('directory-saintbarth', 'aggregator', '{aggregator}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations directory-saintbarth (132), e.g. https://www.directory-saintbarth.com/fr/categorie/agences-de-voyages"], "seen": "An island business directory (category pages of businesses): a map of who exists."}'),
  ('ebay_motors', 'auth_walled_marketplace', '{auth_walled_marketplace,classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots ebay https://www.ebay.com/sch/i.html?LH_BIN=1&_nkw=car&_sacat=6001 (direct fetch, HTTP 403, 2026-10-09 and 10-10)", "supabase/functions/extract-ebay-motors/browseApi.ts (eBay Browse API with an application token)", "vehicle_events ebay_motors metadata.buying_options (1,121 rows)"], "seen": "Direct fetches are refused (403); reads go through the token-gated Browse API or Firecrawl. Formats held: FIXED_PRICE+BEST_OFFER 714, AUCTION 198, CLASSIFIED_AD 180, FIXED_PRICE 27.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Auth-walled marketplaces", "extractor": "extract-ebay-motors", "listing_rule": "metadata.buying_options contains CLASSIFIED_AD -> classifieds; other rows take the primary"}'),
  ('email_receipt', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations email_receipt: kinds and sample rows", "observation_sources email_receipt notes"], "seen": "Private, person-held evidence: receipts from the owner''s mail: provenance and work_record observations.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('facebook-saved', 'auth_walled_marketplace', '{auth_walled_marketplace}',
   '{"examined_at": "2026-10-18", "examined": ["observation_sources notes: Facebook Saved Items (user-curated); market_slug facebook_marketplace"], "seen": "A signed-in user''s saved Marketplace items: a capture channel of Facebook Marketplace behind the same login.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Auth-walled marketplaces"}'),
  ('facebook_marketplace', 'auth_walled_marketplace', '{auth_walled_marketplace}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots facebook_marketplace https://www.facebook.com/marketplace/item/32077056228606021 (fetch_method browser_mcp, 2026-03-20)", "supabase/functions/extract-facebook-marketplace (direct and browser_capture modes)"], "seen": "Pages are read only through a signed-in browser (browser_mcp captures, the owner''s Mac fleet); the extractor accepts browser captures, not server fetches. observation_sources.requires_auth is false on this row (reported).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Auth-walled marketplaces", "extractor": "extract-facebook-marketplace"}'),
  ('fantasy-junction', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 535 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.fantasyjunction.com", "vehicle_events own-site row https://fantasyjunction.com/inventory/2006-chevrolet-corvette-z06/overview"], "seen": "BaT''s seller line on sampled saved lots: Dealer 5, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.fantasyjunction.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('gaa-classic-cars', 'block_house', '{block_house}',
   '{"examined_at": "2026-10-18", "examined": ["https://www.gaaclassiccars.com/vehicles/43438/2003-ford-excursion-xlt fetched 2026-10-18"], "seen": "Lot page: ''2003 Ford Excursion XLT Lot # ST0186''; ''Upcoming Auctions NOV. 5-7 | FEB. 18-20 | JUL. 22-24''; ''Watch Live''.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-gaa-classics"}'),
  ('gateway-classic-cars', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events www.gatewayclassiccars.com (3), e.g. https://www.gatewayclassiccars.com/vehicles/hou/3093/1955-ford-customline", "listing_page_snapshots gateway_classics https://www.gatewayclassiccars.com/vehicles?sort=newest (2026-10-01..18)"], "seen": "Own-site consignment inventory by showroom (/vehicles/hou/3093/...).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('geneva-motorcars', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 2155 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.genevamotorcars.com", "vehicle_events own-site row https://genevamotorcars.com/2012-ford-f-150-darien-wi-harvard-whitewater-janesville-walworth/used_car/vcyesze8gqy%3d"], "seen": "BaT''s seller line on sampled saved lots: Dealer 2, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.genevamotorcars.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('gmfullsize', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations gmfullsize: kind comment, e.g. https://www.gmfullsize.com/threads/1971-chevy-longhorn.330092/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('gooding', 'block_house', '{block_house}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots gooding https://www.goodingco.com/lot/1962-mercedes-benz-300-sl-roadster-rn26 (fetched 2026-10-18)"], "seen": "Lot record names its sale: auction ''Retromobile New York Auctions'', lotNumber, low/high estimate, hasReservePrice.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-gooding"}'),
  ('grand-prix-classics', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events grand-prix-classics (5), e.g. https://grandprixclassics.com/vehicle/1957-bmw-507-roadster"], "seen": "Own-site per-car pages (/vehicle/<car>) under /inventory/cars.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('hagerty-marketplace', 'timed_auction', '{timed_auction,classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots hagerty https://www.hagerty.com/marketplace/auction/1992-Ford-F-150/e600f2c9-02a9-482c-9329-09e8555deca1 (fetched 2026-10-15)", "listing_page_snapshots hagerty https://www.hagerty.com/marketplace/search (fetched 2026-10-18)", "vehicle_events hagerty (85 rows)"], "seen": "Lot page: ''Current bid [bidder] $17,250 ... Ending Fri, Oct 16 at 2:15 PM EDT Bids 7 ... Place bid''. Search page title ''Classic Cars Auctions / Classifieds | Hagerty Marketplace'' (both species), but all 24 listing links on it are /marketplace/auction/ and all 84 hagerty.com rows we hold are /marketplace/auction/ URLs.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Timed with soft close", "extractor": "extract-hagerty-listing", "listing_rule": "hagerty.com/marketplace/auction/ -> timed_auction; no classified URL pattern seen yet, so other rows take the primary"}'),
  ('hemmings', 'aggregator', '{aggregator,timed_auction,classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["web.archive.org 2026-07-18 https://www.hemmings.com/classifieds/cars-for-sale (listing JSON)", "vehicle_events hemmings (70): 41 /classifieds/, 22 /auction/, 7 /listing/", "https://www.hemmings.com/auction/1986-chevrolet-suburban-wa-416540 fetched 2026-10-18 (HTTP 403)"], "seen": "Classifieds feed page of 30: type ''dealer'' 15, ''auction'' 11, ''carsforsale'' 4 (a syndicated feed); nav ''Hemmings Auctions / Make Offer Listings / Dealers''. A map of dealers and feeds plus its own timed auctions.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Aggregators", "listing_rule": "hemmings.com/auction/ -> timed_auction; other rows take the primary"}'),
  ('imessage', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations imessage: kinds and sample rows", "observation_sources imessage notes"], "seen": "Private, person-held evidence: the owner''s messages: work_record observations.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('iphoto', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations iphoto: kinds and sample rows", "observation_sources iphoto notes"], "seen": "Private, person-held evidence: the owner''s photo library: condition, media and ownership observations on photos in vehicle-photos/<vehicle>/iphoto/.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('jamesedition', 'aggregator', '{aggregator}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots jamesedition https://www.jamesedition.com/cars/porsche/cayenne/2019-porsche-cayenne-sport-utility-4d-for-sale-17736510 (firecrawl, 2026-04-25)"], "seen": "''For Sale by AUTO VAULT ATLANTA, 18 listings for Sale ... Listing reference KDA05192 ... Contact Agent''; ''Sell With Us'' links to /professional_seller. Dealer inventory listed in, no bids.", "extractor": "extract-jamesedition"}'),
  ('k5_owner_email_provenance', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations k5_owner_email_provenance: kinds and sample rows", "observation_sources k5_owner_email_provenance notes"], "seen": "Private, person-held evidence: the owner''s K5 email trail: provenance and specification observations.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('ksl', 'classifieds', '{classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["supabase/functions/extract-ksl/fixtures/listing-tahoe.html (a stored KSL listing page)", "listing_page_snapshots ksl https://cars.ksl.com/listing/10555366 (fetched 2026-10-15)", "vehicle_events ksl metadata.listing_posted_at"], "seen": "Stored listing: sellerType ''Private'', createdAt and expiresAt (about 111 days apart), status ''Active'', no bid or lot fields; the extractor reads posted_at / expires_at / seller_type and keys by the numeric listing id.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Classifieds", "extractor": "extract-ksl"}'),
  ('lart-de-lautomobile', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events \"L''Art de l''Automobile\" (977), e.g. https://www.lartdelautomobile.com/fiche/x3-m-competition-bmw", "organization_vehicles: 875 sold_by sold, 46 consigner for_sale"], "seen": "Its own site''s per-car pages (/fiche/<car>): dealer stock, sold and for sale.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('manual_upload', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations manual_upload: kinds and sample rows", "observation_sources manual_upload notes"], "seen": "Private, person-held evidence: documents the owner uploaded: provenance, sale_result and work_record observations.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('mazdas247', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations mazdas247: kind comment, e.g. https://mazdas247.com/forum/t/2003-mp5-overhaul.123843588/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('mcqueens', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 673 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.mcqueenclassics.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 9, Private Party 1. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.mcqueenclassics.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('mecum', 'block_house', '{block_house}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots mecum https://www.mecum.com/lots/1178138/2010-ferrari-599-gtb-fiorano (fetched 2026-10-18)", "live_auction_sources mecum: live_event_online, has_soft_close false"], "seen": "Lot page: ''Lot T150 // Thursday, August 13th // Monterey 2026''; nav lists sale events (Kansas City 2026, Kissimmee 2027).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-mecum"}'),
  ('michaels-motor-cars', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 603 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.michaelsmotorcars.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 9, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.michaelsmotorcars.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('mohr-imports', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 816 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.mohrimports.com", "vehicle_events own-site row https://mohrimports.com/for-sale/porsche/2013-porsche-911-carrera-coupe/1742.html"], "seen": "BaT''s seller line on sampled saved lots: Dealer 2, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.mohrimports.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('motorious', 'aggregator', '{aggregator}',
   '{"examined_at": "2026-10-18", "examined": ["https://buy.motorious.com/vehicles/420773/1998-ferrari-355-f1-gts fetched 2026-10-18 (a row we hold; now the inventory page)", "scripts/scrape-motorious-inventory.js"], "seen": "Page ''Inventory | Motorious'' with ''Become a Dealer'' and ''Powered by Speed Digital'': dealer inventory gathered from dealer sites; the scraper walks ''Motorious dealer inventory pages''."}'),
  ('nastyz28', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations nastyz28: kind comment, e.g. https://nastyz28.com/threads/1970-camaro-restofy.302755/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('oldcaronline', 'classifieds', '{classifieds}',
   '{"examined_at": "2026-10-18", "examined": ["https://www.oldcaronline.com/1963-Studebaker-Lark-San%20diego-California-for-sale-IDf1149726.htm fetched 2026-10-18 (a row we hold)"], "seen": "Ad page: ''Private Seller ... Contact Seller ... Ad #: 114...'', ''Listed Price $25,000 Reduced Oct 6/2025 $22,999''; site nav ''Today''s New Ads'', ''Post a Wanted Ad''. No bids, no close."}'),
  ('owner-input', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations owner-input: kinds and sample rows", "observation_sources owner-input notes"], "seen": "Private, person-held evidence: direct owner attestation on the platform: condition, listing and provenance observations.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('pcarmarket', 'timed_auction', '{timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["listing_page_snapshots pcarmarket https://www.pcarmarket.com/auction/2024-toyota-land-cruiser-1958 (fetched 2026-10-16)", "live_auction_sources pcarmarket: timed_online, has_soft_close true"], "seen": "Saved lot page: ''Bids 13 Offers 2 Final bid $50,000 Ended Mar 5, 2025''. Latest 300 events: 100% ended_at and bids.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Timed with soft close", "extractor": "import-pcarmarket-listing"}'),
  ('private-collection-motors', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 930 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.privatecollectionmotors.com"], "seen": "No saved BaT page among its latest 25 lots; dealer from the BaT seller discovery (339 listings over 8 years). What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.privatecollectionmotors.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('rm-sothebys', 'block_house', '{block_house,timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events rm-sothebys latest 300 (e.g. https://rmsothebys.com/auctions/ad26/lots/r0001-2010-ferrari-599-gtb-fiorano/)", "live_auction_sources rm-sothebys: auction_format hybrid (live event + online)"], "seen": "Lots are keyed under a sale code (/auctions/ad26/lots/r0001); every one of the latest 300 has an end date (the sale).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Block houses", "extractor": "extract-rmsothebys"}'),
  ('russo-and-steele', 'block_house', '{block_house}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations russo-and-steele (192): conceptcarz://event/1219/... result rows", "https://www.russoandsteele.com/ fetched 2026-10-18"], "seen": "Held rows are one sale event''s lot results (event 1219; e.g. 2011 Cadillac Escalade ESV sold $71,500). The site now redirects to a parked /lander page."}'),
  ('sbx-cars', 'timed_auction', '{timed_auction}',
   '{"examined_at": "2026-10-18", "examined": ["web.archive.org 2025-08-19 https://sbxcars.com/listing/405/1987-mercedes-benz-300slr (a lot we hold)", "https://sbxcars.com/ fetched 2026-10-18", "live_auction_sources sbx-cars: timed_online, has_soft_close true"], "seen": "Archived lot page: ''US$270,250 Current bid ... 05:46:57 Time Left 39 Bids ... Place a Bid ... Lot#: 405''. The site today reads ''SBX Cars Private Sales'' (no public auctions); the lots we hold are the earlier timed auctions."}'),
  ('silver-arrow-cars', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 790 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://silverarrowcars.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 11, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://silverarrowcars.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('streetside-classics', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events ''Streetside Classics'' (15), e.g. https://www.streetsideclassics.com/vehicles/9791-cha/1996-ford-f-250-custom-xlt-4x4", "listing_page_snapshots streetside_classics"], "seen": "Own-site consignment inventory, per-car pages keyed by stock number and showroom (9791-cha, 7926-dfw).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('tactical-fleet', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events tactical-fleet (144), e.g. https://tacticalfleet.com/inventory/Used-2004-Ferrari-360_Challenge_Stradale-ZFFDU57AX40133308-2359", "observation_sources notes: RideMotive dealer platform, dealer_ids 1955, 2358, 2359"], "seen": "Own-site inventory pages keyed by VIN and dealer id (''/inventory/Used-<year>-<make>-<model>-<VIN>-<dealer id>'').", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('thetruckstop', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations thetruckstop: kind comment, e.g. https://www.thetruckstop.us/forum/threads/1952-ferguson-to30.45312/"], "seen": "Forum threads: members'' posts about their own builds, kept as comment testimony; no listing, price or close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}'),
  ('user-input', 'owner_private', '{owner_private}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations user-input: kinds and sample rows", "observation_sources user-input notes"], "seen": "Private, person-held evidence: a signed-in user''s own entries: specification observations.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Owner''s private data"}'),
  ('vanguard-motor-sales', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events www.vanguardmotorsales.com (26), e.g. https://www.vanguardmotorsales.com/inventory/5539/1968-plymouth-road-runner-hellcat-redeye", "listing_page_snapshots vanguard_motors https://www.vanguardmotorsales.com/inventory (2026-10-03..18)"], "seen": "Own-site inventory index and per-car pages (/inventory/<stock id>/...).", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('vantage-auto', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 2121 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://www.vantageauto.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 2, Private Party 0. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://www.vantageauto.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('velocity-restorations', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events ''Velocity Restorations'' (8), e.g. https://velocityrestorations.com/models/classic-chevrolet-k10", "organizations.business_type builder"], "seen": "A builder selling its own builds from its own site; the pages held are model pages (/models/<model>), a catalogue of builds rather than individual cars.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites"}'),
  ('wob', 'dealer', '{dealer}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_events where source_organization_id is this dealer: 2582 rows, all source_platform bat", "listing_page_snapshots bat: the ''Private Party or Dealer'' line on its latest saved lots", "organizations.business_type dealer, website https://wobcars.com"], "seen": "BaT''s seller line on sampled saved lots: Dealer 1, Private Party 3. What we hold for it are BaT timed-auction lots it sold (each lot''s own species is timed_auction); its own inventory site (https://wobcars.com) is the dealer site and is not read yet.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Dealer sites", "listing_rule": "held rows are BaT lots: their species comes from bat (timed_auction)"}'),
  ('youtube', 'media_forum_video', '{media_forum_video}',
   '{"examined_at": "2026-10-18", "examined": ["vehicle_observations youtube: kind media, e.g. https://www.youtube.com/@BarrettJacksonTV"], "seen": "Video channels and clips kept as media testimony.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names it under Media, forums, video"}')
  ) v(slug, species, species_set, evidence)
 WHERE o.slug = v.slug
   AND (o.species IS DISTINCT FROM v.species::public.source_species
        OR o.species_set IS DISTINCT FROM v.species_set::public.source_species[]
        OR o.species_evidence IS DISTINCT FROM v.evidence::jsonb);

-- The coarse kind follows the species for sources holding listings.
UPDATE public.observation_sources SET category = 'aggregator', updated_at = now()
 WHERE slug IN ('barnfinds', 'classic-com', 'classiccars-com', 'hemmings', 'motorious') AND category::text IS DISTINCT FROM 'aggregator';
UPDATE public.observation_sources SET category = 'auction', updated_at = now()
 WHERE slug IN ('hagerty-marketplace') AND category::text IS DISTINCT FROM 'auction';
UPDATE public.observation_sources SET category = 'classifieds', updated_at = now()
 WHERE slug IN ('autotrader', 'craigslist', 'craigslist_archive', 'ksl', 'oldcaronline') AND category::text IS DISTINCT FROM 'classifieds';
UPDATE public.observation_sources
   SET category = 'internal', updated_at = now(),
       notes = coalesce(notes || ' ', '') || 'Kind set to internal 2026-10-18: Nuke''s own floor; its only observation is '
               '''Offer smoke test'' (2026-07-11), no outside listings.'
 WHERE slug = 'nuke-marketplace' AND category::text <> 'internal';

CREATE OR REPLACE FUNCTION public.market_sources_read()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH d AS (
    SELECT max(day) AS day FROM public.market_source_days
  ), cur AS (
    SELECT m.*, o.market_slug, o.species, o.species_evidence,
           regexp_replace(lower(m.source_slug), '[^a-z0-9]', '', 'g') AS nslug,
           b.logo_url AS org_logo_url, b.business_type AS org_business_type
    FROM public.market_source_days m
    JOIN d ON m.day = d.day
    LEFT JOIN public.observation_sources o ON o.slug = m.source_slug
    LEFT JOIN public.organizations b ON b.id = o.business_id
  ), ranked AS (
    SELECT * FROM cur WHERE market_slug IS NULL AND species::text IN ('timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator')
  ), held_keys AS (
    SELECT DISTINCT nslug FROM ranked WHERE species::text <> 'aggregator'
  ), key_map AS (
    SELECT DISTINCT raw_key, canon_key
    FROM (
      SELECT nslug AS raw_key, nslug AS canon_key FROM ranked
      UNION ALL
      SELECT regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'),
             regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g')
      FROM public.observation_sources o
      WHERE o.slug IS NOT NULL
      UNION ALL
      SELECT 'classiccars', 'classiccarscom'
      UNION ALL
      SELECT 'bringatrailer', 'bat'
      UNION ALL
      SELECT 'hagerty', 'hagertymarketplace'
      UNION ALL
      SELECT 'sbx', 'sbxcars'
      UNION ALL
      SELECT 'ebay', 'ebaymotors'
      UNION ALL
      SELECT 'wwwoldcaronlinecom', 'oldcaronline'
      UNION ALL
      SELECT 'wwwvanguardmotorsalescom', 'vanguardmotorsales'
      UNION ALL
      SELECT 'wwwgatewayclassiccarscom', 'gatewayclassiccars'
      UNION ALL
      SELECT 'wwwvelocityrestorationscom', 'velocityrestorations'
    ) km
  ), grade AS (
    SELECT c.source_slug,
           jsonb_build_object(
             'reference', r.universe_total, 'reference_method', r.census_method, 'reference_at', r.census_at,
             'census', c.population, 'census_method', c.population_method, 'census_at', c.population_at,
             'error', round((r.universe_total - c.population)::numeric / c.population, 4)
           ) AS population_grade
    FROM ranked c
    CROSS JOIN LATERAL (
      SELECT sc.universe_total, sc.census_method, sc.census_at
      FROM public.source_census sc
      JOIN public.observation_sources o ON o.id = sc.source_id
      WHERE regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') = c.nslug
        AND sc.census_method IN ('owner_reference', 'catalogue_estimate', 'estimate')
        AND sc.universe_total > 0
        AND sc.census_at < c.population_at
      ORDER BY sc.census_at DESC
      LIMIT 1
    ) r
    WHERE c.population > 0
      AND c.population_method NOT IN ('owner_reference', 'catalogue_estimate', 'estimate')
  ), ago AS (
    SELECT DISTINCT ON (m.source_slug) m.source_slug, m.day, m.landed_lots
    FROM public.market_source_days m CROSS JOIN d
    WHERE m.day <= d.day - 7
    ORDER BY m.source_slug, m.day DESC
  ), live AS (
    SELECT regexp_replace(lower(s.slug), '[^a-z0-9]', '', 'g') AS nslug,
           count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.updated_at > now() - interval '24 hours')
             AS live_lots,
           max(m.updated_at) FILTER (WHERE m.is_live AND m.auction_end_time > now()) AS live_at
    FROM public.live_auction_sources s
    JOIN public.monitored_auctions m ON m.source_id = s.id
    GROUP BY 1
  ), dealer_live AS (
    SELECT d_orgs.nslug,
           sum(ss.active_listings)::int AS live_lots,
           max(ss.calculated_at) AS live_at
    FROM (
      SELECT DISTINCT org_id, nslug
      FROM (
        SELECT o.business_id AS org_id,
               regexp_replace(lower(coalesce(o.market_slug, o.slug)), '[^a-z0-9]', '', 'g') AS nslug
        FROM public.observation_sources o
        WHERE o.business_id IS NOT NULL
          AND o.category::text = 'dealer'
        UNION ALL
        SELECT 'c3aa7ea2-565d-4e08-bf6f-6464dc04fe59'::uuid, 'michaelsmotorcars'
        WHERE EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'michaels-motor-cars')
      ) x
      WHERE org_id IS NOT NULL
    ) d_orgs
    JOIN public.organization_seller_stats ss ON ss.organization_id = d_orgs.org_id
    WHERE ss.active_listings > 0
    GROUP BY 1
  ), recent_ev AS (
    SELECT coalesce(km.canon_key, raw.raw_key) AS nslug,
           raw.created_at,
           date_trunc('hour', raw.created_at) AS hour,
           to_timestamp(floor(extract(epoch from raw.created_at) / 300) * 300) AS b5
    FROM (
      SELECT regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g') AS raw_key,
             e.created_at
      FROM public.vehicle_events e
      WHERE e.created_at >= date_trunc('hour', now()) - interval '1 hour'
        AND e.source_platform IS NOT NULL
    ) raw
    LEFT JOIN key_map km ON km.raw_key = raw.raw_key
  ), live_hr_counts AS (
    SELECT nslug, hour, count(*)::int AS records, max(created_at) AS last_at
    FROM recent_ev
    GROUP BY 1, 2
  ), live_win AS (
    SELECT nslug,
           count(*) FILTER (WHERE created_at >= now() - interval '1 hour')::int AS landed_1h,
           count(*) FILTER (WHERE created_at >= now() - interval '15 minutes')::int AS landed_15m,
           max(created_at) AS last_at
    FROM recent_ev
    GROUP BY 1
  ), hist_norm AS (
    SELECT coalesce(km.canon_key, h.source_key) AS nslug,
           h.hour,
           sum(h.records)::int AS records
    FROM public.market_source_hours h
    LEFT JOIN key_map km ON km.raw_key = h.source_key
    WHERE h.hour >= date_trunc('day', now()) - interval '13 days'
    GROUP BY 1, 2
  ), hrs_merged AS (
    SELECT coalesce(h.nslug, l.nslug) AS nslug,
           coalesce(h.hour, l.hour) AS hour,
           GREATEST(coalesce(h.records, 0), coalesce(l.records, 0))::int AS records
    FROM hist_norm h
    FULL JOIN live_hr_counts l ON l.nslug = h.nslug AND l.hour = h.hour
  ), hrs AS (
    SELECT h.nslug,
           sum(h.records) FILTER (WHERE h.hour >= date_trunc('hour', now()) - interval '23 hours')::int AS landed_24h,
           sum(h.records) FILTER (WHERE h.hour >= date_trunc('hour', now()) - interval '167 hours')::int AS landed_7d,
           max(h.hour) FILTER (WHERE h.records > 0) AS last_hour
    FROM hrs_merged h
    GROUP BY 1
  ), days AS (
    SELECT k.nslug, jsonb_agg(coalesce(x.n, 0) ORDER BY k.day) AS days14
    FROM (SELECT DISTINCT nslug, gs::date AS day
          FROM hrs_merged,
               generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') gs) k
    LEFT JOIN (SELECT nslug, hour::date AS day, sum(records)::int AS n
               FROM hrs_merged
               GROUP BY 1, 2) x USING (nslug, day)
    GROUP BY 1
  ), last_ever AS (
    SELECT coalesce(km.canon_key, h.source_key) AS nslug,
           max(h.hour) AS last_hour
    FROM public.market_source_hours h
    LEFT JOIN key_map km ON km.raw_key = h.source_key
    WHERE h.records > 0
    GROUP BY 1
  ), h24_grid AS (
    SELECT gs AS hour, ord
    FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') WITH ORDINALITY AS t(gs, ord)
  ), hrs24_by_src AS (
    SELECT s.nslug,
           jsonb_agg(coalesce(hm.records, 0) ORDER BY g.ord) AS hours24
    FROM (SELECT DISTINCT nslug FROM ranked) s
    CROSS JOIN h24_grid g
    LEFT JOIN hrs_merged hm ON hm.nslug = s.nslug AND hm.hour = g.hour
    GROUP BY 1
  ), hrs24_total AS (
    SELECT coalesce(jsonb_agg(coalesce(x.n, 0) ORDER BY g.ord), '[]'::jsonb) AS hours24
    FROM h24_grid g
    LEFT JOIN (
      SELECT hm.hour, sum(hm.records)::int AS n
      FROM hrs_merged hm
      JOIN held_keys r USING (nslug)
      WHERE hm.hour >= date_trunc('hour', now()) - interval '23 hours'
      GROUP BY 1
    ) x ON x.hour = g.hour
  ), b5_grid AS (
    SELECT gs AS b5, ord
    FROM generate_series(
      to_timestamp(floor(extract(epoch from now()) / 300) * 300) - interval '55 minutes',
      to_timestamp(floor(extract(epoch from now()) / 300) * 300),
      interval '5 minutes'
    ) WITH ORDINALITY AS t(gs, ord)
  ), b5_counts AS (
    SELECT nslug, b5, count(*)::int AS n
    FROM recent_ev
    WHERE b5 >= to_timestamp(floor(extract(epoch from now()) / 300) * 300) - interval '55 minutes'
    GROUP BY 1, 2
  ), mins60_by_src AS (
    SELECT s.nslug,
           jsonb_agg(coalesce(bc.n, 0) ORDER BY g.ord) AS mins60
    FROM (SELECT DISTINCT nslug FROM ranked) s
    CROSS JOIN b5_grid g
    LEFT JOIN b5_counts bc ON bc.nslug = s.nslug AND bc.b5 = g.b5
    GROUP BY 1
  ), mins60_total AS (
    SELECT coalesce(jsonb_agg(coalesce(x.n, 0) ORDER BY g.ord), '[]'::jsonb) AS mins60
    FROM b5_grid g
    LEFT JOIN (
      SELECT bc.b5, sum(bc.n)::int AS n
      FROM b5_counts bc
      JOIN held_keys r USING (nslug)
      GROUP BY 1
    ) x ON x.b5 = g.b5
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'day', (SELECT day FROM d),
    'columns', jsonb_build_array('source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population',
                                 'population_method', 'population_confidence', 'population_at', 'map_sales', 'map_usd',
                                 'sales_12m', 'usd_12m', 'sales_prior_12m', 'usd_prior_12m', 'months', 'live_lots', 'live_at',
                                 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d', 'last_landed', 'days14',
                                 'logo_url', 'business_type', 'population_grade', 'species', 'species_label',
                                 'counts_as_held', 'species_evidence'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.source_slug, c.display_name, c.category, c.house, c.landed_lots, c.landed_at,
                                         c.population, c.population_method, c.population_confidence, c.population_at,
                                         c.map_sales, c.map_usd, c.sales_12m, c.usd_12m, c.sales_prior_12m, c.usd_prior_12m,
                                         c.months,
                                         coalesce(l.live_lots, dl.live_lots, 0),
                                         coalesce(l.live_at, dl.live_at),
                                         a.landed_lots, a.day,
                                         coalesce(h.landed_24h, 0), coalesce(h.landed_7d, 0),
                                         coalesce(h.last_hour, le.last_hour), coalesce(dd.days14, '[]'::jsonb),
                                         c.org_logo_url, c.org_business_type, g.population_grade, c.species,
                                         public.source_species_label(c.species), c.species::text <> 'aggregator',
                                         c.species_evidence)
                       ORDER BY CASE c.species::text WHEN 'timed_auction' THEN 1 WHEN 'block_house' THEN 2 WHEN 'dealer' THEN 3
                                  WHEN 'classifieds' THEN 4 WHEN 'auth_walled_marketplace' THEN 5 WHEN 'aggregator' THEN 6
                                  ELSE 7 END,
                                c.landed_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST, c.source_slug)
      FROM ranked c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = c.nslug
      LEFT JOIN dealer_live dl ON dl.nslug = c.nslug
      LEFT JOIN hrs h ON h.nslug = c.nslug
      LEFT JOIN days dd ON dd.nslug = c.nslug
      LEFT JOIN last_ever le ON le.nslug = c.nslug
      LEFT JOIN grade g ON g.source_slug = c.source_slug), '[]'::jsonb),
    'not_ranked', coalesce((
      SELECT jsonb_object_agg(k, n) FROM (
        SELECT CASE WHEN market_slug IS NOT NULL THEN 'capture channels'
                    WHEN species IS NULL THEN 'no species evidence' ELSE species::text END AS k,
               count(*) AS n
        FROM cur WHERE NOT (market_slug IS NULL AND coalesce(species::text, '') IN ('timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator'))
        GROUP BY 1) x), '{}'::jsonb),
    'species_groups', public.source_species_groups(),
    'landing', jsonb_build_object(
      'hour', date_trunc('hour', now()),
      'bucket_5m', to_timestamp(floor(extract(epoch from now()) / 300) * 300),
      'totals', jsonb_build_object(
        'landed_15m', coalesce((SELECT sum(w.landed_15m)::int FROM live_win w JOIN held_keys r USING (nslug)), 0),
        'landed_1h', coalesce((SELECT sum(w.landed_1h)::int FROM live_win w JOIN held_keys r USING (nslug)), 0),
        'landed_24h', coalesce((SELECT sum(h.landed_24h)::int FROM hrs h JOIN held_keys r USING (nslug)), 0),
        'landed_7d', coalesce((SELECT sum(h.landed_7d)::int FROM hrs h JOIN held_keys r USING (nslug)), 0),
        'hours24', (SELECT hours24 FROM hrs24_total),
        'mins60', (SELECT mins60 FROM mins60_total)
      ),
      'sources', coalesce((
        SELECT jsonb_object_agg(
          c.source_slug,
          jsonb_build_object(
            'landed_15m', coalesce(w.landed_15m, 0),
            'landed_1h', coalesce(w.landed_1h, 0),
            'landed_24h', coalesce(h.landed_24h, 0),
            'landed_7d', coalesce(h.landed_7d, 0),
            'last_at', coalesce(w.last_at, h.last_hour, le.last_hour),
            'hours24', coalesce(h24.hours24, '[]'::jsonb),
            'mins60', coalesce(m60.mins60, '[]'::jsonb)
          )
        )
        FROM ranked c
        LEFT JOIN hrs h ON h.nslug = c.nslug
        LEFT JOIN live_win w ON w.nslug = c.nslug
        LEFT JOIN last_ever le ON le.nslug = c.nslug
        LEFT JOIN hrs24_by_src h24 ON h24.nslug = c.nslug
        LEFT JOIN mins60_by_src m60 ON m60.nslug = c.nslug
      ), '{}'::jsonb)
    )
  );
$function$;
COMMENT ON FUNCTION public.market_sources_read() IS
  'The Sources board: sources holding listings ranked by held lots within their species (source_species_groups(), the '
  'names of data-machine-cases.md §6), each row with its species, label, whether it counts as listings held (aggregators '
  'do not) and its species evidence; capture channels and sources without species evidence counted in not_ranked. '
  'Board totals count listing-holding species only. 2026-10-18.';

COMMIT;
