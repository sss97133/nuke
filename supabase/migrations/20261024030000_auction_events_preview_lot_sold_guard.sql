-- A Bonhams preview-lot card is not a lot of its sale. Catalog imports stored 8 of them as outcome 'sold' with junk bids
-- (5, 11), and the 2026-10-19 ended-auction sync then promoted their vehicle_events to 'sold' from those rows.
-- New writes may record a preview-lot row as sold only with a real price (>= 100); existing rows are not re-checked.
-- Revert: alter table public.auction_events drop constraint auction_events_preview_lot_sold_needs_price;
alter table public.auction_events
  add constraint auction_events_preview_lot_sold_needs_price
  check (not (outcome = 'sold' and source_url ~* '/auction/[0-9]+/preview-lot/' and coalesce(winning_bid, 0) < 100))
  not valid;
