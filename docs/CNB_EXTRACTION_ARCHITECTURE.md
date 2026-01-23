# Cars & Bids Extraction Architecture

**Created:** 2026-01-23
**Status:** Planning

## Problem Statement

We have two distinct goals that require different approaches:

1. **Backfill Historical Data** - One-time extraction of ~33,000 past auctions
2. **Live Auction Monitoring** - Real-time tracking of active auctions for proxy bidding

These are NOT the same system. Conflating them has caused confusion and wasted effort.

---

## Discovery: 677 Pages

Cars & Bids has paginated past auctions at:
```
https://carsandbids.com/past-auctions/?page=1
https://carsandbids.com/past-auctions/?page=2
...
https://carsandbids.com/past-auctions/?page=677
```

Each page shows ~50 auctions with summary data visible:
- Year/Make/Model (in URL: `/auctions/ID/2023-porsche-911-carrera`)
- Sold price OR "Reserve Not Met" / "Bid to $X"
- End date
- Auction URL

**Total: ~33,000 auctions across 677 pages**

---

## Two-Phase Backfill Strategy

### Phase 1: Build Index (FAST)

**Goal:** Scrape all 677 listing pages to create a complete index

**Data captured per auction:**
| Field | Source |
|-------|--------|
| `auction_id` | From URL path |
| `url` | Full auction URL |
| `year` | Parsed from URL |
| `make` | Parsed from URL |
| `model` | Parsed from URL |
| `sale_result` | "sold" / "reserve_not_met" / "bid_to" |
| `price` | Sold price or high bid |
| `end_date` | Visible on listing card |

**Characteristics:**
- ~700 page loads (not 33,000)
- Can complete in hours, not days
- Creates a queryable index immediately
- No individual auction page visits needed
- Tracks discovery progress by page number

**Storage:** New table `cab_auction_index`
```sql
CREATE TABLE cab_auction_index (
  auction_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  year INTEGER,
  make TEXT,
  model TEXT,
  sale_result TEXT, -- 'sold', 'reserve_not_met', 'bid_to'
  price INTEGER,
  end_date TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_status TEXT DEFAULT 'pending', -- 'pending', 'extracted', 'failed'
  extraction_attempted_at TIMESTAMPTZ,
  vehicle_id UUID REFERENCES vehicles(id)
);
```

### Phase 2: Full Extraction (SLOW)

**Goal:** Extract complete data from individual auction pages

**Data captured per auction:**
| Field | Source |
|-------|--------|
| VIN | Page content |
| Mileage | Quick facts |
| Engine/Trans/Drivetrain | Quick facts |
| Colors (ext/int) | Quick facts |
| Title status | Quick facts |
| Location | Seller info |
| Seller username | Seller info |
| Doug's Take | Content section |
| Highlights | Content section |
| Equipment | Content section |
| Known Flaws | Content section |
| Modifications | Content section |
| Service History | Content section |
| Images (100+) | Gallery / __NEXT_DATA__ |
| Comments | Comments section (JS rendered) |
| Bid history | Bid section (JS rendered) |

**Characteristics:**
- ~33,000 individual page visits
- Can be done in batches over time
- Can prioritize (e.g., sold auctions first, high-value first)
- Index tracks which have been extracted
- Can resume from failures

**Strategy options:**
1. **Priority extraction**: Start with sold auctions, newest first
2. **Make/model extraction**: Extract all Porsches, then all Ferraris, etc.
3. **Price-based**: High value first (>$100k)
4. **Random sampling**: Statistical sample first

---

## Live Auction Monitoring (Separate System)

**Goal:** Track active auctions in real-time for proxy bidding

**Current implementation:**
- `sync-active-auctions` runs every 15 minutes
- Calls `sync-cars-and-bids-listing` for each active listing
- Updates `external_listings` with current_bid, bid_count, end_date
- Frontend subscribes via Supabase realtime

**Data flow:**
```
Active auction discovered → external_listings created
                         ↓
              sync-active-auctions (every 15 min)
                         ↓
              sync-cars-and-bids-listing fetches latest
                         ↓
              external_listings.current_bid updated
                         ↓
              Frontend receives realtime update
                         ↓
              User sees live bid changes
```

**This is already working.** Don't touch it when building backfill.

---

## Relationship Between Systems

