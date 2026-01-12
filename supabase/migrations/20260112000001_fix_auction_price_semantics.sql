-- ============================================================================
-- FIX AUCTION PRICE SEMANTICS (BID IS BID)
-- ============================================================================
-- Goals:
-- - Active auctions: sync current_bid -> vehicles.high_bid ONLY (do NOT write vehicles.winning_bid)
-- - Sold auctions: set vehicles.winning_bid (and high_bid) from final_price/current_bid
-- - Keep vehicles.asking_price reserved for "for sale ask" (never auction bid)
-- - Clean up legacy contamination where winning_bid == high_bid on non-sold vehicles
--
-- NOTE:
-- - external_listings is the canonical landing pad for all external auction platforms.
-- - auction_events stores platform-specific outcomes + analytics.
-- - vehicles.* fields are UI caches / snapshots and must preserve semantics.

-- ============================================================================
-- 1) Active auction sync: do NOT write winning_bid
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_active_auction_prices_to_vehicles()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only process ACTIVE listings (sold listings are handled by auto_mark_vehicle_sold)
  IF NEW.listing_status = 'active' AND NEW.vehicle_id IS NOT NULL THEN

    UPDATE vehicles
    SET
      -- Active auctions: high_bid is the "highest bid so far" cache
      high_bid = CASE
        WHEN NEW.current_bid IS NOT NULL AND NEW.current_bid > 0 THEN NEW.current_bid::integer
        ELSE vehicles.high_bid
      END,
      -- winning_bid is reserved for SOLD outcomes; do not set here.
      bid_count = CASE
        WHEN NEW.bid_count IS NOT NULL AND NEW.bid_count > 0 THEN NEW.bid_count
        ELSE COALESCE(vehicles.bid_count, 0)
      END,
      updated_at = NOW()
    WHERE
      id = NEW.vehicle_id
      AND (
        (NEW.current_bid IS NOT NULL AND NEW.current_bid::integer != COALESCE(vehicles.high_bid, 0))
        OR (NEW.bid_count IS NOT NULL AND NEW.bid_count != COALESCE(vehicles.bid_count, 0))
      );

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_active_auction_prices ON public.external_listings;
CREATE TRIGGER trigger_sync_active_auction_prices
  AFTER INSERT OR UPDATE OF current_bid, bid_count, listing_status
  ON public.external_listings
  FOR EACH ROW
  WHEN (NEW.listing_status = 'active' AND NEW.current_bid IS NOT NULL)
  EXECUTE FUNCTION public.sync_active_auction_prices_to_vehicles();

COMMENT ON FUNCTION public.sync_active_auction_prices_to_vehicles IS
  'Syncs current_bid/bid_count from active external_listings to vehicles.high_bid/bid_count. Does not write vehicles.winning_bid.';

-- ============================================================================
-- 2) Sold sync: write winning_bid/high_bid for SOLD outcomes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_mark_vehicle_sold_from_external_listing()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows INTEGER;
  sale_amount NUMERIC;
BEGIN
  -- Only process when listing_status changes to 'sold'
  IF NEW.listing_status = 'sold' AND (OLD.listing_status IS NULL OR OLD.listing_status != 'sold') THEN

    affected_rows := 0;
    sale_amount := COALESCE(NEW.final_price, NEW.current_bid);

    -- Update organization_vehicles for this vehicle and organization (best-effort)
    IF NEW.organization_id IS NOT NULL THEN
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        listing_status,
        sale_date,
        sale_price,
        status,
        updated_at
      )
      VALUES (
        NEW.organization_id,
        NEW.vehicle_id,
        'sold_by',
        'sold',
        COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, CURRENT_DATE),
        sale_amount,
        'past',
        NOW()
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type)
      DO UPDATE SET
        listing_status = 'sold',
        sale_date = COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, organization_vehicles.sale_date),
        sale_price = COALESCE(sale_amount, organization_vehicles.sale_price),
        status = 'past',
        updated_at = NOW()
      WHERE (organization_vehicles.listing_status IS NULL OR organization_vehicles.listing_status != 'sold');

      GET DIAGNOSTICS affected_rows = ROW_COUNT;

      IF affected_rows > 0 THEN
        RAISE NOTICE 'Auto-marked vehicle % as sold_by for organization % (from external listing %)',
          NEW.vehicle_id, NEW.organization_id, NEW.id;
      END IF;
    END IF;

    -- Update vehicles table sale fields + auction bid semantics
    UPDATE vehicles
    SET
      sale_price = COALESCE(sale_amount, vehicles.sale_price),
      sale_date = COALESCE(NEW.sold_at::DATE, NEW.end_date::DATE, vehicles.sale_date),
      sale_status = 'sold',
      auction_outcome = 'sold',
      -- winning_bid is the final winning amount (SOLD only)
      winning_bid = COALESCE(sale_amount, vehicles.winning_bid),
      -- high_bid: keep aligned with final outcome when sold
      high_bid = COALESCE(sale_amount, vehicles.high_bid),
      bid_count = COALESCE(NEW.bid_count, vehicles.bid_count),
      updated_at = NOW()
    WHERE
      id = NEW.vehicle_id
      AND (sale_status IS NULL OR sale_status != 'sold'); -- Only update if not already sold

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_mark_vehicle_sold ON public.external_listings;
CREATE TRIGGER trigger_auto_mark_vehicle_sold
  AFTER INSERT OR UPDATE OF listing_status, final_price, sold_at, end_date
  ON public.external_listings
  FOR EACH ROW
  WHEN (NEW.listing_status = 'sold')
  EXECUTE FUNCTION public.auto_mark_vehicle_sold_from_external_listing();

COMMENT ON FUNCTION public.auto_mark_vehicle_sold_from_external_listing IS
  'Marks vehicles as sold when external_listings status becomes sold. Writes vehicles.sale_price/sale_status and sets vehicles.winning_bid/high_bid from final_price/current_bid.';

-- ============================================================================
-- 3) Cleanup: legacy contamination (winning_bid set from active bid)
-- ============================================================================
UPDATE vehicles
SET
  winning_bid = NULL,
  updated_at = NOW()
WHERE winning_bid IS NOT NULL
  AND winning_bid > 0
  AND high_bid IS NOT NULL
  AND winning_bid = high_bid
  AND COALESCE(sale_status, '') <> 'sold'
  AND COALESCE(auction_outcome, '') <> 'sold';

