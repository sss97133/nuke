# N-Zero Price Field Model

**Document Version:** 1.0
**Date:** 2026-01-22
**Purpose:** Definitive source of truth for price field semantics

---

## Core Principle

> **Every price must be accurate to the last penny.**
> Financial analysis depends on this. No exceptions.

---

## Price Field Hierarchy

The display priority in the frontend (`VehicleCardDense.tsx:274-298`) is:

```typescript
// PRIORITY ORDER:
// 1. sale_price (executed transaction)
// 2. liveBid (active auction, from external_listings.current_bid)
// 3. winning_bid (sold auction result)
// 4. high_bid (ended / RNM auctions)
// 5. current_bid (legacy vehicle field fallback)
// 6. asking_price (only if explicitly for sale)
// 7. current_value (Nuke mark / estimate)
// 8. purchase_price (owner context)
// 9. msrp (baseline)
```

---

## Table Architecture

### Two-Table System

| Table | Purpose | Authority |
|-------|---------|-----------|
| `external_listings` | Live auction data | **Source of truth** for external auction prices |
| `vehicles` | Vehicle profile + cached prices | Display cache, synced from external_listings |

### Data Flow

```
external_listings (source)  →  vehicles (cache)
─────────────────────────────────────────────────
current_bid                 →  high_bid (active)
final_price                 →  sale_price, winning_bid, high_bid (sold)
```

---

## Field Definitions

### `external_listings` Table (SOURCE OF TRUTH FOR AUCTIONS)

| Field | Meaning | When Set | Example |
|-------|---------|----------|---------|
| `current_bid` | Latest bid on active auction | Every bid update | 45000 |
| `final_price` | Final sale price (auction sold) | When sold | 52000 |
| `reserve_price` | Reserve threshold | From listing metadata | 40000 |
| `bid_count` | Number of bids placed | Every bid update | 47 |
| `listing_status` | `active`, `ended`, `sold` | State changes | 'sold' |
| `sold_at` | Sale timestamp | When sold | 2026-01-15T18:30:00Z |

### `vehicles` Table (DISPLAY CACHE + CLASSIFIEDS)

| Field | Meaning | When Set | Source |
|-------|---------|----------|--------|
| `asking_price` | Fixed sale price (classifieds) | Classified listings | Craigslist, dealer, user |
| `sale_price` | Final transaction price | Auction sold OR private sale | `external_listings.final_price` OR direct entry |
| `high_bid` | Highest bid received | Active/ended auctions | `external_listings.current_bid` |
| `winning_bid` | Winning auction bid | **SOLD auctions only** | `external_listings.final_price` |
| `current_value` | User/system estimate | Manual valuation | User or AI estimate |
| `purchase_price` | What owner paid | Ownership records | User entry |
| `msrp` | Manufacturer MSRP | New car data | OEM data |
| `price` | **DEPRECATED** | Legacy/generic | Do not use for new data |

---

## Vehicle States & Price Resolution

### 1. Classified Listing (For Sale)

**Source:** Craigslist, dealer website, user listing
**Fields to set:**
- `vehicles.asking_price` ✓

**Display:** Show asking_price with "Asking" label

```sql
-- Example
INSERT INTO vehicles (make, model, year, asking_price, status)
VALUES ('Porsche', '911', 1987, 45000, 'active');
```

### 2. Active Auction

**Source:** BaT, Cars & Bids, Mecum, etc.
**Fields to set:**
- `external_listings.current_bid` ✓
- `external_listings.bid_count` ✓
- `vehicles.high_bid` (synced via trigger)

**Display:** Show high_bid with "Current Bid" label, bid count badge

### 3. Sold Auction

**Source:** External auction platform marks sold
**Fields to set:**
- `external_listings.final_price` ✓
- `external_listings.sold_at` ✓
- `external_listings.listing_status = 'sold'` ✓
- `vehicles.sale_price` (synced via trigger)
- `vehicles.winning_bid` (synced via trigger)
- `vehicles.high_bid` (synced via trigger)

**Display:** Show sale_price with "Sold" label and date

### 4. Reserve Not Met (RNM)

**Source:** Auction ended without meeting reserve
**Fields to set:**
- `external_listings.listing_status = 'ended'` ✓
- `vehicles.high_bid` (final bid amount)
- `vehicles.auction_outcome = 'reserve_not_met'`

**Display:** Show high_bid with "High Bid (RNM)" label

### 5. User Valuation (Estimate)

**Source:** User enters estimated value
**Fields to set:**
- `vehicles.current_value` ✓

**Display:** Show current_value with "Estimated Value" label

### 6. Ownership Record

**Source:** User owns vehicle, enters purchase details
**Fields to set:**
- `vehicles.purchase_price` ✓

