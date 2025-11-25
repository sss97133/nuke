# My Auctions - Comprehensive Wireframe & Backend

## Overview
"My Auctions" is a unified hub for tracking ALL vehicle listings across ALL platforms. Users can monitor their listings on Bring a Trailer, eBay, Cars & Bids, Hemmings, AutoTrader, Facebook Marketplace, and n-zero itself - all in one place. The goal is to become the ONLY place users check for their auction activity.

---

## Core Philosophy

**My Auctions = Universal Listing Hub + Cross-Platform Intelligence**

Unlike platform-specific dashboards, "My Auctions" is:
- **Universal**: All platforms in one view
- **Intelligent**: Syncs data, tracks performance, provides insights
- **Actionable**: Quick actions across platforms
- **Future-Proof**: Eventually becomes the primary interface

---

## Supported Platforms

### Primary Platforms
1. **n-zero** - Native platform auctions
2. **Bring a Trailer (BaT)** - Premium auction platform
3. **eBay Motors** - Large marketplace
4. **Cars & Bids** - Modern auction platform
5. **Hemmings** - Classic car marketplace
6. **AutoTrader** - Traditional classifieds
7. **Facebook Marketplace** - Social marketplace
8. **Craigslist** - Local classifieds
9. **Cars.com** - Traditional classifieds

### Platform Status
- **Fully Integrated**: n-zero, BaT (via scraping/sync)
- **Export Ready**: eBay, Craigslist, Cars.com, Facebook
- **Manual Entry**: Hemmings, AutoTrader (until API access)

---

## Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  MY AUCTIONS                                            │
│  [Filter: All | Active | Sold | Expired] [Platform]    │
│  [Sort] [Add Listing] [Sync All]                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ SUMMARY STATS                                    │  │
│  │ • Active Listings: 12                            │  │
│  │ • Total Views: 45,231                            │  │
│  │ • Total Bids: 342                                │  │
│  │ • Total Value: $1.2M                             │  │
│  │ • Sold This Month: 3 ($450K)                     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ LISTING CARD                                      │  │
│  │ [Platform Badge: BaT] [Status: Active]          │  │
│  │                                                  │  │
│  │ [Vehicle Image]  1973 Ford Bronco               │  │
│  │                  Current Bid: $45,000           │  │
│  │                  Reserve: $50,000               │  │
│  │                  Ends: 2d 14h 32m                │  │
│  │                                                  │  │
│  │ Stats:                                           │  │
│  │ • 127 bids | 2,341 views | 89 watchers         │  │
│  │ • Listed: 5 days ago                             │  │
│  │                                                  │  │
│  │ [View Listing] [Sync Now] [Edit] [Analytics]   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ LISTING CARD                                      │  │
│  │ [Platform Badge: n-zero] [Status: Active]       │  │
│  │                                                  │  │
│  │ [Vehicle Image]  1980 Chevrolet Silverado       │  │
│  │                  Current Bid: $12,500           │  │
│  │                  No Reserve                     │  │
│  │                  Ends: 1d 8h 15m                 │  │
│  │                                                  │  │
│  │ Stats:                                           │  │
│  │ • 23 bids | 456 views | 12 watchers             │  │
│  │ • Listed: 2 days ago                            │  │
│  │                                                  │  │
│  │ [View Listing] [Manage] [Analytics]            │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ LISTING CARD (Sold)                              │  │
│  │ [Platform Badge: eBay] [Status: Sold]           │  │
│  │                                                  │  │
│  │ [Vehicle Image]  1969 Camaro                    │  │
│  │                  Sold: $67,500                  │  │
│  │                  Sold: 3 days ago               │  │
│  │                                                  │  │
│  │ Stats:                                           │  │
│  │ • Final bid: $67,500                            │  │
│  │ • 45 bids | 1,234 views                         │  │
│  │ • Commission: $3,375 (5%)                      │  │
│  │                                                  │  │
│  │ [View Listing] [Analytics] [Export Data]        │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Listing Card Components

### 1. **Platform Badge**
- Platform logo/icon
- Platform name
- Color-coded by platform
- Clickable → platform listing page

### 2. **Status Indicator**
- **Active** - Green badge, shows time remaining
- **Ending Soon** - Yellow badge (< 24 hours)
- **Sold** - Blue badge, shows sale price
- **Expired** - Gray badge, no sale
- **Cancelled** - Red badge
- **Pending** - Yellow badge, not yet live

### 3. **Vehicle Info**
- Primary image
- Year/Make/Model
- VIN (if available)
- Mileage (if available)

### 4. **Auction Details**
- Current bid / Buy now price
- Reserve price (or "No Reserve")
- Time remaining (for active) or end date
- Starting bid (if different)

