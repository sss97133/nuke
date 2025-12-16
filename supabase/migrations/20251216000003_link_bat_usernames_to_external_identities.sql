-- Link BaT usernames (and other external handles) to external_identities for claim/merge later.
-- This keeps "user ids" in the BaT sense as durable handles while still enabling future UUID claims.

-- Auction comments: add optional FK to external identities
ALTER TABLE IF EXISTS auction_comments
  ADD COLUMN IF NOT EXISTS external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_auction_comments_external_identity
  ON auction_comments(external_identity_id)
  WHERE external_identity_id IS NOT NULL;

-- BaT comment tracking tables (if enabled)
ALTER TABLE IF EXISTS bat_comments
  ADD COLUMN IF NOT EXISTS external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bat_comments_external_identity
  ON bat_comments(external_identity_id)
  WHERE external_identity_id IS NOT NULL;

ALTER TABLE IF EXISTS bat_listings
  ADD COLUMN IF NOT EXISTS seller_external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS bat_listings
  ADD COLUMN IF NOT EXISTS buyer_external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bat_listings_seller_external_identity
  ON bat_listings(seller_external_identity_id)
  WHERE seller_external_identity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bat_listings_buyer_external_identity
  ON bat_listings(buyer_external_identity_id)
  WHERE buyer_external_identity_id IS NOT NULL;


