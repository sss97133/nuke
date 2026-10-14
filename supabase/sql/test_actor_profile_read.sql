-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_actor_profile -f this-file.sql
-- Proves actor_profile_read for both kinds, as anon, one public projection, no amount anywhere:
--   an organization with a linked Bring a Trailer handle sells from its listing pages, the same number the handle's
--   identity read gives (case variants of the handle counted once); an organization with no link falls back to the
--   seller-stats fold, ranked among public selling organizations with venues excluded, its conflicts named and its
--   clock the inputs' extraction; a venue is not aggregated; bidding shows values with the snapshot's date and no
--   percentile; answers to bidders count only on the actor's own listings; specialization and open books as before;
--   the superseded org reader is revoked; private organizations, unknown ids and unread kinds read as nothing.
-- The seeds are a disposable test database's rows, never production testimony.
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

-- The tables and readers the function reads, with the columns it uses.
CREATE TABLE public.organizations (id uuid PRIMARY KEY, business_name text, business_type text, city text, state text,
  zip_code text, is_public boolean DEFAULT true);
CREATE TABLE public.organization_seller_stats (organization_id uuid PRIMARY KEY, total_listings integer, total_sold integer,
  total_unsold integer, avg_bid_count numeric, avg_comment_count numeric, avg_view_count numeric,
  calculated_at timestamptz DEFAULT '2026-10-13T23:50:00Z', evidence_summary jsonb DEFAULT '{}');
CREATE TABLE public.organization_external_profiles (organization_id uuid, platform text, username text);
CREATE TABLE public.external_identities (id uuid PRIMARY KEY, platform text, handle text, display_name text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, is_public boolean DEFAULT true, deleted_at timestamptz,
  sale_price numeric, sold_price numeric, bat_sold_price numeric, purchase_price numeric);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid, relationship_type text, status text);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text, event_type text,
  event_status text, seller_external_identity_id uuid, created_at timestamptz DEFAULT '2026-09-30T00:00:00Z');
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, author_external_identity_id uuid, comment_type text);
CREATE TABLE public.mv_bidder_profiles (bat_username text PRIMARY KEY, total_bids bigint, auctions_entered bigint, wins bigint,
  win_rate numeric, avg_bid numeric, max_bid numeric, first_seen timestamp, last_seen timestamp);
-- The market: 1970s are 10% of dated records; Ford is 30% of resolved makes.
CREATE FUNCTION public.market_pulse(p_dimension text, p_limit integer DEFAULT 60)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, image_url text) LANGUAGE sql STABLE AS $$
  SELECT t.name, t.count, x.value, x.median_price, x.image_url FROM (VALUES
    ('year', '1975', 100::bigint), ('year', '1995', 400::bigint), ('year', '2005', 500::bigint), ('year', 'Unknown', 999::bigint),
    ('make', 'Chevrolet', 200::bigint), ('make', 'Ford', 300::bigint), ('make', 'Toyota', 500::bigint), ('make', 'Unresolved', 9999::bigint)
  ) t(dim, name, count)
  CROSS JOIN LATERAL (SELECT NULL::bigint, NULL::bigint, NULL::text) x(value, median_price, image_url)
  WHERE t.dim = p_dimension
$$;
-- The superseded reader, as production has it: executable by anyone.
CREATE FUNCTION public.get_org_profile_fast(p_org_id uuid) RETURNS json LANGUAGE sql AS $$ SELECT NULL::json $$;
GRANT EXECUTE ON FUNCTION public.get_org_profile_fast(uuid) TO anon, authenticated;

\ir ../migrations/20261014001500_actor_profile_read.sql

