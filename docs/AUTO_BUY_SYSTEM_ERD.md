# Auto-Buy System: Enhanced Entity Relationship Diagram

## Overview

This ERD extends the base watchlist system with advanced trading features inspired by Bloomberg Terminal and Robinhood, including order management, market data, portfolio tracking, and real-time execution monitoring.

---

## Core Entities

### 1. vehicle_watchlist (Enhanced)
```
┌─────────────────────────────────────────────────────────────┐
│ vehicle_watchlist                                            │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ user_id: UUID (FK → auth.users)                             │
│                                                              │
│ ── Search Criteria ──                                       │
│ year_min: INTEGER                                           │
│ year_max: INTEGER                                           │
│ make: TEXT                                                  │
│ model: TEXT                                                  │
│ trim: TEXT                                                   │
│ series: TEXT                                                 │
│ vin_pattern: TEXT (partial VIN matching)                     │
│                                                              │
│ ── Price Criteria ──                                         │
│ max_price: NUMERIC(10,2)                                     │
│ min_price: NUMERIC(10,2)                                     │
│ price_range_tolerance: NUMERIC(5,2) (percentage)           │
│                                                              │
│ ── Condition & Quality ──                                   │
│ condition_preference: TEXT                                  │
│ must_have_vin: BOOLEAN                                      │
│ must_have_images: BOOLEAN                                   │
│ min_image_count: INTEGER                                    │
│                                                              │
│ ── Source Preferences ──                                     │
│ preferred_sources: TEXT[]                                    │
│ preferred_sellers: TEXT[]                                    │
│ excluded_sellers: TEXT[]                                     │
│                                                              │
│ ── Notification Settings ──                                 │
│ notify_on_new_listing: BOOLEAN                              │
│ notify_on_price_drop: BOOLEAN                               │
│ notify_on_ending_soon: BOOLEAN                              │
│ notify_on_reserve_met: BOOLEAN                              │
│ notification_channels: TEXT[]                                │
│ notification_threshold: NUMERIC(5,2) (price change %)      │
│                                                              │
│ ── Auto-Buy Settings ──                                       │
│ auto_buy_enabled: BOOLEAN                                   │
│ auto_buy_max_price: NUMERIC(10,2)                           │
│ auto_buy_type: TEXT (bid|buy_now|reserve_met|limit|stop)   │
│ auto_buy_bid_increment: NUMERIC(10,2)                        │
│ auto_buy_max_bid: NUMERIC(10,2)                              │
│ auto_buy_requires_confirmation: BOOLEAN                     │
│ auto_buy_payment_method_id: UUID                             │
│                                                              │
│ ── Price Drop Monitoring ──                                 │
│ price_drop_monitoring: BOOLEAN                               │
│ price_drop_target: NUMERIC(10,2)                             │
│ price_drop_alert_threshold: NUMERIC(10,2)                    │
│                                                              │
│ ── Advanced Order Settings ──                                │
│ order_time_in_force: TEXT (GTC|GTD|DAY|IOC|FOK)            │
│ order_expires_at: TIMESTAMPTZ                                │
│ order_execution_hours: JSONB (time windows)                 │
│ order_weekdays_only: BOOLEAN                                │
│ trailing_stop_enabled: BOOLEAN                               │
│ trailing_stop_percent: NUMERIC(5,2)                         │
│                                                              │
│ ── Status & Stats ──                                        │
│ is_active: BOOLEAN                                           │
│ last_matched_at: TIMESTAMPTZ                                 │
│ match_count: INTEGER                                         │
│ auto_buy_executions: INTEGER                                 │
│ success_rate: NUMERIC(5,2)                                   │
│                                                              │
│ ── Metadata ──                                               │
│ notes: TEXT                                                  │
│ tags: TEXT[]                                                 │
│ priority: INTEGER (1-10)                                    │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2. auto_buy_executions (Enhanced)
```
┌─────────────────────────────────────────────────────────────┐
│ auto_buy_executions                                         │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ watchlist_id: UUID (FK → vehicle_watchlist)                 │
│ vehicle_id: UUID (FK → vehicles)                           │
│ external_listing_id: UUID (FK → external_listings)          │
│                                                              │
│ ── Order Details ──                                          │
│ order_type: TEXT (limit|market|stop|trailing|auto_bid)     │
│ execution_type: TEXT (bid_placed|buy_now|reserve_met|...)   │
│ target_price: NUMERIC(10,2)                                 │
│ executed_price: NUMERIC(10,2)                               │
│ limit_price: NUMERIC(10,2)                                  │
│ stop_price: NUMERIC(10,2) (for stop orders)                │
│                                                              │
│ ── Status ──                                                 │
│ status: TEXT (pending|executing|filled|failed|cancelled)    │
│ requires_confirmation: BOOLEAN                              │
│ user_confirmed: BOOLEAN                                      │
│ user_confirmed_at: TIMESTAMPTZ                               │
│                                                              │
│ ── Execution Results ──                                      │
│ bid_id: UUID                                                 │
│ transaction_id: UUID                                         │
│ payment_intent_id: TEXT                                      │
│ error_message: TEXT                                          │
│ error_code: TEXT                                             │
│ retry_count: INTEGER                                         │
│                                                              │
│ ── Timing ──                                                 │
│ triggered_at: TIMESTAMPTZ                                    │
│ executed_at: TIMESTAMPTZ                                     │
│ completed_at: TIMESTAMPTZ                                    │
│ cancelled_at: TIMESTAMPTZ                                    │
│                                                              │
│ ── Market Context ──                                         │
│ market_price_at_trigger: NUMERIC(10,2)                       │
│ market_price_at_execution: NUMERIC(10,2)                     │
│ price_change_since_trigger: NUMERIC(10,2)                    │
│                                                              │
│ ── Metadata ──                                               │
│ execution_data: JSONB                                       │
│ notes: TEXT                                                  │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 3. price_monitoring (Enhanced)
```
┌─────────────────────────────────────────────────────────────┐
│ price_monitoring                                             │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ vehicle_id: UUID (FK → vehicles)                            │
│ external_listing_id: UUID (FK → external_listings)         │
│ watchlist_id: UUID (FK → vehicle_watchlist)                 │
│                                                              │
│ ── Price Tracking ──                                         │
│ current_price: NUMERIC(10,2)                                 │
│ previous_price: NUMERIC(10,2)                               │
│ price_change: NUMERIC(10,2)                                 │
│ price_change_percent: NUMERIC(5,2)                          │
│ price_history: JSONB (array of price points)                │
│                                                              │
│ ── Monitoring Settings ──                                    │
│ monitor_type: TEXT (watchlist_auto_buy|price_drop|...)      │
│ target_price: NUMERIC(10,2)                                 │
│ alert_threshold: NUMERIC(10,2)                               │
│ volatility_threshold: NUMERIC(5,2)                          │
│                                                              │
│ ── Status ──                                                 │
│ is_active: BOOLEAN                                           │
│ triggered: BOOLEAN                                           │
│ triggered_at: TIMESTAMPTZ                                    │
│ last_checked_at: TIMESTAMPTZ                                 │
│ check_frequency_minutes: INTEGER                             │
│                                                              │
│ ── Statistics ──                                             │
│ price_high: NUMERIC(10,2)                                   │
│ price_low: NUMERIC(10,2)                                     │
│ price_avg: NUMERIC(10,2)                                     │
│ volatility_score: NUMERIC(5,2)                              │
│                                                              │
│ ── Metadata ──                                               │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 4. order_history (New)
```
┌─────────────────────────────────────────────────────────────┐
│ order_history                                                │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ user_id: UUID (FK → auth.users)                             │
│ execution_id: UUID (FK → auto_buy_executions)                │
│ vehicle_id: UUID (FK → vehicles)                            │
│                                                              │
│ ── Order Details ──                                          │
│ order_number: TEXT (unique, human-readable)                  │
│ order_type: TEXT                                            │
│ original_price: NUMERIC(10,2)                               │
│ executed_price: NUMERIC(10,2)                               │
│ fees: NUMERIC(10,2)                                          │
│ total_amount: NUMERIC(10,2)                                 │
│                                                              │
│ ── Status ──                                                 │
│ status: TEXT                                                │
│ status_changes: JSONB (array of status transitions)         │
│                                                              │
│ ── Payment & Shipping ──                                    │
│ payment_method_id: UUID                                      │
│ payment_status: TEXT                                        │
│ shipping_address_id: UUID                                    │
│ shipping_status: TEXT                                       │
│                                                              │
│ ── Metadata ──                                               │
│ notes: TEXT                                                 │
│ tags: TEXT[]                                                │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 5. market_data_snapshots (New)
```
┌─────────────────────────────────────────────────────────────┐
│ market_data_snapshots                                        │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ vehicle_id: UUID (FK → vehicles)                            │
│ external_listing_id: UUID (FK → external_listings)          │
│                                                              │
│ ── Price Data ──                                             │
│ snapshot_time: TIMESTAMPTZ                                   │
│ current_price: NUMERIC(10,2)                                 │
│ buy_now_price: NUMERIC(10,2)                                │
│ reserve_price: NUMERIC(10,2)                                │
│ starting_bid: NUMERIC(10,2)                                 │
│                                                              │
│ ── Market Metrics ──                                         │
│ view_count: INTEGER                                          │
│ bid_count: INTEGER                                          │
│ watcher_count: INTEGER                                       │
│ time_remaining: INTERVAL                                     │
│                                                              │
│ ── Source Data ──                                            │
│ source: TEXT (bat|viva|external)                            │
│ listing_url: TEXT                                           │
│ listing_status: TEXT                                        │
│                                                              │
│ ── Metadata ──                                               │
│ raw_data: JSONB                                             │
│ created_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 6. portfolio_summary (New)
```
┌─────────────────────────────────────────────────────────────┐
│ portfolio_summary                                            │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ user_id: UUID (FK → auth.users)                             │
│                                                              │
│ ── Portfolio Metrics ──                                      │
│ total_orders: INTEGER                                       │
│ filled_orders: INTEGER                                      │
│ pending_orders: INTEGER                                      │
│ failed_orders: INTEGER                                      │
│ cancelled_orders: INTEGER                                    │
│                                                              │
│ ── Financial Metrics ──                                      │
│ total_spent: NUMERIC(12,2)                                  │
│ total_saved: NUMERIC(12,2) (vs asking price)               │
│ avg_order_price: NUMERIC(10,2)                               │
│ success_rate: NUMERIC(5,2)                                  │
│                                                              │
│ ── Performance ──                                           │
│ avg_fill_time_hours: NUMERIC(5,2)                           │
│ best_deal_percent: NUMERIC(5,2)                             │
│ worst_deal_percent: NUMERIC(5,2)                            │
│                                                              │
│ ── Active Monitoring ──                                      │
│ active_watchlists: INTEGER                                  │
│ vehicles_being_monitored: INTEGER                            │
│ price_alerts_active: INTEGER                                 │
│                                                              │
│ ── Time Period ──                                            │
│ period_start: TIMESTAMPTZ                                    │
│ period_end: TIMESTAMPTZ                                      │
│ last_calculated_at: TIMESTAMPTZ                              │
│                                                              │
│ ── Metadata ──                                               │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 7. saved_filters (New)
```
┌─────────────────────────────────────────────────────────────┐
│ saved_filters                                                │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ user_id: UUID (FK → auth.users)                             │
│                                                              │
│ ── Filter Details ──                                        │
│ name: TEXT                                                  │
│ description: TEXT                                           │
│ filter_criteria: JSONB (complete filter object)             │
│                                                              │
│ ── Usage ──                                                  │
│ usage_count: INTEGER                                        │
│ last_used_at: TIMESTAMPTZ                                    │
│                                                              │
│ ── Metadata ──                                               │
│ is_public: BOOLEAN                                          │
│ tags: TEXT[]                                                │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

### 8. price_alerts (New)
```
┌─────────────────────────────────────────────────────────────┐
│ price_alerts                                                 │
├─────────────────────────────────────────────────────────────┤
│ id: UUID (PK)                                               │
│ user_id: UUID (FK → auth.users)                             │
│ vehicle_id: UUID (FK → vehicles)                           │
│ watchlist_id: UUID (FK → vehicle_watchlist) (nullable)      │
│                                                              │
│ ── Alert Settings ──                                         │
│ alert_type: TEXT (price_drop|price_rise|target_reached)     │
│ target_price: NUMERIC(10,2)                                 │
│ threshold_percent: NUMERIC(5,2)                             │
│                                                              │
│ ── Status ──                                                  │
│ is_active: BOOLEAN                                           │
│ triggered: BOOLEAN                                           │
│ triggered_at: TIMESTAMPTZ                                    │
│ notified: BOOLEAN                                            │
│ notified_at: TIMESTAMPTZ                                     │
│                                                              │
│ ── Metadata ──                                               │
│ created_at: TIMESTAMPTZ                                      │
│ updated_at: TIMESTAMPTZ                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Relationships

