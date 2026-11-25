-- Disposable PG17: 20261125084210. A sold auction_events row with the live table's columns (no sale_price, no
-- event_date) is written, and an open consignment deal closes at the sale price; non-sold rows pass untouched.
-- Run from the repo root in an empty database named dm_refinement_<name>. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, outcome text, high_bid numeric,
  hammer_price numeric, gross_price numeric, auction_end_date timestamptz);
CREATE TABLE public.deal_jackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, deal_type text, sold_date date,
  sale_price_inc_doc numeric, updated_at timestamptz, created_at timestamptz NOT NULL DEFAULT '2026-01-01');
CREATE TABLE public.deal_jacket_parties (
  deal_jacket_id uuid, role text, threshold_amount numeric, split_pct numeric, flat_fee numeric,
  commission_pct numeric, actual_amount numeric, actual_currency text);
-- The deployed body (20261116063200) refuses a sold row.
CREATE FUNCTION public.close_deal_on_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v numeric;
BEGIN
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN RETURN NEW; END IF;
  v := COALESCE(NEW.sale_price, NEW.high_bid);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_close_deal_on_sale AFTER INSERT OR UPDATE ON public.auction_events
  FOR EACH ROW EXECUTE FUNCTION public.close_deal_on_sale();
DO $$ BEGIN
  BEGIN
    INSERT INTO public.auction_events (vehicle_id, outcome, high_bid) VALUES (gen_random_uuid(), 'sold', 1);
    RAISE EXCEPTION 'FAIL: the old body accepted a sold row';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

-- The transfer seed trigger function (its live body's request object, without the HTTP call).
CREATE FUNCTION public.auto_create_transfer_on_auction_close() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('test.seed_body', jsonb_build_object(
        'action', 'seed_from_auction',
        'auction_event_id', NEW.id::text
      )::text, false);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_create_transfer_on_auction_close AFTER INSERT OR UPDATE OF outcome ON public.auction_events
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_transfer_on_auction_close();

\i supabase/migrations/20261125084210_close_deal_on_sale_columns.sql
\i supabase/migrations/20261125084210_close_deal_on_sale_columns.sql

INSERT INTO public.deal_jackets (id, vehicle_id, deal_type) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'consignment');
INSERT INTO public.deal_jacket_parties (deal_jacket_id, role, threshold_amount, split_pct) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'owner', 100, NULL),
  ('00000000-0000-0000-0000-0000000000d1', 'shop', NULL, 50);
INSERT INTO public.auction_events (vehicle_id, outcome, high_bid) VALUES ('00000000-0000-0000-0000-0000000000a1', 'reserve_not_met', 90);
DO $$ BEGIN
  IF (SELECT sold_date FROM public.deal_jackets) IS NOT NULL THEN RAISE EXCEPTION 'FAIL: unsold row closed the deal'; END IF;
END $$;
INSERT INTO public.auction_events (vehicle_id, outcome, high_bid, hammer_price, gross_price, auction_end_date)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'sold', 140, 150, 160, '2026-11-24 18:00Z');
DO $$ BEGIN
  IF (SELECT sale_price_inc_doc FROM public.deal_jackets) <> 160
     OR (SELECT sold_date FROM public.deal_jackets) <> DATE '2026-11-24' THEN
    RAISE EXCEPTION 'FAIL: deal not closed at gross price and close date: %', (SELECT row_to_json(d) FROM public.deal_jackets d);
  END IF;
  IF (SELECT actual_amount FROM public.deal_jacket_parties WHERE role = 'owner') <> 100
     OR (SELECT actual_amount FROM public.deal_jacket_parties WHERE role = 'shop') <> 30 THEN
    RAISE EXCEPTION 'FAIL: party amounts';
  END IF;
END $$;
-- A late-landing result seeds with notifications suppressed; a fresh one does not suppress.
INSERT INTO public.auction_events (vehicle_id, outcome, high_bid, auction_end_date) VALUES (gen_random_uuid(), 'sold', 10, now() - interval '3 days');
DO $$ BEGIN
  IF (current_setting('test.seed_body')::jsonb->>'suppress_notifications') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL: backlog seed not suppressed: %', current_setting('test.seed_body');
  END IF;
END $$;
INSERT INTO public.auction_events (vehicle_id, outcome, high_bid, auction_end_date) VALUES (gen_random_uuid(), 'sold', 10, now() - interval '5 minutes');
DO $$ BEGIN
  IF (current_setting('test.seed_body')::jsonb->>'suppress_notifications') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'FAIL: fresh seed suppressed: %', current_setting('test.seed_body');
  END IF;
END $$;
-- A sale that ended before the deal was opened does not close it.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'consignment', now());
INSERT INTO public.auction_events (vehicle_id, outcome, gross_price, auction_end_date)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'sold', 500, now() - interval '10 days');
DO $$ BEGIN
  IF (SELECT sold_date FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d2') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: an older sale closed a newer deal';
  END IF;
END $$;
-- A sold row with only a high bid and no close date still lands.
INSERT INTO public.auction_events (vehicle_id, outcome, high_bid) VALUES (gen_random_uuid(), 'sold', 50);
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.close_deal_on_sale()', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon execute'; END IF;
END $$;
\echo 'test_close_deal_on_sale_columns: PASS'
