-- Vehicle Purchase Payments Ledger
-- Tracks deposits and payments tied to purchase agreements

CREATE TABLE IF NOT EXISTS vehicle_purchase_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL,
  payer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_usd NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),
  payment_provider TEXT NOT NULL CHECK (payment_provider IN ('stripe', 'clearing_house', 'square')),
  purpose TEXT NOT NULL DEFAULT 'deposit' CHECK (purpose IN ('deposit', 'balance', 'full')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  payment_intent_id TEXT,
  stripe_session_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS for privacy
ALTER TABLE vehicle_purchase_payments ENABLE ROW LEVEL SECURITY;

-- Buyers and sellers can see their own related payments (if agreements table exists). As a fallback, limit to payer.
CREATE POLICY "Payers see own payments"
  ON vehicle_purchase_payments FOR SELECT
  USING (auth.uid() = payer_user_id);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_purchase_payments_agreement ON vehicle_purchase_payments(agreement_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_purchase_payments_payer ON vehicle_purchase_payments(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_purchase_payments_created ON vehicle_purchase_payments(created_at DESC);
