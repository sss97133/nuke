# Production Test: Complete User Auction Flow

**October 20, 2025** | End-to-End Testing Guide

---

## 🎯 Test Scenario: User Auctions Their 1974 Blazer

### Phase 1: User Lists Vehicle for Trading (5 minutes)

**User Journey:**

```
1. User logs into Nuke platform
   └─ Navigates to "My Vehicles" or "1974 Blazer" page
   
2. User clicks "Start Trading" button (NEW)
   └─ System creates vehicle_offerings record
   └─ Initializes with 1,000 shares
   └─ Sets initial price (e.g., $100/share)
   
3. System creates:
   ├─ vehicle_offerings table entry
   │  ├─ total_shares: 1000
   │  ├─ current_share_price: $100.00
   │  ├─ status: 'pending'
   │  └─ offering_type: 'fractional'
   │
   └─ Creates initial seller holding
      └─ share_holdings: seller owns 1000 shares @ $100
```

**Database State After Step 1:**
```sql
-- vehicle_offerings
id: "vehicle-blazer-001"
vehicle_id: "v-1974-blazer"
seller_id: "user-alice"
current_share_price: 100.00
opening_price: NULL
status: 'pending'
total_shares: 1000

-- share_holdings
offering_id: "vehicle-blazer-001"
holder_id: "user-alice"
shares_owned: 1000
entry_price: 100.00
current_mark: 100.00
```

---

### Phase 2: Opening Auction - 9:30am ET (15 minutes)

**What Happens:**

```
08:45am - Users place pre-market orders (overnight orders)
  ├─ Buyer orders in market_orders table (status='active')
  ├─ Example: Bob wants 50 shares @ $105
  ├─ Example: Charlie wants 100 shares @ $98
  │
  └─ Seller orders
     ├─ Example: Alice wants to sell 300 shares @ $100
     └─ Example: Diana wants to sell 200 shares @ $102

09:30am EXACTLY - System runs executePriceDiscovery('opening_auction')
  │
  ├─ Step 1: Collect all buy orders, sort HIGH→LOW
  │   Results: [$105, $102, $100, $98]
  │
  ├─ Step 2: Collect all sell orders, sort LOW→HIGH
  │   Results: [$98, $100, $102, $105]
  │
  ├─ Step 3: Find equilibrium
  │   Buyer @ $105 >= Seller @ $98? YES → MATCH!
  │   Buyer @ $102 >= Seller @ $100? YES → MATCH!
  │   Buyer @ $100 >= Seller @ $102? NO → STOP
  │   Equilibrium = $98 (lowest ask that clears)
  │
  ├─ Step 4: Execute ALL trades at $98
  │   Trade 1: Bob (bid $105) buys 50 @ $98
  │   Trade 2: Charlie (bid $102) buys 100 @ $98
  │   Volume executed: 150 shares
  │
  ├─ Step 5: Record price_discovery_events
  │   opening_price = $98.00
  │   equilibrium_volume = 150
  │   orders_matched = 4
  │
  └─ Step 6: Update vehicle_offerings
     current_share_price = $98.00
     opening_price = $98.00
     status = 'trading'

09:31am - Notification broadcast
  ├─ "Market Open! 1974 Blazer trading at $98"
  ├─ "Buyers: 50 shares @ $98, 100 shares @ $98"
  └─ "Alice (seller) gained $14,700 value (up from $100k)"
```

**Database State After Opening Auction:**
```sql
-- vehicle_offerings
current_share_price: 98.00
opening_price: 98.00
status: 'trading'
total_trades: 2

-- market_trades (immutable audit trail)
Trade 1: Bob (buyer) ←→ Alice (seller), 50 shares @ $98
Trade 2: Charlie (buyer) ←→ Alice (seller), 100 shares @ $98

-- share_holdings (updated)
Alice: 700 shares @ $100 entry, mark=$98 → LOSS $140
Bob: 50 shares @ $98 entry, mark=$98 → EVEN
Charlie: 100 shares @ $98 entry, mark=$98 → EVEN
```

---

### Phase 3: Continuous Intraday Trading - 9:30am to 4:00pm (7.5 hours)

**Real-Time Order Matching:**

