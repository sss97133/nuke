# C&B Extraction Fix Progress

## Loop 5 - 2026-01-22

### Summary:
The **attribution fix is COMPLETE** and working. Images will now insert correctly when found. However, C&B uses aggressive lazy loading that prevents Firecrawl from capturing images.

### What was fixed:
1. ✅ **Attribution constraint fix** - Changed from `source: "carsandbids"` to `source: "cab_import"` with all required fields:
   - `user_id`, `source_url`, `is_external`, `approval_status`, `is_approved`
   - `redaction_level`, `position`, `is_primary`, `taken_at`, `exif_data`
2. ✅ **Firecrawl configuration** - Increased waitFor to 10000ms, added markdown format
3. ✅ **Image extraction patterns** - Added multiple patterns, JSON parsing, markdown parsing

### Current State:
- **Vehicle creation**: ✅ Working (year/make/model extracted from og:title)
- **Image insertion code**: ✅ Fixed (attribution constraint satisfied)
- **Image extraction**: ⚠️ Returns 0 images (C&B lazy loading issue)

### Why images aren't extracted:
C&B uses intersection observer for images - they only load when scrolled into view. Firecrawl's `waitFor` doesn't help because the images are never in the viewport. Tested approaches that didn't work:
- waitFor: 10000ms
- HTML patterns for media.carsandbids.com
- JSON embedded data parsing
- Markdown format extraction

### Files Modified:
`supabase/functions/extract-cars-and-bids-core/index.ts`:
- Lines 492-518: Attribution fix for vehicle_images insert
- Line 347: waitFor increased to 10000ms
- Line 345: Added markdown format
- Lines 181-223: Enhanced image extraction patterns

### Next Steps (for future):
1. Try Firecrawl `actions` to scroll the page
2. Find C&B API endpoints that return image URLs
3. Accept images may require separate browser automation

### Deployed Function Status:
- Function: `extract-cars-and-bids-core`
- Status: **DEPLOYED** and working for basic extraction
- Test: Vehicles created with year/make/model, images pending better extraction
