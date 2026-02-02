# Collecting Cars Monitor - Revival Evaluation

**Date:** 2026-02-01
**Status:** ❌ CANNOT BE REVIVED (Cloudflare blocked)

## Summary

The archived `monitor-collecting-cars-listings` function **cannot be revived** in its current form due to Cloudflare protection on collectingcars.com that blocks simple HTTP requests.

## Current State

### Archival Details
- **Archived in commit:** `fd8bea6d` ("chore: major codebase cleanup - archive unused code")
- **Last active:** January 23, 2026
- **Location:** `/Users/skylar/nuke/supabase/functions/_archived/monitor-collecting-cars-listings/`

### Database State
- **Total listings:** 71 collecting_cars entries in `external_listings`
- **Active listings:** 52 with status `active`, `live`, or `upcoming`
- **Table used:** `external_listings` (still exists and has data)

### Dependencies Analysis

#### BLOCKED: Firecrawl (Optional but Preferred)
```typescript
const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
// Line 182-201: Uses Firecrawl for JS rendering
```
- Function includes Firecrawl integration for JavaScript rendering
- Has fallback to simple HTTP fetch (lines 204-210)
- **Firecrawl is currently blocked/not available**

#### BLOCKED: Simple HTTP
```bash
$ curl -s 'https://collectingcars.com/...'
<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
```
- Collecting Cars uses **Cloudflare challenge** (JavaScript + cookies required)
- Simple HTTP requests return Cloudflare interstitial page
- User-Agent spoofing does NOT bypass protection

#### NO AI REQUIRED
- Function uses regex pattern matching for data extraction
- No LLM/AI calls in the code
- Extracts: current_bid, bid_count, watcher_count, auction_status, auction_end_date

## Function Design

### What It Does
1. **Single listing mode:** Monitor one listing by `listing_id` or `listing_url`
2. **Batch mode:** Monitor up to 50 active listings (default batch_size=50)
3. Updates `external_listings` table with:
   - `current_bid`, `bid_count`, `watcher_count`
   - `end_date`, `listing_status`, `final_price`, `sold_at`
4. Also updates linked `vehicles` table with auction data

### Extraction Patterns
```typescript
// Works by parsing HTML for patterns like:
- "Current Bid: £45,000"
- "High Bid: £45,000"
- "Sold for £45,000"
- "X bids" / "X watching"
- Unix timestamps or ISO dates for end_date
- "Reserve met" / "No reserve"
```

## Why It Needs JavaScript Rendering

Collecting Cars is built on React/Next.js:
- Comment in code (line 181): "Collecting Cars uses React/Next.js, so we need JS rendering"
- Critical auction data is client-side rendered
- Cloudflare protection adds additional complexity

## Alternative Approaches Considered

### 1. Playwright (Browser Automation)
**Status:** Possible but resource-intensive

- MCP server available: `mcp__playwright__navigate`, `mcp__playwright__screenshot`
- Debug script exists: `/Users/skylar/nuke/scripts/debug-collecting-cars.js`
- **Pros:**
  - Can bypass Cloudflare
  - Can render JavaScript
  - Can extract data from DOM
- **Cons:**
  - High resource usage (browser instance per request)
  - Slow (5+ seconds per page)
  - Not suitable for edge functions (Deno runtime)
  - Would need separate service

### 2. API Discovery
**Status:** Unknown

- May have undocumented API endpoints
- Would need network inspection of live site
- No evidence of public API

### 3. RSS/Sitemap
**Status:** Not applicable

- Monitoring requires real-time bid data
- RSS wouldn't provide current_bid updates

## Related Archived Functions

All monitoring functions were archived in same commit (`fd8bea6d`):
- `monitor-cars-and-bids-listings` - Same pattern, likely same Cloudflare issue
- `monitor-broad-arrow-listings` - Same pattern
- `monitor-pcarmarket-listings` - Same pattern
- `monitor-sbxcars-listings` - Same pattern
- `monitor-bat-seller` - Different use case

**Pattern:** All auction platform monitors were archived together, suggesting systematic issue (likely Cloudflare protection across platforms).

## Recommendation

### DO NOT REVIVE in current form

**Blockers:**
1. Cloudflare protection prevents HTTP access
2. Firecrawl (preferred method) is blocked/unavailable
3. No simple HTTP fallback works

### Alternative Strategy

If monitoring Collecting Cars listings is required:

#### Option A: Playwright Service (High Effort)
1. Create separate Node.js service running Playwright
2. Deploy outside edge functions (needs persistent browser)
3. Call from edge function via HTTP
4. **Effort:** 4-8 hours
5. **Cost:** Additional infrastructure

#### Option B: Wait for Firecrawl Access
1. Monitor relies on Firecrawl for JS rendering
2. Once Firecrawl access restored, function could work
3. Would need testing to verify Cloudflare bypass
4. **Effort:** 1-2 hours (testing + deployment)

#### Option C: Manual/Periodic Updates
1. Accept that automated monitoring not feasible
2. User manually checks listings and updates
3. No development required

#### Option D: API Reverse Engineering
1. Inspect network traffic on collectingcars.com
2. Find API endpoints for auction data
3. Use direct API calls instead of scraping
4. **Effort:** 2-4 hours (research + implementation)
5. **Risk:** API may be authenticated or rate-limited

## Files Reference

- **Archived function:** `/Users/skylar/nuke/supabase/functions/_archived/monitor-collecting-cars-listings/index.ts`
- **Debug script:** `/Users/skylar/nuke/scripts/debug-collecting-cars.js`
- **Database table:** `external_listings` (71 entries, 52 active)

## Conclusion

The function is well-designed and would work if Cloudflare protection could be bypassed. However, without Firecrawl access or a Playwright-based solution, **it cannot be deployed successfully**.

**Status:** Archive should remain until Firecrawl access is restored or Playwright service is implemented.
