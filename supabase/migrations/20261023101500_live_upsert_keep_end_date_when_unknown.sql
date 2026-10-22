-- A live write with no close time keeps the close on record; it never writes an invented one.
--
-- sync-live-auctions used to write now + 7 days when a source gave no close time (the Firecrawl extract for Mecum /
-- Barrett-Jackson, and the Cars & Bids homepage scrape, which also handed one lot another lot's close). 266 Cars &
-- Bids rows still carried that invented date on 2026-10-22 (superseded to NULL with a reason, backup
-- bak_r6_fabricated_end_dates). The function now sends NULL with origin_metadata.auction_end_date_missing_reason.
-- Here, a NULL in the payload no longer erases a close an extractor or an earlier live read put on the row, and does not
-- by itself count as a change. A new row is inserted with NULL as before. Nothing else in the function changes.
-- Guarded on the two exact fragments it edits, so a drifted function stops the migration unchanged; idempotent.
-- Contract: supabase/sql/test_live_upsert_keep_end_date_when_unknown.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE def text; src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'public.upsert_live_auction_vehicles(jsonb)'::regprocedure;
  IF src LIKE '%auction_end_date = coalesce(excluded.auction_end_date, v.auction_end_date)%' THEN RETURN; END IF; -- already applied
  IF (SELECT count(*) FROM regexp_matches(src, 'auction_end_date = excluded\.auction_end_date,', 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(src, 'OR v\.auction_end_date IS DISTINCT FROM excluded\.auction_end_date', 'g')) <> 1 THEN
    RAISE EXCEPTION 'upsert_live_auction_vehicles drifted from the body this migration edits; review first';
  END IF;
  def := pg_get_functiondef('public.upsert_live_auction_vehicles(jsonb)'::regprocedure);
  def := replace(def, 'auction_end_date = excluded.auction_end_date,',
                      'auction_end_date = coalesce(excluded.auction_end_date, v.auction_end_date),');
  def := replace(def, 'OR v.auction_end_date IS DISTINCT FROM excluded.auction_end_date',
                      'OR (excluded.auction_end_date IS NOT NULL AND v.auction_end_date IS DISTINCT FROM excluded.auction_end_date)');
  EXECUTE def;
END $guard$;

COMMIT;
