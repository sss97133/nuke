-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_treemap_sales -f supabase/sql/test_treemap_confirmed_sales.sql
-- Proves 20261014063000_treemap_confirmed_sales.sql against the map as production had it on 2026-10-14.
-- Before: the live views count an ask, a high bid stored as sold_price, a contradicted sale, a private record and a
-- non-vehicle lot as "a recorded price", hide MG, miss a record whose make label differs from its canonical make, and
-- take the median of per-source medians. After: the area counts public records with a confirmed sale and an amount,
-- the amount equals vehicle_price_facts' sold_amount, the color is their median (null under 5), sell-through is over
-- known outcomes, the leaf returns the cell's sales and re-checks visibility live, treemap_refresh_all refreshes the
-- new views concurrently (plainly when unpopulated) and writes the population receipt, and the grants hold.
-- The rows below are a disposable test database's rows, never production testimony. -- ALLOW_RAW_TESTIMONY_WRITE
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
-- Prod's deploy role owns the tables and is not a superuser: build the fixture and apply the migration as such a role.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SET ROLE dm_contract_deployer;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;

-- The columns the map, vehicle_sale_basis and vehicle_price_facts read, with production's types.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, make text, model text, year integer, mileage integer, is_public boolean DEFAULT true, notes text,
  created_at timestamptz DEFAULT '2026-10-01 00:00:00+00', sale_price integer, auction_end_date text, auction_source text,
  bat_auction_url text, bat_sold_price numeric(10,2), bat_sale_date date, discovery_url text, bat_listing_title text,
  bat_bids integer, sale_status text, sale_date date, deleted_at timestamptz, import_metadata jsonb, asking_price numeric,
  primary_image_url text, platform_url text, sold_price integer, auction_outcome text, high_bid integer, winning_bid integer,
  listing_url text, listing_posted_at timestamptz, listing_updated_at timestamptz, listing_title text, bat_watchers integer,
  reserve_status text, listing_kind text NOT NULL DEFAULT 'vehicle', canonical_make_id uuid, nuke_estimate numeric(12,2),
  nuke_estimate_confidence integer, valuation_calculated_at timestamptz, canonical_platform text, canonical_outcome text);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true);
GRANT SELECT ON public.vehicles TO anon, authenticated, service_role;
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text);
GRANT SELECT ON public.canonical_makes TO anon, authenticated, service_role;
CREATE TABLE public.treemap_refreshes (refreshed_at timestamptz PRIMARY KEY DEFAULT now(), seconds numeric, note text);
GRANT SELECT ON public.treemap_refreshes TO anon, authenticated, service_role;

INSERT INTO public.canonical_makes VALUES
 ('c0000000-0000-0000-0000-000000000001', 'porsche', 'Porsche'),
 ('c0000000-0000-0000-0000-000000000002', 'chevrolet', 'Chevrolet'),
 ('c0000000-0000-0000-0000-000000000003', 'mg', 'MG'),
 ('c0000000-0000-0000-0000-000000000004', 'ac', 'AC');

