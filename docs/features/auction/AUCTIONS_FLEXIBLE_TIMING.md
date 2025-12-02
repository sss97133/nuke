# Auctions with Flexible Timing - n-zer Framework

## Core Philosophy: Real Auction Houses Set the Rules

This is NOT eBay's 7-day auction model. This is **Sotheby's, Phillips, Bonhams** - where:

- ✅ Auctions have **flexible durations** (30 seconds to 7 days)
- ✅ Users can set **any timing** they want
- ✅ Last bid **extends the auction** (creates urgency)
- ✅ Action happens in the **last 2 minutes** (not over a week)
- ✅ Platform helps sellers optimize auction timing based on **data**

---

## Why 7-Day Auctions Are Broken

### The eBay Problem

**eBay Model**:
```
Day 1-3: Few bids (people watching)
Day 4-6: Some activity
Day 7:   Bidders wait until 10 seconds left
Result:  Artificial scarcity, last-second sniping
```

**The Pain**:
- Most value happens in final 30 seconds
- Bidders use bots to auto-bid at deadline
- Sellers can't optimize based on demand
- Watching auction for 7 days is torture

### Real Auction Houses Know Better

**Sotheby's Model**:
```
Lot 1:   Valuable item → 45 minutes (needs time to bid)
Lot 2:   Standard item → 10 minutes (quick sale)
Lot 3:   Hot item → 15 minutes (collectors bidding)
Lot 4:   Risky item → 3 minutes (take-it-or-leave-it)
```

**Key Insight**:
- **Each lot gets optimal time** based on estimated demand
- Auctioneer reads room and adjusts
- Action happens **when bidders are present**
- Higher prices through **competitive bidding**, not artificial scarcity

---

## Flexible Auction Timing

### User-Configurable Durations

Sellers can set auction duration to **ANY value**:

```typescript
interface AuctionConfig {
  // Timing Options
  initial_duration_seconds: number,  // 30s, 60s, 5m, 30m, 1h, 24h, 7d, etc
  extend_on_bid: boolean,            // Last bid extends time?
  extension_time_seconds: number,    // How much time added per bid
  minimum_seconds_remaining: number, // Only extend if <X seconds left
  
  // Bid Floor
  starting_bid: Decimal,
  reserve_price: Decimal,            // Hidden minimum
  
  // Bidding Strategy
  increment_amount: Decimal,         // Minimum bid increment
  increment_percent: Decimal,        // Or percentage-based
  
  // Schedule
  scheduled_start: ISO8601,          // Can be future
  scheduled_end: ISO8601,            // Optional - override duration
}
```

### Real-World Examples

#### Example 1: Hot Stock Item (30-Second Flash)

```
Use Case: Rare engine block, 10 people waiting
Config:
  - Initial: 30 seconds
  - Extend on bid: Yes (+10s per bid)
  - Starting bid: $500
  - Increment: $50

Timeline:
  0:00  Auction starts (5 people ready)
  0:02  First bid: $550 (now 0:40 remaining)
  0:08  Second bid: $600 (now 0:50 remaining)
  0:15  Third bid: $650 (now 1:00 remaining)
  0:22  Fourth bid: $700 (now 1:10 remaining)
  1:02  Fifth bid: $750 (now 1:20 remaining)
  1:15  No more bids
  1:20  SOLD for $750

Total Duration: ~1:20 (instead of 7 days)
Action: Concentrated in final 20 seconds
Result: All serious bidders participated
```

#### Example 2: Standard Vehicle (5-Minute Auction)

```
Use Case: 1974 Pickup truck, moderate interest
Config:
  - Initial: 5 minutes (300 seconds)
  - Extend on bid: Yes (+30s per bid)
  - Starting bid: $8,000
  - Increment: 2% of current bid

Timeline:
  0:00  Auction opens
  1:20  First bid: $8,500 (now 5:00 remaining)
  2:45  Second bid: $9,200 (now 5:30 remaining)
  4:10  Third bid: $10,000 (now 6:00 remaining)
  5:30  Fourth bid: $11,200 (now 6:30 remaining)
  6:10  SOLD for $11,200

Total Duration: ~6:10
Result: Competitive bidding from 4 participants
```

