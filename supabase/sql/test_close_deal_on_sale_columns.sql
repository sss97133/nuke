-- Disposable PG17: 20261125084210. auction_events is built with every live column, NOT NULL, default and CHECK (read
-- 2026-11-25, 87 columns); the deployed close_deal_on_sale body (20261116063200) and the live transfer trigger body
-- (20261016170000) are loaded from their migrations, with pg_net stubbed to record each request. Covers: the deployed
-- body refuses a sold row; the fix closes an open consignment deal at the row's price and end date; no current-date or
-- high-bid guess (an unknown price or end date skips the deal with a deal_close_skips row; the final bid counts only
-- where auction_source_price_rules says it is the hammer); an older sale never closes a newer deal; every transfer
-- seeded while platform_config transfer_notifications is off, landing over an hour late, or with no end date is
-- suppressed; every NEW.<column> both trigger bodies read exists on the table. Synthetic rows only.
-- guardrail-allow(center-key-fk): auction_events: disposable fixture mirroring the live columns; no vehicles table here
-- guardrail-allow(center-key-fk): deal_jackets: disposable fixture with the live columns the trigger reads; no vehicles table here
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TYPE public.price_basis_t AS ENUM ('hammer', 'gross_incl_premium', 'net_to_owner', 'unknown');
CREATE TABLE public.auction_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  source text NOT NULL,
  source_url text,
  source_listing_id text,
  lot_number text,
  auction_start_date timestamp with time zone,
  auction_end_date timestamp with time zone,
  auction_duration_hours integer,
  outcome text NOT NULL,
  starting_bid numeric,
  reserve_price numeric,
  reserve_disclosed boolean DEFAULT false,
  high_bid numeric,
  winning_bid numeric,
  buy_it_now_price numeric,
  total_bids integer,
  unique_bidders integer,
  bid_history jsonb,
  high_bidder text,
  winning_bidder text,
  seller_name text,
  seller_type text,
  seller_location text,
  estimate_low numeric,
  estimate_high numeric,
  page_views integer,
  watchers integer,
  comments_count integer,
  market_insights jsonb,
  price_vs_estimate_pct numeric,
  reserve_gap_pct numeric,
  scraped_at timestamp with time zone DEFAULT now(),
  raw_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  receipt_data jsonb,
  ai_summary text,
  sentiment_arc jsonb,
  key_moments jsonb,
  top_contributors jsonb,
  broadcast_video_id text,
  broadcast_video_url text,
  broadcast_timestamp_start integer,
  broadcast_timestamp_end integer,
  broadcast_clip_url text,
  forensics_data jsonb,
  merged_from_vehicle_id uuid,
  winning_bidder_external_identity_id uuid,
  seller_external_identity_id uuid,
  broadcast_publisher_organization_id uuid,
  broadcast_evidence_state jsonb,
  broadcast_evidence_last_observation_id uuid,
  broadcast_evidence_dirty boolean NOT NULL DEFAULT false,
  currency_code text,
  currency_source text,
  price_basis price_basis_t,
  hammer_price numeric,
  hammer_price_source text,
  hammer_price_confidence text,
  buyer_premium_amount numeric,
  buyer_premium_rate numeric,
  buyer_premium_source text,
  buyer_premium_confidence text,
  gross_price numeric,
  gross_price_source text,
  gross_price_confidence text,
  seller_fee_amount numeric,
  seller_fee_source text,
  seller_fee_confidence text,
  net_to_owner numeric,
  net_to_owner_source text,
  net_to_owner_confidence text,
  price_basis_run_id text,
  fx_to_usd numeric,
  fx_to_usd_source text,
  price_basis_conflict boolean,
  price_kind text,
  price_kind_source text,
  lot_category text,
  lot_category_source text,
  sale_type text,
  sale_type_source text,
  charity_lot boolean,
  charity_lot_source text,
  canonical_listing_url text,
  duplicate_of uuid,
  CONSTRAINT auction_events_pkey PRIMARY KEY (id),
  CONSTRAINT auction_events_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT auction_events_lot_category_check CHECK ((lot_category = ANY (ARRAY['car'::text, 'motorcycle'::text, 'minibike'::text, 'parts'::text, 'wheels'::text, 'atv'::text, 'go_kart'::text, 'tractor'::text, 'automobilia'::text, 'other'::text]))),
  CONSTRAINT auction_events_outcome_check CHECK ((outcome = ANY (ARRAY['sold'::text, 'reserve_not_met'::text, 'no_sale'::text, 'bid_to'::text, 'cancelled'::text, 'relisted'::text, 'pending'::text, 'live'::text]))),
  CONSTRAINT auction_events_preview_lot_sold_needs_price CHECK ((NOT ((outcome = 'sold'::text) AND (source_url ~* '/auction/[0-9]+/preview-lot/'::text) AND (COALESCE(winning_bid, (0)::numeric) < (100)::numeric)))),
  CONSTRAINT auction_events_price_kind_check CHECK ((price_kind = ANY (ARRAY['sale'::text, 'high_bid_unsold'::text, 'estimate'::text, 'unknown'::text]))),
  CONSTRAINT auction_events_sale_type_check CHECK ((sale_type = ANY (ARRAY['live'::text, 'online'::text, 'unknown'::text])))
);
SELECT count(*) = 87 AS all_live_columns FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auction_events' \gset
\if :all_live_columns
\else
  \echo 'FAIL: auction_events fixture is not the 87 live columns'
  SELECT 1/0;
