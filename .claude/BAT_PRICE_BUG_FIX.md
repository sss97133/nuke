# BaT Price Extraction Bug - Root Cause Analysis & Fix

**Date:** 2026-02-02
**Vehicle Affected:** 43a24190-e0d6-453c-842d-9dcb695f326b (1957 Chrysler 300C)
**BaT URL:** https://bringatrailer.com/listing/1957-chrysler-300c/

## The Bug

### Wrong Data Extracted
- **Extracted price:** $437,250
- **Actual price:** $34,000 (High Bid)
- **Extracted status:** "sold" → "no_reserve" → "reserve_met"
- **Actual status:** Reserve Not Met (DID NOT SELL)

### Impact
Critical data corruption - listings showing wrong prices by 10x and marking unsold auctions as sold.

## Root Cause

The extractor was searching for "Sold for $X" patterns in the ENTIRE page HTML, which includes user comments.

### The Smoking Gun

Found in comment from user "Patrick_2012" (comment ID: 852848):

> "At an auction at the Robson Estate in Gainesville, Georgia on November 13, 2010, the sole 1960 300F convertible equipped with the factory 400 hp (298 kW) engine and the Pont-a-Mousson 4-speed sold for **$437,250**, according to Wikopedia."

This comment was discussing a DIFFERENT vehicle (1960 300F) that sold at a DIFFERENT auction in 2010. The extractor's regex matched "sold for $437,250" from this comment and used it as the sale price for the 1957 300C listing.

### Code Location

`/Users/skylar/nuke/supabase/functions/extract-bat-core/index.ts` lines 521-543

**Before:**
```typescript
if (!sale_price) {
  const soldPatterns = [ ... ];
  for (const p of soldPatterns) {
    const m = text.match(p);  // ❌ Searches ENTIRE page including comments
    if (m?.[1]) {
      sale_price = parseMoney(m[1]);
    }
  }
}
```

The `text` variable includes `fullText` which is `stripTags(h)` where `h` is the entire HTML page, including all user comments.

## The Fix

### 1. Scope Limitation (Primary Fix)

**Changed:** Line 531-533 - Only search essentials block and title, NOT full page text

```typescript
// CRITICAL: Only search essentials + title for sold price, NOT full page text (which includes
// user comments that may reference other vehicles' sale prices). Comments like "Another 300F
// sold for $437,250 at Robson auction" will pollute the extraction.
const soldSearchScope = `${winText} ${titleText || ""}`;
for (const p of soldPatterns) {
  const m = soldSearchScope.match(p);  // ✅ Limited scope
```

### 2. Reserve Status Logic Fix

**Changed:** Lines 545-561 - Don't override reserve_not_met unless we have HIGH-CONFIDENCE sale data

**Before:**
```typescript
if (sale_price && reserve_status === "reserve_not_met") {
  reserve_status = hasNoReserve ? "no_reserve" : "reserve_met";  // ❌ Always overrides
}
```

**After:**
```typescript
const hasHighConfidenceSale = Boolean(soldPriceFromStats);  // Only from stats table

if (sale_price && hasHighConfidenceSale && reserve_status === "reserve_not_met") {
  reserve_status = hasNoReserve ? "no_reserve" : "reserve_met";  // ✅ Only overrides with confidence
}
```

### 3. Cleanup Logic Enhancement

**Added:** Lines 1497-1508 - Handle reserve_not_met even when bid extraction fails

```typescript
} else if (!hasExtractedBid && (extractedReserve === "reserve_not_met" || extractedReserve === "no_sale")) {
  // CRITICAL: Reserve Not Met with no bid data extracted.
  // Still need to clear any polluted sale_price and set correct reserve status.
  if (listingIsLatestOrEqual) {
    const alreadySold = existingSaleStatus === "sold" || existingOutcome === "sold";
    if (!alreadySold && existingSalePrice && existingSalePrice > 0) {
      updatePayload.sale_price = null;  // Clear pollution
      updatePayload.high_bid = null;
    }
    updatePayload.auction_outcome = "reserve_not_met";
  }
}
```