#### Example 3: Casual Browse Item (24-Hour Window)

```
Use Case: Box of random parts, "see if anyone wants it"
Config:
  - Initial: 24 hours
  - Extend on bid: No (fixed end time)
  - Starting bid: $50
  - Increment: $10

Timeline:
  Day 1 12:00  Auction opens
  Day 1 18:30  First bid: $75 (24h countdown starts)
  Day 2 08:00  Second bid: $125 (but no auto-extend)
  Day 2 12:00  Auction ends SOLD for $125

Total Duration: Exactly 24 hours
Result: Sellers can set hard deadline
```

---

## Last-Bid Extension Mechanism

### The Core Algorithm

```typescript
function handleBid(auction: Auction, newBid: Bid) {
  // Check if this bid should extend the auction
  
  const now = Date.now();
  const endsAt = auction.end_time_ms;
  const timeRemaining = endsAt - now;
  
  // Only extend if time is LOW
  if (timeRemaining < auction.minimum_seconds_remaining * 1000) {
    const extension_ms = auction.extension_time_seconds * 1000;
    auction.end_time_ms = now + extension_ms;
    
    // Notify all bidders: "Auction extended!"
    broadcastAuctionExtended(auction, newBid);
  }
  
  // Accept the bid
  auction.current_bid = newBid.amount;
  auction.bid_count++;
  auction.last_bid_at = now;
  
  // Save to database
  await db.auctions.update(auction);
}
```

### Extension Parameters

```typescript
interface ExtensionRules {
  // When does extension trigger?
  extend_if_seconds_remaining_less_than: number,  // e.g., 60 seconds
  
  // How much time gets added?
  add_seconds_per_bid: number,                    // e.g., +30 seconds
  
  // Caps (prevent infinite loops)
  maximum_extensions_allowed: number,             // e.g., max 10 extensions
  maximum_total_duration: number,                 // e.g., can't exceed 1 hour even with extensions
}
```

### Why Extensions Matter

**Without Extensions**:
```
5:00 remaining → 4:59 → 4:58 ... → 0:01 → SOLD
Problem: Bidders wait until final second, bot sniping wins
```

**With Extensions** (60s minimum, +30s per bid):
```
5:00 remaining → bid received → 5:30 remaining
2:00 remaining → bid received → 2:30 remaining
0:45 remaining → bid received → 1:15 remaining
0:30 remaining → bid received → 1:00 remaining
0:15 remaining → NO MORE BIDS → END

Result: Human-competitive, no bot sniping
```

---

## Auction State Machine

### States

```typescript
enum AuctionState {
  SCHEDULED = "scheduled",        // Waiting to start
  ACTIVE = "active",              // Accepting bids
  EXTENDED = "extended",          // Was extended (audit trail)
  ENDING_SOON = "ending_soon",    // <60 seconds remaining
  ENDED = "ended",                // Time expired, processing
  SOLD = "sold",                  // Bid accepted, winner assigned
  UNSOLD = "unsold",              // No bids or reserve not met
  CANCELLED = "cancelled"         // Seller cancelled
}
```

### State Transitions

```
                    [SCHEDULED]
                        ↓
                    [ACTIVE] ← (bids arriving)
                        ↓
                   [ENDING_SOON] (< 60s remaining)
                        ↓ (last bid extends? → back to ACTIVE)
                        ↓
                    [ENDED] (time expired)
                        ↓
                [SOLD] or [UNSOLD]
```

---

## Timer Mechanics

### Client-Side Timer

The browser counts down in real-time (optimistic):

```typescript
interface AuctionTimer {
  end_time_unix_ms: number,        // Server time
  client_now_ms: number,           // Client time when received
  time_delta_ms: number,           // Difference
  
  // Computed
  get seconds_remaining(): number {
    return Math.max(0, (this.end_time_unix_ms - (Date.now() + this.time_delta_ms)) / 1000);
  }
  
  // Refresh every 10s to sync with server
  refreshIfNeeded() {
    if (Date.now() - this.last_sync_ms > 10000) {
      return fetch('/api/auction/{id}/time'); // Get fresh time
    }
  }
}
```

