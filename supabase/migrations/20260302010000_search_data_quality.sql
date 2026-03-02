-- Search Data Quality: fix source contamination + add era column
-- Part of search infrastructure buildout

-- =============================================================================
-- 1. Fix source contamination: User Submission → bringatrailer where URL matches
-- =============================================================================
-- Batched per CLAUDE.md: 1000 rows + pg_sleep(0.1) between batches

DO $$
DECLARE
  batch_size INT := 1000;
  affected INT;
BEGIN
  LOOP
    UPDATE vehicles
    SET source = 'bringatrailer'
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE source = 'User Submission'
        AND discovery_url LIKE '%bringatrailer%'
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;

-- =============================================================================
-- 2. Add era column
-- =============================================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS era TEXT;

COMMENT ON COLUMN vehicles.era IS 'Computed era bucket from year: antique/prewar/classic/muscle/malaise/90s/2000s/modern';

-- =============================================================================
-- 3. Backfill era from year (batched)
-- =============================================================================

DO $$
DECLARE
  batch_size INT := 1000;
  affected INT;
BEGIN
  LOOP
    UPDATE vehicles
    SET era = CASE
      WHEN year < 1920 THEN 'antique'
      WHEN year < 1948 THEN 'prewar'
      WHEN year < 1965 THEN 'classic'
      WHEN year < 1975 THEN 'muscle'
      WHEN year < 1990 THEN 'malaise'
      WHEN year < 2000 THEN '90s'
      WHEN year < 2010 THEN '2000s'
      WHEN year >= 2010 THEN 'modern'
    END
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE year IS NOT NULL
        AND era IS NULL
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
