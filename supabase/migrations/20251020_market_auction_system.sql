-- =====================================================
-- MARKET AUCTION SYSTEM - FRACTIONAL OWNERSHIP TRADING
-- =====================================================
-- Real-time order matching, price discovery, and portfolio tracking
-- November 2025

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- CORE MARKET TABLES
-- =====================================================

-- Vehicle Offerings (each vehicle can be offered whole or fractional)
CREATE TABLE IF NOT EXISTS vehicle_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Offering Type
  offering_type TEXT NOT NULL CHECK (offering_type IN ('whole', 'fractional', 'both')),
  total_shares INTEGER DEFAULT 1000, -- 1 share = 0.1% of vehicle
  
  -- Pricing
  initial_share_price DECIMAL(12,4) NOT NULL,
  current_share_price DECIMAL(12,4) NOT NULL,
  opening_price DECIMAL(12,4), -- Price at market open
  closing_price DECIMAL(12,4), -- Price at market close
  
  -- Reserve & Limits
  reserve_price DECIMAL(12,2),
  minimum_bid_increment DECIMAL(12,4),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'scheduled', 'active', 'trading', 'closing_auction', 
    'closed', 'sold_out', 'cancelled'
  )),
  
  -- Auction Timing
  scheduled_start_time TIMESTAMPTZ,
  actual_start_time TIMESTAMPTZ,
  auction_duration_seconds INTEGER DEFAULT 300, -- 5 minutes default
  allow_extension BOOLEAN DEFAULT true,
  extension_time_seconds INTEGER DEFAULT 30,
  minimum_seconds_to_extend INTEGER DEFAULT 60,
  
  -- Market Stats
  total_bids INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  total_volume_shares INTEGER DEFAULT 0,
  total_volume_usd DECIMAL(15,2) DEFAULT 0,
  highest_bid DECIMAL(12,4),
  lowest_ask DECIMAL(12,4),
  bid_ask_spread DECIMAL(12,4),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, offering_type)
);

CREATE INDEX idx_vehicle_offerings_vehicle ON vehicle_offerings(vehicle_id);
CREATE INDEX idx_vehicle_offerings_seller ON vehicle_offerings(seller_id);
CREATE INDEX idx_vehicle_offerings_status ON vehicle_offerings(status);
CREATE INDEX idx_vehicle_offerings_updated ON vehicle_offerings(updated_at DESC);

-- Share Holdings (who owns how many shares)
CREATE TABLE IF NOT EXISTS share_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  holder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Shares & Pricing
  shares_owned INTEGER NOT NULL CHECK (shares_owned > 0),
  entry_price DECIMAL(12,4) NOT NULL, -- Average cost per share
  entry_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- Market Value
  current_mark DECIMAL(12,4) NOT NULL, -- Mark-to-market price
  unrealized_gain_loss DECIMAL(15,2),
  unrealized_gain_loss_pct DECIMAL(7,2),
  
  -- Performance
  total_bought INTEGER DEFAULT 0,
  total_sold INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(offering_id, holder_id)
);

CREATE INDEX idx_share_holdings_offering ON share_holdings(offering_id);
CREATE INDEX idx_share_holdings_holder ON share_holdings(holder_id);
CREATE INDEX idx_share_holdings_unrealized ON share_holdings(unrealized_gain_loss DESC);

-- =====================================================
-- ORDER BOOK TABLES
-- =====================================================

-- Market Orders (buy/sell orders waiting to match)
CREATE TABLE IF NOT EXISTS market_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Order Details
  order_type TEXT NOT NULL CHECK (order_type IN ('buy', 'sell')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'pending', 'active', 'partially_filled', 'filled', 'cancelled', 'rejected'
  )),
  
  -- Quantity & Pricing
  shares_requested INTEGER NOT NULL CHECK (shares_requested > 0),
  shares_filled INTEGER DEFAULT 0,
  price_per_share DECIMAL(12,4) NOT NULL,
  total_value DECIMAL(15,2) NOT NULL,
  
  -- Order Control
  time_in_force TEXT DEFAULT 'day' CHECK (time_in_force IN ('day', 'gtc', 'fok', 'ioc')),
  -- day = Day order, gtc = Good till cancel, fok = Fill or kill, ioc = Immediate or cancel
  
  -- Execution Info
  first_fill_time TIMESTAMPTZ,
  last_fill_time TIMESTAMPTZ,
  average_fill_price DECIMAL(12,4),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (shares_filled <= shares_requested)
);

