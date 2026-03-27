-- ============================================
-- WORK ORDER INTELLIGENCE: Schema Reconciliation
-- ============================================
-- Codifies all ad-hoc tables/columns created during the 2026-03-26 session.
-- All IF NOT EXISTS / DO $$ wrapped. Safe to re-run. Preserves existing data.
--
-- Tables codified: work_order_payments, labor_operations, user_labor_rates, work_contracts
-- Columns codified: work_order_id, is_comped, comp_reason, comp_retail_value on parts+labor
-- Missing pieces: user_labor_rates (priority 2 in resolve_labor_rate), work_contracts (priority 1)

-- ============================================
-- 1. work_order_payments (exists with 4 rows, needs formal migration)
-- ============================================
CREATE TABLE IF NOT EXISTS work_order_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'zelle',
  sender_name TEXT,
  memo TEXT,
  reference_id TEXT,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual',
  source_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'completed'
);

-- Dedup index: prevent duplicate payment ingestion
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_payments_dedup
  ON work_order_payments (work_order_id, amount, payment_method, sender_name, payment_date)
  WHERE sender_name IS NOT NULL;

-- CHECK constraints
DO $$ BEGIN
  ALTER TABLE work_order_payments ADD CONSTRAINT chk_payment_amount_positive CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_order_payments ADD CONSTRAINT chk_payment_status CHECK (status IN ('completed', 'pending', 'failed', 'refunded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_order_payments ADD CONSTRAINT chk_payment_method CHECK (payment_method IN ('zelle', 'check', 'cash', 'wire', 'venmo', 'paypal', 'credit_card', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE work_order_payments IS 'Customer payments toward work orders. Ingested from Zelle SMS (iMessage chat.db), manual entry, or bank feeds. Deduped by (wo, amount, method, sender, date).';
COMMENT ON COLUMN work_order_payments.source IS 'How this payment was discovered: zelle_sms, manual, bank_feed, quickbooks';
COMMENT ON COLUMN work_order_payments.source_metadata IS 'Raw source data: iMessage ROWID, QB transaction_id, bank statement line';
COMMENT ON COLUMN work_order_payments.reference_id IS 'External reference: Zelle confirmation #, check #, wire ref';

-- ============================================
-- 2. labor_operations (exists with 58 rows, code is natural key)
-- ============================================
CREATE TABLE IF NOT EXISTS labor_operations (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_hours NUMERIC NOT NULL,
  system TEXT,
  model_year_min INTEGER,
  model_year_max INTEGER,
  notes TEXT
);

COMMENT ON TABLE labor_operations IS 'Mitchell-style flat rate book. Maps operation codes to book hours. Used by estimate_labor_from_description() and labor pricing engine.';
COMMENT ON COLUMN labor_operations.code IS 'Unique operation code, e.g. MECH-BRAKES-FRONT, EXH-CUSTOM-FAB';
COMMENT ON COLUMN labor_operations.base_hours IS 'Standard book hours for this operation. Multipliers applied separately.';
COMMENT ON COLUMN labor_operations.system IS 'Vehicle system: body, paint, mechanical, interior, glass, electrical, trim, exhaust';

-- ============================================
-- 3. user_labor_rates (MISSING — completes resolve_labor_rate priority 2)
-- ============================================
CREATE TABLE IF NOT EXISTS user_labor_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  hourly_rate NUMERIC NOT NULL,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  specialty TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_labor_rates_user_active
  ON user_labor_rates (user_id, is_active) WHERE is_active = true;

DO $$ BEGIN
  ALTER TABLE user_labor_rates ADD CONSTRAINT chk_user_rate_positive CHECK (hourly_rate > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE user_labor_rates IS 'Per-technician labor rates. Priority 2 in resolve_labor_rate() cascade: contract → user → org → system_default.';
COMMENT ON COLUMN user_labor_rates.specialty IS 'Optional: mechanical, body, paint, electrical. Allows different rates per skill.';

-- ============================================
-- 4. work_contracts (MISSING — completes resolve_labor_rate priority 1)
-- ============================================
CREATE TABLE IF NOT EXISTS work_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  vehicle_id UUID,
  agreed_labor_rate NUMERIC NOT NULL,
  scope_description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  terms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_contracts_client_org_active
  ON work_contracts (client_id, organization_id) WHERE status = 'active';

DO $$ BEGIN
  ALTER TABLE work_contracts ADD CONSTRAINT chk_contract_rate_positive CHECK (agreed_labor_rate > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_contracts ADD CONSTRAINT chk_contract_status CHECK (status IN ('active', 'expired', 'cancelled', 'draft'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE work_contracts IS 'Client-org agreements with negotiated labor rates. Priority 1 in resolve_labor_rate() cascade. Vehicle-specific contracts override general ones.';
COMMENT ON COLUMN work_contracts.vehicle_id IS 'NULL = applies to all vehicles for this client/org pair. Non-null = vehicle-specific rate.';

-- ============================================
-- 5. Ensure FK columns on parts + labor (already exist per survey, but idempotent)
-- ============================================
DO $$ BEGIN
  ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_order_labor ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================
-- 6. Ensure comp columns on parts + labor (already exist per survey, but idempotent)
-- ============================================
DO $$ BEGIN
  ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS is_comped BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS comp_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS comp_retail_value NUMERIC;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE work_order_labor ADD COLUMN IF NOT EXISTS is_comped BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE work_order_labor ADD COLUMN IF NOT EXISTS comp_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE work_order_labor ADD COLUMN IF NOT EXISTS comp_retail_value NUMERIC;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

COMMENT ON COLUMN work_order_parts.is_comped IS 'True if this part was comped (free to customer). comp_retail_value tracks what it would have cost.';
COMMENT ON COLUMN work_order_labor.is_comped IS 'True if this labor was comped. Used for goodwill/warranty tracking.';

-- ============================================
-- 7. RLS Policies
-- ============================================
-- work_order_payments
ALTER TABLE work_order_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read work_order_payments" ON work_order_payments FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role write work_order_payments" ON work_order_payments FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- user_labor_rates
ALTER TABLE user_labor_rates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read user_labor_rates" ON user_labor_rates FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role write user_labor_rates" ON user_labor_rates FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- work_contracts
ALTER TABLE work_contracts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read work_contracts" ON work_contracts FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role write work_contracts" ON work_contracts FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 8. Grants
-- ============================================
GRANT SELECT ON work_order_payments TO anon, authenticated;
GRANT ALL ON work_order_payments TO service_role;

GRANT SELECT ON labor_operations TO anon, authenticated;
GRANT ALL ON labor_operations TO service_role;

GRANT SELECT ON user_labor_rates TO anon, authenticated;
GRANT ALL ON user_labor_rates TO service_role;

GRANT SELECT ON work_contracts TO anon, authenticated;
GRANT ALL ON work_contracts TO service_role;

-- Notify PostgREST of schema changes
NOTIFY pgrst, 'reload schema';
