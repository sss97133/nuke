-- Fix auction/commerce settlement: use final_price_cents + write timeline/vehicle sale signals
-- Rationale:
-- - vehicle_listings uses final_price_cents (sold_price_cents is legacy/missing).
-- - Auctions were "ending" in the UI, but no durable state was written to vehicles/timeline.
-- - Some triggers/functions referenced sold_price_cents and would error on sold transitions.

BEGIN;

-- -----------------------------------------------------------------------------
-- Fix notify_sale_completed(): vehicle_listings uses final_price_cents (not sold_price_cents)
-- Also fully-qualify tables to work with empty search_path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_sale_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  buyer_name_var TEXT;
  vehicle_name_var TEXT;
  vehicle_id_var UUID;
  amount_cents BIGINT;
BEGIN
  -- Only create notification when status changes to 'sold'
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'sold' AND NEW.status = 'sold' THEN
    -- Get buyer name
    SELECT COALESCE(full_name, email, 'Anonymous')
    INTO buyer_name_var
    FROM public.profiles
    WHERE id = NEW.buyer_id;

    -- Get vehicle name and ID
    SELECT CONCAT(v.year, ' ', v.make, ' ', v.model), v.id
    INTO vehicle_name_var, vehicle_id_var
    FROM public.vehicles v
    WHERE v.id = NEW.vehicle_id;

    -- vehicle_listings previously used sold_price_cents; canonical is now final_price_cents.
    -- Use to_jsonb(NEW) to avoid hard references to legacy columns.
    amount_cents := COALESCE(
      NULLIF((to_jsonb(NEW)->>'final_price_cents')::bigint, 0),
      NULLIF((to_jsonb(NEW)->>'sold_price_cents')::bigint, 0),
      NULLIF((to_jsonb(NEW)->>'current_high_bid_cents')::bigint, 0),
      0
    );

    -- Create notification
    INSERT INTO public.user_notifications (
      user_id,
      type,
      title,
      message,
      metadata
    ) VALUES (
      NEW.seller_id,
      'sale_completed',
      'SOLD: ' || COALESCE(vehicle_name_var, 'Vehicle'),
      'Your ' || COALESCE(vehicle_name_var, 'vehicle') || ' sold for $' || (amount_cents / 100)::text || ' to ' || COALESCE(buyer_name_var, 'Anonymous'),
      jsonb_build_object(
        'amount_cents', amount_cents,
        'vehicle_id', vehicle_id_var,
        'vehicle_name', vehicle_name_var,
        'buyer_id', NEW.buyer_id,
        'listing_id', NEW.id,
        'link_url', '/vehicle/' || vehicle_id_var::text
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix accept_vehicle_offer(): set final_price_cents (not sold_price_cents)
-- and fully-qualify table refs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_vehicle_offer(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_offer public.vehicle_offers;
  v_listing public.vehicle_listings;
BEGIN
  -- Get the offer
  SELECT * INTO v_offer FROM public.vehicle_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Offer not found');
  END IF;

  -- Get the listing
  SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = v_offer.listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;

  -- Check if user is the seller
  IF v_listing.seller_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Check if listing is still active
  IF v_listing.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing is no longer active');
  END IF;

  -- Update the offer
  UPDATE public.vehicle_offers
  SET
    status = 'accepted',
    responded_at = now(),
    updated_at = now()
  WHERE id = p_offer_id;

  -- Mark listing as sold
  UPDATE public.vehicle_listings
  SET
    status = 'sold',
    sold_at = now(),
    final_price_cents = v_offer.offer_amount_cents,
    buyer_id = v_offer.buyer_id,
    updated_at = now()
  WHERE id = v_listing.id;

  -- Reject all other offers
  UPDATE public.vehicle_offers
  SET
    status = 'rejected',
    responded_at = now(),
    updated_at = now()
  WHERE listing_id = v_listing.id
    AND id <> p_offer_id
    AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'listing_id', v_listing.id,
    'buyer_id', v_offer.buyer_id,
    'final_price_cents', v_offer.offer_amount_cents
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Apply auction outcomes to vehicles + timeline_events when a live auction ends.
-- This is the missing "something happened" signal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_auction_listing_outcome_to_vehicle_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_vehicle_name TEXT;
  v_final_cents BIGINT;
  v_final_usd INTEGER;
  v_high_cents BIGINT;
  v_high_usd INTEGER;
  v_outcome TEXT;
  v_event_type TEXT;
  v_title TEXT;
  v_desc TEXT;
  v_meta JSONB;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only handle auction-ish listings.
  IF NEW.sale_type NOT IN ('auction', 'live_auction') THEN
    RETURN NEW;
  END IF;

  -- Only handle terminal transitions.
  IF OLD.status <> 'active' OR NEW.status NOT IN ('sold', 'expired') THEN
    RETURN NEW;
  END IF;

  SELECT CONCAT(v.year, ' ', v.make, ' ', v.model)
  INTO v_vehicle_name
  FROM public.vehicles v
  WHERE v.id = NEW.vehicle_id;

  v_high_cents := COALESCE(NULLIF((to_jsonb(NEW)->>'current_high_bid_cents')::bigint, 0), 0);
  v_final_cents := COALESCE(NULLIF((to_jsonb(NEW)->>'final_price_cents')::bigint, 0), 0);

  v_high_usd := CASE WHEN v_high_cents > 0 THEN round(v_high_cents / 100.0)::int ELSE NULL END;
  v_final_usd := CASE
    WHEN v_final_cents > 0 THEN round(v_final_cents / 100.0)::int
    WHEN v_high_cents > 0 THEN round(v_high_cents / 100.0)::int
    ELSE NULL
  END;

  v_meta := jsonb_build_object(
    'listing_id', NEW.id,
    'sale_type', NEW.sale_type,
    'ended_at', now(),
    'auction_end_time', NEW.auction_end_time,
    'reserve_price_cents', NEW.reserve_price_cents,
    'bid_count', NEW.bid_count,
    'current_high_bid_cents', NEW.current_high_bid_cents,
    'final_price_cents', NEW.final_price_cents,
    'buyer_id', NEW.buyer_id
  );

  IF NEW.status = 'sold' THEN
    -- Vehicles: write SOLD facts so the profile updates instantly.
    UPDATE public.vehicles
    SET
      sale_price = COALESCE(v_final_usd, sale_price),
      sale_date = COALESCE(current_date, sale_date),
      sale_status = 'sold',
      auction_outcome = 'sold',
      is_for_sale = false,
      asking_price = NULL,
      auction_end_date = COALESCE(NEW.auction_end_time::text, auction_end_date)
    WHERE id = NEW.vehicle_id;

    v_event_type := 'auction_sold';
    v_title := 'Auction sold';
    v_desc := COALESCE(v_vehicle_name, 'Vehicle') || ' sold at auction for ' ||
      CASE WHEN v_final_usd IS NULL THEN '—' ELSE ('$' || v_final_usd::text) END || '.';

    INSERT INTO public.timeline_events (
      vehicle_id,
      user_id,
      event_type,
      source,
      title,
      description,
      event_date,
      source_type,
      event_category,
      cost_amount,
      cost_currency,
      metadata,
      data_source,
      confidence_score
    ) VALUES (
      NEW.vehicle_id,
      NULL,
      v_event_type,
      'nzero_auction',
      v_title,
      v_desc,
      current_date,
      'dealer_record',
      'ownership',
      v_final_usd,
      'USD',
      v_meta,
      'auction_scheduler',
      95
    );

    RETURN NEW;
  END IF;

  -- expired: reserve not met or no bids
  v_outcome := CASE
    WHEN v_high_cents > 0 AND NEW.reserve_price_cents IS NOT NULL AND v_high_cents < NEW.reserve_price_cents THEN 'reserve_not_met'
    WHEN v_high_cents > 0 THEN 'no_sale'
    ELSE 'no_sale'
  END;

  UPDATE public.vehicles
  SET
    sale_status = 'ended',
    auction_outcome = v_outcome,
    high_bid = CASE WHEN v_high_usd IS NOT NULL AND v_high_usd > 0 THEN v_high_usd ELSE high_bid END,
    auction_end_date = COALESCE(NEW.auction_end_time::text, auction_end_date),
    is_for_sale = false
  WHERE id = NEW.vehicle_id;

  v_event_type := CASE WHEN v_high_cents > 0 THEN 'auction_reserve_not_met' ELSE 'auction_ended' END;
  v_title := CASE WHEN v_high_cents > 0 THEN 'Auction ended (reserve not met)' ELSE 'Auction ended' END;
  v_desc := CASE
    WHEN v_high_cents > 0 THEN
      COALESCE(v_vehicle_name, 'Vehicle') || ' auction ended. High bid: $' || v_high_usd::text ||
      CASE
        WHEN NEW.reserve_price_cents IS NOT NULL THEN ' (reserve: $' || round(NEW.reserve_price_cents / 100.0)::int::text || ').'
        ELSE '.'
      END
    ELSE
      COALESCE(v_vehicle_name, 'Vehicle') || ' auction ended with no bids.'
  END;

  INSERT INTO public.timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    title,
    description,
    event_date,
    source_type,
    event_category,
    cost_amount,
    cost_currency,
    metadata,
    data_source,
    confidence_score
  ) VALUES (
    NEW.vehicle_id,
    NULL,
    v_event_type,
    'nzero_auction',
    v_title,
    v_desc,
    current_date,
    'dealer_record',
    'ownership',
    CASE WHEN v_high_usd IS NULL THEN NULL ELSE v_high_usd END,
    'USD',
    v_meta,
    'auction_scheduler',
    90
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_apply_auction_listing_outcome_to_vehicle_timeline ON public.vehicle_listings;
CREATE TRIGGER trigger_apply_auction_listing_outcome_to_vehicle_timeline
  AFTER UPDATE OF status ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_auction_listing_outcome_to_vehicle_timeline();

COMMIT;

