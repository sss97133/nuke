-- User Stripe Keys Table
-- Allows users to connect their own Stripe accounts for AI tool payments

BEGIN;

CREATE TABLE IF NOT EXISTS user_stripe_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_publishable_key TEXT NOT NULL,
  stripe_secret_key_encrypted TEXT NOT NULL, -- Encrypted secret key
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stripe_keys_user_id ON user_stripe_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stripe_keys_active ON user_stripe_keys(user_id, is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE user_stripe_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view/manage their own Stripe keys
CREATE POLICY "Users can manage own Stripe keys" ON user_stripe_keys
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;