CREATE INDEX idx_market_orders_offering ON market_orders(offering_id);
CREATE INDEX idx_market_orders_user ON market_orders(user_id);
CREATE INDEX idx_market_orders_status ON market_orders(status);
CREATE INDEX idx_market_orders_order_type ON market_orders(order_type);
CREATE INDEX idx_market_orders_price ON market_orders(price_per_share);
CREATE INDEX idx_market_orders_created ON market_orders(created_at DESC);

-- Executed Trades (completed transactions)
CREATE TABLE IF NOT EXISTS market_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  
  -- Parties
  buyer_id UUID NOT NULL REFERENCES auth.users(id),
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Trade Details
  shares_traded INTEGER NOT NULL CHECK (shares_traded > 0),
  price_per_share DECIMAL(12,4) NOT NULL,
  total_value DECIMAL(15,2) NOT NULL,
  
  -- Orders That Matched
  buy_order_id UUID REFERENCES market_orders(id),
  sell_order_id UUID REFERENCES market_orders(id),
  
  -- Commission
  nuke_commission_pct DECIMAL(5,2) DEFAULT 2.0,
  nuke_commission_amount DECIMAL(15,2),
  
  -- Execution
  trade_type TEXT CHECK (trade_type IN ('market', 'limit', 'auction', 'opening', 'closing')),
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_trades_offering ON market_trades(offering_id);
CREATE INDEX idx_market_trades_buyer ON market_trades(buyer_id);
CREATE INDEX idx_market_trades_seller ON market_trades(seller_id);
CREATE INDEX idx_market_trades_executed ON market_trades(executed_at DESC);
CREATE INDEX idx_market_trades_value ON market_trades(total_value DESC);

-- =====================================================
-- TIME-SERIES & ANALYTICS TABLES
-- =====================================================

-- Market Snapshots (hourly OHLC data for charting)
CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  
  -- Time Window
  snapshot_hour TIMESTAMPTZ NOT NULL,
  
  -- OHLC
  open_price DECIMAL(12,4),
  high_price DECIMAL(12,4),
  low_price DECIMAL(12,4),
  close_price DECIMAL(12,4),
  
  -- Volume
  volume_shares INTEGER DEFAULT 0,
  volume_usd DECIMAL(15,2) DEFAULT 0,
  trade_count INTEGER DEFAULT 0,
  
  -- Statistics
  average_price DECIMAL(12,4),
  price_change_pct DECIMAL(7,2),
  bid_ask_spread DECIMAL(12,4),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(offering_id, snapshot_hour)
);

CREATE INDEX idx_market_snapshots_offering ON market_snapshots(offering_id);
CREATE INDEX idx_market_snapshots_time ON market_snapshots(snapshot_hour DESC);
CREATE INDEX idx_market_snapshots_created ON market_snapshots(created_at DESC);

-- Trading Windows (NYSE-style market hours)
CREATE TABLE IF NOT EXISTS trading_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  
  -- Window Timing
  window_date DATE NOT NULL,
  opening_auction_start TIMESTAMPTZ NOT NULL,
  opening_auction_end TIMESTAMPTZ NOT NULL,
  market_open TIMESTAMPTZ NOT NULL,
  market_close TIMESTAMPTZ NOT NULL,
  closing_auction_start TIMESTAMPTZ NOT NULL,
  closing_auction_end TIMESTAMPTZ NOT NULL,
  
  -- Prices
  opening_price DECIMAL(12,4),
  closing_price DECIMAL(12,4),
  
  -- Stats
  total_volume DECIMAL(15,2),
  total_trades INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(offering_id, window_date)
);

CREATE INDEX idx_trading_windows_offering ON trading_windows(offering_id);
CREATE INDEX idx_trading_windows_date ON trading_windows(window_date DESC);

