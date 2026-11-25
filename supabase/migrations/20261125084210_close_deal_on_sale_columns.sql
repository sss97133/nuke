-- close_deal_on_sale_columns_v1: the deal-closing trigger on auction_events reads columns auction_events has, writes
-- no guessed price or date into a deal, and auction-close transfers send no message unless a config row allows it.
--
-- WHY. Measured live 2026-11-25. close_deal_on_sale() (trigger trg_close_deal_on_sale, AFTER INSERT OR UPDATE ON
-- auction_events, migration 20261116063200, PR #3529, deployed 2026-11-13 15:15Z) reads NEW.sale_price and
-- NEW.event_date. auction_events has neither column. Every write of a row with outcome = 'sold' raised
-- 'record "new" has no field "sale_price"' and rolled back the writer:
--   auction_events source = 'bat', outcome = 'sold', rows per day: 11-11 81, 11-12 174, 11-13 140, 11-14..11-25 0;
--   ingest-observation logs bat_live_admission_failed every few seconds; extract-bat-core bat_live_handoff_http_500
--   (163 in the 3 h before 00:20 PT 11-25); closing_stream covered_lots 0 of 251.
-- Of the 10 trigger functions on auction_events, close_deal_on_sale is the only one reading a NEW.<column> the table
-- lacks (preserve_bat_live_projection names NEW.metadata only in a vehicle_events branch). Read live 2026-11-25.
--
-- WHAT CHANGES.
-- 1. auction_source_price_rules(source PK, final_bid_is_hammer, basis): whether a house's final bid on a sold lot is
--    its hammer. Seeded BaT: sold rows ended 2026-09-01..11-13 = 9,511; winning_bid = high_bid on 9,510; high_bid =
--    hammer_price on 6,621 of the 6,622 with a hammer.
-- 2. close_deal_on_sale: sale price = gross_price, else hammer_price, else the final bid (winning_bid, high_bid) only
--    when the source's rule row says it is the hammer; otherwise the price is unknown. Sold date = auction_end_date,
--    never the day the row landed. An open consignment deal whose price or end date is unknown is not closed; a
--    deal_close_skips row (auction_event_id, deal_jacket_id, reason) says why. A sale that ended before the deal was
--    opened never closes it. Open consignment deal_jackets today: 0 (5 consignment deals, all closed).
-- 3. Transfers. Each settled sold lot fires auto_create_transfer_on_auction_close (sales ended within 30 days) ->
--    transfer-automator seed_from_auction -> ownership_transfers row and, unless suppress_notifications,
--    notify-transfer-parties (SMS / email to buyer and seller contacts). Messages to other people are the owner's
--    decision, so it is a rule now: platform_config 'transfer_notifications' {"enabled": false}; the trigger (edited in
--    place) sends suppress_notifications = true unless that row says enabled, and always when the result lands over an
--    hour after the end or the end is unknown. The transfer row is still seeded.
-- Test: supabase/sql/test_close_deal_on_sale_columns.sql (PG17: live auction_events columns and checks, the live
-- transfer trigger body from its migration, pg_net stubbed).
--
-- REVERT. Re-run the bodies from 20261116063200 and 20261016170000; drop deal_close_skips and auction_source_price_rules;
-- delete the platform_config row.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.auction_source_price_rules (
  source              text        PRIMARY KEY,
  final_bid_is_hammer boolean     NOT NULL,
  basis               text        NOT NULL CHECK (length(basis) >= 20),
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auction_source_price_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auction_source_price_rules FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.auction_source_price_rules TO service_role;
INSERT INTO public.auction_source_price_rules (source, final_bid_is_hammer, basis) VALUES
  ('bat', true, 'auction_events bat sold, ended 2026-09-01..11-13: 9,511 rows; winning_bid = high_bid on 9,510; '
                'high_bid = hammer_price on 6,621 of the 6,622 with a hammer (read 2026-11-25).')
ON CONFLICT (source) DO NOTHING;
COMMENT ON TABLE public.auction_source_price_rules IS
'Per auction house: whether the final bid on a sold lot (winning_bid, else high_bid) is its hammer price. Read by close_deal_on_sale() when a sold row carries no gross or hammer price. Migration 20261125084210.';

CREATE TABLE IF NOT EXISTS public.deal_close_skips (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_event_id uuid        NOT NULL REFERENCES public.auction_events (id) ON DELETE CASCADE,
  deal_jacket_id   uuid        NOT NULL REFERENCES public.deal_jackets (id) ON DELETE CASCADE,
  reason           text        NOT NULL CHECK (reason IN ('price_unknown', 'end_date_unknown')),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auction_event_id, deal_jacket_id, reason)
);
ALTER TABLE public.deal_close_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deal_close_skips FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.deal_close_skips TO service_role;
COMMENT ON TABLE public.deal_close_skips IS
'An open consignment deal that a sold auction_events row did not close, and why: its price or its end date is unknown. Written by close_deal_on_sale(). Migration 20261125084210.';

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('transfer_notifications', '{"enabled": false}'::jsonb,
        'Whether auction-close transfers may message buyers and sellers (notify-transfer-parties). Messages to other people are the owner''s decision; off unless he turns it on. Read by auto_create_transfer_on_auction_close(). Migration 20261125084210.')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.close_deal_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_deal record;
  v_sale_price numeric;
  v_threshold numeric;
  v_profit numeric;
BEGIN
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN RETURN NEW; END IF;

  -- close_deal_on_sale_columns_v1: a price the row carries, or the final bid where the house's rule row says it is the
  -- hammer; otherwise unknown.
  v_sale_price := coalesce(NEW.gross_price, NEW.hammer_price,
                           CASE WHEN EXISTS (SELECT 1 FROM public.auction_source_price_rules p
                                              WHERE p.source = NEW.source AND p.final_bid_is_hammer)
                                THEN coalesce(NEW.winning_bid, NEW.high_bid) END);
  IF v_sale_price <= 0 THEN v_sale_price := NULL; END IF;

  FOR v_deal IN
    SELECT dj.id, dj.vehicle_id
      FROM public.deal_jackets dj
     WHERE dj.vehicle_id = NEW.vehicle_id
       AND dj.deal_type = 'consignment'
       AND dj.sold_date IS NULL
       -- A sale that ended before the deal was opened does not close it.
       AND (NEW.auction_end_date IS NULL OR NEW.auction_end_date >= dj.created_at)
  LOOP
    IF NEW.auction_end_date IS NULL OR v_sale_price IS NULL THEN
      INSERT INTO public.deal_close_skips (auction_event_id, deal_jacket_id, reason)
      VALUES (NEW.id, v_deal.id, CASE WHEN v_sale_price IS NULL THEN 'price_unknown' ELSE 'end_date_unknown' END)
      ON CONFLICT (auction_event_id, deal_jacket_id, reason) DO NOTHING;
      CONTINUE;
    END IF;

    UPDATE public.deal_jackets SET
      sold_date = NEW.auction_end_date::date,
      sale_price_inc_doc = v_sale_price,
      updated_at = now()
    WHERE id = v_deal.id;

    SELECT coalesce(threshold_amount, 0) INTO v_threshold
      FROM public.deal_jacket_parties
     WHERE deal_jacket_id = v_deal.id AND role = 'owner'
     LIMIT 1;

    v_profit := greatest(0, v_sale_price - coalesce(v_threshold, 0));

    UPDATE public.deal_jacket_parties SET
      actual_amount = CASE
        WHEN role = 'owner' THEN least(v_sale_price, coalesce(threshold_amount, 0))
        WHEN split_pct IS NOT NULL THEN v_profit * split_pct / 100
        WHEN flat_fee IS NOT NULL THEN flat_fee
        WHEN commission_pct IS NOT NULL THEN v_sale_price * commission_pct / 100
        ELSE NULL
      END,
      actual_currency = 'USD'
    WHERE deal_jacket_id = v_deal.id;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.close_deal_on_sale() FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  d text; n int;
  a text := $a$'auction_event_id', NEW.id::text$a$;
  r text := $r$'auction_event_id', NEW.id::text,
        -- close_deal_on_sale_columns_v1: no message unless platform_config transfer_notifications is enabled, and
        -- never for a result landing over an hour after the end or with no end.
        'suppress_notifications',
          NOT coalesce((SELECT (c.config_value->>'enabled')::boolean FROM public.platform_config c
                         WHERE c.config_key = 'transfer_notifications'), false)
          OR coalesce(NEW.auction_end_date < now() - interval '1 hour', true)$r$;
BEGIN
  IF to_regprocedure('public.auto_create_transfer_on_auction_close()') IS NULL THEN RETURN; END IF;
  d := pg_get_functiondef('public.auto_create_transfer_on_auction_close()'::regprocedure);
  IF position('close_deal_on_sale_columns_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'auto_create_transfer_on_auction_close anchor drifted: % matches', n; END IF;
  EXECUTE replace(d, a, r);
END
$patch$;