### Server Truth

Server is always authoritative:

```sql
-- Check if auction is still active (run every second)
SELECT 
  id,
  state,
  current_bid,
  EXTRACT(EPOCH FROM (end_time - now())) as seconds_remaining,
  bid_count
FROM auctions
WHERE end_time <= now() AND state = 'ACTIVE'
FOR UPDATE;

-- If seconds_remaining <= 0, transition to ENDED
UPDATE auctions
SET state = 'ENDED'
WHERE id IN (...)
```

---

## Data-Driven Auction Timing

### The Opportunity: Learn From History

Nuke has a massive advantage: **we can learn what durations work best**.

```typescript
interface AuctionAnalytics {
  // What auction durations have worked best?
  average_duration_seconds: number,
  auctions_by_duration: Map<duration_range, stats>,
  
  // What got the best prices?
  price_premium_by_duration: Map<duration, percent_increase>,
  
  // How many bids typically?
  average_bids_per_auction: number,
  bids_by_duration_range: Map<duration, bid_count>,
  
  // What's the optimal window?
  peak_bidding_time_of_day: string,  // "7-9pm UTC"
  peak_bidding_day_of_week: string,  // "Friday"
  
  // Category-specific insights
  by_category: {
    "engine_parts": { optimal_duration: 180, avg_price_premium: 0.12 },
    "trucks": { optimal_duration: 3600, avg_price_premium: 0.18 },
    "misc_parts": { optimal_duration: 1800, avg_price_premium: 0.08 }
  }
}
```

### Recommendation Engine

```typescript
async function recommendAuctionTiming(
  vehicleType: string,
  category: string,
  estimatedValue: number
): Promise<AuctionRecommendation> {
  
  // Look up similar auctions
  const similar = await db.auctions.find({
    where: {
      category,
      state: 'SOLD',
      sold_price_usd: {
        $gte: estimatedValue * 0.8,
        $lte: estimatedValue * 1.2
      }
    }
  });
  
  // Analyze results
  const avgDuration = avg(similar.map(a => a.duration_seconds));
  const avgBids = avg(similar.map(a => a.bid_count));
  const avgPrice = avg(similar.map(a => a.sold_price_usd));
  
  return {
    recommended_duration_seconds: avgDuration,
    expected_bids: avgBids,
    expected_selling_price: avgPrice,
    confidence: 0.85,
    reasoning: `${similar.length} similar items sold with avg ${avgBids} bids in ${avgDuration}s`
  };
}
```

---

## Auction Listing Page

### User Flow

```
1. Seller creates auction:
   ├─ Select timing model
   │  ├─ "Quick sale" (30 seconds - 5 minutes)
   │  ├─ "Standard" (15 - 60 minutes)
   │  ├─ "Bulk" (1 - 7 days)
   │  └─ "Custom" (user enters)
   └─ Set starting bid and increment
   
2. System recommends optimal duration
   └─ "Similar items sold in 8 minutes for $12,450"
   
3. Seller reviews and launches
   
4. Bidders receive notifications
   ├─ "New auction: 1974 Pickup Truck"
   └─ "Starting in 2 minutes, 30 seconds"
   
5. Auction runs with live timer
   ├─ Server pushes updates every 5 seconds
   └─ Client counts down locally
   
6. When time is low:
   ├─ UI shows "ENDING SOON" in red
   ├─ Push notification to all bidders
   └─ Last bid extends timer
   
7. Auction ends
   ├─ Winner assigned
   ├─ Transaction created
   └─ Both parties notified
```

---

## Auction Schedule Examples

### Morning Auctions (US East Coast, 9am-12pm)

```
9:00am  - Lot 1 (Engine): 10-minute auction (quick liquidation)
9:15am  - Lot 2 (Truck): 45-minute auction (collector interest)
10:05am - Lot 3 (Parts box): 20-minute auction
10:30am - Lot 4 (Tools): 15-minute auction
11:00am - Lot 5 (Tires): 12-minute auction
11:15am - Lot 6 (Rare block): 5-minute auction (high demand)
```