\endif
CREATE TABLE public.deal_jackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, deal_type text, sold_date date,
  sale_price_inc_doc numeric, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now());
CREATE TABLE public.deal_jacket_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_jacket_id uuid, role text, threshold_amount numeric,
  split_pct numeric, flat_fee numeric, commission_pct numeric, actual_amount numeric, actual_currency text);
CREATE TABLE public.platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE, config_value jsonb, description text,
  updated_at timestamptz DEFAULT now(), updated_by uuid);
-- pg_net and the cron key, stubbed: each request is recorded.
CREATE SCHEMA net;
CREATE TABLE net.sent (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.sent (url, body) VALUES (url, body) RETURNING id $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'test-key' $$;

-- The deployed bodies, from their migrations.
\set deployed_close `sed -n '/^CREATE OR REPLACE FUNCTION close_deal_on_sale()/,/^\$\$;/p' supabase/migrations/20261116063200_deal_jacket_parties_functions.sql`
\set deployed_transfer `sed -n '/^CREATE OR REPLACE FUNCTION public.auto_create_transfer_on_auction_close()/,/^\$function\$;/p' supabase/migrations/20261016170000_transfer_seed_recent_sales_only.sql`
:deployed_close
:deployed_transfer
CREATE TRIGGER trg_close_deal_on_sale AFTER INSERT OR UPDATE ON public.auction_events
  FOR EACH ROW EXECUTE FUNCTION public.close_deal_on_sale();
CREATE TRIGGER trg_auto_create_transfer_on_auction_close AFTER INSERT OR UPDATE OF outcome ON public.auction_events
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_transfer_on_auction_close();
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'close_deal_on_sale') NOT LIKE '%NEW.sale_price%' THEN
    RAISE EXCEPTION 'FAIL: deployed close_deal_on_sale body not loaded';
  END IF;
  BEGIN
    INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid) VALUES ('bat', gen_random_uuid(), 'sold', 1);
    RAISE EXCEPTION 'FAIL: the deployed body accepted a sold row';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

\i supabase/migrations/20261125084210_close_deal_on_sale_columns.sql
\i supabase/migrations/20261125084210_close_deal_on_sale_columns.sql

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

-- Every NEW.<column> both trigger bodies read is a column of the live-shaped table.
SELECT public.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p, regexp_matches(p.prosrc, '\mNEW\.([A-Za-z_][A-Za-z0-9_]*)', 'g') m
   WHERE p.proname IN ('close_deal_on_sale', 'auto_create_transfer_on_auction_close')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                        AND c.table_name = 'auction_events' AND c.column_name = lower(m[1]))),
  'a trigger body reads a column auction_events lacks');
SELECT public.assert(config_value->>'enabled' = 'false', 'transfer notifications off by default')
  FROM public.platform_config WHERE config_key = 'transfer_notifications';

-- Deals.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'consignment', now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a3', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a4', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a5', 'consignment', '2026-01-01');
INSERT INTO public.deal_jacket_parties (deal_jacket_id, role, threshold_amount, split_pct) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'owner', 100, NULL),
  ('00000000-0000-0000-0000-0000000000d1', 'shop', NULL, 50);
