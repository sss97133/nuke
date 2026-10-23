-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_market_sources_lot_sellers -f this-file.sql
-- Contract for 20261020300000_market_sources_sellers_from_lots.sql, on top of the cohort contract's synthetic board
-- (test_market_sources_cohorts.sql, which runs the writer as it was before this migration). Synthetic rows only; never
-- production.
--   * the migration applies twice;
--   * a seller is a lot's own seller identity, else, only when the lot has none, its non-blank seller name; sellers are
--     banded by lots, not by vehicles or organizations;
--   * a lot captured twice counts once, and a copy that names a seller wins over one that does not;
--   * a dealer's venue_lots are the lots whose seller is its identity (or its handle as a name when the lot has no
--     identity); both vehicle rows of a lot captured twice stay out of held;
--   * a seller identity registered on a monitor of a non-dealer organization is a seller, not a dealer;
--   * a lot with neither identity nor name goes to bat-sellers-none; lots of other sources are not read;
--   * no handle or name reaches the anonymous read.
\ir test_market_sources_cohorts.sql

-- what the writer reads beyond the cohort contract's tables, with their live types (2026-10-20)
CREATE TABLE public.external_identities (id uuid PRIMARY KEY, platform text NOT NULL, handle text NOT NULL);
CREATE TABLE public.bat_seller_monitors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, seller_username text NOT NULL);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, source_url text, seller_name text,
  seller_external_identity_id uuid, auction_end_date timestamptz, created_at timestamptz NOT NULL DEFAULT now());

INSERT INTO public.organizations (id, business_type, website, business_name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'other', NULL, 'Seller wrapper organization');
INSERT INTO public.external_identities (id, platform, handle) VALUES
  ('50000000-0000-0000-0000-000000000001', 'bat', 'StreetsideClassics'),   -- the dealer
  ('50000000-0000-0000-0000-000000000002', 'bat', 'batonly'),              -- the BaT-only dealer
  ('50000000-0000-0000-0000-000000000003', 'bat', 'Handle_Two'),           -- two lots
  ('50000000-0000-0000-0000-000000000004', 'bat', 'solo_handle'),          -- one lot
  ('50000000-0000-0000-0000-000000000005', 'bat', 'wrapper_handle'),       -- monitored, but its organization is no dealer
  ('50000000-0000-0000-0000-000000000006', 'bat', 'twice_seller'),         -- one lot captured twice
  ('50000000-0000-0000-0000-000000000007', 'cars_and_bids', 'cnb_seller'); -- another platform
INSERT INTO public.bat_seller_monitors (organization_id, seller_username) VALUES
  ('11111111-1111-1111-1111-111111111111', 'streetsideclassics'),          -- case differs from the identity's handle
  ('22222222-2222-2222-2222-222222222222', 'batonly'),
  ('33333333-3333-3333-3333-333333333333', 'wrapper_handle');

INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, listing_status, created_at) VALUES
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000003', 'sold_by', 'sold', now() - interval '2 days');

