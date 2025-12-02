# Database Schema - Visual Integration Guide

**October 20, 2025**

---

## The Big Picture: How Tables Connect

```
┌─────────────────────────────────────────────────────────────────┐
│                      CORE TRADING SYSTEM                         │
└─────────────────────────────────────────────────────────────────┘

vehicle_offerings (THE ASSET)
├─ id (PK)
├─ vehicle_id (FK → vehicles)
├─ current_share_price ← UPDATED BY TRADES
├─ status: 'trading' | 'closed'
└─ total_trades: 0
    │
    ├─────────────────────────────────────────────┐
    │                                              │
    ▼                                              ▼
market_orders (THE ORDER BOOK)          market_trades (THE LEDGER)
├─ id (PK)                              ├─ id (PK)
├─ offering_id (FK)                     ├─ offering_id (FK)
├─ user_id (FK)                         ├─ buyer_id (FK → auth.users)
├─ order_type: 'buy'|'sell'             ├─ seller_id (FK → auth.users)
├─ status: 'active'|'filled'            ├─ shares_traded
├─ price_per_share                      ├─ price_per_share ← FROM passive order
├─ shares_requested                     ├─ nuke_commission_amount (2%)
└─ shares_filled                        └─ executed_at
    │
    ├──────────────────────────────────────────┐
    │                                           │
    ▼                                           ▼
share_holdings (THE PORTFOLIO)      user_trading_stats (DAILY STATS)
├─ id (PK)                          ├─ id (PK)
├─ offering_id (FK)                 ├─ user_id (FK)
├─ holder_id (FK → auth.users)      ├─ stat_date
├─ shares_owned                      ├─ trades_executed
├─ entry_price (avg cost)            ├─ daily_gain_loss ← CALCULATED
├─ current_mark                      ├─ daily_gain_loss_pct
└─ unrealized_gain_loss ← CALCULATED └─ win_rate_pct
    │
    └──────────────────────────────────────────┐
                                                │
                                                ▼
                                    leaderboard_snapshots
                                    ├─ id (PK)
                                    ├─ snapshot_date
                                    ├─ user_id (FK)
                                    ├─ rank (1-10)
                                    ├─ daily_gain_loss
                                    └─ consecutive_profitable_days
```

---

## Flow #1: User Places Buy Order

### Step-by-Step with Database Queries

