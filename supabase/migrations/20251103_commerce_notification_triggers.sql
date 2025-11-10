-- =====================================================
-- COMMERCE NOTIFICATION TRIGGERS
-- Auto-create notifications for money-related events ONLY
-- =====================================================

-- Function to create offer received notification
CREATE OR REPLACE FUNCTION notify_offer_received()
RETURNS TRIGGER AS $$
DECLARE
  seller_id_var UUID;
  buyer_name_var TEXT;
  vehicle_name_var TEXT;
BEGIN
  -- Only create notification for new offers
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    -- Get seller_id from listing
    SELECT seller_id INTO seller_id_var
    FROM vehicle_listings
    WHERE id = NEW.listing_id;

    -- Get buyer name
    SELECT COALESCE(full_name, email, 'Anonymous')
    INTO buyer_name_var
    FROM profiles
    WHERE id = NEW.buyer_id;

    -- Get vehicle name
    SELECT CONCAT(v.year, ' ', v.make, ' ', v.model)
    INTO vehicle_name_var
    FROM vehicle_listings vl
    JOIN vehicles v ON v.id = vl.vehicle_id
    WHERE vl.id = NEW.listing_id;

    -- Create notification
    INSERT INTO user_notifications (
      user_id,
      type,
      title,
      message,
      metadata
    ) VALUES (
      seller_id_var,
      'offer_received',
      'Offer Received: $' || (NEW.offer_amount_cents / 100)::text,
      buyer_name_var || ' made an offer of $' || (NEW.offer_amount_cents / 100)::text || ' on your ' || vehicle_name_var,
      jsonb_build_object(
        'amount_cents', NEW.offer_amount_cents,
        'vehicle_name', vehicle_name_var,
        'listing_id', NEW.listing_id,
        'offer_id', NEW.id,
        'link_url', '/commerce'
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on vehicle_offers
DROP TRIGGER IF EXISTS trigger_notify_offer_received ON vehicle_offers;
CREATE TRIGGER trigger_notify_offer_received
  AFTER INSERT ON vehicle_offers
  FOR EACH ROW
  EXECUTE FUNCTION notify_offer_received();

-- Function to create sale completed notification
CREATE OR REPLACE FUNCTION notify_sale_completed()
RETURNS TRIGGER AS $$
DECLARE
  buyer_name_var TEXT;
  vehicle_name_var TEXT;
  vehicle_id_var UUID;
BEGIN
  -- Only create notification when status changes to 'sold'
  IF TG_OP = 'UPDATE' AND OLD.status != 'sold' AND NEW.status = 'sold' THEN
    -- Get buyer name
    SELECT COALESCE(full_name, email, 'Anonymous')
    INTO buyer_name_var
    FROM profiles
    WHERE id = NEW.buyer_id;

    -- Get vehicle name and ID
    SELECT CONCAT(v.year, ' ', v.make, ' ', v.model), v.id
    INTO vehicle_name_var, vehicle_id_var
    FROM vehicles v
    WHERE v.id = NEW.vehicle_id;

    -- Create notification
    INSERT INTO user_notifications (
      user_id,
      type,
      title,
      message,
      metadata
    ) VALUES (
      NEW.seller_id,
      'sale_completed',
      'SOLD: ' || vehicle_name_var,
      'Your ' || vehicle_name_var || ' sold for $' || (NEW.sold_price_cents / 100)::text || ' to ' || buyer_name_var,
      jsonb_build_object(
        'amount_cents', NEW.sold_price_cents,
        'vehicle_id', vehicle_id_var,
        'vehicle_name', vehicle_name_var,
        'buyer_id', NEW.buyer_id,
        'link_url', '/vehicles/' || vehicle_id_var::text
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on vehicle_listings
DROP TRIGGER IF EXISTS trigger_notify_sale_completed ON vehicle_listings;
CREATE TRIGGER trigger_notify_sale_completed
  AFTER UPDATE ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION notify_sale_completed();

-- Function to create price drop notification
CREATE OR REPLACE FUNCTION notify_price_drop()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_name_var TEXT;
  watcher_id UUID;
BEGIN
  -- Only notify on price decrease
  IF TG_OP = 'UPDATE' AND 
     OLD.asking_price_cents IS NOT NULL AND 
     NEW.asking_price_cents IS NOT NULL AND
     NEW.asking_price_cents < OLD.asking_price_cents THEN
    
    -- Get vehicle name
    SELECT CONCAT(v.year, ' ', v.make, ' ', v.model)
    INTO vehicle_name_var
    FROM vehicles v
    WHERE v.id = NEW.vehicle_id;

    -- Notify all users who have this vehicle in their watchlist
    -- (You'll need a vehicle_watchlist table for this to work)
    -- For now, commenting out as watchlist doesn't exist yet
    /*
    FOR watcher_id IN 
      SELECT user_id FROM vehicle_watchlist WHERE vehicle_id = NEW.vehicle_id
    LOOP
      INSERT INTO user_notifications (
        user_id,
        type,
        title,
        message,
        metadata
      ) VALUES (
        watcher_id,
        'price_drop',
        'Price Drop: ' || vehicle_name_var,
        vehicle_name_var || ' dropped from $' || (OLD.asking_price_cents / 100)::text || 
        ' to $' || (NEW.asking_price_cents / 100)::text || 
        ' (Save $' || ((OLD.asking_price_cents - NEW.asking_price_cents) / 100)::text || ')',
        jsonb_build_object(
          'amount_cents', NEW.asking_price_cents,
          'savings_cents', OLD.asking_price_cents - NEW.asking_price_cents,
          'vehicle_name', vehicle_name_var,
          'listing_id', NEW.id,
          'link_url', '/marketplace/' || NEW.id::text
        )
      );
    END LOOP;
    */
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on vehicle_listings
DROP TRIGGER IF EXISTS trigger_notify_price_drop ON vehicle_listings;
CREATE TRIGGER trigger_notify_price_drop
  AFTER UPDATE ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION notify_price_drop();

-- Function to create payment received notification
CREATE OR REPLACE FUNCTION notify_payment_received()
RETURNS TRIGGER AS $$
DECLARE
  payment_method_var TEXT;
BEGIN
  -- Only notify on completed deposits
  IF TG_OP = 'INSERT' AND 
     NEW.transaction_type = 'deposit' AND 
     NEW.status = 'completed' THEN
    
    -- Determine payment method from metadata
    payment_method_var := COALESCE(NEW.metadata->>'payment_method', 'Unknown');

    INSERT INTO user_notifications (
      user_id,
      type,
      title,
      message,
      metadata
    ) VALUES (
      NEW.user_id,
      'payment_received',
      'Payment Received: $' || (NEW.amount_cents / 100)::text,
      'You received $' || (NEW.amount_cents / 100)::text || ' via ' || payment_method_var,
      jsonb_build_object(
        'amount_cents', NEW.amount_cents,
        'payment_method', payment_method_var,
        'reference_id', NEW.reference_id,
        'link_url', '/wallet'
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on cash_transactions
DROP TRIGGER IF EXISTS trigger_notify_payment_received ON cash_transactions;
CREATE TRIGGER trigger_notify_payment_received
  AFTER INSERT ON cash_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_payment_received();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION notify_offer_received() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_sale_completed() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_price_drop() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_payment_received() TO authenticated;

COMMENT ON FUNCTION notify_offer_received() IS 'Auto-create notification when offer is received';
COMMENT ON FUNCTION notify_sale_completed() IS 'Auto-create notification when vehicle is sold';
COMMENT ON FUNCTION notify_price_drop() IS 'Auto-create notification when listing price drops';
COMMENT ON FUNCTION notify_payment_received() IS 'Auto-create notification when payment is received';