```
vehicle_watchlist
  ├── 1:N → auto_buy_executions (watchlist_id)
  ├── 1:N → price_monitoring (watchlist_id)
  ├── 1:N → price_alerts (watchlist_id)
  └── N:1 → auth.users (user_id)

auto_buy_executions
  ├── N:1 → vehicle_watchlist (watchlist_id)
  ├── N:1 → vehicles (vehicle_id)
  ├── N:1 → external_listings (external_listing_id)
  └── 1:1 → order_history (execution_id)

price_monitoring
  ├── N:1 → vehicles (vehicle_id)
  ├── N:1 → external_listings (external_listing_id)
  └── N:1 → vehicle_watchlist (watchlist_id)

order_history
  ├── N:1 → auth.users (user_id)
  ├── N:1 → auto_buy_executions (execution_id)
  └── N:1 → vehicles (vehicle_id)

market_data_snapshots
  ├── N:1 → vehicles (vehicle_id)
  └── N:1 → external_listings (external_listing_id)

portfolio_summary
  └── N:1 → auth.users (user_id)

saved_filters
  └── N:1 → auth.users (user_id)

price_alerts
  ├── N:1 → auth.users (user_id)
  ├── N:1 → vehicles (vehicle_id)
  └── N:1 → vehicle_watchlist (watchlist_id)
```

