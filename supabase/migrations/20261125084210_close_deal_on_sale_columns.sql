-- close_deal_on_sale_columns_v1: the deal-closing trigger on auction_events reads columns auction_events has.
--
-- WHY. Measured live 2026-11-25. close_deal_on_sale() (trigger trg_close_deal_on_sale, AFTER INSERT OR UPDATE ON
-- auction_events, migration 20261116063200, deployed 2026-11-13) reads NEW.sale_price and NEW.event_date. auction_events
-- has neither column (its price columns are gross_price, hammer_price, high_bid; its close clock is auction_end_date).
-- Every write of a row with outcome = 'sold' raised 'record "new" has no field "sale_price"' and rolled back the writer:
--   auction_events source = 'bat', outcome = 'sold', rows written per day (updated_at): 11-11 81, 11-12 174, 11-13 140,
--   11-14 through 11-25 0.
--   ingest-observation logs 'bat_live_admission_failed:record "new" has no field "sale_price"' every few seconds;
--   extract-bat-core logs 'bat_live_handoff_http_500' (163 responses in the 3 h before 00:20 PT 11-25);
--   monitored_auctions.stream_state sessions newest heartbeat 2026-11-14 18:33Z;
--   get_live_auction_health closing_stream: covered_lots 0 of 251, daily settlement 251 overdue results, 0 sold.
-- WHAT CHANGES. The same body with two expressions corrected:
--   sale price = coalesce(NEW.gross_price, NEW.hammer_price, NEW.high_bid) (deal_jackets.sale_price_inc_doc is the
--   price including the buyer's fee, which gross_price carries when known);
--   sold date  = coalesce(NEW.auction_end_date::date, current_date).
-- Table names are schema-qualified and search_path pinned. Open consignment deal_jackets today: 0, so no deal row moves
-- at deploy; the writers that were refused (live admission, archived sale qualification) land on their next runs.
-- Test: supabase/sql/test_close_deal_on_sale_columns.sql (PG17).
--
-- REVERT. Re-run the function body from 20261116063200_deal_jacket_parties_functions.sql (it fails every sold write).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

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

  -- close_deal_on_sale_columns_v1
  v_sale_price := coalesce(NEW.gross_price, NEW.hammer_price, NEW.high_bid);
  IF v_sale_price IS NULL OR v_sale_price <= 0 THEN RETURN NEW; END IF;

  FOR v_deal IN
    SELECT dj.id, dj.vehicle_id
      FROM public.deal_jackets dj
     WHERE dj.vehicle_id = NEW.vehicle_id
       AND dj.deal_type = 'consignment'
       AND dj.sold_date IS NULL
  LOOP
    UPDATE public.deal_jackets SET
      sold_date = coalesce(NEW.auction_end_date::date, current_date),
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
