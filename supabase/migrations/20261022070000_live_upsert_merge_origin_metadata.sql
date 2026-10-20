-- A live write merges origin_metadata into the row's, it no longer replaces it.
--
-- upsert_live_auction_vehicles set origin_metadata = excluded.origin_metadata, so when a lot that already existed (a
-- Mecum or Gooding row landed by its extractor) first went live, keys the extractor wrote (import_date, discovery_url,
-- import_source ...) were lost. The live payload's keys still win (a bid's currency, no_reserve, the reader's own
-- fields); keys it does not carry stay. Nothing else in the function changes, including which rows it touches.
-- Guarded on the live body's sha256 so a drifted function stops the migration.
-- Contract: supabase/sql/test_live_upsert_merge_origin_metadata.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text; src text;
BEGIN
  SELECT prosrc, encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO src, cur
    FROM pg_proc WHERE oid = 'public.upsert_live_auction_vehicles(jsonb)'::regprocedure;
  IF src LIKE '%origin_metadata = coalesce(v.origin_metadata%' THEN RETURN; END IF; -- already applied
  IF cur IS DISTINCT FROM 'sFCPu7T3ee4WOOSP0RxgYJcDBbbO/n7tG2uDn+whBW4=' THEN
    RAISE EXCEPTION 'upsert_live_auction_vehicles drifted from the body this migration edits (sha256 %)', cur;
  END IF;
  EXECUTE replace(pg_get_functiondef('public.upsert_live_auction_vehicles(jsonb)'::regprocedure),
    'origin_metadata = excluded.origin_metadata,',
    'origin_metadata = coalesce(v.origin_metadata, ''{}''::jsonb) || excluded.origin_metadata,');
END $guard$;

COMMIT;
