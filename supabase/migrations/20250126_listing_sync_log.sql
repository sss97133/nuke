-- Listing Sync Log
-- Tracks sync status and history for listings across platforms

CREATE TABLE IF NOT EXISTS listing_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL,  -- Can be listing_exports.id or external_listings.id
  listing_type TEXT NOT NULL CHECK (listing_type IN ('export', 'external', 'native')),
  platform TEXT NOT NULL,
  
  -- Sync details
  sync_status TEXT NOT NULL CHECK (sync_status IN ('success', 'failed', 'partial')),
  sync_method TEXT NOT NULL CHECK (sync_method IN ('api', 'scrape', 'manual')),
  data_captured JSONB DEFAULT '{}',
  error_message TEXT,
  
  -- Timestamps
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  next_sync_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sync_log_listing ON listing_sync_log(listing_id, listing_type);
CREATE INDEX IF NOT EXISTS idx_sync_log_platform ON listing_sync_log(platform);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON listing_sync_log(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON listing_sync_log(sync_status);

-- RLS Policies
ALTER TABLE listing_sync_log ENABLE ROW LEVEL SECURITY;

-- Users can view sync logs for their own listings
-- This is complex because we need to check ownership through vehicles
CREATE POLICY "view_own_sync_logs" ON listing_sync_log
  FOR SELECT USING (
    -- For native listings, check vehicle_listings.seller_id
    (listing_type = 'native' AND EXISTS (
      SELECT 1 FROM vehicle_listings vl
      WHERE vl.id = listing_sync_log.listing_id
      AND vl.seller_id = auth.uid()
    ))
    OR
    -- For external listings, check through vehicles.user_id
    (listing_type = 'external' AND EXISTS (
      SELECT 1 FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      WHERE el.id = listing_sync_log.listing_id
      AND v.user_id = auth.uid()
    ))
    OR
    -- For export listings, check listing_exports.user_id
    (listing_type = 'export' AND EXISTS (
      SELECT 1 FROM listing_exports le
      WHERE le.id = listing_sync_log.listing_id
      AND le.user_id = auth.uid()
    ))
  );

-- Users can create sync logs for their own listings
CREATE POLICY "create_own_sync_logs" ON listing_sync_log
  FOR INSERT WITH CHECK (
    -- Same ownership checks as view
    (listing_type = 'native' AND EXISTS (
      SELECT 1 FROM vehicle_listings vl
      WHERE vl.id = listing_sync_log.listing_id
      AND vl.seller_id = auth.uid()
    ))
    OR
    (listing_type = 'external' AND EXISTS (
      SELECT 1 FROM external_listings el
      JOIN vehicles v ON v.id = el.vehicle_id
      WHERE el.id = listing_sync_log.listing_id
      AND v.user_id = auth.uid()
    ))
    OR
    (listing_type = 'export' AND EXISTS (
      SELECT 1 FROM listing_exports le
      WHERE le.id = listing_sync_log.listing_id
      AND le.user_id = auth.uid()
    ))
  );

COMMENT ON TABLE listing_sync_log IS 'Tracks sync status and history for listings across all platforms';



