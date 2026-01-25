-- Demo Mode Infrastructure
-- Ensures all features remain non-functional until regulatory approval
-- Part of Phase 1: Institutional-Grade Financial Infrastructure

-- Platform configuration table
CREATE TABLE IF NOT EXISTS platform_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Seed with initial configuration
INSERT INTO platform_config (config_key, config_value, description) VALUES
('demo_mode', '{"enabled": true, "message": "Paper Trading Mode", "allow_real_deposits": false, "show_demo_banner": true}', 'Demo mode toggle - prevents real money transactions'),
('regulatory_status', '{"sec_approved": false, "finra_approved": false, "last_updated": null, "approval_notes": null}', 'Regulatory approval status tracking'),
('platform_features', '{"trading_enabled": true, "real_money_enabled": false, "kyc_required": false, "accreditation_required": false}', 'Feature flags for platform capabilities'),
('compliance_contacts', '{"legal_counsel": null, "compliance_officer": null, "sec_contact": null}', 'Compliance team contact information')
ON CONFLICT (config_key) DO NOTHING;

-- Usage metrics for demo analysis
CREATE TABLE IF NOT EXISTS usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT,
  metric_type TEXT NOT NULL, -- 'trade_attempted', 'offering_viewed', 'kyc_started', 'subscription_started', etc.
  entity_type TEXT, -- 'index', 'vehicle', 'offering'
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_usage_metrics_type_date ON usage_metrics(metric_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_user ON usage_metrics(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_entity ON usage_metrics(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_platform_config_key ON platform_config(config_key);

-- RLS Policies
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

-- Platform config: everyone can read, only admins can write
CREATE POLICY "platform_config_public_read" ON platform_config
  FOR SELECT USING (true);

CREATE POLICY "platform_config_admin_write" ON platform_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.user_type = 'admin'
    )
  );

-- Usage metrics: users can insert their own, admins can view all
CREATE POLICY "usage_metrics_user_insert" ON usage_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "usage_metrics_admin_read" ON usage_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.user_type IN ('admin', 'moderator')
    )
  );

-- Function to get platform status
CREATE OR REPLACE FUNCTION get_platform_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_result JSONB;
  v_demo_mode JSONB;
  v_regulatory JSONB;
  v_features JSONB;
BEGIN
  SELECT config_value INTO v_demo_mode FROM platform_config WHERE config_key = 'demo_mode';
  SELECT config_value INTO v_regulatory FROM platform_config WHERE config_key = 'regulatory_status';
  SELECT config_value INTO v_features FROM platform_config WHERE config_key = 'platform_features';

  v_result := jsonb_build_object(
    'demo_mode', COALESCE(v_demo_mode, '{"enabled": true}'::jsonb),
    'regulatory_status', COALESCE(v_regulatory, '{"sec_approved": false, "finra_approved": false}'::jsonb),
    'features', COALESCE(v_features, '{"trading_enabled": true, "real_money_enabled": false}'::jsonb),
    'is_live', COALESCE((v_demo_mode->>'enabled')::boolean = false AND
                        (v_regulatory->>'sec_approved')::boolean = true AND
                        (v_regulatory->>'finra_approved')::boolean = true, false),
    'timestamp', NOW()
  );

  RETURN v_result;
END;
$$;

-- Function to log usage metrics
CREATE OR REPLACE FUNCTION log_usage_metric(
  p_metric_type TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_metric_id UUID;
BEGIN
  INSERT INTO usage_metrics (
    user_id,
    metric_type,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    auth.uid(),
    p_metric_type,
    p_entity_type,
    p_entity_id,
    p_metadata
  ) RETURNING id INTO v_metric_id;

  RETURN v_metric_id;
END;
$$;

-- Function to get usage analytics (admin only)
CREATE OR REPLACE FUNCTION get_usage_analytics(
  p_days INTEGER DEFAULT 30,
  p_metric_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Check admin access
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND user_type IN ('admin', 'moderator')
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT jsonb_build_object(
    'period_days', p_days,
    'total_events', (
      SELECT COUNT(*) FROM usage_metrics
      WHERE created_at >= NOW() - (p_days || ' days')::interval
      AND (p_metric_type IS NULL OR metric_type = p_metric_type)
    ),
    'unique_users', (
      SELECT COUNT(DISTINCT user_id) FROM usage_metrics
      WHERE created_at >= NOW() - (p_days || ' days')::interval
      AND user_id IS NOT NULL
      AND (p_metric_type IS NULL OR metric_type = p_metric_type)
    ),
    'by_type', (
      SELECT COALESCE(jsonb_object_agg(metric_type, cnt), '{}'::jsonb)
      FROM (
        SELECT metric_type, COUNT(*) as cnt
        FROM usage_metrics
        WHERE created_at >= NOW() - (p_days || ' days')::interval
        GROUP BY metric_type
      ) sub
    ),
    'daily_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', dt,
        'count', cnt
      ) ORDER BY dt), '[]'::jsonb)
      FROM (
        SELECT DATE(created_at) as dt, COUNT(*) as cnt
        FROM usage_metrics
        WHERE created_at >= NOW() - (p_days || ' days')::interval
        AND (p_metric_type IS NULL OR metric_type = p_metric_type)
        GROUP BY DATE(created_at)
      ) sub
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_platform_status TO anon, authenticated;
GRANT EXECUTE ON FUNCTION log_usage_metric TO authenticated;
GRANT EXECUTE ON FUNCTION get_usage_analytics TO authenticated;

-- Comments
COMMENT ON TABLE platform_config IS 'Platform-wide configuration including demo mode and regulatory status';
COMMENT ON TABLE usage_metrics IS 'Tracks user interactions for demo analysis and conversion metrics';
COMMENT ON FUNCTION get_platform_status IS 'Returns current platform status including demo mode and regulatory approval';
COMMENT ON FUNCTION log_usage_metric IS 'Logs a usage metric event for analytics';
