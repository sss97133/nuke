-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in an empty disposable PG17 database only (stub tables, not production).
-- Empty disposable PG17 dm_refinement_* database only; synthetic rows.
-- Contract for 20261021193000_source_holdings_fold.sql: browse_source_read returns one jsonb for /browse?source=<slug>
-- {as_of, status (ok | not_folded | unknown_source), median_floor, source, holdings, level (makes | models | listings),
-- scope, makes, models, listings {total, page, page_size, rows}} from two folds (mv_source_episodes, mv_source_holdings)
-- that source_holdings_refresh() fills. Held to it here:
--   * only a browsable source (a market-level registry row of an auction, dealer, classifieds, marketplace or aggregator
--     species) is folded or answered; an unregistered platform, an owner_private source, a source with no species or a
--     media source is absent from the fold and is unknown_source, whatever it holds;
--   * a capture channel and every spelling of a source (a short alias, www.<name>.com) are one source, the board's key (the
--     alias spellings in the fixtures are the board's own mapping data, spelled as the registry spells them);
--   * medians are NULL under 5 and are per status (active, ended, sold), never a blend;
--   * the status the source wrote outranks a final price or a close time, bid-goes-on is ended, and an alive word is
--     alive only while the source's own end clock is ahead; the rows shown take their status from the live event;
--   * a listing's dates are the source's own (NULL when it gave none), never the day Nuke recorded the row;
--   * a row's bids are the event's count, else the capture's own count when the column says 0 or nothing (a count that is not
--     a number is no count), and its price label is the source's own "Starting bid" (any case, trimmed) or null, never another word;
--   * the holdings carry archived (rows read from a saved copy: an http or https address only) and dated_min and dated_max
--     (the earliest and latest listing clock the source gave, never the landing day), as 0 and null where nothing is
--     counted, and every answer carries the same holdings keys;
--   * a row's location is the vehicle's own, else the source's text only when it reads as a place (a phone number, an e-mail
--     address or a street address is never sent); listing_url and archive_url are web addresses or null; the card photo is read
--     through the photo gate (vehicle_card_images), never from vehicles.primary_image_url; checked_at is the event row's last
--     write, kept apart from recorded_at; the source is named as the Sources board names it;
--   * make and model are keyed and shown trimmed; a blank make or model, a year outside 1885 to two years ahead, a vehicle whose
--     is_public is NULL and a private_seller registry row are never counted as listings or years;
--   * the reader tests the whole visibility of a vehicle itself (is_public, deleted_at, listing_kind) whatever the fold held, and
--     the reader and the refresh pin search_path and set no statement_timeout of their own;
--   * anon reads the page and cannot refresh the fold or read the helpers.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- The columns the migration reads, as plain tables with their live types (2026-10-20).
CREATE TYPE public.source_species AS ENUM ('timed_auction', 'block_house', 'dealer', 'classifieds',
  'auth_walled_marketplace', 'aggregator', 'media_forum_video', 'private_seller', 'owner_private');
CREATE FUNCTION public.source_species_label(p public.source_species) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p::text
    WHEN 'timed_auction' THEN 'Timed with soft close' WHEN 'block_house' THEN 'Block houses'
    WHEN 'dealer' THEN 'Dealer sites' WHEN 'classifieds' THEN 'Classifieds'
    WHEN 'auth_walled_marketplace' THEN 'Auth-walled marketplaces' WHEN 'aggregator' THEN 'Aggregators'
    WHEN 'media_forum_video' THEN 'Media, forums, video' WHEN 'private_seller' THEN 'Private sellers'
    WHEN 'owner_private' THEN 'Owner''s private data' END $$;
CREATE FUNCTION public.source_species_groups() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_agg(jsonb_build_object('species', s, 'label', public.source_species_label(s::public.source_species),
                                      'unit', u, 'counts_as_held', h) ORDER BY o)
  FROM (VALUES (1, 'timed_auction', 'lots held', true), (2, 'block_house', 'lots held', true),
               (3, 'dealer', 'vehicles held', true), (4, 'classifieds', 'posts held', true),
               (5, 'auth_walled_marketplace', 'listings held', true),
               (6, 'aggregator', 'pages read, not listings held', false), (7, 'private_seller', 'BaT lots', false),
               (8, 'owner_private', 'vehicles', false)) g(o, s, u, h) $$;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text, logo_url text);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text, display_name text,
  category text, species public.source_species, base_url text, business_id uuid, market_slug text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.market_source_days (day date, source_slug text, display_name text, category text,
  species public.source_species, landed_lots bigint, landed_at timestamptz, population bigint, population_method text,
  population_confidence numeric, population_at timestamptz);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, trim text, source text,
  is_public boolean DEFAULT true, deleted_at timestamptz, listing_kind text, canonical_vehicle_type text,
  primary_image_url text, sale_price integer, sale_status text, listing_location text);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY, vehicle_id uuid, source_platform text, source_url text,
  event_status text, started_at timestamptz, ended_at timestamptz, sold_at timestamptz, current_price numeric,
  final_price numeric, bid_count integer, metadata jsonb, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());
-- The photo gate. vehicle_images has the columns vehicle_card_images reads; vehicle_card_images is that function reduced to the
-- anonymous path (a public vehicle's primary photo that is not superseded, not sensitive and not hidden by the vision gate): the one
-- gated read of a card photo. The reader asks it; the fixtures decide what the gate shows.
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, image_url text, thumbnail_url text,
  medium_url text, variants jsonb, is_primary boolean DEFAULT false, is_superseded boolean, is_sensitive boolean NOT NULL DEFAULT false,
  vision_gate_status text, user_id uuid, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.vehicle_card_images(p_vehicle_ids uuid[])
RETURNS TABLE(vehicle_id uuid, thumbnail_url text, medium_url text, image_url text, variants jsonb, is_primary boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT ON (i.vehicle_id) i.vehicle_id, i.thumbnail_url, i.medium_url, i.image_url, i.variants, i.is_primary, i.created_at
  FROM unnest(p_vehicle_ids) u(id)
  JOIN public.vehicles v ON v.id = u.id AND v.is_public
  JOIN public.vehicle_images i ON i.vehicle_id = v.id
  WHERE i.is_primary AND i.is_superseded IS NOT TRUE AND NOT i.is_sensitive
    AND (i.vision_gate_status IS NULL OR i.vision_gate_status NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed'))
  ORDER BY i.vehicle_id, i.created_at
$$;
REVOKE ALL ON FUNCTION public.vehicle_card_images(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_card_images(uuid[]) TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.vid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.eid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN ASSERT ok IS TRUE, label; END $$;
CREATE FUNCTION pg_temp.fails(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RETURN; END;
  RAISE EXCEPTION 'expected a failure: %', label;
END $$;
CREATE FUNCTION pg_temp.runs(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '%: %', label, SQLERRM; END;
END $$;
-- The way a source writes a time and a day in its metadata.
CREATE FUNCTION pg_temp.iso(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') $$;
CREATE FUNCTION pg_temp.dayn(n integer) RETURNS text LANGUAGE sql STABLE AS $$ SELECT (current_date + n)::text $$;
-- The last second of a day, in UTC: where a date alone ends.
CREATE FUNCTION pg_temp.eod(n integer) RETURNS timestamptz LANGUAGE sql STABLE AS
  $$ SELECT ((current_date + n)::text || ' 23:59:59+00')::timestamptz $$;
-- Whole-second instants, so a fixture's clock survives the round trip through a string.
CREATE TEMP TABLE fx AS SELECT date_trunc('second', now() + interval '30 days') AS end30;
-- The holdings keys of the contract, and the sorted list of the keys an answer carries.
CREATE TEMP TABLE hk AS SELECT unnest(ARRAY['episodes', 'vehicles', 'active', 'upcoming', 'sold', 'ended', 'unknown', 'with_image',
  'archived', 'shown_n', 'shown_median', 'active_n', 'active_median', 'ended_n', 'ended_median', 'sold_n', 'sold_median', 'makes',
  'models', 'year_min', 'year_max', 'dated_min', 'dated_max', 'first_seen', 'last_seen', 'folded_at', 'landed_24h', 'last_landed',
  'board']) AS k;
CREATE FUNCTION pg_temp.hkeys(j jsonb) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(j -> 'holdings') k $$;

-- Sources. test_market is a marketplace with an organization; bulk_market has none (its display name is the name);
-- quiet_market is registered and holds nothing; test_market_saved is a capture channel of test_market; days_only and
-- bat_sellers_x are known to the Sources board only (a venue for sale that has an event but no registry row, and a cohort
-- of another venue's lots; the board writes days_only's name with a trailing parenthesis, as the registry does).
-- Not browsable, each with a public vehicle and events of its own: ghost_platform (no registry row), private_ledger
-- (owner_private), no_species_house (no species), media_site (media_forum_video), orphan_saved (a channel of a market
-- the registry does not have).
INSERT INTO public.organizations VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Test Market', 'https://nuke.ag/source-logos/test_market.png'),
  ('a0000000-0000-4000-8000-000000000002', 'Edge Org Ltd', 'https://nuke.ag/source-logos/edge_market.png');
INSERT INTO public.observation_sources (slug, display_name, category, species, base_url, business_id, market_slug, created_at) VALUES
  ('test_market_saved', 'Test Market Saved Items', 'marketplace', 'auth_walled_marketplace', NULL, NULL, 'test_market', '2025-01-01'),
  ('test_market', 'Test Market (feed)', 'marketplace', 'auth_walled_marketplace', 'https://test.example',
   'a0000000-0000-4000-8000-000000000001', NULL, '2025-02-01'),
  ('bulk_market', 'Bulk Market', 'auction', 'timed_auction', NULL, NULL, NULL, '2025-01-01'),
  ('quiet_market', 'Quiet Market', 'classifieds', 'classifieds', NULL, NULL, NULL, '2025-01-01'),
  ('other_market', 'Other Market', 'dealer', 'dealer', NULL, NULL, NULL, '2025-01-01'),
  ('rules_market', 'Rules Market', 'auction', 'block_house', NULL, NULL, NULL, '2025-01-01'),
  ('ebay_motors', 'Alias Market (feed)', 'marketplace', 'auth_walled_marketplace', NULL, NULL, NULL, '2025-01-01'),
  ('oldcaronline', 'Alias Classifieds', 'classifieds', 'classifieds', NULL, NULL, NULL, '2025-01-01'),
  ('chan_market', 'Chan Market', 'classifieds', 'classifieds', NULL, NULL, NULL, '2025-01-01'),
  ('chan_market_saved', 'Chan Market Saved', 'classifieds', 'classifieds', NULL, NULL, 'chan_market', '2025-01-01'),
  ('agg_site', 'Agg Site', 'aggregator', 'aggregator', NULL, NULL, NULL, '2025-01-01'),
  ('private_ledger', 'Private Ledger', 'owner', 'owner_private', 'https://private.example', NULL, NULL, '2025-01-01'),
  ('no_species_house', 'No Species House', 'auction', NULL, NULL, NULL, NULL, '2025-01-01'),
  ('media_site', 'Media Site', 'forum', 'media_forum_video', NULL, NULL, NULL, '2025-01-01'),
  ('orphan_saved', 'Orphan Saved', 'marketplace', 'auth_walled_marketplace', NULL, NULL, 'orphan_market', '2025-01-01'),
  -- two market-level rows that are one key (as cars_and_bids and cars-and-bids are in production), one without a species
  ('dup_market', 'Dup Market (old)', 'dealer', NULL, NULL, NULL, NULL, '2025-01-01'),
  ('dup-market', 'Dup Market', 'dealer', 'dealer', NULL, NULL, NULL, '2025-02-01'),
  -- edge_market: a classifieds site with an organization of another name, the home of the edge cases (keys, years, photos,
  -- places, addresses, bids); seller_reg: a registry row of a species the page never browses (private_seller)
  ('edge_market', 'Edge Market (feed.example)', 'classifieds', 'classifieds', NULL, 'a0000000-0000-4000-8000-000000000002', NULL, '2025-01-01'),
  ('seller_reg', 'Seller Reg', 'cohort', 'private_seller', NULL, NULL, NULL, '2025-01-01');
INSERT INTO public.market_source_days (day, source_slug, display_name, category, species, landed_lots, landed_at, population,
                                       population_method, population_confidence, population_at) VALUES
  (current_date, 'days_only', 'Days Only (venue.example)', 'auction', 'block_house', 55, now() - interval '2 hours', NULL, NULL, NULL, NULL),
  (current_date, 'bat_sellers_x', 'Sellers X', 'cohort', 'private_seller', 123, now() - interval '3 hours', NULL, NULL, NULL, NULL),
  (current_date - 3, 'test_market', 'Test Market', 'marketplace', NULL, 8000, now() - interval '3 days', NULL, NULL, NULL, NULL),
  (current_date, 'test_market', 'Test Market', 'marketplace', NULL, 9999, now() - interval '1 hour', 12000, 'owner_reference', 0.9,
   now() - interval '5 days'),
  (current_date, 'quiet_market', 'Quiet Market', 'classifieds', NULL, 77, now() - interval '4 hours', NULL, NULL, NULL, NULL),
  (current_date, 'private_ledger', 'Private Ledger', 'owner', NULL, 3, now() - interval '1 hour', NULL, NULL, NULL, NULL);

-- Vehicles. 1-7 are counted for test_market; 8-12 are not (non-public, non_vehicle_item, deleted, a motorcycle, no make);
-- 21-26 (sold), 31-35 (live), 41-45 (closed) Chargers and 51-54 Challengers are bulk_market's; 60-64 belong to the sources
-- that are not browsable; 70-83 are rules_market's Barracudas and 90-92 its Road Runners; 100-102 an aliased marketplace's and a classifieds
-- site's; 110-111 chan_market's. Make and model spelled two ways in 3 (FORD MUSTANG) and 6 (CHEVROLET CORVETTE).
INSERT INTO public.vehicles (id, year, make, model, trim, source, is_public, deleted_at, listing_kind, canonical_vehicle_type,
                             primary_image_url, sale_price, sale_status, listing_location) VALUES
  (pg_temp.vid(1),  1966, 'Ford', 'Mustang', 'GT', 'test_market', true, NULL, 'vehicle', 'CAR', 'https://img.test/v01.jpg', NULL, 'available', NULL),
  (pg_temp.vid(2),  1969, 'Ford', 'Mustang', 'Mach 1', 'test_market', true, NULL, 'vehicle', 'CAR', 'https://img.test/v02.jpg', 44500, 'sold', 'Reno, NV'),
  (pg_temp.vid(3),  1971, 'FORD', 'MUSTANG', NULL, 'test_market', true, NULL, 'vehicle', NULL, NULL, NULL, 'available', NULL),
  (pg_temp.vid(4),  1990, 'Ford', 'F-150', NULL, 'test_market', true, NULL, 'vehicle', 'TRUCK', 'https://img.test/v04.jpg', NULL, 'available', NULL),
  (pg_temp.vid(5),  1963, 'Chevrolet', 'Corvette', 'Sting Ray', 'test-market', true, NULL, 'vehicle', 'CAR', 'https://img.test/v05.jpg', 61000, 'sold', NULL),
  (pg_temp.vid(6),  1967, 'CHEVROLET', 'CORVETTE', NULL, 'other_market', true, NULL, 'vehicle', 'CAR', NULL, 77000, 'sold', NULL),
  (pg_temp.vid(7),  1973, 'Porsche', '911', NULL, 'test_market', true, NULL, 'vehicle', 'CAR', 'https://img.test/v07.jpg', NULL, 'available', NULL),
  (pg_temp.vid(8),  1980, 'Ford', 'Mustang', NULL, 'test_market', false, NULL, 'vehicle', 'CAR', NULL, NULL, 'available', NULL),
  (pg_temp.vid(9),  1981, 'Ford', 'Mustang', NULL, 'test_market', true, NULL, 'non_vehicle_item', 'CAR', NULL, NULL, 'available', NULL),
  (pg_temp.vid(10), 1982, 'Ford', 'Mustang', NULL, 'test_market', true, now(), 'vehicle', 'CAR', NULL, NULL, 'available', NULL),
  (pg_temp.vid(11), 1975, 'Honda', 'CB750', NULL, 'test_market', true, NULL, 'vehicle', 'MOTORCYCLE', NULL, NULL, 'available', NULL),
  (pg_temp.vid(12), 1976, NULL, 'Unknown', NULL, 'test_market', true, NULL, 'vehicle', 'CAR', NULL, NULL, 'available', NULL);
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, primary_image_url, sale_status)
  SELECT pg_temp.vid(20 + i), 1967 + i, 'Dodge', 'Charger', 'bulk_market', true, 'vehicle',
         CASE WHEN i % 2 = 0 THEN 'https://img.test/c' || i || '.jpg' END, 'available'
  FROM generate_series(1, 6) i;
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, sale_status)
  SELECT pg_temp.vid(n), 1970, 'Dodge', 'Charger', 'bulk_market', true, 'vehicle', 'available' FROM generate_series(31, 35) n UNION ALL
  SELECT pg_temp.vid(n), 1971, 'Dodge', 'Charger', 'bulk_market', true, 'vehicle', 'available' FROM generate_series(41, 45) n UNION ALL
  SELECT pg_temp.vid(n), 1972, 'Dodge', 'Challenger', 'bulk_market', true, 'vehicle', 'available' FROM generate_series(51, 54) n;
-- The sources that are not browsable, each with one public vehicle.
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, primary_image_url, sale_price, sale_status) VALUES
  (pg_temp.vid(60), 1969, 'Chevrolet', 'Camaro', 'ghost_platform', true, 'vehicle', 'https://img.test/g60.jpg', 33000, 'sold'),
  (pg_temp.vid(61), 1970, 'Pontiac', 'Firebird', 'private_ledger', true, 'vehicle', 'https://img.test/g61.jpg', 44000, 'sold'),
  (pg_temp.vid(62), 1971, 'Buick', 'Riviera', 'no_species_house', true, 'vehicle', 'https://img.test/g62.jpg', NULL, 'available'),
  (pg_temp.vid(63), 1972, 'Olds', 'Cutlass', 'media_site', true, 'vehicle', 'https://img.test/g63.jpg', NULL, 'available'),
  (pg_temp.vid(64), 1973, 'AMC', 'Javelin', 'orphan_saved', true, 'vehicle', 'https://img.test/g64.jpg', NULL, 'available');
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, primary_image_url, sale_status) VALUES
  (pg_temp.vid(65), 1962, 'Jaguar', 'E-Type', 'days_only', true, 'vehicle', 'https://img.test/g65.jpg', 'available'),
  (pg_temp.vid(66), 1985, 'Mazda', 'RX-7', 'dup_market', true, 'vehicle', NULL, 'available');
-- bulk_market's closed Challengers (130-133) and sold Challengers (140-143): four each, one short of the floor.
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, sale_status)
  SELECT pg_temp.vid(n), 1973, 'Dodge', 'Challenger', 'bulk_market', true, 'vehicle', 'available' FROM generate_series(130, 133) n UNION ALL
  SELECT pg_temp.vid(n), 1974, 'Dodge', 'Challenger', 'bulk_market', true, 'vehicle', 'available' FROM generate_series(140, 143) n;
-- rules_market: 14 Barracudas, one per status rule; 3 Road Runners that land in the opposite order to the dates they carry.
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, sale_status)
  SELECT pg_temp.vid(69 + i), 1970, 'Plymouth', 'Barracuda', 'rules_market', true, 'vehicle', 'available' FROM generate_series(1, 14) i;
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, sale_status)
  SELECT pg_temp.vid(89 + i), 1969, 'Plymouth', 'Road Runner', 'rules_market', true, 'vehicle', 'available' FROM generate_series(1, 3) i;
