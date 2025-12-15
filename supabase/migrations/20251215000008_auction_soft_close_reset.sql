-- Auction soft close reset (BaT-style) + schema compat shims
-- Ensures late bids (<= window seconds) reset remaining time back to reset_seconds.
--
-- This powers the proprietary auction "golden egg" moment: every bid inside the
-- final window pushes the clock back out to the reset duration (default 120s).

DO $$
BEGIN
  -- vehicle_listings: core auction columns (some environments may be missing them)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='auction_end_time'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN auction_end_time timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='auction_start_time'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN auction_start_time timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='current_high_bid_cents'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN current_high_bid_cents bigint;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='current_high_bidder_id'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN current_high_bidder_id uuid REFERENCES public.profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='bid_count'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN bid_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='last_bid_time'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN last_bid_time timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='sniping_extensions'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN sniping_extensions integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='sniping_protection_minutes'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN sniping_protection_minutes integer DEFAULT 2;
  END IF;

  -- New: soft-close timer config (seconds)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='soft_close_enabled'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN soft_close_enabled boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='soft_close_window_seconds'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN soft_close_window_seconds integer DEFAULT 120;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='soft_close_reset_seconds'
  ) THEN
    ALTER TABLE public.vehicle_listings ADD COLUMN soft_close_reset_seconds integer DEFAULT 120;
  END IF;

  -- auction_bids: add cents fields required by realtime UI + edge responses
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='auction_bids' AND column_name='proxy_max_bid_cents'
  ) THEN
    ALTER TABLE public.auction_bids ADD COLUMN proxy_max_bid_cents bigint;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='auction_bids' AND column_name='displayed_bid_cents'
  ) THEN
    ALTER TABLE public.auction_bids ADD COLUMN displayed_bid_cents bigint;
  END IF;
END $$;

-- Keep increment function available (idempotent)
CREATE OR REPLACE FUNCTION public.calculate_bid_increment(current_bid_cents bigint)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN current_bid_cents < 10000 THEN 50
    WHEN current_bid_cents < 50000 THEN 100
    WHEN current_bid_cents < 100000 THEN 250
    WHEN current_bid_cents < 500000 THEN 500
    WHEN current_bid_cents < 1000000 THEN 1000
    WHEN current_bid_cents < 5000000 THEN 2500
    ELSE 5000
  END;
END;
$$;

-- BaT-style soft close reset implementation (concurrency-safe via FOR UPDATE lock)
CREATE OR REPLACE FUNCTION public.place_auction_bid(
  p_listing_id uuid,
  p_proxy_max_bid_cents bigint,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_bid_source text DEFAULT 'web'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_current_high_bid_cents bigint;
  v_increment bigint;
  v_min_bid_cents bigint;
  v_displayed_bid_cents bigint;
  v_bid_id uuid;
  v_auction_extended boolean := false;
  v_new_end_time timestamptz := null;
  v_window_seconds integer;
  v_reset_seconds integer;
  v_remaining_seconds integer;
BEGIN
  -- Lock listing row to make end-time updates + bid_count atomic
  SELECT * INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;

  IF v_listing.sale_type NOT IN ('auction', 'live_auction') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not an auction listing');
  END IF;

  IF v_listing.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction is not active');
  END IF;

  IF v_listing.auction_end_time IS NULL OR now() >= v_listing.auction_end_time THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction has ended');
  END IF;

  IF v_listing.seller_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Seller cannot bid on own auction');
  END IF;

  v_current_high_bid_cents := COALESCE(v_listing.current_high_bid_cents, 0);
  v_increment := public.calculate_bid_increment(v_current_high_bid_cents);
  v_min_bid_cents := v_current_high_bid_cents + v_increment;

  IF p_proxy_max_bid_cents < v_min_bid_cents THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Bid too low',
      'minimum_bid_cents', v_min_bid_cents,
      'current_high_bid_cents', v_current_high_bid_cents
    );
  END IF;

  -- For now, displayed bid advances by one increment (proxy max stays secret)
  v_displayed_bid_cents := v_min_bid_cents;

  -- Soft close: if time remaining is within window, reset to reset_seconds from now.
  v_window_seconds := COALESCE(v_listing.soft_close_window_seconds, COALESCE(v_listing.sniping_protection_minutes, 2) * 60);
  v_reset_seconds := COALESCE(v_listing.soft_close_reset_seconds, v_window_seconds);
  v_remaining_seconds := GREATEST(0, floor(extract(epoch from (v_listing.auction_end_time - now())))::int);

  IF COALESCE(v_listing.soft_close_enabled, true)
     AND v_window_seconds > 0
     AND v_reset_seconds > 0
     AND v_remaining_seconds <= v_window_seconds THEN

    v_new_end_time := now() + make_interval(secs => v_reset_seconds);

    UPDATE public.vehicle_listings
    SET
      auction_end_time = v_new_end_time,
      sniping_extensions = COALESCE(sniping_extensions, 0) + 1,
      last_bid_time = now(),
      updated_at = now()
    WHERE id = p_listing_id;

    v_auction_extended := true;
  ELSE
    UPDATE public.vehicle_listings
    SET
      last_bid_time = now(),
      updated_at = now()
    WHERE id = p_listing_id;
  END IF;

  -- Create bid record (supports legacy schema + new cents fields)
  INSERT INTO public.auction_bids (
    listing_id,
    bidder_id,
    bid_amount,
    max_bid_amount,
    is_proxy_bid,
    bid_time,
    time_remaining_seconds,
    bidder_ip,
    user_agent,
    proxy_max_bid_cents,
    displayed_bid_cents
  ) VALUES (
    p_listing_id,
    auth.uid(),
    (v_displayed_bid_cents::numeric / 100.0),
    (p_proxy_max_bid_cents::numeric / 100.0),
    true,
    now(),
    GREATEST(0, floor(extract(epoch from ((COALESCE(v_new_end_time, v_listing.auction_end_time)) - now())))::int),
    p_ip_address,
    p_user_agent,
    p_proxy_max_bid_cents,
    v_displayed_bid_cents
  ) RETURNING id INTO v_bid_id;

  -- Update listing high-bid snapshot
  UPDATE public.vehicle_listings
  SET
    current_high_bid_cents = v_displayed_bid_cents,
    current_high_bidder_id = auth.uid(),
    bid_count = COALESCE(bid_count, 0) + 1,
    updated_at = now()
  WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'success', true,
    'bid_id', v_bid_id,
    'displayed_bid_cents', v_displayed_bid_cents,
    'proxy_max_bid_cents', p_proxy_max_bid_cents,
    'is_winning', true,
    'auction_extended', v_auction_extended,
    'new_end_time', v_new_end_time,
    'current_high_bid_cents', v_displayed_bid_cents,
    'bid_count', COALESCE(v_listing.bid_count, 0) + 1
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint, inet, text, text) TO authenticated;


