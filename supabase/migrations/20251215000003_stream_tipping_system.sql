-- =====================================================
-- STREAM TIPPING + SUPERCHAT (VIEWER -> STREAMER)
-- =====================================================
-- Implements familiar livestream incentives:
-- - Viewer tips streamer (cash transfer)
-- - Tip shows as highlighted chat message (superchat)
-- - Tip emits realtime overlay event
--
-- Idempotent + safe for db reset.
-- Date: 2025-12-15

BEGIN;

-- ==========================
-- 0) Make cash ledger transaction_type flexible (avoid constraint mismatch)
-- ==========================
DO $$
BEGIN
  IF to_regclass('public.cash_transactions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'cash_transactions_transaction_type_check'
    ) THEN
      ALTER TABLE public.cash_transactions DROP CONSTRAINT cash_transactions_transaction_type_check;
    END IF;
    -- Keep only a minimal sanity check (non-empty)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'cash_transactions_transaction_type_nonempty'
    ) THEN
      ALTER TABLE public.cash_transactions
        ADD CONSTRAINT cash_transactions_transaction_type_nonempty CHECK (transaction_type IS NOT NULL AND btrim(transaction_type) <> '');
    END IF;
  END IF;
END
$$;

-- ==========================
-- 1) Cash transfer primitive (viewer -> creator)
-- ==========================
CREATE OR REPLACE FUNCTION public.transfer_cash_to_user(
  p_to_user_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT DEFAULT 'tip',
  p_reference_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN AS $$
DECLARE
  v_from UUID;
  v_from_available BIGINT;
BEGIN
  v_from := auth.uid();
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing recipient';
  END IF;

  IF p_to_user_id = v_from THEN
    RAISE EXCEPTION 'Cannot transfer to self';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF to_regclass('public.user_cash_balances') IS NULL THEN
    RAISE EXCEPTION 'Cash balance system not available on this deployment';
  END IF;

  -- Ensure both balance rows exist
  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (v_from, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_to_user_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock payer row and verify funds
  SELECT available_cents INTO v_from_available
  FROM public.user_cash_balances
  WHERE user_id = v_from
  FOR UPDATE;

  IF COALESCE(v_from_available, 0) < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  -- Deduct from payer
  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE user_id = v_from;

  -- Credit recipient
  UPDATE public.user_cash_balances
  SET
    balance_cents = balance_cents + p_amount_cents,
    available_cents = available_cents + p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_to_user_id;

  -- Record transactions (both sides)
  IF to_regclass('public.cash_transactions') IS NOT NULL THEN
    INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
    VALUES (
      v_from,
      -p_amount_cents,
      p_transaction_type,
      p_reference_id,
      p_metadata || jsonb_build_object('direction', 'out', 'to_user_id', p_to_user_id),
      NOW()
    );

    INSERT INTO public.cash_transactions (user_id, amount_cents, transaction_type, reference_id, metadata, completed_at)
    VALUES (
      p_to_user_id,
      p_amount_cents,
      p_transaction_type,
      p_reference_id,
      p_metadata || jsonb_build_object('direction', 'in', 'from_user_id', v_from),
      NOW()
    );
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.transfer_cash_to_user(UUID, BIGINT, TEXT, UUID, JSONB) TO authenticated;

-- ==========================
-- 2) Stream tip realtime events
-- ==========================
CREATE TABLE IF NOT EXISTS public.stream_tip_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL,
  streamer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_tip_events_stream ON public.stream_tip_events(stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_tip_events_streamer ON public.stream_tip_events(streamer_id, created_at DESC) WHERE streamer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stream_tip_events_sender ON public.stream_tip_events(sender_id, created_at DESC) WHERE sender_id IS NOT NULL;

-- Optional FK to live_streams if present
DO $$
BEGIN
  IF to_regclass('public.live_streams') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'stream_tip_events_stream_id_fkey'
    ) THEN
      ALTER TABLE public.stream_tip_events
        ADD CONSTRAINT stream_tip_events_stream_id_fkey
        FOREIGN KEY (stream_id) REFERENCES public.live_streams(id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$;

ALTER TABLE public.stream_tip_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stream_tip_events_public_read" ON public.stream_tip_events;
CREATE POLICY "stream_tip_events_public_read" ON public.stream_tip_events
  FOR SELECT
  USING (true);

-- ==========================
-- 3) Stream chat enhancements (superchat fields) - only if table exists
-- ==========================
DO $$
BEGIN
  IF to_regclass('public.stream_chat') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stream_chat' AND column_name = 'message_type'
    ) THEN
      ALTER TABLE public.stream_chat ADD COLUMN message_type TEXT DEFAULT 'chat';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stream_chat' AND column_name = 'donation_cents'
    ) THEN
      ALTER TABLE public.stream_chat ADD COLUMN donation_cents BIGINT DEFAULT 0;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stream_chat' AND column_name = 'highlighted'
    ) THEN
      ALTER TABLE public.stream_chat ADD COLUMN highlighted BOOLEAN DEFAULT false;
    END IF;
  END IF;
