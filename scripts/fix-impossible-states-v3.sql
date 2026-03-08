-- Phase 5v3: Fix impossible states — deadlock-safe with SKIP LOCKED

-- Batch clear auction_status on duplicate rows (358K)
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND auction_status = 'active'
      LIMIT 2000
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vehicles v SET auction_status = NULL
    FROM batch b WHERE v.id = b.id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.15);
    IF total % 20000 = 0 THEN
      RAISE NOTICE 'Progress: % dup auction_status cleared', total;
    END IF;
  END LOOP;
  RAISE NOTICE 'Fix 1 done: % duplicate+active_auction cleared', total;
END $$;

-- Clear reserve_status on duplicates
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND reserve_status IS NOT NULL
      LIMIT 2000
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vehicles v SET reserve_status = NULL
    FROM batch b WHERE v.id = b.id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.15);
    IF total % 20000 = 0 THEN
      RAISE NOTICE 'Progress: % dup reserve_status cleared', total;
    END IF;
  END LOOP;
  RAISE NOTICE 'Fix 1b done: % dup reserve_status cleared', total;
END $$;

-- Fix merged + active auction
UPDATE vehicles SET auction_status = NULL
WHERE status = 'merged' AND auction_status = 'active';

-- Fix sold + reserve_not_met
UPDATE vehicles SET reserve_status = 'reserve_met'
WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';

-- Fix rejected + active auction
UPDATE vehicles SET auction_status = NULL
WHERE status = 'rejected' AND auction_status = 'active';

-- Drop temp index
DROP INDEX IF EXISTS idx_tmp_dup_active_auction;

-- Final verification
SELECT
  COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status IS NOT NULL) as dup_with_auction,
  COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as sold_rnm
FROM vehicles;