-- An aliased marketplace's two spellings, a classifieds site's www spelling, a channel and its market. v101's own source is the alias.
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, primary_image_url, sale_price, sale_status) VALUES
  (pg_temp.vid(100), 1975, 'Ford', 'Bronco', 'ebay_motors', true, 'vehicle', 'https://img.test/e100.jpg', NULL, 'available'),
  (pg_temp.vid(101), 1976, 'Ford', 'Bronco', 'ebay', true, 'vehicle', NULL, 30000, 'sold'),
  (pg_temp.vid(102), 1972, 'Datsun', '240Z', 'www.oldcaronline.com', true, 'vehicle', NULL, NULL, 'available'),
  (pg_temp.vid(110), 1964, 'Chevrolet', 'C10', 'chan_market', true, 'vehicle', NULL, NULL, 'available'),
  (pg_temp.vid(111), 1965, 'Chevrolet', 'C10', 'chan_market_saved', true, 'vehicle', NULL, NULL, 'available');

-- The gate's photo of every vehicle above that has an img.test address on its record (their photos are readable photos).
-- ALLOW_RAW_TESTIMONY_WRITE (synthetic fixture rows, disposable database)
INSERT INTO public.vehicle_images (vehicle_id, image_url, is_primary)
  SELECT id, primary_image_url, true FROM public.vehicles WHERE primary_image_url LIKE 'https://img.test/%';

-- edge_market, vehicles 150-197, by group (the make and model name the group):
--   Edge/Zed 150-152   one make and one model however it is spelled: 'Edge', 'Edge ' and ' Zed', 'EDGE' and 'zed'
--   153-157            never counted: make ' ', model '', model '   ', model NULL, and is_public NULL
--   Eras/Era 158-164   years 0, 9999, 1884, 1885, this year + 2, this year + 3, 2000: only 1885 to this year + 2 make a range
--   Imgs/Img 165-176   the photo address on the record: '', 'jpg', 'javascript:alert(1)' are no photo; a path, an upper-case web
--                      address and a storage address are; the gate shows a photo for 172 (thumbnail), 173 (medium), 174 (full)
--                      and none for 165-171 (no readable photo row; 171 is rejected), 175 (superseded) or 176 (sensitive)
--   Locs/Loc 177-185,  the source's own place text: an address with a phone number and an e-mail address, a city with a ZIP, a city
--   196-197            with a phone number, an e-mail address, 70 letters, a JSON object, the vehicle's own place beside junk,
--                      a line break, a plain city, and a street with a number of three and of four digits (not a ZIP)
--   Urls/Url 186-191   source addresses: an app pseudo-address, javascript:, an upper-case web address, one with a space, none,
--                      and a saved copy at an upper-case web address
--   Bids/Bid 192-194   a count that is a JSON number: too large for an integer, 12 beside a NULL column, 9 beside a column of 5
--   Edge/Seller 195    an event of the private_seller registry row seller_reg
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, canonical_vehicle_type, primary_image_url, sale_status) VALUES
  (pg_temp.vid(150), 1970, 'Edge',  'Zed',  'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(151), 1971, 'Edge ', ' Zed', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(152), 1972, 'EDGE',  'zed',  'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(153), 1973, ' ',     'Junk', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(154), 1974, 'Edge',  '',     'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(155), 1975, 'Edge',  '   ',  'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(156), 1976, 'Edge',  NULL,   'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(157), 1977, 'Edge',  'Zed',  'edge_market', NULL, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(158), 0,    'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(159), 9999, 'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(160), 1884, 'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(161), 1885, 'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(162), extract(year FROM now())::int + 2, 'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(163), extract(year FROM now())::int + 3, 'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(164), 2000, 'Eras', 'Era', 'edge_market', true, 'vehicle', 'CAR', NULL, 'available'),
  (pg_temp.vid(165), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', '', 'available'),
  (pg_temp.vid(166), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'jpg', 'available'),
  (pg_temp.vid(167), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'javascript:alert(1)', 'available'),
  (pg_temp.vid(168), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', '/img/e168.jpg', 'available'),
  (pg_temp.vid(169), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'HTTPS://img.test/E169.JPG', 'available'),
  (pg_temp.vid(170), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://store.example/storage/v1/object/public/vehicle-images/e170.jpg', 'available'),
  (pg_temp.vid(171), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://img.test/e171.jpg', 'available'),
  (pg_temp.vid(172), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://img.test/e172_old.jpg', 'available'),
  (pg_temp.vid(173), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://img.test/e173.jpg', 'available'),
  (pg_temp.vid(174), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://img.test/e174.jpg', 'available'),
  (pg_temp.vid(175), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://img.test/e175.jpg', 'available'),
  (pg_temp.vid(176), 1980, 'Imgs', 'Img', 'edge_market', true, 'vehicle', 'CAR', 'https://img.test/e176.jpg', 'available');
INSERT INTO public.vehicles (id, year, make, model, source, is_public, listing_kind, canonical_vehicle_type, sale_status, listing_location)
  SELECT pg_temp.vid(n), 1990, 'Locs', 'Loc', 'edge_market', true, 'vehicle', 'CAR', 'available',
         CASE WHEN n = 183 THEN 'Sparks, NV' END
  FROM generate_series(177, 185) n UNION ALL
  SELECT pg_temp.vid(n), 1990, 'Locs', 'Loc', 'edge_market', true, 'vehicle', 'CAR', 'available', NULL FROM generate_series(196, 197) n UNION ALL
  SELECT pg_temp.vid(n), 1991, 'Urls', 'Url', 'edge_market', true, 'vehicle', 'CAR', 'available', NULL FROM generate_series(186, 191) n UNION ALL
  SELECT pg_temp.vid(n), 1992, 'Bids', 'Bid', 'edge_market', true, 'vehicle', 'CAR', 'available', NULL FROM generate_series(192, 194) n UNION ALL
  SELECT pg_temp.vid(195), 1993, 'Edge', 'Seller', 'seller_reg', true, 'vehicle', 'CAR', 'available', NULL;
-- What the gate holds for the Img vehicles above (165-170 have no photo row at all; 170's record has a storage address).
-- ALLOW_RAW_TESTIMONY_WRITE (synthetic fixture rows, disposable database)
INSERT INTO public.vehicle_images (vehicle_id, image_url, thumbnail_url, medium_url, is_primary, is_superseded, is_sensitive, vision_gate_status) VALUES
  (pg_temp.vid(171), 'https://img.test/e171_f.jpg', NULL, NULL, true, NULL, false, 'rejected_personal'),
  (pg_temp.vid(172), 'https://img.test/e172_f.jpg', 'https://img.test/e172_t.jpg', 'https://img.test/e172_m.jpg', true, NULL, false, NULL),
  (pg_temp.vid(173), 'https://img.test/e173_f.jpg', NULL, 'https://img.test/e173_m.jpg', true, NULL, false, 'pending'),
  (pg_temp.vid(174), 'https://img.test/e174_f.jpg', NULL, NULL, true, NULL, false, NULL),
  (pg_temp.vid(175), 'https://img.test/e175_f.jpg', NULL, NULL, true, true, false, NULL),
  (pg_temp.vid(176), 'https://img.test/e176_f.jpg', NULL, NULL, true, NULL, true, NULL);

-- Episodes of test_market (platform spelled test_market or Test-Market: one source). Statuses, by hand:
--  1  v1 active, asks 30000 buy-it-now, ends 30 days from now in metadata, landed 23 h ago
--  2  v2 sold, shown 44000, final 45000, 12 bids, listed 17 d ago, ended 10 d ago (spelled Test-Market)
--  3  v3 ended, last bid 12000, ended 20 d ago, posted date and city in metadata
--  4  v4 bid-goes-on with a final price and a sold_at: a result, the lot did not sell, so ended, no sold price; landed 2 h ago
--  5  v5 ended 410 d ago and recorded 400 d ago, last bid 50000 (v5's first listing)
--  6  v5 sold, no price on the event; the vehicle row says sold 61000 and its source test-market is this source: 61000
--  7  v6 sold, no price on the event; the vehicle row says sold 77000 but its source is other_market: sold, no price
--  8  v7 unsold with a final price and a sold_at: the close, not a sale, so ended
--  9  v1 completed with a final price 28000: a word that says nothing, so the price reads it as sold; posted date is junk
-- 10  v4 pending, nothing else: unknown
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, started_at, ended_at, sold_at,
                                   current_price, final_price, bid_count, metadata, created_at) VALUES
  (pg_temp.eid(1),  pg_temp.vid(1), 'test_market', 'https://test.example/a1', 'active', NULL, NULL, NULL, 30000, NULL, 0,
   jsonb_build_object('price_kind', 'buy_it_now', 'listing_ends_at', pg_temp.iso((SELECT end30 FROM fx))), now() - interval '23 hours'),
  (pg_temp.eid(2),  pg_temp.vid(2), 'Test-Market', 'https://test.example/a2', 'sold', now() - interval '17 days', now() - interval '10 days',
   now() - interval '10 days', 44000, 45000, 12, '{"price_kind": "current_bid"}', now() - interval '30 days'),
  (pg_temp.eid(3),  pg_temp.vid(3), 'test_market', 'https://test.example/a3', 'ended', NULL, now() - interval '20 days', NULL, 12000, NULL, 3,
   '{"price_kind": "current_bid", "listing_posted_at": "2026-01-02T03:04:05.000Z", "location": "Elko, NV"}', now() - interval '40 days'),
  (pg_temp.eid(4),  pg_temp.vid(4), 'test_market', 'https://test.example/a4', 'bid-goes-on', NULL, NULL, now() - interval '3 days', NULL, 15000, NULL,
   NULL, now() - interval '2 hours'),
  (pg_temp.eid(5),  pg_temp.vid(5), 'test_market', 'https://test.example/a5', 'ended', NULL, now() - interval '410 days', NULL, 50000, NULL, 9,
   NULL, now() - interval '400 days'),
  (pg_temp.eid(6),  pg_temp.vid(5), 'Test-Market', 'https://test.example/a6', 'sold', NULL, now() - interval '100 days', NULL, NULL, NULL, NULL,
   NULL, now() - interval '100 days'),
  (pg_temp.eid(7),  pg_temp.vid(6), 'test_market', 'https://test.example/a7', 'sold', NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, now() - interval '50 days'),
  (pg_temp.eid(8),  pg_temp.vid(7), 'test_market', 'https://test.example/a8', 'unsold', NULL, now() - interval '5 days', now() - interval '5 days',
   NULL, 90000, NULL, NULL, now() - interval '5 days'),
  (pg_temp.eid(9),  pg_temp.vid(1), 'test_market', 'https://test.example/a9', 'completed', NULL, NULL, NULL, NULL, 28000, NULL,
   '{"listing_posted_at": "not a date"}', now() - interval '60 days'),
  (pg_temp.eid(10), pg_temp.vid(4), 'test_market', 'https://test.example/a10', 'pending', NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, now() - interval '70 days'),
  -- landed but not counted: a vehicle not public (recent: still a landed row), a non_vehicle_item, a deleted vehicle, a
  -- motorcycle, a vehicle with no make
  (pg_temp.eid(11), pg_temp.vid(8),  'test_market', 'https://test.example/x11', 'active', NULL, NULL, NULL, 1000, NULL, NULL, NULL, now() - interval '1 hour'),
  (pg_temp.eid(12), pg_temp.vid(9),  'test_market', 'https://test.example/x12', 'active', NULL, NULL, NULL, 1000, NULL, NULL, NULL, now() - interval '400 days'),
  (pg_temp.eid(13), pg_temp.vid(10), 'test_market', 'https://test.example/x13', 'active', NULL, NULL, NULL, 1000, NULL, NULL, NULL, now() - interval '400 days'),
  (pg_temp.eid(14), pg_temp.vid(11), 'test_market', 'https://test.example/x14', 'active', NULL, NULL, NULL, 1000, NULL, NULL, NULL, now() - interval '400 days'),
  (pg_temp.eid(15), pg_temp.vid(12), 'test_market', 'https://test.example/x15', 'active', NULL, NULL, NULL, 1000, NULL, NULL, NULL, now() - interval '400 days'),
  -- another source on one of the same vehicles (a dealer; touched a moment ago: alive with no end clock)
  (pg_temp.eid(16), pg_temp.vid(1),  'other_market', 'https://other.example/1', 'active', NULL, NULL, NULL, 31000, NULL, NULL, NULL, now() - interval '1 day');
-- Not browsable: each has an event on a public vehicle, and the registry says no (or nothing).
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, current_price, final_price, created_at) VALUES
  (pg_temp.eid(60), pg_temp.vid(60), 'ghost_platform',   'https://ghost.example/60',     'sold',   NULL, 33000, now() - interval '2 days'),
  (pg_temp.eid(61), pg_temp.vid(61), 'private_ledger',   'https://private.example/61',   'sold',   NULL, 44000, now() - interval '2 days'),
  (pg_temp.eid(62), pg_temp.vid(62), 'no_species_house', 'https://nospecies.example/62', 'active', 5000, NULL, now() - interval '2 hours'),
  (pg_temp.eid(63), pg_temp.vid(63), 'media_site',       'https://media.example/63',     'active', 6000, NULL, now() - interval '2 hours'),
  (pg_temp.eid(64), pg_temp.vid(64), 'orphan_saved',     'https://orphan.example/64',    'active', 7000, NULL, now() - interval '2 hours'),
  -- a venue only the Sources board knows: it has an event on a public vehicle, landed an hour ago, and no registry row
  (pg_temp.eid(65), pg_temp.vid(65), 'days_only',        'https://daysonly.example/65',  'active', 8000, NULL, now() - interval '1 hour');
-- two registry rows, one key, one of them without a species: browsable, and its event folds
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, current_price, created_at) VALUES
  (pg_temp.eid(66), pg_temp.vid(66), 'dup_market', 'https://dup.example/66', 'active', 4000, now() - interval '3 hours');
-- bulk_market: six sold Chargers (shown 11000, 21000, 31000, 41000, 51000 and none; final 10000 ... 50000, 70000), five
-- live Chargers asking 20000 ... 60000, five closed Chargers whose last bid was 1000 ... 5000, four live Challengers
-- asking 5000 ... 8000, four closed (last bids 1000 ... 4000) and four sold (100000 ... 130000)
-- Challengers: each a status one short of the floor.
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, current_price, final_price, created_at)
  SELECT pg_temp.eid(20 + i), pg_temp.vid(20 + i), 'bulk_market', 'https://bulk.example/' || i, 'sold',
         CASE WHEN i < 6 THEN i * 10000 + 1000 END, CASE WHEN i < 6 THEN i * 10000 ELSE 70000 END, now() - make_interval(days => i)
  FROM generate_series(1, 6) i;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, created_at)
  SELECT pg_temp.eid(30 + i), pg_temp.vid(30 + i), 'bulk_market', 'https://bulk.example/live' || i, 'active',
         now() + interval '2 days', (i + 1) * 10000, now() - interval '1 day'
  FROM generate_series(1, 5) i;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, created_at)
  SELECT pg_temp.eid(40 + i), pg_temp.vid(40 + i), 'bulk_market', 'https://bulk.example/closed' || i, 'ended',
         now() - interval '5 days', i * 1000, now() - interval '6 days'
  FROM generate_series(1, 5) i;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, created_at)
  SELECT pg_temp.eid(50 + i), pg_temp.vid(50 + i), 'bulk_market', 'https://bulk.example/chal' || i, 'active',
         now() + interval '1 day', (i + 4) * 1000, now() - interval '1 day'
  FROM generate_series(1, 4) i;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, created_at)
  SELECT pg_temp.eid(130 + i), pg_temp.vid(130 + i), 'bulk_market', 'https://bulk.example/chalclosed' || i, 'ended',
         now() - interval '4 days', (i + 1) * 1000, now() - interval '5 days'
  FROM generate_series(0, 3) i;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, current_price, final_price, created_at)
  SELECT pg_temp.eid(140 + i), pg_temp.vid(140 + i), 'bulk_market', 'https://bulk.example/chalsold' || i, 'sold',
         NULL, 100000 + i * 10000, now() - interval '7 days'
  FROM generate_series(0, 3) i;

-- ALLOW_RAW_TESTIMONY_WRITE (synthetic fixture rows, disposable database)
-- rules_market, Barracudas b01-b14 (events 70-83), one per status rule. The block house writes dates as days ("sale_ends_on")
-- and, for the lots of a sale, no ended_at. Expected statuses, by hand:
--  b01 bid-goes-on, final 20000, its sale ended 30 days ago        ended (a result), no sold price
--  b02 listed, its sale ended 5 days ago                           ended (a catalogued lot whose date has passed)
--  b03 active, last touched 200 days ago, no end clock             unknown
--  b04 active, touched 2 days ago, no end clock                    active (asks 8000)
--  b05 upcoming, the sale starts in 10 days and ends in 12         upcoming (not Live)
--  b06 upcoming, the sale started yesterday and ends in 2 days     active (it has begun)
--  b07 upcoming, its sale ended 3 days ago                         ended
--  b08 listed, no date at all, touched now                         unknown
--  b09 active, ended_at 3 days ahead                               active (asks 9000)
--  b10 active, ended_at an hour ago                                ended
--  b11 sold, sale 43-40 days ago (days only), recorded yesterday   sold; ends the last second of that day, listed its first
--  b12 sold, no date at all, recorded yesterday                    sold; no clock of its own
--  b13 active, dates that are not dates, touched 2 days ago        active (junk is no clock; asks 7000)
--  b14 listed, only an auction day, 5 days ahead                   active; ends the last second of that day
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, started_at, ended_at, sold_at,
                                   current_price, final_price, metadata, created_at, updated_at)
SELECT pg_temp.eid(69 + n), pg_temp.vid(69 + n), 'rules_market', 'https://rules.example/b' || lpad(n::text, 2, '0'), x.st,
       NULL, x.ended, NULL, x.cur, x.fin, x.meta, coalesce(x.created, now() - interval '2 days'), coalesce(x.upd, now())
FROM (VALUES
  (1,  'bid-goes-on', NULL::timestamptz, NULL::numeric, 20000::numeric, jsonb_build_object('sale_ends_on', pg_temp.dayn(-30)), NULL::timestamptz, NULL::timestamptz),
  (2,  'listed', NULL, NULL, NULL, jsonb_build_object('sale_starts_on', pg_temp.dayn(-8), 'sale_ends_on', pg_temp.dayn(-5)), NULL, NULL),
  (3,  'active', NULL, NULL, NULL, NULL, NULL, now() - interval '200 days'),
  (4,  'active', NULL, 8000, NULL, NULL, NULL, now() - interval '2 days'),
  (5,  'upcoming', NULL, NULL, NULL, jsonb_build_object('sale_starts_on', pg_temp.dayn(10), 'sale_ends_on', pg_temp.dayn(12)), NULL, NULL),
  (6,  'upcoming', NULL, NULL, NULL, jsonb_build_object('sale_starts_on', pg_temp.dayn(-1), 'sale_ends_on', pg_temp.dayn(2)), NULL, NULL),
  (7,  'upcoming', NULL, NULL, NULL, jsonb_build_object('sale_ends_on', pg_temp.dayn(-3)), NULL, NULL),
  (8,  'listed', NULL, NULL, NULL, NULL, NULL, NULL),
  (9,  'active', now() + interval '3 days', 9000, NULL, NULL, NULL, NULL),
  (10, 'active', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL),
  (11, 'sold', NULL, NULL, NULL, jsonb_build_object('sale_starts_on', pg_temp.dayn(-43), 'sale_ends_on', pg_temp.dayn(-40)), now() - interval '1 day', NULL),
  (12, 'sold', NULL, NULL, NULL, NULL, now() - interval '1 day', NULL),
  (13, 'active', NULL, 7000, NULL, jsonb_build_object('listing_ends_at', '2026-13-45 99:99', 'listing_posted_at', '2026-02-30T25:61:00Z'), NULL, now() - interval '2 days'),
  (14, 'listed', NULL, NULL, NULL, jsonb_build_object('auction_date', pg_temp.dayn(5)), NULL, NULL)
) x(n, st, ended, cur, fin, meta, created, upd);
-- Road Runners: recorded in the opposite order to the sale dates they carry (A sold 400 days ago and was recorded an hour ago, B
-- sold 30 days ago and was recorded 2 days ago, C carries no date and was recorded a minute ago).
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, final_price, metadata, created_at) VALUES
  (pg_temp.eid(90), pg_temp.vid(90), 'rules_market', 'https://rules.example/rr-a', 'sold', 15000,
   jsonb_build_object('sale_ends_on', pg_temp.dayn(-400)), now() - interval '1 hour'),
  (pg_temp.eid(91), pg_temp.vid(91), 'rules_market', 'https://rules.example/rr-b', 'sold', 18000,
   jsonb_build_object('sale_ends_on', pg_temp.dayn(-30)), now() - interval '2 days'),
  (pg_temp.eid(92), pg_temp.vid(92), 'rules_market', 'https://rules.example/rr-c', 'sold', 12000, NULL, now() - interval '1 minute');
