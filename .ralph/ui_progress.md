# Ralph Wiggum UI Progress Log

## Session: 2026-01-23

---

### Fixes Completed

**1. AuctionMarketplace - Header Cleanup**
- Removed embarrassing "182 stale listings" message
- Simplified debug counts to just "X live auctions"
- Removed verbose hidden counts messages

**2. Database - Stale Listings Fix**
- Updated 97 listings marked "active" but already ended → "ended"

**3. Database - BaT Bid Count Sync**
- Synced 172 BaT listings with 0 bid_count from vehicles.bid_count
- Result: 118/127 active BaT listings now have bid counts

**4. Database - Hagerty Source Normalization**
- Updated 10 Hagerty vehicles stuck as "Unknown Source"

**5. CursorHomepage - Model Filter Added**
- Added `models: string[]` to FilterState interface
- Added models query logic (filters when makes are selected)
- Added useEffect to load available models based on selected makes
- Added model filter UI (shows after make is selected, displays top 15 models)

**6. CollapsibleWidget Component (from Loop 1)**
- Created `/nuke_frontend/src/components/ui/CollapsibleWidget.tsx`
- Standard design patterns with consistent typography

**7. VehicleROISummaryCard - Converted to CollapsibleWidget**
- Now uses CollapsibleWidget with defaultCollapsed={true}

**8. VehiclePricingValueCard - Converted to CollapsibleWidget**
- Uses action prop for Price analysis/Price ledger buttons
- defaultCollapsed={true}

**9. VehicleDescriptionCard - Converted to CollapsibleWidget**
- Uses action prop for Generate/Edit buttons
- defaultCollapsed={false}

**10. VehicleDataGapsCard (Proof Tasks) - Converted to CollapsibleWidget**
- Uses badge prop for task count
- defaultCollapsed={true}
- Preserves id="vehicle-proof-tasks"

**11. VehicleResearchItemsCard (Research Notes) - Converted to CollapsibleWidget**
- Uses badge prop for open items count
- Uses action prop for Add button
- defaultCollapsed={true}

**12. VehicleReferenceLibrary - Converted to CollapsibleWidget**
- Uses badge prop for document count
- defaultCollapsed when empty

**13. Database - Bid Count Sync Trigger Created**
- Created `sync_bid_count_to_external_listings()` trigger function
- Automatically syncs bid_count from vehicles to external_listings on update
- Prevents future desync issues

**14. Database - Stale Listings Cleanup Function Created**
- Created `cleanup_stale_listings()` function
- Marks active listings as "ended" if end_date passed > 30 minutes ago
- Can be called manually or scheduled via cron

**15. VehicleHeader - Platform-Aware Seller Badge**
- Fixed sellerBadge to detect platform (BaT, Hagerty, Cars & Bids, PCar)
- Now generates correct profile URLs per platform instead of hardcoded BaT
- Added URL pattern stripping for multiple platforms

**16. Hagerty Extractor - Full Timestamp for end_date**
- Fixed end_date to preserve full ISO timestamp (was truncating to date only)
- Now countdown timers can show HH:MM:SS for Hagerty auctions

**17. Hagerty Bid Tracker - end_date and seller_slug Updates**
- Updated to sync end_date with full timestamp on every tracking run
- Added seller_slug to metadata for profile URL generation
- Added comment_count to metadata
- Backfilled all 5 active Hagerty listings with correct timestamps

**18. Cars & Bids Core Extractor - Auction Data Extraction**
- Added currentBid extraction (was always null)
- Added endDate extraction from countdown/data attributes and __NEXT_DATA__
- Added auctionStatus extraction
- This enables countdown timers and bid display for C&B auctions

**19. Cars & Bids Sync - Preserve end_date**
- Fixed sync function to not clear existing end_date when updating
- Only updates end_date if we extract a new value

**20. SBX Monitor - end_date Extraction and external_listings Sync**
- Added auction_end_date extraction (from countdown data or time_remaining text)
- Fixed batch query to use external_listings instead of vehicles table
- Now syncs end_date, current_bid, listing_status to external_listings
- Enables countdown timers for SBX auctions

**21. PCarMarket Extractor - end_date Extraction Added**
- Added auction end date extraction (countdown data, ISO dates, time remaining)
- Added bid count, view count, seller username extraction
- Added external_listings sync for countdown timer support

**22. PCarMarket Monitor - New Function Created**
- Created monitor-pcarmarket-listings edge function
- Updates external_listings with end_date, bid data, status
- Also updates vehicles table with auction_end_date
- Successfully updated 5 PCarMarket listings with end_date

---

### Summary Stats

- **6 widgets converted** to CollapsibleWidget pattern
- **172 BaT bid counts** synced
- **98 stale listings** fixed (97 initial + 1 from cleanup function)
- **1 new filter** (model) added to CursorHomepage
- **7 deployments** to Vercel production
- **2 database triggers/functions** created for automation
- **7 extractor fixes** (Hagerty timestamp, Hagerty bid tracker, C&B extractor, C&B sync, SBX monitor, PCarMarket extractor, PCarMarket monitor)
- **1 header fix** (platform-aware seller badges)
- **5 Hagerty listings** backfilled with correct timestamps
- **SBX listings** now have end_date and status synced
- **5 PCarMarket listings** now have end_date
- **7 edge functions deployed** (extract-hagerty-listing, hagerty-bid-tracker, extract-cars-and-bids-core, sync-cars-and-bids-listing, monitor-sbxcars-listings, import-pcarmarket-listing, monitor-pcarmarket-listings)

---

