# Integration Wiring Guide - Auction Market Engine

**October 20, 2025** | How everything connects

---

## ✅ Current Status

### What's Built
- ✅ Database schema (14 tables + 3 views)
- ✅ Market engine service (auctionMarketEngine.ts)
- ✅ 4 trading UI components (Ticker, OrderBook, Portfolio, Leaderboard)
- ✅ Trading tab wrapper (VehicleProfileTrading.tsx)
- ✅ Comprehensive documentation

### What's Ready to Wire
- ⏳ VehicleProfile integration
- ⏳ Real-time WebSocket subscriptions
- ⏳ API endpoints
- ⏳ Scheduled auction jobs (9:30am, 4:00pm)

---

## Component Architecture

```
VehicleProfile.tsx (Main Vehicle Page)
    ↓
    ├─ Vehicle Details Section (existing)
    ├─ Timeline Section (existing)
    └─ VehicleProfileTrading.tsx (NEW)
        ├─ Tab: MarketTicker.tsx
        │   └─ Buy/Sell buttons
        │   └─ Live price (from vehicle_offerings.current_share_price)
        │   └─ Bid/ask spread
        │
        ├─ Tab: OrderBook.tsx
        │   └─ Top 10 bids (from market_orders, type='buy')
        │   └─ Top 10 asks (from market_orders, type='sell')
        │   └─ Click-to-fill orders
        │
        ├─ Tab: Portfolio.tsx
        │   └─ User's share_holdings for this vehicle
        │   └─ Unrealized gains/losses
        │   └─ Quick sell buttons
        │
        └─ Tab: Leaderboard.tsx
            └─ Daily rankings from leaderboard_snapshots
            └─ User's rank in this vehicle
```

---

## How to Integrate Into VehicleProfile

### Step 1: Import the Trading Tab Wrapper

In `VehicleProfileWindows95.tsx` (or whichever VehicleProfile you use):

```typescript
import VehicleProfileTrading from './VehicleProfileTrading';
```

### Step 2: Add Trading Section to VehicleProfile

```typescript
// In VehicleProfileWindows95 render:
<VehicleProfileTrading
  vehicleId={vehicleId}
  vehicleTitle={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
  userId={user?.id}
/>
```

### Step 3: Full Example Integration

```typescript
const VehicleProfileWindows95 = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { user } = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  
  return (
    <div>
      {/* Existing Vehicle Details */}
      <h1>{vehicle?.year} {vehicle?.make} {vehicle?.model}</h1>
      
      {/* Existing Timeline */}
      <TimelineSection events={timelineEvents} />
      
      {/* NEW: Trading Panel */}
      {vehicleId && (
        <VehicleProfileTrading
          vehicleId={vehicleId}
          vehicleTitle={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          userId={user?.id}
        />
      )}
    </div>
  );
};
```

---

## Data Flow: User Places Order

```
1. User clicks "Buy Shares" in MarketTicker
   ↓
2. BuyOrderForm opens
   ↓
3. User enters shares + price, clicks "Place Buy"
   ↓
4. Calls: AuctionMarketEngine.placeOrder(
     offeringId: vehicle.id,
     userId: user.id,
     orderType: 'buy',
     sharesRequested: 5,
     pricePerShare: 110.00
   )
   ↓
5. Service fetches from database:
   - INSERT into market_orders table
   - SELECT from market_orders (opposite side sellers)
   - Match orders
   - INSERT into market_trades (immutable ledger)
   - UPDATE share_holdings
   - UPDATE vehicle_offerings.current_share_price
   ↓
6. Real-time subscriptions trigger:
   - OrderBook re-renders (new bid/ask)
   - Portfolio re-renders (new holding)
   - Price ticker updates (new price)
   ↓
7. User sees: "Order filled at $108! +$50 today"
```

---

## Database Relationships

```
vehicles (existing)
    ↓
    └─ vehicle_offerings (new) ← ONE offering per vehicle
        ├─ current_share_price
        ├─ status: 'trading' | 'closed'
        └─ total_trades
            │
            ├─ market_orders (many buy/sell orders)
            │   ├─ shares_requested
            │   ├─ shares_filled
            │   └─ price_per_share
            │       │
            │       └─ market_trades (WHEN MATCHED)
            │           ├─ buyer_id
            │           ├─ seller_id
            │           ├─ price_per_share (from passive order)
            │           └─ nuke_commission_amount (2%)
            │
            └─ share_holdings (user portfolios)
                ├─ holder_id (user who owns)
                ├─ shares_owned
                ├─ entry_price (avg cost)
                └─ current_mark (latest price)
```

---

## Real-Time Updates (WebSocket)

### Subscription Pattern

```typescript
// In VehicleProfileTrading.tsx (or component that needs real-time updates)

useEffect(() => {
  // Subscribe to market_orders changes
  const orderSub = supabase
    .from('market_orders')
    .on('*', payload => {
      if (payload.new.offering_id === vehicleId) {
        // New bid/ask added to order book
        setOrderBook(prev => updateOrderBook(prev, payload.new));
      }
    })
    .subscribe();

  // Subscribe to market_trades
  const tradeSub = supabase
    .from('market_trades')
    .on('INSERT', payload => {
      if (payload.new.offering_id === vehicleId) {
        // New trade executed
        updatePrice(payload.new.price_per_share);
        sendNotification(`Trade executed at $${payload.new.price_per_share}`);
      }
    })
    .subscribe();

  // Subscribe to share_holdings (portfolio updates)
  const holdingSub = supabase
    .from('share_holdings')
    .on('*', payload => {
      if (payload.new.holder_id === userId) {
        // Portfolio changed
        updatePortfolio(payload.new);
      }
    })
    .subscribe();

  return () => {
    supabase.removeSubscription(orderSub);
    supabase.removeSubscription(tradeSub);
    supabase.removeSubscription(holdingSub);
  };
}, [vehicleId, userId]);
```