-- An aliased marketplace's two spellings (the second is the board's alias), a classifieds site's www spelling, a channel and its market.
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, sold_at, current_price, metadata, created_at) VALUES
  (pg_temp.eid(100), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/100', 'active', NULL, 25000,
   jsonb_build_object('price_kind', 'buy_it_now', 'listing_ends_at', pg_temp.iso(now() + interval '5 days'),
                      'archive_url', 'https://web.archive.org/web/2010/https://alias.example/100'), now() - interval '3 hours'),
  (pg_temp.eid(101), pg_temp.vid(101), 'ebay', 'https://alias.example/101', 'sold', now() - interval '1 day', NULL,
   jsonb_build_object('archive_url', 'javascript:alert(1)'), now() - interval '2 hours'),
  (pg_temp.eid(102), pg_temp.vid(102), 'www.oldcaronline.com', 'https://www-alias.example/102', 'active', NULL, 12000, NULL, now() - interval '1 day'),
  (pg_temp.eid(110), pg_temp.vid(110), 'chan_market', 'https://chan.example/110', 'active', NULL, 9000, NULL, now() - interval '5 hours'),
  (pg_temp.eid(111), pg_temp.vid(111), 'chan_market_saved', 'https://chan.example/111', 'active', NULL, 9500, NULL, now() - interval '4 hours');
-- ALLOW_RAW_TESTIMONY_WRITE (synthetic fixture rows, disposable database)
-- The aliased marketplace's ended auctions, all on v100 (the Bronco with a photo), recorded 3-5 days ago (none landed in the last 24 h).
-- What the reader shows of bids and of the price label, by hand:
--  103  ended 6 d ago, last bid 15500, bid_count 0 in the column and 7 (a JSON number: how the source writes it) in metadata,
--       label "Current bid"                                                                                     bids 7, no label
--  104  ended 9 d ago, last bid 9000, bid_count 0, no count in metadata, label "Starting bid"               bids 0, Starting bid
--  105  reserve_not_met 7 d ago, last bid 21000, bid_count 3, metadata count "many"                        bids 3, no label
--  106  ended, listed 30 d ago and no end, last bid 4000, bid_count 0, label " starting bid "               bids 0, Starting bid
--  107  ended, last bid 5000, bid_count 0, metadata count "many"                                            bids 0 and no error
--  108  ended, last bid 6000, bid_count 0, metadata count "99999999999" (too large for an integer)          bids 0 and no error
--  109  ended, last bid 7000, bid_count NULL, metadata count "4" (a string: some captures write it so)    bids 4
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, started_at, ended_at, current_price,
                                   bid_count, metadata, created_at) VALUES
  (pg_temp.eid(103), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/103', 'ended', NULL, now() - interval '6 days', 15500, 0,
   '{"price_kind": "current_bid", "bid_count": 7, "end_state": {"price_label": "Current bid"}}', now() - interval '5 days'),
  (pg_temp.eid(104), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/104', 'ended', NULL, now() - interval '9 days', 9000, 0,
   '{"price_kind": "current_bid", "end_state": {"price_label": "Starting bid"}}', now() - interval '4 days'),
  (pg_temp.eid(105), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/105', 'reserve_not_met', NULL, now() - interval '7 days', 21000, 3,
   '{"price_kind": "current_bid", "bid_count": "many"}', now() - interval '3 days'),
  (pg_temp.eid(106), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/106', 'ended', now() - interval '30 days', NULL, 4000, 0,
   '{"price_kind": "current_bid", "end_state": {"price_label": " starting bid "}}', now() - interval '3 days'),
  (pg_temp.eid(107), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/107', 'ended', NULL, NULL, 5000, 0,
   '{"bid_count": "many"}', now() - interval '3 days'),
  (pg_temp.eid(108), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/108', 'ended', NULL, NULL, 6000, 0,
   '{"bid_count": "99999999999"}', now() - interval '3 days'),
  (pg_temp.eid(109), pg_temp.vid(100), 'ebay_motors', 'https://alias.example/109', 'ended', NULL, NULL, 7000, NULL,
   '{"bid_count": "4"}', now() - interval '3 days');

-- edge_market's events, one per vehicle above (150-197), all ended 10 days ago and recorded and written 3 days ago, so none lands
-- in the last 24 hours; the groups that need more say so.
-- ALLOW_RAW_TESTIMONY_WRITE (synthetic fixture rows, disposable database)
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, bid_count, metadata,
                                   created_at, updated_at)
  SELECT pg_temp.eid(n), pg_temp.vid(n), 'edge_market', 'https://edge.example/e' || n, 'ended', now() - interval '10 days', 1000 + n,
         NULL::integer, NULL::jsonb, now() - interval '3 days', now() - interval '3 days'
  FROM generate_series(150, 176) n;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, bid_count, metadata,
                                   created_at, updated_at)
  SELECT pg_temp.eid(x.n), pg_temp.vid(x.n), 'edge_market', 'https://edge.example/e' || x.n, 'ended', now() - interval '10 days', 1000 + x.n,
         NULL, jsonb_build_object('location', x.loc), now() - interval '3 days', now() - interval '3 days'
  FROM (VALUES
    (177, to_jsonb('1234 Main St. Reno, NV 89501 Call Joe 702-555-0100 joe@example.com'::text)),
    (178, to_jsonb('Reno, NV 89501'::text)),
    (179, to_jsonb('Reno, NV 702-555-0100'::text)),
    (180, to_jsonb('joe@example.com'::text)),
    (181, to_jsonb(repeat('a', 70))),
    (182, '{"city": "Reno"}'::jsonb),
    (183, to_jsonb('1234 Main St. Call 702-555-0100'::text)),
    (184, to_jsonb(E'Reno,\nNV'::text)),
    (185, to_jsonb('Elko, NV'::text)),
    (196, to_jsonb('Elm Street 123'::text)),
    (197, to_jsonb('Elm Street 1234'::text))) x(n, loc);
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, ended_at, current_price, bid_count, metadata,
                                   created_at, updated_at) VALUES
  (pg_temp.eid(186), pg_temp.vid(186), 'edge_market', 'app://event/1/2 Ford Bronco', 'ended', now() - interval '10 days', 1186, NULL, NULL,
   now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(187), pg_temp.vid(187), 'edge_market', 'javascript:alert(1)', 'ended', now() - interval '10 days', 1187, NULL, NULL,
   now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(188), pg_temp.vid(188), 'edge_market', 'HTTPS://edge.example/u188', 'ended', now() - interval '10 days', 1188, NULL, NULL,
   now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(189), pg_temp.vid(189), 'edge_market', 'https://edge.example/with space', 'ended', now() - interval '10 days', 1189, NULL, NULL,
   now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(190), pg_temp.vid(190), 'edge_market', NULL, 'ended', now() - interval '10 days', 1190, NULL, NULL,
   now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(191), pg_temp.vid(191), 'edge_market', 'https://edge.example/u191', 'ended', now() - interval '10 days', 1191, NULL,
   jsonb_build_object('archive_url', 'HTTPS://WEB.ARCHIVE.ORG/web/2011/https://edge.example/u191'), now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(192), pg_temp.vid(192), 'edge_market', 'https://edge.example/e192', 'ended', now() - interval '10 days', 1192, 0,
   jsonb_build_object('bid_count', 2147483648), now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(193), pg_temp.vid(193), 'edge_market', 'https://edge.example/e193', 'ended', now() - interval '10 days', 1193, NULL,
   jsonb_build_object('bid_count', 12), now() - interval '4 days', now() - interval '3 days'),
  (pg_temp.eid(194), pg_temp.vid(194), 'edge_market', 'https://edge.example/e194', 'ended', now() - interval '10 days', 1194, 5,
   jsonb_build_object('bid_count', 9), now() - interval '3 days', now() - interval '3 days'),
  (pg_temp.eid(195), pg_temp.vid(195), 'seller_reg', 'https://seller.example/195', 'ended', now() - interval '10 days', 1195, NULL, NULL,
   now() - interval '3 days', now() - interval '3 days');

