-- Disposable PG17: close_deal_guard_columns_v1 (migration 20261125171500), on top of the close_deal_on_sale fixture.
-- Covers: the migration runs twice and patches once; the closure still lands through the trigger; a direct write of
-- closed_by_auction_event_id or closed_price_basis (UPDATE or INSERT) is refused; clearing is allowed, and deleting the
-- closing event clears the key; a price_unknown skip is written for a deal the sale could close and not for a deal
-- opened after the sale ended. Run from the repo root in an empty database named dm_refinement_<name>. Synthetic rows.
\set ON_ERROR_STOP on
\ir test_close_deal_on_sale_columns.sql
RESET ROLE;

\i supabase/migrations/20261125171500_close_deal_guard_columns.sql
\i supabase/migrations/20261125171500_close_deal_guard_columns.sql
SELECT public.assert((length(d) - length(replace(d, 'close_deal_guard_columns_v1', ''))) / length('close_deal_guard_columns_v1') = 1,
                     'patched once')
  FROM (SELECT pg_get_functiondef('public.close_deal_on_sale()'::regprocedure) d) x;

CREATE FUNCTION public.refuses_priv(sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; RAISE EXCEPTION 'FAIL: accepted: %', sql;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- The trigger still closes.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2', 'consignment', '2026-01-01');
INSERT INTO public.auction_events (id, source, vehicle_id, outcome, gross_price, auction_end_date)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'bat', '00000000-0000-0000-0000-0000000000b1', 'sold', 300, '2026-11-21 18:00Z');
SELECT public.assert(closed_by_auction_event_id = '00000000-0000-0000-0000-0000000000c1' AND closed_price_basis = 'gross'
                     AND sale_price_inc_doc = 300, 'closed through the trigger')
  FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000f1';
SELECT public.assert(coalesce(current_setting('deal_jackets.closing', true), '') = '', 'setting reset after the closure');

-- Direct writes are refused.
SELECT public.refuses_priv($$UPDATE public.deal_jackets SET closed_by_auction_event_id = '00000000-0000-0000-0000-0000000000c1' WHERE id = '00000000-0000-0000-0000-0000000000f2'$$);
SELECT public.refuses_priv($$UPDATE public.deal_jackets SET closed_price_basis = 'hammer' WHERE id = '00000000-0000-0000-0000-0000000000f1'$$);
SELECT public.refuses_priv($$INSERT INTO public.deal_jackets (vehicle_id, deal_type, closed_price_basis) VALUES ('00000000-0000-0000-0000-0000000000b3', 'consignment', 'gross')$$);
-- Other columns stay writable, and an unchanged key passes.
UPDATE public.deal_jackets SET updated_at = now(), closed_price_basis = closed_price_basis WHERE id = '00000000-0000-0000-0000-0000000000f1';
-- Clearing is allowed: the event's delete clears the key (ON DELETE SET NULL).
DELETE FROM public.auction_events WHERE id = '00000000-0000-0000-0000-0000000000c1';
SELECT public.assert(closed_by_auction_event_id IS NULL, 'event delete cleared the key')
  FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000f1';

-- The closing setting is reset inside the closing transaction: a direct key write to the deal it just closed, later
-- in the same transaction, is refused.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000b6', 'consignment', '2026-01-01');
DO $same_tx$
BEGIN
  INSERT INTO public.auction_events (id, source, vehicle_id, outcome, gross_price, auction_end_date)
  VALUES ('00000000-0000-0000-0000-0000000000c6', 'bat', '00000000-0000-0000-0000-0000000000b6', 'sold', 400, '2026-11-21 18:00Z');
  PERFORM public.assert(closed_by_auction_event_id = '00000000-0000-0000-0000-0000000000c6', 'closed in the transaction')
    FROM public.deal_jackets WHERE id = '00000000-0000-0000-0000-0000000000f6';
  PERFORM public.refuses_priv($$UPDATE public.deal_jackets SET closed_price_basis = 'hammer' WHERE id = '00000000-0000-0000-0000-0000000000f6'$$);
END
$same_tx$;

-- Skip rows only for a deal the sale could close.
INSERT INTO public.deal_jackets (id, vehicle_id, deal_type, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b4', 'consignment', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000b4', 'consignment', now());
INSERT INTO public.auction_events (source, vehicle_id, outcome, high_bid, winning_bid, auction_end_date)
VALUES ('somehouse', '00000000-0000-0000-0000-0000000000b4', 'sold', 700, 700, now() - interval '5 days');
SELECT public.assert(EXISTS (SELECT 1 FROM public.deal_close_skips WHERE deal_jacket_id = '00000000-0000-0000-0000-0000000000f4' AND reason = 'price_unknown'),
                     'skip for the deal open before the sale');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.deal_close_skips WHERE deal_jacket_id = '00000000-0000-0000-0000-0000000000f5'),
                     'no skip for a deal opened after the sale ended');

\echo 'test_close_deal_guard_columns: PASS'
