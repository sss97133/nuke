-- Marketplace Deal Alerts tracking
-- Enables logging external marketplace listings with age and lifecycle analytics

CREATE TABLE IF NOT EXISTS marketplace_deal_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (
    source IN (
      'craigslist',
      'facebook_marketplace',
      'bring_a_trailer',
      'cars_and_bids',
      'ebay_motors',
      'hemmings',
      'autotrader',
      'other'
    )
  ),
  title TEXT,
  description TEXT,
  listing_url TEXT NOT NULL,
  asking_price NUMERIC,
  currency TEXT DEFAULT 'USD',
  location TEXT,
  posted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'pending', 'sold', 'expired', 'removed')
  ),
  sold_at TIMESTAMPTZ,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, listing_url)
);

CREATE OR REPLACE FUNCTION set_marketplace_deal_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketplace_deal_alerts_updated_at ON marketplace_deal_alerts;
CREATE TRIGGER trg_marketplace_deal_alerts_updated_at
BEFORE UPDATE ON marketplace_deal_alerts
FOR EACH ROW
EXECUTE PROCEDURE set_marketplace_deal_alerts_updated_at();

ALTER TABLE marketplace_deal_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view marketplace deal alerts"
  ON marketplace_deal_alerts
  FOR SELECT
  USING (TRUE);

CREATE POLICY "Users can insert their own deal alerts"
  ON marketplace_deal_alerts
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own deal alerts"
  ON marketplace_deal_alerts
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete their own deal alerts"
  ON marketplace_deal_alerts
  FOR DELETE
  USING (auth.uid() = created_by);

CREATE INDEX IF NOT EXISTS idx_marketplace_deal_alerts_status
  ON marketplace_deal_alerts (status, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_deal_alerts_source
  ON marketplace_deal_alerts (source, first_seen_at DESC);

COMMENT ON TABLE marketplace_deal_alerts IS
  'Tracked external marketplace listings for deal monitoring and time-to-sale analytics.';

COMMENT ON COLUMN marketplace_deal_alerts.first_seen_at IS
  'Timestamp when the listing was first captured by the platform.';

COMMENT ON COLUMN marketplace_deal_alerts.posted_at IS
  'Original marketplace posted timestamp if known (used for age calculations).';

COMMENT ON COLUMN marketplace_deal_alerts.sold_at IS
  'Timestamp when the listing was marked as sold to compute time-to-sale.';