-- By hand, test_market: 10 episodes on 7 vehicles (v1 twice, v4 twice, v5 twice; v1 also on other_market, not counted here).
--   active 1 (1), sold 4 (2, 6, 7, 9), ended 4 (3, 4, 5, 8), unknown 1 (10), upcoming 0. With a photo: v1 v2 v4 v5 v7 = 5 of 7.
--   asks of the live (current_price > 0 on active): 30000 = 1.  last bids of the closed: 12000 (3), 50000 (5) = 2.
--   sold prices: 45000 (2), 61000 (6, the vehicle's), 28000 (9) = 3; episode 7 is sold without a price. Years 1963-1990.
--   makes: Ford 6 episodes / 4 vehicles, Chevrolet 3 / 2, Porsche 1 / 1.  models: Mustang 4, F-150 2, Corvette 3, 911 1.
--   landed in 24 h (rows, public or not): 1 (23 h), 4 (2 h), 11 (1 h, a vehicle not public) = 3.
--   saved copies: none. Dated (the source's own clock, end else start): episodes 1 (ends 30 days ahead), 2, 3, 5, 6 and 8; the
--   others carry none. Earliest: v5's end, 410 days back (it was recorded 400 days back); latest: the live lot's end, end30.
SELECT pg_temp.check((SELECT count(*) = 16 + 6 + 28 + 14 + 3 + 5 + 1 + 7 + 48 FROM public.vehicle_events),
  'fixture: 128 events (16 test_market and other_market, 6 not browsable, 28 bulk_market, 14 Barracudas, 3 Road Runners, 5 others, 1 duplicate-key, 7 ended auctions, 48 edge_market and seller_reg)');

-- The migration applies twice and leaves the views empty: the deploy role cannot fill them inside its 10 s.
\ir ../migrations/20261021193000_source_holdings_fold.sql
\ir ../migrations/20261021193000_source_holdings_fold.sql

SELECT pg_temp.check((SELECT bool_and(NOT relispopulated) AND count(*) = 2 FROM pg_class
                      WHERE oid IN ('public.mv_source_episodes'::regclass, 'public.mv_source_holdings'::regclass)),
  'both views start unpopulated');
SELECT pg_temp.check(to_regprocedure('public.safe_to_timestamptz(text)') IS NULL,
  'the migration needs no exception-block helper: this database has no safe_to_timestamptz and the fold works without it');

-- Not folded: the source is named, nothing is counted, every key is there; the board's own count is already there to read.
CREATE TEMP TABLE nf AS SELECT public.browse_source_read('test_market') AS j;
SELECT pg_temp.check((SELECT j->>'status' = 'not_folded' AND j->>'level' = 'makes' AND j->'median_floor' = '5'
  AND j->'source'->>'name' = 'Test Market' AND j->'holdings'->'episodes' = '0' AND j->'holdings'->'folded_at' = 'null'
  AND j->'makes' = '[]' AND j->'models' = '[]' AND j->'listings'->'rows' = '[]' AND j->'listings'->'total' = '0' FROM nf),
  'before the first fill: not_folded, with the source block and empty arrays');
SELECT pg_temp.check((SELECT j->'holdings'->'board'->>'lots' = '9999' AND j->'holdings'->'board'->>'day' = current_date::text
  AND j->'holdings'->'board'->>'population' = '12000' AND j->'holdings'->'board'->>'population_method' = 'owner_reference'
  AND (j->'holdings'->'board'->>'population_confidence')::numeric = 0.9 FROM nf),
  'the board''s own count for the source rides along: its latest day, not the older one');
SELECT pg_temp.check((SELECT j->'holdings'->'archived' IS NOT DISTINCT FROM '0'::jsonb AND j->'holdings'->'dated_min' IS NOT DISTINCT FROM 'null'::jsonb
  AND j->'holdings'->'dated_max' IS NOT DISTINCT FROM 'null'::jsonb FROM nf),
  'before the first fill: no saved copy is counted and there is no dated range, as 0 and null, not as missing keys');
-- The registry decides, not the fold: a slug that is not a browsable source is unknown_source even before the first fill, and
-- nothing of it is named.
SELECT pg_temp.check((SELECT public.browse_source_read('no-such-source')->>'status' = 'unknown_source'),
  'an unknown slug before the first fill is unknown_source');
SELECT pg_temp.check((SELECT j->>'status' = 'unknown_source' AND j->'source' = '{"slug": "private_ledger", "name": "private_ledger", "unit": "listings held", "category": null, "species": null, "base_url": null, "logo_url": null, "species_label": null}'::jsonb
  AND j->'holdings'->'episodes' = '0' AND j->'holdings'->'board' = 'null' AND j->'makes' = '[]'
  FROM (SELECT public.browse_source_read('private_ledger') AS j) x),
  'an owner_private source is unknown_source and is not named: no category, species, base_url, no board count');
SELECT pg_temp.check((SELECT public.browse_source_read('test_market', 'Ford', 'Mustang')->>'level' = 'listings'), 'not_folded keeps the level asked for');

-- The first fill is a plain refresh; the next is concurrent.
--   episodes: test_market 10, other_market 1, bulk_market 28, rules_market 17, the aliased marketplace 9, the www-spelled classifieds
--   site 1, chan_market 2, dup-market 1, edge_market 42 = 111
--   holdings rows (source + makes + models): 8 + 3 + 4 + 4 + 3 + 3 + 3 + 3 + 13 = 44 (the seven ended auctions are on v100: no new make or
--   model; edge_market has 6 makes and 6 models)
CREATE TEMP TABLE fill1 AS SELECT public.source_holdings_refresh() AS j;
SELECT pg_temp.check((SELECT NOT (j->>'concurrent')::boolean AND (j->>'episodes')::int = 111 AND (j->>'rows')::int = 44
  AND (j->>'seconds')::numeric >= 0 AND (j->>'refreshed_at')::timestamptz IS NOT NULL FROM fill1),
  'first fill: plain, 111 episodes, 44 holdings rows (the six sources that are not browsable, the private_seller row and the vehicles that cannot be listed add none)');
CREATE TEMP TABLE fill2 AS SELECT public.source_holdings_refresh() AS j;
SELECT pg_temp.check((SELECT (j->>'concurrent')::boolean AND (j->>'episodes')::int = 111 AND (j->>'rows')::int = 44 FROM fill2),
  'second fill: concurrent, the same rows');
REFRESH MATERIALIZED VIEW public.mv_source_episodes;
REFRESH MATERIALIZED VIEW public.mv_source_holdings;

-- The fold may be planned in parallel (production's session allows workers): a parallel worker cannot start a subtransaction,
-- so nothing the fold calls may use an exception block, or a worker silently returns NULL (the production helper
-- safe_to_timestamptz did that for 992 of 11,214 real rows). The fold gives the same rows with a Gather forced over it.
CREATE TEMP TABLE fold_serial AS
  SELECT event_id, vehicle_id, nslug, platform, make_key, model_key, year, status, status_raw, shown_price, sold_price,
         has_image, has_archive, created_at, ends_at, happened_at FROM public.mv_source_episodes;
SET debug_parallel_query = on;
SET parallel_setup_cost = 0;
SET parallel_tuple_cost = 0;
SET min_parallel_table_scan_size = 0;
SET max_parallel_workers_per_gather = 2;
REFRESH MATERIALIZED VIEW public.mv_source_episodes;
RESET debug_parallel_query;
RESET parallel_setup_cost;
RESET parallel_tuple_cost;
RESET min_parallel_table_scan_size;
RESET max_parallel_workers_per_gather;
SELECT pg_temp.check((SELECT count(*) = 0 FROM (
    (SELECT * FROM fold_serial EXCEPT SELECT event_id, vehicle_id, nslug, platform, make_key, model_key, year, status, status_raw, shown_price,
        sold_price, has_image, has_archive, created_at, ends_at, happened_at FROM public.mv_source_episodes)
    UNION ALL
    (SELECT event_id, vehicle_id, nslug, platform, make_key, model_key, year, status, status_raw, shown_price,
        sold_price, has_image, has_archive, created_at, ends_at, happened_at FROM public.mv_source_episodes EXCEPT SELECT * FROM fold_serial)) d)
  AND (SELECT count(*) FROM public.mv_source_episodes) = (SELECT count(*) FROM fold_serial),
  'the fold gives the same rows with a parallel plan forced as without');

-- The registry gate: a platform that is unregistered, owner_private, without a species, a media source, or a channel of a
-- market the registry lacks, never enters the fold, whatever its vehicle and its price.
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM public.mv_source_episodes
  WHERE platform IN ('ghost_platform', 'private_ledger', 'no_species_house', 'media_site', 'orphan_saved', 'days_only', 'seller_reg')
     OR vehicle_id = ANY (SELECT pg_temp.vid(n) FROM generate_series(60, 65) n) OR vehicle_id = pg_temp.vid(195))
  AND NOT EXISTS (SELECT 1 FROM public.mv_source_holdings WHERE nslug IN ('ghostplatform', 'privateledger', 'nospecieshouse',
                                                                        'mediasite', 'orphanmarket', 'orphansaved', 'daysonly', 'sellerreg'))),
  'unregistered, owner_private, private_seller, no-species, media, orphan-channel and board-only platforms are absent from the fold');
SELECT pg_temp.check((SELECT episodes = 1 AND source_slugs = ARRAY['dup_market'] FROM public.mv_source_holdings WHERE nslug = 'dupmarket' AND level = 0),
  'two market-level registry rows that are one key are one browsable source, whichever has the species');
SELECT pg_temp.check((SELECT count(*) = 111 AND count(DISTINCT nslug) = 9 FROM public.mv_source_episodes),
  'nine browsable source keys, 111 episodes: spellings and channels fold into their market');

-- The episodes: status, prices, keys.
SELECT pg_temp.check((SELECT array_agg(status ORDER BY event_id) = ARRAY['active', 'sold', 'ended', 'ended', 'ended', 'sold', 'sold', 'ended', 'sold', 'unknown']
  FROM public.mv_source_episodes WHERE nslug = 'testmarket'),
  'statuses: the source''s word first (bid-goes-on is ended), a final price only where the word says nothing');
SELECT pg_temp.check((SELECT array_agg(coalesce(sold_price::text, '-') ORDER BY event_id) = ARRAY['-', '45000', '-', '-', '-', '61000', '-', '-', '28000', '-']
  FROM public.mv_source_episodes WHERE nslug = 'testmarket'),
  'sold prices only on sold episodes: the event''s, else the vehicle''s when its source is this one (not v6''s other_market)');
SELECT pg_temp.check((SELECT (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(source_slugs) x) = ARRAY['Test-Market', 'test_market']
  FROM public.mv_source_holdings WHERE nslug = 'testmarket' AND level = 0), 'the source row remembers both platform spellings');

-- One key: a channel is its market, an alias spelling is its market, www.<name>.com is <name>; a vehicle whose own source is a spelling
-- of this source carries this source's sold price.
SELECT pg_temp.check((SELECT (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(source_slugs) x) = ARRAY['chan_market', 'chan_market_saved']
  AND episodes = 2 FROM public.mv_source_holdings WHERE nslug = 'chanmarket' AND level = 0),
  'a capture channel''s events are its market''s');
SELECT pg_temp.check((SELECT (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(source_slugs) x) = ARRAY['ebay', 'ebay_motors']
  AND episodes = 9 FROM public.mv_source_holdings WHERE nslug = 'ebaymotors' AND level = 0), 'an alias spelling is its market');
SELECT pg_temp.check((SELECT episodes = 1 AND source_slugs = ARRAY['www.oldcaronline.com'] FROM public.mv_source_holdings
  WHERE nslug = 'oldcaronline' AND level = 0), 'www.<name>.com is <name>');
SELECT pg_temp.check((SELECT sold_price = 30000 FROM public.mv_source_episodes WHERE event_id = pg_temp.eid(101)),
  'the vehicle''s sale price counts when its own source is a spelling of this source (an alias spelling on its market)');
SELECT pg_temp.check((SELECT count(*) FILTER (WHERE has_archive IS TRUE) = 2
  AND bool_and((has_archive IS TRUE) = (event_id IN (pg_temp.eid(100), pg_temp.eid(191))))
  FROM public.mv_source_episodes),
  'an episode has a saved copy only when its address is http or https, in any case: the two with a web address, and none of the other 109 (the javascript: address included)');

-- The status rules (rules_market, Barracudas b01-b14): the end clock decides what is alive.
SELECT pg_temp.check((SELECT array_agg(status ORDER BY event_id) = ARRAY['ended', 'ended', 'unknown', 'active', 'upcoming', 'active',
                                                                         'ended', 'unknown', 'active', 'ended', 'sold', 'sold', 'active', 'active']
  FROM public.mv_source_episodes WHERE event_id = ANY (SELECT pg_temp.eid(69 + n) FROM generate_series(1, 14) n)),
  'bid-goes-on is ended; listed or upcoming with a past sale is ended; active with no end clock and 200 idle days is unknown; '
  'an upcoming sale ahead is upcoming, one begun is active; a past ended_at is ended; junk dates are no clock');
SELECT pg_temp.check((SELECT bool_and(sold_price IS NULL) FROM public.mv_source_episodes
  WHERE event_id = ANY (SELECT pg_temp.eid(69 + n) FROM generate_series(1, 14) n)),
  'a bid-goes-on with a final price has no sold price; the two sold lots carry none');
-- Clocks: the source's own, never the landing day.
SELECT pg_temp.check((SELECT ends_at = pg_temp.eod(-40) AND happened_at = ends_at FROM public.mv_source_episodes WHERE event_id = pg_temp.eid(80)),
  'a block house''s sale day alone is the end of that day (b11), and the sort clock');
SELECT pg_temp.check((SELECT ends_at IS NULL AND happened_at IS NULL FROM public.mv_source_episodes WHERE event_id = pg_temp.eid(81)),
  'no date at all is no clock, not the landing day (b12)');
SELECT pg_temp.check((SELECT ends_at IS NULL AND happened_at IS NULL FROM public.mv_source_episodes WHERE event_id = pg_temp.eid(82)),
  'strings that are not dates are no clock (b13)');
SELECT pg_temp.check((SELECT ends_at = pg_temp.eod(5) FROM public.mv_source_episodes WHERE event_id = pg_temp.eid(83)),
  'an auction day alone ends the last second of that day (b14)');
SELECT pg_temp.check((SELECT array_agg(happened_at IS NOT DISTINCT FROM x ORDER BY event_id) = ARRAY[true, true, true]
  FROM public.mv_source_episodes e JOIN (VALUES (pg_temp.eid(90), pg_temp.eod(-400)), (pg_temp.eid(91), pg_temp.eod(-30)),
                                                (pg_temp.eid(92), NULL::timestamptz)) v(id, x) ON v.id = e.event_id),
  'the Road Runners carry their sale days (and one carries none), not the day they landed');


-- The source, by hand.
CREATE TEMP TABLE r_src AS SELECT public.browse_source_read('test_market') AS j;
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND j->>'level' = 'makes' AND j->'median_floor' = '5' FROM r_src), 'status ok, level makes, median floor 5');
SELECT pg_temp.check((SELECT j->'source' = jsonb_build_object('slug', 'test_market', 'name', 'Test Market', 'category', 'marketplace',
  'species', 'auth_walled_marketplace', 'species_label', 'Auth-walled marketplaces', 'unit', 'listings held',
  'logo_url', 'https://nuke.ag/source-logos/test_market.png', 'base_url', 'https://test.example') FROM r_src),
  'the market''s own registration, not its capture channel; the organization''s name and logo; the species'' unit');
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 10 AND (j->'holdings'->>'vehicles')::int = 7
  AND (j->'holdings'->>'active')::int = 1 AND (j->'holdings'->>'upcoming')::int = 0 AND (j->'holdings'->>'sold')::int = 4
  AND (j->'holdings'->>'ended')::int = 4 AND (j->'holdings'->>'unknown')::int = 1 AND (j->'holdings'->>'with_image')::int = 5
  AND (j->'holdings'->>'makes')::int = 3 AND (j->'holdings'->>'models')::int = 4
  AND (j->'holdings'->>'year_min')::int = 1963 AND (j->'holdings'->>'year_max')::int = 1990 FROM r_src),
  'holdings: 10 episodes on 7 vehicles, 1 active, 0 upcoming, 4 sold, 4 ended, 1 unknown, 5 with a photo, 3 makes, 4 models, 1963-1990');
SELECT pg_temp.check((SELECT (j->'holdings'->>'active')::int + (j->'holdings'->>'upcoming')::int + (j->'holdings'->>'sold')::int
  + (j->'holdings'->>'ended')::int + (j->'holdings'->>'unknown')::int = (j->'holdings'->>'episodes')::int FROM r_src),
  'the statuses add up to the episodes');
SELECT pg_temp.check((SELECT (j->'holdings'->>'active_n')::int = 1 AND jsonb_typeof(j->'holdings'->'active_median') = 'null'
  AND (j->'holdings'->>'ended_n')::int = 2 AND jsonb_typeof(j->'holdings'->'ended_median') = 'null'
  AND (j->'holdings'->>'sold_n')::int = 3 AND jsonb_typeof(j->'holdings'->'sold_median') = 'null'
  AND (j->'holdings'->>'shown_n')::int = 1 AND jsonb_typeof(j->'holdings'->'shown_median') = 'null' FROM r_src),
  'under five prices there is no median, per status: 1 ask of the live, 2 last bids of the closed, 3 sold prices; shown_* are the live asks only');
SELECT pg_temp.check((SELECT jsonb_typeof(j->'holdings'->'episodes') = 'number' AND jsonb_typeof(j->'holdings'->'shown_n') = 'number'
  AND jsonb_typeof(j->'holdings'->'landed_24h') = 'number' AND jsonb_typeof(j->'as_of') = 'string' FROM r_src), 'numbers are numbers');
SELECT pg_temp.check((SELECT (j->'holdings'->>'first_seen')::timestamptz = (SELECT min(created_at) FROM public.vehicle_events WHERE id = ANY (SELECT pg_temp.eid(i) FROM generate_series(1, 10) i))
  AND (j->'holdings'->>'last_seen')::timestamptz = (SELECT max(created_at) FROM public.vehicle_events WHERE id = ANY (SELECT pg_temp.eid(i) FROM generate_series(1, 10) i))
  AND (j->'holdings'->>'folded_at')::timestamptz = (SELECT folded_at FROM public.mv_source_holdings WHERE nslug = 'testmarket' AND level = 0) FROM r_src),
  'first and last landing of the counted episodes; the fold''s clock');
SELECT pg_temp.check((SELECT (j->'holdings'->>'archived')::int = 0 AND jsonb_typeof(j->'holdings'->'archived') = 'number'
  AND jsonb_typeof(j->'holdings'->'dated_min') = 'string' AND jsonb_typeof(j->'holdings'->'dated_max') = 'string'
  AND (j->'holdings'->>'dated_min')::timestamptz = (SELECT min(ended_at) FROM public.vehicle_events WHERE id = ANY (SELECT pg_temp.eid(i) FROM generate_series(1, 10) i))
  AND (j->'holdings'->>'dated_min')::timestamptz = (SELECT ended_at FROM public.vehicle_events WHERE id = pg_temp.eid(5))
  AND (j->'holdings'->>'dated_max')::timestamptz = (SELECT end30 FROM fx)
  AND (j->'holdings'->>'dated_min')::timestamptz < (j->'holdings'->>'first_seen')::timestamptz
  AND (j->'holdings'->>'dated_max')::timestamptz > (j->'holdings'->>'last_seen')::timestamptz FROM r_src),
  'holdings of test_market: no saved copy; dated from v5''s end (410 days back) to the live lot''s end (30 days ahead), the source''s own clocks and not the landing days');
SELECT pg_temp.check((SELECT (j->'holdings'->>'landed_24h')::int = 3
  AND (j->'holdings'->>'last_landed')::timestamptz = (SELECT max(created_at) FROM public.vehicle_events WHERE source_platform IN ('test_market', 'Test-Market')) FROM r_src),
  'landing is live and counts every row the source landed: 3 in 24 h (one on a vehicle not public); last landed is the newest');
SELECT pg_temp.check((SELECT (j - 'as_of') = (public.browse_source_read('  TEST-market ') - 'as_of') FROM r_src),
  'a slug in another spelling is the same source');
SELECT pg_temp.check((SELECT (j - 'as_of') = (public.browse_source_read('test_market_saved') - 'as_of') FROM r_src),
  'a capture channel asked for by its own slug is its market');