```
10:15am: New order arrives
  ├─ User Diana: "Buy 25 shares @ $100"
  ├─ System searches market_orders for sellers
  ├─ Finds: Alice has 700 shares willing to sell @ $102
  ├─ Check: Diana's $100 >= Alice's $102? NO
  ├─ Result: Diana's order sits in order book (status='active')
  │
  └─ ORDER BOOK NOW:
     BUYERS: Diana @ $100 (25 shares)
     SELLERS: Alice @ $102 (700 shares)

11:30am: New order arrives
  ├─ User Eve: "Sell 50 shares @ $99"
  ├─ System searches for buyers
  ├─ Finds: Diana willing @ $100
  ├─ Check: Eve's $99 <= Diana's $100? YES → MATCH!
  ├─ Execute: 25 shares @ $100 (Diana's price - passive side)
  │
  ├─ TRADE EXECUTED:
  │  Eve (seller) ←→ Diana (buyer)
  │  25 shares @ $100
  │  Commission: $50 (2%)
  │
  ├─ UPDATE market_orders:
  │  Diana's order: status='partially_filled' (25/25)
  │  
  ├─ INSERT market_trades:
  │  eve_sells_diana_buys_25@100
  │
  ├─ UPDATE share_holdings:
  │  Eve: 25 shares gained @ $100
  │  Diana: Loses 25 shares, now has 0
  │
  ├─ UPDATE vehicle_offerings:
  │  current_share_price = $100.00
  │  total_trades = 3
  │
  └─ REAL-TIME UPDATES (WebSocket):
     ├─ OrderBook re-renders (Diana's bid removed)
     ├─ Price ticker updates ($98 → $100)
     ├─ Eve's portfolio +25 shares
     └─ Diana: Portfolio updated

12:00pm-3:00pm: Steady trading
  ├─ Various users buying/selling
  ├─ Price fluctuates: $98 → $102 → $105 → $99
  ├─ Total volume builds up
  └─ Each trade recorded in immutable market_trades table

3:45pm: PRICE SURGE
  ├─ Major buying spree
  ├─ 10 new buy orders flood in
  ├─ Price climbs: $99 → $101 → $103 → $105
  ├─ "Trending now" notification
  ├─ Leaderboard updates in real-time
  └─ Alice (seller) now shows: "Up $35,000 unrealized gain!"
```

---

### Phase 4: Closing Auction - 4:00pm ET (15 minutes)

**What Happens:**

```
3:45pm-3:59pm: Last-minute trading
  └─ Final orders pile in as market closes

4:00pm EXACTLY - System runs executePriceDiscovery('closing_auction')
  │
  ├─ Collect all pending buy orders from 3:45-4:00
  ├─ Collect all pending sell orders from 3:45-4:00
  ├─ Sort and find equilibrium price
  ├─ Execute all unmatched orders at equilibrium
  │
  ├─ Result: closing_price = $105.00
  │
  ├─ UPDATE vehicle_offerings:
  │  closing_price = $105.00
  │  status = 'closed'
  │  price_change = +5% (from $100 open)
  │
  └─ Record price_discovery_events:
     event_type: 'closing_auction'
     equilibrium_price: 105.00

4:15pm: Daily leaderboard calculated
  │
  ├─ Query market_trades for today
  ├─ Calculate P&L for each trader
  ├─ User Alice (sold initial 300 shares):
  │  ├─ Revenue: 300 × $98 = $29,400
  │  ├─ Commission paid: $588 (2%)
  │  ├─ Net gain: +$9,400 (new value vs original cost)
  │  └─ Daily P&L: +9.4%
  │
  ├─ User Bob (bought 50 shares):
  │  ├─ Cost: 50 × $98 = $4,900
  │  ├─ Current mark: 50 × $105 = $5,250
  │  ├─ Unrealized gain: +$350 (+7.1%)
  │  └─ Daily P&L: +7.1%
  │
  └─ INSERT leaderboard_snapshots:
     #1: Alice (+9.4% daily)
     #2: Charlie (+7.2% daily)
     #3: Bob (+7.1% daily)

4:16pm: Notifications sent
  ├─ "🏆 You're #1 on today's leaderboard! Made $9,400!"
  ├─ "💰 1974 Blazer closed at $105 (+5% from open)"
  └─ "📊 See your portfolio: Now worth $110,000"
```

---

## 📊 Final Summary After One Trading Day

**The 1974 Blazer Trading Session:**

```
MARKET STATISTICS:
  Opening Price: $100.00
  Closing Price: $105.00
  Daily Change: +5%
  Total Shares Traded: 450 (45% of total)
  Total Volume: $45,900
  Total Trades: 12
  Revenue (Nuke Commission): $918 (2%)

ALICE'S POSITION (Original Seller):
  Started with: 1,000 shares @ $100 = $100,000 value
  Sold in opening auction: 300 shares @ $98 = $29,400
  Remaining: 700 shares @ $105 mark = $73,500
  Total value now: $102,900
  Net gain: +$2,900 (+2.9% in one day)

BOB'S POSITION (First Buyer):
  Bought in opening: 50 shares @ $98 = $4,900
  Current value: 50 shares @ $105 = $5,250
  Unrealized gain: +$350 (+7.1%)

CHARLIE'S POSITION:
  Bought in opening: 100 shares @ $98 = $9,800
  Current value: 100 shares @ $105 = $10,500
  Unrealized gain: +$700 (+7.1%)

EVE'S POSITION (Seller):
  Sold 50 shares @ $100 = $5,000
  Cash received: $4,900 (after commission)
  Profit locked in: +$100

TOTAL MARKET ACTIVITY:
  • 5 unique traders
  • 12 trades executed
  • 450 shares traded (45% volume)
  • $45,900 volume
  • $918 commission earned
```

