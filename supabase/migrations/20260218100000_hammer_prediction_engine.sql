-- Hammer Price Prediction Engine
-- Tracks predictions on live auctions, measures accuracy, stores model coefficients

-- Bid curve multipliers by price tier (trained from historical data)
-- "If a car is at $X with Y hours to close, multiply by Z to get predicted hammer"
CREATE TABLE IF NOT EXISTS prediction_model_coefficients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version int NOT NULL DEFAULT 1,
  price_tier text NOT NULL, -- under_15k, 15k_30k, 30k_60k, 60k_100k, 100k_200k, over_200k
  time_window text NOT NULL, -- 48h, 24h, 12h, 6h, 2h, 30m, 2m
  median_multiplier numeric NOT NULL,
  p25_multiplier numeric, -- 25th percentile (conservative)
  p75_multiplier numeric, -- 75th percentile (aggressive)
  sample_size int NOT NULL DEFAULT 0,
  trained_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_version, price_tier, time_window)
);

-- Seed with the training data we just computed
INSERT INTO prediction_model_coefficients (model_version, price_tier, time_window, median_multiplier, sample_size)
VALUES
  -- under_15k
  (1, 'under_15k', '48h', 2.000, 112),
  (1, 'under_15k', '24h', 1.633, 112),
  (1, 'under_15k', '12h', 1.522, 112),
  (1, 'under_15k', '6h', 1.467, 112),
  (1, 'under_15k', '2h', 1.383, 112),
  (1, 'under_15k', '30m', 1.286, 112),
  (1, 'under_15k', '2m', 1.000, 112),
  -- 15k_30k
  (1, '15k_30k', '48h', 2.045, 85),
  (1, '15k_30k', '24h', 1.786, 85),
  (1, '15k_30k', '12h', 1.563, 85),
  (1, '15k_30k', '6h', 1.563, 85),
  (1, '15k_30k', '2h', 1.457, 85),
  (1, '15k_30k', '30m', 1.314, 85),
  (1, '15k_30k', '2m', 1.000, 85),
  -- 30k_60k
  (1, '30k_60k', '48h', 1.581, 61),
  (1, '30k_60k', '24h', 1.544, 61),
  (1, '30k_60k', '12h', 1.452, 61),
  (1, '30k_60k', '6h', 1.401, 61),
  (1, '30k_60k', '2h', 1.333, 61),
  (1, '30k_60k', '30m', 1.250, 61),
  (1, '30k_60k', '2m', 1.000, 61),
  -- 60k_100k
  (1, '60k_100k', '48h', 1.380, 17),
  (1, '60k_100k', '24h', 1.343, 17),
  (1, '60k_100k', '12h', 1.283, 17),
  (1, '60k_100k', '6h', 1.283, 17),
  (1, '60k_100k', '2h', 1.229, 17),
  (1, '60k_100k', '30m', 1.160, 17),
  (1, '60k_100k', '2m', 1.000, 17),
  -- 100k_200k
  (1, '100k_200k', '48h', 1.486, 12),
  (1, '100k_200k', '24h', 1.476, 12),
  (1, '100k_200k', '12h', 1.271, 12),
  (1, '100k_200k', '6h', 1.271, 12),
  (1, '100k_200k', '2h', 1.256, 12),
  (1, '100k_200k', '30m', 1.164, 12),
  (1, '100k_200k', '2m', 1.000, 12),
  -- over_200k
  (1, 'over_200k', '48h', 1.077, 4),
  (1, 'over_200k', '24h', 1.077, 4),
  (1, 'over_200k', '12h', 1.074, 4),
  (1, 'over_200k', '6h', 1.074, 4),
  (1, 'over_200k', '2h', 1.033, 4),
  (1, 'over_200k', '30m', 1.022, 4),
  (1, 'over_200k', '2m', 1.000, 4)
ON CONFLICT (model_version, price_tier, time_window) DO UPDATE
  SET median_multiplier = EXCLUDED.median_multiplier,
      sample_size = EXCLUDED.sample_size,
      trained_at = now();