### Still TODO

**Vehicle Profile:**
- [~] VehicleCommentsCard - Keep as-is (different collapse pattern - shows limited comments, not full widget collapse)
- [x] Fix header badges for non-BaT platforms (DONE - platform-aware seller badge)
- [x] Ensure countdown timer data flows correctly (DONE - Hagerty extractor now saves full timestamp)

**CursorHomepage:**
- [x] Model filter (DONE)
- [ ] Stats panel popup improvements

**AuctionMarketplace:**
- [x] Remove stale listings message (DONE)
- [x] Fix BaT 0 bids (DONE - data sync + trigger)

**Data/Extraction:**
- [ ] Hagerty comment extraction (extractor doesn't fetch comments - need to research Hagerty's comment API)
- [~] Schedule cleanup_stale_listings() via pg_cron - Requires Supabase dashboard. SQL:
  ```sql
  SELECT cron.schedule(
    'cleanup-stale-listings',
    '*/30 * * * *',  -- Every 30 minutes
    $$SELECT cleanup_stale_listings()$$
  );
  ```

---

### Key Findings

1. **Timer code exists** in VehicleHeader.tsx - data flow issue, not code issue
2. **Hagerty comments**: 0 in auction_comments table - extractor only gets count, not actual comments
3. **BaT bid counts**: vehicles.bid_count has data, external_listings.bid_count was 0 - now auto-synced via trigger
4. **Stale listings**: Cleanup function created for ongoing maintenance

---

### Latest Deployment

**https://n-zero.dev** (nuke project)

Also deployed to: https://nukefrontend-fizpsg5pp-nzero.vercel.app (nuke_frontend project)

**Previous:**
- https://nukefrontend-lvo0vkdhx-nzero.vercel.app
- https://nukefrontend-9f2gffacc-nzero.vercel.app

---

### Session Continuation Notes (Context Recovery)

**Live Auction Status (as of 2026-01-23 20:23 UTC):**
- BaT: ~100+ auctions ending today (full timestamps working)
- Cars & Bids: 4+ auctions active (ending Jan 23-27, end_date now extracted)
- SBX: 6+ auctions active (ending Jan 27-28)
- Hagerty: 5 active (all backfilled with full timestamps via bid-tracker)
- PCarMarket: 5 active (all now have end_date via monitor)

**What's Working:**
- Countdown timers in VehicleHeader work when end_date has full timestamp
- Seller badges now platform-aware (BaT, Hagerty, Cars & Bids, PCar)
- Collapsible widgets unified across 6 vehicle profile components
- Model filter working on CursorHomepage after make selection
- Hagerty bid tracker now updates end_date + seller_slug on each run
- Cars & Bids core extractor now extracts auction data (bid, end_date, status)
- PCarMarket monitor now extracts end_date and syncs to external_listings

**Next Steps:**
1. Research Hagerty comments API to extract actual comment text
2. Schedule cleanup_stale_listings() via Supabase dashboard
3. Consider stats panel improvements (Bloomberg-style insights)
4. Run monitor functions periodically to keep data fresh
5. Consider adding monitors for traditional auction houses (Broad Arrow, Collecting Cars, Gooding, RM Sotheby's)

**Suggested Cron Schedule for Monitors:**
```bash
# Hagerty bid tracker - hourly during auctions
0 * * * * curl -X POST "$SUPABASE_URL/functions/v1/hagerty-bid-tracker" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}'

# PCarMarket monitor - every 4 hours
0 */4 * * * curl -X POST "$SUPABASE_URL/functions/v1/monitor-pcarmarket-listings" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{"batch_size": 20}'

# SBX monitor - every 4 hours
0 */4 * * * curl -X POST "$SUPABASE_URL/functions/v1/monitor-sbxcars-listings" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{"batch_size": 20}'

# Cleanup stale listings - every 30 minutes
*/30 * * * * SELECT cleanup_stale_listings();
```

---

### Final Session Summary

**Total Changes Made:**
- 7 frontend components modified (CursorHomepage, VehicleHeader, 6 widgets)
- 7 edge functions fixed and deployed
- 2 database functions created
- 1 database trigger created
- 1 Vercel deployment (frontend)

**Key Improvements:**
1. Platform-aware seller badges (was hardcoded for BaT only)
2. Countdown timers now work for Hagerty auctions (full timestamps)
3. Cars & Bids extractor now captures auction data
4. Model filter on homepage
5. Unified collapsible widget pattern
6. PCarMarket extractor + monitor for end_date extraction
7. SBX monitor for end_date extraction

**Verified Working:**
- Hagerty listings now have correct end_date with time (20:00, 20:05, etc.)
- Seller badge generates correct URLs for Hagerty, C&B, PCar
- PCarMarket listings have end_date for countdown timers
- SBX listings have end_date for countdown timers
- Frontend deployed and accessible at https://nukefrontend-lvo0vkdhx-nzero.vercel.app

**Platform Countdown Timer Coverage:**
| Platform | end_date Support | Notes |
|----------|------------------|-------|
| BaT | ✅ Full | Already working |
| Hagerty | ✅ Full | Fixed timestamp truncation |
| Cars & Bids | ✅ Partial | Extractor works, some listings ended |
| SBX | ✅ Full | Monitor syncs end_date |
| PCarMarket | ✅ Full | New monitor created |
| Broad Arrow | ❌ None | Traditional auction house |
| Collecting Cars | ❌ None | Traditional auction house |
| Gooding | ❌ None | Traditional auction house |
| RM Sotheby's | ❌ None | Traditional auction house |
