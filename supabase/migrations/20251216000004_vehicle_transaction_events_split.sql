-- =====================================================
-- VEHICLE TRANSACTION EVENTS (HISTORY) - SPLIT FROM SALE FACILITATION
-- =====================================================
-- Problem:
--   `vehicle_transactions` is used in this repo for two incompatible concepts:
--   1) Sale facilitation + signing + shipping (Stripe + documents)
--   2) Historical purchase/sale transaction log (with proof + confidence)
--
-- This migration creates a dedicated history table:
--   public.vehicle_transaction_events
-- and updates the helper RPC public.log_vehicle_transaction() to write to it
-- using the *current* timeline_events schema (event_category/source_type).
--
-- Date: 2025-12-16

BEGIN;

-- ==========================
-- 1) TABLE: vehicle_transaction_events
-- ==========================

CREATE TABLE IF NOT EXISTS public.vehicle_transaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'purchase', 'sale', 'consignment_start', 'consignment_end',
    'trade_in', 'auction_bid', 'wholesale', 'retail'
  )),

  -- Amount is stored as USD whole dollars for now (matches existing UI expectations).
  -- If you want cents later, we can migrate to amount_cents BIGINT.
  amount_usd INTEGER NOT NULL CHECK (amount_usd > 0),
  currency TEXT NOT NULL DEFAULT 'USD',

  -- Confidence / fuzziness
  is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  is_approximate BOOLEAN NOT NULL DEFAULT FALSE,
  confidence_level INTEGER DEFAULT 50 CHECK (confidence_level >= 0 AND confidence_level <= 100),

  transaction_date DATE NOT NULL,

  -- Parties involved (best-effort)
  seller_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_name TEXT,
  buyer_name TEXT,

  -- Proof / documentation
  proof_type TEXT CHECK (proof_type IN (
    'bat_listing', 'invoice', 'title', 'bill_of_sale',
    'auction_results', 'verbal', 'estimate'
  )),
  proof_url TEXT,
  proof_document_id UUID,

  -- Who logged this event
  logged_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_as TEXT DEFAULT 'collaborator' CHECK (logged_as IN ('owner', 'collaborator', 'witness')),

  location TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_tx_events_vehicle ON public.vehicle_transaction_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_tx_events_type ON public.vehicle_transaction_events(transaction_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_tx_events_date ON public.vehicle_transaction_events(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_tx_events_logged_by ON public.vehicle_transaction_events(logged_by);

-- Best-effort FK to vehicle_documents if that table exists (keeps local bootstrap flexible)
DO $$
BEGIN
  IF to_regclass('public.vehicle_documents') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'vehicle_tx_events_proof_document_id_fkey'
        AND conrelid = 'public.vehicle_transaction_events'::regclass
    ) THEN
      ALTER TABLE public.vehicle_transaction_events
        ADD CONSTRAINT vehicle_tx_events_proof_document_id_fkey
        FOREIGN KEY (proof_document_id) REFERENCES public.vehicle_documents(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Best-effort updated_at trigger (repo has multiple variants)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_vehicle_tx_events_updated_at ON public.vehicle_transaction_events;
    CREATE TRIGGER trg_vehicle_tx_events_updated_at
      BEFORE UPDATE ON public.vehicle_transaction_events
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS trg_vehicle_tx_events_updated_at ON public.vehicle_transaction_events;
    CREATE TRIGGER trg_vehicle_tx_events_updated_at
      BEFORE UPDATE ON public.vehicle_transaction_events
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ==========================
-- 2) RLS + GRANTS
-- ==========================

ALTER TABLE public.vehicle_transaction_events ENABLE ROW LEVEL SECURITY;

-- Explicit grants (RLS still applies)
GRANT SELECT ON public.vehicle_transaction_events TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.vehicle_transaction_events TO authenticated;

DROP POLICY IF EXISTS vehicle_tx_events_select ON public.vehicle_transaction_events;
CREATE POLICY vehicle_tx_events_select
  ON public.vehicle_transaction_events
  FOR SELECT
  TO anon, authenticated
  USING (
    -- vehicle_can_view is safe for anon (returns true only for public vehicles)
    public.vehicle_can_view(vehicle_id, auth.uid())
  );

DROP POLICY IF EXISTS vehicle_tx_events_insert ON public.vehicle_transaction_events;
CREATE POLICY vehicle_tx_events_insert
  ON public.vehicle_transaction_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    logged_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1
        FROM public.vehicles v
        WHERE v.id = vehicle_id
          AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR v.uploaded_by = auth.uid()
          )
      )
      OR public.vehicle_user_has_access(vehicle_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS vehicle_tx_events_update ON public.vehicle_transaction_events;
CREATE POLICY vehicle_tx_events_update
  ON public.vehicle_transaction_events
  FOR UPDATE
  TO authenticated
  USING (logged_by = auth.uid())
  WITH CHECK (logged_by = auth.uid());

DROP POLICY IF EXISTS vehicle_tx_events_delete ON public.vehicle_transaction_events;
CREATE POLICY vehicle_tx_events_delete
  ON public.vehicle_transaction_events
  FOR DELETE
  TO authenticated
  USING (logged_by = auth.uid());

-- ==========================
-- 3) RPC: log_vehicle_transaction -> writes to vehicle_transaction_events
-- ==========================