### 5. **Performance Stats**
- Bid count
- View count
- Watcher count
- Days listed
- Last updated

### 6. **Quick Actions**
- **[View Listing]** - Open on platform
- **[Sync Now]** - Manually refresh data
- **[Edit]** - Edit listing (if n-zero)
- **[Analytics]** - Detailed performance
- **[Export Data]** - Download listing data

---

## Views & Filters

### Filter Options
- **All** - All listings
- **Active** - Currently live listings
- **Ending Soon** - Ends within 24 hours
- **Sold** - Successfully sold
- **Expired** - Ended without sale
- **Cancelled** - Cancelled listings
- **By Platform** - Filter by specific platform
- **By Vehicle** - Filter by vehicle

### Sort Options
- **Ending Soon** - Time remaining (ascending)
- **Newest** - Most recently listed
- **Highest Bid** - Current bid (descending)
- **Most Views** - View count (descending)
- **Most Bids** - Bid count (descending)
- **Platform** - Group by platform

### View Modes
- **Cards** (default) - Visual cards with images
- **List** - Compact table view
- **Timeline** - Chronological view
- **Calendar** - Calendar view of end dates

---

## Detailed Listing View

When clicking a listing card, show expanded view:

```
┌─────────────────────────────────────────────────────────┐
│  1973 FORD BRONCO - BRING A TRAILER                     │
│  [Back] [Sync Now] [Edit] [Analytics]                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  STATUS: Active | Ends in 2d 14h 32m                    │
│                                                         │
│  TABS: [Overview] [Bids] [Analytics] [History]         │
│                                                         │
│  OVERVIEW TAB:                                          │
│  • Vehicle details                                      │
│  • Listing details (title, description)                │
│  • Current bid: $45,000                                │
│  │ Reserve: $50,000                                    │
│  │ Starting bid: $25,000                               │
│  • Time remaining: 2d 14h 32m                           │
│  • Platform link: [View on BaT]                        │
│                                                         │
│  BIDS TAB:                                              │
│  • Bid history (if available)                          │
│  • Bidder info (if public)                             │
│  • Bid timeline chart                                  │
│                                                         │
│  ANALYTICS TAB:                                         │
│  • Performance metrics                                 │
│  • View count over time                                │
│  • Bid activity timeline                               │
│  • Comparison to similar listings                      │
│                                                         │
│  HISTORY TAB:                                           │
│  • Listing creation                                    │
│  • Status changes                                      │
│  • Sync events                                          │
│  • Notes/comments                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Platform Integration Details

### Bring a Trailer (BaT)
**Integration Method**: Web scraping + Edge Function sync
- **Sync Frequency**: Every 15 minutes (active listings)
- **Data Captured**: Bid count, watcher count, current bid, view count
- **Status Detection**: Active, Ended, Sold
- **Edge Function**: `supabase/functions/sync-bat-listing`

### eBay Motors
**Integration Method**: Manual entry + URL tracking
- **Sync Frequency**: Manual or scheduled (if API access)
- **Data Captured**: Bid count, current bid, view count, watcher count
- **Status Detection**: Active, Ended, Sold
- **Future**: eBay API integration

### Cars & Bids
**Integration Method**: Manual entry + URL tracking
- **Sync Frequency**: Manual
- **Data Captured**: Bid count, current bid
- **Status Detection**: Active, Ended, Sold

### n-zero (Native)
**Integration Method**: Direct database access
- **Sync Frequency**: Real-time (via Supabase realtime)
- **Data Captured**: Full auction data
- **Status Detection**: All statuses

### Other Platforms
**Integration Method**: Manual entry + URL tracking
- **Sync Frequency**: Manual
- **Data Captured**: Basic listing info
- **Status Detection**: Active, Sold, Expired

---

## Backend Schema

### Existing Tables (Already Implemented)

1. **`listing_exports`** - Export tracking
   - `id`, `vehicle_id`, `user_id`
   - `platform` (nzero, bat, ebay, etc.)
   - `status` (prepared, submitted, active, sold, expired)
   - `external_listing_url`, `external_listing_id`
   - `asking_price_cents`, `reserve_price_cents`
   - `sold_price_cents`, `sold_at`

2. **`external_listings`** - External platform listings
   - `id`, `vehicle_id`, `organization_id`
   - `platform` (bat, cars_and_bids, ebay_motors, etc.)
   - `listing_url`, `listing_id`
   - `listing_status` (pending, active, ended, sold, cancelled)
   - `current_bid`, `reserve_price`, `bid_count`
   - `view_count`, `watcher_count`
   - `final_price`, `sold_at`
   - `sync_enabled`, `last_synced_at`

3. **`vehicle_listings`** - n-zero native listings
   - `id`, `vehicle_id`, `seller_id`
   - `sale_type` (auction, live_auction)
   - `current_high_bid_cents`, `reserve_price_cents`
   - `bid_count`, `auction_end_time`
   - `status` (draft, active, ended, sold)

### New Tables Needed

#### 1. **`user_auction_preferences`**
```sql
CREATE TABLE IF NOT EXISTS user_auction_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Sync preferences
  auto_sync_enabled BOOLEAN DEFAULT true,
  sync_frequency_minutes INTEGER DEFAULT 15,
  platforms_to_sync TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Notification preferences
  notify_on_bid BOOLEAN DEFAULT true,
  notify_on_ending_soon BOOLEAN DEFAULT true,
  notify_on_sold BOOLEAN DEFAULT true,
  notify_on_expired BOOLEAN DEFAULT true,
  
  -- Display preferences
  default_view_mode TEXT DEFAULT 'cards',
  default_sort TEXT DEFAULT 'ending_soon',
  show_platform_badges BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);
