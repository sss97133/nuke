-- Organization Seller Stats: rollup analytics for businesses that sell on auction platforms
-- Computed by the compute-org-seller-stats edge function

CREATE TABLE IF NOT EXISTS organization_seller_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Volume metrics
  total_listings INTEGER NOT NULL DEFAULT 0,
  total_sold INTEGER NOT NULL DEFAULT 0,
  total_unsold INTEGER NOT NULL DEFAULT 0,
  active_listings INTEGER NOT NULL DEFAULT 0,
  sell_through_rate NUMERIC,

  -- Revenue metrics
  total_gross_sales NUMERIC,
  avg_sale_price NUMERIC,
  median_sale_price NUMERIC,
  highest_sale_price NUMERIC,
  lowest_sale_price NUMERIC,

  -- Engagement metrics
  avg_bid_count NUMERIC,
  avg_comment_count NUMERIC,
  avg_view_count NUMERIC,

  -- Timeline metrics
  avg_auction_duration_hours NUMERIC,
  first_listing_date TIMESTAMPTZ,
  last_listing_date TIMESTAMPTZ,
  listing_frequency_days NUMERIC,

  -- Category breakdown
  primary_categories TEXT[],
  primary_makes TEXT[],

  -- Sentiment (from comment_discoveries)
  avg_sentiment_score NUMERIC,
  common_concerns TEXT[],
  common_praise TEXT[],

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_seller_stats_org_id ON organization_seller_stats(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_seller_stats_calculated_at ON organization_seller_stats(calculated_at);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_org_seller_stats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_seller_stats_updated_at ON organization_seller_stats;
CREATE TRIGGER trg_org_seller_stats_updated_at
  BEFORE UPDATE ON organization_seller_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_org_seller_stats_updated_at();
