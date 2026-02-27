-- Stripe Connect Integration Tables
-- Created: 2026-02-27

CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text UNIQUE NOT NULL,
  display_name text,
  contact_email text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stripe_connect_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own connect accounts"
  ON stripe_connect_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connect accounts"
  ON stripe_connect_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS stripe_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_account_id text NOT NULL,
  subscription_id text UNIQUE NOT NULL,
  status text NOT NULL,
  price_id text,
  quantity integer DEFAULT 1,
  cancel_at_period_end boolean DEFAULT false,
  current_period_end timestamptz,
  updated_at timestamptz DEFAULT now()
);