```

#### 2. **`listing_sync_log`**
```sql
CREATE TABLE IF NOT EXISTS listing_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL,  -- Can be listing_exports.id or external_listings.id
  listing_type TEXT NOT NULL CHECK (listing_type IN ('export', 'external', 'native')),
  platform TEXT NOT NULL,
  
  -- Sync details
  sync_status TEXT NOT NULL CHECK (sync_status IN ('success', 'failed', 'partial')),
  sync_method TEXT NOT NULL CHECK (sync_method IN ('api', 'scrape', 'manual')),
  data_captured JSONB DEFAULT '{}',
  error_message TEXT,
  
  -- Timestamps
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  next_sync_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_listing ON listing_sync_log(listing_id, listing_type);
CREATE INDEX IF NOT EXISTS idx_sync_log_platform ON listing_sync_log(platform);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON listing_sync_log(synced_at DESC);
```

#### 3. **`unified_listings_view`** (Materialized View)
```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS unified_listings_view AS
-- Native n-zero listings
SELECT 
  'native' as listing_source,
  vl.id as listing_id,
  vl.vehicle_id,
  vl.seller_id as user_id,
  'nzero' as platform,
  vl.status as listing_status,
  vl.current_high_bid_cents / 100.0 as current_bid,
  vl.reserve_price_cents / 100.0 as reserve_price,
  vl.bid_count,
  NULL::INTEGER as view_count,
  NULL::INTEGER as watcher_count,
  vl.auction_end_time as end_date,
  NULL::TIMESTAMPTZ as sold_at,
  NULL::NUMERIC as final_price,
  NULL::TEXT as external_url,
  vl.created_at as listed_at,
  vl.updated_at as last_updated
FROM vehicle_listings vl
WHERE vl.status IN ('active', 'ended', 'sold')

UNION ALL

-- External listings (from external_listings)
SELECT 
  'external' as listing_source,
  el.id as listing_id,
  el.vehicle_id,
  (SELECT user_id FROM vehicles WHERE id = el.vehicle_id) as user_id,
  el.platform,
  el.listing_status as listing_status,
  el.current_bid,
  el.reserve_price,
  el.bid_count,
  el.view_count,
  el.watcher_count,
  el.end_date,
  el.sold_at,
  el.final_price,
  el.listing_url as external_url,
  el.created_at as listed_at,
  el.updated_at as last_updated
FROM external_listings el
WHERE el.listing_status IN ('active', 'ended', 'sold')

UNION ALL

-- Export listings (from listing_exports)
SELECT 
  'export' as listing_source,
  le.id as listing_id,
  le.vehicle_id,
  le.user_id,
  le.platform,
  le.status as listing_status,
  NULL::NUMERIC as current_bid,
  le.reserve_price_cents / 100.0 as reserve_price,
  NULL::INTEGER as bid_count,
  NULL::INTEGER as view_count,
  NULL::INTEGER as watcher_count,
  le.ended_at as end_date,
  le.sold_at,
  le.sold_price_cents / 100.0 as final_price,
  le.external_listing_url as external_url,
  le.created_at as listed_at,
  le.updated_at as last_updated
FROM listing_exports le
WHERE le.status IN ('active', 'sold', 'expired');
```

---

## API/Service Layer

### `MyAuctionsService.ts`

```typescript
export interface UnifiedListing {
  listing_source: 'native' | 'external' | 'export';
  listing_id: string;
  vehicle_id: string;
  user_id: string;
  platform: string;
  listing_status: string;
  current_bid?: number;
  reserve_price?: number;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  end_date?: string;
  sold_at?: string;
  final_price?: number;
  external_url?: string;
  listed_at: string;
  last_updated: string;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    primary_image_url?: string;
  };
}