SELECT pg_temp.check((SELECT j->'holdings'->'board' = jsonb_build_object('day', current_date, 'lots', 9999, 'landed_at',
    (SELECT landed_at FROM public.market_source_days WHERE source_slug = 'test_market' AND day = current_date), 'population', 12000,
    'population_method', 'owner_reference', 'population_confidence', 0.9, 'population_at',
    (SELECT population_at FROM public.market_source_days WHERE source_slug = 'test_market' AND day = current_date)) FROM r_src),
  'the board''s count rides along with its day, population and method');
SELECT pg_temp.check((SELECT jsonb_typeof(j->'holdings'->'board') = 'null'
  FROM (SELECT public.browse_source_read('bulk_market') AS j) x), 'a source the board has no row for has no board count');

-- Makes level: every make, episodes desc, three top models, one make however it is spelled.
SELECT pg_temp.check((SELECT jsonb_array_length(j->'makes') = 3 AND j->'models' = '[]' AND j->'listings'->'rows' = '[]' FROM r_src), 'three makes; the other levels are empty');
SELECT pg_temp.check((SELECT array_agg(e->>'make' ORDER BY o) = ARRAY['Ford', 'Chevrolet', 'Porsche']
  AND array_agg((e->>'episodes')::int ORDER BY o) = ARRAY[6, 3, 1]
  FROM r_src, jsonb_array_elements(j->'makes') WITH ORDINALITY a(e, o)), 'makes by episodes: Ford 6, Chevrolet 3 (CHEVROLET folded in), Porsche 1');
SELECT pg_temp.check((SELECT e = jsonb_build_object('make', 'Ford', 'episodes', 6, 'vehicles', 4, 'active', 1, 'upcoming', 0, 'sold', 2,
    'ended', 2, 'shown_n', 1, 'shown_median', NULL, 'active_n', 1, 'active_median', NULL, 'ended_n', 1, 'ended_median', NULL,
    'sold_n', 2, 'sold_median', NULL, 'with_image', 3, 'year_min', 1966, 'year_max', 1990,
    'top_models', jsonb_build_array(jsonb_build_object('model', 'Mustang', 'episodes', 4), jsonb_build_object('model', 'F-150', 'episodes', 2)))
  FROM r_src, jsonb_array_elements(j->'makes') e WHERE e->>'make' = 'Ford'), 'the Ford row, by hand, with its top models');
SELECT pg_temp.check((SELECT e->'top_models' = jsonb_build_array(jsonb_build_object('model', 'Corvette', 'episodes', 3))
  AND (e->>'sold')::int = 2 AND (e->>'ended')::int = 1 AND (e->>'sold_n')::int = 1 AND (e->>'ended_n')::int = 1
  AND (e->>'active_n')::int = 0 AND (e->>'with_image')::int = 1
  FROM r_src, jsonb_array_elements(j->'makes') e WHERE e->>'make' = 'Chevrolet'),
  'Chevrolet: Corvette and CORVETTE are one model; 2 sold, 1 ended, 1 sold price, 1 last bid');

-- Models level.
CREATE TEMP TABLE r_models AS SELECT public.browse_source_read('test_market', 'FORD') AS j;
SELECT pg_temp.check((SELECT j->>'level' = 'models' AND j->'scope' = '{"make": "Ford", "model": null, "status": null}'
  AND j->'makes' = '[]' AND jsonb_array_length(j->'models') = 2 FROM r_models), 'a make in any case: its models, the scope in the fold''s spelling');
SELECT pg_temp.check((SELECT j->'models'->0 = jsonb_build_object('model', 'Mustang', 'episodes', 4, 'vehicles', 3, 'active', 1, 'upcoming', 0,
    'sold', 2, 'ended', 1, 'shown_n', 1, 'shown_median', NULL, 'active_n', 1, 'active_median', NULL, 'ended_n', 1, 'ended_median', NULL,
    'sold_n', 2, 'sold_median', NULL, 'with_image', 2, 'year_min', 1966, 'year_max', 1971)
  AND j->'models'->1->>'model' = 'F-150' FROM r_models), 'Mustang by hand: 4 episodes on 3 vehicles (MUSTANG folded in), then F-150');
SELECT pg_temp.check((SELECT jsonb_array_length(public.browse_source_read('test_market', 'No Such Make')->'models') = 0), 'a make the source does not hold has no models');

-- ALLOW_RAW_TESTIMONY_WRITE (synthetic fixture rows, disposable database)
-- Listings level: by hand, Ford Mustang = episodes 1, 9 (v1), 2 (v2), 3 (v3).
CREATE TEMP TABLE r_list AS SELECT public.browse_source_read('test_market', 'ford', 'mustang') AS j;
SELECT pg_temp.check((SELECT j->>'level' = 'listings' AND j->'scope' = '{"make": "Ford", "model": "Mustang", "status": null}'
  AND (j->'listings'->>'total')::int = 4 AND (j->'listings'->>'page')::int = 1 AND (j->'listings'->>'page_size')::int = 60
  AND jsonb_array_length(j->'listings'->'rows') = 4 AND j->'makes' = '[]' AND j->'models' = '[]' FROM r_list),
  'listings: total 4, one page of 4, the scope in the fold''s spelling');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = (public.browse_source_read('test_market', 'Ford')->'models'->0->>'episodes')::int FROM r_list),
  'the listings total is the models row''s episodes');
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) = ARRAY['a1', 'a2', 'a3', 'a9']
  FROM r_list, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)),
  'newest: by the source''s own clock (a1 ends ahead and counts as now, a2 ended 10 d ago, a3 20 d ago); a9 has no date and is last');
SELECT pg_temp.check((SELECT e = jsonb_build_object('event_id', pg_temp.eid(2), 'vehicle_id', pg_temp.vid(2), 'year', 1969, 'make', 'Ford', 'model', 'Mustang',
    'trim', 'Mach 1', 'status', 'sold', 'status_raw', 'sold', 'shown_price', 44000, 'sold_price', 45000, 'price_kind', 'current_bid',
    'price_label', NULL, 'bids', 12, 'listed_at', to_jsonb((SELECT started_at FROM public.vehicle_events WHERE id = pg_temp.eid(2))),
    'recorded_at', to_jsonb((SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(2))),
    'first_seen_at', to_jsonb((SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(2))),
    'checked_at', to_jsonb((SELECT updated_at FROM public.vehicle_events WHERE id = pg_temp.eid(2))),
    'ends_at', to_jsonb((SELECT ended_at FROM public.vehicle_events WHERE id = pg_temp.eid(2))), 'location', 'Reno, NV',
    'image_url', 'https://img.test/v02.jpg', 'listing_url', 'https://test.example/a2', 'archive_url', NULL)
  FROM r_list, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a2'), 'a sold row, every field');
SELECT pg_temp.check((SELECT e->>'status' = 'active' AND e->>'status_raw' = 'active' AND e->>'price_kind' = 'buy_it_now' AND (e->>'bids')::int = 0
  AND e->'sold_price' = 'null' AND (e->>'shown_price')::int = 30000 AND e->'location' = 'null' AND e->>'image_url' = 'https://img.test/v01.jpg'
  AND (e->>'ends_at')::timestamptz = (SELECT end30 FROM fx)
  AND e->'listed_at' = 'null'
  AND (e->>'recorded_at')::timestamptz = (SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(1))
  AND e->'recorded_at' = e->'first_seen_at'
  FROM r_list, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a1'),
  'an active row: the ask, the end from metadata; no listing date (the source gave none), recorded when it landed');
SELECT pg_temp.check((SELECT (e->>'listed_at')::timestamptz = '2026-01-02T03:04:05Z'::timestamptz AND e->>'location' = 'Elko, NV' AND e->'image_url' = 'null'
  AND e->>'status' = 'ended' AND e->'sold_price' = 'null'
  AND (e->>'ends_at')::timestamptz = (SELECT ended_at FROM public.vehicle_events WHERE id = pg_temp.eid(3))
  FROM r_list, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a3'),
  'an ended row: the posted date and the city from metadata, no photo');
SELECT pg_temp.check((SELECT e->>'status' = 'sold' AND e->>'status_raw' = 'completed' AND (e->>'sold_price')::int = 28000
  AND e->'listed_at' = 'null' AND e->'ends_at' = 'null'
  AND (e->>'recorded_at')::timestamptz = (SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(9))
  FROM r_list, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a9'),
  'a word that says nothing and a final price reads as sold; a posted date that is not a date is no date, not an error, and not the landing day');
SELECT pg_temp.check((SELECT bool_and(e->>'archive_url' IS NULL) FROM r_list, jsonb_array_elements(j->'listings'->'rows') e), 'no saved copy, no archive_url');

-- Dates are the source's own: Road Runners recorded A (an hour ago, sold 400 days ago), B (2 days ago, sold 30 days ago), C
-- (a minute ago, no date). Newest is by the sale, so B, A, then C, which carries none; never by when they landed (C, A, B).
CREATE TEMP TABLE r_rr AS SELECT public.browse_source_read('rules_market', 'plymouth', 'road runner') AS j;
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 4) ORDER BY o) = ARRAY['rr-b', 'rr-a', 'rr-c']
  FROM r_rr, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)),
  'newest follows the sale dates (B, A) and puts the undated lot last, not the landing order');
SELECT pg_temp.check((SELECT bool_and(e->'listed_at' = 'null') AND array_agg((e->>'ends_at')::timestamptz ORDER BY o) IS NOT DISTINCT FROM ARRAY[pg_temp.eod(-30), pg_temp.eod(-400), NULL]::timestamptz[]
  FROM r_rr, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)),
  'the sale day is the end of that day; no listing date; the lot with no date has no end');
SELECT pg_temp.check((SELECT array_agg((e->>'recorded_at')::timestamptz ORDER BY o) = ARRAY[(SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(91)),
    (SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(90)), (SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(92))]
  FROM r_rr, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)), 'and each says when Nuke recorded it, apart from the sale');

-- The status rules, as the page reads them (the live event): Barracudas b01-b14 in one page, newest first. The dated sales sort
-- by their clock (a sale not over counts as now: b05 b06 b09 b14), the lots with none sort last, by when they landed.
CREATE TEMP TABLE r_barra AS SELECT public.browse_source_read('rules_market', 'Plymouth', 'Barracuda', 1, 100) AS j;
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 14 AND jsonb_array_length(j->'listings'->'rows') = 14 FROM r_barra), 'Barracudas: 14');
SELECT pg_temp.check((SELECT count(*) = 14 AND count(DISTINCT e->>'event_id') = 14
  AND bool_and((e->>'event_id')::uuid IN (SELECT pg_temp.eid(69 + n) FROM generate_series(1, 14) n))
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e),
  'every row carries the id of the event row it is, each its own, so a page keys rows exactly: 14 rows, 14 ids, each a fixture event');
SELECT pg_temp.check((SELECT jsonb_object_agg(right(e->>'listing_url', 3), e->>'status') = '{"b01": "ended", "b02": "ended", "b03": "unknown", "b04": "active",
    "b05": "upcoming", "b06": "active", "b07": "ended", "b08": "unknown", "b09": "active", "b10": "ended", "b11": "sold", "b12": "sold",
    "b13": "active", "b14": "active"}'::jsonb FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e),
  'the rows shown carry the status rules: bid-goes-on and a passed sale are ended, an idle active with no end clock is unknown, a sale ahead is upcoming');
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 3) ORDER BY o) = ARRAY['b05', 'b06', 'b09', 'b14', 'b10', 'b07', 'b02', 'b01', 'b11',
                                                                                       'b12', 'b03', 'b04', 'b08', 'b13']
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)),
  'newest: not over yet first, then by the sale (an hour ago, 3, 5, 30, 40 days ago), then the lots with no date, by when they landed');
SELECT pg_temp.check((SELECT (e->>'listed_at')::timestamptz = ((current_date - 43)::text || ' 00:00:00+00')::timestamptz
  AND (e->>'ends_at')::timestamptz = pg_temp.eod(-40) AND e->>'status' = 'sold' AND e->'sold_price' = 'null'
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%b11'),
  'b11: listed the first day of its sale, ended the last second of its last day');
SELECT pg_temp.check((SELECT bool_and(e->'listed_at' = 'null' AND e->'ends_at' = 'null')
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' ~ 'b(03|04|08|12|13)$'),
  'no date at all, or dates that are not dates: no listing date and no end');
SELECT pg_temp.check((SELECT e->>'status_raw' = 'bid-goes-on' AND e->>'status' = 'ended' AND (e->>'sold_price') IS NULL
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%b01'),
  'bid-goes-on shows its own word beside Ended, and never a sold price');
SELECT pg_temp.check((SELECT e->>'status' = 'active' AND e->'ends_at' = 'null'
  AND (e->>'checked_at')::timestamptz = (SELECT updated_at FROM public.vehicle_events WHERE id = pg_temp.eid(73))
  AND (e->>'checked_at')::timestamptz < now() - interval '47 hours' AND (e->>'checked_at')::timestamptz > now() - interval '49 hours'
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%b04'),
  'a row alive by the source''s word with no end clock carries the clock of its last write (b04: 2 days back), the only evidence that it is alive');
SELECT pg_temp.check((SELECT e->>'status' = 'unknown' AND (e->>'checked_at')::timestamptz = (SELECT updated_at FROM public.vehicle_events WHERE id = pg_temp.eid(72))
  AND (e->>'checked_at')::timestamptz < now() - interval '199 days'
  FROM r_barra, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%b03'),
  'and the same row idle for 200 days is unknown, with that clock (b03)');
SELECT pg_temp.check((SELECT (j->'holdings'->>'active')::int = 5 AND (j->'holdings'->>'upcoming')::int = 1 AND (j->'holdings'->>'ended')::int = 4
  AND (j->'holdings'->>'unknown')::int = 2 AND (j->'holdings'->>'sold')::int = 5 AND (j->'holdings'->>'episodes')::int = 17
  AND (j->'holdings'->>'active_n')::int = 3 AND jsonb_typeof(j->'holdings'->'active_median') = 'null'
  AND (j->'holdings'->>'sold_n')::int = 3 AND jsonb_typeof(j->'holdings'->'sold_median') = 'null'
  FROM r_barra), 'the source row of rules_market: 5 live (Live now), 1 upcoming, 4 ended, 2 unknown, 5 sold');
SELECT pg_temp.check((SELECT (public.browse_source_read('rules_market', 'Plymouth', 'Barracuda', 1, 100, 'newest', 'upcoming')->'listings'->>'total')::int = 1
  AND (SELECT right(e->>'listing_url', 3) FROM jsonb_array_elements(public.browse_source_read('rules_market', 'Plymouth', 'Barracuda', 1, 100, 'newest', 'upcoming')->'listings'->'rows') e) = 'b05'
  AND (public.browse_source_read('rules_market', 'Plymouth', 'Barracuda', 1, 100, 'newest', 'unknown')->'listings'->>'total')::int = 2
  AND (public.browse_source_read('rules_market', 'Plymouth', 'Barracuda', 1, 100, 'newest', 'ended')->'listings'->>'total')::int = 4),
  'p_status upcoming, unknown and ended filter the listings');

-- Sorts, pages, caps and the status filter.
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) = ARRAY['a2', 'a1', 'a9', 'a3']
  FROM jsonb_array_elements(public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'price_desc')->'listings'->'rows') WITH ORDINALITY a(e, o)),
  'price_desc: sold price where there is one, else the shown price: 45000, 30000, 28000, 12000');
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) = ARRAY['a3', 'a9', 'a1', 'a2']
  FROM jsonb_array_elements(public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'price_asc')->'listings'->'rows') WITH ORDINALITY a(e, o)), 'price_asc');
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) = ARRAY['a3', 'a2', 'a1', 'a9']
  FROM jsonb_array_elements(public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'year_desc')->'listings'->'rows') WITH ORDINALITY a(e, o)),
  'year_desc: 1971, 1969, 1966 (not over first), 1966 (no date last)');
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) = ARRAY['a1', 'a9', 'a2', 'a3']
  FROM jsonb_array_elements(public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'year_asc')->'listings'->'rows') WITH ORDINALITY a(e, o)), 'year_asc');
SELECT pg_temp.check((public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'drop table vehicles') -> 'listings' -> 'rows') = (SELECT j->'listings'->'rows' FROM r_list),
  'a sort word the reader does not know is newest, never SQL');
CREATE TEMP TABLE p1 AS SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 2) AS j;
CREATE TEMP TABLE p2 AS SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 2, 2) AS j;
CREATE TEMP TABLE p3 AS SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 3, 2) AS j;
SELECT pg_temp.check((SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) FROM p1, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)) = ARRAY['a1', 'a2']
  AND (SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) FROM p2, jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)) = ARRAY['a3', 'a9']
  AND (SELECT j->'listings'->'rows' = '[]' AND (j->'listings'->>'total')::int = 4 AND (j->'listings'->>'page')::int = 3 FROM p3)
  AND (SELECT (j->'listings'->>'page_size')::int = 2 FROM p1), 'pages of two: 1-2, 3-4, then an empty page that still says 4');
SELECT pg_temp.check((public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 1000)->'listings'->>'page_size')::int = 100, 'page size is capped at 100');
SELECT pg_temp.check((public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 0)->'listings'->>'page_size')::int = 60
  AND (public.browse_source_read('test_market', 'Ford', 'Mustang', 1, NULL)->'listings'->>'page_size')::int = 60, 'no page size is the default 60');
