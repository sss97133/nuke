-- Advanced Financial Metrics
-- Institutional-grade performance metrics (IRR, TWR, VaR, Alpha/Beta)
-- Part of Phase 2: Institutional-Grade Financial Infrastructure

-- Cash flows for IRR calculation
CREATE TABLE IF NOT EXISTS investment_cash_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('index', 'vehicle', 'offering')),
  asset_id UUID NOT NULL,
  cash_flow_date DATE NOT NULL,
  cash_flow_type TEXT NOT NULL CHECK (cash_flow_type IN (
    'initial_investment', 'additional_investment', 'dividend',
    'distribution', 'redemption', 'fee', 'adjustment'
  )),
  amount NUMERIC(15,2) NOT NULL, -- Negative=outflow, Positive=inflow
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for cash flows
CREATE INDEX IF NOT EXISTS idx_cash_flows_user ON investment_cash_flows(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_flows_asset ON investment_cash_flows(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_cash_flows_date ON investment_cash_flows(cash_flow_date);
CREATE INDEX IF NOT EXISTS idx_cash_flows_type ON investment_cash_flows(cash_flow_type);

-- Benchmarks for Alpha/Beta (Hagerty + Internal)
CREATE TABLE IF NOT EXISTS market_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_code TEXT UNIQUE NOT NULL,
  benchmark_name TEXT NOT NULL,
  benchmark_type TEXT NOT NULL CHECK (benchmark_type IN ('internal', 'hagerty', 'composite', 'custom')),
  data_source TEXT CHECK (data_source IN ('calculated', 'hagerty_api', 'manual', 'import')),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with initial benchmarks
INSERT INTO market_benchmarks (benchmark_code, benchmark_name, benchmark_type, data_source, description) VALUES
('HAGERTY_BLUE_CHIP', 'Hagerty Blue Chip Index', 'hagerty', 'hagerty_api', 'High-value collector vehicles'),
('HAGERTY_AFFORDABLE', 'Hagerty Affordable Classics', 'hagerty', 'hagerty_api', 'Entry-level collector vehicles'),
('HAGERTY_MUSCLE', 'Hagerty Muscle Car Index', 'hagerty', 'hagerty_api', 'American muscle cars'),
('SQBDY-50', 'Nuke Squarebody 50', 'internal', 'calculated', 'Top 50 squarebody trucks by value'),
('CLSC-100', 'Nuke Classic 100', 'internal', 'calculated', 'Top 100 classic vehicles'),
('TRUCK-ALL', 'All Trucks Composite', 'composite', 'calculated', 'Composite of all truck segments')
ON CONFLICT (benchmark_code) DO NOTHING;

-- Benchmark values (time series)
CREATE TABLE IF NOT EXISTS benchmark_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_id UUID NOT NULL REFERENCES market_benchmarks(id) ON DELETE CASCADE,
  value_date DATE NOT NULL,
  value NUMERIC(15,4) NOT NULL,
  daily_return NUMERIC(10,6),
  cumulative_return NUMERIC(10,6),
  volume INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(benchmark_id, value_date)
);

-- Indexes for benchmark values
CREATE INDEX IF NOT EXISTS idx_benchmark_values_date ON benchmark_values(value_date);
CREATE INDEX IF NOT EXISTS idx_benchmark_values_benchmark ON benchmark_values(benchmark_id, value_date);

-- Pre-calculated metrics (computed daily)
CREATE TABLE IF NOT EXISTS asset_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('index', 'vehicle', 'offering', 'portfolio')),
  asset_id UUID NOT NULL,
  calculation_date DATE NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y', 'since_inception')),

  -- Returns
  total_return NUMERIC(10,4),
  annualized_return NUMERIC(10,4),
  twr_return NUMERIC(10,4), -- Time-Weighted Return
  irr NUMERIC(10,4), -- Internal Rate of Return

  -- Risk metrics
  volatility_annualized NUMERIC(10,4),
  max_drawdown NUMERIC(10,4),
  sharpe_ratio NUMERIC(8,4),
  sortino_ratio NUMERIC(8,4),
  calmar_ratio NUMERIC(8,4),
  var_95_1d NUMERIC(15,2), -- Value at Risk (95%, 1-day)
  cvar_95_1d NUMERIC(15,2), -- Conditional VaR (Expected Shortfall)
  var_99_1d NUMERIC(15,2),

  -- Benchmark comparison
  benchmark_id UUID REFERENCES market_benchmarks(id),
  alpha NUMERIC(8,4),
  beta NUMERIC(8,4),
  r_squared NUMERIC(8,4),
  tracking_error NUMERIC(8,4),
  information_ratio NUMERIC(8,4),

  -- Metadata
  calculation_method TEXT DEFAULT 'standard',
  data_points INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(asset_type, asset_id, calculation_date, period)
);