### 4. Polluted Sale Price Detection

**Enhanced:** Line 1477 - Detect pollution when existing sale_price doesn't match extracted data

```typescript
const looksLikePollutedSale =
  typeof existingSalePrice === "number" &&
  existingSalePrice > 0 &&
  ((existingSalePrice === existingHighBid) ||
   (existingSalePrice === extractedHighBid) ||
   (existingSalePrice !== extractedSalePrice));  // ← New: catches comment pollution
```

## Testing

### Before Fix
```bash
$ psql -c "SELECT sale_price, high_bid, reserve_status FROM vehicles WHERE id = '43a24190...'"
 sale_price | high_bid | reserve_status
------------+----------+----------------
     437250 |   437250 | no_reserve
```

### After Fix + Manual Correction
```bash
$ psql -c "UPDATE vehicles SET sale_price = NULL, high_bid = 34000 WHERE id = '43a24190...'"
$ psql -c "SELECT sale_price, high_bid, reserve_status FROM vehicles WHERE id = '43a24190...'"
 sale_price | high_bid | reserve_status
------------+----------+-----------------
            |    34000 | reserve_not_met
```

## Lessons Learned

1. **Never search entire page HTML for extraction data** - User comments, sidebars, and recommended listings can pollute results
2. **Always scope regex searches to specific DOM regions** - Use essentials block, stats tables, and structured data
3. **Validate extraction logic against edge cases** - Old listings with extensive comment history are prime for pollution
4. **High-confidence vs low-confidence signals** - Only override explicit markers (like "Reserve Not Met") when you have authoritative data

## Prevention

Added inline comments warning future developers:
- Line 528-530: CRITICAL comment explaining the scoping rationale
- Line 545-548: Explanation of high-confidence sale detection
- Line 1470-1477: Documentation of pollution detection logic
- Line 1498-1508: Handling of extraction failures with RNM status

## Deployment

```bash
cd /Users/skylar/nuke
supabase functions deploy extract-bat-core --no-verify-jwt
```

Fix deployed: 2026-02-02 02:36:57 UTC

## Follow-up Actions Needed

1. ✅ Fix deployed to production - extraction no longer pulls from comments
2. ⚠️  **MANUAL CLEANUP REQUIRED:** Existing polluted records need manual correction OR deletion+re-extraction
3. ⚠️  **TODO:** The upsert logic may need enhancement to force-clear polluted data even when extraction returns null
4. ⚠️  **TODO:** Run audit query to find other vehicles with this pollution pattern
5. ⚠️  **TODO:** Re-extract all affected BaT listings OR run UPDATE query to clear polluted sale_price
6. ⚠️  **TODO:** Add automated tests for comment pollution scenarios

## Known Limitation

The current fix prevents NEW pollution from occurring, but the upsert logic may not aggressively clear EXISTING polluted data when:
- High bid extraction returns null (due to HTML parsing issues)
- The existing record has sale_price set to a polluted value

**Workaround:** Manually clear polluted records before re-extraction:
```sql
UPDATE vehicles
SET sale_price = NULL, high_bid = NULL
WHERE id = '43a24190-e0d6-453c-842d-9dcb695f326b';
```

Then re-run extraction.

## Audit Query (TODO)

```sql
-- Find vehicles where sale_price exists but reserve_status = 'reserve_not_met'
-- These are likely polluted by the bug
SELECT
  v.id,
  v.bat_auction_url,
  v.sale_price,
  v.high_bid,
  v.reserve_status,
  v.updated_at
FROM vehicles v
WHERE v.sale_price IS NOT NULL
  AND v.sale_price > 0
  AND v.reserve_status = 'reserve_not_met'
  AND v.bat_auction_url IS NOT NULL
ORDER BY v.updated_at DESC;
```
