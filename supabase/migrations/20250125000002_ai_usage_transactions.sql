-- AI Usage Transactions Table
-- Tracks AI tool usage and costs per user

BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'custom')),
  model_name TEXT NOT NULL,
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  request_id TEXT, -- Optional: link to specific AI request
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id ON ai_usage_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_transactions(provider);

-- Enable RLS
ALTER TABLE ai_usage_transactions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view their own AI usage transactions
CREATE POLICY "Users can view own AI usage" ON ai_usage_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

COMMIT;

