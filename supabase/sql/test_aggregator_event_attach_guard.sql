-- Isolated PostgreSQL 17 contract for 20261026081000_aggregator_event_attach_guard.sql. Synthetic rows only.
--   createdb dm_refinement_aggregator_attach_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_aggregator_attach_ci -f supabase/sql/test_aggregator_event_attach_guard.sql
-- Cases: conceptcarz insert by price+date alone refused; chassis = VIN, VIN suffix (>=6) accepted; short-fragment suffix refused;
-- cited same-lot accepted, citation of another vehicle's / an aggregator / a lot-less event refused; non-aggregator untouched;
-- re-point refused; merge carry flagged not refused; unchanged-attachment update allowed; wrong-vehicle event makes the copied
-- price untrusted (function and view agree), cannot vouch for a price, and never drives the sale-price sync; rollback restores.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET TimeZone = 'UTC';

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, sale_price integer, sale_status text,
  sale_price_currency text, sale_date date);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id),
  source_platform text, source_url text, source_listing_id text, event_status text, final_price numeric,
  metadata jsonb DEFAULT '{}', merged_from_vehicle_id uuid, sale_truth_role text, price_verification text,
  price_verification_source text, price_verification_at timestamptz, price_verification_run_id text,
  sold_at timestamptz, ended_at timestamptz, currency_code text, source_suspect text[], source_suspect_reason text,
  source_suspect_run_id text, source_suspect_at timestamptz);
CREATE TABLE public.fx_rates (base_currency text, quote_currency text, rate_date date);
CREATE TABLE public.sync_calls (rows jsonb);
CREATE FUNCTION public.correct_vehicle_sale_provenance_batch(p_rows jsonb, p_asserted_by text, p_reason text)
 RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.sync_calls VALUES (p_rows) RETURNING p_rows $$;

\ir ../migrations/20261026081000_aggregator_event_attach_guard.sql
CREATE TRIGGER trg_sync_vehicle_sale_price_from_verified_event AFTER INSERT OR UPDATE ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_sale_price_from_verified_event();

CREATE FUNCTION pg_temp.ok(c boolean, m text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', m; END IF; RAISE NOTICE 'ok: %', m; END $$;
CREATE FUNCTION pg_temp.refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN check_violation THEN RETURN true; END $$;

INSERT INTO public.vehicles VALUES
 ('00000000-0000-0000-0000-00000000000a', '1G1YY0789F5100001', 114400, 'sold', 'USD', '2024-01-20'),
 ('00000000-0000-0000-0000-00000000000b', '30837S108234', NULL, NULL, NULL, NULL),
 ('00000000-0000-0000-0000-00000000000c', NULL, 52800, 'sold', 'USD', '2023-01-20'),
 ('00000000-0000-0000-0000-00000000000d', 'F10D6R35426', NULL, NULL, NULL, NULL);

-- price + date alone: refused
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, final_price, sold_at)
  VALUES ('00000000-0000-0000-0000-00000000000c', 'barrettjackson', 'conceptcarz://event/9/1963 CHEVROLET CORVAIRChassis#: 30927W123', 'sold', 52800, '2023-01-20')$q$),
  'aggregator insert with matching price and date but no chassis/VIN or lot citation is refused');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'conceptcarz', 'https://example.test/whatever')$q$), 'source_platform conceptcarz counts as aggregator');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url) VALUES
  ('00000000-0000-0000-0000-00000000000b', 'barrettjackson', 'conceptcarz://event/9/1963 CORVETTEChassis#: 40837S108234')$q$),
  'a different chassis is refused');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url) VALUES
  ('00000000-0000-0000-0000-00000000000b', 'barrettjackson', 'conceptcarz://event/9/1963 CORVETTEChassis#: 08234')$q$),
  'a chassis fragment under 6 characters is not a suffix match');

-- chassis/VIN matches: accepted
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, final_price) VALUES
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'barrettjackson', 'conceptcarz://event/7/1956 FORD F-100Chassis#: F10D6R35426', 'sold', 40000),
 ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'mecum', 'conceptcarz://event/8/1963 CORVETTEChassis#: 30837-S-108234', 'sold', 90000),
 ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'barrettjackson', 'conceptcarz://event/8/1985 CORVETTEChassis#: F5100001', 'sold', 30000);
SELECT pg_temp.ok((SELECT count(*) = 3 FROM public.vehicle_events), 'exact, punctuated and >=6-char VIN-suffix chassis matches attach');

-- non-aggregator rows untouched by the rule
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, source_listing_id, event_status, final_price, sold_at) VALUES
 ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000000c', 'barrettjackson', 'https://www.barrett-jackson.com/scottsdale-2023/lot-1077', '1077', 'sold', 52800, '2023-01-20');
SELECT pg_temp.ok(true, 'house event attaches without any basis');

-- cited same-lot
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, metadata) VALUES
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', 'barrettjackson', 'conceptcarz://event/9/1963 CORVAIR',
  '{"attach_basis":{"kind":"same_lot","cited_event_id":"00000000-0000-0000-0000-000000000010","lot_number":"1077","citation":"barrett-jackson.com lot 1077 page"}}');
