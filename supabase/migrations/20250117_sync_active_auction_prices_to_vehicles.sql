-- ============================================================================
-- SYNC ACTIVE AUCTION PRICES TO VEHICLES TABLE
-- ============================================================================
-- Purpose: When external_listings are synced and current_bid/bid_count change,
--          automatically update the vehicles table so prices show up in the UI.
--
-- This ensures that when sync-active-auctions updates external_listings,
-- the vehicles table also gets updated with current_bid, winning_bid, bid_count.
-- ============================================================================

-- Function to sync active auction prices from external_listings to vehicles
CREATE OR REPLACE FUNCTION sync_active_auction_prices_to_vehicles()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only process ACTIVE listings (sold listings are handled by auto_mark_vehicle_sold)
  IF NEW.listing_status = 'active' AND NEW.vehicle_id IS NOT NULL THEN
    
    -- Update vehicles table with current auction data
    -- Note: vehicles table has: winning_bid (integer), high_bid (integer), bid_count (integer), asking_price (numeric)
    -- external_listings has: current_bid (numeric), bid_count (integer)
    UPDATE vehicles
    SET 
      -- For active auctions, use current_bid as winning_bid (it's the highest bid so far)
      winning_bid = CASE 
        WHEN NEW.current_bid IS NOT NULL AND NEW.current_bid > 0 THEN NEW.current_bid::integer
        ELSE vehicles.winning_bid -- Keep existing if no new bid
      END,
      -- Update high_bid (same as current_bid for active auctions)
      high_bid = CASE 
        WHEN NEW.current_bid IS NOT NULL AND NEW.current_bid > 0 THEN NEW.current_bid::integer
        ELSE vehicles.high_bid
      END,
      -- Update asking_price with current_bid if asking_price is null or lower
      asking_price = CASE 
        WHEN NEW.current_bid IS NOT NULL AND NEW.current_bid > 0 THEN 
          COALESCE(GREATEST(NEW.current_bid, vehicles.asking_price), NEW.current_bid)
        ELSE vehicles.asking_price
      END,
      -- Update bid_count
      bid_count = CASE 
        WHEN NEW.bid_count IS NOT NULL AND NEW.bid_count > 0 THEN NEW.bid_count
        ELSE COALESCE(vehicles.bid_count, 0)
      END,
      updated_at = NOW()
    WHERE 
      id = NEW.vehicle_id
      -- Only update if something actually changed
      AND (
        (NEW.current_bid IS NOT NULL AND NEW.current_bid::integer != COALESCE(vehicles.winning_bid, 0))
        OR (NEW.bid_count IS NOT NULL AND NEW.bid_count != COALESCE(vehicles.bid_count, 0))
      );
      
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to sync prices when external_listings are updated
DROP TRIGGER IF EXISTS trigger_sync_active_auction_prices ON external_listings;
CREATE TRIGGER trigger_sync_active_auction_prices
  AFTER INSERT OR UPDATE OF current_bid, bid_count, listing_status
  ON external_listings
  FOR EACH ROW
  WHEN (NEW.listing_status = 'active' AND NEW.current_bid IS NOT NULL)
  EXECUTE FUNCTION sync_active_auction_prices_to_vehicles();

COMMENT ON FUNCTION sync_active_auction_prices_to_vehicles IS 'Syncs current_bid and bid_count from active external_listings to vehicles table so prices show up in UI';