SELECT pg_temp.check((public.browse_source_read('test_market', 'Ford', 'Mustang', -4, 2)->'listings'->>'page')::int = 1
  AND (public.browse_source_read('test_market', 'Ford', 'Mustang', 2147483647, 100)->'listings'->'rows') = '[]', 'a page below 1 is 1; a huge page is empty, not an overflow');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 2 AND j->'scope'->>'status' = 'sold'
  AND (SELECT array_agg(right(e->>'listing_url', 2) ORDER BY o) FROM jsonb_array_elements(j->'listings'->'rows') WITH ORDINALITY a(e, o)) = ARRAY['a2', 'a9']
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'newest', 'SOLD') AS j) x), 'p_status sold: 2 of 4, in the scope');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 1 AND j->'listings'->'rows'->0->>'status' = 'active'
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'newest', 'active') AS j) x), 'p_status active: 1');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 4 AND j->'scope'->'status' = 'null'
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'newest', 'bogus') AS j) x), 'a status the reader does not know is no filter');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 0 AND j->'listings'->'rows' = '[]' AND j->>'status' = 'ok'
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Pinto') AS j) x), 'a model the source does not hold has no listings, still ok');
SELECT pg_temp.check((SELECT j->>'level' = 'makes' AND j->'scope' = '{"make": null, "model": null, "status": null}'
  FROM (SELECT public.browse_source_read('test_market', NULL, 'Mustang') AS j) x), 'a model without a make is the makes level');

-- A vehicle hidden after the fold is not shown, and the total stays the fold's until the next fold.
UPDATE public.vehicles SET is_public = false WHERE id = pg_temp.vid(2);
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 4 AND jsonb_array_length(j->'listings'->'rows') = 3
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a2')
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang') AS j) x), 'a vehicle hidden after the fold is left out of the page');
UPDATE public.vehicles SET is_public = true WHERE id = pg_temp.vid(2);
-- The reader tests the whole visibility of a vehicle itself, whatever the fold held: is_public that became NULL, deleted_at and a
-- listing_kind that became a non-vehicle each leave the row out (the fold counts it until the next fold, so the total stays 4).
CREATE FUNCTION pg_temp.mustang_page_without_a2() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (j->'listings'->>'total')::int = 4 AND jsonb_array_length(j->'listings'->'rows') = 3
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a2')
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang') AS j) x $$;
UPDATE public.vehicles SET is_public = NULL WHERE id = pg_temp.vid(2);
SELECT pg_temp.check(pg_temp.mustang_page_without_a2(), 'a vehicle whose is_public became NULL after the fold is left out of the page');
UPDATE public.vehicles SET is_public = true WHERE id = pg_temp.vid(2);
UPDATE public.vehicles SET deleted_at = now() WHERE id = pg_temp.vid(2);
SELECT pg_temp.check(pg_temp.mustang_page_without_a2(), 'a vehicle deleted after the fold is left out of the page');
UPDATE public.vehicles SET deleted_at = NULL WHERE id = pg_temp.vid(2);
UPDATE public.vehicles SET listing_kind = 'non_vehicle_item' WHERE id = pg_temp.vid(2);
SELECT pg_temp.check(pg_temp.mustang_page_without_a2(), 'a vehicle that became a non-vehicle item after the fold is left out of the page');
UPDATE public.vehicles SET listing_kind = 'vehicle' WHERE id = pg_temp.vid(2);
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 4 AND jsonb_array_length(j->'listings'->'rows') = 4
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang') AS j) x), 'and restored: the page has its 4 rows again');

-- The rows are the live event. A listing that closed since the fold reads Ended on the page at once; the fold's counts keep it
-- until the next fold, and a status filter then leaves it out. A price that changed is the new price.
UPDATE public.vehicle_events
   SET metadata = jsonb_build_object('price_kind', 'buy_it_now', 'listing_ends_at', pg_temp.iso(now() - interval '1 hour')),
       current_price = 31000
 WHERE id = pg_temp.eid(1);
SELECT pg_temp.check((SELECT e->>'status' = 'ended' AND (e->>'shown_price')::int = 31000 AND e->>'status_raw' = 'active'
  FROM jsonb_array_elements(public.browse_source_read('test_market', 'Ford', 'Mustang')->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a1'),
  'a listing that closed since the fold reads Ended, with the price it carries now; its own word is still shown');
SELECT pg_temp.check((SELECT (public.browse_source_read('test_market')->'holdings'->>'active')::int = 1), 'and the fold still counts it live until the next fold');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 1 AND j->'listings'->'rows' = '[]'
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang', 1, 60, 'newest', 'active') AS j) x),
  'a filter of the live leaves out the row that has closed, though the fold counted it');
UPDATE public.vehicle_events SET final_price = 29000 WHERE id = pg_temp.eid(9);
SELECT pg_temp.check((SELECT (e->>'sold_price')::int = 29000
  FROM jsonb_array_elements(public.browse_source_read('test_market', 'Ford', 'Mustang')->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%a9'),
  'and a sold price that changed is the new one');
UPDATE public.vehicle_events SET final_price = 28000 WHERE id = pg_temp.eid(9);
SELECT public.source_holdings_refresh() IS NOT NULL AS refreshed;
SELECT pg_temp.check((SELECT (j->'holdings'->>'active')::int = 0 AND (j->'holdings'->>'ended')::int = 5
  FROM (SELECT public.browse_source_read('test_market') AS j) x), 'after the next fold the count follows: 0 live, 5 ended');
UPDATE public.vehicle_events
   SET metadata = jsonb_build_object('price_kind', 'buy_it_now', 'listing_ends_at', pg_temp.iso((SELECT end30 FROM fx))), current_price = 30000
 WHERE id = pg_temp.eid(1);
SELECT public.source_holdings_refresh() IS NOT NULL AS refreshed;
SELECT pg_temp.check((SELECT (j->'holdings'->>'active')::int = 1 AND (j->'holdings'->>'ended')::int = 4
  FROM (SELECT public.browse_source_read('test_market') AS j) x), 'restored: 1 live, 4 ended');

-- Medians of five or more, per status: bulk_market. 9 live asking 5000-8000 and 20000-60000 (median 20000), 9 closed last bids
-- 1000-5000 and 1000-4000 (3000), 10 sold 10000-50000, 70000 and 100000-130000 (60000, between 50000 and 70000). Chargers
-- alone: 5 live (40000), 5 closed (3000), 6 sold (35000). Challengers: 4 live, 4 closed, 4 sold: each one short of the floor.
CREATE TEMP TABLE r_bulk AS SELECT public.browse_source_read('bulk_market') AS j;
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 28 AND (j->'holdings'->>'active')::int = 9 AND (j->'holdings'->>'ended')::int = 9
  AND (j->'holdings'->>'sold')::int = 10 AND (j->'holdings'->>'unknown')::int = 0 AND (j->'holdings'->>'with_image')::int = 3
  AND (j->'holdings'->>'active_n')::int = 9 AND (j->'holdings'->>'active_median')::int = 20000
  AND (j->'holdings'->>'shown_n')::int = 9 AND (j->'holdings'->>'shown_median')::int = 20000
  AND (j->'holdings'->>'ended_n')::int = 9 AND (j->'holdings'->>'ended_median')::int = 3000
  AND (j->'holdings'->>'sold_n')::int = 10 AND (j->'holdings'->>'sold_median')::int = 60000
  AND j->'source'->>'name' = 'Bulk Market' AND j->'source'->>'unit' = 'lots held' AND j->'source'->>'species' = 'timed_auction'
  AND j->'source'->'logo_url' = 'null' FROM r_bulk),
  'five or more prices have a median, per status: the live asks 20000, the closed last bids 3000, the sold prices 60000 (the sold lots'' last bids count in none); no organization: the display name');
SELECT pg_temp.check((SELECT (j->'makes'->0->>'active_median')::int = 20000 AND (j->'makes'->0->>'ended_median')::int = 3000
  AND (j->'makes'->0->>'sold_median')::int = 60000 AND (j->'makes'->0->>'shown_median')::int = 20000
  AND j->'makes'->0->'top_models' = '[{"model": "Charger", "episodes": 16}, {"model": "Challenger", "episodes": 12}]' FROM r_bulk),
  'the makes level carries the same medians');
SELECT pg_temp.check((SELECT j->'models'->0->>'model' = 'Charger' AND (j->'models'->0->>'active_median')::int = 40000
  AND (j->'models'->0->>'ended_median')::int = 3000 AND (j->'models'->0->>'sold_median')::int = 35000
  AND j->'models'->1->>'model' = 'Challenger' AND (j->'models'->1->>'episodes')::int = 12
  AND (j->'models'->1->>'active_n')::int = 4 AND jsonb_typeof(j->'models'->1->'active_median') = 'null'
  AND (j->'models'->1->>'ended_n')::int = 4 AND jsonb_typeof(j->'models'->1->'ended_median') = 'null'
  AND (j->'models'->1->>'sold_n')::int = 4 AND jsonb_typeof(j->'models'->1->'sold_median') = 'null'
  FROM (SELECT public.browse_source_read('bulk_market', 'dodge') AS j) x),
  'and the models level; four live asks, four last bids and four sold prices are each under the floor, so no median');

-- The aliased marketplace's Bronco listings carry ended auctions whose capture count is not a number or too large for an integer; this is
-- the first read of that page, so a reader that fails on them says so by name (the rows are checked by hand below).
SELECT pg_temp.runs($q$ CREATE TEMP TABLE r_bronco AS SELECT public.browse_source_read('ebay_motors', 'Ford', 'Bronco') AS j $q$,
  'the Bronco listings read without an error, whatever a capture says its bid count is');

-- Sources apart: the same vehicle on another source is counted there only.
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 1 AND j->'makes'->0->>'make' = 'Ford' AND j->'source'->>'name' = 'Other Market'
  AND j->'source'->>'species' = 'dealer' AND j->'source'->>'unit' = 'vehicles held' AND (j->'holdings'->>'active')::int = 1
  FROM (SELECT public.browse_source_read('other_market') AS j) x),
  'a dealer''s own page: its one lot, alive because it was touched within 14 days');
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 9 AND (j->'holdings'->>'active')::int = 1 AND (j->'holdings'->>'sold')::int = 1
  AND (j->'holdings'->>'ended')::int = 7
  AND (SELECT count(*) = 9 AND array_agg(e->>'sold_price') FILTER (WHERE e->>'sold_price' IS NOT NULL) = ARRAY['30000']
       FROM jsonb_array_elements(public.browse_source_read('ebay', 'Ford', 'Bronco')->'listings'->'rows') e)
  AND (j - 'as_of') = (public.browse_source_read('ebay_motors') - 'as_of')
  AND (j - 'as_of') = (public.browse_source_read('EBAY motors') - 'as_of')
  AND (j->'holdings'->>'landed_24h')::int = 2
  FROM (SELECT public.browse_source_read('ebay') AS j) x),
  'an alias is its market: both spellings'' events (one live, one sold, seven ended auctions), only the sold lot priced, by its vehicle (whose own source is the alias), the two newest landed in 24 h');
-- The aliased marketplace by hand: 9 episodes on 2 vehicles (v100 eight times, v101 once); with a photo 1 (v100); saved copies 1 (e100's http address;
-- e101's javascript: address is not one). Dated: e106's listing start (30 days back, no end) is the earliest clock, e100's end (5 days
-- ahead) the latest. Last bids of the ended auctions: 15500, 9000, 21000, 4000, 5000, 6000, 7000 = 7, median 7000 (the fourth of 4000,
-- 5000, 6000, 7000, 9000, 15500, 21000).
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 9 AND (j->'holdings'->>'vehicles')::int = 2 AND (j->'holdings'->>'with_image')::int = 1
  AND (j->'holdings'->>'ended_n')::int = 7 AND (j->'holdings'->>'ended_median')::int = 7000
  AND (j->'holdings'->>'archived')::int = 1
  AND (j->'holdings'->>'archived')::int = (SELECT count(*) FROM jsonb_array_elements(public.browse_source_read('ebay_motors', 'Ford', 'Bronco')->'listings'->'rows') e
                                           WHERE e->>'archive_url' IS NOT NULL)
  AND (j->'holdings'->>'dated_min')::timestamptz = (SELECT started_at FROM public.vehicle_events WHERE id = pg_temp.eid(106))
  AND (j->'holdings'->>'dated_max')::timestamptz = (SELECT (metadata ->> 'listing_ends_at')::timestamptz FROM public.vehicle_events WHERE id = pg_temp.eid(100))
  FROM (SELECT public.browse_source_read('ebay_motors') AS j) x),
  'holdings of the aliased marketplace: 9 episodes on 2 vehicles, 7 last bids with a median of 7000, 1 saved copy (the http address, not the javascript: one), dated from the earliest listing start to the latest end');
SELECT pg_temp.check((SELECT bool_or(e->>'archive_url' = 'https://web.archive.org/web/2010/https://alias.example/100') AND bool_or(e->'archive_url' = 'null')
  FROM jsonb_array_elements(public.browse_source_read('ebay_motors', 'Ford', 'Bronco')->'listings'->'rows') e),
  'a saved copy is a link only when it is http or https');
SELECT pg_temp.check((SELECT (j - 'as_of') = (public.browse_source_read('chan_market_saved') - 'as_of')
  AND (j->'holdings'->>'episodes')::int = 2 AND j->'source'->>'slug' = 'chan_market' AND j->'source'->>'name' = 'Chan Market'
  FROM (SELECT public.browse_source_read('chan_market') AS j) x), 'a capture channel''s slug opens its market''s page');
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 1
  AND (j - 'as_of') = (public.browse_source_read('www.oldcaronline.com') - 'as_of')
  FROM (SELECT public.browse_source_read('oldcaronline') AS j) x), 'a www.<name>.com spelling opens <name>''s page');

-- Bids and the price label, by hand: the aliased marketplace's Bronco listings read above (the live lot, the sold lot and the ended
-- auctions 103-109); each row is found by its address.
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 9 AND jsonb_array_length(j->'listings'->'rows') = 9 FROM r_bronco),
  'the Bronco listings: the live lot, the sold lot and seven ended auctions');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 7 AND e->>'status' = 'ended' AND e->>'price_kind' = 'current_bid' AND (e->>'shown_price')::int = 15500
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/103'),
  'an ended auction with 0 bids in the column reads the capture''s own count: bids 7');
SELECT pg_temp.check((SELECT e->'price_label' IS NOT DISTINCT FROM 'null'::jsonb
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/103'),
  'a price the source labelled "Current bid" is no price label: only its own "Starting bid" passes, any other word is null');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 0 AND e->>'price_label' = 'Starting bid' AND e->>'status' = 'ended'
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/104'),
  'a price the source itself called a starting bid reads Starting bid; with no count in the capture the column''s 0 stays 0');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 3 AND e->'price_label' IS NOT DISTINCT FROM 'null'::jsonb AND e->>'status' = 'ended'
  AND e->>'status_raw' = 'reserve_not_met'
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/105'),
  'a count in the capture that is not a number does not override the column: bids 3');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 0 AND e->>'price_label' = 'Starting bid' AND e->>'status' = 'ended'
  AND (e->>'listed_at')::timestamptz = (SELECT started_at FROM public.vehicle_events WHERE id = pg_temp.eid(106))
  AND e->'ends_at' IS NOT DISTINCT FROM 'null'::jsonb
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/106'),
  'the label is read in any case and trimmed (" starting bid " is Starting bid); a lot with only a start date has that listing date and no end');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 0 AND e->'price_label' IS NOT DISTINCT FROM 'null'::jsonb
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/107'),
  'a capture count that is not a number is no count when the column says 0: bids 0, no error');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 0 AND e->'price_label' IS NOT DISTINCT FROM 'null'::jsonb
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/108'),
  'a capture count too large for an integer is no count when the column says 0: bids 0, no error');
