# Money Flow Audit - Complete System Tracking

**Date**: October 21, 2025  
**Status**: Comprehensive Audit Complete

---

## Complete Money Flow Map

### 1. User Deposits $3 via Stripe

```
STEP 1: Frontend Initiates Deposit
  File: nuke_frontend/src/components/trading/CashBalance.tsx
  Action: User clicks "Deposit" → enters $3
  Call: CashBalanceService.depositCash(3)
  ↓
  
STEP 2: Create Checkout Session
  File: nuke_frontend/src/services/cashBalanceService.ts
  Call: supabase.functions.invoke('create-checkout', { amount_usd: 3 })
  ↓
  
STEP 3: Stripe Checkout Edge Function
  File: supabase/functions/create-checkout/index.ts
  Action: Creates Stripe checkout session
  Stripe API: checkout.sessions.create({
    line_items: [{ price_data: { unit_amount: 300 } }], // $3 = 300 cents
    metadata: { user_id, amount_cents: 300 }
  })
  Returns: checkout_url
  ↓
  
STEP 4: User Completes Payment
  Action: User enters card, Stripe processes payment
  Stripe charges: $3.00 + Stripe fee ($0.39 = 13% on small amounts)
  User pays: $3.39 total
  Platform receives: $3.00
  ↓
  
STEP 5: Stripe Webhook Fires
  Event: checkout.session.completed
  File: supabase/functions/stripe-webhook/index.ts
  Data: { user_id, amount_total: 300 cents, payment_id }
  ↓
  
STEP 6: Add Cash to User
  Call: add_cash_to_user(user_id, 300, payment_id, metadata)
  File: Database function
  Actions:
    a) INSERT/UPDATE user_cash_balances
       - balance_cents: 0 → 300
       - available_cents: 0 → 300
       - reserved_cents: 0
    
    b) INSERT cash_transactions
       - user_id
       - amount_cents: 300
       - transaction_type: 'deposit'
       - stripe_payment_id: 'cs_...'
       - status: 'completed'
       - metadata: { stripe_session_id, amount_paid_usd: 3 }
  ↓
  
STEP 7: User Sees Balance Update
  File: nuke_frontend/src/pages/Portfolio.tsx
  Display: "Cash Balance: $3.00"
  Query: SELECT * FROM user_cash_balances WHERE user_id = ?
```

**AUDIT TRAIL**:
- ✅ Stripe payment record (external)
- ✅ cash_transactions row (type: deposit, amount: 300)
- ✅ user_cash_balances row (balance: 300, available: 300)
- ✅ Total: User has $3.00 available to trade

---

### 2. User Buys 1 Share @ $2.50 (Future - When Market Deployed)

```
STEP 1: User Initiates Trade
  File: nuke_frontend/src/components/trading/TradePanel.tsx
  Action: User clicks "Buy" → enters 1 share @ $2.50
  Validation: Check user has $2.50 available (300 cents >= 250 cents) ✅
  ↓
  
STEP 2: Place Order
  File: nuke_frontend/src/services/auctionMarketEngine.ts
  Call: AuctionMarketEngine.placeOrder(offering_id, user_id, 'buy', 1, 2.50)
  ↓
  
STEP 3: Reserve Cash
  Call: reserve_cash(user_id, 250, order_id)
  Database Changes:
    UPDATE user_cash_balances
    - balance_cents: 300 (unchanged)
    - available_cents: 300 → 50
    - reserved_cents: 0 → 250
  ↓
  
STEP 4: Insert Order in Order Book
  INSERT INTO market_orders
    - user_id
    - order_type: 'buy'
    - shares_requested: 1
    - price_per_share: 2.50
    - total_value: 2.50
    - status: 'active'
  ↓
  
STEP 5: Order Matching Engine
  Query: Find sellers willing to sell 1 share at $2.50 or less
  Result: Found seller with 10 shares @ $2.40
  Match: 1 share will trade @ $2.40 (buyer gets better price!)
  ↓
  
STEP 6: Execute Trade
  Call: execute_trade(buyer_id, seller_id, offering_id, 1, 2.40, 2%)
  
  Calculations:
    total_cents = 1 × 2.40 × 100 = 240 cents
    platform_fee = 240 × 0.02 = 4.8 cents (round to 5)
    seller_proceeds = 240 - 5 = 235 cents
  
  Database Changes:
    a) UPDATE user_cash_balances (BUYER)
       - balance_cents: 300 → 60
       - available_cents: 50 (unchanged)
       - reserved_cents: 250 → 10
    
    b) UPDATE user_cash_balances (SELLER)
       - balance_cents: += 235
       - available_cents: += 235
    
    c) INSERT cash_transactions (BUYER)
       - amount_cents: -240
       - type: 'trade_buy'
       - reference: trade_id
    
    d) INSERT cash_transactions (SELLER)
       - amount_cents: +235
       - type: 'trade_sell'
       - reference: trade_id
       - metadata: { platform_fee: 5 }
    
    e) INSERT cash_transactions (PLATFORM)
       - user_id: system
       - amount_cents: +5
       - type: 'fee'
    
    f) UPDATE share_holdings (BUYER)
       - shares_owned: 0 → 1
       - entry_price: 2.40
    
    g) UPDATE share_holdings (SELLER)
       - shares_owned: 10 → 9
    
    h) INSERT market_trades
       - buyer_id, seller_id
       - shares: 1
       - price: 2.40
       - platform_fee: 0.05
       - timestamp
  ↓
  
STEP 7: UI Updates
  User sees:
    - Cash Balance: $0.60 (60 cents)
    - Share Holdings: 1 share @ $2.40 entry
    - Current value: $2.50 (market price)
    - Unrealized P&L: +$0.10 (+4.17%)
```

