-- ============================================
-- AUCTION OUTCOME DISCLOSURE SYSTEM
-- ============================================
-- Properly track and disclose auction outcomes
-- Distinguish between SOLD vs Reserve Not Met

-- ============================================
-- 1. ADD AUCTION OUTCOME TRACKING
-- ============================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS auction_outcome TEXT
  CHECK (auction_outcome IN ('sold', 'reserve_not_met', 'no_sale', 'pending', 'ended'));

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS high_bid INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS winning_bid INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bid_count INTEGER;

-- ============================================
-- 2. MIGRATE EXISTING DATA
-- ============================================

-- Set auction_outcome based on existing data
UPDATE vehicles
SET auction_outcome = CASE
  -- Has sale_price → sold
  WHEN sale_price > 0 THEN 'sold'
  
  -- Has bat_auction_url but no sale_price → likely RNM or no sale
  WHEN (bat_auction_url IS NOT NULL OR discovery_url LIKE '%bringatrailer%')
       AND (sale_price IS NULL OR sale_price = 0) THEN 'reserve_not_met'
  
  -- Otherwise unknown
  ELSE NULL
END
WHERE auction_outcome IS NULL;

-- ============================================
-- 3. HELPER FUNCTIONS
-- ============================================

-- Function to get proper price display based on auction outcome
CREATE OR REPLACE FUNCTION get_auction_price_display(
  p_auction_outcome TEXT,
  p_sale_price INTEGER,
  p_high_bid INTEGER,
  p_asking_price INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN CASE
    -- SOLD - show sale price publicly
    WHEN p_auction_outcome = 'sold' AND p_sale_price > 0 THEN
      jsonb_build_object(
        'display_label', 'SOLD FOR',
        'display_amount', p_sale_price,
        'show_publicly', true,
        'color', 'success',
        'description', 'Auction completed - reserve met'
      )
    
    -- RESERVE NOT MET - hide high bid publicly
    WHEN p_auction_outcome = 'reserve_not_met' THEN
      jsonb_build_object(
        'display_label', 'RESERVE NOT MET',
        'display_amount', NULL,
        'show_publicly', false,
        'high_bid_hidden', p_high_bid,
        'color', 'warning',
        'description', 'Auction ended - reserve not met. High bid: $' || COALESCE(p_high_bid::TEXT, 'unknown')
      )
    
    -- NO SALE - no bids or cancelled
    WHEN p_auction_outcome = 'no_sale' THEN
      jsonb_build_object(
        'display_label', 'NO SALE',
        'display_amount', NULL,
        'show_publicly', true,
        'color', 'muted',
        'description', 'Auction ended with no sale'
      )
    
    -- PENDING - active auction
    WHEN p_auction_outcome = 'pending' AND p_high_bid > 0 THEN
      jsonb_build_object(
        'display_label', 'CURRENT BID',
        'display_amount', p_high_bid,
        'show_publicly', true,
        'color', 'info',
        'description', 'Auction in progress'
      )
    
    -- Asking price (non-auction listing)
    WHEN p_asking_price > 0 THEN
      jsonb_build_object(
        'display_label', 'ASKING',
        'display_amount', p_asking_price,
        'show_publicly', true,
        'color', 'info',
        'description', 'Listed for sale'
      )
    
    -- No pricing data
    ELSE
      jsonb_build_object(
        'display_label', NULL,
        'display_amount', NULL,
        'show_publicly', false,
        'color', 'muted',
        'description', 'No pricing information'
      )
  END;
END;
$$;

-- ============================================
-- 4. VIEW: Auction Pricing Dashboard
-- ============================================

CREATE OR REPLACE VIEW auction_pricing_dashboard AS
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_outcome,
  v.sale_price,
  v.high_bid,
  v.bat_auction_url,
  get_auction_price_display(v.auction_outcome, v.sale_price, v.high_bid, v.asking_price) as price_display,
  CASE 
    WHEN v.auction_outcome = 'reserve_not_met' AND v.sale_price > 0 THEN 'ERROR: RNM but has sale_price'
    WHEN v.auction_outcome = 'sold' AND (v.sale_price IS NULL OR v.sale_price = 0) THEN 'ERROR: Sold but no sale_price'
    WHEN v.auction_outcome IS NULL AND v.bat_auction_url IS NOT NULL THEN 'WARNING: BaT listing but no outcome'
    ELSE 'OK'
  END as data_quality_check
FROM vehicles v
WHERE v.bat_auction_url IS NOT NULL 
   OR v.discovery_url LIKE '%bringatrailer%'
   OR v.auction_outcome IS NOT NULL;

-- ============================================
-- 5. RLS
-- ============================================

CREATE POLICY "Anyone can view auction pricing dashboard" 
  ON vehicles FOR SELECT USING (true);

COMMENT ON COLUMN vehicles.auction_outcome IS 'Auction result: sold, reserve_not_met, no_sale, pending, ended';
COMMENT ON COLUMN vehicles.high_bid IS 'Highest bid amount (may not have won if reserve not met)';
COMMENT ON COLUMN vehicles.winning_bid IS 'Final winning bid amount (only if sold)';
COMMENT ON FUNCTION get_auction_price_display IS 'Returns proper price display based on auction outcome';
COMMENT ON VIEW auction_pricing_dashboard IS 'Dashboard for reviewing auction pricing disclosure accuracy';