SELECT pg_temp.check((SELECT (e->>'bids')::int = 4 AND e->'price_label' IS NOT DISTINCT FROM 'null'::jsonb AND e->>'status' = 'ended'
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' LIKE '%/109'),
  'with nothing in the column the capture''s own count is the bids: 4');
SELECT pg_temp.check((SELECT count(*) = 2 AND bool_and(e->'bids' IS NOT DISTINCT FROM 'null'::jsonb AND e->'price_label' IS NOT DISTINCT FROM 'null'::jsonb)
  FROM r_bronco, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'listing_url' ~ '/10[01]$'),
  'a lot with no bid count in the column or the capture reads null, not 0, and carries no price label');
-- In a UTC session (the API's) every timestamp is an ISO string with a +00:00 offset.
SET timezone = 'UTC';
CREATE TEMP TABLE r_utc AS SELECT public.browse_source_read('ebay_motors', 'Ford', 'Bronco') AS j;
RESET timezone;
SELECT pg_temp.check((SELECT j->>'as_of' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$' AND j->'holdings'->>'folded_at' ~ '\+00:00$'
  AND j->'holdings'->>'dated_min' ~ '\+00:00$' AND j->'holdings'->>'dated_max' ~ '\+00:00$' AND j->'holdings'->>'last_landed' ~ '\+00:00$'
  AND (SELECT bool_and(e->>'recorded_at' ~ '\+00:00$' AND e->>'first_seen_at' ~ '\+00:00$' AND e->>'checked_at' ~ '\+00:00$'
                       AND coalesce(e->>'listed_at', '+00:00') ~ '\+00:00$'
                       AND coalesce(e->>'ends_at', '+00:00') ~ '\+00:00$') FROM jsonb_array_elements(j->'listings'->'rows') e) FROM r_utc),
  'in a UTC session every timestamp (as_of, the fold''s clocks, the dated range, a row''s listed, recorded, checked and end) is an ISO string with a +00:00 offset');

-- Edge cases: edge_market, vehicles 150-197 (see the fixtures). 42 episodes on 42 vehicles in 6 makes and 6 models. The 6 events on
-- vehicles that cannot be listed (a blank make, a blank, empty or missing model, no is_public) or on a registry row the page never
-- browses (seller_reg, private_seller) are not counted.
CREATE TEMP TABLE r_edge AS SELECT public.browse_source_read('edge_market') AS j;
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND (j->'holdings'->>'episodes')::int = 42 AND (j->'holdings'->>'vehicles')::int = 42
  AND (j->'holdings'->>'makes')::int = 6 AND (j->'holdings'->>'models')::int = 6 FROM r_edge),
  'edge_market: 42 episodes on 42 vehicles in 6 makes and 6 models');
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM public.mv_source_episodes WHERE vehicle_id = ANY (SELECT pg_temp.vid(n) FROM generate_series(153, 157) n))
  AND NOT EXISTS (SELECT 1 FROM public.mv_source_episodes WHERE vehicle_id = pg_temp.vid(195))),
  'a blank make, a blank, empty or missing model and a vehicle with no is_public are not listings, and a private_seller row''s event is none');
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND j->'source'->>'name' = 'Seller Reg' AND j->'source'->>'species' = 'private_seller'
  AND (j->'holdings'->>'episodes')::int = 0 AND j->'makes' = '[]' AND j->'listings'->'rows' = '[]'
  FROM (SELECT public.browse_source_read('seller_reg', 'Edge', 'Seller') AS j) x),
  'a registry row of species private_seller is known by name and holds nothing here, though an event of its own sits on a public vehicle');
SELECT pg_temp.check((SELECT j->'source' = jsonb_build_object('slug', 'edge_market', 'name', 'Edge Market', 'category', 'classifieds',
    'species', 'classifieds', 'species_label', 'Classifieds', 'unit', 'posts held',
    'logo_url', 'https://nuke.ag/source-logos/edge_market.png', 'base_url', NULL) FROM r_edge),
  'the source is named as the Sources board names it, the registry name without its trailing parenthesis, not the organization''s name; the logo is the organization''s');
-- Keys: a make or model stored with a space, or in another case, is one make and one model, shown trimmed.
SELECT pg_temp.check((SELECT j->>'level' = 'models' AND j->'scope' = '{"make": "Edge", "model": null, "status": null}'
  AND jsonb_array_length(j->'models') = 1 AND j->'models'->0->>'model' = 'Zed' AND (j->'models'->0->>'episodes')::int = 3
  AND (j->'models'->0->>'vehicles')::int = 3
  FROM (SELECT public.browse_source_read('edge_market', ' edge ') AS j) x),
  'a make or model stored with a space or in another case is the same make and the same model, shown trimmed: 3 episodes on 3 vehicles');
SELECT pg_temp.check((SELECT j->>'level' = 'listings' AND j->'scope' = '{"make": "Edge", "model": "Zed", "status": null}'
  AND (j->'listings'->>'total')::int = 3 AND jsonb_array_length(j->'listings'->'rows') = 3
  AND (SELECT bool_and(e->>'make' = btrim(e->>'make') AND e->>'model' = btrim(e->>'model') AND lower(e->>'make') = 'edge' AND lower(e->>'model') = 'zed')
       FROM jsonb_array_elements(j->'listings'->'rows') e)
  FROM (SELECT public.browse_source_read('edge_market', 'Edge ', ' Zed') AS j) x),
  'the page of a model asked for with a space opens (3 listings), and its rows carry the make and model trimmed');
-- Years: only 1885 to this year + 2 make a range; a vehicle outside it is still a listing.
SELECT pg_temp.check((SELECT (j->'holdings'->>'year_min')::int = 1885 AND (j->'holdings'->>'year_max')::int = extract(year FROM now())::int + 2
  AND (SELECT (m->>'episodes')::int = 7 AND (m->>'year_min')::int = 1885 AND (m->>'year_max')::int = extract(year FROM now())::int + 2
       FROM jsonb_array_elements(public.browse_source_read('edge_market', 'Eras')->'models') m)
  FROM r_edge),
  'a year outside 1885 to two years ahead (0, 9999, 1884, three years ahead) is a listing but sets no year range');
-- Photos: with a photo is an address on the record; the card shows what the photo gate shows, never the record's own address.
CREATE TEMP TABLE r_img AS SELECT public.browse_source_read('edge_market', 'Imgs', 'Img', 1, 100) AS j;
SELECT pg_temp.check((SELECT (m->>'episodes')::int = 12 AND (m->>'vehicles')::int = 12 AND (m->>'with_image')::int = 9
  FROM jsonb_array_elements(public.browse_source_read('edge_market', 'Imgs')->'models') m),
  'with a photo is a photo address on the record, a web address or a path in any case: "", "jpg" and "javascript:" are none, so 9 of 12');
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 12 AND jsonb_array_length(j->'listings'->'rows') = 12
  AND (SELECT jsonb_object_agg(e->>'vehicle_id', e->'image_url') FROM jsonb_array_elements(j->'listings'->'rows') e) =
      (SELECT jsonb_object_agg(pg_temp.vid(t.n)::text, t.url) FROM (VALUES
         (165, NULL::text), (166, NULL), (167, NULL), (168, NULL), (169, NULL), (170, NULL), (171, NULL),
         (172, 'https://img.test/e172_t.jpg'), (173, 'https://img.test/e173_m.jpg'), (174, 'https://img.test/e174_f.jpg'),
         (175, NULL), (176, NULL)) t(n, url))
  FROM r_img),
  'the card photo is the gate''s (thumbnail, else medium, else full size) and none where the gate shows none: not a rejected, superseded or sensitive photo, not the record''s own address, not a storage address');
-- Places: what the source wrote is sent only when it reads as a place.
CREATE TEMP TABLE r_loc AS SELECT public.browse_source_read('edge_market', 'Locs', 'Loc', 1, 100) AS j;
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 11
  AND (SELECT jsonb_object_agg(e->>'vehicle_id', e->'location') FROM jsonb_array_elements(j->'listings'->'rows') e) =
      (SELECT jsonb_object_agg(pg_temp.vid(t.n)::text, t.loc) FROM (VALUES
         (177, NULL::text), (178, 'Reno, NV 89501'), (179, NULL), (180, NULL), (181, NULL), (182, NULL), (183, 'Sparks, NV'),
         (184, NULL), (185, 'Elko, NV'), (196, NULL), (197, NULL)) t(n, loc))
  FROM r_loc),
  'a place is sent only when it reads as one: a city with a ZIP and a plain city are; an address with a phone number and an e-mail address, a phone number, an e-mail address, 70 letters, a JSON object, a line break and a street with a number are not; the vehicle''s own place wins over junk');
-- Addresses: a web address without spaces, in any case, or nothing.
CREATE TEMP TABLE r_url AS SELECT public.browse_source_read('edge_market', 'Urls', 'Url', 1, 100) AS j;
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 6
  AND (SELECT jsonb_object_agg(e->>'vehicle_id', e->'listing_url') FROM jsonb_array_elements(j->'listings'->'rows') e) =
      (SELECT jsonb_object_agg(pg_temp.vid(t.n)::text, t.u) FROM (VALUES
         (186, NULL::text), (187, NULL), (188, 'HTTPS://edge.example/u188'), (189, NULL), (190, NULL), (191, 'https://edge.example/u191')) t(n, u))
  FROM r_url),
  'a listing address is sent only when it is a web address without spaces, in any case: an app pseudo-address, javascript:, an address with a space and none are null');
SELECT pg_temp.check((SELECT (SELECT jsonb_object_agg(e->>'vehicle_id', e->'archive_url') FROM jsonb_array_elements(j->'listings'->'rows') e) =
      (SELECT jsonb_object_agg(pg_temp.vid(t.n)::text, t.u) FROM (VALUES
         (186, NULL::text), (187, NULL), (188, NULL), (189, NULL), (190, NULL),
         (191, 'HTTPS://WEB.ARCHIVE.ORG/web/2011/https://edge.example/u191')) t(n, u))
  AND (SELECT (j->'holdings'->>'archived')::int = 1 FROM r_edge)
  FROM r_url),
  'a saved copy at an upper-case web address is a saved copy: sent on its row and counted in the holdings');
-- Bids: a capture count written as a JSON number (production writes it so).
CREATE TEMP TABLE r_bid AS SELECT public.browse_source_read('edge_market', 'Bids', 'Bid', 1, 100) AS j;
SELECT pg_temp.check((SELECT (j->'listings'->>'total')::int = 3
  AND (SELECT jsonb_object_agg(e->>'vehicle_id', e->'bids') FROM jsonb_array_elements(j->'listings'->'rows') e) =
      jsonb_build_object(pg_temp.vid(192)::text, 0, pg_temp.vid(193)::text, 12, pg_temp.vid(194)::text, 5)
  FROM r_bid),
  'a capture count that is a JSON number is read: 12 beside a NULL column; the column wins when it has a count (5 over 9); a count too large for an integer is none (0), with no error');
-- checked_at is the event row's last write, apart from when it was recorded.
SELECT pg_temp.check((SELECT (e->>'checked_at')::timestamptz = (SELECT updated_at FROM public.vehicle_events WHERE id = pg_temp.eid(193))
  AND (e->>'recorded_at')::timestamptz = (SELECT created_at FROM public.vehicle_events WHERE id = pg_temp.eid(193))
  AND (e->>'checked_at')::timestamptz > (e->>'recorded_at')::timestamptz
  FROM r_bid, jsonb_array_elements(j->'listings'->'rows') e WHERE e->>'vehicle_id' = pg_temp.vid(193)::text),
  'a row says when it was last written (checked_at) apart from when it was first recorded (recorded_at)');

-- Dates are the source's own, at the holdings: rules_market's lots carry their sale days (a day alone ends with that day), so the
-- range runs from the last second of the oldest sale day (Road Runner A, 400 days back) to that of the latest (b05, 12 days ahead);
-- the six lots with no date (b03 b04 b08 b12 b13 and Road Runner C) are in neither.
SELECT pg_temp.check((SELECT (j->'holdings'->>'archived')::int = 0 AND (j->'holdings'->>'dated_min')::timestamptz = pg_temp.eod(-400)
  AND (j->'holdings'->>'dated_max')::timestamptz = pg_temp.eod(12) AND (j->'holdings'->>'episodes')::int = 17
  FROM (SELECT public.browse_source_read('rules_market') AS j) x),
  'holdings of rules_market: no saved copy; dated from the last second of the oldest sale day (400 days back) to that of the latest (12 days ahead)');

-- Identity without a fold row: a registered source that holds nothing, one only the Sources board knows (a venue, and a
-- cohort of another venue's lots). The page says what the board says: its count rides along in holdings.board.
CREATE TEMP TABLE r_quiet AS SELECT public.browse_source_read('quiet_market') AS j;
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND (j->'holdings'->>'episodes')::int = 0 AND jsonb_typeof(j->'holdings'->'active_median') = 'null'
  AND j->'holdings'->>'landed_24h' = '0' AND jsonb_typeof(j->'holdings'->'last_landed') = 'null' AND j->'makes' = '[]'
  AND j->'source'->>'unit' = 'posts held' AND j->'source'->>'species_label' = 'Classifieds'
  AND (j->'holdings'->>'folded_at')::timestamptz = (SELECT folded_at FROM public.mv_source_holdings LIMIT 1) FROM r_quiet),
  'a registered source that holds nothing is ok with zero holdings and the fold''s clock');
SELECT pg_temp.check((SELECT (j->'holdings'->'board'->>'lots')::int = 77 AND j->'holdings'->'board'->>'day' = current_date::text FROM r_quiet),
  'and the board''s count of it (77 lots) rides along, so the page never says nothing is recorded beside a board count');
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND j->'source'->>'name' = 'Days Only' AND j->'source'->>'unit' = 'lots held'
  AND j->'source'->>'category' = 'auction' AND (j->'holdings'->>'episodes')::int = 0 AND (j->'holdings'->'board'->>'lots')::int = 55
  AND j->'holdings'->>'landed_24h' = '0' AND jsonb_typeof(j->'holdings'->'last_landed') = 'null'
  AND j->'makes' = '[]' AND j->'listings'->'rows' = '[]'
  FROM (SELECT public.browse_source_read('days_only', 'Jaguar', 'E-Type') AS j) x),
  'a source only the Sources board knows: its latest day names it (without the trailing parenthesis the board drops) and counts it; it holds no rows here, though an event of its own sits on a public vehicle');
SELECT pg_temp.check((SELECT bool_and(j->'holdings'->'archived' IS NOT DISTINCT FROM '0'::jsonb AND j->'holdings'->'dated_min' IS NOT DISTINCT FROM 'null'::jsonb
    AND j->'holdings'->'dated_max' IS NOT DISTINCT FROM 'null'::jsonb)
  FROM (VALUES ((SELECT j FROM nf)), (public.browse_source_read('quiet_market')), (public.browse_source_read('days_only')),
               (public.browse_source_read('bat_sellers_x')), (public.browse_source_read('private_ledger')),
               (public.browse_source_read('no-such-source')), (public.browse_source_read(''))) v(j)),
  'where nothing is counted (not folded, a quiet source, a source only the Sources board knows, unknown_source) archived is 0 and the dated range is null');
SELECT pg_temp.check((SELECT count(*) = 29 FROM hk) AND (SELECT count(*) = 5
    AND bool_and(coalesce(pg_temp.hkeys(j) = (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM hk), false))
  FROM (VALUES ((SELECT j FROM nf)), ((SELECT j FROM r_src)), ((SELECT j FROM r_quiet)), (public.browse_source_read('days_only')),
               (public.browse_source_read('private_ledger'))) v(j)),
  'the holdings carry the contract''s 29 keys on every answer: not folded, ok, ok with nothing counted, a source only the Sources board knows, unknown_source');
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND j->'source'->>'name' = 'Sellers X' AND j->'source'->>'species' = 'private_seller'
  AND j->'source'->>'unit' = 'BaT lots' AND (j->'holdings'->>'episodes')::int = 0 AND (j->'holdings'->'board'->>'lots')::int = 123
  AND j->'makes' = '[]' AND j->'listings'->'rows' = '[]'
  FROM (SELECT public.browse_source_read('bat_sellers_x') AS j) x),
  'a board cohort of another venue''s lots is known by its name and its count and lists nothing');
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND (j->'holdings'->>'episodes')::int = 0
  FROM (SELECT public.browse_source_read('agg_site') AS j) x), 'a registered aggregator with no events is ok and empty');
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND j->'source'->>'slug' = 'dup-market' AND j->'source'->>'name' = 'Dup Market'
  AND j->'source'->>'species' = 'dealer' AND (j->'holdings'->>'episodes')::int = 1 AND (j->'holdings'->>'active')::int = 1
  FROM (SELECT public.browse_source_read('dup_market') AS j) x),
  'two registry rows of one key: the page is named by the row that has the species');

-- Not browsable: unknown_source, with the fold filled, whatever the platform holds. Nothing is named, counted or listed, even
-- with a make and a model asked for, and an owner source is not named although the Sources board counts it.
SELECT pg_temp.check((SELECT bool_and(j->>'status' = 'unknown_source' AND (j->'holdings'->>'episodes')::int = 0 AND j->'makes' = '[]'
  AND j->'models' = '[]' AND j->'listings'->'rows' = '[]' AND (j->'listings'->>'total')::int = 0
  AND j->'source'->'species' = 'null' AND j->'source'->'base_url' = 'null' AND j->'source'->'logo_url' = 'null'
  AND j->'holdings'->'board' = 'null' AND j->'holdings'->'landed_24h' = '0' AND j->'holdings'->'last_landed' = 'null')
  FROM (SELECT public.browse_source_read(s, m, mo) AS j FROM (VALUES
          ('ghost_platform', 'Chevrolet', 'Camaro'), ('Ghost-Platform', NULL, NULL), ('private_ledger', NULL, NULL),
          ('private_ledger', 'Pontiac', 'Firebird'), ('no_species_house', 'Buick', 'Riviera'), ('media_site', NULL, NULL),
          ('orphan_saved', 'AMC', 'Javelin'), ('orphan_market', NULL, NULL), ('unregistered-thing', NULL, NULL)) v(s, m, mo)) x),
  'an unregistered platform, an owner_private source, a source with no species, a media source and a channel of an absent market are unknown_source');
SELECT pg_temp.check((SELECT j->'source'->>'name' = 'private_ledger' AND j->'source'->>'slug' = 'private_ledger'
  FROM (SELECT public.browse_source_read('private_ledger') AS j) x),
  'and only the slug asked for comes back; the owner source''s display name and address are not sent');
SELECT pg_temp.check((SELECT public.browse_source_read('')->>'status' = 'unknown_source' AND public.browse_source_read(NULL)->>'status' = 'unknown_source'
  AND public.browse_source_read('!!!')->>'status' = 'unknown_source'), 'a blank or null slug is unknown_source, not an error');