---

## Indexes

```sql
-- Performance indexes
CREATE INDEX idx_watchlist_user_active ON vehicle_watchlist(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_watchlist_auto_buy ON vehicle_watchlist(auto_buy_enabled, is_active) WHERE auto_buy_enabled = true;
CREATE INDEX idx_executions_status ON auto_buy_executions(status, triggered_at) WHERE status IN ('pending', 'executing');
CREATE INDEX idx_executions_user ON auto_buy_executions(watchlist_id) INCLUDE (vehicle_id, status, executed_price);
CREATE INDEX idx_price_monitoring_active ON price_monitoring(is_active, target_price, current_price) WHERE is_active = true;
CREATE INDEX idx_market_data_vehicle_time ON market_data_snapshots(vehicle_id, snapshot_time DESC);
CREATE INDEX idx_order_history_user_status ON order_history(user_id, status, created_at DESC);
CREATE INDEX idx_price_alerts_active ON price_alerts(is_active, triggered) WHERE is_active = true AND triggered = false;
```

---

## Views

### 1. watchlist_performance_view
```sql
CREATE VIEW watchlist_performance_view AS
SELECT 
  w.id,
  w.user_id,
  w.make,
  w.model,
  w.auto_buy_enabled,
  COUNT(DISTINCT e.id) as total_executions,
  COUNT(DISTINCT CASE WHEN e.status = 'filled' THEN e.id END) as filled_executions,
  COUNT(DISTINCT CASE WHEN e.status = 'pending' THEN e.id END) as pending_executions,
  SUM(CASE WHEN e.status = 'filled' THEN e.executed_price ELSE 0 END) as total_spent,
  AVG(CASE WHEN e.status = 'filled' THEN e.executed_price END) as avg_price,
  COUNT(DISTINCT pm.id) as vehicles_monitored,
  w.match_count,
  w.last_matched_at
FROM vehicle_watchlist w
LEFT JOIN auto_buy_executions e ON e.watchlist_id = w.id
LEFT JOIN price_monitoring pm ON pm.watchlist_id = w.id
WHERE w.is_active = true
GROUP BY w.id;
```