```
┌─────────────────────────────────────────────────────────────┐
│                    BACKFILL SYSTEM                          │
│                                                             │
│  Phase 1: Index        Phase 2: Extraction                  │
│  ┌──────────────┐      ┌──────────────────────┐            │
│  │ Scrape 677   │      │ For each pending:    │            │
│  │ listing pages│──────│ - Fetch auction page │            │
│  │              │      │ - Extract full data  │            │
│  │ Creates:     │      │ - Store in vehicles  │            │
│  │ cab_auction_ │      │ - Mark as extracted  │            │
│  │ index        │      │                      │            │
│  └──────────────┘      └──────────────────────┘            │
│                                                             │
│  ONE-TIME OPERATION (historical data)                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    LIVE MONITORING SYSTEM                   │
│                                                             │
│  ┌──────────────┐      ┌──────────────────────┐            │
│  │ New auction  │      │ sync-active-auctions │            │
│  │ discovered   │──────│ (every 15 min)       │            │
│  │              │      │                      │            │
│  │ Creates:     │      │ Updates:             │            │
│  │ external_    │      │ - current_bid        │            │
│  │ listings     │      │ - bid_count          │            │
│  └──────────────┘      │ - end_date           │            │
│                        └──────────────────────┘            │
│                                                             │
│  CONTINUOUS OPERATION (active auctions only)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    DATA RELATIONSHIP                        │
│                                                             │
│  cab_auction_index ──────────┐                              │
│  (discovery/backfill)        │                              │
│                              ▼                              │
│                          vehicles ◄───── external_listings  │
│                          (master)        (live auctions)    │
│                              │                              │
│                              ▼                              │
│                      vehicle_images                         │
│                      auction_comments                       │
│                      auction_events                         │
└─────────────────────────────────────────────────────────────┘
```

---

## What Already Exists

| Component | Status | Notes |
|-----------|--------|-------|
| `cab-discover-historical.ts` | Exists | Uses infinite scroll interception (fragile) |
| `cab-comprehensive-scrape.ts` | Exists | Page-based but combines discovery + extraction |
| `sync-active-auctions` | Working | Live monitoring |
| `sync-cars-and-bids-listing` | Working | Updates active listings |
| `extract-premium-auction` | Working | Full auction extraction |
| `extract-cars-and-bids-comments` | Exists | Comments extraction |
| `cab_auction_index` table | **MISSING** | Needs to be created |

---

## Implementation Plan

### Step 1: Create Index Table
```sql
-- Migration: 20260123_cab_auction_index.sql
CREATE TABLE cab_auction_index (
  auction_id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  year INTEGER,
  make TEXT,
  model TEXT,
  sale_result TEXT,
  price INTEGER,
  end_date TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_status TEXT DEFAULT 'pending',
  extraction_attempted_at TIMESTAMPTZ,
  vehicle_id UUID REFERENCES vehicles(id),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_cab_auction_index_status ON cab_auction_index(extraction_status);
CREATE INDEX idx_cab_auction_index_year ON cab_auction_index(year);
CREATE INDEX idx_cab_auction_index_make ON cab_auction_index(make);
```

### Step 2: Create Index Builder Script
New script: `scripts/cab-build-index.ts`
- Takes start_page and end_page as arguments
- Uses Playwright (Cloudflare bypass required)
- Saves to `cab_auction_index` table
- Tracks progress by page number
- Can be resumed

### Step 3: Create Extraction Worker
New script: `scripts/cab-extract-from-index.ts`
- Reads pending records from `cab_auction_index`
- Extracts full data using existing functions
- Updates `extraction_status` and `vehicle_id`
- Can filter by make/model/price/year

### Step 4: Verify Live Monitoring
- Confirm `sync-active-auctions` is working
- Ensure new active auctions get discovered
- Test realtime updates in frontend

---

## Open Questions

1. **How many auctions per listing page?** Need to verify ~50 assumption
2. **Rate limiting?** What delays are needed between page fetches?
3. **Cloudflare behavior?** Does it block after N requests?
4. **Image extraction priority?** All images vs just primary?
5. **Comment extraction priority?** All comments vs just summaries?

---

## Next Steps

1. [ ] Create `cab_auction_index` table (migration)
2. [ ] Write `cab-build-index.ts` script (Phase 1)
3. [ ] Run Phase 1 on pages 1-677
4. [ ] Verify index has ~33k records
5. [ ] Write `cab-extract-from-index.ts` script (Phase 2)
6. [ ] Begin Phase 2 extraction (batched, prioritized)

---

## Success Criteria

- **Phase 1 Complete:** `cab_auction_index` has ~33,000 records
- **Phase 2 Progress:** Trackable via `extraction_status` column
- **Live Monitoring:** Unchanged and working
- **No Conflicts:** Backfill and live systems don't interfere
