# Budget Constraints - Free Mode Operation

**Status:** ✅ **ACTIVE - All paid APIs disabled**

**Date:** 2026-01-10  
**Constraint:** Firecrawl, OpenAI, and Anthropic API budgets exhausted. System must operate using only free alternatives.

---

## Changes Made

### ✅ `extract-premium-auction` (BaT extraction)
**Before:** Used Firecrawl for HTML + AI extraction  
**After:** Direct HTML fetch + regex/HTML parsing only

**What Still Works:**
- ✅ Images extracted from `data-gallery-items` JSON (embedded in HTML)
- ✅ Specs extracted via regex patterns (mileage, VIN, color, transmission, etc.)
- ✅ Sale status correctly parsed ("Bid to $X" vs "Sold for $X")
- ✅ Bid counts, prices, auction data

**Limitations:**
- ⚠️ No AI-assisted extraction (manual regex patterns only)
- ⚠️ May miss edge cases that AI would catch
- ⚠️ Title/year/make/model parsing from HTML title tag (may be less accurate)

### ✅ `extract-auction-comments`
**Before:** Required Firecrawl for JavaScript rendering  
**After:** Direct HTML fetch only

**What Still Works:**
- ✅ Comments extracted from HTML (if rendered server-side)
- ✅ DOM parsing for comment structure

**Limitations:**
- ⚠️ Comments that require JavaScript rendering may not load
- ⚠️ Lazy-loaded comments (requiring scroll) may be missing

---

## Functions Still Using Paid APIs (BLOCKED)

These functions will fail until budget is restored:

1. ❌ `process-import-queue` - Uses Firecrawl
2. ❌ `extract-using-catalog` - Uses Firecrawl + OpenAI
3. ❌ `extract-with-proof-and-backfill` - Uses Firecrawl + OpenAI
4. ❌ `ai-proofread-pending` - Uses OpenAI/Anthropic
5. ❌ `scrape-multi-source` - Uses Firecrawl + OpenAI
6. ❌ `sync-bat-listing` - May use Firecrawl
7. ❌ Most Cars & Bids, Mecum, Broad Arrow extractors - Use Firecrawl

---

## Free Alternatives Strategy

### ✅ Working: Direct Fetch + HTML Parsing
- BaT listings work well with direct fetch (all data in HTML)
- Images in `data-gallery-items` JSON attribute
- Specs via regex patterns

### ⚠️ Needs Work: Sites Requiring JavaScript
- Sites that render comments/data with JavaScript may fail
- May need to wait for JavaScript to execute (but Deno edge functions can't run JS)
- **Solution:** Accept partial data extraction, or skip these sites

### ❌ Not Possible: Bot-Protected Sites
- Sites with Cloudflare, Facebook bot protection won't work without Firecrawl
- **Solution:** Focus on sites that allow direct scraping (BaT, some dealer sites)

---

## Recommended Actions

### Immediate (Done)
1. ✅ Switched BaT extraction to free mode
2. ✅ Switched BaT comments to free mode
3. ✅ Deployed both functions

### Next Steps
1. **Focus on BaT** - Works well with free mode, continue using
2. **Skip protected sites** - Don't attempt sites requiring bot protection
3. **Prioritize sites with static HTML** - Focus scraping on sites that don't need JS rendering
4. **Monitor queue** - Check which sources still work with free mode

### When Budget Restored
1. Re-enable Firecrawl for bot-protected sites
2. Re-enable AI extraction for edge cases
3. Process failed queue items that needed paid APIs

---

## Queue Status

- **1,110 items** in `import_queue` pending
- **1,524 items** in `bat_extraction_queue` failed (mostly Firecrawl errors)
- **29 items** in `bat_extraction_queue` pending (can now be processed with free mode)

---

## Testing Free Mode

Test BaT extraction:
```bash
curl -X POST "${SUPABASE_URL}/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bringatrailer.com/listing/2023-ford-bronco-raptor-11", "max_vehicles": 1}'
```

Expected: Should work without Firecrawl errors.

---

**Last Updated:** 2026-01-10  
**Status:** ✅ **FREE MODE ACTIVE - BaT extraction working**

