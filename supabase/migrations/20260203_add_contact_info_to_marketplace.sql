-- Add contact info and seller profile URL to marketplace_listings

ALTER TABLE marketplace_listings
ADD COLUMN IF NOT EXISTS contact_info JSONB,
ADD COLUMN IF NOT EXISTS seller_profile_url TEXT;

-- Add index for querying listings with contact info
CREATE INDEX IF NOT EXISTS idx_marketplace_contact_info
ON marketplace_listings USING GIN (contact_info)
WHERE contact_info IS NOT NULL;

COMMENT ON COLUMN marketplace_listings.contact_info IS 'Extracted contact information: phones, emails, messenger availability';
COMMENT ON COLUMN marketplace_listings.seller_profile_url IS 'Facebook Marketplace seller profile URL';