-- Indexes for performance metrics
CREATE INDEX IF NOT EXISTS idx_perf_metrics_asset ON asset_performance_metrics(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_date ON asset_performance_metrics(calculation_date);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_period ON asset_performance_metrics(period);

-- User portfolio metrics (aggregate across holdings)
CREATE TABLE IF NOT EXISTS user_portfolio_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calculation_date DATE NOT NULL,

  -- Portfolio value
  total_value NUMERIC(15,2) NOT NULL,
  cash_balance NUMERIC(15,2) NOT NULL,
  invested_value NUMERIC(15,2) NOT NULL,

  -- Returns (various periods)
  return_1d NUMERIC(10,4),
  return_1w NUMERIC(10,4),
  return_1m NUMERIC(10,4),
  return_3m NUMERIC(10,4),
  return_ytd NUMERIC(10,4),
  return_1y NUMERIC(10,4),

  -- Risk metrics
  portfolio_volatility NUMERIC(10,4),
  portfolio_sharpe NUMERIC(8,4),
  portfolio_var_95 NUMERIC(15,2),

  -- Benchmarks
  vs_sqbdy50_alpha NUMERIC(8,4),
  vs_sqbdy50_beta NUMERIC(8,4),

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, calculation_date)
);

-- Indexes for user portfolio metrics
CREATE INDEX IF NOT EXISTS idx_user_portfolio_metrics_user ON user_portfolio_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_user_portfolio_metrics_date ON user_portfolio_metrics(calculation_date);

-- RLS Policies
ALTER TABLE investment_cash_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_portfolio_metrics ENABLE ROW LEVEL SECURITY;

-- Cash flows: users see their own
CREATE POLICY "cash_flows_user_policy" ON investment_cash_flows
  FOR ALL USING (auth.uid() = user_id);

-- Benchmarks: public read
CREATE POLICY "benchmarks_public_read" ON market_benchmarks
  FOR SELECT USING (true);

CREATE POLICY "benchmarks_admin_write" ON market_benchmarks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Benchmark values: public read
CREATE POLICY "benchmark_values_public_read" ON benchmark_values
  FOR SELECT USING (true);

-- Performance metrics: public read (transparency)
CREATE POLICY "perf_metrics_public_read" ON asset_performance_metrics
  FOR SELECT USING (true);

-- User portfolio metrics: users see their own
CREATE POLICY "user_portfolio_metrics_policy" ON user_portfolio_metrics
  FOR ALL USING (auth.uid() = user_id);

