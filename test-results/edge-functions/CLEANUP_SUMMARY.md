# Edge Function Cleanup - Quick Summary

**Analysis Date**: 2025-12-27  
**Total Functions**: 227  
**Candidates for Deletion**: 65 (29%)

## 🎯 Quick Action Items

### ✅ Safe to Delete Immediately (15 functions)
**Experimental/Test Functions:**
- `quick-endpoint`
- `test-gemini`  
- `test-bat-firecrawl`

**Research Functions (not in production):**
- `calculate-feed-relevance`
- `analyze-vehicle-probability`
- `simulate-agent-activities`
- `generate-explanation`
- `track-content-interaction`
- `analyze-modification-value`
- `extract-training-data`
- `optimize-rekognition-training`
- `research-spec`
- `research-agent`
- `ai-proofread-pending`
- `tool-benchmark-validator`

### ⚠️ Review Before Deleting (50 functions)
**Admin One-Off Scripts** - Delete if one-time fixes are complete:
- `fix-price-rls`
- `project-stats`
- `check-scraper-health`
- `system-stats`
- `retry-image-backfill`
- `admin-backfill-origin-images`
- `go-grinder`
- `admin-backfill-bat-missing-images`
- `normalize-org-vehicle-relationships`
- `bat-dom-map-health-runner`
- `auth-site-mapper`
- `auto-site-mapper`
- `cleanup-bat-image-contamination`
- `bat-make-profiles-correct-runner`
- `sync-service-key-to-db`
- `activate-pending-vehicles`
- `re-extract-pending-vehicles`
- `inspect-scrape-coverage`
- `micro-scrape-bandaid`

**One-Off Site Scrapers** - Delete if data is already imported:
- `scrape-lmc-truck`, `scrape-lmc-complete`, `parse-lmc-complete-catalog`
- `scrape-prowire-catalog`, `scrape-motec-catalog`, `scrape-holley-product`
- `holley-discover-urls`
- `scrape-sbxcars`, `discover-sbxcars-listings`, `monitor-sbxcars-listings`
- `scrape-collective-auto-sold`
- `discover-speed-digital-clients`, `discover-speed-digital-clients-v2`, `enrich-speed-digital-clients`
- `discover-classic-sellers`
- `index-2002ad-parts`, `index-lartdelautomobile`, `index-classic-com-dealer`
- `catalog-dealer-site-structure`
- `scrape-all-craigslist-squarebodies`, `scrape-all-craigslist-2000-and-older`
- `discover-cl-squarebodies`, `scrape-craigslist-search`
- `import-classiccars-listing`, `import-classic-auction`
- `sync-cars-and-bids-listing`

## ✅ Functions to KEEP (33)

**Frontend-Called (31):**
- `analyze-image`, `simple-scraper`, `vehicle-expert-agent`
- `complete-bat-import`, `extract-and-route-data`, `generate-vehicle-description`
- `extract-using-catalog`, `detect-sensitive-document`, `import-bat-listing`
- `ai-agent-supervisor`, `validate-bat-image`, `process-content-extraction`
- `index-reference-document`, `index-service-manual`, `scrape-vehicle`
- `backfill-images`, `process-receipt`, `auto-analyze-upload`
- `analyze-batch-contextual`, `smart-receipt-linker`, `reprocess-image-exif`
- `auto-fix-bat-prices`, `parse-reference-document`, `extract-bat-parts-brands`
- `sync-bat-listing`, `query-wiring-needs`, `analyze-vehicle-tags`
- `extract-vehicle-data-ai`, `generate-work-logs`, `auto-fix-vehicle-profile`
- `process-url-drop`

**Scheduled/Cron (2):**
- `process-all-images-cron`
- `autonomous-extraction-agent`

## 🚀 How to Delete

### Option 1: Delete All Candidates (Recommended - Start with Experimental)
```bash
# 1. Review the list
cat test-results/edge-functions/cleanup-analysis.json | jq '.candidates_for_deletion'

# 2. Delete (requires confirmation)
bash scripts/delete-unused-edge-functions.sh
```

### Option 2: Delete Specific Categories
```bash
# Delete just experimental/test functions
for func in quick-endpoint test-gemini test-bat-firecrawl; do
  supabase functions delete $func --project-ref qkgaybvrernstplzjaam
done
```

### Option 3: Manual Review & Delete
```bash
# Review each function
supabase functions list

# Delete individually
supabase functions delete FUNCTION_NAME --project-ref qkgaybvrernstplzjaam
```

## 📊 Impact

- **Before**: 227 functions
- **After (if all deleted)**: 162 functions (29% reduction)
- **Risk**: Low (functions not called from frontend)
- **Benefit**: Faster deployments, easier maintenance, cleaner codebase

## ⚠️ Before Deleting

1. **Check Supabase Logs**: Verify functions haven't been used in last 30 days
2. **Review Dependencies**: Make sure no other functions call these
3. **Backup Code** (optional): Export function code if you might need it later
4. **Test After**: Run health check to verify system still works

## 📝 Full Details

See `docs/ops/EDGE_FUNCTION_CLEANUP_PLAN.md` for complete analysis.


