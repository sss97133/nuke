-- Apply user_ai_providers migration
-- Run this in Supabase SQL Editor

BEGIN;

CREATE TABLE IF NOT EXISTS user_ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'custom')),
  api_key_encrypted TEXT NOT NULL,
  model_name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  cost_per_request_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_providers_user_id ON user_ai_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_providers_active ON user_ai_providers(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_ai_providers_default ON user_ai_providers(user_id, is_default) WHERE is_default = true;

ALTER TABLE user_ai_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own AI providers" ON user_ai_providers;
CREATE POLICY "Users can manage own AI providers" ON user_ai_providers
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ai_providers_one_default 
ON user_ai_providers(user_id) 
WHERE is_default = true AND is_active = true;

COMMIT;

