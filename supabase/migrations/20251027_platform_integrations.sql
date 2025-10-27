-- Platform integrations table (for Central Dispatch, Twilio, Stripe, etc.)
CREATE TABLE IF NOT EXISTS platform_integrations (
  integration_name TEXT PRIMARY KEY, -- central_dispatch, twilio, stripe, etc.
  status TEXT NOT NULL DEFAULT 'disconnected', -- disconnected, connected, error
  token_expires_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only admins can manage integrations
ALTER TABLE platform_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on platform_integrations"
  ON platform_integrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Admin users can view integrations (add your admin check here)
CREATE POLICY "Admins can view integrations"
  ON platform_integrations
  FOR SELECT
  TO authenticated
  USING (true); -- TODO: Add admin role check when RBAC is implemented

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_platform_integration_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_integrations_updated_at
  BEFORE UPDATE ON platform_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_platform_integration_timestamp();

-- Insert initial records for tracking
INSERT INTO platform_integrations (integration_name, status, metadata)
VALUES 
  ('central_dispatch', 'disconnected', '{"test_mode": true}'::jsonb),
  ('twilio', 'connected', '{}'::jsonb),
  ('stripe', 'connected', '{}'::jsonb)
ON CONFLICT (integration_name) DO NOTHING;

