-- Phase 5v4: Fix impossible states
-- Increase statement timeout for this session
SET statement_timeout = '300s';

-- Fix 1: Clear auction_status on duplicate rows (358K)
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET auction_status = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND auction_status = 'active'
      LIMIT 2000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
    IF total % 20000 = 0 THEN
      RAISE NOTICE 'Progress: % dup auction_status cleared', total;
    END IF;
  END LOOP;
  RAISE NOTICE 'Fix 1 done: % duplicate+active_auction cleared', total;
END $$;

-- Fix 2: Clear reserve_status on duplicates (~39K)
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET reserve_status = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND reserve_status IS NOT NULL
      LIMIT 2000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'Fix 2 done: % dup reserve_status cleared', total;
END $$;

-- Fix 3: Clear auction_status on merged rows
UPDATE vehicles SET auction_status = NULL
WHERE status = 'merged' AND auction_status = 'active';

-- Fix 4: Fix sold + reserve_not_met
UPDATE vehicles SET reserve_status = 'reserve_met'
WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';

-- Fix 5: Clear auction_status on rejected rows
UPDATE vehicles SET auction_status = NULL
WHERE status = 'rejected' AND auction_status = 'active';

-- Drop temp index
DROP INDEX IF EXISTS idx_tmp_dup_active_auction;

-- Final count
SELECT
  COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status IS NOT NULL) as dup_with_auction,
  COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as sold_rnm,
  COUNT(*) FILTER (WHERE status = 'rejected' AND auction_status = 'active') as rejected_active
FROM vehicles;
