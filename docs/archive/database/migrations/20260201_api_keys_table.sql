-- API Keys Management
-- Enables users to create API keys for programmatic access

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL, -- First 8 chars for identification
    scopes TEXT[] DEFAULT ARRAY['read', 'write'],
    is_active BOOLEAN DEFAULT true,
    rate_limit_per_hour INTEGER DEFAULT 1000,
    rate_limit_remaining INTEGER DEFAULT 1000,
    rate_limit_reset_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT api_keys_name_length CHECK (char_length(name) BETWEEN 1 AND 100)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

-- API Usage Logs table
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_id TEXT,
    request_method TEXT,
    request_path TEXT,
    response_status INTEGER,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for analytics
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_timestamp ON api_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_resource ON api_usage_logs(resource, action);

-- RLS Policies
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own API keys
CREATE POLICY "Users can view own API keys"
    ON api_keys FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own API keys"
    ON api_keys FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own API keys"
    ON api_keys FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own API keys"
    ON api_keys FOR DELETE
    USING (auth.uid() = user_id);

-- Users can only see their own usage logs
CREATE POLICY "Users can view own usage logs"
    ON api_usage_logs FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert usage logs
CREATE POLICY "Service role can insert usage logs"
    ON api_usage_logs FOR INSERT
    WITH CHECK (true);

-- Function to reset rate limits hourly
CREATE OR REPLACE FUNCTION reset_api_key_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE api_keys
    SET
        rate_limit_remaining = rate_limit_per_hour,
        rate_limit_reset_at = NOW() + INTERVAL '1 hour'
    WHERE rate_limit_reset_at IS NULL OR rate_limit_reset_at < NOW();
END;
$$;

-- Comments
COMMENT ON TABLE api_keys IS 'API keys for programmatic access to Nuke platform';
COMMENT ON TABLE api_usage_logs IS 'Audit log of all API requests';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the API key (key itself is never stored)';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 8 characters of key for identification in UI';
COMMENT ON COLUMN api_keys.scopes IS 'Array of permitted scopes: read, write, admin';