### 2. market_trends_view
```sql
CREATE VIEW market_trends_view AS
SELECT 
  v.make,
  v.model,
  v.year,
  COUNT(DISTINCT mds.id) as snapshot_count,
  AVG(mds.current_price) as avg_price,
  MIN(mds.current_price) as min_price,
  MAX(mds.current_price) as max_price,
  STDDEV(mds.current_price) as price_volatility,
  MAX(mds.snapshot_time) as last_updated
FROM vehicles v
JOIN market_data_snapshots mds ON mds.vehicle_id = v.id
WHERE mds.snapshot_time > NOW() - INTERVAL '24 hours'
GROUP BY v.make, v.model, v.year;
```

### 3. user_portfolio_summary_view
```sql
CREATE VIEW user_portfolio_summary_view AS
SELECT 
  u.id as user_id,
  COUNT(DISTINCT w.id) as active_watchlists,
  COUNT(DISTINCT e.id) as total_orders,
  COUNT(DISTINCT CASE WHEN e.status = 'filled' THEN e.id END) as filled_orders,
  SUM(CASE WHEN e.status = 'filled' THEN e.executed_price ELSE 0 END) as total_spent,
  AVG(CASE WHEN e.status = 'filled' THEN e.executed_price END) as avg_order_price,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN e.status = 'filled' THEN e.id END) / 
    NULLIF(COUNT(DISTINCT e.id), 0), 
    2
  ) as success_rate
FROM auth.users u
LEFT JOIN vehicle_watchlist w ON w.user_id = u.id AND w.is_active = true
LEFT JOIN auto_buy_executions e ON e.watchlist_id = w.id
GROUP BY u.id;
```

