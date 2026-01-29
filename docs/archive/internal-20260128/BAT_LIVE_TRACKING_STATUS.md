# BaT Live Auction Tracking - Status & Architecture

**Date:** December 29, 2025  
**Status:** ✅ Operational - Near-Zero Cost

---

## Summary

The BaT live auction tracking system is now operational with a **cost-effective hybrid fetching strategy** that uses Firecrawl as a fallback only when rate-limited.

### Key Metrics
- **Active BaT Listings:** 1 (others were stale, now fixed)
- **Firecrawl Calls (24h):** 0
- **Cost (24h):** $0.00
- **Direct Fetch Success Rate:** ~100%

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 BaT Live Auction Sync                       │
├─────────────────────────────────────────────────────────────┤
│  sync-active-auctions (cron: */15 * * * *)                  │
│    ↓                                                        │
│  For each active listing:                                   │
│    ↓                                                        │
│  sync-bat-listing (per listing)                             │
│    ↓                                                        │
│  batFetcher.ts:                                             │
│    1. Try direct fetch (FREE)                               │
│    2. If 403/429 → Use Firecrawl (~$0.01)                   │
│    3. Parse HTML for bids, watchers, views, status          │
│    ↓                                                        │
│  Update external_listings with live data                    │
│    ↓                                                        │
│  Trigger → sync_active_auction_prices_to_vehicles()         │
│    ↓                                                        │
│  vehicles table updated with current bid                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/sync-bat-listing/index.ts` | Syncs single BaT listing - extracts bid, watchers, views, status |
| `supabase/functions/sync-active-auctions/index.ts` | Batch processor - calls sync-bat-listing for each active listing |
| `supabase/functions/_shared/batFetcher.ts` | Hybrid fetcher - direct first, Firecrawl fallback |
| `supabase/functions/bat-simple-extract/index.ts` | Full extraction for new listings |
| `supabase/functions/bat-reextract/index.ts` | Re-extraction for existing profiles |
| `supabase/functions/bat-batch-extract/index.ts` | Batch re-extraction runner |

---

## Fixes Applied This Session

### 1. Fixed Stale "Active" Listings
- **Problem:** 110 listings marked as "active" were actually ended auctions that were never synced
- **Fix:** Bulk updated to "ended" status via migration
- **Migration:** `fix_stale_active_listings`

### 2. Fixed `create_auction_timeline_event` Function
- **Problem:** Function had schema path issues causing "relation external_listings does not exist" error
- **Fix:** Added `SET search_path = public` and explicit `public.` prefixes
- **Migration:** `fix_create_auction_timeline_event_schema`

### 3. Updated `sync-bat-listing` Function
- **Problem:** Used old Deno serve syntax and had overly complex auth
- **Fix:** Updated to `Deno.serve()` and simplified (verify_jwt: false)
- **Deployed:** Version 49

---

## Cost Strategy

### Hybrid Fetching (`batFetcher.ts`)

```typescript
// Decision tree:
1. Always try direct fetch first (FREE)
2. If rate limited (403/429) → Use Firecrawl (~$0.01)
3. If other HTTP error (404, 500) → Don't waste Firecrawl credits
4. Smart decision: Only pay for Firecrawl in final 10 minutes of auction
```

### Cost Breakdown

| Component | Cost | Notes |
|-----------|------|-------|
| Direct fetch | FREE | ~300KB HTML per request |
| Firecrawl fallback | ~$0.01 | Only on 403/429 rate limits |
| 15-min polling cron | ~$0/day | Direct fetch working |
| Supabase Edge Functions | Pro tier | Already included |

---

## Database Tables

### `external_listings`
Stores auction platform listings with live data:
- `current_bid` - Latest bid amount
- `bid_count` - Total bids
- `watcher_count` - Number of watchers
- `view_count` - Page views
- `listing_status` - active/ended/sold
- `end_date` - Auction end time
- `last_synced_at` - When we last polled
- `sync_enabled` - Whether to include in polling

### Triggers on `external_listings`
- `track_auction_transitions` → Creates timeline events for status changes
- `trigger_sync_active_auction_prices` → Syncs prices to vehicles table
- `trigger_auto_mark_vehicle_sold` → Marks vehicle as sold when auction sells

---

## Cron Jobs

```sql
-- Every 15 minutes - sync active auctions
jobname: sync-active-auctions
schedule: */15 * * * *

-- Every 4 hours - premium auction extraction
jobname: premium-auction-extractor  
schedule: 0 */4 * * *
```

---

## Pending Enhancements

### 1. Adaptive Polling for Hot Auctions
- **Current:** Fixed 15-minute interval
- **Enhancement:** Faster polling as auction nears end
  - Last 2 hours: Every 5 minutes
  - Last 10 minutes: Every 1 minute
  - Extension detected: Immediate re-poll

### 2. 2-Minute Rule Detection
- BaT extends auctions by 2 minutes when bids come in at the end
- Need to detect `end_date` changes and adjust polling

### 3. Graph Extraction (Discovery Queue)
- Extract seller profiles → Find their other listings
- Extract buyer profiles → Track purchase history
- Create `discovery_queue` table for snowball extraction

### 4. Organization Discovery
- When seller is extracted, auto-discover their organization
- Hook `entity-discovery` into `bat-simple-extract`

---

## Test Commands

```bash
# Test single listing sync
curl -s -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-bat-listing" \
  -H "Content-Type: application/json" \
  -d '{"externalListingId": "e84e70e5-1fbe-484e-9c97-bf752dea2607"}'

# Test batch sync
curl -s -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-active-auctions" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 10, "platforms": ["bat"]}'

# Check active listings
SELECT listing_status, COUNT(*) 
FROM external_listings 
WHERE platform = 'bat' 
GROUP BY listing_status;
```

---

## Firecrawl as "Trojan Horse"

The `batFetcher.ts` uses Firecrawl as an automatic bypass for rate limiting:

```typescript
// From batFetcher.ts line 77-79
if (response.status === 403 || response.status === 429) {
  console.log(`[batFetcher] Rate limited, will try Firecrawl...`);
  // Falls through to Firecrawl with proxy/headless browser
}
```

This means:
- Normal operation: FREE direct fetching
- If BaT rate-limits us: Firecrawl kicks in automatically
- Cost logged to `api_usage_logs` for tracking

---

## Current Active Listing

As of this session, there is **1 truly active BaT listing**:

| Field | Value |
|-------|-------|
| URL | https://bringatrailer.com/listing/1985-porsche-911-turbo-5/ |
| Current Bid | $70,000 |
| Bid Count | 500 |
| Watchers | 290 |
| Views | 10,521 |
| Ends | January 18, 2026 |

---

## Next Steps

1. **Monitor the cron job** - Ensure `sync-active-auctions` runs every 15 min
2. **Add more active auctions** - Import live BaT auctions to track
3. **Implement adaptive polling** - Faster updates near auction end
4. **Build discovery queue** - Snowball extraction from sellers/buyers
5. **Track Firecrawl costs** - Query `api_usage_logs` if costs rise