export interface AuctionStats {
  total_listings: number;
  active_listings: number;
  sold_listings: number;
  total_value: number;
  total_views: number;
  total_bids: number;
  by_platform: Record<string, {
    count: number;
    sold: number;
    value: number;
  }>;
}

export class MyAuctionsService {
  // Get all listings for current user
  static async getMyListings(filters?: {
    status?: string;
    platform?: string;
    vehicle_id?: string;
    sortBy?: string;
  }): Promise<UnifiedListing[]>
  
  // Get listing details
  static async getListingDetails(
    listingId: string,
    listingSource: 'native' | 'external' | 'export'
  ): Promise<UnifiedListing>
  
  // Sync a specific listing
  static async syncListing(
    listingId: string,
    listingSource: 'native' | 'external' | 'export',
    platform: string
  ): Promise<{ success: boolean; data?: any; error?: string }>
  
  // Sync all listings for user
  static async syncAllListings(): Promise<{ success: boolean; synced: number; failed: number }>
  
  // Get auction stats
  static async getAuctionStats(): Promise<AuctionStats>
  
  // Add manual listing
  static async addManualListing(params: {
    vehicle_id: string;
    platform: string;
    listing_url: string;
    listing_id?: string;
  }): Promise<{ success: boolean; listing_id?: string }>
  
  // Update listing status
  static async updateListingStatus(
    listingId: string,
    listingSource: 'native' | 'external' | 'export',
    status: string,
    updates?: any
  ): Promise<{ success: boolean }>
}
```

---

## Component Structure

### `MyAuctions.tsx` (Main Page)
- Summary stats header
- Filter/sort controls
- Listing cards grid
- Empty state
- Add listing button
- Sync all button

### `ListingCard.tsx` (Reusable Card)
- Platform badge
- Status indicator
- Vehicle info
- Auction details
- Performance stats
- Quick actions

### `ListingDetailView.tsx` (Expanded View)
- Tab navigation
- Overview tab
- Bids tab (if available)
- Analytics tab
- History tab

### `AddListingModal.tsx` (Add Manual Listing)
- Platform selector
- URL input
- Vehicle selector
- Auto-detect listing ID
- Manual entry fields

### `SyncStatusIndicator.tsx` (Sync Status)
- Last sync time
- Sync status (success/failed)
- Auto-sync toggle
- Manual sync button

---

## Key Features

### 1. **Universal Tracking**
- All platforms in one view
- Unified data model
- Cross-platform analytics

### 2. **Intelligent Syncing**
- Auto-sync for supported platforms
- Manual sync option
- Sync status tracking
- Error handling

### 3. **Performance Analytics**
- View counts over time
- Bid activity timeline
- Platform comparison
- Success rate tracking

### 4. **Smart Notifications**
- Bid alerts
- Ending soon alerts
- Sale confirmations
- Sync failures

### 5. **Quick Actions**
- View on platform
- Sync now
- Edit listing (n-zero)
- Export data
- Analytics

### 6. **Future: Platform APIs**
- Direct API integration
- Real-time updates
- Automated syncing
- Bid management

---

## Implementation Phases

### Phase 1: Basic Unified View
- ✅ Load listings from all sources
- ✅ Display unified listing cards
- ✅ Basic filtering/sorting
- ✅ Platform badges

### Phase 2: Enhanced Syncing
- ⏳ Manual sync functionality
- ⏳ Sync status tracking
- ⏳ Error handling
- ⏳ Sync log

### Phase 3: Analytics
- ⏳ Performance metrics
- ⏳ Charts/graphs
- ⏳ Platform comparison
- ⏳ Success rate tracking

### Phase 4: Notifications
- ⏳ Bid alerts
- ⏳ Ending soon alerts
- ⏳ Sale confirmations
- ⏳ Email/push notifications

### Phase 5: Advanced Features
- ⏳ Auto-sync scheduling
- ⏳ Platform API integration
- ⏳ Bid management
- ⏳ Cross-platform insights

---

## Integration Points

- **Vehicle Profile**: Link to vehicle's listings
- **Auction Marketplace**: Native n-zero listings
- **Listing Preparation**: Export to platforms
- **Analytics Dashboard**: Performance metrics
- **Notifications**: Alert system

---

## Future Vision

**Goal**: Become the ONLY place users check for auction activity

1. **Real-time Updates**: Live bid tracking across platforms
2. **Unified Bidding**: Bid on any platform from n-zero
3. **Smart Insights**: AI-powered listing optimization
4. **Cross-Platform Analytics**: Compare performance across platforms
5. **Automated Management**: Auto-sync, auto-update, auto-optimize


