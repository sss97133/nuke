-- Tool Receipt Document Tracking System
-- Ensures every uploaded receipt is tracked in the database

CREATE TABLE IF NOT EXISTS tool_receipt_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- File information
    original_filename TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    file_hash TEXT NOT NULL, -- SHA-256 hash for deduplication
    storage_path TEXT NOT NULL, -- Path in Supabase storage
    
    -- Receipt metadata
    supplier_name TEXT, -- Snap-on, Mac Tools, Matco, etc.
    receipt_date DATE,
    receipt_number TEXT,
    total_amount NUMERIC(10,2),
    
    -- Processing status
    processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    tools_extracted INTEGER DEFAULT 0,
    tools_saved INTEGER DEFAULT 0,
    
    -- Error tracking
    processing_errors JSONB DEFAULT '[]'::jsonb,
    extraction_metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Audit trail
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_tool_receipt_documents_user_id ON tool_receipt_documents(user_id);
CREATE INDEX idx_tool_receipt_documents_file_hash ON tool_receipt_documents(file_hash);
CREATE INDEX idx_tool_receipt_documents_status ON tool_receipt_documents(processing_status);
CREATE INDEX idx_tool_receipt_documents_uploaded_at ON tool_receipt_documents(uploaded_at DESC);

-- Link user_tools to the receipt document they came from
ALTER TABLE user_tools ADD COLUMN IF NOT EXISTS receipt_document_id UUID REFERENCES tool_receipt_documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_user_tools_receipt_document ON user_tools(receipt_document_id);

-- RLS Policies
ALTER TABLE tool_receipt_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own receipt documents"
    ON tool_receipt_documents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own receipt documents"
    ON tool_receipt_documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own receipt documents"
    ON tool_receipt_documents FOR UPDATE
    USING (auth.uid() = user_id);

-- Moderators can view all receipts for verification
CREATE POLICY "Moderators can view all receipt documents"
    ON tool_receipt_documents FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.user_type IN ('moderator', 'admin')
        )
    );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_tool_receipt_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tool_receipt_documents_updated_at
    BEFORE UPDATE ON tool_receipt_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_tool_receipt_documents_updated_at();

-- Function to get receipt processing stats
CREATE OR REPLACE FUNCTION get_receipt_processing_stats(p_user_id UUID)
RETURNS TABLE (
    total_receipts BIGINT,
    pending_receipts BIGINT,
    completed_receipts BIGINT,
    failed_receipts BIGINT,
    total_tools_extracted BIGINT,
    total_tools_saved BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_receipts,
        COUNT(*) FILTER (WHERE processing_status = 'pending')::BIGINT as pending_receipts,
        COUNT(*) FILTER (WHERE processing_status = 'completed')::BIGINT as completed_receipts,
        COUNT(*) FILTER (WHERE processing_status = 'failed')::BIGINT as failed_receipts,
        COALESCE(SUM(tools_extracted), 0)::BIGINT as total_tools_extracted,
        COALESCE(SUM(tools_saved), 0)::BIGINT as total_tools_saved
    FROM tool_receipt_documents
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE tool_receipt_documents IS 'Tracks all uploaded tool receipt documents with processing status and metadata';
COMMENT ON COLUMN tool_receipt_documents.file_hash IS 'SHA-256 hash to prevent duplicate uploads';
COMMENT ON COLUMN tool_receipt_documents.processing_status IS 'Current processing state: pending, processing, completed, failed';
COMMENT ON COLUMN tool_receipt_documents.tools_extracted IS 'Number of tools extracted from receipt';
COMMENT ON COLUMN tool_receipt_documents.tools_saved IS 'Number of tools successfully saved to database';
