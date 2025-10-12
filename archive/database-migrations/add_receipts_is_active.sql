-- Add is_active toggle to receipts so we can control visibility without deleting
ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_receipts_user_active ON receipts(user_id, is_active);
