-- Create queue table for Craigslist squarebody listings
-- This allows us to discover listings in one pass, then process them in batches

CREATE TABLE IF NOT EXISTS craigslist_listing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url TEXT NOT NULL UNIQUE,
  region TEXT,
  search_term TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'skipped')),
  vehicle_id UUID REFERENCES vehicles(id),
  scraped_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cl_queue_status ON craigslist_listing_queue(status);
CREATE INDEX IF NOT EXISTS idx_cl_queue_created_at ON craigslist_listing_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_cl_queue_listing_url ON craigslist_listing_queue(listing_url);
CREATE INDEX IF NOT EXISTS idx_cl_queue_pending ON craigslist_listing_queue(status, created_at) WHERE status = 'pending';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_cl_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_cl_queue_updated_at
  BEFORE UPDATE ON craigslist_listing_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_cl_queue_updated_at();

-- Enable RLS
ALTER TABLE craigslist_listing_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON craigslist_listing_queue
  FOR ALL
  USING (auth.role() = 'service_role');

-- Policy: Authenticated users can read
CREATE POLICY "Authenticated users can read" ON craigslist_listing_queue
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Comments
COMMENT ON TABLE craigslist_listing_queue IS 'Queue for Craigslist squarebody listings to be processed';
COMMENT ON COLUMN craigslist_listing_queue.status IS 'pending: waiting to be processed, processing: currently being scraped, complete: vehicle created, failed: error occurred, skipped: not a squarebody';
COMMENT ON COLUMN craigslist_listing_queue.retry_count IS 'Number of times processing has been attempted';
COMMENT ON COLUMN craigslist_listing_queue.max_retries IS 'Maximum number of retries before marking as failed';