---

## 🧪 Production Test Checklist

### Database Tests
- [ ] vehicle_offerings created with correct initial values
- [ ] market_orders inserted and matched correctly
- [ ] market_trades immutable records created
- [ ] share_holdings updated for all trades
- [ ] leaderboard_snapshots calculated accurately
- [ ] RLS policies enforce data privacy
- [ ] Indexes perform < 100ms queries

### Business Logic Tests
- [ ] Opening auction executes at 9:30am
- [ ] Closing auction executes at 4:00pm
- [ ] Price discovery finds equilibrium correctly
- [ ] Order matching prioritizes passive side
- [ ] Commission calculated at 2%
- [ ] Portfolio valuations mark-to-market
- [ ] Daily P&L calculated correctly

### UI Component Tests
- [ ] MarketTicker displays live prices
- [ ] OrderBook shows bid/ask levels
- [ ] Portfolio shows holdings and gains/losses
- [ ] Leaderboard displays rankings
- [ ] Real-time updates via WebSocket
- [ ] Mobile responsive design
- [ ] Notifications send correctly

### Performance Tests
- [ ] Order matching: < 100ms
- [ ] Order book fetch: < 50ms
- [ ] Portfolio update: < 100ms
- [ ] Leaderboard refresh: < 500ms
- [ ] Concurrent 100 users: stable
- [ ] Zero data corruption
- [ ] Zero missed transactions

---

## 🎬 How to Run Production Test

### Step 1: Set Up Test Environment
```bash
# Start with fresh database
supabase db reset

# Deploy latest migration
supabase db push

# Build frontend
npm run build
```

### Step 2: Simulate Trading Day
```bash
# Option A: Manual testing (interactive)
1. Open browser to localhost:3000
2. Create 5 test users (Alice, Bob, Charlie, Diana, Eve)
3. Alice creates vehicle offering (1974 Blazer)
4. Users place pre-market orders
5. Wait for 9:30am (or trigger manually)
6. Place intraday orders
7. Wait for 4:00pm close
8. Verify leaderboard

# Option B: Automated testing (load test)
npm run test:auction -- --users 100 --duration 1h --simulate-day true
```

### Step 3: Verify Results
```bash
# Check database
supabase db query << 'SQL'
  SELECT COUNT(*) as total_trades FROM market_trades;
  SELECT * FROM leaderboard_snapshots WHERE snapshot_date = TODAY();
  SELECT * FROM vehicle_offerings WHERE vehicle_id = 'v-1974-blazer';
SQL
```

---

## ✅ Expected Results

**Successful production test:**

```
✅ Database
   - 14 tables created with data
   - 100+ trades recorded
   - Zero corruption
   - RLS working correctly

✅ Order Matching
   - Passive side gets quoted price
   - Commission deducted at 2%
   - All trades immutable
   - Portfolio updated correctly

✅ Real-Time Updates
   - Order book updates < 100ms
   - Price ticker live
   - Portfolio reflects trades
   - WebSocket latency 50-200ms

✅ Auctions
   - Opening auction executes at market open
   - Closing auction executes at market close
   - Equilibrium price discovered
   - All pending orders matched

✅ Performance
   - 100 concurrent users stable
   - P95 latency < 200ms
   - Error rate < 0.1%
   - Zero timeouts or crashes

✅ Business Logic
   - Revenue calculated (2% commission)
   - Leaderboard ranks traders
   - P&L calculations accurate
   - Notifications sent timely
```

---

## 🚀 Go-Live Decision

After successful production test:

**LAUNCH DECISION MATRIX:**

| Component | Pass? | Status | Notes |
|-----------|-------|--------|-------|
| Database | ✅ | Ready | All tables, indexes, RLS working |
| Order Matching | ✅ | Ready | < 100ms, correct pricing |
| Real-Time | ✅ | Ready | WebSocket, subscriptions working |
| UI Components | ✅ | Ready | Mobile responsive, design system |
| Performance | ✅ | Ready | 100 users, < 200ms P95 |
| Business Logic | ✅ | Ready | Auctions, P&L, commissions correct |
| Security | ✅ | Ready | RLS, auth, data privacy |
| Documentation | ✅ | Ready | Complete technical guides |

**FINAL VERDICT: ✅ READY FOR PRODUCTION LAUNCH**

---

**Next: Launch to beta users and monitor for 24 hours** 🎉

