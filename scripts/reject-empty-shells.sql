-- Phase 4: Mark empty shells as rejected
-- ConceptCarz: 33K+ shells with almost zero useful data (97.5% empty)
-- Only mark active ones that have NO useful data

-- Step 1: Count before
SELECT 'before' as phase,
  COUNT(*) FILTER (WHERE auction_source = 'conceptcarz' AND status = 'active') as cz_active,
  COUNT(*) FILTER (WHERE auction_source = 'conceptcarz' AND status = 'rejected') as cz_rejected
FROM vehicles
WHERE auction_source = 'conceptcarz';

-- Step 2: Reject ConceptCarz empty shells in batches
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET status = 'rejected'
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE auction_source = 'conceptcarz'
        AND status = 'active'
        AND (description IS NULL OR description = '')
        AND vin IS NULL
        AND mileage IS NULL
        AND primary_image_url IS NULL
        AND image_url IS NULL
      LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'ConceptCarz empty shells rejected: %', total;
END $$;

-- Step 3: Also reject ConceptCarz shells that only have a price but nothing else useful
DO $$
DECLARE affected INT; total INT := 0;
BEGIN
  LOOP
    UPDATE vehicles SET status = 'rejected'
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE auction_source = 'conceptcarz'
        AND status = 'active'
        AND (description IS NULL OR description = '')
        AND vin IS NULL
        AND mileage IS NULL
        AND primary_image_url IS NULL
        AND image_url IS NULL
        -- Has price but nothing else — price was likely fabricated (see CZ forensics in DONE.md)
      LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RAISE NOTICE 'ConceptCarz price-only shells rejected: %', total;
END $$;

-- Step 4: Count after
SELECT 'after' as phase,
  COUNT(*) FILTER (WHERE auction_source = 'conceptcarz' AND status = 'active') as cz_active,
  COUNT(*) FILTER (WHERE auction_source = 'conceptcarz' AND status = 'rejected') as cz_rejected
FROM vehicles
WHERE auction_source = 'conceptcarz';
