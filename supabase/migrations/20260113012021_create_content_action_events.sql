-- =====================================================
-- CONTENT ACTION EVENTS (MEME DROPS ON VEHICLES / CONTENT)
-- =====================================================
-- Ensures the content meme-drop system exists across deployments.
-- Key properties:
-- - Table: public.content_action_events
-- - RLS policy for SELECT (sender sees own, public vehicles, and owner vehicles)
-- - RPC: public.send_content_action(...)
-- - PostgREST stability: explicit GRANT SELECT to anon/authenticated
-- - Optional: enable postgres_changes via supabase_realtime publication
--
-- Date: 2026-01-13
-- Version: 20260113012021

BEGIN;

-- 1) Add per-use pricing to stream_actions (action library)
DO $$
BEGIN
  IF to_regclass('public.stream_actions') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stream_actions'
        AND column_name = 'use_price_cents'
    ) THEN
      ALTER TABLE public.stream_actions
        ADD COLUMN use_price_cents BIGINT NOT NULL DEFAULT 1 CHECK (use_price_cents >= 0 AND use_price_cents <= 1000);
    END IF;
  END IF;
END
$$;

-- 2) Content action events
CREATE TABLE IF NOT EXISTS public.content_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Target key enables simple realtime filters (single column).
  target_key TEXT NOT NULL,

  -- Optional: vehicle_id is filled when target_key is vehicle:<uuid> so we can link to vehicle + timeline.
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE,

  action_id UUID NOT NULL REFERENCES public.stream_actions(id) ON DELETE RESTRICT,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Denormalized payload
  kind TEXT NOT NULL CHECK (kind IN ('text_popup', 'image_popup', 'sound_only', 'combo')),
  title TEXT NOT NULL,
  render_text TEXT,
  image_url TEXT,
  sound_key TEXT,
  duration_ms INTEGER NOT NULL,

  -- Economics
  cost_cents BIGINT NOT NULL DEFAULT 1 CHECK (cost_cents >= 0 AND cost_cents <= 1000),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_action_events_target ON public.content_action_events(target_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_action_events_sender ON public.content_action_events(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_action_events_vehicle ON public.content_action_events(vehicle_id, created_at DESC) WHERE vehicle_id IS NOT NULL;

-- 3) RLS
ALTER TABLE public.content_action_events ENABLE ROW LEVEL SECURITY;

-- View policy:
-- - Always allow a user to see their own sends.
-- - Allow anyone to see events on public vehicles.
-- - Allow vehicle owner to see events on their vehicles.
DROP POLICY IF EXISTS "content_action_events_read" ON public.content_action_events;
CREATE POLICY "content_action_events_read" ON public.content_action_events
  FOR SELECT
  USING (
    sender_id = auth.uid()
    OR (
      vehicle_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.vehicles v
        WHERE v.id = content_action_events.vehicle_id
          AND (COALESCE(v.is_public, true) = true OR v.user_id = auth.uid())
      )
    )
  );