SELECT pg_temp.check((SELECT j->>'status' = 'unknown_source' AND j->'source'->>'slug' = 'no-such-source' AND (j->'holdings'->>'episodes')::int = 0
  AND j->'makes' = '[]' FROM (SELECT public.browse_source_read('no-such-source') AS j) x), 'no registry row and no board row: unknown_source');

-- The registry is asked at every call. A source demoted after the fold is gone at once, whatever the fold holds; one
-- promoted is empty until the next fold; and the fold follows the registry at its next run.
UPDATE public.observation_sources SET species = 'owner_private' WHERE slug = 'test_market';
SELECT pg_temp.check((SELECT j->>'status' = 'unknown_source' AND (j->'holdings'->>'episodes')::int = 0 AND j->'source'->>'name' = 'test_market'
  AND (SELECT count(*) FROM public.mv_source_episodes WHERE nslug = 'testmarket') = 10
  FROM (SELECT public.browse_source_read('test_market', 'Ford', 'Mustang') AS j) x),
  'a source set to owner_private is unknown_source on the very next read, with its rows still in the fold');
SELECT public.source_holdings_refresh() IS NOT NULL AS refreshed;
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM public.mv_source_episodes WHERE nslug = 'testmarket')
  AND NOT EXISTS (SELECT 1 FROM public.mv_source_holdings WHERE nslug = 'testmarket')), 'and the next fold drops its episodes and its holdings');
UPDATE public.observation_sources SET species = 'auth_walled_marketplace' WHERE slug = 'test_market';
UPDATE public.observation_sources SET species = 'dealer' WHERE slug = 'no_species_house';
SELECT pg_temp.check((SELECT j->>'status' = 'ok' AND (j->'holdings'->>'episodes')::int = 0 FROM (SELECT public.browse_source_read('no_species_house') AS j) x),
  'a source given a species is ok at once and empty until the next fold');
SELECT public.source_holdings_refresh() IS NOT NULL AS refreshed;
SELECT pg_temp.check((SELECT (j->'holdings'->>'episodes')::int = 1 AND j->'makes'->0->>'make' = 'Buick' AND (j->'holdings'->>'active')::int = 1
  FROM (SELECT public.browse_source_read('no_species_house') AS j) x) AND (SELECT (j->'holdings'->>'episodes')::int = 10
  FROM (SELECT public.browse_source_read('test_market') AS j) x), 'the next fold brings it in (a live ask, touched now), and test_market is back');
UPDATE public.observation_sources SET species = NULL WHERE slug = 'no_species_house';
SELECT public.source_holdings_refresh() IS NOT NULL AS refreshed;
SELECT pg_temp.check((SELECT count(*) = 111 FROM public.mv_source_episodes), 'restored: 111 episodes');

-- A fold that lands nothing keeps the last good one: no vehicle public, or a registry that names no browsable source.
UPDATE public.vehicles SET is_public = false;
SELECT pg_temp.fails('SELECT public.source_holdings_refresh()', 'a fold that lands no episode while events exist must fail');
UPDATE public.vehicles SET is_public = true;
CREATE TEMP TABLE os_backup AS SELECT id, species FROM public.observation_sources;
UPDATE public.observation_sources SET species = NULL;
SELECT pg_temp.fails('SELECT public.source_holdings_refresh()', 'a registry with no browsable source lands no episode, so the fold must fail');
UPDATE public.observation_sources o SET species = b.species FROM os_backup b WHERE b.id = o.id;
SELECT pg_temp.check((SELECT (public.browse_source_read('test_market')->'holdings'->>'episodes')::int = 10), 'the last good fold stays after a failed refresh');
SELECT pg_temp.check((SELECT count(*) = 111 FROM public.mv_source_episodes), 'and its episodes');

-- Grants: anon reads the page and nothing else; the refresh, the views and the helpers are not for it.
SELECT pg_temp.check(has_function_privilege('anon', 'public.browse_source_read(text,text,text,integer,integer,text,text)', 'execute')
  AND has_function_privilege('authenticated', 'public.browse_source_read(text,text,text,integer,integer,text,text)', 'execute')
  AND has_function_privilege('service_role', 'public.browse_source_read(text,text,text,integer,integer,text,text)', 'execute'), 'anon, authenticated and service_role can read the page');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.source_holdings_refresh()', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.source_holdings_refresh()', 'execute')
  AND has_function_privilege('service_role', 'public.source_holdings_refresh()', 'execute'), 'only service_role refreshes the fold');
SELECT pg_temp.check(NOT has_table_privilege('anon', 'public.mv_source_holdings', 'select') AND NOT has_table_privilege('anon', 'public.mv_source_episodes', 'select')
  AND NOT has_table_privilege('authenticated', 'public.mv_source_holdings', 'select')
  AND has_table_privilege('service_role', 'public.mv_source_holdings', 'select'), 'the fold is read through the reader only');
SELECT pg_temp.check((SELECT bool_and(NOT has_function_privilege('anon', f, 'execute') AND NOT has_function_privilege('authenticated', f, 'execute')
                                      AND has_function_privilege('service_role', f, 'execute'))
  FROM unnest(ARRAY['public.browse_source_key_map()', 'public.browse_source_keys()', 'public.browse_source_when(text,boolean)',
                    'public.browse_source_clocks(timestamptz,timestamptz,jsonb)',
                    'public.browse_source_status(text,numeric,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)',
                    'public.browse_source_sold_price(text,numeric,text,integer,boolean)']) f),
  'the helpers list the whole registry and are not for anon or authenticated');
SET ROLE anon;
SELECT pg_temp.check((public.browse_source_read('test_market', 'Ford', 'Mustang')->'listings'->>'total')::int = 4, 'anon reads the page through the reader');
SELECT pg_temp.check(public.browse_source_read('private_ledger')->>'status' = 'unknown_source', 'and an owner source is unknown to it');
SELECT pg_temp.fails('SELECT count(*) FROM public.mv_source_holdings', 'anon cannot read the fold directly');
SELECT pg_temp.fails('SELECT public.source_holdings_refresh()', 'anon cannot refresh the fold');
SELECT pg_temp.fails('SELECT * FROM public.browse_source_key_map()', 'anon cannot read the key map');
SELECT pg_temp.fails('SELECT * FROM public.browse_source_keys()', 'anon cannot list the browsable keys');
RESET ROLE;

-- The helpers, by hand.
SELECT pg_temp.check((SELECT public.browse_source_when('2026-10-20') = '2026-10-20 00:00:00+00'::timestamptz
  AND public.browse_source_when('2026-10-20', true) = '2026-10-20 23:59:59+00'::timestamptz
  AND public.browse_source_when('2026-10-20T05:06:07.000Z', true) = '2026-10-20 05:06:07+00'::timestamptz
  AND public.browse_source_when('2026-10-20 05:06:07') = '2026-10-20 05:06:07+00'::timestamptz
  AND public.browse_source_when('2026-13-45 99:99') IS NULL AND public.browse_source_when('2026-02-30') IS NULL
  AND public.browse_source_when('today') IS NULL AND public.browse_source_when('infinity') IS NULL AND public.browse_source_when('now') IS NULL
  AND public.browse_source_when('0001-01-01') IS NULL AND public.browse_source_when('9999-12-31') IS NULL
  AND public.browse_source_when('') IS NULL AND public.browse_source_when(NULL) IS NULL),
  'one clock from a string: a date-shaped one, in UTC; junk, words, sentinels and nothing are no clock');
SET timezone = 'Asia/Tokyo';
SELECT pg_temp.check(public.browse_source_when('2026-10-20') = '2026-10-20 00:00:00+00'::timestamptz
  AND public.browse_source_when('2026-10-20 05:06:07') = '2026-10-20 05:06:07+00'::timestamptz, 'whatever the session''s time zone says');
RESET timezone;
SELECT pg_temp.check((SELECT c.listed_at = '2026-03-01 10:00:00+00' AND c.ends_at = '2026-03-02 10:00:00+00' AND c.happened_at = c.ends_at
  FROM public.browse_source_clocks('2026-03-01 10:00:00+00', '2026-03-02 10:00:00+00', '{"sale_ends_on": "2020-01-01", "listing_posted_at": "2019-01-01"}') c),
  'the columns outrank the metadata');
SELECT pg_temp.check((SELECT c.listed_at = '2019-01-01 00:00:00+00' AND c.ends_at = '2020-01-01 23:59:59+00' AND c.happened_at = c.ends_at
  FROM public.browse_source_clocks(NULL, NULL, '{"sale_ends_on": "2020-01-01", "listing_posted_at": "2019-01-01", "auction_date": "2018-01-01"}') c),
  'then the metadata: the posted date, the sale''s last day');
SELECT pg_temp.check((SELECT c.listed_at IS NULL AND c.ends_at = '2018-01-01 23:59:59+00' AND c.happened_at = c.ends_at
  FROM public.browse_source_clocks(NULL, NULL, '{"auction_date": "2018-01-01"}') c) AND
  (SELECT c.listed_at = '2017-05-05 00:00:00+00' AND c.ends_at IS NULL AND c.happened_at = c.listed_at
   FROM public.browse_source_clocks(NULL, NULL, '{"sale_starts_on": "2017-05-05"}') c) AND
  (SELECT c.listed_at IS NULL AND c.ends_at IS NULL AND c.happened_at IS NULL FROM public.browse_source_clocks(NULL, NULL, NULL) c) AND
  (SELECT c.listed_at IS NULL AND c.ends_at IS NULL AND c.happened_at IS NULL FROM public.browse_source_clocks(NULL, NULL, '"a string"') c) AND
  (SELECT c.listed_at IS NULL AND c.ends_at IS NULL FROM public.browse_source_clocks(NULL, NULL, '[1, 2]') c),
  'an auction day alone ends that day; a sale start alone is the listing date and the sort clock; nothing, a string or an array is no clock');
SELECT pg_temp.check(public.browse_source_status('sold', NULL, NULL, NULL, NULL, NULL, now()) = 'sold'
  AND public.browse_source_status(' SOLD ', NULL, NULL, NULL, NULL, NULL, now()) = 'sold'
  AND public.browse_source_status('unsold', 90000, now(), NULL, NULL, NULL, now()) = 'ended'
  AND public.browse_source_status('bid-goes-on', 15000, now(), NULL, NULL, NULL, now()) = 'ended'
  AND public.browse_source_status('active', NULL, NULL, NULL, now() + interval '1 hour', NULL, now()) = 'active'
  AND public.browse_source_status('active', NULL, NULL, NULL, now() - interval '1 second', now(), now()) = 'ended'
  AND public.browse_source_status('active', NULL, NULL, NULL, NULL, now() - interval '13 days', now()) = 'active'
  AND public.browse_source_status('active', NULL, NULL, NULL, NULL, now() - interval '15 days', now()) = 'unknown'
  AND public.browse_source_status('active', NULL, NULL, NULL, NULL, NULL, now()) = 'unknown'
  AND public.browse_source_status('upcoming', NULL, NULL, now() + interval '1 day', now() + interval '3 days', NULL, now()) = 'upcoming'
  AND public.browse_source_status('upcoming', NULL, NULL, NULL, now() + interval '3 days', NULL, now()) = 'upcoming'
  AND public.browse_source_status('upcoming', NULL, NULL, now() - interval '1 day', now() + interval '3 days', NULL, now()) = 'active'
  AND public.browse_source_status('upcoming', NULL, NULL, now() + interval '1 day', NULL, NULL, now()) = 'upcoming'
  AND public.browse_source_status('upcoming', NULL, NULL, now() - interval '1 day', NULL, now(), now()) = 'unknown'
  AND public.browse_source_status('listed', NULL, NULL, NULL, now() + interval '3 days', NULL, now()) = 'active'
  AND public.browse_source_status('listed', NULL, NULL, NULL, NULL, now(), now()) = 'unknown'
  AND public.browse_source_status('listed', NULL, NULL, NULL, now() - interval '1 day', now(), now()) = 'ended'
  AND public.browse_source_status('completed', 28000, NULL, NULL, NULL, NULL, now()) = 'sold'
  AND public.browse_source_status('none', NULL, now(), NULL, NULL, NULL, now()) = 'sold'
  AND public.browse_source_status('pending', NULL, NULL, NULL, NULL, NULL, now()) = 'unknown'
  AND public.browse_source_status(NULL, NULL, NULL, NULL, NULL, NULL, now()) = 'unknown'
  AND public.browse_source_status('', 0, NULL, NULL, NULL, NULL, now()) = 'unknown',
  'the status rule, case by case');
SELECT pg_temp.check(public.browse_source_sold_price('sold', 45000, 'available', NULL, false) = 45000
  AND public.browse_source_sold_price('sold', NULL, 'sold', 61000, true) = 61000
  AND public.browse_source_sold_price('sold', NULL, 'sold', 61000, false) IS NULL
  AND public.browse_source_sold_price('sold', NULL, 'sold', 61000, NULL) IS NULL
  AND public.browse_source_sold_price('sold', 0, 'sold', 61000, true) = 61000
  AND public.browse_source_sold_price('sold', NULL, 'available', 61000, true) IS NULL
  AND public.browse_source_sold_price('ended', 90000, 'sold', 61000, true) IS NULL,
  'the sold price: the event''s, else the vehicle''s when it is sold and of this source; nothing on any other status');
-- The alias pairs below are the board's own mapping data, spelled as the registry spells them.
SELECT pg_temp.check((SELECT array_agg(raw_key || '>' || canon_key ORDER BY raw_key) FILTER (WHERE raw_key IN ('ebay', 'hagerty', 'sbx', 'classiccars',
    'bringatrailer', 'wwwoldcaronlinecom', 'wwwvanguardmotorsalescom', 'wwwgatewayclassiccarscom', 'wwwvelocityrestorationscom', 'testmarketsaved',
    'testmarket', 'chanmarketsaved', 'orphansaved')) = ARRAY['bringatrailer>bat', 'chanmarketsaved>chanmarket', 'classiccars>classiccarscom',
    'ebay>ebaymotors', 'hagerty>hagertymarketplace', 'orphansaved>orphanmarket', 'sbx>sbxcars', 'testmarket>testmarket',
    'testmarketsaved>testmarket', 'wwwgatewayclassiccarscom>gatewayclassiccars', 'wwwoldcaronlinecom>oldcaronline',
    'wwwvanguardmotorsalescom>vanguardmotorsales', 'wwwvelocityrestorationscom>velocityrestorations']
  FROM public.browse_source_key_map()), 'the one source key: the registry''s channels, the board''s aliases, everything else itself');
SELECT pg_temp.check((SELECT count(*) = count(DISTINCT raw_key) FROM public.browse_source_key_map()), 'one key per spelling');
SELECT pg_temp.check((SELECT array_agg(nslug ORDER BY nslug) = ARRAY['aggsite', 'bulkmarket', 'chanmarket', 'dupmarket', 'ebaymotors', 'edgemarket',
                                                                    'oldcaronline', 'othermarket', 'quietmarket', 'rulesmarket', 'testmarket']
  FROM public.browse_source_keys()), 'the browsable keys: the market-level registry rows of an allowed species, and no other');

-- The schedule: no cron schema here, so the migration skipped it; with one, the job is there once however often it applies.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_job bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = p_job RETURNING true $$;
INSERT INTO cron.job (jobname, schedule, command) VALUES ('source-holdings-refresh', '0 0 * * *', 'select 1');
\ir ../migrations/20261021193000_source_holdings_fold.sql
\ir ../migrations/20261021193000_source_holdings_fold.sql
SELECT pg_temp.check((SELECT count(*) = 1 AND min(schedule) = '35 10 * * *'
  AND min(command) = 'SET statement_timeout = ''20min''; SELECT public.source_holdings_refresh();' FROM cron.job WHERE jobname = 'source-holdings-refresh'),
  'one job at 10:35 UTC with its own 20 minute timeout, replacing an older one');
SELECT pg_temp.check((SELECT bool_and(relispopulated) FROM pg_class WHERE oid IN ('public.mv_source_episodes'::regclass, 'public.mv_source_holdings'::regclass))
  AND (public.browse_source_read('test_market')->'holdings'->>'episodes')::int = 10, 'applying the migration again leaves the fold in place');

-- Definitions. Every function pins search_path; only the reader and the refresh are SECURITY DEFINER; the reader sets no
-- statement_timeout (a function-level setting does not re-arm the running statement, so it would only look like a guard: the anon
-- role's own 15 s is the cap) and declares no %ROWTYPE of the fold (that opens the view when the function compiles, which waits for
-- the exclusive lock of a plain fill, so a reader on a new connection stalls for the whole first fill).
SELECT pg_temp.check((SELECT count(*) = 8 AND bool_and(coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false))
    AND count(*) FILTER (WHERE p.prosecdef) = 2
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'browse\_source\_%' OR p.proname = 'source_holdings_refresh')),
  'the reader, the refresh and the six helpers pin search_path; only the reader and the refresh are SECURITY DEFINER');
SELECT pg_temp.check((SELECT NOT coalesce(p.proconfig::text ~ 'statement_timeout', false) AND p.prosrc !~* 'ROWTYPE'
  FROM pg_proc p WHERE p.oid = 'public.browse_source_read(text,text,text,integer,integer,text,text)'::regprocedure),
  'the reader sets no statement_timeout of its own and declares no ROWTYPE of the fold');

SELECT 'browse_source_read contract passed' AS result;