INSERT INTO public.auction_events (vehicle_id, source, source_url, seller_name, seller_external_identity_id, auction_end_date, created_at)
SELECT v.veh::uuid, v.src, 'https://bringatrailer.com/listing/' || v.slug || '/' || v.suffix, v.sname, v.sid::uuid, now() - interval '3 days', now() - v.age
FROM (VALUES
  -- Streetside Classics: three lots by identity (the third captured twice, on a url variant and a second vehicle row),
  -- one with no identity that names its handle
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bat', 'dealer-lot-1', '', 'StreetsideClassics', '50000000-0000-0000-0000-000000000001', interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bat', 'dealer-lot-2', '', 'StreetsideClassics', '50000000-0000-0000-0000-000000000001', interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'bat', 'dealer-lot-3', '', 'StreetsideClassics', '50000000-0000-0000-0000-000000000001', interval '2 days'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'bat', 'dealer-lot-3', '?utm=x', 'StreetsideClassics', '50000000-0000-0000-0000-000000000001', interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'bat', 'dealer-lot-4', '', 'streetsideclassics', NULL, interval '1 day'),
  -- the BaT-only dealer: one lot, one captured twice (the second copy names no identity and sits on its other vehicle row)
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bat', 'batonly-lot-1', '', 'batonly', '50000000-0000-0000-0000-000000000002', interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bat', 'batonly-lot-2', '', 'batonly', '50000000-0000-0000-0000-000000000002', interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'bat', 'batonly-lot-2', '', 'batonly', NULL, interval '2 days'),
  -- a seller with two lots, sellers with one, a seller whose organization is not a dealer
  ('cccccccc-0000-0000-0000-000000000001', 'bat', 'two-lot-a', '', 'Handle_Two', '50000000-0000-0000-0000-000000000003', interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000002', 'bat', 'two-lot-b', '', 'Handle_Two', '50000000-0000-0000-0000-000000000003', interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000003', 'bat', 'solo-lot', '', 'solo_handle', '50000000-0000-0000-0000-000000000004', interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000004', 'bat', 'wrapper-lot', '', 'wrapper_handle', '50000000-0000-0000-0000-000000000005', interval '1 day'),
  -- one lot captured twice: the older copy names only a seller name, the newer names the identity
  ('cccccccc-0000-0000-0000-000000000005', 'bat', 'twice-lot', '', 'twice_seller', NULL, interval '3 days'),
  ('cccccccc-0000-0000-0000-000000000005', 'bat', 'twice-lot', '?ref=y', 'twice_seller', '50000000-0000-0000-0000-000000000006', interval '2 days'),
  -- no identity: a name (two lots, the name written two ways) is one seller; blank and missing names are nobody
  ('cccccccc-0000-0000-0000-000000000006', 'bat', 'name-lot-a', '', 'Name Only', NULL, interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000007', 'bat', 'name-lot-b', '', '  name only ', NULL, interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000008', 'bat', 'none-lot-a', '', '   ', NULL, interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000009', 'bringatrailer', 'none-lot-b', '', NULL, NULL, interval '1 day'),
  -- another platform is not read
  ('cccccccc-0000-0000-0000-000000000010', 'cars_and_bids', 'cnb-lot', '', 'cnb_seller', '50000000-0000-0000-0000-000000000007', interval '1 day')
) v(veh, src, slug, suffix, sname, sid, age);

DELETE FROM public.market_source_days WHERE day = current_date;
\ir ../migrations/20261020300000_market_sources_sellers_from_lots.sql
\ir ../migrations/20261020300000_market_sources_sellers_from_lots.sql

SET ROLE service_role;
SELECT pg_temp.ok('the writer runs on the lot rows', public.record_market_source_day() > 0);
RESET ROLE;

SELECT pg_temp.ok('cohorts: sellers banded by their own lots; a captured-twice lot counts once; names are one seller across spellings; dealers out',
  (SELECT jsonb_object_agg(source_slug, jsonb_build_array(members, landed_lots)) FROM public.market_source_days
   WHERE day = current_date AND category = 'seller_cohort')
  = jsonb_build_object('bat-sellers-2-9', jsonb_build_array(2, 4),   -- the two-lot identity and the name written two ways
                       'bat-sellers-1', jsonb_build_array(3, 3),     -- solo, the wrapper organization's identity, the twice-captured lot
                       'bat-sellers-none', jsonb_build_array(0, 2)));
SELECT pg_temp.ok('cohort rows are private_seller, on the BaT venue, with no house',
  (SELECT bool_and(species = 'private_seller' AND venue_slug = 'bat' AND house IS NULL AND venue_lots IS NULL)
   FROM public.market_source_days WHERE day = current_date AND category = 'seller_cohort'));
SELECT pg_temp.ok('a dealer''s venue_lots are the lots its identity sold (one lot captured twice counted once, a handle-only lot counted)',
  (SELECT venue_lots = 4 AND venue_slug = 'bat' FROM public.market_source_days WHERE day = current_date AND source_slug = 'streetside-classics'));
SELECT pg_temp.ok('the BaT-only dealer: its two lots, one captured twice, count twice; both vehicle rows of the lot stay out of held',
  (SELECT venue_lots = 2 AND landed_lots IS NULL FROM public.market_source_days WHERE day = current_date AND source_slug = 'bat-only-dealer'));
SELECT pg_temp.ok('held is unchanged: the dealer''s own-site fold',
  (SELECT landed_lots = 15 FROM public.market_source_days WHERE day = current_date AND source_slug = 'streetside-classics'));
SELECT pg_temp.ok('every BaT lot is in exactly one place: cohorts plus dealer venue lots equal the distinct lots',
  (SELECT sum(landed_lots) FROM public.market_source_days WHERE day = current_date AND category = 'seller_cohort')
  + (SELECT sum(venue_lots) FROM public.market_source_days WHERE day = current_date AND source_slug IN ('streetside-classics', 'bat-only-dealer'))
  = (SELECT count(DISTINCT lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))) FROM public.auction_events
     WHERE source IN ('bat', 'bringatrailer')));

SET ROLE service_role;
SELECT pg_temp.ok('a second reading the same day writes the same rows', public.record_market_source_day() > 0);
RESET ROLE;
SELECT pg_temp.ok('and replaces them, never adding',
  (SELECT count(*) = 3 FROM public.market_source_days WHERE day = current_date AND category = 'seller_cohort')
  AND (SELECT venue_lots = 4 FROM public.market_source_days WHERE day = current_date AND source_slug = 'streetside-classics'));

SET ROLE anon;
DO $$
DECLARE b jsonb := public.market_sources_read();
BEGIN
  PERFORM pg_temp.ok('the anonymous read still lists the three cohorts under Private sellers',
    (SELECT count(*) = 3 FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 LIKE 'bat-sellers-%'));
  PERFORM pg_temp.ok('no seller handle, name or identity appears anywhere in the anonymous read',
    b::text NOT ILIKE '%handle_two%' AND b::text NOT ILIKE '%solo_handle%' AND b::text NOT ILIKE '%wrapper_handle%'
    AND b::text NOT ILIKE '%twice_seller%' AND b::text NOT ILIKE '%name only%' AND b::text NOT ILIKE '%batonly%'
    AND b::text NOT ILIKE '%cnb_seller%' AND b::text NOT ILIKE '%50000000-0000%');
END $$;
SELECT pg_temp.fails('anon still cannot write the board', $s$SELECT public.record_market_source_day()$s$);
RESET ROLE;
SELECT pg_temp.ok('the writer is still a definer with a pinned search_path that PUBLIC cannot run',
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc WHERE proname = 'record_market_source_day')
  AND NOT has_function_privilege('public', 'public.record_market_source_day()', 'execute'));
