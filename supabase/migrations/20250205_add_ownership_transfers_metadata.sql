-- Add metadata column to ownership_transfers to store buyer/seller names
-- when profile IDs are not available (e.g., BaT buyer names)

ALTER TABLE ownership_transfers 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ownership_transfers.metadata IS 'Stores additional transfer information like buyer_name, seller_name when profile IDs are not available (e.g., BaT auction winners)';

-- Create index for metadata queries
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_metadata ON ownership_transfers USING GIN (metadata);

