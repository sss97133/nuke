# Edge Function Deletion Log

**Date**: 2025-12-27  
**Total Deleted**: 60 functions  
**Remaining**: ~167 functions (from 227)

## Deleted Functions

### Experimental/Test Functions (3)
✅ `quick-endpoint`  
✅ `test-gemini`  
✅ `test-bat-firecrawl`

### Research Functions (12)
✅ `calculate-feed-relevance`  
✅ `analyze-vehicle-probability`  
✅ `simulate-agent-activities`  
✅ `generate-explanation`  
✅ `track-content-interaction`  
✅ `analyze-modification-value`  
✅ `extract-training-data`  
✅ `optimize-rekognition-training`  
✅ `research-spec`  
✅ `research-agent`  
✅ `ai-proofread-pending`  
✅ `tool-benchmark-validator`

### Admin One-Off Scripts (19)
✅ `fix-price-rls`  
✅ `project-stats`  
✅ `check-scraper-health`  
✅ `system-stats`  
✅ `retry-image-backfill`  
✅ `admin-backfill-origin-images`  
✅ `go-grinder`  
✅ `admin-backfill-bat-missing-images`  
✅ `normalize-org-vehicle-relationships`  
✅ `bat-dom-map-health-runner`  
✅ `auth-site-mapper`  
✅ `auto-site-mapper`  
✅ `cleanup-bat-image-contamination`  
✅ `bat-make-profiles-correct-runner`  
✅ `sync-service-key-to-db`  
✅ `activate-pending-vehicles`  
✅ `re-extract-pending-vehicles`  
✅ `inspect-scrape-coverage`  
✅ `micro-scrape-bandaid`

### One-Off Site Scrapers (26)
✅ `scrape-lmc-truck`  
✅ `scrape-lmc-complete`  
✅ `parse-lmc-complete-catalog`  
✅ `scrape-prowire-catalog`  
✅ `scrape-motec-catalog`  
✅ `scrape-holley-product`  
✅ `holley-discover-urls`  
✅ `scrape-sbxcars`  
✅ `discover-sbxcars-listings`  
✅ `monitor-sbxcars-listings`  
✅ `scrape-collective-auto-sold`  
✅ `discover-speed-digital-clients`  
✅ `discover-speed-digital-clients-v2`  
✅ `enrich-speed-digital-clients`  
✅ `discover-classic-sellers`  
✅ `index-2002ad-parts`  
✅ `index-lartdelautomobile`  
✅ `index-classic-com-dealer`  
✅ `catalog-dealer-site-structure`  
✅ `scrape-all-craigslist-squarebodies`  
✅ `scrape-all-craigslist-2000-and-older`  
✅ `discover-cl-squarebodies`  
✅ `scrape-craigslist-search`  
✅ `import-classiccars-listing`  
✅ `import-classic-auction`  
✅ `sync-cars-and-bids-listing`

## Impact

- **Reduction**: 26% (60/227 functions)
- **Risk**: Low (none were called from frontend)
- **Benefit**: Cleaner codebase, faster deployments, easier maintenance

## Next Steps

1. ✅ Deletion complete
2. ⏳ Verify system still works (run health check)
3. ⏳ Update documentation if needed
4. ⏳ Consider archiving function code if you might need it later


