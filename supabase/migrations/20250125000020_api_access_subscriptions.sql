-- ==========================================================================
-- API ACCESS SUBSCRIPTIONS AND PAYMENT SYSTEM
-- ==========================================================================
-- Purpose: Allow users to pay for API access to AI analysis features
-- ==========================================================================

-- API Access Subscriptions Table
CREATE TABLE IF NOT EXISTS api_access_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_type TEXT NOT NULL, -- 'monthly', 'pay_as_you_go', 'prepaid_credits'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'expired', 'past_due'
  stripe_subscription_id TEXT, -- For recurring subscriptions
  stripe_customer_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  credits_remaining INTEGER DEFAULT 0, -- For prepaid credits
  monthly_limit INTEGER, -- For monthly subscriptions (e.g., 1000 images/month)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id) -- One active subscription per user
);

CREATE INDEX IF NOT EXISTS idx_api_subscriptions_user_id ON api_access_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_api_subscriptions_status ON api_access_subscriptions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_api_subscriptions_stripe_sub ON api_access_subscriptions(stripe_subscription_id);

-- API Usage Tracking Table
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES api_access_subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, -- 'openai', 'anthropic', 'aws'
  model_name TEXT, -- 'gpt-4o', 'claude-3-haiku', etc.
  function_name TEXT NOT NULL, -- 'analyze-image-tier1', 'analyze-image', etc.
  image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  cost_cents INTEGER NOT NULL, -- Cost in cents (e.g., 1 cent = $0.01)
  tokens_used INTEGER, -- If applicable
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB, -- Additional context
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_subscription_id ON api_usage_logs(subscription_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_date ON api_usage_logs(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE api_access_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for api_access_subscriptions
CREATE POLICY "Users can view own subscriptions"
  ON api_access_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all subscriptions"
  ON api_access_subscriptions FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for api_usage_logs
CREATE POLICY "Users can view own usage logs"
  ON api_usage_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all usage logs"
  ON api_usage_logs FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Function to check if user has active API access
CREATE OR REPLACE FUNCTION has_active_api_access(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription api_access_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_subscription
  FROM api_access_subscriptions
  WHERE user_id = p_user_id
    AND status = 'active'
    AND (
      -- Monthly subscription: check if within period
      (subscription_type = 'monthly' AND current_period_end > NOW())
      OR
      -- Prepaid credits: check if credits remaining
      (subscription_type = 'prepaid_credits' AND credits_remaining > 0)
      OR
      -- Pay as you go: always active (billed separately)
      subscription_type = 'pay_as_you_go'
    )
  LIMIT 1;
  
  RETURN v_subscription.id IS NOT NULL;
END;
$$;

-- Function to check and deduct credits (for prepaid)
CREATE OR REPLACE FUNCTION check_and_deduct_credits(
  p_user_id UUID,
  p_cost_cents INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription api_access_subscriptions%ROWTYPE;
BEGIN
  -- Get active prepaid subscription
  SELECT * INTO v_subscription
  FROM api_access_subscriptions
  WHERE user_id = p_user_id
    AND status = 'active'
    AND subscription_type = 'prepaid_credits'
    AND credits_remaining >= p_cost_cents
  FOR UPDATE
  LIMIT 1;
  
  IF v_subscription.id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Deduct credits
  UPDATE api_access_subscriptions
  SET credits_remaining = credits_remaining - p_cost_cents,
      updated_at = NOW()
  WHERE id = v_subscription.id;
  
  RETURN true;
END;
$$;

-- Function to get user's API key info (for providers they've added)
CREATE OR REPLACE FUNCTION get_user_api_key_info(
  p_user_id UUID,
  p_provider TEXT
)
RETURNS TABLE(
  api_key_encrypted TEXT,
  model_name TEXT,
  is_default BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    uap.api_key_encrypted,
    uap.model_name,
    uap.is_default
  FROM user_ai_providers uap
  WHERE uap.user_id = p_user_id
    AND uap.provider = p_provider
    AND uap.is_active = true
  ORDER BY uap.is_default DESC, uap.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON TABLE api_access_subscriptions IS 'Tracks user subscriptions for API access to AI analysis features';
COMMENT ON TABLE api_usage_logs IS 'Logs all API usage for billing and analytics';
COMMENT ON FUNCTION has_active_api_access(UUID) IS 'Checks if user has active API access subscription';
COMMENT ON FUNCTION check_and_deduct_credits(UUID, INTEGER) IS 'Checks and deducts credits for prepaid subscriptions';
COMMENT ON FUNCTION get_user_api_key(UUID, TEXT) IS 'Gets user-provided API key for a provider (if they added their own)';

