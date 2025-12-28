# Edge Function Cleanup Plan

**Date**: 2025-12-27  
**Status**: Analysis Complete | Ready for Review

## Summary

Out of **227 edge functions**, we've identified **65 candidates for deletion**:

- **31 functions** called from frontend (KEEP)
- **2 functions** scheduled as cron jobs (KEEP)
- **129 functions** internal/processing (REVIEW - some may be unused)
- **65 functions** candidates for deletion

## Deletion Candidates by Category

### 1. Experimental/Test Functions (3)
- `quick-endpoint`
- `test-gemini`
- `test-bat-firecrawl`

**Action**: Safe to delete - these are clearly test functions

### 2. Research/Experimental Functions (12)
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

**Action**: Review - if not used in production, safe to delete

### 3. Admin One-Off Scripts (19)
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

**Action**: Review - if one-time fixes are complete, safe to delete

### 4. One-Off Site Scrapers (26)
- `scrape-lmc-truck`
- `scrape-lmc-complete`
- `parse-lmc-complete-catalog`
- `scrape-prowire-catalog`
- `scrape-motec-catalog`
- `scrape-holley-product`
- `holley-discover-urls`
- `scrape-sbxcars`
- `discover-sbxcars-listings`
- `monitor-sbxcars-listings`
- `scrape-collective-auto-sold`
- `discover-speed-digital-clients`
- `discover-speed-digital-clients-v2`
- `enrich-speed-digital-clients`
- `discover-classic-sellers`
- `index-2002ad-parts`
- `index-lartdelautomobile`
- `index-classic-com-dealer`
- `catalog-dealer-site-structure`
- `scrape-all-craigslist-squarebodies`
- `scrape-all-craigslist-2000-and-older`
- `discover-cl-squarebodies`
- `scrape-craigslist-search`
- `import-classiccars-listing`
- `import-classic-auction`
- `sync-cars-and-bids-listing`

**Action**: Review - if data is already imported and not needed for updates, safe to delete

### 5. Other Candidates (5)
- Functions categorized as "unknown" that aren't called from frontend

## Functions to KEEP

### Frontend-Called (31)
These are actively used by the frontend:
- `analyze-image`
- `simple-scraper`
- `vehicle-expert-agent`
- `complete-bat-import`
- `extract-and-route-data`
- `generate-vehicle-description`
- `extract-using-catalog`
- `detect-sensitive-document`
- `import-bat-listing`
- `ai-agent-supervisor`
- `validate-bat-image`
- `process-content-extraction`
- `index-reference-document`
- `index-service-manual`
- `scrape-vehicle`
- `backfill-images`
- `process-receipt`
- `auto-analyze-upload`
- `analyze-batch-contextual`
- `smart-receipt-linker`
- `reprocess-image-exif`
- `auto-fix-bat-prices`
- `parse-reference-document`
- `extract-bat-parts-brands`
- `sync-bat-listing`
- `query-wiring-needs`
- `analyze-vehicle-tags`
- `extract-vehicle-data-ai`
- `generate-work-logs`
- `auto-fix-vehicle-profile`
- `process-url-drop`

### Scheduled/Cron (2)
- `process-all-images-cron`
- `autonomous-extraction-agent`

## Deletion Process

### Step 1: Review
1. Review `test-results/edge-functions/cleanup-analysis.json`
2. Verify functions aren't called from other functions
3. Check Supabase logs for recent usage

### Step 2: Backup (Optional)
```bash
# Export function code before deletion (if needed)
supabase functions list > functions-backup.txt
```

### Step 3: Delete
```bash
# Review the list first
node scripts/analyze-unused-edge-functions.js

# Delete (requires confirmation)
bash scripts/delete-unused-edge-functions.sh
```

### Step 4: Verify
```bash
# Run health check to verify
node scripts/test-all-edge-functions-health.js
```

## Recommendations

1. **Start Conservative**: Delete experimental/test functions first
2. **Check Logs**: Verify functions haven't been used in last 30 days
3. **Keep Scrapers**: If you might need to re-scrape sites, keep those functions
4. **Archive Code**: Consider moving deleted function code to `archive/` before deleting

## Estimated Impact

- **Reduction**: ~29% (65/227 functions)
- **Risk**: Low (functions not called from frontend)
- **Time Saved**: Faster deployments, easier maintenance

## Next Steps

1. ✅ Analysis complete
2. ⏳ Review deletion candidates
3. ⏳ Delete experimental/test functions
4. ⏳ Review and delete admin one-offs
5. ⏳ Review and delete one-off scrapers (if data imported)
6. ⏳ Verify system still works


