-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_bat_result_projection -f this-file.sql
-- Contract for 20261018041000_project_bat_result_to_vehicle.sql and 20261018042000_project_bat_result_latest_lot_only.sql. The live sale writer (helpers/correct_vehicle_sale_
-- provenance_batch_live_20261015.sql + 20261015210000, fingerprint ba684423…) and the live sale-price guard
-- (helpers/guard_vehicle_sale_price_live_20261016.sql) are dependency fixtures. After the migration:
--   * a BaT result landing in auction_events reaches the vehicles row that is that listing, through the writer, cited
--     to auction_events/<id> with the original kept: a reserve-not-met lot's high bid rises to the final; a sold lot
--     never projected gets sale_price with sale_status / auction_outcome 'sold' past the guard; numeric cents round;
--   * never lowers: a vehicle above the final, a vehicle summarizing another listing, a non-BaT source, a non-result
--     outcome and an already-current row are left (statuses vehicle_above_final, other_listing, not_a_result, current);
--     an older lot whose vehicle has a later lot never projects over the relist's sale (later_lot);
--   * p_apply false plans without writing; the trigger never fails the result write (a refusing vehicle is a WARNING);
--   * EXECUTE is service-role only; re-applying the migration is a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
SET TimeZone='UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- vehicles: every column the writer reads or writes, plus the listing link and the soft delete this projection reads.
CREATE TABLE public.vehicles(
  id uuid PRIMARY KEY,
  sale_price integer, sale_status text, auction_outcome text, reserve_status text,
  high_bid integer, winning_bid integer, bat_sold_price numeric, sold_price integer,
  sale_date date, bat_sale_date date, auction_end_date text,
  bat_buyer text, bat_seller text, seller_name text,
  canonical_platform text, platform_source text, msrp numeric, msrp_source text, listing_kind text,
  year integer, make text, model text, bat_auction_url text, asking_price numeric,
  interior_color text, color text, provenance_metadata jsonb,
  discovery_url text, auction_source text, normalized_model text, normalized_series text,
  listing_url text, deleted_at timestamptz);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, is_superseded boolean);
-- auction_events: the columns the projection reads (live types).
CREATE TABLE public.auction_events(
  id uuid PRIMARY KEY, vehicle_id uuid, source text, source_url text, outcome text,
  high_bid numeric, winning_bid numeric, winning_bidder text, raw_data jsonb, auction_end_date timestamptz);
CREATE FUNCTION public.auto_normalize_vehicle_model() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
\ir helpers/correct_vehicle_sale_provenance_batch_live_20261015.sql
\ir ../migrations/20261015210000_sale_provenance_link_and_normalized_columns.sql
\ir helpers/guard_vehicle_sale_price_live_20261016.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.e(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-eeee-' || lpad(to_hex(n), 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.v(n integer) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('high_bid', high_bid, 'sale_price', sale_price, 'sale_status', sale_status,
   'auction_outcome', auction_outcome, 'corrections', jsonb_array_length(coalesce(provenance_metadata->'sale_provenance_corrections','[]')))
 FROM public.vehicles WHERE id = pg_temp.u(n) $$;
SELECT pg_temp.ok('fixture: the writer is the live body',
  md5(pg_get_functiondef('public.correct_vehicle_sale_provenance_batch(jsonb,text,text)'::regprocedure)) = 'ba684423888b5fb3d2048b743d19abc7'); -- gitleaks:allow (fingerprint)

\ir ../migrations/20261018041000_project_bat_result_to_vehicle.sql
\ir ../migrations/20261018042000_project_bat_result_latest_lot_only.sql

