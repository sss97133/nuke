-- =====================================================
-- STREAM ACTION PACKS (MEME POPUPS + SOUND EFFECTS)
-- =====================================================
-- Users can purchase packs (using cash balance) and trigger realtime stream overlays.
-- Idempotent + safe for db reset (uses IF NOT EXISTS + defensive checks).
-- Date: 2025-12-15

BEGIN;

-- ==========================
-- 1) PACKS
-- ==========================
CREATE TABLE IF NOT EXISTS public.stream_action_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_action_packs_active ON public.stream_action_packs(is_active) WHERE is_active = true;

-- ==========================
-- 2) ACTIONS
-- ==========================
CREATE TABLE IF NOT EXISTS public.stream_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES public.stream_action_packs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,

  -- action kind: 'text_popup' | 'image_popup' | 'sound_only' | 'combo'
  kind TEXT NOT NULL DEFAULT 'text_popup' CHECK (kind IN ('text_popup', 'image_popup', 'sound_only', 'combo')),

  -- render fields (copied into events for realtime payload)
  render_text TEXT,
  image_url TEXT,
  sound_key TEXT,

  -- timing + rate limit
  duration_ms INTEGER NOT NULL DEFAULT 1800 CHECK (duration_ms >= 250 AND duration_ms <= 10000),
  cooldown_ms INTEGER NOT NULL DEFAULT 2500 CHECK (cooldown_ms >= 0 AND cooldown_ms <= 60000),

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT stream_actions_pack_slug_unique UNIQUE (pack_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_stream_actions_pack ON public.stream_actions(pack_id);
CREATE INDEX IF NOT EXISTS idx_stream_actions_active ON public.stream_actions(is_active) WHERE is_active = true;

-- ==========================
-- 3) PURCHASES / ENTITLEMENTS
-- ==========================
CREATE TABLE IF NOT EXISTS public.stream_action_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES public.stream_action_packs(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT stream_action_purchases_unique UNIQUE (user_id, pack_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_action_purchases_user ON public.stream_action_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_action_purchases_pack ON public.stream_action_purchases(pack_id);

-- ==========================
-- 4) EVENTS (realtime overlay payload)
-- ==========================
CREATE TABLE IF NOT EXISTS public.stream_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- We intentionally keep this as UUID without FK so this migration doesn't hard-fail
  -- if a deployment doesn't have the streaming tables.
  stream_id UUID NOT NULL,

  action_id UUID NOT NULL REFERENCES public.stream_actions(id) ON DELETE RESTRICT,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- denormalized render payload (so viewer doesn't need extra queries to render)
  kind TEXT NOT NULL CHECK (kind IN ('text_popup', 'image_popup', 'sound_only', 'combo')),
  title TEXT NOT NULL,
  render_text TEXT,
  image_url TEXT,
  sound_key TEXT,
  duration_ms INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_action_events_stream ON public.stream_action_events(stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_action_events_sender ON public.stream_action_events(sender_id, created_at DESC);

-- Add FK to live_streams if present (optional)
DO $$
BEGIN
  IF to_regclass('public.live_streams') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'stream_action_events_stream_id_fkey'
    ) THEN
      ALTER TABLE public.stream_action_events
        ADD CONSTRAINT stream_action_events_stream_id_fkey
        FOREIGN KEY (stream_id) REFERENCES public.live_streams(id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$;

-- ==========================
-- 5) RLS
-- ==========================
ALTER TABLE public.stream_action_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_action_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_action_events ENABLE ROW LEVEL SECURITY;

-- Packs/actions are public-readable when active
DROP POLICY IF EXISTS "stream_action_packs_public_read" ON public.stream_action_packs;
CREATE POLICY "stream_action_packs_public_read" ON public.stream_action_packs
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "stream_actions_public_read" ON public.stream_actions;
CREATE POLICY "stream_actions_public_read" ON public.stream_actions
  FOR SELECT
  USING (
    is_active = true
    AND pack_id IN (SELECT id FROM public.stream_action_packs WHERE is_active = true)
  );

-- Purchases: users can read their own; purchases are created through RPC
DROP POLICY IF EXISTS "stream_action_purchases_owner_read" ON public.stream_action_purchases;
CREATE POLICY "stream_action_purchases_owner_read" ON public.stream_action_purchases
  FOR SELECT
  USING (auth.uid() = user_id);

-- Events: public-readable (viewers need to render); inserts are via RPC (no direct insert policy)
DROP POLICY IF EXISTS "stream_action_events_public_read" ON public.stream_action_events;
CREATE POLICY "stream_action_events_public_read" ON public.stream_action_events
  FOR SELECT
  USING (true);

-- ==========================
-- 6) RPC: Purchase pack (deduct cash, then upsert entitlement)
-- ==========================
CREATE OR REPLACE FUNCTION public.purchase_stream_action_pack(
  p_pack_id UUID
)
RETURNS TABLE (
  pack_id UUID,
  user_id UUID,
  price_cents BIGINT,
  purchased_at TIMESTAMPTZ
) AS $$
DECLARE
  v_user_id UUID;
  v_price BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT price_cents INTO v_price
  FROM public.stream_action_packs
  WHERE id = p_pack_id
    AND is_active = true;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Pack not found or inactive';
  END IF;

  -- If already purchased and not expired, return existing
  IF EXISTS (
    SELECT 1
    FROM public.stream_action_purchases p
    WHERE p.user_id = v_user_id
      AND p.pack_id = p_pack_id
      AND (p.expires_at IS NULL OR p.expires_at > NOW())
  ) THEN
    RETURN QUERY
    SELECT p_pack_id, v_user_id, v_price,
      (SELECT purchased_at FROM public.stream_action_purchases WHERE user_id = v_user_id AND pack_id = p_pack_id);
    RETURN;
  END IF;

  -- Deduct cash using existing ledger, if the function exists (required for paid packs)
  IF v_price > 0 THEN
    IF to_regclass('public.user_cash_balances') IS NULL THEN
      RAISE EXCEPTION 'Cash balance system not available on this deployment';
    END IF;
    PERFORM public.deduct_cash_from_user(
      v_user_id,
      v_price,
      'stream_action_pack_purchase',
      p_pack_id,
      NULL,
      jsonb_build_object(
        'product', 'stream_action_pack',
        'pack_id', p_pack_id,
        'price_cents', v_price
      )
    );
  END IF;

  INSERT INTO public.stream_action_purchases (user_id, pack_id, metadata)
  VALUES (v_user_id, p_pack_id, jsonb_build_object('source', 'rpc'))
  ON CONFLICT (user_id, pack_id) DO UPDATE SET
    purchased_at = EXCLUDED.purchased_at,
    expires_at = NULL,
    metadata = public.stream_action_purchases.metadata || EXCLUDED.metadata;

  RETURN QUERY
  SELECT p_pack_id, v_user_id, v_price,
    (SELECT purchased_at FROM public.stream_action_purchases WHERE user_id = v_user_id AND pack_id = p_pack_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.purchase_stream_action_pack(UUID) TO authenticated;

-- ==========================
-- 7) RPC: Send action event (validates entitlement + cooldown)
-- ==========================
CREATE OR REPLACE FUNCTION public.send_stream_action(
  p_stream_id UUID,
  p_action_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_pack_id UUID;
  v_kind TEXT;
  v_title TEXT;
  v_render_text TEXT;
  v_image_url TEXT;
  v_sound_key TEXT;
  v_duration_ms INTEGER;
  v_cooldown_ms INTEGER;
  v_last_event_at TIMESTAMPTZ;
  v_event_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT a.pack_id, a.kind, a.title, a.render_text, a.image_url, a.sound_key, a.duration_ms, a.cooldown_ms
    INTO v_pack_id, v_kind, v_title, v_render_text, v_image_url, v_sound_key, v_duration_ms, v_cooldown_ms
  FROM public.stream_actions a
  JOIN public.stream_action_packs p ON p.id = a.pack_id
  WHERE a.id = p_action_id
    AND a.is_active = true
    AND p.is_active = true;

  IF v_pack_id IS NULL THEN
    RAISE EXCEPTION 'Action not found or inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.stream_action_purchases pur
    WHERE pur.user_id = v_user_id
      AND pur.pack_id = v_pack_id
      AND (pur.expires_at IS NULL OR pur.expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'Pack not owned';
  END IF;

  -- Cooldown: last event by this user for this action in this stream
  IF v_cooldown_ms > 0 THEN
    SELECT created_at INTO v_last_event_at
    FROM public.stream_action_events
    WHERE stream_id = p_stream_id
      AND sender_id = v_user_id
      AND action_id = p_action_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_event_at IS NOT NULL AND v_last_event_at > NOW() - make_interval(secs => (v_cooldown_ms::numeric / 1000.0)) THEN
      RAISE EXCEPTION 'Cooldown active';
    END IF;
  END IF;

  INSERT INTO public.stream_action_events (
    stream_id, action_id, sender_id,
    kind, title, render_text, image_url, sound_key, duration_ms
  )
  VALUES (
    p_stream_id, p_action_id, v_user_id,
    v_kind, v_title, v_render_text, v_image_url, v_sound_key, v_duration_ms
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.send_stream_action(UUID, UUID) TO authenticated;

-- ==========================
-- 7.5) PostgREST privileges (RLS still applies)
-- ==========================
GRANT SELECT ON public.stream_action_packs TO anon, authenticated;
GRANT SELECT ON public.stream_actions TO anon, authenticated;
GRANT SELECT ON public.stream_action_events TO anon, authenticated;
GRANT SELECT ON public.stream_action_purchases TO authenticated;

-- ==========================
-- 8) SEED: "DEEP CUTS" PACK (no copyrighted assets shipped)
-- ==========================
INSERT INTO public.stream_action_packs (slug, name, description, price_cents, is_active)
VALUES
  ('deepcuts_v1', 'Deep Cuts v1', 'Text popups and synthesized sound cues for stream energy.', 299, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Seed actions (text-only + sound keys; viewer renders these client-side)
DO $$
DECLARE
  v_pack_id UUID;
BEGIN
  SELECT id INTO v_pack_id FROM public.stream_action_packs WHERE slug = 'deepcuts_v1';
  IF v_pack_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.stream_actions (pack_id, slug, title, kind, render_text, sound_key, duration_ms, cooldown_ms, is_active)
  VALUES
    (v_pack_id, 'airhorn_short', 'Airhorn (Short)', 'sound_only', NULL, 'airhorn_short', 1200, 5000, true),
    (v_pack_id, 'rimshot', 'Rimshot', 'sound_only', NULL, 'rimshot', 900, 4000, true),
    (v_pack_id, 'hype_drop', 'Hype Drop', 'combo', 'HYPE DROP', 'hype_drop', 1600, 6000, true),
    (v_pack_id, 'slow_clap', 'Slow Clap', 'combo', 'SLOW CLAP', 'slow_clap', 2200, 8000, true),
    (v_pack_id, 'plot_twist', 'Plot Twist', 'text_popup', 'PLOT TWIST', NULL, 1800, 4000, true),
    (v_pack_id, 'instant_regret', 'Instant Regret', 'text_popup', 'INSTANT REGRET', NULL, 1800, 6000, true),
    (v_pack_id, 'legendary', 'Legendary', 'text_popup', 'LEGENDARY', NULL, 1600, 5000, true),
    (v_pack_id, 'rare_pull', 'Rare Pull', 'text_popup', 'RARE PULL', NULL, 1600, 5000, true)
  ON CONFLICT (pack_id, slug) DO UPDATE SET
    title = EXCLUDED.title,
    kind = EXCLUDED.kind,
    render_text = EXCLUDED.render_text,
    image_url = EXCLUDED.image_url,
    sound_key = EXCLUDED.sound_key,
    duration_ms = EXCLUDED.duration_ms,
    cooldown_ms = EXCLUDED.cooldown_ms,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
END
$$;

COMMIT;


