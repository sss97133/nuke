-- ==========================================================================
-- CREATE BaT BIDS TABLE
-- ==========================================================================
-- Purpose: Track individual bids from BaT auctions for user activity tracking
--          Extracts bid data from bat_comments and auction_events
-- ==========================================================================

-- Create bat_bids table to track individual bids
CREATE TABLE IF NOT EXISTS bat_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bat_listing_id UUID NOT NULL REFERENCES bat_listings(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Bidder
  bat_user_id UUID REFERENCES bat_users(id) ON DELETE SET NULL,
  bat_username TEXT NOT NULL,
  external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL,
  
  -- Bid details
  bid_amount NUMERIC(10,2) NOT NULL,
  bid_timestamp TIMESTAMPTZ NOT NULL,
  
  -- Bid status
  is_winning_bid BOOLEAN DEFAULT FALSE,
  is_final_bid BOOLEAN DEFAULT FALSE,
  
  -- Source
  source TEXT DEFAULT 'comment' CHECK (source IN ('comment', 'bid_history', 'manual')),
  bat_comment_id UUID REFERENCES bat_comments(id) ON DELETE SET NULL,
  auction_event_id UUID, -- References auction_events but no FK to avoid circular dependency
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bat_bids_listing ON bat_bids(bat_listing_id, bid_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bat_bids_vehicle ON bat_bids(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_bat_bids_user ON bat_bids(bat_user_id);
CREATE INDEX IF NOT EXISTS idx_bat_bids_username ON bat_bids(bat_username);
CREATE INDEX IF NOT EXISTS idx_bat_bids_external_identity ON bat_bids(external_identity_id);
CREATE INDEX IF NOT EXISTS idx_bat_bids_timestamp ON bat_bids(bid_timestamp DESC);

COMMENT ON TABLE bat_bids IS 'Track individual bids from BaT auctions for user activity and profile stats';

-- Function to extract bids from bat_comments
CREATE OR REPLACE FUNCTION extract_bids_from_bat_comments()
RETURNS TABLE(
  bat_comment_id UUID,
  bat_listing_id UUID,
  vehicle_id UUID,
  bat_user_id UUID,
  bat_username TEXT,
  bid_amount NUMERIC,
  bid_timestamp TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bc.id,
    bc.bat_listing_id,
    bc.vehicle_id,
    bc.bat_user_id,
    bc.bat_username,
    -- Extract bid amount from comment text (e.g., "USD $93,500 bid placed by boula")
    (regexp_replace(
      regexp_replace(bc.comment_text, '.*?(?:USD|[$])\s*\$?\s*([\d,]+)[,\s]*(?:bid|Bid).*', '\1', 'i'),
      '[^\d]', '', 'g'
    ))::NUMERIC AS bid_amount,
    bc.comment_timestamp
  FROM bat_comments bc
  WHERE (
    bc.comment_text ILIKE '%bid placed by%' 
    OR bc.comment_text ILIKE '%bid by%'
    OR bc.contains_bid = true
  )
  AND bc.bat_username IS NOT NULL
  AND bc.bat_listing_id IS NOT NULL
  -- Extract numeric amount
  AND regexp_replace(
    regexp_replace(bc.comment_text, '.*?(?:USD|[$])\s*\$?\s*([\d,]+)[,\s]*(?:bid|Bid).*', '\1', 'i'),
    '[^\d]', '', 'g'
  ) ~ '^\d+$'
  -- Avoid duplicates
  AND NOT EXISTS (
    SELECT 1 FROM bat_bids bb
    WHERE bb.bat_comment_id = bc.id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to populate bat_bids from bat_comments
CREATE OR REPLACE FUNCTION backfill_bat_bids_from_comments()
RETURNS TABLE(
  bids_created INTEGER
) AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO bat_bids (
    bat_listing_id,
    vehicle_id,
    bat_user_id,
    bat_username,
    external_identity_id,
    bid_amount,
    bid_timestamp,
    is_winning_bid,
    is_final_bid,
    source,
    bat_comment_id,
    metadata
  )
  SELECT 
    e.bat_listing_id,
    e.vehicle_id,
    e.bat_user_id,
    e.bat_username,
    ei.id as external_identity_id,
    e.bid_amount,
    e.bid_timestamp,
    -- Check if this is the winning/final bid by comparing to listing
    EXISTS (
      SELECT 1 FROM bat_listings bl
      WHERE bl.id = e.bat_listing_id
        AND bl.buyer_username = e.bat_username
        AND bl.final_bid = e.bid_amount
    ) as is_winning_bid,
    EXISTS (
      SELECT 1 FROM bat_listings bl
      WHERE bl.id = e.bat_listing_id
        AND bl.final_bid = e.bid_amount
        AND e.bid_timestamp = (
          SELECT MAX(bid_timestamp) 
          FROM bat_comments bc2
          WHERE bc2.bat_listing_id = e.bat_listing_id
            AND bc2.comment_text ILIKE '%bid%'
        )
    ) as is_final_bid,
    'comment' as source,
    e.bat_comment_id,
    '{}'::jsonb as metadata
  FROM extract_bids_from_bat_comments() e
  LEFT JOIN external_identities ei ON ei.platform = 'bat' AND ei.handle = e.bat_username
  ON CONFLICT DO NOTHING; -- Use a unique constraint to prevent duplicates
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION extract_bids_from_bat_comments IS 'Extract bid data from bat_comments that contain bid information';
COMMENT ON FUNCTION backfill_bat_bids_from_comments IS 'Backfill bat_bids table from bat_comments containing bid data';

