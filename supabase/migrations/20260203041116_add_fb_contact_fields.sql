-- Add contact info and seller data columns
ALTER TABLE marketplace_listings
ADD COLUMN IF NOT EXISTS contact_info JSONB,
ADD COLUMN IF NOT EXISTS seller_profile_url TEXT,
ADD COLUMN IF NOT EXISTS comments JSONB;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_marketplace_contact_info
ON marketplace_listings USING GIN (contact_info)
WHERE contact_info IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_comments
ON marketplace_listings USING GIN (comments)
WHERE comments IS NOT NULL;

-- Comments
COMMENT ON COLUMN marketplace_listings.contact_info IS 'Extracted contact: phones, emails, messenger';
COMMENT ON COLUMN marketplace_listings.seller_profile_url IS 'Facebook seller profile URL';
COMMENT ON COLUMN marketplace_listings.comments IS 'Listing comments array';
