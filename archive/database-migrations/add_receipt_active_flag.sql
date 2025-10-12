-- Add is_active flag to tool_receipt_documents
-- Controls visibility of all tools from this receipt

ALTER TABLE tool_receipt_documents
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

COMMENT ON COLUMN tool_receipt_documents.is_active IS 
'Controls visibility of tools from this receipt. Toggle off to hide without deleting data.';

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_tool_receipt_documents_user_active 
ON tool_receipt_documents(user_id, is_active);
