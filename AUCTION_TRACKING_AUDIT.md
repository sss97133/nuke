# Auction Tracking & Bid Storage Audit

## Summary

This document answers: **Are bids being properly received into the DB and how are auctions being tracked?**

---

## ✅ Bid Storage - How It Works

### 1. **External Auctions (BaT, Classic.com, Cars & Bids, etc.)**

**Table: `external_listings`**
- Stores current bid status for external platform auctions
- Fields:
  - `current_bid` (NUMERIC) - Current high bid
  - `bid_count` (INTEGER) - Number of bids
  - `listing_status` - 'pending', 'active', 'ended', 'sold', 'cancelled'
  - `final_price` - Final sale price (when sold)
  - `last_synced_at` - When last synced

**How bids are updated:**
- **Sync Functions**: `sync-bat-listing`, `sync-cars-and-bids-listing`
  - Scrape the auction page HTML
  - Extract `current_bid`, `bid_count`, `watcher_count`, `view_count`
  - Update `external_listings` table
  - Sets `last_synced_at` timestamp

- **Initial Import**: `import-bat-listing`, `import-classic-auction`, etc.
  - Creates `external_listings` record on first scrape
  - Sets initial `current_bid` and `bid_count`

### 2. **Individual BaT Bids (Detailed Tracking)**

**Table: `bat_bids`**
- Tracks individual bid transactions from BaT
- Extracted from BaT comments and auction events
- Fields:
  - `bid_amount` - Individual bid amount
  - `bid_timestamp` - When bid was placed
  - `bat_username` - Who placed the bid
  - `is_winning_bid` - Current winning bid?
  - `is_final_bid` - Final sale bid?

**Used for:**
- User activity tracking
- Profile stats (total bids, highest bid, etc.)
- Bidder identity linking

### 3. **Internal N-Zero Auctions**

**Table: `auction_bids`**
- For auctions hosted on N-Zero platform
- Supports proxy bidding
- Fields:
  - `proxy_max_bid_cents` - Secret maximum bid
  - `displayed_bid_cents` - What others see
  - `is_winning` / `is_outbid` - Status tracking

---

## 📊 Auction Tracking - How It Works

### 1. **External Listings Table (`external_listings`)**

**Purpose:** Tracks all external auction listings (BaT, Classic.com, Cars & Bids, etc.)

**Key Fields:**
```sql
- vehicle_id (links to vehicle)
- platform ('bat', 'classic_com', 'cars_and_bids', etc.)
- listing_url, listing_id
- listing_status ('active', 'sold', 'ended', etc.)
- start_date, end_date
- current_bid, bid_count
- final_price, sold_at
- last_synced_at
- metadata (JSONB with additional data)
```

**How auctions are tracked:**
1. **Initial Discovery**: When vehicle is scraped/imported, `external_listings` record is created
2. **Status Updates**: Sync functions update `listing_status`, `current_bid`, `bid_count`
3. **Sale Tracking**: When auction ends, `listing_status` → 'sold', `final_price` set
4. **Vehicle Sync**: `vehicles.sale_price` and `vehicles.sale_status` updated from external listings

### 2. **Auction Events Table (`auction_events`)**

**Purpose:** Detailed auction outcome tracking

**Fields:**
- `outcome` - 'active', 'sold', 'ended', 'reserve_not_met', etc.
- `high_bid` - Final high bid
- `reserve_price`, `reserve_met`
- `auction_start_at`, `auction_end_at`
- `metadata` - Additional auction data

**Used for:**
- Auction intelligence/analytics
- Timeline events
- Outcome disclosure

### 3. **BaT Listings Table (`bat_listings`)**

**Purpose:** BaT-specific auction data

**Fields:**
- BaT lot number, URL
- Sale price, final bid
- Auction dates
- Links to `bat_bids`, `bat_comments`

---

## 🔄 Sync Mechanisms

### **Manual Sync Functions:**

1. **`sync-bat-listing`**
   - Input: `external_listing_id` or `listing_url`
   - Scrapes BaT auction page
   - Updates `external_listings.current_bid`, `bid_count`, `watcher_count`
   - Extracts end_date from countdown timer

2. **`sync-cars-and-bids-listing`**
   - Similar to BaT sync
   - Updates Cars & Bids listings

### **Automated Sync (Current Status):**

**✅ Cron Jobs That Exist:**
1. **`monitor-bat-seller`** (every 6 hours)
   - Monitors BaT seller profiles for NEW listings
   - Does NOT update bid counts on existing listings
   - Calls: `monitor-bat-seller` edge function

2. **`monitor-sbxcars-listings`** (every 30 minutes)
   - Updates SBX Cars auction listings
   - Calls: `monitor-sbxcars-listings` edge function
   - ✅ This DOES update bid counts!

3. **`overnight-extraction-pulse`** (every 5 min, 8 PM-8 AM)
   - Processes extraction queues (import, BaT deep extraction)
   - Does NOT sync bid counts on active auctions

**❌ MISSING: Cron for BaT Bid Sync**
- **`sync-bat-listing`** function exists but NO cron job calls it
- Active BaT auctions won't auto-update `current_bid` and `bid_count`
- Must be triggered manually or via API call