-- Predictions table: every prediction we make, tracked for accuracy
CREATE TABLE IF NOT EXISTS hammer_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  external_listing_id uuid REFERENCES external_listings(id),
  -- Prediction inputs (snapshot at prediction time)
  current_bid numeric NOT NULL,
  bid_count int,
  view_count int,
  watcher_count int,
  unique_bidders int,
  hours_remaining numeric, -- hours until auction close
  time_window text, -- which coefficient window was used
  price_tier text,
  model_version int NOT NULL DEFAULT 1,
  -- Bid curve features
  bid_velocity numeric, -- bids per hour
  bid_to_watcher_ratio numeric,
  watcher_to_view_ratio numeric,
  -- Comp data
  comp_median numeric, -- median sale price for same make/model
  comp_count int, -- number of comps found
  -- Prediction outputs
  predicted_hammer numeric NOT NULL,
  predicted_low numeric, -- conservative (p25)
  predicted_high numeric, -- aggressive (p75)
  multiplier_used numeric,
  confidence_score numeric, -- 0-100
  -- Flip analysis
  predicted_margin numeric, -- predicted_hammer - current_bid
  predicted_flip_margin numeric, -- predicted_hammer - comp_adjusted_buy_price
  buy_recommendation text, -- 'strong_buy', 'buy', 'hold', 'pass'
  -- Accuracy tracking (filled in after auction closes)
  actual_hammer numeric,
  prediction_error_pct numeric,
  prediction_error_usd numeric,
  scored_at timestamptz, -- when accuracy was computed
  -- Metadata
  predicted_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_hammer_predictions_vehicle ON hammer_predictions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_hammer_predictions_predicted_at ON hammer_predictions(predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hammer_predictions_unscored ON hammer_predictions(scored_at)
  WHERE scored_at IS NULL AND actual_hammer IS NULL;

-- Paper trades: fantasy flip tracking
CREATE TABLE IF NOT EXISTS paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  prediction_id uuid REFERENCES hammer_predictions(id),
  -- The "buy" call
  entry_price numeric NOT NULL, -- price you'd buy at (current bid at time of call)
  entry_time timestamptz NOT NULL DEFAULT now(),
  predicted_hammer numeric NOT NULL,
  predicted_flip_profit numeric, -- predicted_hammer - entry_price - estimated_fees
  -- Auction fees estimate (BaT: 5% buyer premium, capped $7,500)
  estimated_buyer_fee numeric,
  estimated_seller_fee numeric,
  -- What actually happened
  actual_hammer numeric,
  actual_profit numeric, -- actual_hammer - entry_price - actual_fees
  -- Scoring
  call_accuracy_pct numeric, -- how close was predicted_hammer to actual
  profitable boolean, -- did the trade make money?
  closed_at timestamptz,
  -- Context
  rationale text, -- why this was flagged as a buy
  platform text DEFAULT 'bat',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_vehicle ON paper_trades(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_open ON paper_trades(closed_at) WHERE closed_at IS NULL;

-- Function to determine price tier from a bid amount
CREATE OR REPLACE FUNCTION get_price_tier(bid numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN bid < 15000 THEN 'under_15k'
    WHEN bid < 30000 THEN '15k_30k'
    WHEN bid < 60000 THEN '30k_60k'
    WHEN bid < 100000 THEN '60k_100k'
    WHEN bid < 200000 THEN '100k_200k'
    ELSE 'over_200k'
  END;
$$;

-- Function to get the appropriate time window from hours remaining
CREATE OR REPLACE FUNCTION get_time_window(hours_left numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN hours_left > 36 THEN '48h'
    WHEN hours_left > 18 THEN '24h'
    WHEN hours_left > 9 THEN '12h'
    WHEN hours_left > 4 THEN '6h'
    WHEN hours_left > 1 THEN '2h'
    WHEN hours_left > 0.25 THEN '30m'
    ELSE '2m'
  END;
$$;

-- Function to score predictions after auctions close
CREATE OR REPLACE FUNCTION score_closed_predictions() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  scored_count int := 0;
BEGIN
  -- Update predictions where the auction has closed and we have a final price
  UPDATE hammer_predictions hp
  SET
    actual_hammer = el.final_price,
    prediction_error_pct = ROUND(((hp.predicted_hammer - el.final_price) / NULLIF(el.final_price, 0) * 100)::numeric, 2),
    prediction_error_usd = (hp.predicted_hammer - el.final_price)::numeric,
    scored_at = now()
  FROM external_listings el
  WHERE el.id = hp.external_listing_id
    AND el.final_price > 0
    AND el.listing_status = 'sold'
    AND hp.scored_at IS NULL
    AND hp.actual_hammer IS NULL;

  GET DIAGNOSTICS scored_count = ROW_COUNT;

  -- Also score paper trades
  UPDATE paper_trades pt
  SET
    actual_hammer = el.final_price,
    actual_profit = el.final_price - pt.entry_price - COALESCE(pt.estimated_buyer_fee, 0),
    call_accuracy_pct = ROUND(((pt.predicted_hammer - el.final_price) / NULLIF(el.final_price, 0) * 100)::numeric, 2),
    profitable = (el.final_price - pt.entry_price - COALESCE(pt.estimated_buyer_fee, 0)) > 0,
    closed_at = now()
  FROM external_listings el
  JOIN vehicles v ON v.id = pt.vehicle_id
  WHERE el.vehicle_id = pt.vehicle_id
    AND el.final_price > 0
    AND el.listing_status = 'sold'
    AND pt.closed_at IS NULL;

  RETURN scored_count;
END;
$$;

-- View: prediction accuracy leaderboard
CREATE OR REPLACE VIEW prediction_accuracy AS
SELECT
  model_version,
  COUNT(*) as total_predictions,
  COUNT(actual_hammer) as scored,
  ROUND(AVG(ABS(prediction_error_pct)), 2) as avg_abs_error_pct,
  ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(prediction_error_pct)))::numeric, 2) as median_abs_error_pct,
  ROUND(AVG(prediction_error_pct), 2) as avg_bias_pct, -- positive = overestimates, negative = underestimates
  COUNT(*) FILTER (WHERE ABS(prediction_error_pct) < 5) as within_5pct,
  COUNT(*) FILTER (WHERE ABS(prediction_error_pct) < 10) as within_10pct,
  COUNT(*) FILTER (WHERE ABS(prediction_error_pct) < 20) as within_20pct
FROM hammer_predictions
WHERE scored_at IS NOT NULL
GROUP BY model_version;

-- View: paper trade P&L
CREATE OR REPLACE VIEW paper_trade_pnl AS
SELECT
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE closed_at IS NOT NULL) as closed_trades,
  COUNT(*) FILTER (WHERE profitable = true) as winning_trades,
  COUNT(*) FILTER (WHERE profitable = false) as losing_trades,
  ROUND(
    COUNT(*) FILTER (WHERE profitable = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE closed_at IS NOT NULL), 0) * 100, 1
  ) as win_rate_pct,
  ROUND(SUM(actual_profit)::numeric, 0) as total_pnl,
  ROUND(AVG(actual_profit)::numeric, 0) as avg_profit_per_trade,
  ROUND(AVG(actual_profit) FILTER (WHERE profitable = true)::numeric, 0) as avg_win,
  ROUND(AVG(actual_profit) FILTER (WHERE profitable = false)::numeric, 0) as avg_loss
FROM paper_trades;
