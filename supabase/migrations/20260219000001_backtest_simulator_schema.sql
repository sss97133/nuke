-- Backtest Hammer Simulator schema
-- Stores backtest run results and per-auction detail rows

-- Critical performance index: bat_bids lookups by vehicle + timestamp
CREATE INDEX IF NOT EXISTS idx_bat_bids_vehicle_timestamp
  ON bat_bids(vehicle_id, bid_timestamp DESC);

-- Backtest run summary table
CREATE TABLE IF NOT EXISTS backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL, -- full_backtest, compare_models, tune_sniper, suggest_coefficients
  model_version int NOT NULL DEFAULT 1,
  compare_model_version int, -- for compare_models mode
  -- Run parameters
  lookback_days int,
  auction_count int NOT NULL DEFAULT 0,
  limit_requested int,
  -- Aggregate metrics
  mape numeric, -- mean absolute percentage error
  median_ape numeric,
  bias_pct numeric, -- avg signed error (positive = overestimates)
  within_5pct_rate numeric,
  within_10pct_rate numeric,
  within_20pct_rate numeric,
  -- 6x7 accuracy matrix: { "under_15k:2h": { mape, n, optimal_mult, ... }, ... }
  tier_window_matrix jsonb,
  -- Suggested coefficients (for suggest_coefficients mode)
  suggested_coefficients jsonb,
  -- Sniper tuning results (for tune_sniper mode)
  sniper_tuning_results jsonb,
  -- Model comparison diff (for compare_models mode)
  comparison_diff jsonb,
  -- Status
  status text NOT NULL DEFAULT 'running', -- running, completed, partial, failed
  error_message text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created
  ON backtest_runs(created_at DESC);

-- Per-auction per-window prediction detail
CREATE TABLE IF NOT EXISTS backtest_run_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  -- Auction info
  actual_hammer numeric NOT NULL,
  close_time timestamptz,
  -- Prediction at this time window
  time_window text NOT NULL, -- 48h, 24h, 12h, 6h, 2h, 30m, 2m
  bid_at_window numeric, -- highest bid at this time offset
  price_tier text,
  -- Prediction result
  predicted_hammer numeric,
  multiplier_used numeric,
  sniper_pct_used numeric,
  -- Error
  error_pct numeric, -- (predicted - actual) / actual * 100
  abs_error_pct numeric,
  -- Optimal multiplier for this auction at this window
  optimal_multiplier numeric, -- actual / (bid * (1 + sniper/100))
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backtest_details_run
  ON backtest_run_details(run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_details_window
  ON backtest_run_details(time_window, price_tier);