**❌ MISSING: Cron for Cars & Bids Bid Sync**
- **`sync-cars-and-bids-listing`** function exists but NO cron job calls it
- Active Cars & Bids auctions won't auto-update bids

**Current Status:**
- Sync functions exist ✅
- Manual sync possible ✅
- **AUTOMATED sync for BaT/Cars&Bids: MISSING** ❌
- `last_synced_at` field tracks when last synced
- `sync_enabled` boolean can enable/disable per listing

---

## 🐛 Potential Issues

### **1. Missing Automated Sync**

**Problem:** If there's no cron job, external listings won't auto-update
- Bids won't update automatically
- Status won't change from 'active' → 'sold'
- `current_bid` becomes stale

**Solution Needed:**
- Set up cron job to call sync functions for active auctions
- Or implement real-time polling/subscription

### **2. Bid Data Not Always Populated**

**From migration `20251222_fix_external_listings_missing_prices.sql`:**
- Some listings marked 'sold' but missing `final_price`
- Fix function exists to backfill from `vehicles.sale_price` or `bat_listings`

**Check:**
```sql
SELECT COUNT(*) FROM external_listings 
WHERE listing_status = 'sold' 
AND final_price IS NULL;
```

### **3. Stale Listings**

**From migration `20251222_fix_stale_external_listings.sql`:**
- Listings can become stale if not synced
- May show 'active' but auction actually ended

---

## ✅ What's Working

1. **Database Schema** ✅
   - `external_listings` table properly structured
   - Supports multiple platforms
   - Tracks all necessary fields

2. **Sync Functions** ✅
   - `sync-bat-listing` exists and works
   - `sync-cars-and-bids-listing` exists and works
   - Extracts current_bid, bid_count correctly

3. **Initial Import** ✅
   - Import functions create `external_listings` records
   - Set initial bid data

4. **Vehicle Integration** ✅
   - External listings linked to vehicles
   - Bid data accessible via vehicle queries

---

## ❓ Questions to Answer

1. **Is there a cron job that auto-syncs active auctions?**
   - Check: `SELECT * FROM cron.job WHERE jobname LIKE '%sync%' OR jobname LIKE '%auction%';`

2. **How often are active auctions synced?**
   - Check `last_synced_at` timestamps on active listings
   - Are they recent? Or days/weeks old?

3. **Are bid updates happening in real-time?**
   - Or only on manual sync/refresh?

4. **For BaT specifically:**
   - Are `bat_bids` records being created?
   - Is the comment extraction working to capture individual bids?

---

## 🔍 Recommended Checks

### **1. Check Active Auctions Sync Status:**
```sql
SELECT 
  platform,
  listing_status,
  COUNT(*) as count,
  MIN(last_synced_at) as oldest_sync,
  MAX(last_synced_at) as newest_sync,
  AVG(EXTRACT(EPOCH FROM (NOW() - last_synced_at))/3600) as avg_hours_since_sync,
  COUNT(CASE WHEN last_synced_at IS NULL THEN 1 END) as never_synced
FROM external_listings
WHERE listing_status = 'active'
GROUP BY platform, listing_status
ORDER BY platform;
```

**Expected Result:**
- BaT: Likely `never_synced` = high count (no auto-sync cron)
- SBX Cars: Should have recent syncs (has cron every 30 min)
- Classic.com: Check sync status

### **2. Check for Stale Active Listings:**
```sql
SELECT 
  platform,
  COUNT(*) as stale_count
FROM external_listings
WHERE listing_status = 'active'
  AND end_date < NOW()
  AND end_date IS NOT NULL;
```

### **3. Check Bid Data Completeness:**
```sql
SELECT 
  platform,
  listing_status,
  COUNT(*) as total,
  COUNT(current_bid) as with_current_bid,
  COUNT(bid_count) as with_bid_count,
  COUNT(CASE WHEN current_bid IS NULL AND listing_status = 'active' THEN 1 END) as active_no_bid
FROM external_listings
GROUP BY platform, listing_status;
```

---

## 📝 Next Steps

### **Immediate Actions Needed:**

1. **Create Cron Job for BaT Bid Sync** ❌
   ```sql
   -- Create cron to sync active BaT auctions every 15-30 minutes
   SELECT cron.schedule(
     'sync-active-bat-auctions',
     '*/30 * * * *', -- Every 30 minutes
     $$
     -- Query active BaT listings and sync each one
     -- (Would need a function that batches sync requests)
     $$
   );
   ```

2. **Create Cron Job for Cars & Bids Bid Sync** ❌
   ```sql
   SELECT cron.schedule(
     'sync-active-cars-bids-auctions',
     '*/30 * * * *', -- Every 30 minutes
     $$
     -- Similar to BaT sync
     $$
   );
   ```

3. **Check Current Sync Status**
   - Run the diagnostic queries below
   - See how stale the bid data is

4. **Review sync frequency** - are active auctions synced regularly?
5. **Verify bid extraction** - are current_bid and bid_count being populated correctly?
6. **Check for stale data** - are there active listings that should be 'ended' or 'sold'?

