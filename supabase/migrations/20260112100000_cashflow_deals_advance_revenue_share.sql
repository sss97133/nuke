-- =====================================================
-- CASHFLOW DEALS: ADVANCE + REVENUE SHARE (USERS + ORGS)
-- + ORGANIZATION WALLETS
-- =====================================================
-- Date: 2026-01-12
--
-- Purpose:
-- - Model "investing in individuals" and "investing in orgs" via two core instruments:
--   1) Advance: recoupable, capped (cap multiple)
--   2) Revenue share: % of receipts (optionally time-bounded and/or capped)
-- - Introduce a canonical cashflow event ledger and payout schedule
-- - Add org wallets so org-level deals can settle like user deals
--
-- Notes:
-- - Idempotent + safe for db reset.
-- - Avoids strict transaction_type enums to prevent future constraint pain.
--
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1) ORGANIZATION WALLETS (PARALLEL TO USER CASH BALANCES)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.organization_cash_balances (
  organization_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  balance_cents BIGINT DEFAULT 0 CHECK (balance_cents >= 0),
  available_cents BIGINT DEFAULT 0 CHECK (available_cents >= 0),
  reserved_cents BIGINT DEFAULT 0 CHECK (reserved_cents >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT organization_balance_invariant CHECK (balance_cents = available_cents + reserved_cents)
);

CREATE INDEX IF NOT EXISTS idx_org_cash_balances_org ON public.organization_cash_balances(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_cash_balances_available ON public.organization_cash_balances(available_cents DESC);

CREATE TABLE IF NOT EXISTS public.organization_cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  transaction_type TEXT NOT NULL,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  reference_id UUID,
  counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  counterparty_organization_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Keep transaction_type flexible; enforce only non-empty
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_cash_transactions_transaction_type_nonempty'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.organization_cash_transactions
    ADD CONSTRAINT organization_cash_transactions_transaction_type_nonempty
    CHECK (transaction_type IS NOT NULL AND btrim(transaction_type) <> '');
END
$$;

CREATE INDEX IF NOT EXISTS idx_org_cash_tx_org ON public.organization_cash_transactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_cash_tx_type ON public.organization_cash_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_org_cash_tx_reference ON public.organization_cash_transactions(reference_id) WHERE reference_id IS NOT NULL;

-- RLS (conservative: org members can read; only service role can mutate)
ALTER TABLE public.organization_cash_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_cash_balances_select ON public.organization_cash_balances;
DROP POLICY IF EXISTS org_cash_balances_mutate_service_role ON public.organization_cash_balances;
DROP POLICY IF EXISTS org_cash_transactions_select ON public.organization_cash_transactions;
DROP POLICY IF EXISTS org_cash_transactions_mutate_service_role ON public.organization_cash_transactions;

DO $$
BEGIN
  -- Read access: active org members (organization_contributors) + service role
  IF to_regclass('public.organization_contributors') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY org_cash_balances_select ON public.organization_cash_balances
        FOR SELECT
        USING (
          (auth.jwt() ->> 'role') = 'service_role'
          OR EXISTS (
            SELECT 1
            FROM public.organization_contributors oc
            WHERE oc.organization_id = organization_cash_balances.organization_id
              AND oc.user_id = auth.uid()
              AND oc.status = 'active'
              AND oc.role IN ('owner','co_founder','board_member','manager','employee')
          )
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY org_cash_transactions_select ON public.organization_cash_transactions
        FOR SELECT
        USING (
          (auth.jwt() ->> 'role') = 'service_role'
          OR EXISTS (
            SELECT 1
            FROM public.organization_contributors oc
            WHERE oc.organization_id = organization_cash_transactions.organization_id
              AND oc.user_id = auth.uid()
              AND oc.status = 'active'
              AND oc.role IN ('owner','co_founder','board_member','manager','employee')
          )
        )
    $pol$;
  ELSE
    -- Fallback: service role only (if org contributor system isn't present)
    EXECUTE $pol$
      CREATE POLICY org_cash_balances_select ON public.organization_cash_balances
        FOR SELECT
        USING ((auth.jwt() ->> 'role') = 'service_role')
    $pol$;

    EXECUTE $pol$
      CREATE POLICY org_cash_transactions_select ON public.organization_cash_transactions
        FOR SELECT
        USING ((auth.jwt() ->> 'role') = 'service_role')
    $pol$;
  END IF;

  -- Mutations: service role only
  EXECUTE $pol$
    CREATE POLICY org_cash_balances_mutate_service_role ON public.organization_cash_balances
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role')
  $pol$;

  EXECUTE $pol$
    CREATE POLICY org_cash_transactions_mutate_service_role ON public.organization_cash_transactions
      FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role')
  $pol$;
END
$$;

-- =====================================================
-- 2) CASH TRANSFER PRIMITIVES (SYSTEM-SETTLED CONTRACTS)
-- =====================================================

-- Generalized user->user transfer (supports service role initiating transfers on behalf of a user)
CREATE OR REPLACE FUNCTION public.transfer_cash_between_users(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT DEFAULT 'transfer',
  p_reference_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  outgoing_cash_transaction_id UUID,
  incoming_cash_transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_available BIGINT;
BEGIN
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF auth.uid() IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_role <> 'service_role' AND auth.uid() <> p_from_user_id THEN
    RAISE EXCEPTION 'Not authorized to transfer from this user';
  END IF;

  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing from/to user';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Cannot transfer to self';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF to_regclass('public.user_cash_balances') IS NULL THEN
    RAISE EXCEPTION 'Cash balance system not available on this deployment';
  END IF;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_from_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_to_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock payer row and verify funds
  SELECT available_cents INTO v_available
  FROM public.user_cash_balances
  WHERE user_id = p_from_user_id
  FOR UPDATE;

  IF COALESCE(v_available, 0) < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  -- Deduct from payer
  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_from_user_id;

  -- Credit recipient
  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents + p_amount_cents,
    available_cents = available_cents + p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_to_user_id;

  -- Record both sides
  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    p_from_user_id,
    -p_amount_cents,
    p_transaction_type,
    p_reference_id,
    p_metadata || jsonb_build_object('direction','out','to_user_id',p_to_user_id,'from_user_id',p_from_user_id),
    NOW()
  )
  RETURNING id INTO outgoing_cash_transaction_id;

  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    p_to_user_id,
    p_amount_cents,
    p_transaction_type,
    p_reference_id,
    p_metadata || jsonb_build_object('direction','in','to_user_id',p_to_user_id,'from_user_id',p_from_user_id),
    NOW()
  )
  RETURNING id INTO incoming_cash_transaction_id;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_cash_between_users(UUID, UUID, BIGINT, TEXT, UUID, JSONB) TO authenticated;

-- Internal/system transfer used by settlement triggers (NOT exposed to clients)
CREATE OR REPLACE FUNCTION public.system_transfer_cash_between_users(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT,
  p_reference_id UUID,
  p_metadata JSONB
)
RETURNS TABLE (
  outgoing_cash_transaction_id UUID,
  incoming_cash_transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available BIGINT;
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing from/to user';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Cannot transfer to self';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF to_regclass('public.user_cash_balances') IS NULL THEN
    RAISE EXCEPTION 'Cash balance system not available on this deployment';
  END IF;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_from_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_to_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock payer row and verify funds
  SELECT available_cents INTO v_available
  FROM public.user_cash_balances
  WHERE user_id = p_from_user_id
  FOR UPDATE;

  IF COALESCE(v_available, 0) < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_from_user_id;

  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents + p_amount_cents,
    available_cents = available_cents + p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_to_user_id;

  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    p_from_user_id,
    -p_amount_cents,
    COALESCE(NULLIF(btrim(p_transaction_type), ''), 'transfer'),
    p_reference_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('direction','out','to_user_id',p_to_user_id,'from_user_id',p_from_user_id),
    NOW()
  )
  RETURNING id INTO outgoing_cash_transaction_id;

  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    p_to_user_id,
    p_amount_cents,
    COALESCE(NULLIF(btrim(p_transaction_type), ''), 'transfer'),
    p_reference_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('direction','in','to_user_id',p_to_user_id,'from_user_id',p_from_user_id),
    NOW()
  )
  RETURNING id INTO incoming_cash_transaction_id;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.system_transfer_cash_between_users(UUID, UUID, BIGINT, TEXT, UUID, JSONB) FROM PUBLIC;

-- User -> Organization transfer (funding org wallet)
CREATE OR REPLACE FUNCTION public.transfer_cash_user_to_organization(
  p_organization_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT DEFAULT 'org_transfer',
  p_reference_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  user_cash_transaction_id UUID,
  organization_cash_transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_available BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Missing organization';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF to_regclass('public.user_cash_balances') IS NULL THEN
    RAISE EXCEPTION 'Cash balance system not available on this deployment';
  END IF;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (v_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.organization_cash_balances (organization_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_organization_id, 0, 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  -- Lock payer row and verify funds
  SELECT available_cents INTO v_available
  FROM public.user_cash_balances
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF COALESCE(v_available, 0) < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE user_id = v_user_id;

  UPDATE public.organization_cash_balances
  SET
    balance_cents = balance_cents + p_amount_cents,
    available_cents = available_cents + p_amount_cents,
    updated_at = NOW()
  WHERE organization_id = p_organization_id;

  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    v_user_id,
    -p_amount_cents,
    p_transaction_type,
    p_reference_id,
    p_metadata || jsonb_build_object('direction','out','organization_id',p_organization_id),
    NOW()
  )
  RETURNING id INTO user_cash_transaction_id;

  INSERT INTO public.organization_cash_transactions (
    organization_id,
    amount_cents,
    transaction_type,
    reference_id,
    counterparty_user_id,
    metadata,
    completed_at
  )
  VALUES (
    p_organization_id,
    p_amount_cents,
    p_transaction_type,
    p_reference_id,
    v_user_id,
    p_metadata || jsonb_build_object('direction','in','from_user_id',v_user_id),
    NOW()
  )
  RETURNING id INTO organization_cash_transaction_id;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_cash_user_to_organization(UUID, BIGINT, TEXT, UUID, JSONB) TO authenticated;

-- Organization -> User transfer (payouts, refunds)
CREATE OR REPLACE FUNCTION public.transfer_cash_organization_to_user(
  p_organization_id UUID,
  p_to_user_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT DEFAULT 'org_transfer',
  p_reference_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  organization_cash_transaction_id UUID,
  user_cash_transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_available BIGINT;
BEGIN
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF auth.uid() IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Only service role can transfer from an organization wallet';
  END IF;

  IF p_organization_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing organization or recipient';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  INSERT INTO public.organization_cash_balances (organization_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_organization_id, 0, 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_to_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock org row and verify funds
  SELECT available_cents INTO v_available
  FROM public.organization_cash_balances
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF COALESCE(v_available, 0) < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient organization funds';
  END IF;

  UPDATE public.organization_cash_balances
  SET
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE organization_id = p_organization_id;

  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents + p_amount_cents,
    available_cents = available_cents + p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_to_user_id;

  INSERT INTO public.organization_cash_transactions (
    organization_id,
    amount_cents,
    transaction_type,
    reference_id,
    counterparty_user_id,
    metadata,
    completed_at
  )
  VALUES (
    p_organization_id,
    -p_amount_cents,
    p_transaction_type,
    p_reference_id,
    p_to_user_id,
    p_metadata || jsonb_build_object('direction','out','to_user_id',p_to_user_id),
    NOW()
  )
  RETURNING id INTO organization_cash_transaction_id;

  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    p_to_user_id,
    p_amount_cents,
    p_transaction_type,
    p_reference_id,
    p_metadata || jsonb_build_object('direction','in','organization_id',p_organization_id),
    NOW()
  )
  RETURNING id INTO user_cash_transaction_id;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_cash_organization_to_user(UUID, UUID, BIGINT, TEXT, UUID, JSONB) TO authenticated;

-- Internal/system org->user transfer used by settlement triggers (NOT exposed to clients)
CREATE OR REPLACE FUNCTION public.system_transfer_cash_organization_to_user(
  p_organization_id UUID,
  p_to_user_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT,
  p_reference_id UUID,
  p_metadata JSONB
)
RETURNS TABLE (
  organization_cash_transaction_id UUID,
  user_cash_transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available BIGINT;
BEGIN
  IF p_organization_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing organization or recipient';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  INSERT INTO public.organization_cash_balances (organization_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_organization_id, 0, 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_to_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock org row and verify funds
  SELECT available_cents INTO v_available
  FROM public.organization_cash_balances
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF COALESCE(v_available, 0) < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient organization funds';
  END IF;

  UPDATE public.organization_cash_balances
  SET
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE organization_id = p_organization_id;

  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents + p_amount_cents,
    available_cents = available_cents + p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_to_user_id;

  INSERT INTO public.organization_cash_transactions (
    organization_id,
    amount_cents,
    transaction_type,
    reference_id,
    counterparty_user_id,
    metadata,
    completed_at
  )
  VALUES (
    p_organization_id,
    -p_amount_cents,
    COALESCE(NULLIF(btrim(p_transaction_type), ''), 'org_transfer'),
    p_reference_id,
    p_to_user_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('direction','out','to_user_id',p_to_user_id),
    NOW()
  )
  RETURNING id INTO organization_cash_transaction_id;

  INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
  VALUES (
    p_to_user_id,
    p_amount_cents,
    COALESCE(NULLIF(btrim(p_transaction_type), ''), 'org_transfer'),
    p_reference_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('direction','in','organization_id',p_organization_id),
    NOW()
  )
  RETURNING id INTO user_cash_transaction_id;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.system_transfer_cash_organization_to_user(UUID, UUID, BIGINT, TEXT, UUID, JSONB) FROM PUBLIC;

-- =====================================================
-- 3) CASHFLOW DEALS (ADVANCE + REVENUE SHARE)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.cashflow_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_type TEXT NOT NULL CHECK (deal_type IN ('advance', 'revenue_share')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'organization')),
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_organization_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','cancelled')),
  is_public BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 100,
  currency TEXT NOT NULL DEFAULT 'USD',
  -- Total percent of receipts allocated to investors for this deal (bps = basis points)
  rate_bps INTEGER NOT NULL CHECK (rate_bps > 0 AND rate_bps <= 10000),
  -- For advances (and optionally revenue share): total payout cap multiple relative to principal (bps; 13000 = 1.30x)
  cap_multiple_bps INTEGER,
  start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  term_end_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cashflow_deals_subject_check CHECK (
    (subject_type = 'user' AND subject_user_id IS NOT NULL AND subject_organization_id IS NULL)
    OR
    (subject_type = 'organization' AND subject_user_id IS NULL AND subject_organization_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cashflow_deals_subject_user ON public.cashflow_deals(subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_deals_subject_org ON public.cashflow_deals(subject_organization_id) WHERE subject_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_deals_status ON public.cashflow_deals(status);
CREATE INDEX IF NOT EXISTS idx_cashflow_deals_public ON public.cashflow_deals(is_public) WHERE is_public = true;

CREATE TABLE IF NOT EXISTS public.cashflow_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.cashflow_deals(id) ON DELETE CASCADE,
  claimant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invested_cents BIGINT NOT NULL CHECK (invested_cents > 0),
  cap_cents BIGINT,
  accrued_cents BIGINT NOT NULL DEFAULT 0 CHECK (accrued_cents >= 0),
  paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cashflow_claim_cap_positive CHECK (cap_cents IS NULL OR cap_cents > 0),
  CONSTRAINT cashflow_claim_accrued_le_cap CHECK (cap_cents IS NULL OR accrued_cents <= cap_cents),
  CONSTRAINT cashflow_claim_paid_le_accrued CHECK (paid_cents <= accrued_cents),
  UNIQUE (deal_id, claimant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cashflow_claims_deal ON public.cashflow_claims(deal_id);
CREATE INDEX IF NOT EXISTS idx_cashflow_claims_claimant ON public.cashflow_claims(claimant_user_id);
CREATE INDEX IF NOT EXISTS idx_cashflow_claims_status ON public.cashflow_claims(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.cashflow_claim_fundings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.cashflow_claims(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  transfer_reference_id UUID NOT NULL,
  user_cash_transaction_id UUID REFERENCES public.cash_transactions(id) ON DELETE SET NULL,
  organization_cash_transaction_id UUID REFERENCES public.organization_cash_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_reference_id)
);

CREATE INDEX IF NOT EXISTS idx_cashflow_claim_fundings_claim ON public.cashflow_claim_fundings(claim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashflow_claim_fundings_investor ON public.cashflow_claim_fundings(investor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cashflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_organization_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  source_type TEXT NOT NULL,
  source_ref TEXT,
  source_cash_transaction_id UUID REFERENCES public.cash_transactions(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  CONSTRAINT cashflow_events_subject_check CHECK (
    (subject_type = 'user' AND subject_user_id IS NOT NULL AND subject_organization_id IS NULL)
    OR
    (subject_type = 'organization' AND subject_user_id IS NULL AND subject_organization_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cashflow_events_subject_user ON public.cashflow_events(subject_user_id, occurred_at DESC) WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_events_subject_org ON public.cashflow_events(subject_organization_id, occurred_at DESC) WHERE subject_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_events_occurred ON public.cashflow_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashflow_events_processed ON public.cashflow_events(processed_at) WHERE processed_at IS NULL;

-- Idempotency: prevent duplicate events for the same underlying cash transaction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ux_cashflow_events_source_cash_tx'
  ) THEN
    CREATE UNIQUE INDEX ux_cashflow_events_source_cash_tx
      ON public.cashflow_events(source_type, source_cash_transaction_id)
      WHERE source_cash_transaction_id IS NOT NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.cashflow_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.cashflow_events(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES public.cashflow_claims(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_organization_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  payee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_cents BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partially_paid','paid','cancelled')),
  transfer_reference_id UUID,
  user_cash_transaction_id UUID REFERENCES public.cash_transactions(id) ON DELETE SET NULL,
  organization_cash_transaction_id UUID REFERENCES public.organization_cash_transactions(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cashflow_payout_subject_check CHECK (
    (subject_type = 'user' AND subject_user_id IS NOT NULL AND subject_organization_id IS NULL)
    OR
    (subject_type = 'organization' AND subject_user_id IS NULL AND subject_organization_id IS NOT NULL)
  ),
  CONSTRAINT cashflow_payout_paid_le_amount CHECK (paid_cents <= amount_cents),
  UNIQUE(event_id, claim_id)
);

CREATE INDEX IF NOT EXISTS idx_cashflow_payouts_event ON public.cashflow_payouts(event_id);
CREATE INDEX IF NOT EXISTS idx_cashflow_payouts_payee ON public.cashflow_payouts(payee_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashflow_payouts_subject_user ON public.cashflow_payouts(subject_user_id, created_at DESC) WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_payouts_subject_org ON public.cashflow_payouts(subject_organization_id, created_at DESC) WHERE subject_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashflow_payouts_status ON public.cashflow_payouts(status) WHERE status IN ('pending','partially_paid');

-- =====================================================
-- 4) RLS FOR CASHFLOW SYSTEM
-- =====================================================

ALTER TABLE public.cashflow_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_claim_fundings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_payouts ENABLE ROW LEVEL SECURITY;

-- Deals: public read when is_public + active; subject can always read; investors can read deals they invested in
DROP POLICY IF EXISTS cashflow_deals_select ON public.cashflow_deals;
CREATE POLICY cashflow_deals_select ON public.cashflow_deals
  FOR SELECT USING (
    (is_public = true AND status = 'active')
    OR (subject_type = 'user' AND subject_user_id = auth.uid())
    OR (subject_type = 'organization' AND EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = cashflow_deals.subject_organization_id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner','co_founder','board_member','manager','employee')
    ))
    OR EXISTS (
      SELECT 1 FROM public.cashflow_claims c
      WHERE c.deal_id = cashflow_deals.id
        AND c.claimant_user_id = auth.uid()
    )
    OR ((auth.jwt() ->> 'role') = 'service_role')
  );

DROP POLICY IF EXISTS cashflow_deals_mutate_subject ON public.cashflow_deals;
CREATE POLICY cashflow_deals_mutate_subject ON public.cashflow_deals
  FOR ALL USING (
    (subject_type = 'user' AND subject_user_id = auth.uid())
    OR (subject_type = 'organization' AND EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = cashflow_deals.subject_organization_id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner','co_founder','board_member','manager')
    ))
    OR ((auth.jwt() ->> 'role') = 'service_role')
  )
  WITH CHECK (
    (subject_type = 'user' AND subject_user_id = auth.uid())
    OR (subject_type = 'organization' AND EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = cashflow_deals.subject_organization_id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner','co_founder','board_member','manager')
    ))
    OR ((auth.jwt() ->> 'role') = 'service_role')
  );

-- Claims: claimant and subject can read; only service role mutates directly (fund via RPC)
DROP POLICY IF EXISTS cashflow_claims_select ON public.cashflow_claims;
CREATE POLICY cashflow_claims_select ON public.cashflow_claims
  FOR SELECT USING (
    claimant_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.cashflow_deals d
      WHERE d.id = cashflow_claims.deal_id
        AND (
          (d.subject_type = 'user' AND d.subject_user_id = auth.uid())
          OR (d.subject_type = 'organization' AND EXISTS (
            SELECT 1 FROM public.organization_contributors oc
            WHERE oc.organization_id = d.subject_organization_id
              AND oc.user_id = auth.uid()
              AND oc.status = 'active'
              AND oc.role IN ('owner','co_founder','board_member','manager','employee')
          ))
        )
    )
    OR ((auth.jwt() ->> 'role') = 'service_role')
  );

DROP POLICY IF EXISTS cashflow_claims_mutate_service_role ON public.cashflow_claims;
CREATE POLICY cashflow_claims_mutate_service_role ON public.cashflow_claims
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Fundings: claimant can read their own funding rows; subject can read; service role can manage
DROP POLICY IF EXISTS cashflow_claim_fundings_select ON public.cashflow_claim_fundings;
CREATE POLICY cashflow_claim_fundings_select ON public.cashflow_claim_fundings
  FOR SELECT USING (
    investor_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.cashflow_claims c
      JOIN public.cashflow_deals d ON d.id = c.deal_id
      WHERE c.id = cashflow_claim_fundings.claim_id
        AND (
          (d.subject_type = 'user' AND d.subject_user_id = auth.uid())
          OR (d.subject_type = 'organization' AND EXISTS (
            SELECT 1 FROM public.organization_contributors oc
            WHERE oc.organization_id = d.subject_organization_id
              AND oc.user_id = auth.uid()
              AND oc.status = 'active'
              AND oc.role IN ('owner','co_founder','board_member','manager','employee')
          ))
        )
    )
    OR ((auth.jwt() ->> 'role') = 'service_role')
  );

DROP POLICY IF EXISTS cashflow_claim_fundings_mutate_service_role ON public.cashflow_claim_fundings;
CREATE POLICY cashflow_claim_fundings_mutate_service_role ON public.cashflow_claim_fundings
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Events/payouts: subject and claimants can read; service role can write.
DROP POLICY IF EXISTS cashflow_events_select ON public.cashflow_events;
CREATE POLICY cashflow_events_select ON public.cashflow_events
  FOR SELECT USING (
    (subject_type = 'user' AND subject_user_id = auth.uid())
    OR (subject_type = 'organization' AND EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = cashflow_events.subject_organization_id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner','co_founder','board_member','manager','employee')
    ))
    OR EXISTS (
      SELECT 1
      FROM public.cashflow_payouts p
      WHERE p.event_id = cashflow_events.id
        AND p.payee_user_id = auth.uid()
    )
    OR ((auth.jwt() ->> 'role') = 'service_role')
  );

DROP POLICY IF EXISTS cashflow_events_mutate_service_role ON public.cashflow_events;
CREATE POLICY cashflow_events_mutate_service_role ON public.cashflow_events
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS cashflow_payouts_select ON public.cashflow_payouts;
CREATE POLICY cashflow_payouts_select ON public.cashflow_payouts
  FOR SELECT USING (
    payee_user_id = auth.uid()
    OR (subject_type = 'user' AND subject_user_id = auth.uid())
    OR (subject_type = 'organization' AND EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = cashflow_payouts.subject_organization_id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner','co_founder','board_member','manager','employee')
    ))
    OR ((auth.jwt() ->> 'role') = 'service_role')
  );

DROP POLICY IF EXISTS cashflow_payouts_mutate_service_role ON public.cashflow_payouts;
CREATE POLICY cashflow_payouts_mutate_service_role ON public.cashflow_payouts
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- =====================================================
-- 5) RPCs: CREATE DEAL, FUND, RECORD EVENTS, PROCESS PAYOUTS
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_cashflow_deal(
  p_deal_type TEXT,
  p_subject_type TEXT,
  p_subject_id UUID,
  p_title TEXT,
  p_rate_bps INTEGER,
  p_cap_multiple_bps INTEGER DEFAULT NULL,
  p_term_end_at TIMESTAMPTZ DEFAULT NULL,
  p_is_public BOOLEAN DEFAULT true,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_deal_id UUID;
  v_subject_user_id UUID;
  v_subject_org_id UUID;
BEGIN
  v_user_id := auth.uid();
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF v_user_id IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_deal_type NOT IN ('advance','revenue_share') THEN
    RAISE EXCEPTION 'Invalid deal type';
  END IF;

  IF p_subject_type NOT IN ('user','organization') THEN
    RAISE EXCEPTION 'Invalid subject type';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'Missing subject id';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Missing title';
  END IF;

  IF p_rate_bps IS NULL OR p_rate_bps <= 0 OR p_rate_bps > 10000 THEN
    RAISE EXCEPTION 'Invalid rate_bps';
  END IF;

  -- Advance requires a cap multiple
  IF p_deal_type = 'advance' AND (p_cap_multiple_bps IS NULL OR p_cap_multiple_bps < 10000) THEN
    RAISE EXCEPTION 'Advance requires cap_multiple_bps (>= 10000)';
  END IF;

  IF p_subject_type = 'user' THEN
    v_subject_user_id := p_subject_id;
    v_subject_org_id := NULL;

    IF v_role <> 'service_role' AND v_subject_user_id <> v_user_id THEN
      RAISE EXCEPTION 'Not authorized to create a deal for this user';
    END IF;
  ELSE
    v_subject_user_id := NULL;
    v_subject_org_id := p_subject_id;

    IF v_role <> 'service_role' THEN
      IF to_regclass('public.organization_contributors') IS NULL THEN
        RAISE EXCEPTION 'Organization contributor system not available';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.organization_contributors oc
        WHERE oc.organization_id = v_subject_org_id
          AND oc.user_id = v_user_id
          AND oc.status = 'active'
          AND oc.role IN ('owner','co_founder','board_member','manager')
      ) THEN
        RAISE EXCEPTION 'Not authorized to create a deal for this organization';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.cashflow_deals (
    deal_type,
    subject_type,
    subject_user_id,
    subject_organization_id,
    title,
    status,
    is_public,
    rate_bps,
    cap_multiple_bps,
    term_end_at,
    metadata,
    created_by
  )
  VALUES (
    p_deal_type,
    p_subject_type,
    v_subject_user_id,
    v_subject_org_id,
    p_title,
    'active',
    COALESCE(p_is_public, true),
    p_rate_bps,
    p_cap_multiple_bps,
    p_term_end_at,
    COALESCE(p_metadata, '{}'::jsonb),
    v_user_id
  )
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_cashflow_deal(TEXT, TEXT, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, BOOLEAN, JSONB) TO authenticated;

-- Fund a deal: transfer principal to subject wallet, upsert claim, record funding row
CREATE OR REPLACE FUNCTION public.fund_cashflow_deal(
  p_deal_id UUID,
  p_amount_cents BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_deal RECORD;
  v_claim_id UUID;
  v_transfer_ref UUID;
  v_user_tx UUID;
  v_incoming_user_tx UUID;
  v_org_tx UUID;
  v_new_invested BIGINT;
  v_new_cap BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_deal_id IS NULL THEN
    RAISE EXCEPTION 'Missing deal id';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_deal
  FROM public.cashflow_deals
  WHERE id = p_deal_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found or not active';
  END IF;

  v_transfer_ref := gen_random_uuid();

  -- Transfer principal to subject
  IF v_deal.subject_type = 'user' THEN
    SELECT t.outgoing_cash_transaction_id, t.incoming_cash_transaction_id
      INTO v_user_tx, v_incoming_user_tx
    FROM public.transfer_cash_between_users(
      v_user_id,
      v_deal.subject_user_id,
      p_amount_cents,
      'deal_funding',
      v_transfer_ref,
      jsonb_build_object(
        'product','cashflow_deal',
        'deal_id', v_deal.id,
        'deal_type', v_deal.deal_type,
        'subject_type', v_deal.subject_type,
        'subject_user_id', v_deal.subject_user_id
      )
    ) t;
  ELSE
    SELECT t.user_cash_transaction_id, t.organization_cash_transaction_id
      INTO v_user_tx, v_org_tx
    FROM public.transfer_cash_user_to_organization(
      v_deal.subject_organization_id,
      p_amount_cents,
      'deal_funding',
      v_transfer_ref,
      jsonb_build_object(
        'product','cashflow_deal',
        'deal_id', v_deal.id,
        'deal_type', v_deal.deal_type,
        'subject_type', v_deal.subject_type,
        'subject_organization_id', v_deal.subject_organization_id
      )
    ) t;
  END IF;

  -- Upsert claim
  INSERT INTO public.cashflow_claims (deal_id, claimant_user_id, invested_cents, cap_cents, accrued_cents, paid_cents, status)
  VALUES (v_deal.id, v_user_id, p_amount_cents, NULL, 0, 0, 'active')
  ON CONFLICT (deal_id, claimant_user_id)
  DO UPDATE SET
    invested_cents = public.cashflow_claims.invested_cents + EXCLUDED.invested_cents,
    status = 'active',
    updated_at = NOW()
  RETURNING id, invested_cents INTO v_claim_id, v_new_invested;

  -- Recompute cap when cap_multiple is provided
  IF v_deal.cap_multiple_bps IS NOT NULL THEN
    v_new_cap := FLOOR((v_new_invested::numeric * v_deal.cap_multiple_bps::numeric) / 10000.0)::bigint;
    UPDATE public.cashflow_claims
    SET cap_cents = v_new_cap, updated_at = NOW()
    WHERE id = v_claim_id;
  END IF;

  -- Record funding
  INSERT INTO public.cashflow_claim_fundings (
    claim_id,
    investor_id,
    amount_cents,
    transfer_reference_id,
    user_cash_transaction_id,
    organization_cash_transaction_id
  )
  VALUES (
    v_claim_id,
    v_user_id,
    p_amount_cents,
    v_transfer_ref,
    v_user_tx,
    v_org_tx
  );

  RETURN v_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fund_cashflow_deal(UUID, BIGINT) TO authenticated;

-- Record a cashflow event (subject or service role, plus strict allowance for stream-tip derived events)
CREATE OR REPLACE FUNCTION public.record_cashflow_event(
  p_subject_type TEXT,
  p_subject_id UUID,
  p_amount_cents BIGINT,
  p_source_type TEXT,
  p_source_ref TEXT DEFAULT NULL,
  p_source_cash_transaction_id UUID DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_event_id UUID;
  v_subject_user_id UUID;
  v_subject_org_id UUID;
  v_cash_tx RECORD;
BEGIN
  v_user_id := auth.uid();
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF v_user_id IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_subject_type NOT IN ('user','organization') THEN
    RAISE EXCEPTION 'Invalid subject type';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'Missing subject id';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_source_type IS NULL OR btrim(p_source_type) = '' THEN
    RAISE EXCEPTION 'Missing source_type';
  END IF;

  IF p_subject_type = 'user' THEN
    v_subject_user_id := p_subject_id;
    v_subject_org_id := NULL;
  ELSE
    v_subject_user_id := NULL;
    v_subject_org_id := p_subject_id;
  END IF;

  -- Authorization:
  -- - service_role can record any event
  -- - subject can record own events
  -- - org members (owner/manager/etc) can record org events
  -- - special-case: allow payer to record stream-tip cashflow event by referencing the incoming cash_transactions row
  IF v_role <> 'service_role' THEN
    IF p_subject_type = 'user' AND v_subject_user_id = v_user_id THEN
      NULL;
    ELSIF p_subject_type = 'organization' THEN
      IF to_regclass('public.organization_contributors') IS NULL THEN
        RAISE EXCEPTION 'Organization contributor system not available';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.organization_contributors oc
        WHERE oc.organization_id = v_subject_org_id
          AND oc.user_id = v_user_id
          AND oc.status = 'active'
          AND oc.role IN ('owner','co_founder','board_member','manager','employee')
      ) THEN
        RAISE EXCEPTION 'Not authorized to record event for this organization';
      END IF;
    ELSIF p_source_cash_transaction_id IS NOT NULL THEN
      -- Validate stream-tip derived cashflow: payer can create event for recipient.
      SELECT *
        INTO v_cash_tx
      FROM public.cash_transactions
      WHERE id = p_source_cash_transaction_id;

      IF v_cash_tx.id IS NULL THEN
        RAISE EXCEPTION 'cash_transactions not found for source_cash_transaction_id';
      END IF;

      IF COALESCE(v_cash_tx.amount_cents, 0) <> p_amount_cents THEN
        RAISE EXCEPTION 'Amount mismatch';
      END IF;

      IF COALESCE(v_cash_tx.transaction_type, '') <> 'tip' THEN
        RAISE EXCEPTION 'Only tip-derived events allowed for non-subject';
      END IF;

      IF COALESCE(v_cash_tx.metadata->>'product','') <> 'stream_tip' THEN
        RAISE EXCEPTION 'Only stream_tip events allowed for non-subject';
      END IF;

      IF COALESCE(v_cash_tx.metadata->>'direction','') <> 'in' THEN
        RAISE EXCEPTION 'Only incoming tip transaction can create cashflow event';
      END IF;

      IF p_subject_type <> 'user' OR v_subject_user_id <> v_cash_tx.user_id THEN
        RAISE EXCEPTION 'Subject must match tip recipient';
      END IF;

      IF COALESCE(v_cash_tx.metadata->>'from_user_id','') <> v_user_id::text THEN
        RAISE EXCEPTION 'Only the payer can record this event';
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorized to record this cashflow event';
    END IF;
  END IF;

  INSERT INTO public.cashflow_events (
    subject_type,
    subject_user_id,
    subject_organization_id,
    amount_cents,
    currency,
    source_type,
    source_ref,
    source_cash_transaction_id,
    occurred_at,
    metadata,
    created_by
  )
  VALUES (
    p_subject_type,
    v_subject_user_id,
    v_subject_org_id,
    p_amount_cents,
    'USD',
    p_source_type,
    p_source_ref,
    p_source_cash_transaction_id,
    COALESCE(p_occurred_at, NOW()),
    COALESCE(p_metadata, '{}'::jsonb),
    v_user_id
  )
  ON CONFLICT (source_type, source_cash_transaction_id) WHERE source_cash_transaction_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_event_id;

  -- If we hit a conflict, return the existing event id
  IF v_event_id IS NULL AND p_source_cash_transaction_id IS NOT NULL THEN
    SELECT id INTO v_event_id
    FROM public.cashflow_events
    WHERE source_type = p_source_type
      AND source_cash_transaction_id = p_source_cash_transaction_id;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cashflow_event(TEXT, UUID, BIGINT, TEXT, TEXT, UUID, TIMESTAMPTZ, JSONB) TO authenticated;

-- Settle a single payout (attempts to transfer as much as possible)
CREATE OR REPLACE FUNCTION public.settle_cashflow_payout(p_payout_id UUID)
RETURNS TABLE (
  payout_id UUID,
  status TEXT,
  paid_cents BIGINT,
  remaining_cents BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_payout RECORD;
  v_available BIGINT;
  v_to_pay BIGINT;
  v_transfer_ref UUID;
  v_user_out UUID;
  v_user_in UUID;
  v_org_tx UUID;
  v_user_tx UUID;
BEGIN
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF auth.uid() IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_payout_id IS NULL THEN
    RAISE EXCEPTION 'Missing payout id';
  END IF;

  SELECT *
    INTO v_payout
  FROM public.cashflow_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF v_payout.id IS NULL THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status IN ('paid','cancelled') THEN
    payout_id := v_payout.id;
    status := v_payout.status;
    paid_cents := v_payout.paid_cents;
    remaining_cents := GREATEST(0, v_payout.amount_cents - v_payout.paid_cents);
    RETURN NEXT;
    RETURN;
  END IF;

  v_to_pay := GREATEST(0, v_payout.amount_cents - v_payout.paid_cents);
  IF v_to_pay <= 0 THEN
    UPDATE public.cashflow_payouts
    SET status = 'paid', updated_at = NOW()
    WHERE id = v_payout.id;

    payout_id := v_payout.id;
    status := 'paid';
    paid_cents := v_payout.amount_cents;
    remaining_cents := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  v_transfer_ref := COALESCE(v_payout.transfer_reference_id, gen_random_uuid());

  IF v_payout.subject_type = 'user' THEN
    -- Check available cash for subject user
    INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
    VALUES (v_payout.subject_user_id, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT available_cents INTO v_available
    FROM public.user_cash_balances
    WHERE user_id = v_payout.subject_user_id
    FOR UPDATE;

    v_to_pay := LEAST(v_to_pay, COALESCE(v_available, 0));
    IF v_to_pay > 0 THEN
      SELECT t.outgoing_cash_transaction_id, t.incoming_cash_transaction_id
        INTO v_user_out, v_user_in
      FROM public.system_transfer_cash_between_users(
        v_payout.subject_user_id,
        v_payout.payee_user_id,
        v_to_pay,
        'cashflow_payout',
        v_transfer_ref,
        jsonb_build_object(
          'product','cashflow_payout',
          'payout_id', v_payout.id,
          'event_id', v_payout.event_id,
          'claim_id', v_payout.claim_id
        )
      ) t;

      UPDATE public.cashflow_payouts
      SET
        transfer_reference_id = v_transfer_ref,
        user_cash_transaction_id = v_user_in,
        paid_cents = paid_cents + v_to_pay,
        status = CASE WHEN (paid_cents + v_to_pay) >= amount_cents THEN 'paid' ELSE 'partially_paid' END,
        updated_at = NOW()
      WHERE id = v_payout.id;

      UPDATE public.cashflow_claims
      SET
        paid_cents = paid_cents + v_to_pay,
        updated_at = NOW()
      WHERE id = v_payout.claim_id;
    END IF;
  ELSE
    INSERT INTO public.organization_cash_balances (organization_id, balance_cents, available_cents, reserved_cents)
    VALUES (v_payout.subject_organization_id, 0, 0, 0)
    ON CONFLICT (organization_id) DO NOTHING;

    SELECT available_cents INTO v_available
    FROM public.organization_cash_balances
    WHERE organization_id = v_payout.subject_organization_id
    FOR UPDATE;

    v_to_pay := LEAST(v_to_pay, COALESCE(v_available, 0));
    IF v_to_pay > 0 THEN
      SELECT t.organization_cash_transaction_id, t.user_cash_transaction_id
        INTO v_org_tx, v_user_tx
      FROM public.system_transfer_cash_organization_to_user(
        v_payout.subject_organization_id,
        v_payout.payee_user_id,
        v_to_pay,
        'cashflow_payout',
        v_transfer_ref,
        jsonb_build_object(
          'product','cashflow_payout',
          'payout_id', v_payout.id,
          'event_id', v_payout.event_id,
          'claim_id', v_payout.claim_id
        )
      ) t;

      UPDATE public.cashflow_payouts
      SET
        transfer_reference_id = v_transfer_ref,
        user_cash_transaction_id = v_user_tx,
        organization_cash_transaction_id = v_org_tx,
        paid_cents = paid_cents + v_to_pay,
        status = CASE WHEN (paid_cents + v_to_pay) >= amount_cents THEN 'paid' ELSE 'partially_paid' END,
        updated_at = NOW()
      WHERE id = v_payout.id;

      UPDATE public.cashflow_claims
      SET
        paid_cents = paid_cents + v_to_pay,
        updated_at = NOW()
      WHERE id = v_payout.claim_id;
    END IF;
  END IF;

  SELECT * INTO v_payout FROM public.cashflow_payouts WHERE id = p_payout_id;

  payout_id := v_payout.id;
  status := v_payout.status;
  paid_cents := v_payout.paid_cents;
  remaining_cents := GREATEST(0, v_payout.amount_cents - v_payout.paid_cents);
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_cashflow_payout(UUID) TO authenticated;

-- Process a cashflow event into payouts (accrual) and attempt to settle immediately
CREATE OR REPLACE FUNCTION public.process_cashflow_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_event RECORD;
  v_deal RECORD;
  v_pool BIGINT;
  v_sum_due BIGINT;
  v_remainder BIGINT;
  v_top_claim_id UUID;
  v_claim RECORD;
  v_weight_total NUMERIC;
  v_claim_due BIGINT;
  v_claim_remaining BIGINT;
  v_payout_id UUID;
  v_extra BIGINT;
BEGIN
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF auth.uid() IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Missing event id';
  END IF;

  SELECT * INTO v_event
  FROM public.cashflow_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Cashflow event not found';
  END IF;

  IF v_event.processed_at IS NOT NULL THEN
    RETURN TRUE;
  END IF;

  BEGIN
    FOR v_deal IN
      SELECT *
      FROM public.cashflow_deals d
      WHERE d.status = 'active'
        AND d.subject_type = v_event.subject_type
        AND (
          (d.subject_type = 'user' AND d.subject_user_id = v_event.subject_user_id)
          OR
          (d.subject_type = 'organization' AND d.subject_organization_id = v_event.subject_organization_id)
        )
        AND v_event.occurred_at >= d.start_at
        AND (d.term_end_at IS NULL OR v_event.occurred_at <= d.term_end_at)
      ORDER BY d.priority ASC, d.created_at ASC
    LOOP
      v_pool := FLOOR((v_event.amount_cents::numeric * v_deal.rate_bps::numeric) / 10000.0)::bigint;
      IF v_pool IS NULL OR v_pool <= 0 THEN
        CONTINUE;
      END IF;

      v_sum_due := 0;
      v_top_claim_id := NULL;

      -- Compute total weight for allocation
      IF v_deal.deal_type = 'advance' THEN
        SELECT COALESCE(SUM(GREATEST(0, cap_cents - accrued_cents)), 0)
          INTO v_weight_total
        FROM public.cashflow_claims
        WHERE deal_id = v_deal.id
          AND status = 'active'
          AND cap_cents IS NOT NULL;
      ELSE
        SELECT COALESCE(SUM(invested_cents), 0)
          INTO v_weight_total
        FROM public.cashflow_claims
        WHERE deal_id = v_deal.id
          AND status = 'active';
      END IF;

      IF COALESCE(v_weight_total, 0) <= 0 THEN
        CONTINUE;
      END IF;

      FOR v_claim IN
        SELECT *
        FROM public.cashflow_claims
        WHERE deal_id = v_deal.id
          AND status = 'active'
        ORDER BY invested_cents DESC, created_at ASC
      LOOP
        IF v_top_claim_id IS NULL THEN
          v_top_claim_id := v_claim.id;
        END IF;

        -- remaining cap (NULL = uncapped)
        IF v_claim.cap_cents IS NULL THEN
          v_claim_remaining := NULL;
        ELSE
          v_claim_remaining := GREATEST(0, v_claim.cap_cents - v_claim.accrued_cents);
        END IF;

        IF v_deal.deal_type = 'advance' THEN
          -- advance uses remaining cap as weight; cap must exist
          IF v_claim_remaining IS NULL OR v_claim_remaining <= 0 THEN
            CONTINUE;
          END IF;
          v_claim_due := FLOOR((v_pool::numeric * v_claim_remaining::numeric) / v_weight_total)::bigint;
        ELSE
          v_claim_due := FLOOR((v_pool::numeric * v_claim.invested_cents::numeric) / v_weight_total)::bigint;
        END IF;

        IF v_claim_due <= 0 THEN
          CONTINUE;
        END IF;

        IF v_claim_remaining IS NOT NULL THEN
          v_claim_due := LEAST(v_claim_due, v_claim_remaining);
        END IF;

        IF v_claim_due <= 0 THEN
          CONTINUE;
        END IF;

        -- Create payout row (idempotent per event+claim) and accrue claim only when inserted
        INSERT INTO public.cashflow_payouts (
          event_id,
          claim_id,
          subject_type,
          subject_user_id,
          subject_organization_id,
          payee_user_id,
          amount_cents,
          paid_cents,
          status,
          metadata
        )
        VALUES (
          v_event.id,
          v_claim.id,
          v_event.subject_type,
          v_event.subject_user_id,
          v_event.subject_organization_id,
          v_claim.claimant_user_id,
          v_claim_due,
          0,
          'pending',
          jsonb_build_object(
            'deal_id', v_deal.id,
            'deal_type', v_deal.deal_type,
            'pool_cents', v_pool,
            'event_amount_cents', v_event.amount_cents
          )
        )
        ON CONFLICT (event_id, claim_id) DO NOTHING
        RETURNING id INTO v_payout_id;

        IF v_payout_id IS NOT NULL THEN
          UPDATE public.cashflow_claims
          SET accrued_cents = accrued_cents + v_claim_due,
              updated_at = NOW()
          WHERE id = v_claim.id;

          v_sum_due := v_sum_due + v_claim_due;

          -- Best-effort settle immediately
          PERFORM public.settle_cashflow_payout(v_payout_id);
        END IF;
      END LOOP;

      v_remainder := GREATEST(0, v_pool - v_sum_due);
      IF v_remainder > 0 AND v_top_claim_id IS NOT NULL THEN
        -- Add remainder to the largest claim (bounded by remaining cap)
        SELECT cap_cents, accrued_cents INTO v_claim
        FROM public.cashflow_claims
        WHERE id = v_top_claim_id
        FOR UPDATE;

        IF v_claim.cap_cents IS NULL THEN
          v_extra := v_remainder;
        ELSE
          v_extra := LEAST(v_remainder, GREATEST(0, v_claim.cap_cents - v_claim.accrued_cents));
        END IF;

        IF v_extra > 0 THEN
          INSERT INTO public.cashflow_payouts (
            event_id,
            claim_id,
            subject_type,
            subject_user_id,
            subject_organization_id,
            payee_user_id,
            amount_cents,
            paid_cents,
            status,
            metadata
          )
          SELECT
            v_event.id,
            c.id,
            v_event.subject_type,
            v_event.subject_user_id,
            v_event.subject_organization_id,
            c.claimant_user_id,
            v_extra,
            0,
            'pending',
            jsonb_build_object(
              'deal_id', v_deal.id,
              'deal_type', v_deal.deal_type,
              'pool_cents', v_pool,
              'event_amount_cents', v_event.amount_cents,
              'note', 'remainder_allocation'
            )
          FROM public.cashflow_claims c
          WHERE c.id = v_top_claim_id
          ON CONFLICT (event_id, claim_id)
          DO UPDATE SET
            amount_cents = public.cashflow_payouts.amount_cents + EXCLUDED.amount_cents,
            updated_at = NOW()
          RETURNING id INTO v_payout_id;

          UPDATE public.cashflow_claims
          SET accrued_cents = accrued_cents + v_extra,
              updated_at = NOW()
          WHERE id = v_top_claim_id;

          PERFORM public.settle_cashflow_payout(v_payout_id);
        END IF;
      END IF;
    END LOOP;

    UPDATE public.cashflow_events
    SET processed_at = NOW(),
        processing_error = NULL
    WHERE id = v_event.id;

    RETURN TRUE;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cashflow_events
    SET processed_at = NOW(),
        processing_error = SQLERRM
    WHERE id = v_event.id;
    RETURN FALSE;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_cashflow_event(UUID) TO authenticated;

-- Sweep pending payouts (useful when subject lacked funds at event time)
CREATE OR REPLACE FUNCTION public.process_pending_cashflow_payouts(p_limit INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_count INTEGER := 0;
  v_row RECORD;
BEGIN
  v_role := COALESCE(auth.jwt() ->> 'role', '');
  IF auth.uid() IS NULL AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_row IN
    SELECT id
    FROM public.cashflow_payouts
    WHERE status IN ('pending','partially_paid')
    ORDER BY created_at ASC
    LIMIT COALESCE(p_limit, 100)
  LOOP
    PERFORM public.settle_cashflow_payout(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_pending_cashflow_payouts(INTEGER) TO authenticated;

-- =====================================================
-- 6) TRIGGERS
-- =====================================================

-- Auto-process cashflow events
CREATE OR REPLACE FUNCTION public.trg_process_cashflow_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.process_cashflow_event(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cashflow_events_process ON public.cashflow_events;
CREATE TRIGGER trg_cashflow_events_process
  AFTER INSERT ON public.cashflow_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_process_cashflow_event();

-- Auto-create cashflow events from stream tips (incoming cash tx rows)
CREATE OR REPLACE FUNCTION public.trg_cash_transactions_stream_tip_to_cashflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Only incoming stream tips
  IF NEW.amount_cents > 0
     AND COALESCE(NEW.transaction_type, '') = 'tip'
     AND COALESCE(NEW.metadata->>'product','') = 'stream_tip'
     AND COALESCE(NEW.metadata->>'direction','') = 'in' THEN
    v_event_id := public.record_cashflow_event(
      'user',
      NEW.user_id,
      NEW.amount_cents,
      'stream_tip',
      NEW.id::text,
      NEW.id,
      NEW.completed_at,
      NEW.metadata
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_transactions_stream_tip_to_cashflow ON public.cash_transactions;
CREATE TRIGGER trg_cash_transactions_stream_tip_to_cashflow
  AFTER INSERT ON public.cash_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cash_transactions_stream_tip_to_cashflow();

COMMIT;

