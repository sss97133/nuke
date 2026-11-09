-- ============================================================================================
--  BACKFILL — clear live bids from vehicles.canonical_sold_price.     *** DO NOT RUN UNREVIEWED ***
--  Requires Skylar's explicit approval. Not a migration; nothing applies this automatically.
--  Prerequisite: migration 20261114001000_bat_live_bid_freshness.sql applied (the guard below refuses otherwise:
--  without it the next bid update would write the bid straight back).
-- ============================================================================================
-- What is wrong: trg_resolve_canonical_columns resolved canonical_outcome = 'active' (sale_status auction_live /
-- upcoming) through its "best available" branch, so a live high bid (or an upcoming lot's estimate/ask) became the
-- canonical sold price. Read-only count, 2026-11-09 19:1x AST (UTC-4): 2,115 active vehicles carry one
-- (auction_live 1,864, upcoming 250, 1 soft-deleted), 1,702 equal to high_bid, 1,184 BaT. Example: the unsold live
-- 2011 Porsche 911 GT3 RS (BaT lot #49, vehicle d36d53ac…) reads canonical_sold_price 350000 = its high bid.
--
-- What this does: for every non-deleted vehicle whose canonical_outcome is still 'active' and canonical_sold_price is
-- not null, writes a before-image to superseded_rows (source_table 'vehicles', row_data = the five columns below,
-- reason/asserted_by/source as set here) and sets canonical_sold_price = NULL, in the same statement, 200 rows per
-- committed batch. canonical_sold_price is not in the trigger's UPDATE OF list, so the canonical trigger does not
-- fire; vehicles' AFTER UPDATE triggers do (hence small batches). When a lot later sells, the trigger sets the hammer
-- price as before. Idempotent and resumable: a cleared row no longer matches.
-- Undo (per row): UPDATE vehicles v SET canonical_sold_price = (s.row_data->>'canonical_sold_price')::numeric
--   FROM superseded_rows s WHERE s.reason = 'live_bid_not_a_sale_price_t7' AND s.restored_at IS NULL AND v.id = s.row_id;
--
-- Run with psql OUTSIDE an explicit transaction (the DO block commits per batch):
--   psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/sql/backfill_canonical_sold_price_live_bids_20261114.sql
-- Preview only (no writes): run the first SELECT by itself.

-- Preview
SELECT count(*) AS would_clear,
       count(*) FILTER (WHERE canonical_sold_price = high_bid) AS equal_to_high_bid,
       count(*) FILTER (WHERE canonical_platform = 'bat') AS bat,
       count(*) FILTER (WHERE sale_status = 'auction_live') AS auction_live,
       count(*) FILTER (WHERE sale_status = 'upcoming') AS upcoming
FROM public.vehicles
WHERE canonical_outcome = 'active' AND canonical_sold_price IS NOT NULL AND deleted_at IS NULL;

DO $backfill$
DECLARE
  n integer;
  total integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.trg_resolve_canonical_columns()')
                 AND prosrc LIKE '%T7 (2026-11-14): a live or upcoming lot has no sold price%') THEN
    RAISE EXCEPTION 'refusing: migration 20261114001000_bat_live_bid_freshness.sql is not applied';
  END IF;
  LOOP
    SET LOCAL statement_timeout = '55s';
    WITH batch AS (
      SELECT v.id FROM public.vehicles v
      WHERE v.canonical_outcome = 'active' AND v.canonical_sold_price IS NOT NULL AND v.deleted_at IS NULL
      ORDER BY v.id LIMIT 200
      FOR UPDATE SKIP LOCKED
    ), before_image AS (
      INSERT INTO public.superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
      SELECT 'vehicles', v.id,
             jsonb_build_object('id', v.id, 'canonical_sold_price', v.canonical_sold_price,
                                'canonical_outcome', v.canonical_outcome, 'high_bid', v.high_bid,
                                'sale_status', v.sale_status),
             'backfill_canonical_sold_price_live_bids_20261114',
             jsonb_build_object('migration', '20261114001000_bat_live_bid_freshness.sql',
                                'rule', 'canonical_outcome active has no sold price', 'ticket', 'T7'),
             'live_bid_not_a_sale_price_t7'
      FROM public.vehicles v JOIN batch USING (id)
      RETURNING row_id
    )
    UPDATE public.vehicles v SET canonical_sold_price = NULL
    FROM before_image b WHERE v.id = b.row_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    RAISE NOTICE 'cleared % (total %)', n, total;
    COMMIT;
    EXIT WHEN n = 0;
    PERFORM pg_sleep(0.5);
  END LOOP;
END
$backfill$;

-- Afterwards (expect 0, and one superseded_rows row per cleared vehicle)
SELECT count(*) AS still_active_with_price FROM public.vehicles
WHERE canonical_outcome = 'active' AND canonical_sold_price IS NOT NULL AND deleted_at IS NULL;
SELECT count(*) AS before_images FROM public.superseded_rows WHERE reason = 'live_bid_not_a_sale_price_t7';