SELECT pg_temp.ok(public.aggregator_event_attach_basis('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c',
  'conceptcarz://event/9/1963 CORVAIR', 'barrettjackson',
  '{"attach_basis":{"kind":"same_lot","cited_event_id":"00000000-0000-0000-0000-000000000010","lot_number":"1077","citation":"x"}}') = 'same_lot',
  'a cited same-lot house event on the same vehicle attaches');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, metadata) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'barrettjackson', 'conceptcarz://event/9/X', '{"attach_basis":{"kind":"same_lot","cited_event_id":"00000000-0000-0000-0000-000000000010","lot_number":"1078","citation":"x"}}')$q$),
  'a lot number the cited event does not carry is refused');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, metadata) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'barrettjackson', 'conceptcarz://event/9/X', '{"attach_basis":{"kind":"same_lot","cited_event_id":"00000000-0000-0000-0000-000000000010","lot_number":"1077"}}')$q$),
  'a same-lot claim without a citation is refused');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, metadata) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'barrettjackson', 'conceptcarz://event/9/X', '{"attach_basis":{"kind":"same_lot","cited_event_id":"00000000-0000-0000-0000-000000000010","lot_number":"1077","citation":"x"}}')$q$),
  'citing another vehicle''s event is refused');
SELECT pg_temp.ok(pg_temp.refused($q$INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, metadata) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'barrettjackson', 'conceptcarz://event/9/X', '{"attach_basis":{"kind":"same_lot","cited_event_id":"00000000-0000-0000-0000-000000000004","lot_number":"1077","citation":"x"}}')$q$),
  'citing another aggregator event is refused');

-- re-point and merge carry
SELECT pg_temp.ok(pg_temp.refused($q$UPDATE public.vehicle_events SET vehicle_id = '00000000-0000-0000-0000-00000000000c' WHERE id = '00000000-0000-0000-0000-000000000001'$q$),
  'a plain re-point to a vehicle without a basis is refused');
UPDATE public.vehicle_events SET vehicle_id = '00000000-0000-0000-0000-00000000000c', merged_from_vehicle_id = '00000000-0000-0000-0000-00000000000d'
 WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT source_suspect = '{vehicle_id}' AND source_suspect_run_id = 'aggregator_attach_guard' FROM public.vehicle_events
  WHERE id = '00000000-0000-0000-0000-000000000001'), 'a merge carry without a basis is kept and flagged vehicle_id');
UPDATE public.vehicle_events SET final_price = 52800, event_status = 'sold', metadata = '{"note":1}' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok(true, 'updating a row that stays on its vehicle is not re-judged');
SELECT pg_temp.ok(pg_temp.refused($q$UPDATE public.vehicle_events SET source_url = 'conceptcarz://event/1/X' WHERE id = '00000000-0000-0000-0000-000000000010'$q$),
  'a house row turned into an aggregator row without a basis is refused');

-- price trust: wrong-vehicle event whose price the vehicle carries
UPDATE public.vehicles SET sale_price = 77000 WHERE id = '00000000-0000-0000-0000-00000000000b';
UPDATE public.vehicle_events SET final_price = 77000 WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000b', 77000), 'unflagged: trusted');
UPDATE public.vehicle_events SET source_suspect = '{vehicle_id}' WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000b', 77000), 'flagged wrong vehicle: copied price untrusted');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.vehicle_sale_price_untrusted_ids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b'), 'view agrees');
SELECT pg_temp.ok((SELECT sale_price = 77000 FROM public.vehicles WHERE id = '00000000-0000-0000-0000-00000000000b'), 'no price moved');
-- vehicle c: house event 52800 vouches; flagged aggregator event 000...1 at 52800 does not make it untrusted
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000c', 52800), 'an unflagged house event still vouches');
UPDATE public.vehicle_events SET source_suspect = '{vehicle_id}' WHERE id = '00000000-0000-0000-0000-000000000010';
SELECT pg_temp.ok(public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000c', 52800)
  AND EXISTS (SELECT 1 FROM public.vehicle_sale_price_untrusted_ids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000c'),
  'a flagged event can never vouch for a price');
-- verified price on a flagged event: no vouching, no sync
TRUNCATE public.sync_calls;
UPDATE public.vehicle_events SET price_verification = 'verified', price_verification_source = 'x', sold_at = '2025-01-01'
 WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sync_calls), 'the sale-price sync never copies from a flagged event');
UPDATE public.vehicle_events SET source_suspect = NULL WHERE id = '00000000-0000-0000-0000-000000000002';
UPDATE public.vehicle_events SET price_verification_at = now() WHERE id = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.sync_calls), 'control: the same event unflagged does drive the sync');

-- rollback restores the previous objects
\ir ../rollbacks/20261026081000_aggregator_event_attach_guard_down.sql
SELECT pg_temp.ok(to_regproc('public.aggregator_event_attach_basis') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_aggregator_event_attach'), 'rollback drops the guard');
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000b', 77000) OR true, 'rollback function callable');
