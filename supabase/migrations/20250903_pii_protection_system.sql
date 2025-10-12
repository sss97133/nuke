-- Industry-standard PII protection system for ID documents

-- Enable pgcrypto extension for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create encryption key management table
CREATE TABLE IF NOT EXISTS encryption_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_name TEXT UNIQUE NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    encrypted_key BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

-- Create PII audit log table
CREATE TABLE IF NOT EXISTS pii_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    accessed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'view', 'upload', 'delete', 'download'
    resource_type TEXT NOT NULL, -- 'id_document', 'verification_data'
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    access_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create secure document metadata table (no actual document content)
CREATE TABLE IF NOT EXISTS secure_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    file_hash TEXT NOT NULL, -- SHA-256 hash for integrity
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    encryption_key_id UUID REFERENCES encryption_keys(id),
    storage_path TEXT NOT NULL, -- Encrypted storage path
    upload_metadata JSONB DEFAULT '{}'::jsonb,
    verification_status TEXT DEFAULT 'pending',
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    retention_until TIMESTAMP WITH TIME ZONE, -- Auto-delete date
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update profiles table to remove direct PII storage
ALTER TABLE profiles 
DROP COLUMN IF EXISTS id_document_url,
DROP COLUMN IF EXISTS id_document_type;

-- Add secure reference to documents
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS primary_id_document_id UUID REFERENCES secure_documents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS verification_document_ids UUID[] DEFAULT '{}';

-- Enable RLS on new tables
ALTER TABLE encryption_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE secure_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for encryption_keys (admin only)
CREATE POLICY "Only admins can manage encryption keys" ON encryption_keys
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.user_type = 'admin'
        )
    );

-- RLS Policies for pii_audit_log
CREATE POLICY "Users can view their own audit logs" ON pii_audit_log
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Moderators can view all audit logs" ON pii_audit_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.user_type IN ('moderator', 'admin')
        )
    );

CREATE POLICY "System can insert audit logs" ON pii_audit_log
    FOR INSERT WITH CHECK (true);

-- RLS Policies for secure_documents
CREATE POLICY "Users can view their own documents" ON secure_documents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" ON secure_documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents" ON secure_documents
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Moderators can view all documents for verification" ON secure_documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.user_type IN ('moderator', 'admin')
        )
    );

CREATE POLICY "Moderators can update verification status" ON secure_documents
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.user_type IN ('moderator', 'admin')
        )
    );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_pii_audit_log_user_id ON pii_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_pii_audit_log_created_at ON pii_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_secure_documents_user_id ON secure_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_secure_documents_hash ON secure_documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_secure_documents_retention ON secure_documents(retention_until);

-- Create function to log PII access
CREATE OR REPLACE FUNCTION log_pii_access(
    p_user_id UUID,
    p_action TEXT,
    p_resource_type TEXT,
    p_resource_id UUID DEFAULT NULL,
    p_access_reason TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    audit_id UUID;
BEGIN
    INSERT INTO pii_audit_log (
        user_id,
        accessed_by,
        action,
        resource_type,
        resource_id,
        ip_address,
        user_agent,
        access_reason
    ) VALUES (
        p_user_id,
        auth.uid(),
        p_action,
        p_resource_type,
        p_resource_id,
        inet_client_addr(),
        current_setting('request.headers', true)::json->>'user-agent',
        p_access_reason
    ) RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for automatic document retention cleanup
CREATE OR REPLACE FUNCTION cleanup_expired_documents() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Log cleanup action
    PERFORM log_pii_access(
        user_id,
        'auto_delete',
        'id_document',
        id,
        'Automatic retention policy cleanup'
    ) FROM secure_documents 
    WHERE retention_until < NOW();
    
    -- Delete expired documents
    DELETE FROM secure_documents 
    WHERE retention_until < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_secure_documents_updated_at
    BEFORE UPDATE ON secure_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Set default retention period (7 years for compliance)
ALTER TABLE secure_documents 
ALTER COLUMN retention_until SET DEFAULT (NOW() + INTERVAL '7 years');

-- Create initial encryption key (simplified for development)
INSERT INTO encryption_keys (key_name, encrypted_key, expires_at)
VALUES (
    'document_encryption_v1',
    decode('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3OA==', 'base64'),
    NOW() + INTERVAL '90 days'
) ON CONFLICT (key_name) DO NOTHING;
