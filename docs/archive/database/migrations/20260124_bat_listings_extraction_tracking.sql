-- =============================================================================
-- BAT_LISTINGS EXTRACTION TRACKING
-- =============================================================================
-- Move extraction tracking from JSONB (raw_data.comments_extracted_at) to proper columns
-- This makes queries cleaner and indexable
-- =============================================================================

-- Add proper columns for extraction tracking
ALTER TABLE bat_listings
ADD COLUMN IF NOT EXISTS comments_extracted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS comments_extracted_count INTEGER;

-- Migrate existing data from raw_data JSONB
UPDATE bat_listings
SET
    comments_extracted_at = (raw_data->>'comments_extracted_at')::timestamptz,
    comments_extracted_count = (raw_data->>'comments_extracted_count')::integer
WHERE raw_data->>'comments_extracted_at' IS NOT NULL
  AND comments_extracted_at IS NULL;

-- Index for finding unextracted listings
CREATE INDEX IF NOT EXISTS idx_bat_listings_needs_extraction
ON bat_listings (comment_count DESC)
WHERE comments_extracted_at IS NULL AND comment_count > 0 AND vehicle_id IS NOT NULL;

-- Index for tracking extraction progress
CREATE INDEX IF NOT EXISTS idx_bat_listings_extraction_date
ON bat_listings (comments_extracted_at DESC)
WHERE comments_extracted_at IS NOT NULL;

-- =============================================================================
-- HELPER VIEW: Extraction Queue Status
-- =============================================================================
DROP VIEW IF EXISTS bat_extraction_status;

CREATE VIEW bat_extraction_status AS
SELECT
    COUNT(*) FILTER (WHERE comments_extracted_at IS NOT NULL) AS extracted,
    COUNT(*) FILTER (WHERE comments_extracted_at IS NULL AND comment_count > 0) AS pending,
    COUNT(*) FILTER (WHERE comment_count = 0 OR comment_count IS NULL) AS no_comments,
    COUNT(*) AS total,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE comments_extracted_at IS NOT NULL) /
        NULLIF(COUNT(*) FILTER (WHERE comment_count > 0), 0),
        1
    ) AS extraction_pct
FROM bat_listings
WHERE vehicle_id IS NOT NULL;

COMMENT ON VIEW bat_extraction_status IS
'Quick check on comment extraction progress. Usage: SELECT * FROM bat_extraction_status;';