---

## API Endpoints (To Be Created)

```
POST /api/orders
  {
    offering_id: "uuid",
    order_type: "buy" | "sell",
    shares_requested: 5,
    price_per_share: 110.00
  }
  → Returns: { order, trades }

GET /api/orders/:offering_id
  → Returns: { bids, asks, spread }

POST /api/orders/:order_id/cancel
  → Returns: { success: true }

GET /api/portfolio/:user_id
  → Returns: { holdings, total_value, daily_pnl }

GET /api/leaderboard
  → Returns: { rankings, your_rank }

GET /api/offerings/:offering_id/trades
  → Returns: { trades_today, volume, price_history }
```

---

## Scheduled Jobs (To Be Created)

```
EVERY DAY at 9:30am ET:
  └─ AuctionMarketEngine.executePriceDiscovery('opening_auction')
     └─ Execute all pending orders at equilibrium price
     └─ Set vehicle_offerings.opening_price
     └─ Broadcast "Market Open!" notification

EVERY DAY at 4:00pm ET:
  └─ AuctionMarketEngine.executePriceDiscovery('closing_auction')
     └─ Execute all pending orders at equilibrium price
     └─ Set vehicle_offerings.closing_price
     └─ Update vehicle_offerings.status = 'closed'

EVERY DAY at 4:15pm ET:
  └─ Calculate daily leaderboard
     └─ user_trading_stats (daily P&L, wins)
     └─ leaderboard_snapshots (daily rankings)
     └─ Send "You're #42 on leaderboard!" notifications
```

---

## File Structure

```
nuke_frontend/src/
├── services/
│   └─ auctionMarketEngine.ts ✅ (800 lines)
│      ├─ placeOrder()
│      ├─ matchOrderBook()
│      ├─ executePriceDiscovery()
│      ├─ calculateMarketImpact()
│      ├─ getOrderBook()
│      ├─ getPortfolioValue()
│      └─ getDailyPnL()
│
├── components/
│   ├─ vehicle/
│   │   ├─ VehicleProfileWindows95.tsx (existing)
│   │   └─ VehicleProfileTrading.tsx ✅ (NEW)
│   │      └─ Tabs for trading interface
│   │
│   └─ trading/
│       ├─ MarketTicker.tsx ✅ (300 lines)
│       │  └─ Live prices, buy/sell buttons
│       │
│       ├─ OrderBook.tsx ✅ (400 lines)
│       │  └─ Bid/ask visualization
│       │
│       ├─ Portfolio.tsx ✅ (350 lines)
│       │  └─ Holdings & gains
│       │
│       └─ Leaderboard.tsx ✅ (250 lines)
│          └─ Daily rankings
│
└─ pages/
   └─ Vehicle/
      └─ index.tsx (uses VehicleProfileWindows95)
```

---

## Testing Checklist

- [ ] Add VehicleProfileTrading to VehicleProfile.tsx
- [ ] Test MarketTicker renders with correct vehicle
- [ ] Test buy order creates market_orders entry
- [ ] Test order matching (buyer + seller → trade executes)
- [ ] Test order book updates in real-time
- [ ] Test portfolio updates when order fills
- [ ] Test WebSocket subscriptions work
- [ ] Test leaderboard shows top traders
- [ ] Load test with 100 concurrent traders
- [ ] Test price discovery at 4:00pm ET

---

## Performance Checklist

- [ ] Order matching: < 100ms
- [ ] Order book fetch: < 50ms
- [ ] Portfolio update: < 100ms
- [ ] WebSocket latency: 50-200ms
- [ ] Database queries use indexes
- [ ] Materialized views refreshed at market close

---

## WIRING COMPLETE CHECKLIST

### Core System ✅
- [x] Database schema (14 tables + 3 views)
- [x] Market engine service
- [x] Order matching algorithm
- [x] Price discovery algorithm
- [x] UI components (4)

### Integration ⏳
- [ ] Integrate VehicleProfileTrading into VehicleProfile
- [ ] Add WebSocket real-time subscriptions
- [ ] Create API endpoints
- [ ] Set up scheduled jobs (9:30am, 4:00pm)
- [ ] Add error handling + logging
- [ ] Deploy to Supabase

### Testing ⏳
- [ ] Unit tests for algorithms
- [ ] Integration tests for database flows
- [ ] Load testing (10k concurrent users)
- [ ] Real-time subscription tests
- [ ] Mobile responsiveness tests

---

## Quick Start: Add Trading to Any Vehicle

```typescript
// 1. Find the VehicleProfile component (e.g., VehicleProfileWindows95.tsx)
// 2. Add import:
import VehicleProfileTrading from './VehicleProfileTrading';

// 3. Add to JSX (after vehicle details, before footer):
{vehicleId && (
  <VehicleProfileTrading
    vehicleId={vehicleId}
    vehicleTitle={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
    userId={user?.id}
  />
)}

// 4. That's it! Trading tabs now visible
```

---

## Next Steps

1. **This Week**: Integrate VehicleProfileTrading into VehicleProfile
2. **This Week**: Add WebSocket subscriptions for real-time updates
3. **Next Week**: Create API endpoints for order management
4. **Next Week**: Set up scheduled auction jobs (9:30am, 4:00pm)
5. **Before Launch**: Load test with 10k concurrent users
6. **Launch**: Deploy to Supabase + production

---

**Status**: READY FOR INTEGRATION ✅
**Est. Integration Time**: 2-3 hours
**Est. API Implementation**: 4-6 hours
**Est. Testing**: 4-8 hours

**Total: ~14 hours to production-ready state**

