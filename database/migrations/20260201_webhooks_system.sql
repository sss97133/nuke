-- Webhooks System
-- Real-time event notifications following Stripe/Plaid patterns

-- Webhook Endpoints table
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    description TEXT,
    events TEXT[] NOT NULL DEFAULT ARRAY['*'], -- Event types to subscribe to
    secret TEXT NOT NULL, -- For signing webhook payloads
    is_active BOOLEAN DEFAULT true,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Validation
    CONSTRAINT webhook_endpoints_url_valid CHECK (url ~ '^https?://'),
    CONSTRAINT webhook_endpoints_events_not_empty CHECK (array_length(events, 1) > 0)
);

-- Webhook Deliveries table (audit log)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_id TEXT NOT NULL, -- Idempotency key

    -- Payload
    payload JSONB NOT NULL,

    -- Delivery status
    status TEXT NOT NULL DEFAULT 'pending', -- pending, success, failed, retrying
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,

    -- Response tracking
    response_status INTEGER,
    response_body TEXT,
    response_time_ms INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,

    -- Error tracking
    last_error TEXT,

    CONSTRAINT webhook_deliveries_status_valid CHECK (status IN ('pending', 'success', 'failed', 'retrying'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user_id ON webhook_endpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_id ON webhook_deliveries(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON webhook_deliveries(next_retry_at) WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event_id ON webhook_deliveries(event_id);

-- RLS Policies
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Users can only see their own webhooks
CREATE POLICY "Users can view own webhook endpoints"
    ON webhook_endpoints FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own webhook endpoints"
    ON webhook_endpoints FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own webhook endpoints"
    ON webhook_endpoints FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own webhook endpoints"
    ON webhook_endpoints FOR DELETE
    USING (auth.uid() = user_id);

-- Users can view deliveries for their endpoints
CREATE POLICY "Users can view own webhook deliveries"
    ON webhook_deliveries FOR SELECT
    USING (
        endpoint_id IN (
            SELECT id FROM webhook_endpoints WHERE user_id = auth.uid()
        )
    );

-- Service role can insert deliveries
CREATE POLICY "Service role can insert webhook deliveries"
    ON webhook_deliveries FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Service role can update webhook deliveries"
    ON webhook_deliveries FOR UPDATE
    USING (true);

-- Function to generate webhook secret
CREATE OR REPLACE FUNCTION generate_webhook_secret()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    secret TEXT;
BEGIN
    SELECT encode(gen_random_bytes(32), 'hex') INTO secret;
    RETURN 'whsec_' || secret;
END;
$$;

-- Trigger to auto-generate secret on insert
CREATE OR REPLACE FUNCTION webhook_endpoint_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.secret IS NULL OR NEW.secret = '' THEN
        NEW.secret := generate_webhook_secret();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_endpoint_secret_trigger
    BEFORE INSERT ON webhook_endpoints
    FOR EACH ROW
    EXECUTE FUNCTION webhook_endpoint_before_insert();

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_webhook_endpoint_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER webhook_endpoint_updated_at
    BEFORE UPDATE ON webhook_endpoints
    FOR EACH ROW
    EXECUTE FUNCTION update_webhook_endpoint_timestamp();

-- Available event types (for reference)
COMMENT ON TABLE webhook_endpoints IS 'User-registered webhook endpoints for receiving event notifications';
COMMENT ON COLUMN webhook_endpoints.events IS 'Event types to subscribe to. Available: vehicle.created, vehicle.updated, vehicle.deleted, observation.created, document.uploaded, import.completed, *';
COMMENT ON TABLE webhook_deliveries IS 'Audit log of all webhook delivery attempts';
