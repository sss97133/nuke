# PCarMarket Auction Monitoring System

## Overview

Complete system for monitoring PCarMarket auctions to detect:
- **New bids** - Current bid amount and bid count
- **New comments** - All comments from auction page
- **Final auction outcomes** - Sold vs Reserve Not Met (RNM)

## Components

### 1. Monitor Auction Function
**Edge Function:** `supabase/functions/monitor-pcarmarket-auction/index.ts`

Checks a single auction for updates:
- Current bid amount
- Bid count
- View count
- Comment count
- Auction status (active/sold/unsold/ended)
- Auction outcome (sold/reserve_not_met/no_sale)
- Final price (if sold)
- Auction end date

**Usage:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/monitor-pcarmarket-auction \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "vehicle-id"}'
```

**Response:**
```json
{
  "success": true,
  "listing_url": "https://www.pcarmarket.com/auction/...",
  "vehicle_id": "vehicle-id",
  "update": {
    "current_bid": 2500000,
    "bid_count": 15,
    "view_count": 1234,
    "comment_count": 45,
    "status": "active",
    "auction_outcome": null,
    "auction_end_date": "2025-01-22T18:00:00Z",
    "last_checked_at": "2025-01-20T12:00:00Z"
  },
  "changes_detected": {
    "bid_changed": true,
    "status_changed": false,
    "outcome_determined": false
  }
}
```

### 2. Extract Comments Function
**Edge Function:** `supabase/functions/extract-pcarmarket-comments/index.ts`

Extracts all comments from auction page:
- Author username
- Comment text
- Posted timestamp
- Comment likes
- Bid amounts (if comment contains bid)
- Seller identification
- Leading bid detection

**Usage:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/extract-pcarmarket-comments \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "vehicle-id"}'
```

**Response:**
```json
{
  "success": true,
  "listing_url": "https://www.pcarmarket.com/auction/...",
  "vehicle_id": "vehicle-id",
  "comment_count": 45,
  "comments": [...],
  "bid_comments": [...],
  "seller_comments": [...]
}
```

### 3. Monitoring Script
**Script:** `scripts/monitor-pcarmarket-auctions.js`

Monitors all PCarMarket auctions:
- Checks all active auctions
- Updates vehicle records
- Extracts comments
- Detects final outcomes

**Usage:**
```bash
# Monitor all active auctions
node scripts/monitor-pcarmarket-auctions.js

# Skip comment extraction
node scripts/monitor-pcarmarket-auctions.js --no-comments

# Include ended auctions
node scripts/monitor-pcarmarket-auctions.js --include-ended

# Limit to 10 vehicles
node scripts/monitor-pcarmarket-auctions.js --limit=10

# Help
node scripts/monitor-pcarmarket-auctions.js --help
```

## Auction Outcome Detection

### Sold
- Page contains "Sold" or "Final bid"
- Final price extracted
- `auction_outcome` = `'sold'`
- `sale_price` set to final bid amount

### Reserve Not Met (RNM)
- Page contains "Unsold", "Reserve Not Met", or "RNM"
- No final price
- `auction_outcome` = `'reserve_not_met'`
- `sale_price` remains null

### No Sale
- Page contains "Ended" without "Sold"
- `auction_outcome` = `'no_sale'`

## Data Storage

### Vehicle Updates
- `current_value` - Current bid amount (in cents)
- `high_bid` - Highest bid (in cents)
- `bid_count` - Number of bids
- `auction_outcome` - 'sold' | 'reserve_not_met' | 'no_sale'
- `sale_price` - Final sale price (if sold)
- `auction_end_date` - When auction ends/ended
- `origin_metadata.last_checked_at` - Last monitoring check
- `origin_metadata.current_bid` - Latest bid
- `origin_metadata.auction_status` - Current status
- `origin_metadata.auction_outcome` - Final outcome

### Comments Storage
- Stored in `auction_comments` table
- Linked to `auction_events` via `auction_event_id`
- Linked to vehicle via `vehicle_id`
- Includes:
  - Author username
  - Comment text
  - Posted timestamp
  - Likes count
  - Bid amount (if comment contains bid)
  - Seller flag
  - Leading bid flag

## Scheduled Monitoring

### Recommended Schedule
- **Active auctions**: Check every 1-2 hours
- **Ending soon (< 24 hours)**: Check every 15-30 minutes
- **Ended auctions**: Check once daily for final outcomes

### GitHub Actions Example
```yaml
name: Monitor PCarMarket Auctions

on:
  schedule:
    - cron: '0 */2 * * *'  # Every 2 hours
  workflow_dispatch:

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: |
          npm install
          node scripts/monitor-pcarmarket-auctions.js
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Query Examples

### Get All Active Auctions Needing Update
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.discovery_url,
  v.origin_metadata->>'last_checked_at' as last_checked,
  NOW() - (v.origin_metadata->>'last_checked_at')::timestamptz as time_since_check
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND (v.auction_end_date IS NULL OR v.auction_end_date > NOW())
  AND (
    v.origin_metadata->>'last_checked_at' IS NULL OR
    NOW() - (v.origin_metadata->>'last_checked_at')::timestamptz > INTERVAL '2 hours'
  )
ORDER BY v.origin_metadata->>'last_checked_at' NULLS FIRST;
```

### Get Auctions with New Bids
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  (v.origin_metadata->>'current_bid')::int / 100.0 as current_bid,
  v.bid_count,
  v.origin_metadata->>'last_checked_at' as last_checked
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.origin_metadata->>'current_bid' IS NOT NULL
  AND v.origin_metadata->>'last_checked_at' IS NOT NULL
ORDER BY v.origin_metadata->>'last_checked_at' DESC;
```

### Get Final Auction Outcomes
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.auction_outcome,
  v.sale_price / 100.0 as sale_price,
  v.high_bid / 100.0 as high_bid,
  v.bid_count
FROM vehicles v
WHERE v.profile_origin = 'pcarmarket_import'
  AND v.auction_outcome IS NOT NULL
ORDER BY v.updated_at DESC;
```

### Get Comment Statistics
```sql
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  COUNT(ac.id) as comment_count,
  COUNT(CASE WHEN ac.bid_amount IS NOT NULL THEN 1 END) as bid_comments,
  COUNT(CASE WHEN ac.is_seller THEN 1 END) as seller_comments
FROM vehicles v
LEFT JOIN auction_comments ac ON ac.vehicle_id = v.id
WHERE v.profile_origin = 'pcarmarket_import'
GROUP BY v.id, v.year, v.make, v.model
ORDER BY comment_count DESC;
```

## Integration Points

1. **During Import** - Initial data extraction
2. **Scheduled Monitoring** - Regular updates
3. **Before Auction End** - Final outcome detection
4. **After Auction End** - Post-sale data collection

## Next Steps

1. ✅ Monitor function created
2. ✅ Comment extraction created
3. ✅ Monitoring script created
4. ⏭️ Set up scheduled jobs
5. ⏭️ Add notifications for significant changes
6. ⏭️ Create dashboard for monitoring status

---

The system is ready to monitor PCarMarket auctions! ✅