```sql
-- STEP 1: User clicks "Buy 5 shares @ $110"
-- Client calls: AuctionMarketEngine.placeOrder(offering_id, user_id, 'buy', 5, 110)

-- STEP 2: Create order in database
INSERT INTO market_orders (
  id, offering_id, user_id, order_type, 
  status, shares_requested, price_per_share, created_at
) VALUES (
  'order-uuid-123', 'vehicle-abc', 'user-xyz', 'buy',
  'active', 5, 110.00, NOW()
)
RETURNING *;

-- Result: Order created with status='active'
-- │ id                │ offering_id  │ user_id  │ order_type │ status  │ shares_requested │ price_per_share │
-- ├──────────────────┼──────────────┼──────────┼────────────┼─────────┼──────────────────┼─────────────────┤
-- │ order-uuid-123   │ vehicle-abc  │ user-xyz │ buy        │ active  │ 5                │ 110.00          │


-- STEP 3: Check if order can match (find sellers at $110 or lower)
SELECT 
  id, user_id, price_per_share, 
  shares_requested - shares_filled as available_shares
FROM market_orders
WHERE 
  offering_id = 'vehicle-abc'
  AND order_type = 'sell'
  AND status IN ('active', 'partially_filled')
ORDER BY price_per_share ASC
LIMIT 100;

-- Result: Found seller at $108!
-- │ id               │ user_id     │ price_per_share │ available_shares │
-- ├──────────────────┼─────────────┼─────────────────┼──────────────────┤
-- │ order-uuid-456   │ user-seller │ 108.00          │ 10               │
-- │ order-uuid-789   │ user-alice  │ 112.00          │ 20               │


-- STEP 4: Match found! Buy 5 shares @ $108 (seller's price)
-- Insert trade record
INSERT INTO market_trades (
  id, offering_id, buyer_id, seller_id,
  shares_traded, price_per_share, total_value,
  nuke_commission_pct, nuke_commission_amount,
  buy_order_id, sell_order_id, executed_at
) VALUES (
  'trade-uuid-001', 'vehicle-abc', 'user-xyz', 'user-seller',
  5, 108.00, 540.00, 2.0, 10.80,
  'order-uuid-123', 'order-uuid-456', NOW()
)
RETURNING *;

-- Result: Trade recorded
-- │ id             │ buyer_id │ seller_id    │ shares_traded │ price_per_share │ total_value │ nuke_commission_amount │
-- ├────────────────┼──────────┼──────────────┼───────────────┼─────────────────┼─────────────┼────────────────────────┤
-- │ trade-uuid-001 │ user-xyz │ user-seller  │ 5             │ 108.00          │ 540.00      │ 10.80                  │


-- STEP 5: Update buyer's order status (now filled)
UPDATE market_orders
SET shares_filled = 5, status = 'filled', average_fill_price = 108.00
WHERE id = 'order-uuid-123'
RETURNING *;

-- Result: Buyer's order now filled
-- │ id             │ shares_requested │ shares_filled │ status │ average_fill_price │
-- ├────────────────┼──────────────────┼───────────────┼────────┼────────────────────┤
-- │ order-uuid-123 │ 5                │ 5             │ filled │ 108.00             │


-- STEP 6: Update seller's order status (now partially filled)
UPDATE market_orders
SET shares_filled = 5, status = 'partially_filled'
WHERE id = 'order-uuid-456'
RETURNING *;

-- Result: Seller's order partially filled
-- │ id             │ shares_requested │ shares_filled │ status               │
-- ├────────────────┼──────────────────┼───────────────┼──────────────────────┤
-- │ order-uuid-456 │ 10               │ 5             │ partially_filled     │


-- STEP 7: Insert buyer's holdings
INSERT INTO share_holdings (
  id, offering_id, holder_id, shares_owned,
  entry_price, current_mark
) VALUES (
  'holding-xyz-1', 'vehicle-abc', 'user-xyz', 5,
  108.00, 108.00
)
ON CONFLICT (offering_id, holder_id) 
  DO UPDATE SET shares_owned = shares_owned + 5
RETURNING *;

-- Result: Buyer now owns 5 shares
-- │ id          │ holder_id │ shares_owned │ entry_price │ current_mark │ unrealized_gain_loss │
-- ├─────────────┼───────────┼──────────────┼─────────────┼──────────────┼──────────────────────┤
-- │ holding-xyz-1 │ user-xyz  │ 5            │ 108.00      │ 108.00       │ 0.00                 │


-- STEP 8: Update seller's holdings (sold 5 shares)
UPDATE share_holdings
SET shares_owned = shares_owned - 5
WHERE offering_id = 'vehicle-abc' AND holder_id = 'user-seller'
RETURNING *;

-- Result: Seller now has 5 fewer shares
-- │ id          │ holder_id   │ shares_owned │ entry_price │ unrealized_gain_loss │
-- ├─────────────┼─────────────┼──────────────┼─────────────┼──────────────────────┤
-- │ holding-xyz-2 │ user-seller │ 45          │ 105.00      │ 135.00               │


-- STEP 9: Update offering market data
UPDATE vehicle_offerings
SET 
  current_share_price = 108.00,
  total_trades = total_trades + 1,
  highest_bid = 110.00,
  lowest_ask = 112.00,
  bid_ask_spread = 2.00
WHERE id = 'vehicle-abc'
RETURNING *;

-- Result: Offering price updated
-- │ id           │ current_share_price │ total_trades │ highest_bid │ lowest_ask │
-- ├──────────────┼─────────────────────┼──────────────┼─────────────┼────────────┤
-- │ vehicle-abc  │ 108.00              │ 1            │ 110.00      │ 112.00     │


-- STEP 10: Record hourly snapshot for charting
INSERT INTO market_snapshots (
  offering_id, snapshot_hour, open_price, high_price,
  low_price, close_price, volume_shares, volume_usd, trade_count
) VALUES (
  'vehicle-abc', DATE_TRUNC('hour', NOW()), 
  108.00, 108.00, 108.00, 108.00, 5, 540.00, 1
)
ON CONFLICT (offering_id, snapshot_hour)
  DO UPDATE SET 
    high_price = GREATEST(market_snapshots.high_price, 108.00),
    low_price = LEAST(market_snapshots.low_price, 108.00),
    close_price = 108.00,
    volume_shares = volume_shares + 5,
    volume_usd = volume_usd + 540.00,
    trade_count = trade_count + 1
RETURNING *;

-- Result: Price history recorded
-- │ offering_id  │ snapshot_hour       │ open_price │ high_price │ low_price │ close_price │
-- ├──────────────┼─────────────────────┼────────────┼────────────┼───────────┼─────────────┤
-- │ vehicle-abc  │ 2025-10-20 14:00:00 │ 108.00     │ 108.00     │ 108.00    │ 108.00      │
```