**Display:** Show purchase_price in ownership context only

---

## Database Triggers (Automatic Sync)

### `sync_active_auction_prices_to_vehicles()`
- **Trigger:** `external_listings` INSERT/UPDATE when `listing_status = 'active'`
- **Action:** Copies `current_bid` → `vehicles.high_bid`
- **Does NOT set:** `winning_bid` (reserved for sold)

### `auto_mark_vehicle_sold_from_external_listing()`
- **Trigger:** `external_listings.listing_status` becomes `'sold'`
- **Action:** Sets `vehicles.sale_price`, `winning_bid`, `high_bid` from `final_price`

---

## Frontend Price Resolution

From `VehicleCardDense.tsx`:

```typescript
// Get live auction data if available
const externalListing = vehicle.external_listings?.[0];
const liveBid = externalListing?.current_bid;

// Price priority cascade
const priceValue =
  salePrice ??      // 1. Executed sale (highest priority)
  liveBid ??        // 2. Active auction (fresh data)
  winningBid ??     // 3. Sold auction (historical)
  highBid ??        // 4. Ended auction / RNM
  currentBid ??     // 5. Legacy fallback
  asking ??         // 6. Classified listing
  currentValue ??   // 7. User estimate
  purchasePrice ??  // 8. Ownership context
  msrp ??           // 9. MSRP baseline
  null;

// Label determination
const priceLabel =
  salePrice ? 'Sold' :
  liveBid ? 'Current Bid' :
  winningBid ? 'Sold' :
  highBid ? (isRNM ? 'High Bid (RNM)' : 'High Bid') :
  asking ? 'Asking' :
  currentValue ? 'Est. Value' :
  purchasePrice ? 'Purchase Price' :
  msrp ? 'MSRP' :
  null;
```

---

## Forbidden Patterns

### DO NOT:
1. Store auction bid in `asking_price` (asking_price is for classifieds only)
2. Set `winning_bid` for active/unsold auctions
3. Use the generic `price` field for new data
4. Store redundant copies (same value in multiple fields)
5. Override `sale_price` after a vehicle is marked sold

### DEPRECATED:
- `vehicles.price` - Use `asking_price` or `sale_price` instead
- `vehicles.current_bid` - Use `external_listings.current_bid` instead

---

## Data Quality Checks

```sql
-- 1. Find vehicles with winning_bid but not sold
SELECT id, make, model, winning_bid, sale_status, auction_outcome
FROM vehicles
WHERE winning_bid IS NOT NULL
  AND COALESCE(sale_status, '') != 'sold'
  AND COALESCE(auction_outcome, '') != 'sold';

-- 2. Find auction vehicles without external_listings
SELECT v.id, v.make, v.model, v.auction_source
FROM vehicles v
LEFT JOIN external_listings el ON el.vehicle_id = v.id
WHERE v.auction_source IN ('Bring a Trailer', 'Cars & Bids', 'Mecum')
  AND el.id IS NULL;

-- 3. Find price mismatches between tables
SELECT
  v.id, v.make, v.model,
  v.sale_price as v_sale_price,
  el.final_price as el_final_price,
  ABS(COALESCE(v.sale_price, 0) - COALESCE(el.final_price, 0)) as diff
FROM vehicles v
JOIN external_listings el ON el.vehicle_id = v.id
WHERE el.listing_status = 'sold'
  AND v.sale_price IS NOT NULL
  AND el.final_price IS NOT NULL
  AND v.sale_price != el.final_price::integer;
```

---

## Migration Path

### Phase 1: Document (DONE)
- [x] Create this document

### Phase 2: Validate
- [ ] Run data quality checks
- [ ] Identify inconsistencies
- [ ] Generate fix scripts

### Phase 3: Cleanup
- [ ] Sync `sale_price` from `final_price` where mismatched
- [ ] Clear `winning_bid` on non-sold vehicles
- [ ] Migrate `price` field usage to `asking_price`

### Phase 4: Enforce
- [ ] Add database constraints
- [ ] Update application code to follow model
- [ ] Monitor for violations

---

## Summary

| Vehicle State | Primary Price Field | Label | Source |
|---------------|---------------------|-------|--------|
| Classified for sale | `asking_price` | "Asking" | Direct entry |
| Active auction | `external_listings.current_bid` | "Current Bid" | Sync from platform |
| Sold auction | `sale_price` | "Sold" | Synced from `final_price` |
| Reserve not met | `high_bid` | "High Bid (RNM)" | Last bid |
| User estimate | `current_value` | "Est. Value" | User entry |
| Owner's purchase | `purchase_price` | "Purchase" | User entry |
| New car | `msrp` | "MSRP" | OEM data |