-- Fixtures: each lot's vehicles row as the close left it, and its auction_events row while it ran ('live').
--  1 reserve not met at 430,000, vehicles 350,000          2 sold at 2,700, vehicles 'ended' / no price / 2,600
--  3 vehicles above the final (500,000 vs 430,000)          4 vehicles row summarizes another listing (relist)
--  5 another platform's source                              6 a non-result outcome (bid_to)
--  7 sold at 26,750.00 (numeric cents), already current     8 a vehicle the sale guard refuses (see below)
--  9 listing_url left on an older lot (sold 5,300) while the sale columns follow its relist (sold 4,750)
INSERT INTO public.vehicles (id, listing_url, high_bid, sale_price, sale_status, auction_outcome, platform_source) VALUES
  (pg_temp.u(1), 'https://bringatrailer.com/listing/lot-1/', 350000, NULL, 'ended', NULL, 'bringatrailer'),
  (pg_temp.u(2), 'https://bringatrailer.com/listing/lot-2', 2600, NULL, 'ended', NULL, 'bringatrailer'),
  (pg_temp.u(3), 'https://bringatrailer.com/listing/lot-3', 500000, NULL, 'ended', 'reserve_not_met', 'bringatrailer'),
  (pg_temp.u(4), 'https://bringatrailer.com/listing/lot-4-2', 9000, NULL, 'auction_live', NULL, 'bringatrailer'),
  (pg_temp.u(5), 'https://carsandbids.com/auctions/lot-5', 1000, NULL, 'ended', NULL, 'carsandbids'),
  (pg_temp.u(6), 'https://bringatrailer.com/listing/lot-6', 4000, NULL, 'ended', NULL, 'bringatrailer'),
  (pg_temp.u(7), 'https://bringatrailer.com/listing/lot-7', 26750, 26750, 'sold', 'sold', 'bringatrailer'),
  (pg_temp.u(8), 'https://bringatrailer.com/listing/lot-8', 100, NULL, 'ended', NULL, 'bringatrailer'),
  (pg_temp.u(9), 'https://bringatrailer.com/listing/lot-9', 4750, 4750, 'sold', 'sold', 'bringatrailer');
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, outcome, high_bid, winning_bid, raw_data) VALUES
  (pg_temp.e(1), pg_temp.u(1), 'bat', 'https://bringatrailer.com/listing/lot-1', 'live', 350000, NULL, '{"live_stream":{"clock_basis":"native_comment_timestamp"}}'),
  (pg_temp.e(2), pg_temp.u(2), 'bat', 'https://bringatrailer.com/listing/lot-2', 'live', 2600, NULL, '{}'),
  (pg_temp.e(3), pg_temp.u(3), 'bat', 'https://bringatrailer.com/listing/lot-3', 'live', 430000, NULL, '{}'),
  (pg_temp.e(4), pg_temp.u(4), 'bat', 'https://bringatrailer.com/listing/lot-4', 'live', 8000, NULL, '{}'),
  (pg_temp.e(5), pg_temp.u(5), 'carsandbids', 'https://carsandbids.com/auctions/lot-5', 'live', 1000, NULL, '{}'),
  (pg_temp.e(6), pg_temp.u(6), 'bat', 'https://bringatrailer.com/listing/lot-6', 'live', 4000, NULL, '{}'),
  (pg_temp.e(7), pg_temp.u(7), 'bat', 'https://bringatrailer.com/listing/lot-7', 'live', 26750.00, NULL, '{}'),
  (pg_temp.e(8), pg_temp.u(8), 'bat', 'https://bringatrailer.com/listing/lot-8', 'live', 100, NULL, '{}');
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, outcome, high_bid, winning_bid, raw_data, auction_end_date) VALUES
  (pg_temp.e(9), pg_temp.u(9), 'bat', 'https://bringatrailer.com/listing/lot-9', 'live', 5300, NULL, '{}', '2026-09-11 18:43:08Z'),
  (pg_temp.e(10), pg_temp.u(9), 'bat', 'https://bringatrailer.com/listing/lot-9-2', 'sold', 4750, 4750, '{}', '2026-10-14 19:05:20Z');
SELECT pg_temp.ok('a running lot writes nothing to vehicles',
  (SELECT bool_and((pg_temp.v(n) ->> 'corrections')::int = 0) FROM generate_series(1, 9) n));

-- p_apply false: the plan, no write
UPDATE public.auction_events SET outcome = 'reserve_not_met', high_bid = 430000 WHERE id = pg_temp.e(1) AND false;
SELECT pg_temp.ok('plan only: a result not yet recorded is not_a_result',
  public.project_bat_result_to_vehicle(pg_temp.e(1), false) ->> 'status' = 'not_a_result');

-- The results land (as ingest_bat_live_events writes them).
UPDATE public.auction_events SET outcome = 'reserve_not_met', high_bid = 430000 WHERE id = pg_temp.e(1);
UPDATE public.auction_events SET outcome = 'sold', high_bid = 2700, winning_bid = 2700, winning_bidder = 'buyer2' WHERE id = pg_temp.e(2);
UPDATE public.auction_events SET outcome = 'reserve_not_met' WHERE id = pg_temp.e(3);
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 8000 WHERE id = pg_temp.e(4);
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 1500, high_bid = 1500 WHERE id = pg_temp.e(5);
UPDATE public.auction_events SET outcome = 'bid_to', high_bid = 4500 WHERE id = pg_temp.e(6);
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 26750.00 WHERE id = pg_temp.e(7);
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 5300 WHERE id = pg_temp.e(9);

SELECT pg_temp.ok('reserve not met: high bid rises to the final, outcome filled, cited and original kept',
  pg_temp.v(1) = '{"high_bid": 430000, "sale_price": null, "sale_status": "ended", "auction_outcome": "reserve_not_met", "corrections": 2}'::jsonb
  AND (SELECT c ->> 'original' = '350000' AND c ->> 'corrected' = '430000'
          AND c -> 'source' ->> 'ref' = 'auction_events/' || pg_temp.e(1) AND c -> 'source' ->> 'basis' = 'native_comment_timestamp'
          AND c ->> 'asserted_by' = 'trg_project_bat_result_to_vehicle'
       FROM public.vehicles, jsonb_array_elements(provenance_metadata -> 'sale_provenance_corrections') c
       WHERE id = pg_temp.u(1) AND c ->> 'field' = 'high_bid'));
