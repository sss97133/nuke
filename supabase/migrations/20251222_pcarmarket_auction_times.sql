-- PCarMarket Auction Time Parameters
-- Adds functions to calculate countdowns and time parameters for PCarMarket auctions

-- Function to calculate countdown from end date
CREATE OR REPLACE FUNCTION calculate_auction_countdown(end_date TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  now_time TIMESTAMPTZ := NOW();
  diff_seconds INTEGER;
  days INTEGER;
  hours INTEGER;
  minutes INTEGER;
  seconds INTEGER;
  result JSONB;
BEGIN
  IF end_date IS NULL THEN
    RETURN jsonb_build_object(
      'days', 0,
      'hours', 0,
      'minutes', 0,
      'seconds', 0,
      'total_seconds', 0,
      'is_expired', true,
      'formatted', 'No end date',
      'formatted_short', 'N/A'
    );
  END IF;
  
  diff_seconds := EXTRACT(EPOCH FROM (end_date - now_time))::INTEGER;
  
  IF diff_seconds <= 0 THEN
    RETURN jsonb_build_object(
      'days', 0,
      'hours', 0,
      'minutes', 0,
      'seconds', 0,
      'total_seconds', 0,
      'is_expired', true,
      'formatted', 'Auction ended',
      'formatted_short', 'Ended'
    );
  END IF;
  
  days := diff_seconds / 86400;
  hours := (diff_seconds % 86400) / 3600;
  minutes := (diff_seconds % 3600) / 60;
  seconds := diff_seconds % 60;
  
  result := jsonb_build_object(
    'days', days,
    'hours', hours,
    'minutes', minutes,
    'seconds', seconds,
    'total_seconds', diff_seconds,
    'is_expired', false,
    'formatted', 
      CASE 
        WHEN days > 0 THEN days || ' day' || CASE WHEN days != 1 THEN 's' ELSE '' END ||
          CASE WHEN hours > 0 THEN ', ' || hours || ' hour' || CASE WHEN hours != 1 THEN 's' ELSE '' END ELSE '' END
        WHEN hours > 0 THEN hours || ' hour' || CASE WHEN hours != 1 THEN 's' ELSE '' END ||
          CASE WHEN minutes > 0 THEN ', ' || minutes || ' minute' || CASE WHEN minutes != 1 THEN 's' ELSE '' END ELSE '' END
        WHEN minutes > 0 THEN minutes || ' minute' || CASE WHEN minutes != 1 THEN 's' ELSE '' END
        ELSE seconds || ' second' || CASE WHEN seconds != 1 THEN 's' ELSE '' END
      END,
    'formatted_short',
      CASE 
        WHEN days > 0 THEN days || 'd' || CASE WHEN hours > 0 THEN ' ' || hours || 'h' ELSE '' END
        WHEN hours > 0 THEN hours || 'h' || CASE WHEN minutes > 0 THEN ' ' || minutes || 'm' ELSE '' END
        WHEN minutes > 0 THEN minutes || 'm'
        ELSE seconds || 's'
      END
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get all time parameters for a vehicle
CREATE OR REPLACE FUNCTION get_vehicle_auction_times(vehicle_uuid UUID)
RETURNS JSONB AS $$
DECLARE
  v_vehicle RECORD;
  end_date TIMESTAMPTZ;
  start_date TIMESTAMPTZ;
  now_time TIMESTAMPTZ := NOW();
  result JSONB;
BEGIN
  SELECT 
    auction_end_date,
    origin_metadata->>'auction_times'->>'auction_start_date',
    origin_metadata->>'auction_times'->>'auction_end_date'
  INTO v_vehicle
  FROM vehicles
  WHERE id = vehicle_uuid;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;
  
  -- Get end date from various sources
  end_date := COALESCE(
    v_vehicle.auction_end_date,
    (v_vehicle.auction_end_date::text)::timestamptz,
    NULL
  );
  
  -- Get start date from metadata
  IF v_vehicle.auction_start_date IS NOT NULL THEN
    start_date := (v_vehicle.auction_start_date::text)::timestamptz;
  END IF;
  
  result := jsonb_build_object(
    'vehicle_id', vehicle_uuid,
    'auction_start_date', start_date,
    'auction_end_date', end_date,
    'current_time', now_time,
    'timezone', current_setting('timezone'),
    'countdown', calculate_auction_countdown(end_date),
    'time_remaining_seconds', 
      CASE WHEN end_date IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (end_date - now_time))::INTEGER 
        ELSE NULL 
      END,
    'time_since_start_seconds',
      CASE WHEN start_date IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (now_time - start_date))::INTEGER 
        ELSE NULL 
      END,
    'total_duration_seconds',
      CASE WHEN start_date IS NOT NULL AND end_date IS NOT NULL
        THEN EXTRACT(EPOCH FROM (end_date - start_date))::INTEGER
        ELSE NULL
      END,
    'is_active', 
      CASE 
        WHEN end_date IS NULL THEN false
        WHEN end_date > now_time AND (start_date IS NULL OR start_date <= now_time) THEN true
        ELSE false
      END,
    'is_ended', 
      CASE WHEN end_date IS NOT NULL AND end_date <= now_time THEN true ELSE false END,
    'is_upcoming',
      CASE WHEN start_date IS NOT NULL AND start_date > now_time THEN true ELSE false END
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create view for easy querying
CREATE OR REPLACE VIEW vehicle_auction_times AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.auction_end_date,
  v.origin_metadata->>'auction_times'->>'auction_start_date' as auction_start_date_metadata,
  calculate_auction_countdown(v.auction_end_date) as countdown,
  CASE 
    WHEN v.auction_end_date IS NULL THEN 'unknown'
    WHEN v.auction_end_date > NOW() THEN 'active'
    ELSE 'ended'
  END as auction_status,
  EXTRACT(EPOCH FROM (v.auction_end_date - NOW()))::INTEGER as time_remaining_seconds
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_end_date IS NOT NULL;

COMMENT ON FUNCTION calculate_auction_countdown IS 'Calculates countdown from auction end date';
COMMENT ON FUNCTION get_vehicle_auction_times IS 'Gets all time parameters for a PCarMarket vehicle auction';
COMMENT ON VIEW vehicle_auction_times IS 'View showing countdown and status for all PCarMarket auctions';