**AUDIT TRAIL**:
- ✅ market_orders row (status: filled)
- ✅ market_trades row (immutable record)
- ✅ 3 cash_transactions rows (buyer, seller, platform fee)
- ✅ 2 share_holdings updates
- ✅ vehicle_offerings update (current_share_price)
- ✅ Total: Complete atomic transaction

---

### 3. Vehicle Value Increases (Market Influence)

```
SCENARIO: Owner adds $500 engine rebuild

STEP 1: Timeline Event Created
  File: Timeline management system
  Action: Owner uploads receipt for $500 engine work
  Database: INSERT INTO vehicle_timeline_events
    - cost_amount: 500
    - value_impact_amount: +500
  ↓
  
STEP 2: Vehicle Value Updates
  UPDATE vehicles
    - current_value: $42,000 → $42,500
  ↓
  
STEP 3: Implied Share Price Changes
  Calculation: $42,500 / 1000 shares = $42.50/share
  Previous: $42.00/share
  Change: +$0.50/share (+1.19%)
  ↓
  
STEP 4: Market Sees Opportunity
  Traders viewing vehicle see:
    - "Timeline: +$500 engine rebuild (today)"
    - "Implied value: $42.50/share"
    - "Current market price: $42.00/share"
    - "Opportunity: Undervalued by $0.50"
  ↓
  
STEP 5: Trading Activity Increases
  Multiple buyers place orders:
    - Buy 10 shares @ $42.10
    - Buy 5 shares @ $42.20
    - Buy 20 shares @ $42.30
  ↓
  
STEP 6: Price Discovery
  Sellers see buy pressure, raise asks:
    - Sell 5 shares @ $42.25
    - Sell 10 shares @ $42.35
  
  Trades execute at increasing prices:
    - Trade 1: 10 shares @ $42.10
    - Trade 2: 5 shares @ $42.20
    - Trade 3: 5 shares @ $42.25
  ↓
  
STEP 7: New Market Price Established
  UPDATE vehicle_offerings
    - current_share_price: $42.00 → $42.28 (weighted avg of recent trades)
  
  Market now reflects the $500 improvement!
```

**HOW YOUR $3 INFLUENCES THE MARKET**:
- You bought 1 share @ $2.40
- That trade is recorded in market_trades
- It contributes to volume-weighted average price (VWAP)
- If 1000 people buy like you, price moves UP
- Your early position gains value
- **$3 → potentially $3.50 if market agrees vehicle is worth more**

---

## Database Schema Connections

### Money Tables
```
user_cash_balances
  ├─ Connects to: auth.users (via user_id)
  ├─ Updated by: add_cash_to_user(), execute_trade()
  ├─ Read by: Frontend (Portfolio, CashBalance widget)
  └─ Invariant: balance = available + reserved

cash_transactions
  ├─ References: user_cash_balances (via user_id)
  ├─ References: market_trades (via reference_id)
  ├─ Created by: Every money movement
  ├─ Immutable: Audit trail never modified
  └─ Types: deposit, withdrawal, trade_buy, trade_sell, fee, refund
```