SELECT pg_temp.ok('sold, never projected: sale price with sold status past the guard, bid raised',
  pg_temp.v(2) = '{"high_bid": 2700, "sale_price": 2700, "sale_status": "sold", "auction_outcome": "sold", "corrections": 4}'::jsonb);
SELECT pg_temp.ok('never lowers: a vehicle above the final, another listing, another platform, a non-result are left',
  pg_temp.v(3) ->> 'high_bid' = '500000' AND (pg_temp.v(3) ->> 'corrections')::int = 0
  AND pg_temp.v(4) ->> 'high_bid' = '9000' AND (pg_temp.v(4) ->> 'corrections')::int = 0
  AND pg_temp.v(5) ->> 'high_bid' = '1000' AND (pg_temp.v(6) ->> 'corrections')::int = 0
  AND public.project_bat_result_to_vehicle(pg_temp.e(3)) ->> 'status' = 'vehicle_above_final'
  AND public.project_bat_result_to_vehicle(pg_temp.e(4)) ->> 'status' = 'other_listing'
  AND public.project_bat_result_to_vehicle(pg_temp.e(5)) ->> 'status' = 'not_a_result'
  AND public.project_bat_result_to_vehicle(pg_temp.e(6)) ->> 'status' = 'not_a_result');
SELECT pg_temp.ok('an older lot never projects over its relist''s sale (later_lot)',
  pg_temp.v(9) = '{"high_bid": 4750, "sale_price": 4750, "sale_status": "sold", "auction_outcome": "sold", "corrections": 0}'::jsonb
  AND public.project_bat_result_to_vehicle(pg_temp.e(9)) ->> 'status' = 'later_lot');
SELECT pg_temp.ok('a current row (numeric cents = integer dollars) is left, and a re-run is current',
  (pg_temp.v(7) ->> 'corrections')::int = 0
  AND public.project_bat_result_to_vehicle(pg_temp.e(7)) ->> 'status' = 'current'
  AND public.project_bat_result_to_vehicle(pg_temp.e(1)) ->> 'status' = 'current'
  AND public.project_bat_result_to_vehicle(pg_temp.e(2)) ->> 'status' = 'current');

-- The trigger never fails the result write: a vehicle that refuses every update is a WARNING, the result stands.
CREATE FUNCTION pg_temp.refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.id = '00000000-0000-0000-0000-000000000008'::uuid THEN RAISE EXCEPTION 'refused for the contract'; END IF; RETURN NEW; END $$;
CREATE TRIGGER zz_refuse BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse();
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 200, high_bid = 200 WHERE id = pg_temp.e(8);
SELECT pg_temp.ok('the result row stands when its projection fails; the vehicle is unchanged',
  (SELECT outcome = 'sold' FROM public.auction_events WHERE id = pg_temp.e(8)) AND pg_temp.v(8) ->> 'high_bid' = '100');
DROP TRIGGER zz_refuse ON public.vehicles;
-- (a write and a STABLE reader in one statement would read the row before the write: separate statements)
SELECT pg_temp.ok('the function plans the missed lot without writing',
  public.project_bat_result_to_vehicle(pg_temp.e(8), false) ->> 'status' = 'planned');
SELECT pg_temp.ok('nothing was written by the plan', (pg_temp.v(8) ->> 'corrections')::int = 0);
CREATE TEMP TABLE applied AS SELECT public.project_bat_result_to_vehicle(pg_temp.e(8)) r;
SELECT pg_temp.ok('then applies it through the writer',
  (SELECT r ->> 'status' = 'corrected' FROM applied) AND pg_temp.v(8) ->> 'sale_price' = '200');

SELECT pg_temp.ok('EXECUTE is service-role only',
  NOT has_function_privilege('anon', 'public.project_bat_result_to_vehicle(uuid,boolean,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.project_bat_result_to_vehicle(uuid,boolean,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.project_bat_result_to_vehicle(uuid,boolean,text)', 'EXECUTE'));
CREATE TEMP TABLE def AS SELECT md5(pg_get_functiondef('public.project_bat_result_to_vehicle(uuid,boolean,text)'::regprocedure)) m;
\ir ../migrations/20261018042000_project_bat_result_latest_lot_only.sql
SELECT pg_temp.ok('re-applying the migration is a no-op (one trigger, same body)',
  (SELECT m FROM def) = md5(pg_get_functiondef('public.project_bat_result_to_vehicle(uuid,boolean,text)'::regprocedure))
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.auction_events'::regclass AND tgname = 'trg_project_bat_result_to_vehicle') = 1);