---

## Flow #2: Portfolio Valuation (Real-Time Mark-to-Market)

```sql
-- Every time price changes, portfolios update automatically

-- User holds: 5 shares, entry price $108, current market price $112

-- Calculate unrealized gain/loss:
UPDATE share_holdings
SET 
  current_mark = 112.00,
  unrealized_gain_loss = (112.00 - 108.00) * 5,
  unrealized_gain_loss_pct = ((112.00 - 108.00) / 108.00) * 100
WHERE offering_id = 'vehicle-abc' AND holder_id = 'user-xyz'
RETURNING *;

-- Result: Holdings updated with new market value
-- │ holder_id │ shares_owned │ entry_price │ current_mark │ unrealized_gain_loss │ unrealized_gain_loss_pct │
-- ├───────────┼──────────────┼─────────────┼──────────────┼──────────────────────┼──────────────────────────┤
-- │ user-xyz  │ 5            │ 108.00      │ 112.00       │ 20.00                │ 3.70                     │

-- Then update portfolio summary:
UPDATE portfolio_positions
SET 
  total_market_value = 560.00,  -- 5 shares × $112
  unrealized_gain_loss = 20.00,
  unrealized_gain_loss_pct = 3.70
WHERE user_id = 'user-xyz'
RETURNING *;

-- Result: Portfolio now shows $20 gain
-- │ user_id  │ total_positions │ total_shares_owned │ total_value_at_cost │ total_market_value │ unrealized_gain_loss │
-- ├──────────┼─────────────────┼────────────────────┼─────────────────────┼────────────────────┼──────────────────────┤
-- │ user-xyz │ 1               │ 5                  │ 540.00              │ 560.00             │ 20.00                │
```

---

## Flow #3: Daily P&L & Leaderboard

```sql
-- At market close (4:15pm ET), calculate daily stats and rankings

-- STEP 1: Calculate daily P&L for all users
INSERT INTO user_trading_stats (user_id, stat_date, daily_gain_loss, daily_gain_loss_pct)
SELECT 
  mt.buyer_id as user_id,
  CURRENT_DATE,
  COALESCE(SUM(CASE 
    WHEN mt.seller_id = u.id THEN mt.total_value
    ELSE -mt.total_value - mt.nuke_commission_amount
  END), 0) as daily_gain_loss
FROM market_trades mt
JOIN auth.users u ON u.id IN (mt.buyer_id, mt.seller_id)
WHERE DATE(mt.executed_at) = CURRENT_DATE
GROUP BY mt.buyer_id
ON CONFLICT (user_id, stat_date) DO UPDATE
SET daily_gain_loss = EXCLUDED.daily_gain_loss;

-- Result: Daily stats for each user
-- │ user_id   │ stat_date  │ trades_executed │ daily_gain_loss │ daily_gain_loss_pct │
-- ├───────────┼────────────┼─────────────────┼─────────────────┼─────────────────────┤
-- │ user-xyz  │ 2025-10-20 │ 2               │ 50.00           │ 2.15                │
-- │ user-alice│ 2025-10-20 │ 3               │ -30.00          │ -1.20               │
-- │ user-bob  │ 2025-10-20 │ 1               │ 150.00          │ 8.50                │


-- STEP 2: Create daily leaderboard (ranked by gains)
INSERT INTO leaderboard_snapshots (
  snapshot_date, user_id, rank, daily_gain_loss, daily_gain_loss_pct
)
SELECT 
  CURRENT_DATE,
  user_id,
  ROW_NUMBER() OVER (ORDER BY daily_gain_loss DESC) as rank,
  daily_gain_loss,
  daily_gain_loss_pct
FROM user_trading_stats
WHERE stat_date = CURRENT_DATE
ORDER BY daily_gain_loss DESC
LIMIT 100;

-- Result: Leaderboard rankings
-- │ snapshot_date │ user_id   │ rank │ daily_gain_loss │ daily_gain_loss_pct │
-- ├───────────────┼───────────┼──────┼─────────────────┼─────────────────────┤
-- │ 2025-10-20    │ user-bob  │ 1    │ 150.00          │ 8.50                │
-- │ 2025-10-20    │ user-xyz  │ 2    │ 50.00           │ 2.15                │
-- │ 2025-10-20    │ user-alice│ 3    │ -30.00          │ -1.20               │
```