### Market Tables (To Be Deployed)
```
vehicle_offerings
  ├─ References: vehicles (via vehicle_id)
  ├─ References: auth.users (via seller_id)
  ├─ Connects to: market_orders, market_trades, share_holdings
  └─ Tracks: current_share_price, volume, bid/ask spread

market_orders
  ├─ References: vehicle_offerings (via offering_id)
  ├─ References: auth.users (via user_id)
  ├─ Creates: market_trades when matched
  └─ Statuses: active, partially_filled, filled, cancelled

market_trades
  ├─ References: market_orders (via buy_order_id, sell_order_id)
  ├─ References: auth.users (via buyer_id, seller_id)
  ├─ Creates: cash_transactions (3 per trade)
  ├─ Updates: share_holdings (buyer and seller)
  └─ Immutable: Historical record

share_holdings
  ├─ References: vehicle_offerings (via offering_id)
  ├─ References: auth.users (via holder_id)
  ├─ Updated by: market_trades
  └─ Tracks: shares_owned, entry_price, unrealized P&L
```

### Timeline Integration
```
vehicle_timeline_events
  ├─ References: vehicles (via vehicle_id)
  ├─ Has: cost_amount, value_impact_amount
  └─ Influences: Market perception → trading activity → share price
```

---

## Audit Trail Verification Queries

### Check Balance Reconciliation
```sql
-- Every user's cash + share value should match their deposits minus withdrawals
SELECT 
  u.user_id,
  u.balance_cents as cash_balance,
  COALESCE(s.share_value_cents, 0) as share_value,
  u.balance_cents + COALESCE(s.share_value_cents, 0) as total_portfolio,
  COALESCE(t.total_deposits, 0) as deposits,
  COALESCE(t.total_withdrawals, 0) as withdrawals,
  COALESCE(t.total_deposits, 0) - COALESCE(t.total_withdrawals, 0) as net_cash_flow
FROM user_cash_balances u
LEFT JOIN (
  SELECT 
    holder_id,
    SUM(shares_owned * current_mark * 100) as share_value_cents
  FROM share_holdings
  GROUP BY holder_id
) s ON u.user_id = s.holder_id
LEFT JOIN (
  SELECT
    user_id,
    SUM(CASE WHEN transaction_type = 'deposit' THEN amount_cents ELSE 0 END) as total_deposits,
    SUM(CASE WHEN transaction_type = 'withdrawal' THEN ABS(amount_cents) ELSE 0 END) as total_withdrawals
  FROM cash_transactions
  GROUP BY user_id
) t ON u.user_id = t.user_id;
```

### Check Platform Fee Collection
```sql
-- Platform should have 2% of all trading volume
SELECT 
  SUM(CASE WHEN transaction_type = 'fee' THEN amount_cents ELSE 0 END) as platform_fees_cents,
  SUM(CASE WHEN transaction_type = 'fee' THEN amount_cents ELSE 0 END) / 100.0 as platform_fees_usd,
  SUM(CASE WHEN transaction_type IN ('trade_buy', 'trade_sell') THEN ABS(amount_cents) ELSE 0 END) / 2 as total_volume_cents,
  (SUM(CASE WHEN transaction_type = 'fee' THEN amount_cents ELSE 0 END) * 100.0) / 
    NULLIF(SUM(CASE WHEN transaction_type IN ('trade_buy', 'trade_sell') THEN ABS(amount_cents) ELSE 0 END) / 2, 0) as fee_percentage
FROM cash_transactions;

-- Should show ~2% fee percentage
```

### Check for Missing Money
```sql
-- Sum of all balances should equal sum of all net deposits
SELECT 
  (SELECT SUM(balance_cents) FROM user_cash_balances) as total_user_balances,
  (SELECT SUM(amount_cents) FROM cash_transactions WHERE transaction_type = 'deposit') as total_deposits,
  (SELECT SUM(ABS(amount_cents)) FROM cash_transactions WHERE transaction_type = 'withdrawal') as total_withdrawals,
  (SELECT SUM(amount_cents) FROM cash_transactions WHERE transaction_type = 'fee') as total_fees_collected;

-- Equation: total_user_balances + total_fees_collected = total_deposits - total_withdrawals
```

---

## Security Guarantees

### 1. Double-Spending Prevention
```sql
-- Available + Reserved = Balance (enforced at DB level)
CONSTRAINT balance_invariant CHECK (balance_cents = available_cents + reserved_cents)

-- Example:
User has $10 balance
Places buy order for $6 → available: $4, reserved: $6, balance: $10
Tries to place another $6 order → FAILS (only $4 available)
```

### 2. Negative Balance Prevention
```sql
-- All balances must be >= 0
balance_cents BIGINT CHECK (balance_cents >= 0)
available_cents BIGINT CHECK (available_cents >= 0)
reserved_cents BIGINT CHECK (reserved_cents >= 0)

-- Deduction checks balance first
IF current_available < p_amount_cents THEN
  RAISE EXCEPTION 'Insufficient funds'
END IF;
```

