-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_actor_profile -f this-file.sql
-- Proves that actor_profile_read returns an organization as a kit document of measures for any caller:
-- sell-through on known outcomes with its percent rank among organizations with five or more known outcomes,
-- per-listing means with their ranks, decade and make concentration against the market, open books as presence
-- counts with no amount anywhere in the document, vehicles by role; that private organizations, private or
-- deleted vehicles and unread kinds contribute nothing; and that anon may call it. The seeds are a disposable
-- test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The tables and the market reader the function reads, with the columns it uses.
CREATE TABLE public.organizations (id uuid PRIMARY KEY, business_name text, business_type text, city text, state text,
  zip_code text, is_public boolean DEFAULT true);
CREATE TABLE public.organization_seller_stats (organization_id uuid PRIMARY KEY, total_listings integer, total_sold integer,
  total_unsold integer, avg_bid_count numeric, avg_comment_count numeric, avg_view_count numeric,
  calculated_at timestamptz DEFAULT '2026-10-13T23:50:00Z', evidence_summary jsonb DEFAULT '{}');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, is_public boolean DEFAULT true, deleted_at timestamptz,
  sale_price numeric, sold_price numeric, bat_sold_price numeric, purchase_price numeric, bat_seller text, auction_outcome text);
CREATE TABLE public.external_identities (id uuid PRIMARY KEY, platform text, handle text, display_name text);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, author_external_identity_id uuid, comment_type text);
CREATE TABLE public.mv_bidder_profiles (bat_username text PRIMARY KEY, total_bids bigint, auctions_entered bigint, wins bigint,
  win_rate numeric, avg_bid numeric, max_bid numeric, first_seen timestamp, last_seen timestamp);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid, relationship_type text, status text);
-- The market: 1970s are 10% and 1990s 40% of the year counts; Chevrolet is 20% of resolved makes.
CREATE FUNCTION public.market_pulse(p_dimension text, p_limit integer DEFAULT 60)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, image_url text) LANGUAGE sql STABLE AS $$
  SELECT t.name, t.count, x.value, x.median_price, x.image_url FROM (VALUES
    ('year', '1975', 100::bigint), ('year', '1995', 400::bigint), ('year', '2005', 500::bigint), ('year', 'Unknown', 999::bigint),
    ('make', 'Chevrolet', 200::bigint), ('make', 'Ford', 300::bigint), ('make', 'Toyota', 500::bigint), ('make', 'Unresolved', 9999::bigint)
  ) t(dim, name, count)
  CROSS JOIN LATERAL (SELECT NULL::bigint, NULL::bigint, NULL::text) x(value, median_price, image_url)
  WHERE t.dim = p_dimension
$$;

\ir ../migrations/20261014001500_actor_profile_read.sql
\ir ../migrations/20261014013000_actor_profile_read_identities.sql

-- Seeds. O1 is public, the subject. O2..O6 fill the cohort (five or more known outcomes each); O7 has too few
-- outcomes to rank; O9 is private.
INSERT INTO public.organizations (id, business_name, business_type, city, state, zip_code, is_public) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'Desert Classics', 'dealer', 'Boulder City', 'NV', '89005', true),
 ('00000000-0000-0000-0000-0000000000a2', 'Peer Two', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000a3', 'Peer Three', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000a4', 'Peer Four', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000a5', 'Peer Five', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000a6', 'Peer Six', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000a9', 'Private Garage LLC', 'dealer', 'Henderson', 'NV', '89002', false);
INSERT INTO public.organization_seller_stats (organization_id, total_listings, total_sold, total_unsold, avg_bid_count, avg_comment_count, avg_view_count, evidence_summary) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 20, 9, 1, 50, 30, 3000, '{"outcome_conflicts": 2}'),  -- 90% sell-through
 ('00000000-0000-0000-0000-0000000000a2', 40, 5, 5, 10, 10, 9000, '{}'),                         -- 50%
 ('00000000-0000-0000-0000-0000000000a3', 30, 6, 4, 20, 20, 8000, '{}'),                         -- 60%
 ('00000000-0000-0000-0000-0000000000a4', 10, 7, 3, 30, 25, 7000, '{}'),                         -- 70%
 ('00000000-0000-0000-0000-0000000000a5', 50, 8, 2, 40, 35, 6000, '{}'),                         -- 80%
 ('00000000-0000-0000-0000-0000000000a6', 60, 19, 1, 60, 40, 5000, '{}'),                        -- 95%
 ('00000000-0000-0000-0000-0000000000a7', 3, 2, 1, 99, 99, 99, '{}'),                            -- 3 outcomes: not ranked
 ('00000000-0000-0000-0000-0000000000a9', 9, 9, 0, 1, 1, 1, '{}');