-- ALLOW_RAW_TESTIMONY_WRITE (disposable fixture rows)
INSERT INTO public.vehicles (id, make, model, year, canonical_make_id, auction_source, canonical_platform, sale_status,
  auction_outcome, sale_price, winning_bid, bat_sold_price, sold_price, high_bid, asking_price, notes, created_at,
  is_public, deleted_at, listing_kind, bat_bids, listing_title) VALUES
 -- Porsche 911 1973: four sales whose amount comes from a different column each, and one without an amount
 ('a0000000-0000-0000-0000-000000000001', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 100000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', 40, 'a1'),
 ('a0000000-0000-0000-0000-000000000002', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', NULL, NULL, 90000, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', 20, 'a2'),
 ('a0000000-0000-0000-0000-000000000003', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', NULL, NULL, NULL, 80000, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'a3'),
 ('a0000000-0000-0000-0000-000000000004', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', NULL, NULL, NULL, NULL, 70000, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'a4'),
 ('a0000000-0000-0000-0000-000000000005', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'a5'),
 -- a legacy Mecum sale marker (pre-cutover): a sale
 ('a0000000-0000-0000-0000-000000000006', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'mecum', 'mecum', 'available', NULL, 60000, NULL, NULL, NULL, NULL, NULL, 'Result: sold', '2025-06-01', true, NULL, 'vehicle', NULL, 'a6'),
 -- an ask stored in sale_price by an older importer: not a sale
 ('a0000000-0000-0000-0000-000000000007', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'craigslist', 'craigslist', 'for_sale', NULL, 39995, NULL, NULL, NULL, NULL, 39995, NULL, '2026-01-01', true, NULL, 'vehicle', NULL, 'a7'),
 -- reserve not met, its high bid copied to sold_price: a known no-sale
 ('a0000000-0000-0000-0000-000000000008', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'ended', 'reserve_not_met', NULL, NULL, NULL, 50000, 50000, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'a8'),
 -- sold and reserve-not-met on one row: not proven, a known no-sale
 ('a0000000-0000-0000-0000-000000000009', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'reserve_not_met', 55000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'a9'),
 -- private, deleted, and a non-vehicle lot: sales, but not in the public population
 ('a0000000-0000-0000-0000-000000000010', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 200000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, false, NULL, 'vehicle', NULL, 'a10'),
 ('a0000000-0000-0000-0000-000000000011', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 300000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, '2026-03-10', 'vehicle', NULL, 'a11'),
 ('a0000000-0000-0000-0000-000000000012', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 400000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'non_vehicle_item', NULL, 'a12'),
 -- a Mecum bid-goes-on beside a sold status: not proven, outcome unknown
 ('a0000000-0000-0000-0000-000000000013', 'Porsche', '911', 1973, 'c0000000-0000-0000-0000-000000000001', 'mecum', 'mecum', 'sold', NULL, 65000, NULL, NULL, NULL, NULL, NULL, 'Result: bid-goes-on', '2025-06-01', true, NULL, 'vehicle', NULL, 'a13'),
 -- a recorded $1 sale stays (no quiet filter); a post-cutover price without a status is not a sale
 ('a0000000-0000-0000-0000-000000000014', 'Porsche', '911', 1989, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 1, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'a14'),
 ('a0000000-0000-0000-0000-000000000015', 'Porsche', '911', 1989, 'c0000000-0000-0000-0000-000000000001', 'cars & bids', 'cars-and-bids', NULL, NULL, 45000, NULL, NULL, NULL, NULL, NULL, NULL, '2026-10-01', true, NULL, 'vehicle', NULL, 'a15'),
 -- Porsche 912 1966 across two sources: exact median 30000, median of source medians 85000
 ('a0000000-0000-0000-0000-000000000016', 'Porsche', '912', 1966, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 10000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'b1'),
 ('a0000000-0000-0000-0000-000000000017', 'Porsche', '912', 1966, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 20000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'b2'),
 ('a0000000-0000-0000-0000-000000000018', 'Porsche', '912', 1966, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 30000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'b3'),
 ('a0000000-0000-0000-0000-000000000019', 'Porsche', '912', 1966, 'c0000000-0000-0000-0000-000000000001', 'mecum', 'mecum', 'sold', 'sold', 100000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'b4'),
 ('a0000000-0000-0000-0000-000000000020', 'Porsche', '912', 1966, 'c0000000-0000-0000-0000-000000000001', 'mecum', 'mecum', 'sold', 'sold', 200000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'b5'),
 -- Chevrolet Corvette 1963: five sales, and a sixth whose make label 'Chevy' resolves to Chevrolet
 ('a0000000-0000-0000-0000-000000000021', 'Chevrolet', 'Corvette', 1963, 'c0000000-0000-0000-0000-000000000002', 'bat', 'bat', 'sold', 'sold', 150000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'c1'),
 ('a0000000-0000-0000-0000-000000000022', 'Chevrolet', 'Corvette', 1963, 'c0000000-0000-0000-0000-000000000002', 'bat', 'bat', 'sold', 'sold', 160000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'c2'),
 ('a0000000-0000-0000-0000-000000000023', 'Chevrolet', 'Corvette', 1963, 'c0000000-0000-0000-0000-000000000002', 'bat', 'bat', 'sold', 'sold', 170000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'c3'),
 ('a0000000-0000-0000-0000-000000000024', 'Chevrolet', 'Corvette', 1963, 'c0000000-0000-0000-0000-000000000002', 'bat', 'bat', 'sold', 'sold', 180000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'c4'),
 ('a0000000-0000-0000-0000-000000000025', 'Chevrolet', 'Corvette', 1963, 'c0000000-0000-0000-0000-000000000002', 'bat', 'bat', 'sold', 'sold', 190000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'c5'),
 ('a0000000-0000-0000-0000-000000000026', 'Chevy', 'Corvette', 1963, 'c0000000-0000-0000-0000-000000000002', 'bat', 'bat', 'sold', 'sold', 175000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'c6'),
 -- MG (a two-letter canonical make the old text filter hid): five sales
 ('a0000000-0000-0000-0000-000000000031', 'MG', 'MGB', 1970, 'c0000000-0000-0000-0000-000000000003', 'bat', 'bat', 'sold', 'sold', 800000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'm1'),
 ('a0000000-0000-0000-0000-000000000032', 'MG', 'MGB', 1970, 'c0000000-0000-0000-0000-000000000003', 'bat', 'bat', 'sold', 'sold', 900000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'm2'),
 ('a0000000-0000-0000-0000-000000000033', 'MG', 'MGB', 1970, 'c0000000-0000-0000-0000-000000000003', 'bat', 'bat', 'sold', 'sold', 1000000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'm3'),
 ('a0000000-0000-0000-0000-000000000034', 'MG', 'MGB', 1970, 'c0000000-0000-0000-0000-000000000003', 'bat', 'bat', 'sold', 'sold', 1100000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'm4'),
 ('a0000000-0000-0000-0000-000000000035', 'MG', 'MGB', 1970, 'c0000000-0000-0000-0000-000000000003', 'bat', 'bat', 'sold', 'sold', 1200000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'm5'),
 -- AC Cobra: four sales, under the make floor of five
 ('a0000000-0000-0000-0000-000000000041', 'AC', 'Cobra', 1965, 'c0000000-0000-0000-0000-000000000004', 'bat', 'bat', 'sold', 'sold', 1000000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'x1'),
 ('a0000000-0000-0000-0000-000000000042', 'AC', 'Cobra', 1965, 'c0000000-0000-0000-0000-000000000004', 'bat', 'bat', 'sold', 'sold', 1100000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'x2'),
 ('a0000000-0000-0000-0000-000000000043', 'AC', 'Cobra', 1965, 'c0000000-0000-0000-0000-000000000004', 'bat', 'bat', 'sold', 'sold', 1200000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'x3'),
 ('a0000000-0000-0000-0000-000000000044', 'AC', 'Cobra', 1965, 'c0000000-0000-0000-0000-000000000004', 'bat', 'bat', 'sold', 'sold', 1300000, NULL, NULL, NULL, NULL, NULL, NULL, DEFAULT, true, NULL, 'vehicle', NULL, 'x4');

-- The two existing owners, as production has them, checked by hash.
\ir helpers/treemap_sale_owners_live_20261014.sql
SELECT public.t_assert(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') = '+q4wfzMqlwshjSDGpsEJsV1Dg9vnZiJ1JHXNuWC2HCs=', 'vehicle_sale_basis is the live definition')
  FROM pg_proc WHERE oid = 'public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)'::regprocedure;
SELECT public.t_assert(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') = 't/DRs757uqoso/uOsBZVf7ZUqSPR/owK2BXDbrG2gc0=', 'vehicle_price_facts is the live definition')
  FROM pg_proc WHERE oid = 'public.vehicle_price_facts(uuid[])'::regprocedure;

-- The map before: three of its views and its readers as production had them.
\ir helpers/treemap_map_live_20261014.sql
GRANT SELECT ON public.mv_treemap_by_brand, public.mv_treemap_models_by_brand, public.mv_treemap_years TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.treemap_refresh_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_refresh_all() TO service_role;
CREATE TEMP TABLE acl_before AS
  SELECT oid::regprocedure::text AS fn, proacl::text AS acl FROM pg_proc
   WHERE oid IN ('public.treemap_by_brand()'::regprocedure, 'public.treemap_models_by_brand(text)'::regprocedure,
                 'public.treemap_models_batch(text[],integer)'::regprocedure, 'public.treemap_years(text,text,text)'::regprocedure,
                 'public.treemap_refresh_all()'::regprocedure);

DO $$
DECLARE r record; n bigint;
BEGIN
  -- Before: the ask, the high bid, the contradicted sale, the private record and the non-vehicle lot all count.
  SELECT * INTO r FROM public.treemap_by_brand() WHERE name = 'Porsche';
  PERFORM public.t_assert(r.count = 16, format('before: Porsche counts 16 recorded prices, got %s', r.count));
  PERFORM public.t_assert(r.median_price = 57500, format('before: Porsche median 57500, got %s', r.median_price));
  SELECT count(*) INTO n FROM public.treemap_by_brand() WHERE name = 'MG';
  PERFORM public.t_assert(n = 0, 'before: MG is hidden by the make text filter');
  SELECT * INTO r FROM public.treemap_years(NULL, 'Porsche', '912');
  PERFORM public.t_assert(r.median_price = 85000, format('before: 912 years take the median of source medians (85000), got %s', r.median_price));
  SELECT * INTO r FROM public.treemap_years(NULL, 'Chevrolet', 'Corvette');
  PERFORM public.t_assert(r.count = 5, format('before: the Chevy-labelled Corvette is missed, got %s', r.count));
  RAISE NOTICE 'before: the live map counts asks, bids, contradicted, private and non-vehicle prices';
END $$;

\ir ../migrations/20261014063000_treemap_confirmed_sales.sql

DO $$
DECLARE r record; n bigint;
BEGIN
  -- The fold agrees with the existing owners row for row: a sale where vehicle_price_facts says sold, with its
  -- sold_amount; a no-sale where it says reserve_not_met; nothing else.
  SELECT count(*) INTO n
    FROM public.mv_treemap_outcomes o
    JOIN LATERAL public.vehicle_price_facts(ARRAY[o.id]) f ON true
   WHERE (o.outcome = 'sold') IS DISTINCT FROM coalesce(f.price_kind = 'sold', false)
      OR o.sold_amount IS DISTINCT FROM f.sold_amount
      OR o.sale_basis IS DISTINCT FROM f.sold_basis
      OR (o.outcome = 'not_sold') IS DISTINCT FROM (f.outcome = 'reserve_not_met');
  PERFORM public.t_assert(n = 0, format('fold disagrees with vehicle_price_facts on %s rows', n));
  SELECT count(*) INTO n FROM public.vehicles v
   WHERE v.is_public AND v.deleted_at IS NULL AND v.listing_kind <> 'non_vehicle_item'
     AND EXISTS (SELECT 1 FROM public.vehicle_price_facts(ARRAY[v.id]) f WHERE f.price_kind = 'sold' OR f.outcome = 'reserve_not_met')
     AND NOT EXISTS (SELECT 1 FROM public.mv_treemap_outcomes o WHERE o.id = v.id);
  PERFORM public.t_assert(n = 0, format('%s public known outcomes are missing from the fold', n));
  SELECT count(*) INTO n FROM public.mv_treemap_outcomes
   WHERE id IN ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000011',
                'a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000015');
  PERFORM public.t_assert(n = 0, 'the ask, the private, deleted and non-vehicle rows, bid-goes-on and the post-cutover price stay out');

  -- After, the makes: Porsche counts its 11 sales with an amount, at their median; sell-through over known outcomes.
  SELECT * INTO r FROM public.treemap_by_brand() WHERE name = 'Porsche';
  PERFORM public.t_assert(r.count = 11 AND r.median_price = 70000 AND r.value = 760001 AND r.min_price = 1 AND r.max_price = 200000,
    format('after: Porsche %s', r));
  PERFORM public.t_assert(r.sold_count = 12 AND r.auction_count = 14, format('after: Porsche sold %s of %s known outcomes', r.sold_count, r.auction_count));
  PERFORM public.t_assert(r.avg_bids = 30, format('after: avg bids over the sales, got %s', r.avg_bids));
  SELECT * INTO r FROM public.treemap_by_brand() WHERE name = 'Chevrolet';
  PERFORM public.t_assert(r.count = 6 AND r.median_price = 172500, format('after: Chevrolet with its Chevy-labelled sale %s', r));
  SELECT * INTO r FROM public.treemap_by_brand() WHERE name = 'MG';
  PERFORM public.t_assert(r.count = 5 AND r.median_price = 1000000, format('after: MG is on the map %s', r));
  SELECT count(*) INTO n FROM public.treemap_by_brand() WHERE name = 'AC';
  PERFORM public.t_assert(n = 0, 'after: a make with 4 sales is under the floor');
  SELECT count(*) INTO n FROM public.treemap_by_brand();
  PERFORM public.t_assert(n = 3, format('after: three makes, got %s', n));

  -- Models: every model with a sale; under five sales the median is withheld.
  SELECT * INTO r FROM public.treemap_models_by_brand('Porsche') WHERE name = '911';
  PERFORM public.t_assert(r.count = 6 AND r.median_price = 75000, format('after: 911 %s', r));
  SELECT * INTO r FROM public.treemap_models_by_brand('AC') WHERE name = 'Cobra';
  PERFORM public.t_assert(r.count = 4 AND r.median_price IS NULL AND r.min_price = 1000000, format('after: Cobra under 5 has no median %s', r));
  SELECT count(*) INTO n FROM public.treemap_models_batch(ARRAY['Porsche', 'Chevrolet'], 1);
  PERFORM public.t_assert(n = 2, format('after: models batch, one per make, got %s', n));

  -- Years: the exact median over every source, or one source; the Chevy-labelled record is found under Chevrolet.
  SELECT * INTO r FROM public.treemap_years(NULL, 'Porsche', '912');
  PERFORM public.t_assert(r.name = '1966' AND r.count = 5 AND r.median_price = 30000, format('after: 912 exact median %s', r));
  SELECT * INTO r FROM public.treemap_years('Mecum', 'Porsche', '912');
  PERFORM public.t_assert(r.count = 2 AND r.median_price IS NULL AND r.value = 300000, format('after: 912 at Mecum %s', r));
  SELECT * INTO r FROM public.treemap_years(NULL, 'chevrolet', 'corvette');
  PERFORM public.t_assert(r.count = 6, format('after: Corvette years by make label, case-insensitively %s', r));
  SELECT * INTO r FROM public.treemap_years(NULL, 'Porsche', '911') WHERE name = '1973';
  PERFORM public.t_assert(r.count = 5 AND r.sold_count = 6 AND r.auction_count = 8, format('after: 911 1973 %s', r));

  -- The leaf: the cell's sales, largest first, with the amount the map counted.
  SELECT count(*) INTO n FROM public.treemap_sales('Porsche', '911', 1973);
  PERFORM public.t_assert(n = 5, format('after: 911 1973 leaf has 5 sales, got %s', n));
  SELECT * INTO r FROM public.treemap_sales('Porsche', '911', 1973) LIMIT 1;
  PERFORM public.t_assert(r.sold_amount = 100000 AND r.sale_basis = 'status' AND r.listing_title = 'a1', format('after: leaf first row %s', r));

  -- The population receipt written by the migration.
  SELECT populations INTO r FROM public.treemap_refreshes ORDER BY refreshed_at DESC LIMIT 1;
  PERFORM public.t_assert((r.populations->>'public_records')::int = (SELECT count(*) FROM public.vehicles
      WHERE is_public AND deleted_at IS NULL AND listing_kind <> 'non_vehicle_item')
    AND (r.populations->>'confirmed_sales_with_amount')::int = 26 AND (r.populations->>'mapped_sales')::int = 22
    AND (r.populations->>'mapped_makes')::int = 3 AND (r.populations->>'known_outcomes')::int = 29
    AND (r.populations->>'confirmed_sales')::int = 27,
    format('receipt %s', r.populations));
  RAISE NOTICE 'after: confirmed sales only, amounts as vehicle_price_facts, exact medians, receipt written';
END $$;

-- Grants: the readers keep their ACLs; the leaf is public; the receipt function is not.
SELECT public.t_assert(count(*) = 5, 'reader ACLs unchanged')
  FROM acl_before b JOIN pg_proc p ON p.oid = b.fn::regprocedure WHERE p.proacl::text IS NOT DISTINCT FROM b.acl;
SELECT public.t_assert(has_function_privilege('anon', 'public.treemap_sales(text,text,integer)', 'EXECUTE'), 'anon may read the leaf');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.treemap_populations()', 'EXECUTE'), 'anon may not run the population count');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.mv_treemap_outcomes', 'INSERT')
                   AND has_table_privilege('anon', 'public.mv_treemap_outcomes', 'SELECT'), 'anon reads the fold, nothing more');

-- As a logged-out caller: the map reads; a record made private after the refresh leaves the leaf at once and the
-- aggregates at the next refresh.
RESET ROLE;
UPDATE public.vehicles SET is_public = false WHERE id = 'a0000000-0000-0000-0000-000000000001'; -- ALLOW_RAW_TESTIMONY_WRITE (fixture)
SET ROLE anon;
SELECT public.t_assert(count(*) = 3, 'anon reads the makes') FROM public.treemap_by_brand();
SELECT public.t_assert(count(*) = 4, 'anon leaf drops the record made private, before any refresh') FROM public.treemap_sales('Porsche', '911', 1973);
SELECT public.t_assert(count = 11, 'the aggregate still counts it until the refresh') FROM public.treemap_by_brand() WHERE name = 'Porsche';
RESET ROLE;

-- treemap_refresh_all: the new views refresh concurrently, an unpopulated one plainly, and the receipt is written.
SET ROLE dm_contract_deployer;
REFRESH MATERIALIZED VIEW public.mv_treemap_sale_models WITH NO DATA;
INSERT INTO public.vehicles (id, make, model, year, canonical_make_id, auction_source, canonical_platform, sale_status, auction_outcome, sale_price)
VALUES ('a0000000-0000-0000-0000-000000000099', 'Porsche', '912', 1966, 'c0000000-0000-0000-0000-000000000001', 'bat', 'bat', 'sold', 'sold', 40000); -- ALLOW_RAW_TESTIMONY_WRITE (fixture)
SELECT public.treemap_refresh_all();
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.treemap_refreshes ORDER BY refreshed_at DESC LIMIT 1;
  PERFORM public.t_assert(r.note = 'treemap_refresh_all: 3 concurrently, 3 plainly', format('refresh note %s', r.note));
  PERFORM public.t_assert(r.populations->>'measure' = 'confirmed_sale_v1' AND (r.populations->>'mapped_sales')::int = 22,
    format('refresh receipt %s', r.populations));
  SELECT * INTO r FROM public.treemap_by_brand() WHERE name = 'Porsche';
  PERFORM public.t_assert(r.count = 11, format('after refresh: the private record left and the new sale arrived, got %s', r.count));
  SELECT * INTO r FROM public.treemap_models_by_brand('Porsche') WHERE name = '912';
  PERFORM public.t_assert(r.count = 6 AND r.median_price = 35000, format('after refresh: 912 %s', r));
  PERFORM public.treemap_refresh_all();
  SELECT * INTO r FROM public.treemap_refreshes ORDER BY refreshed_at DESC LIMIT 1;
  PERFORM public.t_assert(r.note = 'treemap_refresh_all: 4 concurrently, 2 plainly', format('second refresh note %s', r.note));
  RAISE NOTICE 'treemap_refresh_all: new views concurrent once populated, receipt written each refresh';
END $$;
RESET ROLE;
\echo 'test_treemap_confirmed_sales: PASS'
