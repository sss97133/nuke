# Vehicle State Model

## Core Insight

**Binary distinction**: A vehicle is either **actively being bid on** or **not**.

Everything else is secondary to this primary state.

---

## State Hierarchy

```
                    ┌─────────────────┐
                    │    VEHICLE      │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐          ┌─────────▼────────┐
     │  BEING BID ON   │          │  NOT BEING BID   │
     │  (Live Auction) │          │                  │
     └────────┬────────┘          └─────────┬────────┘
              │                             │
    ┌─────────┴─────────┐         ┌─────────┴─────────┐
    │                   │         │                   │
┌───▼───┐          ┌────▼───┐  ┌──▼───┐          ┌────▼────┐
│ LIVE  │          │ENDING  │  │ SOLD │          │FOR SALE │
│       │          │ SOON   │  │      │          │(passive)│
└───────┘          └────────┘  └──────┘          └─────────┘
```

---

## Auction States (when vehicle is on an auction platform)

| State | Description | Time Window | Badge | Color |
|-------|-------------|-------------|-------|-------|
| `LIVE` | Active auction, accepting bids | > 2 hours remaining | "LIVE" | Blue |
| `ENDING_SOON` | Auction ending soon | 15 min - 2 hours | "ENDING SOON" | Orange |
| `ENDING_NOW` | Auction about to end | < 15 minutes | "ENDING NOW" (pulse) | Red |
| `ENDED` | Auction finished, awaiting confirmation | Just ended | "ENDED" | Gray |
| `SOLD` | Sale confirmed | After confirmation | "SOLD" + price | Green |
| `NO_SALE` | Didn't meet reserve or no bids | After end | "NO SALE" | Yellow |
| `CANCELLED` | Auction was cancelled | - | "CANCELLED" | Red |
| `PENDING` | Scheduled but not started | Before start | "UPCOMING" | Purple |

---

## General Vehicle States (all vehicles, regardless of platform)

| State | Description | How to Identify |
|-------|-------------|-----------------|
| `FOR_SALE` | Available for purchase | Has active listing, asking_price set |
| `SOLD` | Transaction completed | Has sale_price, sold_at date |
| `OFF_MARKET` | Not currently for sale | No active listings, owner keeping |
| `IN_SERVICE` | At a shop / being worked on | Has active service event |

---

## Database Mapping

### `vehicles` table
```sql
-- Derived state based on these fields:
sale_price         -- If set → SOLD
asking_price       -- If set and no sale_price → FOR_SALE
high_bid           -- If set → has auction activity
winning_bid        -- Final auction amount
```

### `external_listings` table
```sql
-- Auction-specific state:
status             -- 'active', 'ended', 'sold', 'cancelled'
ends_at            -- Auction end time (for countdown)
current_bid        -- Current high bid
bid_count          -- Number of bids
reserve_met        -- Boolean
reserve_price      -- If known
```

---

## State Determination Logic

```typescript
function getVehicleState(vehicle: Vehicle, listing?: ExternalListing): VehicleState {
  // Check if in active auction first
  if (listing) {
    const now = new Date();
    const endsAt = new Date(listing.ends_at);
    const timeRemaining = endsAt.getTime() - now.getTime();

    if (listing.status === 'cancelled') return 'CANCELLED';
    if (listing.status === 'sold') return 'SOLD';
    if (listing.status === 'ended') {
      return listing.reserve_met || !listing.reserve_price ? 'SOLD' : 'NO_SALE';
    }

    if (listing.status === 'active') {
      if (timeRemaining < 0) return 'ENDED';
      if (timeRemaining < 15 * 60 * 1000) return 'ENDING_NOW';
      if (timeRemaining < 2 * 60 * 60 * 1000) return 'ENDING_SOON';
      return 'LIVE';
    }

    if (endsAt > now) return 'PENDING';
  }

  // No active auction - check general state
  if (vehicle.sale_price) return 'SOLD';
  if (vehicle.asking_price) return 'FOR_SALE';
  return 'OFF_MARKET';
}
```

---

## Cross-Platform Mapping

| Our State | BaT | Cars & Bids | Hagerty | Mecum | eBay |
|-----------|-----|-------------|---------|-------|------|
| LIVE | "Live" | "Active" | "Live" | "Lot Active" | "Active" |
| ENDING_SOON | (time-based) | (time-based) | (time-based) | - | "Ending soon" |
| SOLD | "Sold" | "Sold" | "Sold" | "Sold" | "Ended - Sold" |
| NO_SALE | "No Reserve Not Met" | "Reserve Not Met" | "Not Sold" | "No Sale" | "Ended - Reserve not met" |

---

## Badge Display Rules

1. **Always show platform badge** - Which auction house (BaT, C&B, Hagerty, etc.)
2. **Always show state badge** - Current auction state
3. **Show countdown when LIVE/ENDING** - Critical for buyers
4. **Show price** - Current bid if LIVE, final price if SOLD
5. **Show bid count** - If available and > 0

### Badge Priority (left to right)
```
[Platform] [State] [Price] [Bids] [Reserve Status]
```

Example:
```
[BaT] [ENDING SOON] [$45,000] [32 bids] [Reserve Met]
```

---

## Implementation Checklist

- [ ] Create `getVehicleState()` utility function
- [ ] Create `VehicleStateBadge` component
- [ ] Add countdown timer component
- [ ] Ensure all cards use consistent state display
- [ ] Ensure marketplace filters by state correctly
- [ ] Remove sold vehicles from active auction views
- [ ] Add "Recently Sold" section for completed auctions
