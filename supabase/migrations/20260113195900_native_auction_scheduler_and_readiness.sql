-- Native auction scheduler + readiness scan + premium timing rails
-- - Starts scheduled draft auctions automatically (cron -> edge function)
-- - Ends auctions after auction_end_time via secure server-only RPC
-- - Fixes bid increment semantics (cents) + aligns place_auction_bid() with auction_bids schema
-- - Adds a lightweight readiness scan ("AI scan" gate) based on current vehicle data completeness
-- - Adds premium timing columns + a simple purchase RPC (uses existing cash balance system)

-- Extensions used by cron scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  -- vehicle_listings: scheduler + readiness + premium rails
  IF to_regclass('public.vehicle_listings') IS NOT NULL THEN
    ALTER TABLE public.vehicle_listings
      -- Some parts of the app assume this exists; if missing, it breaks listing creation + readiness checks.
      ADD COLUMN IF NOT EXISTS auction_duration_minutes integer,
      ADD COLUMN IF NOT EXISTS auto_start_enabled boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS auto_start_armed_at timestamptz,
      ADD COLUMN IF NOT EXISTS auto_start_last_attempt_at timestamptz,
      ADD COLUMN IF NOT EXISTS auto_start_last_error text,
      ADD COLUMN IF NOT EXISTS schedule_strategy text DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS premium_status text DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS premium_budget_cents bigint,
      ADD COLUMN IF NOT EXISTS premium_paid_at timestamptz,
      ADD COLUMN IF NOT EXISTS premium_priority integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS readiness_last_checked_at timestamptz,
      ADD COLUMN IF NOT EXISTS readiness_last_result jsonb DEFAULT '{}'::jsonb;

    -- Backfill duration for existing listings (best-effort; OK if columns are missing in older schemas)
    BEGIN
      UPDATE public.vehicle_listings
      SET auction_duration_minutes =
        GREATEST(
          1,
          floor(extract(epoch from (auction_end_time - auction_start_time)) / 60)::int
        )
      WHERE auction_duration_minutes IS NULL
        AND auction_start_time IS NOT NULL
        AND auction_end_time IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Best-effort constraint shims (do not fail migration if these already exist under different names)
    BEGIN
      ALTER TABLE public.vehicle_listings DROP CONSTRAINT IF EXISTS vehicle_listings_schedule_strategy_check;
      ALTER TABLE public.vehicle_listings
        ADD CONSTRAINT vehicle_listings_schedule_strategy_check
          CHECK (schedule_strategy IN ('manual', 'auto', 'premium'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      ALTER TABLE public.vehicle_listings DROP CONSTRAINT IF EXISTS vehicle_listings_premium_status_check;
      ALTER TABLE public.vehicle_listings
        ADD CONSTRAINT vehicle_listings_premium_status_check
          CHECK (premium_status IN ('none', 'requested', 'pending_payment', 'paid', 'scheduled', 'consumed', 'refunded', 'cancelled'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Bid increments (CENTS): fix semantics (car-auction style)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_bid_increment(current_bid_cents bigint)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    -- Under $1,000 -> $50 increments
    WHEN current_bid_cents < 100000 THEN 5000
    -- $1,000-$5,000 -> $100 increments
    WHEN current_bid_cents < 500000 THEN 10000
    -- $5,000-$10,000 -> $250 increments
    WHEN current_bid_cents < 1000000 THEN 25000
    -- $10,000-$50,000 -> $500 increments
    WHEN current_bid_cents < 5000000 THEN 50000
    -- $50,000-$100,000 -> $1,000 increments
    WHEN current_bid_cents < 10000000 THEN 100000
    -- $100,000-$250,000 -> $2,500 increments
    WHEN current_bid_cents < 25000000 THEN 250000
    -- $250,000+ -> $5,000 increments
    ELSE 500000
  END;
END;
$$;

-- -----------------------------------------------------------------------------
-- Readiness scan ("AI scan" gate): fast, deterministic, data-based.
-- Returns JSONB with `ready`, `issues[]`, and summary counts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_auction_readiness(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_listing record;
  v_vehicle record;
  v_image_count integer := 0;
  v_primary_image boolean := false;
  v_has_title boolean := false;
  v_issues jsonb := '[]'::jsonb;
  v_has_errors boolean := false;
  v_duration_minutes integer := null;
BEGIN
  SELECT *
  INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_listing_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'error', 'Listing not found', 'issues', v_issues);
  END IF;

  SELECT id, year, make, model, trim, primary_image_url
  INTO v_vehicle
  FROM public.vehicles
  WHERE id = v_listing.vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'error', 'Vehicle not found', 'issues', v_issues);
  END IF;

  -- Image coverage (prefer non-document, non-duplicate images)
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN
    SELECT COUNT(*)::int
    INTO v_image_count
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = v_vehicle.id
      AND COALESCE(vi.is_document, false) = false
      AND COALESCE(vi.is_duplicate, false) = false;
  ELSE
    v_image_count := 0;
  END IF;

  v_primary_image := COALESCE(v_vehicle.primary_image_url, '') <> '';

  -- Basic YMM
  IF COALESCE(v_vehicle.year, 0) <= 0 OR COALESCE(v_vehicle.make, '') = '' OR COALESCE(v_vehicle.model, '') = '' THEN
    v_has_errors := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'missing_identity',
      'message', 'Vehicle year/make/model must be set before auctioning'
    ));
  END IF;

  -- Listing description quality
  IF COALESCE(length(trim(COALESCE(v_listing.description, ''))), 0) < 120 THEN
    v_has_errors := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'description_too_short',
      'message', 'Listing description must be at least 120 characters'
    ));
  END IF;

  -- Starting bid required
  IF COALESCE(v_listing.list_price_cents, 0) <= 0 THEN
    v_has_errors := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'missing_starting_bid',
      'message', 'Starting bid is required (list_price_cents)'
    ));
  END IF;

  -- Auction timing sanity
  -- For manual starts, start time can be set at activation time, so don't hard-fail if missing.
  IF v_listing.auction_start_time IS NULL THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'code', 'missing_start_time',
      'message', 'Auction start time is not set yet (will be set when started)'
    ));
  END IF;

  v_duration_minutes := COALESCE(
    v_listing.auction_duration_minutes,
    CASE
      WHEN v_listing.auction_start_time IS NOT NULL AND v_listing.auction_end_time IS NOT NULL THEN
        GREATEST(
          1,
          floor(extract(epoch from (v_listing.auction_end_time - v_listing.auction_start_time)) / 60)::int
        )
      ELSE NULL
    END
  );

  IF COALESCE(v_duration_minutes, 0) <= 0 THEN
    v_has_errors := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'invalid_duration',
      'message', 'Auction duration must be a positive number of minutes'
    ));
  END IF;

  -- Image requirements (soft minimums)
  IF NOT v_primary_image AND v_image_count = 0 THEN
    v_has_errors := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'missing_images',
      'message', 'At least one image is required'
    ));
  ELSIF v_image_count < 4 THEN
    v_has_errors := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'code', 'too_few_images',
      'message', 'At least 4 non-document images are required'
    ));
  ELSIF v_image_count < 8 THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'code', 'low_image_coverage',
      'message', 'Recommended: add at least 8 images to increase buyer confidence'
    ));
  END IF;

  RETURN jsonb_build_object(
    'ready', NOT v_has_errors,
    'issues', v_issues,
    'image_count', v_image_count,
    'has_primary_image', v_primary_image,
    'vehicle_id', v_vehicle.id,
    'listing_id', v_listing.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_auction_readiness(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Activate an auction (manual or scheduled). Runs readiness scan first.
-- - Seller can activate their own listing.
-- - Service role can activate listings for auto-start scheduling.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_auction_listing(
  p_listing_id uuid,
  p_use_scheduled_time boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_listing record;
  v_ready jsonb;
  v_start_time timestamptz;
  v_duration_minutes integer;
  v_end_time timestamptz;
BEGIN
  SELECT *
  INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;

  IF v_listing.sale_type NOT IN ('auction', 'live_auction') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not an auction listing');
  END IF;

  IF v_listing.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing is not in draft state');
  END IF;

  -- Authorization: seller OR service_role
  IF auth.role() <> 'service_role' AND v_listing.seller_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Readiness scan
  v_ready := public.check_auction_readiness(p_listing_id);
  UPDATE public.vehicle_listings
  SET
    readiness_last_checked_at = now(),
    readiness_last_result = v_ready,
    auto_start_last_attempt_at = now()
  WHERE id = p_listing_id;

  IF COALESCE((v_ready->>'ready')::boolean, false) <> true THEN
    UPDATE public.vehicle_listings
    SET auto_start_last_error = COALESCE(v_ready->>'error', 'Readiness check failed')
    WHERE id = p_listing_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Auction not ready to start',
      'readiness', v_ready
    );
  END IF;

  v_duration_minutes := COALESCE(
    v_listing.auction_duration_minutes,
    CASE
      WHEN v_listing.auction_start_time IS NOT NULL AND v_listing.auction_end_time IS NOT NULL THEN
        GREATEST(
          1,
          floor(extract(epoch from (v_listing.auction_end_time - v_listing.auction_start_time)) / 60)::int
        )
      ELSE 7 * 24 * 60
    END
  );
  IF v_duration_minutes <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid auction duration');
  END IF;

  v_start_time := CASE
    WHEN p_use_scheduled_time AND v_listing.auction_start_time IS NOT NULL THEN v_listing.auction_start_time
    ELSE now()
  END;

  v_end_time := v_start_time + make_interval(mins => v_duration_minutes);

  UPDATE public.vehicle_listings
  SET
    status = 'active',
    auction_start_time = v_start_time,
    auction_end_time = v_end_time,
    auction_duration_minutes = v_duration_minutes,
    auto_start_last_error = null,
    -- Once started, disable auto-start so it doesn't re-trigger
    auto_start_enabled = false,
    updated_at = now()
  WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'success', true,
    'listing_id', p_listing_id,
    'auction_start_time', v_start_time,
    'auction_end_time', v_end_time
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_auction_listing(uuid, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- Due-start / due-end helper RPCs for scheduler edge function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_due_auction_starts(p_limit integer DEFAULT 50)
RETURNS TABLE (listing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT vl.id
  FROM public.vehicle_listings vl
  WHERE vl.status = 'draft'
    AND vl.sale_type IN ('auction', 'live_auction')
    AND vl.auction_start_time IS NOT NULL
    AND vl.auction_start_time <= now()
    AND (
      COALESCE(vl.auto_start_enabled, false) = true
      OR COALESCE(vl.schedule_strategy, 'manual') IN ('auto', 'premium')
      OR lower(COALESCE(vl.metadata->>'start_immediately', 'false')) IN ('true', 't', '1', 'yes')
    )
  ORDER BY vl.auction_start_time ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_due_auction_ends(p_limit integer DEFAULT 50)
RETURNS TABLE (listing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT vl.id
  FROM public.vehicle_listings vl
  WHERE vl.status = 'active'
    AND vl.sale_type IN ('auction', 'live_auction')
    AND vl.auction_end_time IS NOT NULL
    AND vl.auction_end_time <= now()
  ORDER BY vl.auction_end_time ASC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_due_auction_starts(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_due_auction_ends(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_auction_starts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_due_auction_ends(integer) TO service_role;

-- -----------------------------------------------------------------------------
-- place_auction_bid(): align with auction_bids schema and soft-close logic
-- -----------------------------------------------------------------------------
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
  v_starting_bid_cents bigint;
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
  SELECT *
  INTO v_listing
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

  -- Minimum bid:
  -- - If there is an existing high bid, enforce increments from it.
  -- - If no bids yet, enforce starting bid (or first increment if missing).
  IF v_current_high_bid_cents > 0 THEN
    v_increment := public.calculate_bid_increment(v_current_high_bid_cents);
    v_min_bid_cents := v_current_high_bid_cents + v_increment;
  ELSE
    v_min_bid_cents := CASE
      WHEN v_starting_bid_cents > 0 THEN v_starting_bid_cents
      ELSE public.calculate_bid_increment(0)
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

  -- Simplified proxy: displayed bid advances to the minimum; max remains secret.
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

  -- Create bid record
  INSERT INTO public.auction_bids (
    listing_id,
    bidder_id,
    proxy_max_bid_cents,
    displayed_bid_cents,
    is_winning,
    is_outbid,
    ip_address,
    user_agent,
    bid_source
  ) VALUES (
    p_listing_id,
    auth.uid(),
    p_proxy_max_bid_cents,
    v_displayed_bid_cents,
    true,
    false,
    p_ip_address,
    p_user_agent,
    p_bid_source
  ) RETURNING id INTO v_bid_id;

  -- Mark all previous winning bids as outbid
  UPDATE public.auction_bids
  SET
    is_winning = false,
    is_outbid = true,
    outbid_at = now(),
    updated_at = now()
  WHERE listing_id = p_listing_id
    AND is_winning = true
    AND bidder_id <> auth.uid();

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

-- -----------------------------------------------------------------------------
-- process_auction_end(): restrict to server/scheduler and enforce end-time
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_auction_end(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_listing record;
  v_reserve_met boolean;
BEGIN
  -- Server-only: do not allow random clients to end auctions early.
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT *
  INTO v_listing
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

  IF v_listing.auction_end_time IS NULL OR now() < v_listing.auction_end_time THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction has not ended yet');
  END IF;

  v_reserve_met := true;
  IF v_listing.reserve_price_cents IS NOT NULL THEN
    v_reserve_met := COALESCE(v_listing.current_high_bid_cents, 0) >= v_listing.reserve_price_cents;
  END IF;

  IF v_reserve_met AND v_listing.current_high_bid_cents IS NOT NULL AND v_listing.current_high_bid_cents > 0 THEN
    UPDATE public.vehicle_listings
    SET
      status = 'sold',
      sold_at = now(),
      final_price_cents = v_listing.current_high_bid_cents,
      buyer_id = v_listing.current_high_bidder_id,
      updated_at = now()
    WHERE id = p_listing_id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'sold',
      'final_price_cents', v_listing.current_high_bid_cents,
      'buyer_id', v_listing.current_high_bidder_id
    );
  END IF;

  UPDATE public.vehicle_listings
  SET
    status = 'expired',
    updated_at = now()
  WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'expired',
    'reserve_not_met', NOT v_reserve_met
  );
END;
$$;

-- Ensure only service role can execute directly (belt + suspenders).
REVOKE EXECUTE ON FUNCTION public.process_auction_end(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_auction_end(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- Premium timing purchase (rails): deduct from cash balance and mark listing premium
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_auction_premium_timing(
  p_listing_id uuid,
  p_budget_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_listing record;
  v_has_cash_deduct boolean := false;
BEGIN
  IF p_budget_cents IS NULL OR p_budget_cents <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Budget must be > 0');
  END IF;

  SELECT *
  INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;

  IF v_listing.seller_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Optional cash-balance integration: some deployments don't have this yet.
  v_has_cash_deduct := to_regprocedure('public.deduct_cash_from_user(uuid,bigint,text,uuid,uuid,jsonb)') IS NOT NULL;

  IF v_has_cash_deduct THEN
    -- Deduct from user's cash balance (throws on insufficient funds)
    EXECUTE 'select public.deduct_cash_from_user($1,$2,$3,$4,$5,$6)'
      USING
        auth.uid(),
        p_budget_cents,
        'auction_premium_timing',
        p_listing_id,
        NULL::uuid,
        jsonb_build_object('listing_id', p_listing_id);

    UPDATE public.vehicle_listings
    SET
      schedule_strategy = 'premium',
      premium_status = 'paid',
      premium_budget_cents = p_budget_cents,
      premium_paid_at = now(),
      premium_priority = GREATEST(COALESCE(premium_priority, 0), LEAST(1000000, (p_budget_cents / 1000)::int)),
      updated_at = now()
    WHERE id = p_listing_id;

    RETURN jsonb_build_object(
      'success', true,
      'listing_id', p_listing_id,
      'premium_budget_cents', p_budget_cents,
      'premium_status', 'paid'
    );
  END IF;

  -- No cash system yet: record intent so the app can route to Stripe later.
  UPDATE public.vehicle_listings
  SET
    schedule_strategy = 'premium',
    premium_status = 'pending_payment',
    premium_budget_cents = p_budget_cents,
    premium_paid_at = null,
    premium_priority = GREATEST(COALESCE(premium_priority, 0), LEAST(1000000, (p_budget_cents / 1000)::int)),
    updated_at = now()
  WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'success', true,
    'listing_id', p_listing_id,
    'premium_budget_cents', p_budget_cents,
    'premium_status', 'pending_payment',
    'note', 'Cash balance system not installed; payment required'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_auction_premium_timing(uuid, bigint) TO authenticated;

-- -----------------------------------------------------------------------------
-- Cron: run the auction scheduler edge function every minute
-- -----------------------------------------------------------------------------
SELECT cron.unschedule('auction-scheduler') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auction-scheduler'
);

SELECT cron.schedule(
  'auction-scheduler',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/auction-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'start_batch_size', 50,
      'end_batch_size', 50
    ),
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

