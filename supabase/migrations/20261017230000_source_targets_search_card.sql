-- source_targets can hold a discovered-not-fetched listing with what its search card already says.
-- A source whose paid fetching is paused (KSL, 2026-10-15: rank 0.313 against a 0.5 floor) still has to show its supply and
-- its tier share, or it can never earn its way back. The 6-hourly poll reads the search page for free; each card gives the
-- listing id, make year, seller class (Private / Dealership), created time and price. One row per listing URL (the table's
-- unique key), written without any fetch and without touching the import_queue ledger, so no attempt is counted.
-- new_per_day is count(card_created_at in a day); the 1964-1991 share is count(card_year between 1964 and 1991) over all.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.source_targets
  ADD COLUMN IF NOT EXISTS card_year integer,
  ADD COLUMN IF NOT EXISTS card_seller_type text,
  ADD COLUMN IF NOT EXISTS card_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_price numeric,
  ADD COLUMN IF NOT EXISTS card_observed_at timestamptz;
COMMENT ON COLUMN public.source_targets.card_year IS 'Make year shown on the search card (KSL makeYear). NULL when the source row came from a sitemap.';
COMMENT ON COLUMN public.source_targets.card_seller_type IS 'The card''s own seller class word, lower-cased (KSL: private, dealership). NULL when the card does not show one.';
COMMENT ON COLUMN public.source_targets.card_created_at IS 'When the listing went up, as the search card states it (KSL createdAt).';
COMMENT ON COLUMN public.source_targets.card_price IS 'Asking price on the search card, in dollars.';
COMMENT ON COLUMN public.source_targets.card_observed_at IS 'When the poll last read this card (a free search-page read; no fetch of the listing).';