### Recommended Schedule by Category

| Category | Optimal Duration | Why |
|----------|------------------|-----|
| Engine parts | 10-15 min | Specialist buyers, quick decision |
| Completed vehicles | 30-45 min | Broader audience, need time to inspect |
| Misc parts | 5-10 min | Bulk liquidation, low per-item value |
| Rare collectibles | 45-120 min | Need time for international bidders |
| Tools/equipment | 15-20 min | Hobbyist interest, moderate decision time |
| Tires/wheels | 10-12 min | Commodity, quick sell |

---

## Auction Revenue Model

### Where Platform Makes Money

```
1. Listing Fee
   └─ $0.50 to list (covers infrastructure)
   
2. Seller Commission
   ├─ 2% of winning bid (competitive vs eBay's 12%)
   └─ Example: $1,000 sale = $20 fee
   
3. Optional Services
   ├─ "Feature" auction (pin to top): $2.99
   ├─ "Verify" (get faster liquidation): $5
   └─ "Relist" (if unsold): $0.25
```

### Example: 100 Auctions Per Day

```
100 auctions × $0.50 listing = $50

Assume:
- 70 auctions sell (70% success rate)
- Average selling price: $500
- Commission: 2%

Revenue:
- Listing: $50
- Commission: 70 auctions × $500 × 0.02 = $700
- Total: $750/day

Annual: $750 × 365 = $273,750
Monthly: ~$22,800
```

---

## Comparison: n-zer vs Competitors

| Feature | n-zer | eBay | Facebook | Sotheby's |
|---------|-------|------|----------|-----------|
| Flexible auction duration | ✅ Yes | ❌ Fixed 3/7/10d | ❌ None | ✅ Yes |
| Last bid extension | ✅ Yes | ✅ Yes (hardcoded) | ❌ No | ✅ Yes |
| Data-driven timing | ✅ Yes | ❌ No | ❌ No | ⚠️ Manual |
| User configurable | ✅ Yes | ❌ No | ❌ N/A | ⚠️ Auctioneer only |
| Vehicle focus | ✅ Yes | ⚠️ General | ⚠️ General | ⚠️ Mostly antiques |
| Real-time updates | ✅ WebSocket | ❌ HTTP poll | ❌ None | ✅ Live |
| Low fees | ✅ 2% | ❌ 12% | ❌ 6% | ❌ 15%+ |
| Platform data moat | ✅ AI valuation | ❌ No | ❌ No | ⚠️ Manual appraisals |

---

## Implementation Checklist

### Phase 1: MVP (1-2 weeks)
- [ ] Auction table schema (duration, extension rules)
- [ ] Bid submission API with timer logic
- [ ] Real-time timer sync (WebSocket)
- [ ] Auction state machine (scheduled → active → ended)
- [ ] Winner assignment and transaction creation
- [ ] UI: Auction card with countdown
- [ ] UI: Bid form with increment validation

### Phase 2: Enhancement (1 week)
- [ ] Last-bid extension logic
- [ ] Server-side timer worker (runs every 5s)
- [ ] Auction notifications (push/email)
- [ ] Analytics tracking (duration vs price)
- [ ] UI: "Time low" warning (red timer)

### Phase 3: Intelligence (1-2 weeks)
- [ ] Auction history aggregation
- [ ] Category-specific statistics
- [ ] Recommendation engine (optimal duration)
- [ ] UI: "Recommended timing" on create form
- [ ] A/B testing framework

### Phase 4: Polish (1 week)
- [ ] Mobile auction UI
- [ ] Bid sniping detection
- [ ] Auction schedule builder
- [ ] Seller analytics dashboard
- [ ] Re-listing failed auctions

---

## Database Schema

See implementation in:
- `supabase/migrations/auctions_flexible_timing.sql`
- Service: `nuke_frontend/src/services/auctionService.ts`
- Components: `nuke_frontend/src/components/auction/`