-- Price Discovery Events (when auctions complete)
CREATE TABLE IF NOT EXISTS price_discovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  
  -- Event Info
  event_type TEXT NOT NULL CHECK (event_type IN ('opening_auction', 'closing_auction', 'intraday')),
  
  -- Price Discovery
  bids_collected INTEGER,
  asks_collected INTEGER,
  equilibrium_price DECIMAL(12,4) NOT NULL,
  equilibrium_volume INTEGER NOT NULL,
  
  -- Matching Results
  orders_matched INTEGER,
  total_value DECIMAL(15,2),
  
  -- Timing
  discovery_time TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_discovery_offering ON price_discovery_events(offering_id);
CREATE INDEX idx_price_discovery_type ON price_discovery_events(event_type);

-- =====================================================
-- GAMIFICATION & ENGAGEMENT TABLES
-- =====================================================

-- User Trading Stats (daily performance metrics)
CREATE TABLE IF NOT EXISTS user_trading_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL,
  
  -- Daily Activity
  trades_executed INTEGER DEFAULT 0,
  total_buy_volume DECIMAL(15,2) DEFAULT 0,
  total_sell_volume DECIMAL(15,2) DEFAULT 0,
  average_trade_size DECIMAL(12,2),
  
  -- Performance
  daily_gain_loss DECIMAL(15,2) DEFAULT 0,
  daily_gain_loss_pct DECIMAL(7,2) DEFAULT 0,
  win_rate_pct DECIMAL(5,2), -- % of profitable trades
  
  -- Rankings
  daily_rank INTEGER,
  
  -- Activity Streaks
  consecutive_profitable_days INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, stat_date)
);

CREATE INDEX idx_user_trading_stats_user ON user_trading_stats(user_id);
CREATE INDEX idx_user_trading_stats_date ON user_trading_stats(stat_date DESC);
CREATE INDEX idx_user_trading_stats_gain_loss ON user_trading_stats(daily_gain_loss DESC);

-- Portfolio Positions (current holdings summary)
CREATE TABLE IF NOT EXISTS portfolio_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Summary Stats
  total_positions INTEGER DEFAULT 0, -- Number of different offerings
  total_shares_owned INTEGER DEFAULT 0,
  total_value_at_cost DECIMAL(15,2) DEFAULT 0,
  total_market_value DECIMAL(15,2) DEFAULT 0,
  unrealized_gain_loss DECIMAL(15,2) DEFAULT 0,
  unrealized_gain_loss_pct DECIMAL(7,2) DEFAULT 0,
  
  -- Diversification
  largest_position_pct DECIMAL(5,2),
  
  -- Performance
  best_performer_offering_id UUID,
  worst_performer_offering_id UUID,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

CREATE INDEX idx_portfolio_positions_user ON portfolio_positions(user_id);
CREATE INDEX idx_portfolio_positions_updated ON portfolio_positions(updated_at DESC);

-- Leaderboard Snapshots (daily rankings)
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  
  -- Ranker
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  
  -- Metrics
  daily_gain_loss DECIMAL(15,2),
  daily_gain_loss_pct DECIMAL(7,2),
  portfolio_value DECIMAL(15,2),
  total_trades INTEGER,
  win_rate_pct DECIMAL(5,2),
  
  -- Streak
  consecutive_profitable_days INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(snapshot_date, user_id, rank)
);

CREATE INDEX idx_leaderboard_date ON leaderboard_snapshots(snapshot_date DESC);
CREATE INDEX idx_leaderboard_user ON leaderboard_snapshots(user_id);
CREATE INDEX idx_leaderboard_rank ON leaderboard_snapshots(rank ASC);

-- Trending Offerings (most traded, highest gainers)
CREATE TABLE IF NOT EXISTS trending_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  
  -- Metrics
  trend_type TEXT NOT NULL CHECK (trend_type IN ('most_traded', 'highest_gain', 'biggest_volume')),
  metric_value DECIMAL(15,2) NOT NULL,
  
  -- Time Window
  time_window TEXT CHECK (time_window IN ('1h', '4h', '1d')),
  
  -- Ranking
  rank_in_category INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trending_offerings ON trending_offerings(offering_id);
CREATE INDEX idx_trending_type_window ON trending_offerings(trend_type, time_window);