-- Seeds.
--   D  dealer, public, linked to the handle DesertSeller (stored under two case variants), 5 public vehicles
--   U  a dealer with stats and no linked handle (the fallback); F1..F4 the public selling cohort
--   B  a venue (auction house) with stats; X private with stats
INSERT INTO public.organizations (id, business_name, business_type, city, state, zip_code, is_public) VALUES
 ('00000000-0000-0000-0000-0000000000d1', 'Desert Classics', 'dealer', 'Boulder City', 'NV', '89005', true),
 ('00000000-0000-0000-0000-0000000000c1', 'Unlinked Motors', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000f1', 'Peer One', NULL, NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000f2', 'Peer Two', NULL, NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000f3', 'Peer Three', 'dealer', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000f4', 'Peer Four', NULL, NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000b1', 'Big Auction Site', 'auction_house', NULL, NULL, NULL, true),
 ('00000000-0000-0000-0000-0000000000a9', 'Private Garage LLC', 'dealer', 'Henderson', 'NV', '89002', false);
INSERT INTO public.organization_seller_stats (organization_id, total_listings, total_sold, total_unsold, evidence_summary) VALUES
 ('00000000-0000-0000-0000-0000000000d1', 20, 9, 1, '{}'),
 ('00000000-0000-0000-0000-0000000000c1', 20, 9, 1, '{"outcome_conflicts": 2, "identity_conflicts": 7, "latest_input_extracted_at": "2026-09-30T22:37:04+00:00"}'),
 ('00000000-0000-0000-0000-0000000000f1', 40, 5, 5, '{}'),
 ('00000000-0000-0000-0000-0000000000f2', 30, 6, 4, '{}'),
 ('00000000-0000-0000-0000-0000000000f3', 10, 7, 3, '{}'),
 ('00000000-0000-0000-0000-0000000000f4', 50, 8, 2, '{}'),
 ('00000000-0000-0000-0000-0000000000b1', 900, 899, 1, '{}'),
 ('00000000-0000-0000-0000-0000000000a9', 9, 9, 0, '{}');
INSERT INTO public.organization_external_profiles VALUES
 ('00000000-0000-0000-0000-0000000000d1', 'bringatrailer', 'DesertSeller');
INSERT INTO public.external_identities VALUES
 ('00000000-0000-0000-0000-0000000000e1', 'bat', 'DesertSeller', 'DesertSeller'),
 ('00000000-0000-0000-0000-0000000000e4', 'bat', 'desertseller', NULL),
 ('00000000-0000-0000-0000-0000000000e2', 'bat', 'quietlurker', NULL),
 ('00000000-0000-0000-0000-0000000000e3', 'bat', 'someoneelse', NULL);
-- D's listing pages: A sold; B ended then sold; C sold, also under a URL variant; D ended unsold; D2 its relist,
-- sold, recorded under the lowercase variant; E only pending. Six listings over five vehicles; 4 sold, 1 unsold.
-- Another identity's listing and a non-auction event are excluded.
INSERT INTO public.vehicle_events (vehicle_id, source_url, event_type, event_status, seller_external_identity_id, created_at) VALUES
 ('00000000-0000-0000-0000-000000000101', 'https://bringatrailer.com/listing/a', 'auction', 'sold', '00000000-0000-0000-0000-0000000000e1', '2026-09-01'),
 ('00000000-0000-0000-0000-000000000102', 'https://bringatrailer.com/listing/b', 'auction', 'ended', '00000000-0000-0000-0000-0000000000e1', '2026-09-02'),
 ('00000000-0000-0000-0000-000000000102', 'https://bringatrailer.com/listing/b', 'auction', 'sold', '00000000-0000-0000-0000-0000000000e1', '2026-09-03'),
 ('00000000-0000-0000-0000-000000000103', 'https://bringatrailer.com/listing/c', 'auction', 'sold', '00000000-0000-0000-0000-0000000000e1', '2026-09-04'),
 ('00000000-0000-0000-0000-000000000103', 'https://BringATrailer.com/listing/c/?utm=x', 'auction', 'sold', '00000000-0000-0000-0000-0000000000e1', '2026-09-05'),
 ('00000000-0000-0000-0000-000000000104', 'https://bringatrailer.com/listing/d', 'auction', 'ended', '00000000-0000-0000-0000-0000000000e1', '2026-09-06'),
 ('00000000-0000-0000-0000-000000000104', 'https://bringatrailer.com/listing/d-2', 'auction', 'sold', '00000000-0000-0000-0000-0000000000e4', '2026-09-20'),
 ('00000000-0000-0000-0000-000000000105', 'https://bringatrailer.com/listing/e', 'auction', 'pending', '00000000-0000-0000-0000-0000000000e1', '2026-09-08'),
 ('00000000-0000-0000-0000-000000000106', 'https://bringatrailer.com/listing/f', 'auction', 'sold', '00000000-0000-0000-0000-0000000000e3', '2026-09-09'),
 ('00000000-0000-0000-0000-000000000101', 'https://bringatrailer.com/listing/a', 'service', 'sold', '00000000-0000-0000-0000-0000000000e1', '2026-09-10');
-- Comments: 4 answers on D's own listed vehicles, 1 answer on another seller's vehicle (not counted), 1 observation.
INSERT INTO public.auction_comments (vehicle_id, author_external_identity_id, comment_type) VALUES
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000e4', 'seller_response'),
 ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000e1', 'seller_response'),
 ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000e1', 'observation');
INSERT INTO public.mv_bidder_profiles VALUES
 ('DesertSeller', 60, 20, 5, 0.25, NULL, NULL, '2015-01-01', '2026-02-01'),
 ('desertseller', 10, 5, 1, 0.20, NULL, NULL, '2015-01-01', '2026-01-01'),
 ('B4', 25, 5, 0, 0.00, NULL, NULL, '2015-01-01', '2026-02-09'),
 ('B5', 50, 30, 9, 0.30, NULL, NULL, '2015-01-01', '2026-01-15'),
 ('B9', 3, 3, 3, 1.00, NULL, NULL, '2015-01-01', '2026-01-01');
-- D's vehicles: 101..104 Ford of the 1970s, 105 a 1995 Chevrolet (public, undeleted); 107 private, 108 deleted.
INSERT INTO public.vehicles (id, year, make, is_public, deleted_at, sale_price, sold_price, bat_sold_price, purchase_price) VALUES
 ('00000000-0000-0000-0000-000000000101', 1970, 'Ford', true, NULL, 41001, NULL, NULL, 23001),
 ('00000000-0000-0000-0000-000000000102', 1971, 'Ford', true, NULL, NULL, NULL, 52002, NULL),
 ('00000000-0000-0000-0000-000000000103', 1972, 'ford ', true, NULL, NULL, NULL, NULL, NULL),
 ('00000000-0000-0000-0000-000000000104', 1973, 'Ford', true, NULL, NULL, NULL, NULL, 17004),
 ('00000000-0000-0000-0000-000000000105', 1995, 'Chevrolet', true, NULL, NULL, NULL, NULL, NULL),
 ('00000000-0000-0000-0000-000000000107', 1974, 'Ford', false, NULL, 99007, NULL, NULL, 99007),
 ('00000000-0000-0000-0000-000000000108', 1975, 'Ford', true, '2026-01-01', 99008, NULL, NULL, 99008);
INSERT INTO public.organization_vehicles VALUES
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000101', 'sold_by', 'past'),
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000102', 'consigner', 'sold'),
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000103', 'sold_by', 'active'),
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000104', 'owner', 'active'),
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000105', 'consigner', 'active'),
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000107', 'owner', 'active'),
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000108', 'owner', 'active'),
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000101', 'consigner', 'active');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;
CREATE FUNCTION public.t_measure(d jsonb, p_stack text, p_label text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT m FROM jsonb_array_elements(d->'sections') sec, jsonb_array_elements(sec->'items') m
   WHERE sec->>'stack' = p_stack AND m->>'label' = p_label $$;
GRANT EXECUTE ON FUNCTION public.t_measure(jsonb, text, text) TO anon;
CREATE FUNCTION public.t_section(d jsonb, p_stack text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT sec FROM jsonb_array_elements(d->'sections') sec WHERE sec->>'stack' = p_stack $$;
GRANT EXECUTE ON FUNCTION public.t_section(jsonb, text) TO anon;

SET ROLE anon;
DO $$
DECLARE d jsonb; i jsonb; m jsonb; sec jsonb;
BEGIN
  -- 1. The linked dealer sells from its listing pages: six listings over five vehicles, 4 sold of 5 with an outcome.
  d := public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000d1');
  PERFORM public.t_assert(d->'subject'->>'name' = 'Desert Classics' AND (d->'subject'->>'handles')::int = 2 AND d->'subject'->>'venue' = 'false', format('dealer subject; got %s', d->'subject'));
  PERFORM public.t_assert((public.t_measure(d, 'performance', 'Listings')->>'value')::int = 6, format('six listings; got %s', public.t_measure(d, 'performance', 'Listings')));
  PERFORM public.t_assert((public.t_measure(d, 'performance', 'Vehicles')->>'value')::int = 5, 'five vehicles behind them');
  m := public.t_measure(d, 'performance', 'Sell-through');
  PERFORM public.t_assert((m->>'value')::numeric = 80.0 AND m->'rank' = 'null'::jsonb AND (m->'coverage'->>'n')::int = 5 AND (m->'coverage'->>'of')::int = 6, format('sell-through 80.0 on 5 of 6; got %s', m));
  PERFORM public.t_assert(m->'coverage'->>'as_of' LIKE '2026-09-20%', format('clock = latest captured listing event; got %s', m->'coverage'));
  -- 2. Its handle's identity read gives the same number (the lowercase variant reads the same account).
  i := public.actor_profile_read('identity', '00000000-0000-0000-0000-0000000000e4');
  PERFORM public.t_assert(public.t_measure(i, 'performance', 'Sell-through') = m, format('one seller, one sell-through; org %s, identity %s', m, public.t_measure(i, 'performance', 'Sell-through')));
  -- 3. Bidding: both variants summed (25 entered, 6 wins: 24.0%), the snapshot's date, ranked among handles with
  -- five or more auctions (desertseller 25, B4 5, B5 30; B9 has three): win rate 0.24 against 0.00 and 0.30, one
  -- below of three: P50; auctions entered 25 against 5 and 30: P50.
  m := public.t_measure(i, 'bidding', 'Win rate');
  PERFORM public.t_assert((m->>'value')::numeric = 24.0 AND (m->'rank'->>'p')::numeric = 50.0 AND (m->'rank'->>'n')::int = 3 AND m->'coverage'->>'as_of' LIKE '2026-02-09%', format('win rate 24.0 at P50 of 3, dated; got %s', m));
  m := public.t_measure(i, 'bidding', 'Auctions entered');
  PERFORM public.t_assert((m->>'value')::int = 25 AND (m->'rank'->>'p')::numeric = 50.0, format('auctions entered summed across variants, P50; got %s', m));
  -- 4. Talking: 6 comments on 5 lots; answers on own listed vehicles = 4 (the answer on vehicle 106 is not theirs).
  PERFORM public.t_assert((public.t_measure(d, 'talking', 'Comments')->>'value')::int = 6, 'six comments');
  m := public.t_measure(d, 'talking', 'Answers to bidders per listing');
  PERFORM public.t_assert((m->'coverage'->>'n')::int = 4 AND (m->>'value')::numeric = 0.7, format('4 answers on own listings over 6 listings; got %s', m));
  -- 5. Specialization: 1970s 4 of 5 = 80% against 10%: 8.0x; Ford 4 of 5 = 80% against 30%: 2.7x.
  PERFORM public.t_assert((public.t_measure(d, 'specialization', '1970s')->>'value')::numeric = 8.0, format('1970s 8.0x; got %s', public.t_measure(d, 'specialization', '1970s')));
  PERFORM public.t_assert((public.t_measure(d, 'specialization', 'Ford')->>'value')::numeric = 2.7, format('Ford 2.7x; got %s', public.t_measure(d, 'specialization', 'Ford')));
  -- 6. Open books: sold 101, 102, 103 (2 with an amount); held 104, 105 (1 with a cost); 101 carries both. No amount.
  PERFORM public.t_assert((public.t_measure(d, 'open_books', 'Sales with a recorded amount')->'coverage'->>'n')::int = 2, 'two sales with an amount');
  PERFORM public.t_assert((public.t_measure(d, 'open_books', 'Return computable')->>'value')::int = 1, 'return computable on one vehicle');
  PERFORM public.t_assert(d::text !~ '(41001|52002|23001|17004|99007|99008)', 'no amount anywhere in the document');
  -- 7. The fallback: no linked handle, the stats fold, ranked among public selling organizations with venues and
  -- private organizations excluded (U 90% against 50, 60, 70, 80 and the linked dealer's 90: 4 below of 6, P80),
  -- conflicts named, clock = the inputs' extraction, no per-listing means without their coverage.
  d := public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000c1');
  m := public.t_measure(d, 'performance', 'Sell-through');
  PERFORM public.t_assert((m->>'value')::numeric = 90.0 AND (m->'rank'->>'n')::int = 6 AND (m->'rank'->>'p')::numeric = 80.0, format('fallback 90.0 at P80 of 6, venue excluded; got %s', m));
  PERFORM public.t_assert(m->>'method' LIKE '%2 outcome and 7 identity conflicts%', format('conflicts named; got %s', m->>'method'));
  PERFORM public.t_assert(m->'coverage'->>'as_of' LIKE '2026-09-30%', format('clock = inputs extraction; got %s', m->'coverage'));
  PERFORM public.t_assert(public.t_measure(d, 'performance', 'Bids per listing') IS NULL, 'no per-listing means without their coverage');
  -- 8. A venue is not aggregated.
  d := public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000b1');
  sec := public.t_section(d, 'specialization');
  PERFORM public.t_assert(d->'subject'->>'venue' = 'true' AND jsonb_array_length(sec->'items') = 0 AND sec->'coverage'->>'grain' LIKE '%venue%', format('venue not aggregated; got %s', sec));
  PERFORM public.t_assert(public.t_section(d, 'open_books') IS NULL, 'no open books for a venue');
  -- 9. Nothing for a private organization, an unknown id or an unread kind.
  PERFORM public.t_assert(public.actor_profile_read('organization', '00000000-0000-0000-0000-0000000000a9') IS NULL, 'private organization reads as nothing');
  PERFORM public.t_assert(public.actor_profile_read('identity', '00000000-0000-0000-0000-0000000000ff') IS NULL, 'unknown identity reads as nothing');
  PERFORM public.t_assert(public.actor_profile_read('person', '00000000-0000-0000-0000-0000000000d1') IS NULL, 'unread kind reads as nothing');
END $$;
RESET ROLE;
-- 10. The superseded org reader is revoked from PUBLIC, anon and authenticated.
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.get_org_profile_fast(uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.get_org_profile_fast(uuid)', 'execute'), 'get_org_profile_fast revoked');
SELECT 'actor_profile_read contract: PASS' AS result;
