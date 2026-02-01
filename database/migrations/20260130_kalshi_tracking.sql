-- Kalshi Position & Betting Analytics Schema
-- Tracks: positions, fills, user habits, and enables bet suggestions from vehicle data

-- ============================================
-- CORE TABLES
-- ============================================

-- User's connected Kalshi accounts (future: multi-account)
CREATE TABLE IF NOT EXISTS kalshi_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  kalshi_member_id text, -- Their Kalshi user ID if we get it
  connected_at timestamptz DEFAULT now(),
  last_synced_at timestamptz,
  is_active boolean DEFAULT true,
  UNIQUE(user_id) -- One Kalshi account per user for now
);

-- Synced positions from Kalshi API
CREATE TABLE IF NOT EXISTS kalshi_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,

  -- Kalshi identifiers
  ticker text NOT NULL,
  event_ticker text,

  -- Position data (synced from Kalshi)
  position int NOT NULL, -- Positive = YES, Negative = NO
  market_exposure int, -- In cents
  resting_orders_count int DEFAULT 0,
  total_traded int DEFAULT 0,
  realized_pnl int DEFAULT 0,

  -- Market metadata (denormalized for fast queries)
  market_title text,
  event_title text,
  category text,
  close_time timestamptz,

  -- Tracking
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz, -- Null = still open
  synced_at timestamptz DEFAULT now(),

  UNIQUE(user_id, ticker)
);

-- Trade history (fills) synced from Kalshi
CREATE TABLE IF NOT EXISTS kalshi_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,

  -- Kalshi identifiers
  trade_id text UNIQUE NOT NULL,
  order_id text,
  ticker text NOT NULL,

  -- Trade details
  action text NOT NULL, -- 'buy' or 'sell'
  side text NOT NULL, -- 'yes' or 'no'
  count int NOT NULL,
  yes_price int, -- In cents (1-99)
  no_price int,

  -- Calculated
  cost_cents int, -- What they paid

  -- Timestamps
  executed_at timestamptz NOT NULL,
  synced_at timestamptz DEFAULT now()
);

-- n-zero allocation decisions (what the user chose to do with earnings)
CREATE TABLE IF NOT EXISTS bet_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,

  -- Source of funds
  source_type text NOT NULL, -- 'gig_payment', 'deposit', 'winnings'
  source_id uuid, -- Reference to gig/transaction
  amount_cents int NOT NULL,

  -- Destination
  destination text NOT NULL, -- 'kalshi', 'alpaca', 'spend', 'save'
  destination_ticker text, -- If betting, which market

  -- Tracking
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz,
  status text DEFAULT 'pending' -- 'pending', 'executed', 'failed'
);

-- ============================================
-- ANALYTICS TABLES
-- ============================================

-- User betting profile (computed from history)
CREATE TABLE IF NOT EXISTS user_betting_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,

  -- Volume stats
  total_bets int DEFAULT 0,
  total_wagered_cents bigint DEFAULT 0,
  total_won_cents bigint DEFAULT 0,
  total_lost_cents bigint DEFAULT 0,
  net_pnl_cents bigint DEFAULT 0,

  -- Preferences (learned from behavior)
  preferred_categories text[], -- e.g., ['Economics', 'Sports', 'Politics']
  avg_position_size_cents int,
  avg_hold_duration_hours numeric,
  win_rate numeric, -- 0.0 to 1.0

  -- Risk profile
  max_single_bet_cents int,
  kelly_fraction numeric, -- Calculated optimal bet sizing
  risk_score numeric, -- 1-10 scale

  -- Timestamps
  first_bet_at timestamptz,
  last_bet_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Market suggestions based on vehicle data analysis
CREATE TABLE IF NOT EXISTS suggested_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The proposition
  title text NOT NULL,
  description text,
  category text DEFAULT 'automotive',

  -- Based on what data?
  source_type text NOT NULL, -- 'auction_analysis', 'price_trend', 'market_sentiment'
  source_query jsonb, -- The analysis that generated this
  confidence numeric, -- 0.0 to 1.0

  -- If we want to propose to Kalshi
  proposed_to_kalshi boolean DEFAULT false,
  kalshi_response text,

  -- If matched to existing Kalshi market
  matched_kalshi_ticker text,

  -- Example propositions:
  -- "Will any BaT auction exceed $500k this month?"
  -- "Will Ferrari 250 GTO index rise 10% this year?"
  -- "Will electric vehicle auction volume exceed ICE by 2027?"

  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_kalshi_positions_user ON kalshi_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_kalshi_positions_ticker ON kalshi_positions(ticker);
CREATE INDEX IF NOT EXISTS idx_kalshi_positions_open ON kalshi_positions(user_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_kalshi_fills_user ON kalshi_fills(user_id);
CREATE INDEX IF NOT EXISTS idx_kalshi_fills_ticker ON kalshi_fills(ticker);
CREATE INDEX IF NOT EXISTS idx_kalshi_fills_executed ON kalshi_fills(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bet_allocations_user ON bet_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_bet_allocations_status ON bet_allocations(status);

CREATE INDEX IF NOT EXISTS idx_suggested_markets_category ON suggested_markets(category);
CREATE INDEX IF NOT EXISTS idx_suggested_markets_confidence ON suggested_markets(confidence DESC);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update user betting profile after new fills
CREATE OR REPLACE FUNCTION update_betting_profile()
RETURNS trigger AS $$
BEGIN
  INSERT INTO user_betting_profiles (user_id, total_bets, total_wagered_cents, last_bet_at, updated_at)
  VALUES (NEW.user_id, 1, NEW.cost_cents, NEW.executed_at, now())
  ON CONFLICT (user_id) DO UPDATE SET
    total_bets = user_betting_profiles.total_bets + 1,
    total_wagered_cents = user_betting_profiles.total_wagered_cents + COALESCE(NEW.cost_cents, 0),
    last_bet_at = NEW.executed_at,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_update_betting_profile
AFTER INSERT ON kalshi_fills
FOR EACH ROW EXECUTE FUNCTION update_betting_profile();

-- ============================================
-- VIEWS
-- ============================================

-- Active positions with P&L
CREATE OR REPLACE VIEW v_active_positions AS
SELECT
  kp.*,
  CASE
    WHEN kp.position > 0 THEN 'YES'
    ELSE 'NO'
  END as side,
  ABS(kp.position) as contracts,
  kp.market_exposure / 100.0 as exposure_dollars
FROM kalshi_positions kp
WHERE kp.closed_at IS NULL;

-- User betting summary
CREATE OR REPLACE VIEW v_user_betting_summary AS
SELECT
  ubp.user_id,
  ubp.total_bets,
  ubp.total_wagered_cents / 100.0 as total_wagered,
  ubp.net_pnl_cents / 100.0 as net_pnl,
  ubp.win_rate,
  ubp.preferred_categories,
  ubp.risk_score,
  (SELECT COUNT(*) FROM kalshi_positions WHERE user_id = ubp.user_id AND closed_at IS NULL) as open_positions,
  ubp.last_bet_at
FROM user_betting_profiles ubp;

-- Category performance breakdown
CREATE OR REPLACE VIEW v_category_performance AS
SELECT
  kf.user_id,
  kp.category,
  COUNT(*) as bets,
  SUM(kf.cost_cents) / 100.0 as total_wagered,
  AVG(kf.yes_price) as avg_price_paid
FROM kalshi_fills kf
JOIN kalshi_positions kp ON kp.ticker = kf.ticker AND kp.user_id = kf.user_id
GROUP BY kf.user_id, kp.category;
