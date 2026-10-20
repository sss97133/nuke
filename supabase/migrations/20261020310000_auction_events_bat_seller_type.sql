-- auction_events.seller_type: describe the column now that a writer exists (extract-bat-core 4.5.2).
--
-- WHY (measured 2026-10-20): the column comment said "UNKNOWN writer (none in current code)". Cars & Bids rows carry
-- 'private' (32,850) and 'dealer' (9,841); every BaT row (267,982) was NULL because extract-bat-core read the lot page's
-- "Private Party or Dealer" line nowhere and the shared parser's pattern matched none of 300 sampled pages.
-- extract-bat-core 4.5.2 writes 'private' | 'dealer' from that line on each lot it reads, and keeps the text as read in
-- raw_data.party_type_raw. Comment only: no data change, no backfill (that is a plan, scripts/bat-seller-type-backfill.mjs).
SET statement_timeout = '10s';
SET lock_timeout = '3s';

COMMENT ON COLUMN public.auction_events.seller_type IS
  'Seller class of this lot: private or dealer, else NULL. Source: the source''s own label. BaT: the lot page''s "Private Party or Dealer" line, written by extract-bat-core 4.5.2 (the text as read is in raw_data.party_type_raw; only BaT''s two values are typed, anything else stays NULL). Cars & Bids: its seller type. Unit: none. Grain: one lot. Clock: the page read (scraped_at).';