-- 4) RPC: send_content_action (validates ownership + cooldown + charges per-use)
CREATE OR REPLACE FUNCTION public.send_content_action(
  p_target_key TEXT,
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
  v_price_cents BIGINT;
  v_vehicle_id UUID;
  v_last_event_at TIMESTAMPTZ;
  v_event_id UUID;
  v_target_uuid UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_key IS NULL OR btrim(p_target_key) = '' THEN
    RAISE EXCEPTION 'Missing target';
  END IF;

  -- Load action
  SELECT a.pack_id, a.kind, a.title, a.render_text, a.image_url, a.sound_key, a.duration_ms, a.cooldown_ms,
         COALESCE(a.use_price_cents, 1)
    INTO v_pack_id, v_kind, v_title, v_render_text, v_image_url, v_sound_key, v_duration_ms, v_cooldown_ms, v_price_cents
  FROM public.stream_actions a
  JOIN public.stream_action_packs p ON p.id = a.pack_id
  WHERE a.id = p_action_id
    AND a.is_active = true
    AND p.is_active = true;

  IF v_pack_id IS NULL THEN
    RAISE EXCEPTION 'Action not found or inactive';
  END IF;

  -- Must own the pack
  IF NOT EXISTS (
    SELECT 1
    FROM public.stream_action_purchases pur
    WHERE pur.user_id = v_user_id
      AND pur.pack_id = v_pack_id
      AND (pur.expires_at IS NULL OR pur.expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'Pack not owned';
  END IF;

  -- Parse vehicle target
  v_vehicle_id := NULL;
  IF position('vehicle:' in p_target_key) = 1 THEN
    BEGIN
      v_target_uuid := (split_part(p_target_key, ':', 2))::uuid;
      v_vehicle_id := v_target_uuid;
    EXCEPTION WHEN others THEN
      v_vehicle_id := NULL;
    END;
  END IF;

  -- Cooldown per user per target per action
  IF v_cooldown_ms > 0 THEN
    SELECT created_at INTO v_last_event_at
    FROM public.content_action_events
    WHERE target_key = p_target_key
      AND sender_id = v_user_id
      AND action_id = p_action_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_event_at IS NOT NULL AND v_last_event_at > NOW() - make_interval(secs => (v_cooldown_ms::numeric / 1000.0)) THEN
      RAISE EXCEPTION 'Cooldown active';
    END IF;
  END IF;

  -- Charge per-use (default 1 cent). Uses existing cash ledger when available.
  IF v_price_cents > 0 THEN
    IF to_regclass('public.user_cash_balances') IS NULL THEN
      RAISE EXCEPTION 'Cash balance system not available on this deployment';
    END IF;
    PERFORM public.deduct_cash_from_user(
      v_user_id,
      v_price_cents,
      'meme_drop',
      NULL,
      NULL,
      jsonb_build_object(
        'product', 'content_action',
        'target_key', p_target_key,
        'action_id', p_action_id,
        'pack_id', v_pack_id,
        'price_cents', v_price_cents
      )
    );
  END IF;

  -- Insert event (realtime payload)
  INSERT INTO public.content_action_events (
    target_key,
    vehicle_id,
    action_id,
    sender_id,
    kind,
    title,
    render_text,
    image_url,
    sound_key,
    duration_ms,
    cost_cents
  )
  VALUES (
    p_target_key,
    v_vehicle_id,
    p_action_id,
    v_user_id,
    v_kind,
    v_title,
    v_render_text,
    v_image_url,
    v_sound_key,
    v_duration_ms,
    v_price_cents
  )
  RETURNING id INTO v_event_id;

  -- Also write to timeline_events when this targets a vehicle (foundation for permanent provenance).
  IF v_vehicle_id IS NOT NULL AND to_regclass('public.timeline_events') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.timeline_events (
        vehicle_id,
        user_id,
        event_type,
        source,
        title,
        description,
        event_date,
        image_urls,
        metadata
      )
      VALUES (
        v_vehicle_id,
        v_user_id,
        'other',
        'user_input',
        ('Meme Drop: ' || v_title),
        COALESCE(v_render_text, NULL),
        CURRENT_DATE,
        NULL,
        jsonb_build_object(
          'what', jsonb_build_object(
            'action', 'meme_drop',
            'content_action_event_id', v_event_id,
            'target_key', p_target_key,
            'action_id', p_action_id,
            'pack_id', v_pack_id,
            'kind', v_kind,
            'render_text', v_render_text,
            'image_url', v_image_url,
            'sound_key', v_sound_key,
            'cost_cents', v_price_cents
          ),
          'who', jsonb_build_object(
            'user_id', v_user_id
          ),
          'when', jsonb_build_object(
            'recorded_at', NOW()
          )
        )
      );
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      -- Some deployments may have a shim timeline_events schema; ignore.
      NULL;
    END;
  END IF;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.send_content_action(TEXT, UUID) TO authenticated;

-- PostgREST will 404 if the role lacks privileges, even if the table exists.
GRANT SELECT ON public.content_action_events TO anon, authenticated;

-- Optional: enable realtime postgres_changes for this table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.content_action_events;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

COMMIT;

