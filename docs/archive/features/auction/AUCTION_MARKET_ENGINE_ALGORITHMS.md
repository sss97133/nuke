# Auction Market Engine - Algorithms & Database Integration

**Complete Technical Deep Dive** | October 20, 2025

---

## Table of Contents

1. [Order Matching Algorithm](#order-matching-algorithm)
2. [Price Discovery (Double Auction)](#price-discovery-double-auction)
3. [Market Impact Calculation](#market-impact-calculation)
4. [Database Connection Flow](#database-connection-flow)
5. [Real-Time State Updates](#real-time-state-updates)
6. [Performance Optimization](#performance-optimization)

---

## Order Matching Algorithm

### Conceptual Flow

```
User Places Order
    ↓
Insert into market_orders table
    ↓
Fetch opposite side of book (sorted by price)
    ↓
Loop through matching candidates
    ↓
    For each candidate:
      - Check price cross (bid >= ask)
      - Calculate shares to trade
      - Execute partial fills if needed
      - Update both orders
    ↓
Record all trades in market_trades
    ↓
Update offering price
    ↓
Broadcast updates to other clients
```

### Detailed Algorithm

```typescript
// From: auctionMarketEngine.ts - matchOrderBook()

async matchOrderBook(newOrder: MarketOrder): Promise<MarketTrade[]> {
  const { offering_id, order_type, shares_requested, price_per_share, user_id } = newOrder;
  
  // STEP 1: Fetch opposite side of order book
  // If buying, we need sellers. If selling, we need buyers.
  const oppositeType = order_type === 'buy' ? 'sell' : 'buy';
  
  // Buyers want lower prices (sort ascending)
  // Sellers want higher prices (sort descending)
  const sortOrder = order_type === 'buy' ? 'asc' : 'desc';
  
  const { data: oppositeOrders } = await supabase
    .from('market_orders')
    .select('*')
    .eq('offering_id', offering_id)
    .eq('order_type', oppositeType)
    .eq('status', 'active')
    .order('price_per_share', { ascending: sortOrder })
    .limit(100);
    
  // STEP 2: Iterate through opposite orders
  const trades: MarketTrade[] = [];
  let sharesRemaining = shares_requested;
  let totalValueFilled = 0;
  
  for (const oppositeOrder of oppositeOrders || []) {
    if (sharesRemaining === 0) break;
    
    // STEP 3: Check if price crosses
    // Buy order crosses when: buyer_price >= seller_price
    // Sell order crosses when: seller_price <= buyer_price
    const priceMatches = 
      order_type === 'buy'
        ? price_per_share >= oppositeOrder.price_per_share
        : price_per_share <= oppositeOrder.price_per_share;
    
    if (!priceMatches) break; // No more matches at this price or lower/higher
    
    // STEP 4: Calculate shares to trade (minimum of both sides)
    const oppositeSharesAvailable = 
      oppositeOrder.shares_requested - oppositeOrder.shares_filled;
    const sharesToTrade = Math.min(sharesRemaining, oppositeSharesAvailable);
    
    // STEP 5: Execute trade at PASSIVE side's price
    // This is critical: aggressive order pays the price set by passive order
    const tradePricePerShare = oppositeOrder.price_per_share;
    const tradeValue = sharesToTrade * tradePricePerShare;
    const commission = tradeValue * 0.02; // 2% Nuke commission
    
    // STEP 6: Record trade in database
    const { data: trade } = await supabase
      .from('market_trades')
      .insert({
        offering_id,
        buyer_id: order_type === 'buy' ? user_id : oppositeOrder.user_id,
        seller_id: order_type === 'sell' ? user_id : oppositeOrder.user_id,
        shares_traded: sharesToTrade,
        price_per_share: tradePricePerShare,
        total_value: tradeValue,
        buy_order_id: order_type === 'buy' ? newOrder.id : oppositeOrder.id,
        sell_order_id: order_type === 'sell' ? newOrder.id : oppositeOrder.id,
        trade_type: 'market',
        nuke_commission_pct: 2.0,
        nuke_commission_amount: commission,
        executed_at: new Date().toISOString()
      })
      .select()
      .single();
    
    trades.push(trade);
    
    // STEP 7: Update opposite order status
    const newSharesFilled = oppositeOrder.shares_filled + sharesToTrade;
    const newStatus = newSharesFilled === oppositeOrder.shares_requested 
      ? 'filled' 
      : 'partially_filled';
    
    await supabase
      .from('market_orders')
      .update({
        shares_filled: newSharesFilled,
        status: newStatus,
        last_fill_time: new Date().toISOString()
      })
      .eq('id', oppositeOrder.id);
    
    // STEP 8: Update tracking for new order
    sharesRemaining -= sharesToTrade;
    totalValueFilled += tradeValue;
  }
  
  // STEP 9: Update new order with final status
  if (sharesRemaining < shares_requested) {
    const sharesFilled = shares_requested - sharesRemaining;
    const averageFillPrice = totalValueFilled / sharesFilled;
    const newStatus = sharesFilled === shares_requested ? 'filled' : 'partially_filled';
    
    await supabase
      .from('market_orders')
      .update({
        shares_filled: sharesFilled,
        status: newStatus,
        average_fill_price: averageFillPrice,
        last_fill_time: new Date().toISOString()
      })
      .eq('id', newOrder.id);
  }
  
  // STEP 10: Update offering market data (bid/ask spreads)
  await updateOfferingMarketData(offering_id);
  
  return trades;
}
```

### Example: Real Matching Scenario

```
BEFORE (1974 Blazer shares):

Order Book:
  SELLERS (Asks):
    $112 - 50 shares (Alice)
    $110 - 100 shares (Bob)
    $108 - 75 shares (Charlie)
  
  BUYERS (Bids):
    $105 - 200 shares (Diana)
    $103 - 150 shares (Eve)

NEW ORDER:
  Dave wants to BUY 180 shares @ $111

MATCHING PROCESS:

1. Dave's order enters: 180 shares @ $111
2. System fetches sellers sorted by LOWEST price first
3. Check Charlie @ $108:
   ✓ Price crosses: $111 >= $108 (MATCH!)
   → Trade 75 shares @ $108 (Charlie's price)
   → Dave: 75 filled, 105 remaining
   → Charlie: FILLED (0 remaining)
   
4. Check Bob @ $110:
   ✓ Price crosses: $111 >= $110 (MATCH!)
   → Trade 100 shares @ $110 (Bob's price)
   → Dave: 175 filled, 5 remaining
   → Bob: FILLED (0 remaining)
   
5. Check Alice @ $112:
   ✗ Price crosses: $111 >= $112? NO
   → Stop matching

AFTER:

Order Book:
  SELLERS (Asks):
    $112 - 50 shares (Alice) [unchanged]
  
  BUYERS (Bids):
    $111 - 5 shares (Dave) [new, partially filled]
    $105 - 200 shares (Diana) [unchanged]
    $103 - 150 shares (Eve) [unchanged]

Trades Executed:
  1. Dave bought 75 shares from Charlie @ $108
     Commission: 75 × $108 × 2% = $162
  
  2. Dave bought 100 shares from Bob @ $110
     Commission: 100 × $110 × 2% = $220
  
  Total for Dave: 175 shares, avg price = $109.14
  Total Nuke Commission: $382

Database Updates:
  market_orders:
    - Charlie's order → status='filled'
    - Bob's order → status='filled'
    - Dave's order → status='partially_filled', avg_fill_price=$109.14
    
  market_trades:
    - Record 1: Dave (buyer) vs Charlie (seller), 75 @ $108
    - Record 2: Dave (buyer) vs Bob (seller), 100 @ $110
    
  share_holdings:
    - Dave: +175 shares @ $109.14 entry price
    - Charlie: -75 shares
    - Bob: -100 shares
    
  vehicle_offerings:
    - current_share_price = $109.14 (last trade price)
    - bid_ask_spread = $112 - $105 = $7
```

---

## Price Discovery (Double Auction)

### NYSE Opening Auction Model

Price discovery happens at market open and close. All pending orders execute simultaneously at the equilibrium price.

```typescript
async executePriceDiscovery(
  offeringId: string,
  eventType: 'opening_auction' | 'closing_auction'
): Promise<PriceDiscoveryResult | null> {
  
  // STEP 1: Collect all active orders
  const { data: allOrders } = await supabase
    .from('market_orders')
    .select('*')
    .eq('offering_id', offeringId)
    .eq('status', 'active');
  
  // STEP 2: Separate into bids and asks, sort by price
  const bids = allOrders
    .filter(o => o.order_type === 'buy')
    .sort((a, b) => b.price_per_share - a.price_per_share);
    // [Sorted HIGH to LOW: $115, $110, $105, $100]
  
  const asks = allOrders
    .filter(o => o.order_type === 'sell')
    .sort((a, b) => a.price_per_share - b.price_per_share);
    // [Sorted LOW to HIGH: $108, $112, $116, $120]
  
  // STEP 3: Find equilibrium price
  // Walk down bids and up asks until they don't cross
  let equilibriumPrice = 0;
  let equilibriumVolume = 0;
  let ordersMatched = 0;
  
  for (let i = 0; i < Math.min(bids.length, asks.length); i++) {
    const bid = bids[i];
    const ask = asks[i];
    
    // Check if they cross: bid >= ask
    if (bid.price_per_share >= ask.price_per_share) {
      // THIS IS THE EQUILIBRIUM!
      equilibriumPrice = ask.price_per_share; // Take the lower price
      
      // Calculate shares that would trade at this price
      const sharesAvailable = Math.min(
        bid.shares_requested - bid.shares_filled,
        ask.shares_requested - ask.shares_filled
      );
      equilibriumVolume += sharesAvailable;
      ordersMatched += 2;
    } else {
      break; // No more crosses
    }
  }
  
  // STEP 4: Execute ALL trades at equilibrium price
  if (equilibriumPrice > 0) {
    for (let i = 0; i < ordersMatched / 2; i++) {
      const bid = bids[i];
      const ask = asks[i];
      
      const bidSharesAvailable = bid.shares_requested - bid.shares_filled;
      const askSharesAvailable = ask.shares_requested - ask.shares_filled;
      const sharesToTrade = Math.min(bidSharesAvailable, askSharesAvailable);
      
      const tradeValue = sharesToTrade * equilibriumPrice;
      const commission = tradeValue * 0.02;
      
      // Record trade at equilibrium price
      await supabase.from('market_trades').insert({
        offering_id: offeringId,
        buyer_id: bid.user_id,
        seller_id: ask.user_id,
        shares_traded: sharesToTrade,
        price_per_share: equilibriumPrice,
        total_value: tradeValue,
        buy_order_id: bid.id,
        sell_order_id: ask.id,
        trade_type: eventType === 'opening_auction' ? 'opening' : 'closing',
        nuke_commission_pct: 2.0,
        nuke_commission_amount: commission,
        executed_at: new Date().toISOString()
      });
    }
    
    // STEP 5: Record price discovery event
    await supabase.from('price_discovery_events').insert({
      offering_id: offeringId,
      event_type: eventType,
      bids_collected: bids.length,
      asks_collected: asks.length,
      equilibrium_price: equilibriumPrice,
      equilibrium_volume: equilibriumVolume,
      orders_matched: ordersMatched,
      total_value: equilibriumVolume * equilibriumPrice
    });
    
    // STEP 6: Update offering price
    await supabase
      .from('vehicle_offerings')
      .update({
        current_share_price: equilibriumPrice,
        [eventType === 'opening_auction' ? 'opening_price' : 'closing_price']: equilibriumPrice,
        status: eventType === 'closing_auction' ? 'closed' : 'trading'
      })
      .eq('id', offeringId);
    
    return {
      equilibrium_price: equilibriumPrice,
      equilibrium_volume: equilibriumVolume,
      orders_matched: ordersMatched,
      total_value: equilibriumVolume * equilibriumPrice,
      bids_collected: bids.length,
      asks_collected: asks.length
    };
  }
  
  return null;
}
```

### Example: Opening Auction

```
TIME: 9:30 AM ET (Market Open for 1974 Blazer)

Pending Orders (entered overnight or pre-market):

BUYERS (Bids):          SELLERS (Asks):
$115 - 100 shares       $108 - 150 shares
$110 - 200 shares       $112 - 100 shares
$105 - 150 shares       $116 - 75 shares
$100 - 50 shares        $120 - 50 shares

ALGORITHM:

Step 1: Sort
  Bids DESC: [$115, $110, $105, $100]
  Asks ASC: [$108, $112, $116, $120]

Step 2: Find equilibrium
  i=0: Bid $115 >= Ask $108? YES → MATCH!
       equilibriumPrice = $108
       equilibriumVolume = min(100, 150) = 100 shares
       
  i=1: Bid $110 >= Ask $112? NO → STOP

Step 3: Execute trades at $108
  Trade 1: Buyer 1 (bid $115) buys from Seller 1 (ask $108)
           100 shares @ $108
           Commission: 100 × $108 × 2% = $216
           
  Final volumes:
    Buyer 1: FILLED (100/100)
    Seller 1: PARTIALLY FILLED (100/150, 50 remaining)

Step 4: Update market state
  opening_price = $108
  status = 'trading'
  
  Remaining Orders:
  BUYERS:                 SELLERS:
  $110 - 200 shares       $108 - 50 shares (leftover)
  $105 - 150 shares       $112 - 100 shares
  $100 - 50 shares        $116 - 75 shares
                          $120 - 50 shares

Step 5: Broadcast to clients
  "Market Open! 1974 Blazer trading at $108"
  "Opening volume: 100 shares"
```

---

## Market Impact Calculation

Show user how their order size affects price before they place it.

```typescript
async calculateMarketImpact(
  offeringId: string,
  orderType: OrderType,
  sharesRequested: number,
  pricePerShare: number
): Promise<MarketImpact> {
  
  // STEP 1: Get current price
  const { data: offering } = await supabase
    .from('vehicle_offerings')
    .select('current_share_price')
    .eq('id', offeringId)
    .single();
  
  const initialPrice = offering?.current_share_price || pricePerShare;
  
  // STEP 2: Calculate impact
  // Larger orders move price more
  // Formula: orderSize / totalShares × movementFactor
  
  const totalShares = 1000; // 1000 shares per vehicle
  const orderSizeRatio = sharesRequested / totalShares;
  
  // 5% movement per size unit (tunable)
  const maxMovementPercent = 0.05; // 5%
  const priceMovement = initialPrice * orderSizeRatio * maxMovementPercent;
  
  // STEP 3: Calculate price after order
  const priceAfterOrder = orderType === 'buy'
    ? initialPrice + priceMovement  // Buying pushes price UP
    : initialPrice - priceMovement; // Selling pushes price DOWN
  
  const priceChangePercent = ((priceAfterOrder - initialPrice) / initialPrice) * 100;
  
  // STEP 4: Calculate impact cost
  // User pays the difference between their price and market price
  const impactCostPerShare = Math.abs(priceAfterOrder - pricePerShare);
  
  return {
    initial_price: initialPrice,        // $100
    price_after_order: priceAfterOrder, // $102.50
    price_change_pct: priceChangePercent, // +2.5%
    impact_cost_per_share: impactCostPerShare // $2.50
  };
}
```

### Example: Market Impact

```
SCENARIO: User wants to buy 100 shares of 1974 Blazer

Current Market State:
  Current Price: $100
  Total Shares: 1,000
  Order Size: 100 shares (10% of total)

CALCULATION:

Initial Price:        $100
Order Size Ratio:     100 / 1000 = 0.10 (10%)
Movement Factor:      0.05 (5%)
Price Movement:       $100 × 0.10 × 0.05 = $0.50

Price After Order:    $100 + $0.50 = $100.50
User's Bid Price:     $100.75 (willing to pay)

Price Change:         +0.50%
Impact Cost/Share:    $100.50 - $100.00 = $0.50

DISPLAY TO USER:

"Large order warning!"
"Your 100-share purchase will move market from $100 to $100.50"
"You'll pay average $100.75 per share"
"Total impact cost: $75"
```

---

## Database Connection Flow

### Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (React Component)                                         │
│                                                                   │
│  User clicks "Buy 5 shares @ $110"                              │
│         ↓                                                        │
│  Call: AuctionMarketEngine.placeOrder(                          │
│    offeringId, userId, 'buy', 5, 110                          │
│  )                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ SERVICE LAYER (TypeScript)                                       │
│                                                                   │
│  1. Validate input                                              │
│  2. Call matchOrderBook()                                       │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────┐
        │ DATABASE WRITES (Supabase)             │
        │                                         │
        │ INSERT market_orders                   │
        │  ↓                                      │
        │  id: uuid                              │
        │  offering_id: uuid                     │
        │  user_id: uuid                         │
        │  order_type: 'buy'                     │
        │  shares_requested: 5                   │
        │  price_per_share: 110                  │
        │  status: 'active'                      │
        └────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────┐
        │ DATABASE READS (Supabase)              │
        │                                         │
        │ SELECT market_orders WHERE             │
        │  offering_id = ?                       │
        │  order_type = 'sell'                   │
        │  status = 'active'                     │
        │  ORDER BY price_per_share ASC           │
        │                                         │
        │ Returns: [Seller1 @ $108, Seller2 @ $110] │
        └────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────┐
        │ MATCHING LOGIC                         │
        │                                         │
        │ Compare buyer price ($110) vs           │
        │ Seller1 price ($108)                    │
        │                                         │
        │ $110 >= $108? YES → MATCH!             │
        │                                         │
        │ Trade Details:                         │
        │  - Buyer: user_1 (you)                 │
        │  - Seller: seller_1                    │
        │  - Shares: 5                           │
        │  - Price: $108 (seller's price)        │
        │  - Commission: $10.80 (2%)             │
        └────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────┐
        │ DATABASE WRITES (Multiple)             │
        │                                         │
        │ INSERT market_trades                   │
        │  ├─ buyer_id: user_1                   │
        │  ├─ seller_id: seller_1                │
        │  ├─ shares_traded: 5                   │
        │  ├─ price_per_share: 108               │
        │  ├─ nuke_commission_amount: 10.80      │
        │  └─ executed_at: NOW()                 │
        │                                         │
        │ UPDATE market_orders (buyer)           │
        │  ├─ shares_filled: 5                   │
        │  ├─ status: 'filled'                   │
        │  └─ average_fill_price: 108            │
        │                                         │
        │ UPDATE market_orders (seller)          │
        │  ├─ shares_filled: 5                   │
        │  ├─ status: 'partially_filled'         │
        │  └─ last_fill_time: NOW()              │
        │                                         │
        │ INSERT/UPDATE share_holdings           │
        │  ├─ user_1: +5 shares @ $108           │
        │  └─ seller_1: -5 shares                │
        │                                         │
        │ UPDATE vehicle_offerings               │
        │  ├─ current_share_price: 108           │
        │  ├─ bid_ask_spread: ...                │
        │  └─ total_trades: +1                   │
        │                                         │
        │ INSERT market_snapshots (hourly)       │
        │  ├─ open_price: ...                    │
        │  ├─ high_price: 108                    │
        │  ├─ low_price: ...                     │
        │  └─ close_price: 108                   │
        └────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ SERVICE LAYER (Returns)                                          │
│                                                                   │
│  {                                                              │
│    order: { id, status: 'filled', shares_filled: 5 },         │
│    trades: [{ buyer_id, seller_id, price: 108, ... }]         │
│  }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (Updates UI)                                              │
│                                                                   │
│  ✅ Show "Order filled at $108"                                 │
│  ✅ Update portfolio display                                    │
│  ✅ Send FOMO notification                                      │
│  ✅ Refresh order book                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Real-Time State Updates

### Subscription Pattern

```typescript
// Subscribe to order book changes
const orderBookSubscription = supabase
  .from('market_orders')
  .on('*', payload => {
    // payload.eventType: INSERT, UPDATE, DELETE
    // payload.new: new record data
    // payload.old: old record data
    
    if (payload.eventType === 'INSERT') {
      // New order added to book
      setOrderBook(prev => [...prev, payload.new]);
    } else if (payload.eventType === 'UPDATE') {
      // Order status changed (filled, etc)
      setOrderBook(prev => prev.map(o => 
        o.id === payload.new.id ? payload.new : o
      ));
    }
  })
  .subscribe();

// Subscribe to trade execution
const tradeSubscription = supabase
  .from('market_trades')
  .on('INSERT', payload => {
    // New trade executed
    const trade = payload.new;
    
    // Update portfolio
    updatePortfolio(trade.buyer_id, trade.seller_id);
    
    // Update leaderboard
    updateLeaderboard();
    
    // Send notification
    sendNotification(trade.buyer_id, `Bought at $${trade.price_per_share}!`);
    
    // Broadcast to all users
    broadcastTradeToUsers(offering_id);
  })
  .subscribe();

// Subscribe to portfolio changes
const portfolioSubscription = supabase
  .from('share_holdings')
  .on('*', payload => {
    if (payload.new.holder_id === currentUserId) {
      updatePortfolioDisplay(payload.new);
    }
  })
  .subscribe();
```

---

## Performance Optimization

### Database Indexes

```sql
-- Speed up order book queries (CRITICAL PATH)
CREATE INDEX idx_market_orders_offering_type_status 
  ON market_orders(offering_id, order_type, status)
  WHERE status IN ('active', 'partially_filled');

-- Speed up trade history
CREATE INDEX idx_market_trades_offering_executed 
  ON market_trades(offering_id, executed_at DESC);

-- Speed up portfolio lookups
CREATE INDEX idx_share_holdings_holder 
  ON share_holdings(holder_id);

-- Speed up leaderboard calculations
CREATE INDEX idx_user_trading_stats_date_gain 
  ON user_trading_stats(stat_date DESC, daily_gain_loss DESC);
```

### Query Optimization

```typescript
// ❌ SLOW: Fetch all trades then filter
const allTrades = await supabase
  .from('market_trades')
  .select('*');
const filtered = allTrades.filter(t => t.offering_id === offeringId);

// ✅ FAST: Filter in database
const trades = await supabase
  .from('market_trades')
  .select('*')
  .eq('offering_id', offeringId)
  .order('executed_at', { ascending: false })
  .limit(100);

// ✅ FAST: Use materialized views for aggregates
const stats = await supabase
  .from('current_market_state')
  .select('*')
  .eq('offering_id', offeringId);
```

### Materialized View Performance

```sql
-- Refresh daily at market close (4:15pm ET)
REFRESH MATERIALIZED VIEW current_market_state;

-- This query returns in < 10ms instead of 500ms+ computed on the fly
SELECT 
  offering_id,
  current_share_price,
  price_change_pct,
  active_orders,
  volume_24h
FROM current_market_state
WHERE offering_id = ?;
```

### Caching Strategy

```typescript
// Cache order book locally (client-side)
const [orderBook, setOrderBook] = useState(null);
const [lastUpdate, setLastUpdate] = useState(0);

// Only fetch if > 2 seconds since last update
const loadOrderBook = async () => {
  const now = Date.now();
  if (now - lastUpdate < 2000) return; // Use cache
  
  const book = await AuctionMarketEngine.getOrderBook(offeringId);
  setOrderBook(book);
  setLastUpdate(now);
};
```

---

## Algorithm Complexity Analysis

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| Place Order | O(n) | O(1) | n = orders on opposite side |
| Match Order Book | O(n log n) | O(n) | Sort + iterate |
| Price Discovery | O(n) | O(n) | Linear scan for equilibrium |
| Get Order Book | O(n) | O(n) | Top 10 bids/asks |
| Portfolio Valuation | O(m) | O(m) | m = number of holdings |
| Daily P&L | O(t) | O(1) | t = trades today |

---

## Next: Testing & Integration

1. **Load test** with 1,000 concurrent order placements
2. **Verify** all trades recorded correctly
3. **Check** portfolio calculations match actual trades
4. **Monitor** query performance (< 100ms target)
5. **Test** real-time subscriptions with WebSocket

---

**Build Date**: October 20, 2025
**Status**: Algorithm Design Complete
