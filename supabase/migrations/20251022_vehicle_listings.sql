-- Vehicle Listings Table
-- For selling vehicles on the marketplace (fixed price, auction, best offer)

CREATE TABLE IF NOT EXISTS vehicle_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sale_type TEXT NOT NULL CHECK (sale_type IN ('fixed_price', 'auction', 'best_offer')),
  list_price_cents BIGINT,
  reserve_price_cents BIGINT,
  accept_offers BOOLEAN DEFAULT true,
  auction_end_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at TIMESTAMPTZ,
  sold_price_cents BIGINT,
  buyer_id UUID REFERENCES profiles(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_vehicle ON vehicle_listings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_seller ON vehicle_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_status ON vehicle_listings(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_sale_type ON vehicle_listings(sale_type);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_vehicle_listings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vehicle_listings_updated_at
  BEFORE UPDATE ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_listings_updated_at();

-- RLS Policies
ALTER TABLE vehicle_listings ENABLE ROW LEVEL SECURITY;

-- Anyone can view active listings
CREATE POLICY "view_active_listings"
  ON vehicle_listings FOR SELECT
  USING (status = 'active');

-- Sellers can view all their listings
CREATE POLICY "view_own_listings"
  ON vehicle_listings FOR SELECT
  USING (seller_id = auth.uid());

-- Sellers can create listings for their own vehicles
CREATE POLICY "create_own_listings"
  ON vehicle_listings FOR INSERT
  WITH CHECK (
    seller_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_listings.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

-- Sellers can update their own listings
CREATE POLICY "update_own_listings"
  ON vehicle_listings FOR UPDATE
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Sellers can delete their own listings
CREATE POLICY "delete_own_listings"
  ON vehicle_listings FOR DELETE
  USING (seller_id = auth.uid());

-- Vehicle Offers Table (for best_offer and auction types)
CREATE TABLE IF NOT EXISTS vehicle_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  offer_amount_cents BIGINT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  
  CONSTRAINT offer_amount_positive CHECK (offer_amount_cents > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_offers_listing ON vehicle_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_offers_buyer ON vehicle_offers(buyer_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_offers_status ON vehicle_offers(status);

-- Updated at trigger
CREATE TRIGGER update_vehicle_offers_updated_at
  BEFORE UPDATE ON vehicle_offers
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_listings_updated_at();

-- RLS Policies
ALTER TABLE vehicle_offers ENABLE ROW LEVEL SECURITY;

-- Buyers can view their own offers
CREATE POLICY "view_own_offers"
  ON vehicle_offers FOR SELECT
  USING (buyer_id = auth.uid());

-- Sellers can view offers on their listings
CREATE POLICY "view_offers_on_own_listings"
  ON vehicle_offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_listings
      WHERE vehicle_listings.id = vehicle_offers.listing_id
      AND vehicle_listings.seller_id = auth.uid()
    )
  );

-- Buyers can create offers
CREATE POLICY "create_offers"
  ON vehicle_offers FOR INSERT
  WITH CHECK (buyer_id = auth.uid());

-- Buyers can update/withdraw their own offers
CREATE POLICY "update_own_offers"
  ON vehicle_offers FOR UPDATE
  USING (buyer_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid());

-- Sellers can update offers on their listings (to accept/reject)
CREATE POLICY "update_offers_on_own_listings"
  ON vehicle_offers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_listings
      WHERE vehicle_listings.id = vehicle_offers.listing_id
      AND vehicle_listings.seller_id = auth.uid()
    )
  );

-- Function to accept an offer and mark listing as sold
CREATE OR REPLACE FUNCTION accept_vehicle_offer(p_offer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_offer vehicle_offers;
  v_listing vehicle_listings;
  v_result JSONB;
BEGIN
  -- Get the offer
  SELECT * INTO v_offer FROM vehicle_offers WHERE id = p_offer_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Offer not found');
  END IF;
  
  -- Get the listing
  SELECT * INTO v_listing FROM vehicle_listings WHERE id = v_offer.listing_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;
  
  -- Check if user is the seller
  IF v_listing.seller_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Check if listing is still active
  IF v_listing.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing is no longer active');
  END IF;
  
  -- Update the offer
  UPDATE vehicle_offers
  SET 
    status = 'accepted',
    responded_at = now(),
    updated_at = now()
  WHERE id = p_offer_id;
  
  -- Mark listing as sold
  UPDATE vehicle_listings
  SET
    status = 'sold',
    sold_at = now(),
    sold_price_cents = v_offer.offer_amount_cents,
    buyer_id = v_offer.buyer_id,
    updated_at = now()
  WHERE id = v_listing.id;
  
  -- Reject all other offers
  UPDATE vehicle_offers
  SET
    status = 'rejected',
    responded_at = now(),
    updated_at = now()
  WHERE listing_id = v_listing.id AND id != p_offer_id AND status = 'pending';
  
  RETURN jsonb_build_object(
    'success', true,
    'listing_id', v_listing.id,
    'buyer_id', v_offer.buyer_id,
    'sale_price_cents', v_offer.offer_amount_cents
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION accept_vehicle_offer(UUID) TO authenticated;

COMMENT ON TABLE vehicle_listings IS 'Vehicles listed for sale on the marketplace';
COMMENT ON TABLE vehicle_offers IS 'Buyer offers on vehicle listings';
COMMENT ON FUNCTION accept_vehicle_offer IS 'Accept an offer and mark listing as sold';