CREATE OR REPLACE FUNCTION public.log_vehicle_transaction(
  p_vehicle_id UUID,
  p_transaction_type TEXT,
  p_amount_usd INTEGER,
  p_transaction_date DATE,
  p_logged_by UUID,
  p_is_estimate BOOLEAN DEFAULT FALSE,
  p_is_approximate BOOLEAN DEFAULT FALSE,
  p_proof_type TEXT DEFAULT NULL,
  p_proof_url TEXT DEFAULT NULL,
  p_buyer_name TEXT DEFAULT NULL,
  p_seller_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_actor UUID;
  v_category TEXT;
BEGIN
  -- Prefer authenticated user; allow service role to pass p_logged_by.
  v_actor := COALESCE(auth.uid(), p_logged_by);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF auth.uid() IS NOT NULL AND p_logged_by IS NOT NULL AND auth.uid() <> p_logged_by THEN
    RAISE EXCEPTION 'logged_by must match current user';
  END IF;

  IF p_vehicle_id IS NULL OR p_transaction_type IS NULL OR p_amount_usd IS NULL OR p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'vehicle_id, transaction_type, amount_usd, transaction_date are required';
  END IF;

  INSERT INTO public.vehicle_transaction_events (
    vehicle_id,
    transaction_type,
    amount_usd,
    transaction_date,
    is_estimate,
    is_approximate,
    proof_type,
    proof_url,
    buyer_name,
    seller_name,
    logged_by,
    logged_as,
    metadata
  )
  VALUES (
    p_vehicle_id,
    p_transaction_type,
    p_amount_usd,
    p_transaction_date,
    COALESCE(p_is_estimate, FALSE),
    COALESCE(p_is_approximate, FALSE),
    p_proof_type,
    p_proof_url,
    p_buyer_name,
    p_seller_name,
    v_actor,
    'collaborator',
    jsonb_build_object(
      'source', 'transaction_log',
      'amount_usd', p_amount_usd,
      'proof_type', p_proof_type
    )
  )
  RETURNING id INTO v_event_id;

  -- Best-effort: create timeline event (schema varies across old migrations; handle modern one)
  IF to_regclass('public.timeline_events') IS NOT NULL THEN
    v_category := CASE
      WHEN p_transaction_type IN ('purchase', 'sale', 'trade_in', 'wholesale', 'retail') THEN 'ownership'
      ELSE 'legal'
    END;

    -- Modern timeline schema (event_category + source_type)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'timeline_events' AND column_name = 'event_category'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'timeline_events' AND column_name = 'source_type'
    ) THEN
      INSERT INTO public.timeline_events (
        vehicle_id,
        user_id,
        event_type,
        event_category,
        title,
        description,
        event_date,
        source_type,
        affects_value,
        metadata
      )
      VALUES (
        p_vehicle_id,
        v_actor,
        CASE WHEN p_transaction_type IN ('purchase','sale') THEN p_transaction_type ELSE 'ownership_transfer' END,
        v_category,
        CASE
          WHEN p_transaction_type = 'purchase' THEN CONCAT('Purchased for $', p_amount_usd::text)
          WHEN p_transaction_type = 'sale' THEN CONCAT('Sold for $', p_amount_usd::text)
          ELSE CONCAT(initcap(replace(p_transaction_type, '_', ' ')), ' ($', p_amount_usd::text, ')')
        END,
        NULL,
        p_transaction_date,
        'user_input',
        TRUE,
        jsonb_build_object(
          'transaction_event_id', v_event_id,
          'amount_usd', p_amount_usd,
          'proof_type', p_proof_type,
          'proof_url', p_proof_url
        )
      );
    END IF;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_vehicle_transaction(UUID, TEXT, INTEGER, DATE, UUID, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMIT;