-- Unsold: nothing.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a1', 'reserve_not_met', 90, now() - interval '2 days');
SELECT public.assert(sold_date IS NULL, 'unsold row left the deal open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d1';
-- Sold with a gross price and an end date: closed at both.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, hammer_price, gross_price, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a1', 'sold', 140, 150, 160, '2026-11-24 18:00Z');
SELECT public.assert(sale_price_inc_doc = 160 AND sold_date = DATE '2026-11-24', 'closed at gross and end date: ' || row_to_json(d)::text)
  FROM public.deal_jackets d WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT public.assert((SELECT actual_amount FROM public.deal_jacket_parties WHERE role = 'owner') = 100
                     AND (SELECT actual_amount FROM public.deal_jacket_parties WHERE role = 'shop') = 30, 'party amounts');
-- An older sale does not close a newer deal.
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a2', 'sold', 500, now() - interval '10 days');
SELECT public.assert(sold_date IS NULL, 'older sale left the newer deal open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d2';
-- No end date: not closed, never dated today; a reason row.
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a3', 'sold', 500);
SELECT public.assert(sold_date IS NULL AND sale_price_inc_doc IS NULL, 'no end date: deal open') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d3';
SELECT public.assert(EXISTS (SELECT 1 FROM public.deal_close_skips WHERE deal_jacket_id = '00000000-0000-0000-0000-0000000000d3' AND reason = 'end_date_unknown'), 'end_date_unknown row');
-- A house with no price rule and only a final bid: price unknown, not the high bid.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, winning_bid, auction_end_date)
VALUES ('somehouse', '00000000-0000-0000-0000-0000000000a4', 'sold', 700, 700, now() - interval '2 days');
SELECT public.assert(sold_date IS NULL AND sale_price_inc_doc IS NULL, 'high bid is not a price without a rule') FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000d4';
SELECT public.assert(EXISTS (SELECT 1 FROM public.deal_close_skips WHERE deal_jacket_id = '00000000-0000-0000-0000-0000000000d4' AND reason = 'price_unknown'), 'price_unknown row');
-- BaT's rule row: the final bid is the hammer.
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, winning_bid, auction_end_date)
VALUES ('bat', '00000000-0000-0000-0000-0000000000a5', 'sold', 800, 810, '2026-11-20 18:00Z');
SELECT public.assert(sale_price_inc_doc = 810 AND sold_date = DATE '2026-11-20', 'bat final bid by rule: ' || row_to_json(d)::text)
  FROM public.deal_jackets d WHERE id = '00000000-0000-0000-0000-0000000000d5';

-- Transfers: every request so far was suppressed (config off).
SELECT public.assert(count(*) > 0 AND bool_and((body->>'suppress_notifications')::boolean), 'all suppressed while off: ' || coalesce(string_agg(body::text, ' | '), 'none'))
  FROM net.sent WHERE body->>'action' = 'seed_from_auction';
-- Turned on: a fresh result may notify; a backfilled one may not; a NULL end date seeds nothing at all.
UPDATE public.platform_config SET config_value = '{"enabled": true}' WHERE config_key = 'transfer_notifications';
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date) VALUES ('bat', gen_random_uuid(), 'sold', 10, now() - interval '5 minutes');
SELECT public.assert((body->>'suppress_notifications')::boolean = false, 'fresh result notifies when on') FROM net.sent;
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date) VALUES ('bat', gen_random_uuid(), 'sold', 10, now() - interval '3 days');
SELECT public.assert((body->>'suppress_notifications')::boolean = true, 'backfill suppressed even when on') FROM net.sent;
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price) VALUES ('bat', gen_random_uuid(), 'sold', 10);
SELECT public.assert(NOT EXISTS (SELECT 1 FROM net.sent WHERE coalesce((body->>'suppress_notifications')::boolean, false) = false),
                     'no unsuppressed request for a NULL end date');
-- A config row that is missing reads as off.
DELETE FROM public.platform_config WHERE config_key = 'transfer_notifications';
TRUNCATE net.sent;
INSERT INTO public.auction_events (source, vehicle_id, outcome, gross_price, auction_end_date) VALUES ('bat', gen_random_uuid(), 'sold', 10, now() - interval '5 minutes');
SELECT public.assert((body->>'suppress_notifications')::boolean = true, 'missing config row reads off') FROM net.sent;

SELECT public.assert(NOT has_function_privilege('anon', 'public.close_deal_on_sale()', 'EXECUTE'), 'anon cannot execute');
SELECT public.assert(NOT has_table_privilege('anon', 'public.deal_close_skips', 'SELECT'), 'anon cannot read skips');
\echo 'test_close_deal_on_sale_columns: PASS'
