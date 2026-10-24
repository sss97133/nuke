-- Isolated PostgreSQL 17 contract for 20261026112000_vehicle_price_untrusted_marks.sql (on 20261026091000). Synthetic rows only.
--   createdb dm_refinement_price_marks_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_price_marks_ci -f supabase/sql/test_aggregator_event_attach_guard.sql
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
  source_suspect_run_id text, source_suspect_at timestamptz, identity_check text);
CREATE TABLE public.fx_rates (base_currency text, quote_currency text, rate_date date);
CREATE TABLE public.sync_calls (rows jsonb);
CREATE FUNCTION public.correct_vehicle_sale_provenance_batch(p_rows jsonb, p_asserted_by text, p_reason text)
 RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.sync_calls VALUES (p_rows) RETURNING p_rows $$;

\ir ../migrations/20261026091000_aggregator_event_attach_guard.sql
\ir ../migrations/20261026112000_vehicle_price_untrusted_marks.sql
CREATE TRIGGER trg_sync_vehicle_sale_price_from_verified_event AFTER INSERT OR UPDATE ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_sale_price_from_verified_event();

CREATE FUNCTION pg_temp.ok(c boolean, m text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', m; END IF; RAISE NOTICE 'ok: %', m; END $$;
INSERT INTO public.vehicles VALUES
 ('00000000-0000-0000-0000-00000000000a', 'XXXXXX1', 50000, 'sold', 'USD', '2024-01-01'),
 ('00000000-0000-0000-0000-00000000000b', '30837S108234', NULL, NULL, NULL, NULL);
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, event_status, final_price) VALUES
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'mecum', 'conceptcarz://event/8/1963 CORVETTEChassis#: 30837S108234', 'sold', 50000);
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000a', 50000), 'no events, no mark: trusted');
INSERT INTO public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, reason, source_event_id, run_id)
 VALUES ('00000000-0000-0000-0000-00000000000a', 50000, 'copied from a moved wrong-vehicle event', '00000000-0000-0000-0000-000000000001', 'r1');
SELECT pg_temp.ok(public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000a', 50000), 'a live mark on the current price: untrusted');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.vehicle_sale_price_untrusted_ids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a'), 'view agrees');
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000a', 61000), 'a mark covers only the marked price');
UPDATE public.vehicles SET sale_price = 61000 WHERE id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.vehicle_sale_price_untrusted_ids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a'), 'view: a new price is not covered by the old mark');
UPDATE public.vehicles SET sale_price = 50000 WHERE id = '00000000-0000-0000-0000-00000000000a';
UPDATE public.vehicle_sale_price_untrusted_marks SET retired_at = now();
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000a', 50000)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_sale_price_untrusted_ids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a'), 'a retired mark no longer applies');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.vehicle_sale_price_untrusted_ids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b'), 'chassis-matched event on its vehicle: unaffected');
\ir ../rollbacks/20261026112000_vehicle_price_untrusted_marks_down.sql
SELECT pg_temp.ok(to_regclass('public.vehicle_sale_price_untrusted_marks') IS NOT NULL, 'rollback keeps the marks table');
UPDATE public.vehicle_sale_price_untrusted_marks SET retired_at = NULL;
SELECT pg_temp.ok(NOT public.vehicle_sale_price_untrusted('00000000-0000-0000-0000-00000000000a', 50000), 'after rollback readers ignore marks');