---

## Flow #4: Price Discovery Auction (9:30am & 4:00pm)

```sql
-- Opening Auction at 9:30am ET

-- STEP 1: Fetch all pending buy orders (sorted highest price first)
SELECT * FROM market_orders
WHERE offering_id = 'vehicle-abc'
  AND order_type = 'buy'
  AND status IN ('active', 'partially_filled')
ORDER BY price_per_share DESC;

-- Bids:
-- │ id        │ user_id   │ price_per_share │ shares_requested │ shares_filled │
-- ├───────────┼───────────┼─────────────────┼──────────────────┼───────────────┤
-- │ bid-1     │ user-alice│ 115.00          │ 100              │ 0             │
-- │ bid-2     │ user-bob  │ 110.00          │ 200              │ 0             │


-- STEP 2: Fetch all pending sell orders (sorted lowest price first)
SELECT * FROM market_orders
WHERE offering_id = 'vehicle-abc'
  AND order_type = 'sell'
  AND status IN ('active', 'partially_filled')
ORDER BY price_per_share ASC;

-- Asks:
-- │ id        │ user_id   │ price_per_share │ shares_requested │ shares_filled │
-- ├───────────┼───────────┼─────────────────┼──────────────────┼───────────────┤
-- │ ask-1     │ user-seller │ 108.00        │ 150              │ 0             │
-- │ ask-2     │ user-charlie│ 112.00        │ 100              │ 0             │


-- STEP 3: Find equilibrium
-- Alice bid $115 >= Seller ask $108? YES → MATCH!
-- Bob bid $110 >= Charlie ask $112? NO → STOP
-- Equilibrium price = $108


-- STEP 4: Execute all trades at equilibrium price
INSERT INTO market_trades (
  buyer_id, seller_id, shares_traded, price_per_share,
  trade_type, offering_id
) VALUES 
  ('user-alice', 'user-seller', 100, 108.00, 'opening', 'vehicle-abc'),
  ('user-bob', 'user-charlie', 100, 108.00, 'opening', 'vehicle-abc');


-- STEP 5: Record price discovery event
INSERT INTO price_discovery_events (
  offering_id, event_type, equilibrium_price,
  bids_collected, asks_collected, orders_matched
) VALUES (
  'vehicle-abc', 'opening_auction', 108.00,
  2, 2, 2  -- 2 bids, 2 asks, both matched
);


-- STEP 6: Update offering opening price
UPDATE vehicle_offerings
SET 
  opening_price = 108.00,
  current_share_price = 108.00,
  status = 'trading'
WHERE id = 'vehicle-abc';
```

---

## Key Database Design Patterns

### 1. Aggregate Tables for Performance

```sql
-- Instead of computing every time:
SELECT SUM(shares_owned) FROM share_holdings WHERE offering_id = ?; -- SLOW

-- Store aggregates:
portfolio_positions → total_market_value (pre-computed)
```

### 2. Immutable Audit Trail

```sql
-- Trades are NEVER updated or deleted
-- Only INSERTed → complete audit trail for compliance
CREATE TABLE market_trades (
  -- No UPDATE or DELETE permissions for application
  CONSTRAINT trades_immutable CHECK (created_at = created_at)
);
```

