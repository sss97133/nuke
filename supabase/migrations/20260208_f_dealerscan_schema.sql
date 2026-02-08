-- DealerScan: Standalone dealer jacket OCR extraction SaaS
-- All tables prefixed with ds_ for isolation from core Nuke tables

-- Users table (extends auth.users with DealerScan-specific data)
CREATE TABLE ds_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    company_name TEXT,
    free_extractions_used INTEGER DEFAULT 0 NOT NULL,
    free_extractions_limit INTEGER DEFAULT 100 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit balance tracking
CREATE TABLE ds_credit_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credits_remaining INTEGER DEFAULT 0 NOT NULL,
    credits_purchased_total INTEGER DEFAULT 0 NOT NULL,
    credits_used_total INTEGER DEFAULT 0 NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT ds_credit_balances_user_unique UNIQUE (user_id)
);

-- Credit transactions (audit trail)
CREATE TABLE ds_credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'free_grant', 'purchase', 'extraction', 'refund', 'admin_adjustment'
    )),
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    description TEXT,
    balance_after INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deals (group of documents for one vehicle transaction)
CREATE TABLE ds_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    deal_name TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'review', 'completed', 'archived'
    )),
    merged_data JSONB DEFAULT '{}',
    vin TEXT,
    year INTEGER,
    make TEXT,
    model TEXT,
    owner_name TEXT,
    deal_date DATE,
    sale_price NUMERIC(12,2),
    total_pages INTEGER DEFAULT 0,
    pages_extracted INTEGER DEFAULT 0,
    pages_needing_review INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual document pages within a deal
CREATE TABLE ds_document_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES ds_deals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_filename TEXT,
    file_size_bytes INTEGER,
    mime_type TEXT DEFAULT 'image/jpeg',
    page_number INTEGER DEFAULT 1,
    document_type TEXT,
    document_type_confidence REAL DEFAULT 0,
    extracted_data JSONB DEFAULT '{}',
    confidences JSONB DEFAULT '{}',
    raw_ocr_text TEXT,
    extraction_provider TEXT,
    extraction_model TEXT,
    extraction_cost_usd REAL,
    extraction_duration_ms INTEGER,
    needs_review BOOLEAN DEFAULT false,
    review_status TEXT DEFAULT 'pending' CHECK (review_status IN (
        'pending', 'auto_accepted', 'user_reviewed', 'user_rejected'
    )),
    reviewed_at TIMESTAMPTZ,
    user_edits JSONB DEFAULT '{}',
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    extracted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extraction cost tracking (daily aggregates)
CREATE TABLE ds_cost_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    total_extractions INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    total_tokens_input INTEGER DEFAULT 0,
    total_tokens_output INTEGER DEFAULT 0,
    total_revenue_usd REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT ds_cost_tracking_unique UNIQUE (date, provider, model)
);

-- Indexes
CREATE INDEX idx_ds_deals_user ON ds_deals(user_id);
CREATE INDEX idx_ds_deals_status ON ds_deals(status);
CREATE INDEX idx_ds_document_pages_deal ON ds_document_pages(deal_id);
CREATE INDEX idx_ds_document_pages_user ON ds_document_pages(user_id);
CREATE INDEX idx_ds_document_pages_review ON ds_document_pages(needs_review) WHERE needs_review = true;
CREATE INDEX idx_ds_credit_transactions_user ON ds_credit_transactions(user_id);
CREATE INDEX idx_ds_cost_tracking_date ON ds_cost_tracking(date);

-- RLS
ALTER TABLE ds_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_cost_tracking ENABLE ROW LEVEL SECURITY;

-- Users see only their own data
CREATE POLICY "ds_users_own" ON ds_users FOR ALL USING (auth.uid() = id);
CREATE POLICY "ds_credits_own" ON ds_credit_balances FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "ds_transactions_own" ON ds_credit_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ds_deals_own" ON ds_deals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "ds_pages_own" ON ds_document_pages FOR ALL USING (auth.uid() = user_id);
-- Cost tracking: service role only (no user RLS needed, handled by edge functions)
CREATE POLICY "ds_cost_tracking_service" ON ds_cost_tracking FOR ALL USING (true);
-- Allow service role inserts for credit transactions
CREATE POLICY "ds_transactions_service_insert" ON ds_credit_transactions FOR INSERT WITH CHECK (true);