END
$$;

-- ==========================
-- 4) Creator controls on live_streams (tips enabled, min/max) - optional
-- ==========================
DO $$
BEGIN
  IF to_regclass('public.live_streams') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='live_streams' AND column_name='tips_enabled') THEN
      ALTER TABLE public.live_streams ADD COLUMN tips_enabled BOOLEAN NOT NULL DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='live_streams' AND column_name='tips_min_cents') THEN
      ALTER TABLE public.live_streams ADD COLUMN tips_min_cents BIGINT NOT NULL DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='live_streams' AND column_name='tips_max_cents') THEN
      ALTER TABLE public.live_streams ADD COLUMN tips_max_cents BIGINT NOT NULL DEFAULT 5000;
    END IF;
  END IF;
END
$$;

-- ==========================
-- 5) RPC: tip a live stream (transfer + overlay + chat superchat)
-- ==========================
CREATE OR REPLACE FUNCTION public.tip_live_stream(
  p_stream_id UUID,
  p_amount_cents BIGINT,
  p_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_streamer_id UUID;
  v_tips_enabled BOOLEAN;
  v_min BIGINT;
  v_max BIGINT;
  v_tip_id UUID;
  v_started_at TIMESTAMPTZ;
  v_offset INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Look up streamer
  IF to_regclass('public.live_streams') IS NULL THEN
    RAISE EXCEPTION 'Streaming system not available on this deployment';
  END IF;

  SELECT streamer_id,
         COALESCE(tips_enabled, true),
         COALESCE(tips_min_cents, 1),
         COALESCE(tips_max_cents, 5000),
         COALESCE(actual_start, started_at, scheduled_start)
    INTO v_streamer_id, v_tips_enabled, v_min, v_max, v_started_at
  FROM public.live_streams
  WHERE id = p_stream_id;

  IF v_streamer_id IS NULL THEN
    RAISE EXCEPTION 'Stream not found';
  END IF;

  IF v_tips_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Tips disabled';
  END IF;

  IF p_amount_cents < v_min OR p_amount_cents > v_max THEN
    RAISE EXCEPTION 'Tip out of range';
  END IF;

  -- Transfer funds to streamer
  PERFORM public.transfer_cash_to_user(
    v_streamer_id,
    p_amount_cents,
    'tip',
    p_stream_id,
    jsonb_build_object(
      'product', 'stream_tip',
      'stream_id', p_stream_id,
      'streamer_id', v_streamer_id,
      'message', p_message
    )
  );

  -- Realtime overlay event
  INSERT INTO public.stream_tip_events (stream_id, streamer_id, sender_id, amount_cents, message)
  VALUES (p_stream_id, v_streamer_id, v_user_id, p_amount_cents, p_message)
  RETURNING id INTO v_tip_id;

  -- Also write a highlighted chat message when stream_chat exists
  IF to_regclass('public.stream_chat') IS NOT NULL THEN
    v_offset := 0;
    IF v_started_at IS NOT NULL THEN
      v_offset := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - v_started_at)))::INTEGER);
    END IF;

    INSERT INTO public.stream_chat (
      stream_id,
      user_id,
      message,
      message_type,
      donation_cents,
      highlighted,
      timestamp_offset,
      created_at
    )
    VALUES (
      p_stream_id,
      v_user_id,
      COALESCE(NULLIF(btrim(p_message), ''), 'TIP'),
      'super_chat',
      p_amount_cents,
      true,
      v_offset,
      NOW()
    );
  END IF;

  RETURN v_tip_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.tip_live_stream(UUID, BIGINT, TEXT) TO authenticated;

COMMIT;




