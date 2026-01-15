-- ============================================================
-- ADD TIMER EXTENSION LOGGING TO place_auction_bid
-- ============================================================
-- Updates place_auction_bid to log all timer extensions to audit table

CREATE OR REPLACE FUNCTION public.place_auction_bid(
  p_listing_id uuid,
  p_proxy_max_bid_cents bigint,
  p_ip_address inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text,
  p_bid_source text DEFAULT 'web'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_listing record;
  v_current_high_bid_cents bigint;
  v_starting_bid_cents bigint;
  v_increment bigint;
  v_min_bid_cents bigint;
  v_displayed_bid_cents bigint;
  v_bid_id uuid;
  v_prev_high_bidder_id uuid;
  v_auction_extended boolean := false;
  v_new_end_time timestamptz := null;
  v_window_seconds integer;
  v_reset_seconds integer;
  v_remaining_seconds integer;
  v_extension_type text;
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
  v_starting_bid_cents := COALESCE(v_listing.list_price_cents, 0);

  IF v_current_high_bid_cents > 0 THEN
    v_increment := public.calculate_bid_increment(v_current_high_bid_cents);
    v_min_bid_cents := v_current_high_bid_cents + v_increment;
  ELSE
    v_increment := public.calculate_bid_increment(0);
    v_min_bid_cents := CASE
      WHEN v_starting_bid_cents > 0 THEN v_starting_bid_cents
      ELSE v_increment
    END;
  END IF;

  IF p_proxy_max_bid_cents < v_min_bid_cents THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Bid too low',
      'minimum_bid_cents', v_min_bid_cents,
      'current_high_bid_cents', v_current_high_bid_cents,
      'starting_bid_cents', v_starting_bid_cents
    );
  END IF;

  -- For now, displayed bid advances to the minimum (proxy max stays secret)
  v_displayed_bid_cents := v_min_bid_cents;
  v_prev_high_bidder_id := v_listing.current_high_bidder_id;

  -- Soft close configuration
  v_window_seconds := COALESCE(v_listing.soft_close_window_seconds, COALESCE(v_listing.sniping_protection_minutes, 2) * 60);
  v_reset_seconds := COALESCE(v_listing.soft_close_reset_seconds, v_window_seconds);
  v_remaining_seconds := GREATEST(0, floor(extract(epoch from (v_listing.auction_end_time - now())))::int);

  -- Live auction behavior: always reset end time back to reset_seconds on every bid.
  IF v_listing.sale_type = 'live_auction' THEN
    IF COALESCE(v_listing.soft_close_enabled, true) AND v_reset_seconds > 0 THEN
      v_new_end_time := now() + make_interval(secs => v_reset_seconds);
      v_extension_type := 'live_auction_reset';
      
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
  ELSE
    -- Standard auctions: only reset when inside the soft-close window.
    IF COALESCE(v_listing.soft_close_enabled, true)
       AND v_window_seconds > 0
       AND v_reset_seconds > 0
       AND v_remaining_seconds <= v_window_seconds THEN

      v_new_end_time := now() + make_interval(secs => v_reset_seconds);
      v_extension_type := 'soft_close_window';

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
  END IF;

  -- Create bid record
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

  -- Log timer extension if auction was extended
  IF v_auction_extended AND v_new_end_time IS NOT NULL AND v_listing.auction_end_time IS NOT NULL THEN
    INSERT INTO public.auction_timer_extensions (
      listing_id,
      vehicle_id,
      extension_type,
      sale_type,
      old_end_time,
      new_end_time,
      extension_seconds,
      time_remaining_before_extension,
      bid_id,
      bidder_id,
      bid_amount_cents,
      soft_close_enabled,
      soft_close_window_seconds,
      soft_close_reset_seconds,
      sniping_protection_minutes,
      metadata
    ) VALUES (
      p_listing_id,
      v_listing.vehicle_id,
      v_extension_type,
      v_listing.sale_type,
      v_listing.auction_end_time,
      v_new_end_time,
      v_reset_seconds,
      v_remaining_seconds,
      v_bid_id,
      auth.uid(),
      v_displayed_bid_cents,
      COALESCE(v_listing.soft_close_enabled, true),
      v_window_seconds,
      v_reset_seconds,
      v_listing.sniping_protection_minutes,
      jsonb_build_object(
        'bid_source', p_bid_source,
        'ip_address', COALESCE(p_ip_address::text, ''),
        'user_agent', COALESCE(p_user_agent, '')
      )
    );
  END IF;

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
    'extension_seconds', CASE WHEN v_auction_extended THEN v_reset_seconds ELSE NULL END,
    'current_high_bid_cents', v_displayed_bid_cents,
    'bid_count', COALESCE(v_listing.bid_count, 0) + 1
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