---

## Functions

### 1. calculate_portfolio_summary(user_id UUID)
Recalculates portfolio metrics for a user.

### 2. check_price_alerts(vehicle_id UUID, new_price NUMERIC)
Checks if price change triggers any alerts.

### 3. update_market_data_snapshot(vehicle_id UUID)
Creates a new market data snapshot for a vehicle.

### 4. get_market_trends(make TEXT, model TEXT, days INTEGER)
Returns price trends for a specific make/model.

### 5. execute_pending_orders()
Processes all pending orders that meet execution criteria.

---

## Triggers

### 1. update_portfolio_on_order_fill
Automatically updates portfolio_summary when an order is filled.

### 2. create_price_snapshot_on_update
Creates market_data_snapshot when external_listing price changes.

### 3. trigger_price_alerts_on_change
Checks and triggers price_alerts when price changes.

---

## Data Flow

```
1. User creates watchlist with auto-buy criteria
   → vehicle_watchlist record created
   → price_monitoring records created for matching vehicles

2. Price monitoring detects price change
   → market_data_snapshots record created
   → check_auto_buy_trigger() function called
   → If trigger conditions met → auto_buy_executions record created

3. Auto-buy execution
   → execute_auto_buy() function called
   → If requires confirmation → status = 'pending'
   → If auto-execute → status = 'executing'
   → Edge function processes payment/bid
   → Status updated to 'filled' or 'failed'
   → order_history record created

4. Portfolio updates
   → portfolio_summary recalculated
   → User dashboard updated
   → Notifications sent
```

---

## Security (RLS Policies)

All tables have RLS enabled with policies:
- Users can only view/modify their own data
- Service role can manage all data
- Public read access for market data (aggregated only)

---

## Performance Considerations

1. **Partitioning**: `market_data_snapshots` partitioned by date
2. **Archiving**: Old executions moved to archive table after 1 year
3. **Caching**: Portfolio summaries cached and refreshed hourly
4. **Batch Processing**: Price monitoring runs in batches
5. **Materialized Views**: Market trends view materialized and refreshed every 15 minutes

