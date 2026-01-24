-- Vehicle Live Metrics Triggers
-- Updates live metrics in real-time when observations arrive

-- Create the vehicle_live_metrics table if it doesn't exist
CREATE TABLE IF NOT EXISTS vehicle_live_metrics (
  vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id),
  observation_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  last_observation_at TIMESTAMPTZ,
  last_comment_text TEXT,
  last_bid_amount NUMERIC,
  sentiment_score NUMERIC,
  sentiment_updated_at TIMESTAMPTZ,
  is_active_auction BOOLEAN DEFAULT false,
  auction_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable realtime on the table
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_live_metrics;

-- Create index for active auctions
CREATE INDEX IF NOT EXISTS idx_live_metrics_active
ON vehicle_live_metrics(is_active_auction) WHERE is_active_auction = true;

-- Trigger function to update live metrics when observation arrives
CREATE OR REPLACE FUNCTION update_vehicle_live_metrics()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO vehicle_live_metrics (
    vehicle_id,
    observation_count,
    comment_count,
    bid_count,
    last_observation_at,
    last_comment_text,
    last_bid_amount,
    updated_at
  ) VALUES (
    NEW.vehicle_id,
    1,
    CASE WHEN NEW.kind = 'comment' THEN 1 ELSE 0 END,
    CASE WHEN NEW.kind = 'bid' THEN 1 ELSE 0 END,
    NEW.observed_at,
    CASE WHEN NEW.kind = 'comment' THEN NEW.content_text ELSE NULL END,
    CASE WHEN NEW.kind = 'bid' THEN (NEW.structured_data->>'bid_amount')::numeric ELSE NULL END,
    NOW()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    observation_count = vehicle_live_metrics.observation_count + 1,
    comment_count = vehicle_live_metrics.comment_count +
      CASE WHEN NEW.kind = 'comment' THEN 1 ELSE 0 END,
    bid_count = vehicle_live_metrics.bid_count +
      CASE WHEN NEW.kind = 'bid' THEN 1 ELSE 0 END,
    last_observation_at = GREATEST(vehicle_live_metrics.last_observation_at, NEW.observed_at),
    last_comment_text = CASE
      WHEN NEW.kind = 'comment' AND NEW.observed_at > COALESCE(vehicle_live_metrics.last_observation_at, '1970-01-01'::timestamptz)
      THEN NEW.content_text
      ELSE vehicle_live_metrics.last_comment_text
    END,
    last_bid_amount = CASE
      WHEN NEW.kind = 'bid'
      THEN GREATEST(
        COALESCE(vehicle_live_metrics.last_bid_amount, 0),
        COALESCE((NEW.structured_data->>'bid_amount')::numeric, 0)
      )
      ELSE vehicle_live_metrics.last_bid_amount
    END,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_update_live_metrics ON vehicle_observations;
CREATE TRIGGER trg_update_live_metrics
  AFTER INSERT ON vehicle_observations
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_live_metrics();

-- Function to mark vehicles with active auctions
CREATE OR REPLACE FUNCTION mark_active_auctions()
RETURNS void AS $$
BEGIN
  -- Mark auctions ending within next 7 days as active
  UPDATE vehicle_live_metrics vlm
  SET
    is_active_auction = true,
    auction_ends_at = ae.ends_at
  FROM auction_events ae
  WHERE vlm.vehicle_id = ae.vehicle_id
    AND ae.ends_at > NOW()
    AND ae.ends_at < NOW() + INTERVAL '7 days';

  -- Unmark auctions that have ended
  UPDATE vehicle_live_metrics
  SET is_active_auction = false
  WHERE auction_ends_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Queue table for incremental sentiment updates
CREATE TABLE IF NOT EXISTS sentiment_update_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_sentiment_queue_pending
ON sentiment_update_queue(priority DESC, created_at)
WHERE processed_at IS NULL;

-- Function to queue vehicle for sentiment update
CREATE OR REPLACE FUNCTION queue_sentiment_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if this is a text observation (comment, review, etc)
  IF NEW.kind IN ('comment', 'review', 'social_mention', 'forum_post') THEN
    INSERT INTO sentiment_update_queue (vehicle_id, priority)
    VALUES (
      NEW.vehicle_id,
      -- Higher priority for active auctions
      CASE
        WHEN EXISTS (
          SELECT 1 FROM vehicle_live_metrics
          WHERE vehicle_id = NEW.vehicle_id AND is_active_auction = true
        ) THEN 10
        ELSE 1
      END
    )
    ON CONFLICT (vehicle_id) DO UPDATE SET
      priority = GREATEST(sentiment_update_queue.priority, EXCLUDED.priority),
      created_at = NOW(),
      processed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the sentiment queue trigger
DROP TRIGGER IF EXISTS trg_queue_sentiment_update ON vehicle_observations;
CREATE TRIGGER trg_queue_sentiment_update
  AFTER INSERT ON vehicle_observations
  FOR EACH ROW
  EXECUTE FUNCTION queue_sentiment_update();
