-- =====================================================
-- INVOICE PAYMENTS -> ORG CASHFLOW EVENTS (AND ORG WALLET CREDIT)
-- =====================================================
-- Date: 2026-01-12
--
-- Purpose:
-- - When an invoice is paid (or partially paid), record an org cashflow event so
--   revenue-share / advance deals can sweep payouts.
-- - Credit the organization wallet by the paid delta so payouts can settle on-platform.
--
-- Source of truth:
-- - `generated_invoices.amount_paid` (decimal dollars) is treated as the receipt ledger.
--
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Only create trigger when both invoice system and cashflow system exist
DO $$
BEGIN
  IF to_regclass('public.generated_invoices') IS NULL THEN
    RAISE NOTICE 'Skipping invoice->cashflow trigger: generated_invoices table not found';
    RETURN;
  END IF;

  IF to_regclass('public.cashflow_events') IS NULL THEN
    RAISE NOTICE 'Skipping invoice->cashflow trigger: cashflow_events table not found';
    RETURN;
  END IF;

  IF to_regclass('public.organization_cash_balances') IS NULL THEN
    RAISE NOTICE 'Skipping invoice->cashflow trigger: organization_cash_balances table not found';
    RETURN;
  END IF;

  -- Ensure required columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_invoices' AND column_name = 'amount_paid'
  ) THEN
    RAISE NOTICE 'Skipping invoice->cashflow trigger: generated_invoices.amount_paid not found';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_invoices' AND column_name = 'business_id'
  ) THEN
    RAISE NOTICE 'Skipping invoice->cashflow trigger: generated_invoices.business_id not found';
    RETURN;
  END IF;
END
$$;

-- Trigger function: on amount_paid increase, emit cashflow event and credit org wallet
CREATE OR REPLACE FUNCTION public.trg_generated_invoices_paid_delta_to_cashflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_paid NUMERIC;
  v_new_paid NUMERIC;
  v_delta_usd NUMERIC;
  v_delta_cents BIGINT;
  v_org_id UUID;
  v_event_id UUID;
  v_org_cash_tx_id UUID;
BEGIN
  -- Only for invoices tied to an org
  v_org_id := NEW.business_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_old_paid := COALESCE(OLD.amount_paid, 0);
  v_new_paid := COALESCE(NEW.amount_paid, 0);

  IF v_new_paid <= v_old_paid THEN
    RETURN NEW;
  END IF;

  v_delta_usd := v_new_paid - v_old_paid;
  v_delta_cents := ROUND(v_delta_usd * 100.0)::bigint;

  IF v_delta_cents IS NULL OR v_delta_cents <= 0 THEN
    RETURN NEW;
  END IF;

  -- 1) Credit org wallet (treat as externally received revenue) BEFORE creating the cashflow event.
  -- This ensures the downstream cashflow sweep can immediately settle payouts using the credited funds.
  INSERT INTO public.organization_cash_balances (organization_id, balance_cents, available_cents, reserved_cents)
  VALUES (v_org_id, 0, 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_cash_balances
  SET
    balance_cents = balance_cents + v_delta_cents,
    available_cents = available_cents + v_delta_cents,
    updated_at = NOW()
  WHERE organization_id = v_org_id;

  -- Deposit transaction log row (if table exists)
  IF to_regclass('public.organization_cash_transactions') IS NOT NULL THEN
    INSERT INTO public.organization_cash_transactions (
      organization_id,
      amount_cents,
      transaction_type,
      status,
      reference_id,
      metadata,
      completed_at
    )
    VALUES (
      v_org_id,
      v_delta_cents,
      'invoice_payment',
      'completed',
      NEW.id,
      jsonb_build_object(
        'product', 'invoice_payment',
        'invoice_id', NEW.id
      ),
      NOW()
    )
    RETURNING id INTO v_org_cash_tx_id;
  END IF;

  -- 2) Record cashflow event (receipt)
  INSERT INTO public.cashflow_events (
    subject_type,
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
    'organization',
    v_org_id,
    v_delta_cents,
    'USD',
    'invoice_payment',
    NEW.id::text,
    NULL,
    NOW(),
    jsonb_build_object(
      'invoice_id', NEW.id,
      'delta_usd', v_delta_usd,
      'delta_cents', v_delta_cents,
      'organization_cash_transaction_id', v_org_cash_tx_id
    ),
    auth.uid()
  )
  RETURNING id INTO v_event_id;

  -- Backfill the deposit tx with the cashflow event id (best-effort)
  IF v_org_cash_tx_id IS NOT NULL THEN
    UPDATE public.organization_cash_transactions
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cashflow_event_id', v_event_id)
    WHERE id = v_org_cash_tx_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger (guarded)
DO $$
BEGIN
  IF to_regclass('public.generated_invoices') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.cashflow_events') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.organization_cash_balances') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_invoices' AND column_name = 'amount_paid'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_invoices' AND column_name = 'business_id'
  ) THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_generated_invoices_paid_delta_to_cashflow ON public.generated_invoices;
  CREATE TRIGGER trg_generated_invoices_paid_delta_to_cashflow
    AFTER UPDATE OF amount_paid ON public.generated_invoices
    FOR EACH ROW
    WHEN (NEW.amount_paid IS DISTINCT FROM OLD.amount_paid)
    EXECUTE FUNCTION public.trg_generated_invoices_paid_delta_to_cashflow();
END
$$;

COMMIT;

