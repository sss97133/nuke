-- Fix: Add 'bid_to' to vehicles_sale_status_check constraint
-- Root cause: bat-snapshot-parser-continuous was failing every minute because
-- it tried to set sale_status='bid_to' for reserve-not-met auctions, but
-- 'bid_to' wasn't in the allowed values. This blocked 166k+ snapshot processing.
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_sale_status_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_sale_status_check
  CHECK (sale_status IS NULL OR sale_status = ANY (ARRAY[
    'not_for_sale'::text, 'for_sale'::text, 'sold'::text, 'pending'::text,
    'auction_live'::text, 'ended'::text, 'available'::text, 'discovered'::text,
    'not_sold'::text, 'unsold'::text, 'upcoming'::text, 'bid_to'::text
  ]));

-- Reconciliation function: syncs vehicles.sale_status -> external_listings.listing_status
-- Runs in batches of 50 to avoid trigger cascade timeouts
CREATE OR REPLACE FUNCTION reconcile_listing_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  sold_fixed int := 0;
  ended_fixed int := 0;
  batch_rows int := 1;
  batch_limit int := 50;
  max_batches int := 20;
  batch_num int := 0;
BEGIN
  SET LOCAL statement_timeout = '300s';

  -- 1. Sync sold vehicles -> external_listings (in batches)
  WHILE batch_rows > 0 AND batch_num < max_batches LOOP
    WITH batch AS (
      SELECT el.id
      FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      WHERE el.platform = 'bat'
        AND el.listing_status IN ('active', 'ended')
        AND el.end_date < NOW()
        AND v.sale_status = 'sold'
        AND v.sale_price > 0
        AND (el.final_price IS NULL OR el.listing_status != 'sold')
      LIMIT batch_limit
    ),
    updated AS (
      UPDATE external_listings el
      SET listing_status = 'sold',
          final_price = v.sale_price,
          updated_at = NOW()
      FROM vehicles v, batch b
      WHERE el.id = b.id AND v.id = el.vehicle_id
      RETURNING el.id
    )
    SELECT COUNT(*) INTO batch_rows FROM updated;

    sold_fixed := sold_fixed + batch_rows;
    batch_num := batch_num + 1;
  END LOOP;

  -- 2. Mark stale active listings as ended (2h grace period)
  UPDATE external_listings
  SET listing_status = 'ended', updated_at = NOW()
  WHERE platform = 'bat'
    AND listing_status = 'active'
    AND end_date < NOW() - INTERVAL '2 hours';
  GET DIAGNOSTICS ended_fixed = ROW_COUNT;

  RETURN jsonb_build_object(
    'sold_fixed', sold_fixed,
    'ended_fixed', ended_fixed,
    'batches', batch_num,
    'ran_at', NOW()::text
  );
END;
$func$;

-- Schedule hourly reconciliation (minute 45)
SELECT cron.schedule(
  'reconcile-listing-status',
  '45 * * * *',
  'SELECT reconcile_listing_status()'
);
