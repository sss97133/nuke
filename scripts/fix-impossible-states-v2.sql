-- Phase 5v2: Fix impossible states with temp index for speed

-- Step 1: Create temp partial index for fast lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tmp_dup_active_auction
ON vehicles (id) WHERE status = 'duplicate' AND auction_status = 'active';

-- Step 2: Batch clear auction_status on duplicate rows
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET auction_status = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND auction_status = 'active'
      LIMIT 5000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.2);
    IF total % 50000 = 0 THEN
      RAISE NOTICE 'Progress: % rows cleared', total;
    END IF;
  END LOOP;
  RAISE NOTICE 'Fix 1 complete: % duplicate+active_auction cleared', total;
END $$;

-- Step 3: Also clear reserve_status on duplicates (meaningless on dupes)
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET reserve_status = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND reserve_status IS NOT NULL
      LIMIT 5000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.2);
    IF total % 50000 = 0 THEN
      RAISE NOTICE 'Progress: % reserve_status cleared on dupes', total;
    END IF;
  END LOOP;
  RAISE NOTICE 'Fix 1b: % duplicate reserve_status cleared', total;
END $$;

-- Step 4: Fix merged + active auction_status
UPDATE vehicles SET auction_status = NULL
WHERE status = 'merged' AND auction_status = 'active';

-- Step 5: Fix active + sold + reserve_not_met (if sold, reserve was met)
UPDATE vehicles SET reserve_status = 'reserve_met'
WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';

-- Step 6: Fix rejected + active auction
UPDATE vehicles SET auction_status = NULL
WHERE status = 'rejected' AND auction_status = 'active';

-- Step 7: Drop temp index
DROP INDEX IF EXISTS idx_tmp_dup_active_auction;

-- Step 8: Final count
SELECT
  COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status = 'active') as dup_active,
  COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as sold_rnm,
  COUNT(*) FILTER (WHERE status = 'rejected' AND auction_status = 'active') as rejected_active
FROM vehicles;