-- =====================================================
-- ENGAGEMENT NOTIFICATIONS
-- =====================================================

-- User Notifications (FOMO, price alerts, gains)
CREATE TABLE IF NOT EXISTS market_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Notification Content
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'trade_executed', 'order_filled', 'price_alert', 'trending', 
    'portfolio_gain', 'leaderboard_rank', 'new_offering'
  )),
  
  offering_id UUID REFERENCES vehicle_offerings(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- State
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_notifications_user ON market_notifications(user_id);
CREATE INDEX idx_market_notifications_read ON market_notifications(is_read);
CREATE INDEX idx_market_notifications_created ON market_notifications(created_at DESC);

-- =====================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE
-- =====================================================

-- Current Market State (quick lookup)
CREATE MATERIALIZED VIEW current_market_state AS
SELECT 
  o.id as offering_id,
  o.vehicle_id,
  o.current_share_price,
  o.opening_price,
  ROUND(((o.current_share_price - o.opening_price) / o.opening_price * 100)::numeric, 2) as price_change_pct,
  (SELECT COUNT(*) FROM market_orders WHERE offering_id = o.id AND status = 'active') as active_orders,
  (SELECT SUM(shares_traded) FROM market_trades WHERE offering_id = o.id AND executed_at > NOW() - INTERVAL '1 day') as volume_24h,
  o.total_trades,
  o.status
FROM vehicle_offerings o
WHERE o.status IN ('trading', 'closing_auction');

-- Best Performing Holders (for leaderboard)
CREATE MATERIALIZED VIEW top_performers AS
SELECT 
  user_id,
  SUM(unrealized_gain_loss) as total_unrealized_gain,
  COUNT(DISTINCT offering_id) as position_count,
  ROUND((SUM(unrealized_gain_loss) / SUM(entry_price * shares_owned) * 100)::numeric, 2) as return_pct
FROM share_holdings
GROUP BY user_id
ORDER BY total_unrealized_gain DESC;

-- Order Book Summary (bid/ask spreads)
CREATE MATERIALIZED VIEW order_book_summary AS
SELECT 
  offering_id,
  (SELECT price_per_share FROM market_orders WHERE offering_id = mo.offering_id AND order_type = 'buy' AND status = 'active' ORDER BY price_per_share DESC LIMIT 1) as highest_bid,
  (SELECT price_per_share FROM market_orders WHERE offering_id = mo.offering_id AND order_type = 'sell' AND status = 'active' ORDER BY price_per_share ASC LIMIT 1) as lowest_ask,
  (SELECT COUNT(*) FROM market_orders WHERE offering_id = mo.offering_id AND order_type = 'buy' AND status = 'active') as buy_side_depth,
  (SELECT COUNT(*) FROM market_orders WHERE offering_id = mo.offering_id AND order_type = 'sell' AND status = 'active') as sell_side_depth
FROM market_orders mo
GROUP BY offering_id;

-- =====================================================
-- ROW-LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE vehicle_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trading_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_notifications ENABLE ROW LEVEL SECURITY;

-- Policies: Users see offerings and public stats
CREATE POLICY "Offerings are viewable to all authenticated users" ON vehicle_offerings
  FOR SELECT USING (auth.role() = 'authenticated_user');

-- Users see their own holdings
CREATE POLICY "Users see own holdings" ON share_holdings
  FOR SELECT USING (holder_id = auth.uid());

-- Users see their own orders
CREATE POLICY "Users see own orders" ON market_orders
  FOR SELECT USING (user_id = auth.uid());

-- Users see their own trades
CREATE POLICY "Users see own trades" ON market_trades
  FOR SELECT USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- Users see their own stats
CREATE POLICY "Users see own stats" ON user_trading_stats
  FOR SELECT USING (user_id = auth.uid());

-- Users see their own portfolio
CREATE POLICY "Users see own portfolio" ON portfolio_positions
  FOR SELECT USING (user_id = auth.uid());

-- Users see their own notifications
CREATE POLICY "Users see own notifications" ON market_notifications
  FOR SELECT USING (user_id = auth.uid());

-- =====================================================
-- COMPLETION
-- =====================================================

COMMIT;