-- Function to calculate IRR using Newton-Raphson method
CREATE OR REPLACE FUNCTION calculate_irr(
  p_cash_flows NUMERIC[],
  p_dates DATE[],
  p_max_iterations INTEGER DEFAULT 100,
  p_tolerance NUMERIC DEFAULT 0.0001
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rate NUMERIC := 0.1; -- Initial guess 10%
  v_npv NUMERIC;
  v_npv_deriv NUMERIC;
  v_day_diff INTEGER;
  v_iteration INTEGER := 0;
  v_base_date DATE;
  v_i INTEGER;
BEGIN
  IF array_length(p_cash_flows, 1) IS NULL OR array_length(p_cash_flows, 1) < 2 THEN
    RETURN NULL;
  END IF;

  v_base_date := p_dates[1];

  WHILE v_iteration < p_max_iterations LOOP
    v_npv := 0;
    v_npv_deriv := 0;

    FOR v_i IN 1..array_length(p_cash_flows, 1) LOOP
      v_day_diff := p_dates[v_i] - v_base_date;
      v_npv := v_npv + p_cash_flows[v_i] / POWER(1 + v_rate, v_day_diff::NUMERIC / 365);
      v_npv_deriv := v_npv_deriv - (v_day_diff::NUMERIC / 365) * p_cash_flows[v_i] /
                     POWER(1 + v_rate, v_day_diff::NUMERIC / 365 + 1);
    END LOOP;

    IF ABS(v_npv) < p_tolerance THEN
      RETURN v_rate;
    END IF;

    IF v_npv_deriv = 0 THEN
      RETURN NULL;
    END IF;

    v_rate := v_rate - v_npv / v_npv_deriv;
    v_iteration := v_iteration + 1;
  END LOOP;

  -- Return best estimate even if not converged
  RETURN v_rate;
END;
$$;

-- Function to calculate Time-Weighted Return
CREATE OR REPLACE FUNCTION calculate_twr(
  p_values NUMERIC[],
  p_cash_flows NUMERIC[] DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_twr NUMERIC := 1;
  v_i INTEGER;
  v_period_return NUMERIC;
  v_adjusted_start NUMERIC;
BEGIN
  IF array_length(p_values, 1) IS NULL OR array_length(p_values, 1) < 2 THEN
    RETURN NULL;
  END IF;

  FOR v_i IN 2..array_length(p_values, 1) LOOP
    -- Adjust for cash flows if provided
    IF p_cash_flows IS NOT NULL AND v_i <= array_length(p_cash_flows, 1) THEN
      v_adjusted_start := p_values[v_i - 1] + COALESCE(p_cash_flows[v_i], 0);
    ELSE
      v_adjusted_start := p_values[v_i - 1];
    END IF;

    IF v_adjusted_start > 0 THEN
      v_period_return := p_values[v_i] / v_adjusted_start;
      v_twr := v_twr * v_period_return;
    END IF;
  END LOOP;

  RETURN v_twr - 1;
END;
$$;

-- Function to calculate VaR (Historical method)
CREATE OR REPLACE FUNCTION calculate_var_historical(
  p_returns NUMERIC[],
  p_confidence NUMERIC DEFAULT 0.95,
  p_portfolio_value NUMERIC DEFAULT 1
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sorted NUMERIC[];
  v_percentile_idx INTEGER;
BEGIN
  IF array_length(p_returns, 1) IS NULL OR array_length(p_returns, 1) < 10 THEN
    RETURN NULL;
  END IF;

  -- Sort returns ascending
  SELECT ARRAY(
    SELECT unnest(p_returns) ORDER BY 1
  ) INTO v_sorted;

  -- Find the percentile index
  v_percentile_idx := FLOOR((1 - p_confidence) * array_length(v_sorted, 1))::INTEGER;
  v_percentile_idx := GREATEST(1, v_percentile_idx);

  RETURN ABS(v_sorted[v_percentile_idx] * p_portfolio_value);
END;
$$;

-- Function to calculate portfolio metrics for a user
CREATE OR REPLACE FUNCTION calculate_user_portfolio_metrics(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_portfolio RECORD;
  v_history JSONB;
  v_returns NUMERIC[];
  v_values NUMERIC[];
BEGIN
  -- Get current portfolio
  SELECT
    COALESCE(w.balance, 0) as cash,
    COALESCE(SUM(h.current_value), 0) as invested,
    COALESCE(w.balance, 0) + COALESCE(SUM(h.current_value), 0) as total
  INTO v_portfolio
  FROM user_wallets w
  LEFT JOIN portfolio_holdings h ON h.user_id = w.user_id
  WHERE w.user_id = p_user_id AND w.currency = 'USD'
  GROUP BY w.balance;

  IF v_portfolio IS NULL THEN
    RETURN jsonb_build_object('error', 'No portfolio found');
  END IF;

  -- Get historical values
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', snapshot_date,
    'value', total_value
  ) ORDER BY snapshot_date), '[]'::jsonb)
  INTO v_history
  FROM portfolio_performance
  WHERE user_id = p_user_id
  AND snapshot_date >= CURRENT_DATE - INTERVAL '1 year';

  -- Calculate returns array from history
  SELECT ARRAY_AGG(
    CASE WHEN LAG(val) OVER (ORDER BY dt) > 0
    THEN (val - LAG(val) OVER (ORDER BY dt)) / LAG(val) OVER (ORDER BY dt)
    ELSE 0 END
  )
  INTO v_returns
  FROM (
    SELECT snapshot_date as dt, total_value as val
    FROM portfolio_performance
    WHERE user_id = p_user_id
    ORDER BY snapshot_date
  ) sub;

  -- Calculate volatility
  DECLARE
    v_volatility NUMERIC;
    v_mean NUMERIC;
    v_variance NUMERIC;
  BEGIN
    SELECT AVG(r), VARIANCE(r)
    INTO v_mean, v_variance
    FROM unnest(v_returns) r
    WHERE r IS NOT NULL;

    v_volatility := SQRT(COALESCE(v_variance, 0)) * SQRT(252); -- Annualized
  END;

  v_result := jsonb_build_object(
    'user_id', p_user_id,
    'calculation_date', CURRENT_DATE,
    'total_value', v_portfolio.total,
    'cash_balance', v_portfolio.cash,
    'invested_value', v_portfolio.invested,
    'volatility_annualized', v_volatility,
    'var_95_1d', calculate_var_historical(v_returns, 0.95, v_portfolio.total),
    'history', v_history
  );

  -- Store the metrics
  INSERT INTO user_portfolio_metrics (
    user_id, calculation_date, total_value, cash_balance, invested_value,
    portfolio_volatility, portfolio_var_95
  ) VALUES (
    p_user_id, CURRENT_DATE, v_portfolio.total, v_portfolio.cash, v_portfolio.invested,
    v_volatility, calculate_var_historical(v_returns, 0.95, v_portfolio.total)
  )
  ON CONFLICT (user_id, calculation_date) DO UPDATE SET
    total_value = EXCLUDED.total_value,
    cash_balance = EXCLUDED.cash_balance,
    invested_value = EXCLUDED.invested_value,
    portfolio_volatility = EXCLUDED.portfolio_volatility,
    portfolio_var_95 = EXCLUDED.portfolio_var_95;

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_irr TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_twr TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_var_historical TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_user_portfolio_metrics TO authenticated;

-- Comments
COMMENT ON TABLE investment_cash_flows IS 'Cash flow history for IRR calculations';
COMMENT ON TABLE market_benchmarks IS 'Benchmark indices for performance comparison';
COMMENT ON TABLE benchmark_values IS 'Time series of benchmark values';
COMMENT ON TABLE asset_performance_metrics IS 'Pre-calculated performance metrics for assets';
COMMENT ON TABLE user_portfolio_metrics IS 'User portfolio performance snapshots';
COMMENT ON FUNCTION calculate_irr IS 'Calculate Internal Rate of Return using Newton-Raphson';
COMMENT ON FUNCTION calculate_twr IS 'Calculate Time-Weighted Return';
COMMENT ON FUNCTION calculate_var_historical IS 'Calculate Value at Risk using historical method';
