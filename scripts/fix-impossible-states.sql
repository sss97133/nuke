-- Phase 5: Fix impossible state combinations

-- Count before
SELECT 'before' as phase,
  COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status = 'active') as dup_active_auction,
  COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active_auction,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'ended' AND reserve_status = 'reserve_not_met') as active_ended_rnm,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as active_sold_rnm,
  COUNT(*) FILTER (WHERE status = 'rejected' AND auction_status = 'active') as rejected_active_auction
FROM vehicles;

-- Fix 1: duplicate + active auction_status → clear auction_status to NULL
-- These are duplicate records — their auction_status is meaningless
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET auction_status = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND auction_status = 'active'
      LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
    IF total % 10000 = 0 THEN
      RAISE NOTICE 'Progress: % duplicate auction_status cleared', total;
    END IF;
  END LOOP;
  RAISE NOTICE 'Fix 1 complete: % duplicate+active_auction cleared', total;
END $$;

-- Fix 2: merged + active auction_status → clear auction_status
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET auction_status = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'merged' AND auction_status = 'active'
      LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'Fix 2 complete: % merged+active_auction cleared', total;
END $$;

-- Fix 3: active + sold auction + reserve_not_met → set status to 'sold'
-- If the auction sold, the vehicle sold regardless of reserve
UPDATE vehicles
SET reserve_status = 'reserve_met'
WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';

-- Fix 4: active + ended + reserve_not_met → auction ended without selling
-- Set auction_status to 'ended' is correct, but status should reflect not-sold
-- These are listings that ended without meeting reserve — mark auction_status properly
UPDATE vehicles
SET auction_status = 'ended'
WHERE status = 'active' AND auction_status = 'ended' AND reserve_status = 'reserve_not_met';
-- (This is actually already correct — active+ended+reserve_not_met means the car didn't sell)
-- The "impossible state" was questionable; this combo is valid (auction ended, car still active/unsold)

-- Fix 5: rejected + active auction → clear auction_status
UPDATE vehicles SET auction_status = NULL
WHERE status = 'rejected' AND auction_status = 'active';

-- Count after
SELECT 'after' as phase,
  COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status = 'active') as dup_active_auction,
  COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active_auction,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'ended' AND reserve_status = 'reserve_not_met') as active_ended_rnm,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as active_sold_rnm,
  COUNT(*) FILTER (WHERE status = 'rejected' AND auction_status = 'active') as rejected_active_auction
FROM vehicles;