-- O1's vehicles: v1..v4 1970s Chevrolet, v5 1990s Ford, v6 private (excluded), v7 deleted (excluded),
-- v8 a work_location link only (excluded from the vehicle set, counted in the role table).
INSERT INTO public.vehicles (id, year, make, is_public, deleted_at, sale_price, sold_price, bat_sold_price, purchase_price) VALUES
 ('00000000-0000-0000-0000-000000000001', 1972, 'Chevrolet', true, NULL, 41001, NULL, NULL, 23001),  -- sold, amount, cost
 ('00000000-0000-0000-0000-000000000002', 1974, 'chevrolet ', true, NULL, NULL, NULL, 52002, NULL),   -- sold, amount
 ('00000000-0000-0000-0000-000000000003', 1976, 'Chevrolet', true, NULL, NULL, NULL, NULL, NULL),     -- sold, no amount
 ('00000000-0000-0000-0000-000000000004', 1978, 'Chevrolet', true, NULL, NULL, NULL, NULL, 17004),    -- held, cost
 ('00000000-0000-0000-0000-000000000005', 1995, 'Ford', true, NULL, NULL, NULL, NULL, NULL),          -- held, no cost
 ('00000000-0000-0000-0000-000000000006', 1971, 'Chevrolet', false, NULL, 99006, NULL, NULL, 99006),  -- private
 ('00000000-0000-0000-0000-000000000007', 1973, 'Chevrolet', true, '2026-01-01', 99007, NULL, NULL, 99007), -- deleted
 ('00000000-0000-0000-0000-000000000008', 2005, 'Toyota', true, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.organization_vehicles VALUES
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'sold_by', 'past'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'owner', 'sold'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'consigner', 'sold'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'sold_by', 'active'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000004', 'owner', 'active'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000005', 'consigner', 'active'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000006', 'owner', 'active'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000007', 'owner', 'active'),
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000008', 'work_location', 'active');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;
CREATE FUNCTION public.t_measure(d jsonb, p_stack text, p_label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT m FROM jsonb_array_elements(d->'sections') sec, jsonb_array_elements(sec->'items') m
   WHERE sec->>'stack' = p_stack AND m->>'label' = p_label $$;
GRANT EXECUTE ON FUNCTION public.t_measure(jsonb, text, text) TO anon;

SET ROLE anon;
DO $$
DECLARE d jsonb; m jsonb; tbl jsonb;
BEGIN
  d := public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000a1');
  PERFORM public.t_assert(d IS NOT NULL, 'anon reads a public organization');
  PERFORM public.t_assert(d->'subject'->>'name' = 'Desert Classics' AND d->'subject'->>'place' = 'Boulder City, NV' AND d->'subject'->>'zip' = '89005', format('subject; got %s', d->'subject'));
  PERFORM public.t_assert(d->>'viewer' = 'anon', 'one public projection');

  -- Performance: 9 of 10 known outcomes; the cohort is O1..O6 (O7 has three outcomes). Sell-throughs below 90%:
  -- 50, 60, 70, 80 → percent rank 4 / (6 - 1) = 80.
  m := public.t_measure(d, 'performance', 'Sell-through');
  PERFORM public.t_assert((m->>'value')::numeric = 90.0, format('sell-through 90.0; got %s', m));
  PERFORM public.t_assert((m->'rank'->>'p')::numeric = 80.0 AND (m->'rank'->>'n')::int = 6, format('sell-through rank P80 of 6; got %s', m->'rank'));
  PERFORM public.t_assert((m->'coverage'->>'n')::int = 10 AND (m->'coverage'->>'of')::int = 20, format('known outcomes 10 of 20 listings; got %s', m->'coverage'));
  PERFORM public.t_assert(m->>'method' LIKE '%2 listings carry conflicting outcomes%', 'conflicts named in the method');
  -- Bids per listing 50 against 10, 20, 30, 40, 60 → four below → P80; views 3000 is the lowest → P0.
  PERFORM public.t_assert((public.t_measure(d, 'performance', 'Bids per listing')->'rank'->>'p')::numeric = 80.0, 'bids rank P80');
  PERFORM public.t_assert((public.t_measure(d, 'performance', 'Views per listing')->'rank'->>'p')::numeric = 0.0, 'views rank P0');

  -- Specialization: O1's public, undeleted owner/seller/consigner vehicles are v1..v5 (v6 private, v7 deleted, v8
  -- work_location only). 1970s: 4 of 5 = 80% against the market's 100 of 1000 dated = 10% → 8.0×.
  m := public.t_measure(d, 'specialization', '1970s');
  PERFORM public.t_assert((m->>'value')::numeric = 8.0 AND (m->'coverage'->>'n')::int = 4 AND (m->'coverage'->>'of')::int = 5, format('1970s 8.0x on 4 of 5; got %s', m));
  -- Chevrolet: 4 of 5 = 80% against 200 of 1000 resolved makes = 20% → 4.0× ('chevrolet ' trims and folds case).
  m := public.t_measure(d, 'specialization', 'Chevrolet');
  PERFORM public.t_assert((m->>'value')::numeric = 4.0 AND (m->'coverage'->>'n')::int = 4, format('Chevrolet 4.0x on 4; got %s', m));

  -- Open books: sold v1, v2, v3 (any sold link), 2 with an amount; held v4, v5, 1 with a cost; v1 carries both.
  m := public.t_measure(d, 'open_books', 'Sales with a recorded amount');
  PERFORM public.t_assert((m->>'value')::numeric = 66.7 AND (m->'coverage'->>'n')::int = 2 AND (m->'coverage'->>'of')::int = 3, format('sales 2 of 3; got %s', m));
  m := public.t_measure(d, 'open_books', 'Holdings with a recorded cost');
  PERFORM public.t_assert((m->>'value')::numeric = 50.0 AND (m->'coverage'->>'of')::int = 2, format('holdings 1 of 2; got %s', m));
  PERFORM public.t_assert((public.t_measure(d, 'open_books', 'Return computable')->>'value')::int = 1, 'return computable on one vehicle');
  -- No amount leaves the function: none of the seeded prices appears anywhere in the document.
  PERFORM public.t_assert(d::text !~ '(41001|52002|23001|17004|99006|99007)', 'no amount anywhere in the document');

  -- Vehicles by role: links to public, undeleted vehicles only (v6, v7 excluded), work_location included.
  SELECT sec INTO tbl FROM jsonb_array_elements(d->'sections') sec WHERE sec->>'kind' = 'table';
  PERFORM public.t_assert((tbl->'coverage'->>'n')::int = 7, format('seven links to public vehicles; got %s', tbl->'coverage'));

  -- Nothing for a private organization, an unknown id or a kind this version does not read.
  PERFORM public.t_assert(public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000a9') IS NULL, 'private organization reads as nothing');
  PERFORM public.t_assert(public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000ff') IS NULL, 'unknown id reads as nothing');
  PERFORM public.t_assert(public.actor_profile_read('person', '00000000-0000-0000-0000-0000000000a1') IS NULL, 'unread kind reads as nothing');
END $$;

-- An organization with too few known outcomes gets its numbers with no rank.
RESET ROLE;
INSERT INTO public.organizations (id, business_name, business_type, is_public) VALUES ('00000000-0000-0000-0000-0000000000a7', 'Small Lot', 'dealer', true);
SET ROLE anon;
SELECT public.t_assert(public.t_measure(public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000a7'), 'performance', 'Sell-through')->'rank' = 'null'::jsonb,
  'fewer than five known outcomes: a value, no rank');
RESET ROLE;

-- The identity kind. S1 is a seller handle with four listed public vehicles (3 sold, 1 reserve not met), one
-- private and one deleted listing (excluded) and a listing under a handle that differs only by case (excluded);
-- 5 comments on 2 lots, 4 of them seller responses; it also bid. B1..B4 fill the bidder cohort (five or more
-- auctions entered); B9 entered three and is not ranked.
INSERT INTO public.external_identities VALUES
 ('00000000-0000-0000-0000-0000000000e1', 'bat', 'DesertSeller', 'DesertSeller'),
 ('00000000-0000-0000-0000-0000000000e2', 'bat', 'quietlurker', NULL);
INSERT INTO public.vehicles (id, year, make, is_public, deleted_at, bat_seller, auction_outcome) VALUES
 ('00000000-0000-0000-0000-000000000101', 1970, 'Ford', true, NULL, 'DesertSeller', 'sold'),
 ('00000000-0000-0000-0000-000000000102', 1971, 'Ford', true, NULL, 'DesertSeller', 'sold'),
 ('00000000-0000-0000-0000-000000000103', 1972, 'Ford', true, NULL, 'DesertSeller', 'sold'),
 ('00000000-0000-0000-0000-000000000104', 1973, 'Ford', true, NULL, 'DesertSeller', 'reserve_not_met'),
 ('00000000-0000-0000-0000-000000000105', 1974, 'Ford', false, NULL, 'DesertSeller', 'sold'),
 ('00000000-0000-0000-0000-000000000106', 1975, 'Ford', true, '2026-01-01', 'DesertSeller', 'sold'),
 ('00000000-0000-0000-0000-000000000107', 1976, 'Ford', true, NULL, 'desertseller', 'sold');
INSERT INTO public.auction_comments (vehicle_id, author_external_identity_id, comment_type) VALUES
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000e1', 'observation');
INSERT INTO public.mv_bidder_profiles VALUES
 ('DesertSeller', 60, 20, 5, 0.25, NULL, NULL, '2015-01-01', '2026-02-01'),
 ('B1', 10, 10, 1, 0.10, NULL, NULL, '2015-01-01', '2026-01-01'),
 ('B2', 40, 20, 2, 0.10, NULL, NULL, '2015-01-01', '2026-01-01'),
 ('B3', 90, 30, 9, 0.30, NULL, NULL, '2015-01-01', '2026-01-01'),
 ('B4', 25, 5, 0, 0.00, NULL, NULL, '2015-01-01', '2026-02-09'),
 ('B9', 3, 3, 3, 1.00, NULL, NULL, '2015-01-01', '2026-01-01');
SET ROLE anon;
DO $$
DECLARE d jsonb; m jsonb; sec jsonb;
BEGIN
  d := public.actor_profile_read('identity', '00000000-0000-0000-0000-0000000000e1');
  PERFORM public.t_assert(d->'subject'->>'kind' = 'identity' AND d->'subject'->>'name' = 'DesertSeller' AND d->'subject'->>'type' = 'bat', format('identity subject; got %s', d->'subject'));
  -- Selling: four public, undeleted listings under the exact handle; 3 sold, 1 reserve not met: 75.0, no rank.
  PERFORM public.t_assert((public.t_measure(d, 'performance', 'Vehicles listed')->>'value')::int = 4, 'four public listings under the exact handle');
  m := public.t_measure(d, 'performance', 'Sell-through');
  PERFORM public.t_assert((m->>'value')::numeric = 75.0 AND m->'rank' = 'null'::jsonb AND (m->'coverage'->>'n')::int = 4, format('sell-through 75.0, no rank; got %s', m));
  -- Bidding: the cohort is DesertSeller, B1, B2, B3, B4. Auctions entered 20 against 10, 20, 30, 5: two below, so
  -- 2 / 4 = 50.0. Win rate 0.25 against 0.10, 0.10, 0.30, 0.00: three below, so 75.0. Dated 2026-02-09.
  m := public.t_measure(d, 'bidding', 'Auctions entered');
  PERFORM public.t_assert((m->>'value')::int = 20 AND (m->'rank'->>'p')::numeric = 50.0 AND (m->'rank'->>'n')::int = 5, format('auctions entered P50 of 5; got %s', m));
  m := public.t_measure(d, 'bidding', 'Win rate');
  PERFORM public.t_assert((m->>'value')::numeric = 25.0 AND (m->'rank'->>'p')::numeric = 75.0, format('win rate 25.0 at P75; got %s', m));
  PERFORM public.t_assert(m->'coverage'->>'as_of' LIKE '2026-02-09%', format('dated by the snapshot; got %s', m->'coverage'));
  -- Talking: 5 comments on 2 lots; 4 seller responses over 4 listed vehicles: 1.0.
  m := public.t_measure(d, 'talking', 'Comments');
  PERFORM public.t_assert((m->>'value')::int = 5 AND (m->'coverage'->>'n')::int = 2, format('5 comments on 2 lots; got %s', m));
  PERFORM public.t_assert((public.t_measure(d, 'talking', 'Answers to bidders per listed vehicle')->>'value')::numeric = 1.0, 'one answer per listed vehicle');

  -- An identity that never sold, bid or commented reads with empty sections, never an error.
  d := public.actor_profile_read('identity', '00000000-0000-0000-0000-0000000000e2');
  PERFORM public.t_assert(d->'subject'->>'name' = 'quietlurker', 'display name falls back to the handle');
  SELECT s INTO sec FROM jsonb_array_elements(d->'sections') s WHERE s->>'stack' = 'bidding';
  PERFORM public.t_assert(jsonb_array_length(sec->'items') = 0 AND (sec->'coverage'->>'n')::int = 0, format('no bids: an empty section; got %s', sec));
  PERFORM public.t_assert(public.actor_profile_read('identity', '00000000-0000-0000-0000-0000000000ff') IS NULL, 'unknown identity reads as nothing');
  -- The organization kind is unchanged by the second migration.
  PERFORM public.t_assert((public.t_measure(public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000a1'), 'performance', 'Sell-through')->>'value')::numeric = 90.0, 'organization kind unchanged');
END $$;
RESET ROLE;
SELECT 'actor_profile_read contract: PASS' AS result;