-- Function: Deduct one credit (checks free first, then paid)
CREATE OR REPLACE FUNCTION ds_deduct_credit(p_user_id UUID, p_description TEXT DEFAULT 'Document extraction')
RETURNS TABLE(success BOOLEAN, credits_remaining INTEGER, source TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user ds_users%ROWTYPE;
    v_balance ds_credit_balances%ROWTYPE;
    v_remaining INTEGER;
    v_source TEXT;
BEGIN
    -- Check free credits first
    SELECT * INTO v_user FROM ds_users WHERE id = p_user_id FOR UPDATE;

    IF v_user IS NULL THEN
        -- Auto-create ds_users record
        INSERT INTO ds_users (id) VALUES (p_user_id);
        SELECT * INTO v_user FROM ds_users WHERE id = p_user_id FOR UPDATE;
    END IF;

    IF v_user.free_extractions_used < v_user.free_extractions_limit THEN
        UPDATE ds_users SET free_extractions_used = free_extractions_used + 1, updated_at = NOW()
        WHERE id = p_user_id;

        v_remaining := v_user.free_extractions_limit - v_user.free_extractions_used - 1;
        v_source := 'free';

        INSERT INTO ds_credit_transactions (user_id, amount, transaction_type, description, balance_after)
        VALUES (p_user_id, -1, 'extraction', p_description, v_remaining);

        RETURN QUERY SELECT true, v_remaining, v_source;
        RETURN;
    END IF;

    -- Check paid credits
    SELECT * INTO v_balance FROM ds_credit_balances WHERE user_id = p_user_id FOR UPDATE;

    IF v_balance IS NULL OR v_balance.credits_remaining <= 0 THEN
        RETURN QUERY SELECT false, 0, 'none'::TEXT;
        RETURN;
    END IF;

    UPDATE ds_credit_balances
    SET credits_remaining = credits_remaining - 1,
        credits_used_total = credits_used_total + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    v_remaining := v_balance.credits_remaining - 1;
    v_source := 'paid';

    INSERT INTO ds_credit_transactions (user_id, amount, transaction_type, description, balance_after)
    VALUES (p_user_id, -1, 'extraction', p_description, v_remaining);

    RETURN QUERY SELECT true, v_remaining, v_source;
END;
$$;

-- Function: Add purchased credits
CREATE OR REPLACE FUNCTION ds_add_credits(
    p_user_id UUID,
    p_credits INTEGER,
    p_stripe_session_id TEXT,
    p_stripe_payment_intent TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_new_balance INTEGER;
BEGIN
    -- Ensure ds_users record exists
    INSERT INTO ds_users (id) VALUES (p_user_id) ON CONFLICT (id) DO NOTHING;

    INSERT INTO ds_credit_balances (user_id, credits_remaining, credits_purchased_total)
    VALUES (p_user_id, p_credits, p_credits)
    ON CONFLICT (user_id) DO UPDATE SET
        credits_remaining = ds_credit_balances.credits_remaining + p_credits,
        credits_purchased_total = ds_credit_balances.credits_purchased_total + p_credits,
        updated_at = NOW()
    RETURNING credits_remaining INTO v_new_balance;

    INSERT INTO ds_credit_transactions (
        user_id, amount, transaction_type, stripe_session_id,
        stripe_payment_intent, description, balance_after
    ) VALUES (
        p_user_id, p_credits, 'purchase', p_stripe_session_id,
        p_stripe_payment_intent, p_credits || ' extraction credits purchased', v_new_balance
    );

    RETURN v_new_balance;
END;
$$;

-- Function: Refund a credit (for failed extractions)
CREATE OR REPLACE FUNCTION ds_refund_credit(p_user_id UUID, p_description TEXT DEFAULT 'Failed extraction refund')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user ds_users%ROWTYPE;
    v_balance INTEGER;
BEGIN
    SELECT * INTO v_user FROM ds_users WHERE id = p_user_id;
    -- Refund to free credits if they were used from free pool
    IF v_user.free_extractions_used > 0 THEN
        UPDATE ds_users SET free_extractions_used = free_extractions_used - 1 WHERE id = p_user_id;
        v_balance := v_user.free_extractions_limit - v_user.free_extractions_used + 1;
    ELSE
        UPDATE ds_credit_balances SET credits_remaining = credits_remaining + 1 WHERE user_id = p_user_id;
        SELECT credits_remaining INTO v_balance FROM ds_credit_balances WHERE user_id = p_user_id;
    END IF;

    INSERT INTO ds_credit_transactions (user_id, amount, transaction_type, description, balance_after)
    VALUES (p_user_id, 1, 'refund', p_description, COALESCE(v_balance, 0));
END;
$$;

-- Function: Get user's credit summary
CREATE OR REPLACE FUNCTION ds_get_credits(p_user_id UUID)
RETURNS TABLE(free_remaining INTEGER, free_limit INTEGER, paid_remaining INTEGER, total_available INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user ds_users%ROWTYPE;
    v_paid INTEGER;
BEGIN
    SELECT * INTO v_user FROM ds_users WHERE id = p_user_id;
    IF v_user IS NULL THEN
        INSERT INTO ds_users (id) VALUES (p_user_id);
        RETURN QUERY SELECT 100, 100, 0, 100;
        RETURN;
    END IF;

    SELECT COALESCE(credits_remaining, 0) INTO v_paid FROM ds_credit_balances WHERE user_id = p_user_id;

    RETURN QUERY SELECT
        v_user.free_extractions_limit - v_user.free_extractions_used,
        v_user.free_extractions_limit,
        COALESCE(v_paid, 0),
        (v_user.free_extractions_limit - v_user.free_extractions_used) + COALESCE(v_paid, 0);
END;
$$;

-- Storage bucket for dealer jacket documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'dealerscan-documents',
    'dealerscan-documents',
    false,
    15728640, -- 15MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
) ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can upload/read their own files
CREATE POLICY "ds_storage_user_upload" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'dealerscan-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "ds_storage_user_read" ON storage.objects FOR SELECT
    USING (bucket_id = 'dealerscan-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "ds_storage_user_delete" ON storage.objects FOR DELETE
    USING (bucket_id = 'dealerscan-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Service role needs full access for signed URLs in edge functions
CREATE POLICY "ds_storage_service_all" ON storage.objects FOR ALL
    USING (bucket_id = 'dealerscan-documents');