### 3. Real-Time Subscriptions

```sql
-- Every row INSERT/UPDATE in these tables triggers client updates:
-- - market_orders (new bid/ask)
-- - market_trades (new trade)
-- - share_holdings (portfolio changed)
-- - leaderboard_snapshots (rank changed)

-- Supabase real-time: PostgreSQL triggers → WebSocket → React
```

### 4. Materialized Views for Complex Queries

```sql
-- Expensive queries run once, cached:
CREATE MATERIALIZED VIEW current_market_state AS
SELECT 
  o.id, o.current_share_price,
  COUNT(CASE WHEN mo.status = 'active' AND mo.order_type = 'buy' THEN 1 END) as buy_side_depth,
  COUNT(CASE WHEN mo.status = 'active' AND mo.order_type = 'sell' THEN 1 END) as sell_side_depth
FROM vehicle_offerings o
LEFT JOIN market_orders mo ON mo.offering_id = o.id
GROUP BY o.id;

-- Refreshed daily at market close → ultra-fast queries
```

---

## Common Queries & Performance

```sql
-- FAST: Get order book (< 50ms)
SELECT id, price_per_share, shares_requested - shares_filled as available_shares
FROM market_orders
WHERE offering_id = ? AND status = 'active'
ORDER BY price_per_share DESC
LIMIT 10;
-- ✅ Uses index: idx_market_orders_offering_type_status

-- FAST: Get user portfolio (< 100ms)
SELECT * FROM share_holdings WHERE holder_id = ?;
-- ✅ Uses index: idx_share_holdings_holder

-- FAST: Get leaderboard (< 50ms)
SELECT * FROM leaderboard_snapshots
WHERE snapshot_date = CURRENT_DATE
ORDER BY rank ASC
LIMIT 10;
-- ✅ Uses index: idx_leaderboard_date

-- MEDIUM: Calculate daily P&L (< 500ms - run once at close)
SELECT user_id, SUM(...) FROM market_trades
WHERE DATE(executed_at) = CURRENT_DATE
GROUP BY user_id;
-- ✅ Run at 4:15pm ET only, cache in user_trading_stats

-- FAST: Get 24h volume (< 50ms)
SELECT SUM(volume_usd) FROM market_snapshots
WHERE offering_id = ? AND snapshot_hour > NOW() - INTERVAL '24 hours';
-- ✅ Uses pre-aggregated snapshots table
```

---

## Data Integrity & Constraints

```sql
-- All trades reference valid orders
ALTER TABLE market_trades
ADD CONSTRAINT fk_buy_order
FOREIGN KEY (buy_order_id) REFERENCES market_orders(id) ON DELETE RESTRICT;

-- Holdings can't go negative
ALTER TABLE share_holdings
ADD CONSTRAINT positive_shares
CHECK (shares_owned >= 0);

-- Share prices must be positive
ALTER TABLE market_orders
ADD CONSTRAINT positive_price
CHECK (price_per_share > 0);

-- Commission always 2% (no override)
ALTER TABLE market_trades
ADD CONSTRAINT fixed_commission
CHECK (nuke_commission_pct = 2.0);

-- Status can only transition forward
ALTER TABLE market_orders
ADD CONSTRAINT valid_status_transition CHECK (
  (status = 'active' AND shares_filled = 0) OR
  (status = 'partially_filled' AND shares_filled > 0 AND shares_filled < shares_requested) OR
  (status = 'filled' AND shares_filled = shares_requested) OR
  (status = 'cancelled')
);
```

---

## Architecture Summary

```
CLIENT (React)
  ↓ AuctionMarketEngine.placeOrder()
SERVICE (TypeScript)
  ↓ Validation + matching logic
DATABASE (PostgreSQL via Supabase)
  ↓ ACID transactions, indexes, RLS
SUBSCRIPTIONS (Real-time WebSocket)
  ↓ Tables change → UI updates
MATERIALIZED VIEWS (Performance cache)
  ↓ Complex queries pre-computed
AUDIT TRAIL (market_trades immutable)
  ↓ Compliance + debugging
```

**All connected, all real-time, all fast.** ✅

