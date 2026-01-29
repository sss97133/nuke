# Live Auction Data Flow - Real Examples

## Database Structure

### 1. Vehicle Table (`vehicles`)
```sql
id: c4dc2420-6441-4e23-b7ef-773fa2a92479
make: Porsche
model: 911 turbo
year: 1985
discovery_url: https://bringatrailer.com/listing/1985-porsche-911-turbo-5/
auction_end_date: NULL (not set at vehicle level)
sale_status: 'available'
```

### 2. External Listings Table (`external_listings`) - **THIS IS WHAT THE UI USES**
```sql
vehicle_id: c4dc2420-6441-4e23-b7ef-773fa2a92479
platform: 'bat'
listing_url: 'https://bringatrailer.com/listing/1985-porsche-911-turbo-5/'
listing_status: 'active'  ← CRITICAL: Must be 'active' for live auctions
end_date: '2026-01-18T07:59:59+00:00'  ← CRITICAL: Must be set for timer to show
current_bid: 70000  ← Shows as "$70,000" in UI
bid_count: 500
watcher_count: 292
view_count: 10477
updated_at: '2025-12-27T03:00:37.671+00:00'
```

## Data Flow: Database → UI

### Step 1: VehicleProfile.tsx loads data
```typescript
// Query external_listings
const { data: listings } = await supabase
  .from('external_listings')
  .select('platform, listing_url, listing_status, end_date, current_bid, bid_count, ...')
  .eq('vehicle_id', vehicleId);

// buildAuctionPulseFromExternalListings() processes the data
const auctionPulse = {
  platform: 'bat',
  listing_url: 'https://bringatrailer.com/listing/1985-porsche-911-turbo-5/',
  listing_status: 'active',  // ← From external_listings.listing_status
  end_date: '2026-01-18T07:59:59+00:00',  // ← From external_listings.end_date
  current_bid: 70000,  // ← From external_listings.current_bid (parsed from string)
  bid_count: 500,
  watcher_count: 292,
  view_count: 10477,
  updated_at: '2025-12-27T03:00:37.671+00:00'
};
```

### Step 2: VehicleHeader.tsx receives auctionPulse
```typescript
// Props passed to VehicleHeader
<VehicleHeader
  vehicle={vehicle}
  auctionPulse={auctionPulse}  // ← The processed data from Step 1
  ...
/>
```

### Step 3: VehicleHeader checks if auction is live
```typescript
// isAuctionLive() logic
const isAuctionLive = useMemo(() => {
  if (!auctionPulse?.listing_url) return false;
  const status = String(auctionPulse.listing_status || '').toLowerCase();
  
  // Check 1: Status is 'active' or 'live'
  if (status === 'active' || status === 'live') {
    if (!auctionPulse.end_date) {
      return true; // No end date but status is active - assume live
    }
    const end = new Date(auctionPulse.end_date).getTime();
    return end > Date.now(); // Future end date = live
  }
  
  // Check 2: Future end_date even if status is wrong
  if (auctionPulse?.end_date) {
    const end = new Date(auctionPulse.end_date).getTime();
    if (end > Date.now()) return true; // Future date = live
  }
  
  return false;
}, [auctionPulse]);

// Result for our example: true ✅
```

### Step 4: VehicleHeader displays current bid
```typescript
// priceDisplay logic
const priceDisplay = useMemo(() => {
  if (auctionPulse?.listing_url) {
    const status = String(auctionPulse.listing_status || '').toLowerCase();
    const isLive = status === 'active' || status === 'live';
    
    // Live auction: show current bid
    if (isLive && typeof auctionPulse.current_bid === 'number' && auctionPulse.current_bid > 0) {
      return `Bid: ${formatCurrency(auctionPulse.current_bid)}`;
      // Result: "Bid: $70,000"
    }
  }
  // ...
}, [auctionPulse]);

// Result: "Bid: $70,000" ✅
```

### Step 5: VehicleHeader displays timer
```typescript
// Timer display (lines 1742-1763)
{auctionPulse.end_date ? (
  <span className="badge badge-secondary">
    <span className={isAuctionLive ? 'auction-live-dot' : undefined} />
    <span style={{ fontFamily: 'monospace' }}>
      {formatCountdownClock(auctionPulse.end_date) || formatRemaining(auctionPulse.end_date)}
    </span>
  </span>
) : null}

// formatCountdownClock() calculates:
const end = new Date('2026-01-18T07:59:59+00:00').getTime();
const diff = end - Date.now(); // e.g., 1854000000 ms
const totalSeconds = Math.floor(diff / 1000); // 1854000 seconds
const d = Math.floor(totalSeconds / 86400); // 21 days
const h = Math.floor((totalSeconds % 86400) / 3600); // 12 hours
const m = Math.floor((totalSeconds % 3600) / 60); // 34 minutes
const s = totalSeconds % 60; // 56 seconds

// Result: "21d 12:34:56" ✅
```

## What Gets Displayed in UI

### For the Porsche 911 example:
```
┌─────────────────────────────────────────┐
│ 1985 Porsche 911 Turbo                 │
│                                         │
│ Bid: $70,000                    [LIVE] │ ← From current_bid
│                                         │
│ 🔴 21d 12:34:56                        │ ← From end_date (timer)
│ 500 bids • 292 watching • 10,477 views │ ← From bid_count, watcher_count, view_count
└─────────────────────────────────────────┘
```

## Problems Fixed

### Before Fix:
```sql
-- external_listings record
listing_status: 'ended'  ← WRONG: Should be 'active'
end_date: NULL  ← MISSING: Timer won't show
current_bid: '70000'  ← String, needs parsing
```

### After Fix:
```sql
-- external_listings record (updated by script)
listing_status: 'active'  ← CORRECT ✅
end_date: '2026-01-18T07:59:59+00:00'  ← SET ✅
current_bid: 70000  ← Number (parsed correctly) ✅
```

## Real-Time Updates

The system uses Supabase realtime to update the UI:

```typescript
// VehicleProfile.tsx subscribes to changes
const channel = supabase
  .channel(`auction-pulse:${vehicleId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'external_listings',
    filter: `vehicle_id=eq.${vehicleId}`,
  }, (payload) => {
    // When external_listings.current_bid or end_date changes,
    // this fires and updates auctionPulse
    setAuctionPulse(updatedData);
  })
  .subscribe();
```

When `external_listings.current_bid` or `end_date` is updated:
1. Supabase realtime fires
2. `auctionPulse` state updates
3. `isAuctionLive` recalculates
4. Timer and bid display update automatically

## Key Database Fields for Live Auctions

| Field | Required | Purpose | Example |
|-------|----------|---------|---------|
| `listing_status` | ✅ YES | Must be 'active' for live auctions | `'active'` |
| `end_date` | ✅ YES | Timer countdown source | `'2026-01-18T07:59:59+00:00'` |
| `current_bid` | ✅ YES | Shows as "Bid: $X" | `70000` (number) |
| `bid_count` | Optional | Shows bid count badge | `500` |
| `watcher_count` | Optional | Shows watcher count | `292` |
| `view_count` | Optional | Shows view count | `10477` |
| `updated_at` | ✅ YES | Telemetry freshness indicator | `'2025-12-27T03:00:37.671+00:00'` |

## Fix Script Impact

The `fix-live-auctions-external-listings.ts` script:
1. Finds vehicles with `auction_end_date > NOW()`
2. Creates/updates `external_listings` with:
   - `listing_status = 'active'`
   - `end_date = vehicle.auction_end_date` (if missing)
   - `current_bid` parsed from string to number
3. Result: UI shows timer and current bid ✅