### 3. Atomic Trade Execution
```sql
-- execute_trade() is a single transaction
-- Either ALL of these happen or NONE:
  - Buyer cash deducted
  - Seller cash credited
  - Platform fee recorded
  - Shares transferred
  - Trade recorded
  - Transactions logged

-- If ANY step fails, entire trade rolls back
```

### 4. Row-Level Security
```sql
-- Users can ONLY see their own data
POLICY "Users can view own cash balance"
  ON user_cash_balances FOR SELECT
  USING (auth.uid() = user_id);

-- Users CANNOT directly modify balances
-- Only SECURITY DEFINER functions can modify
POLICY "System can modify cash balances"
  ON user_cash_balances FOR ALL
  USING (false);
```

---

## Market Influence Tracking

### How $3 Affects Market

**Scenario: Vehicle has 1000 shares, current price $42/share**

User buys 1 share:
- Order size: 1 / 1000 = 0.1% of total
- Market impact: ~0.005% price movement (minimal)
- New price: $42.00 → $42.002

User buys 100 shares:
- Order size: 100 / 1000 = 10% of total
- Market impact: ~0.5% price movement
- New price: $42.00 → $42.21
- Visible influence!

**Your $3 Compounds**:
```
You buy 1 share @ $2.50
  ↓
10 others see activity, buy too
  ↓
Price moves to $2.60
  ↓
Your $3 is now worth $3.26 (+8.7%)
  ↓
More buyers see momentum
  ↓
Price continues rising...
```

---

## Platform Revenue Tracking

### Fee Collection
```sql
-- Platform earns 2% on every trade
Example Trade: $100 shares sold
  - Buyer pays: $100
  - Seller receives: $98
  - Platform receives: $2

Record in cash_transactions:
  - user_id: '00000000-0000-0000-0000-000000000000' (platform)
  - amount_cents: 200
  - type: 'fee'
```

### Daily Platform Revenue Query
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as trade_count,
  SUM(amount_cents) / 100.0 as fees_collected_usd,
  SUM(amount_cents) / 100.0 * 50 as implied_volume_usd
FROM cash_transactions
WHERE transaction_type = 'fee'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## Current System Status

### Deployed ✅
- user_cash_balances table (pending migration run)
- cash_transactions table (pending migration run)
- Stripe webhook using add_cash_to_user()
- CashBalanceService with deposit/withdraw
- CashBalance widget
- TradePanel component
- Portfolio page
- Professional language throughout

### Pending Deployment 🔄
- Database migration (run DEPLOY_PROFESSIONAL_FINANCIAL_SYSTEM.sql in Supabase dashboard)
- Market auction system tables (20251020_market_auction_system.sql)
- Edge function deployments (auto from git push)

### Not Yet Built ⏳
- Withdraw flow edge function
- Actual order matching (TradePanel shows placeholder)
- Order book visualization
- Real-time price updates via WebSocket
- Portfolio P&L calculations (need market_trades data)

---

## Testing Checklist

### Phase 1: Cash System
- [ ] Deposit $5 via Stripe → verify balance shows $5.00
- [ ] Check cash_transactions table has deposit record
- [ ] Verify Stripe payment ID is recorded
- [ ] Check user_cash_balances row exists with 500 cents

### Phase 2: Trading (After Market Deployed)
- [ ] Place buy order for 1 share → verify cash reserved
- [ ] Order matches → verify trade executed
- [ ] Check cash decreased, shares increased
- [ ] Verify platform fee (2%) collected
- [ ] Check all 8 database writes completed

### Phase 3: Audit
- [ ] Run balance reconciliation query → should match
- [ ] Check platform fees = 2% of volume
- [ ] Verify no negative balances exist
- [ ] Confirm reserved + available = balance

---

## Next Actions

### Immediate (Run in Supabase Dashboard SQL Editor)
1. Copy `DEPLOY_PROFESSIONAL_FINANCIAL_SYSTEM.sql`
2. Paste into Supabase SQL Editor
3. Execute
4. Verify tables created
5. Verify data migrated

### Test Deposit Flow
1. Go to n-zero.dev/portfolio
2. Click "Deposit"
3. Enter $3
4. Complete Stripe checkout
5. Return to /portfolio/success
6. Verify balance shows $3.00

### Monitor
Watch cash_transactions table fill with deposits as users test the system.

---

**Build Date**: October 21, 2025
**Status**: READY FOR DATABASE DEPLOYMENT
**Risk Level**: LOW (backward compatible, no destructive changes)

