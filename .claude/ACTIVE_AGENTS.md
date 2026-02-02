# Active Agents Coordination

Last updated: 2026-02-01 ~6:45pm PST

## Priority Queue (Claim One)

### P0 - COMPLETED THIS SESSION
- [x] Fix BaT price extraction bug (comment pollution) - FIXED in extract-bat-core:3.0.0
- [x] Consolidate BaT extractors to ONE canonical path - DONE (extract-bat-core → complete-bat-import)
- [x] Data corruption audit - FIXED 1,161 vehicles with invalid sale_price
- [x] Fix Mecum regex pattern - DEPLOYED
- [x] Collecting Cars Algolia API discovery - FOUND! Typesense API bypasses Cloudflare!

### P0 - Still Blocking
- [x] OpenAI quota exhausted - MITIGATION BUILT: Local Ollama fallback extractor
- [ ] Firecrawl credits exhausted (blocking Cloudflare sites)

### P1 - In Progress (Agents Running)
- [x] Collecting Cars discovery via Typesense API - 121 queued!
- [ ] Craigslist extractor - deployed, testing
- [ ] BaT extraction batch - processing queue
- [ ] 1957 Chrysler re-extraction - verifying fix

### P2 - Ready to Start
- [ ] Process 121 Collecting Cars queue items (NEW!)
- [ ] Process Craigslist queue (539 items)
- [ ] Hemmings processing (30 pending)

### P3 - Blocked
- [ ] Cars & Bids (Cloudflare)
- [ ] Classic.com (Cloudflare)
- [ ] Mecum (Cloudflare)
- [ ] Barrett-Jackson (Cloudflare)

## Session Log
| Agent | Working On | Files Touched | Started |
|-------|------------|---------------|---------|
| Data Corruption Audit | ✅ COMPLETE - Fixed 1,161 vehicles, 257 remaining inconsistencies | vehicles table | Feb 1 ~6:35pm |
| Mecum Regex Fix | ✅ COMPLETE - Fixed and deployed | extract-premium-auction | Feb 1 ~6:37pm |
| Barrett-Jackson Research | ✅ COMPLETE - Aggregator NOT viable (1.2% coverage) | .claude/ docs | Feb 1 ~6:38pm |
| Collecting Cars Revival | ✅ COMPLETE - Cannot revive (Cloudflare blocks) | COLLECTING_CARS_REVIVAL_STATUS.md | Feb 1 ~6:37pm |
| Collecting Cars Algolia | 🔄 RUNNING - Discovered Typesense API! 121 queued | collecting-cars-discovery function | Feb 1 ~6:40pm |
| Craigslist Builder | 🔄 RUNNING - Building extract-craigslist | extract-craigslist | Feb 1 ~6:38pm |
| BaT Extraction Batch | 🔄 RUNNING - Processing queue items | import_queue | Feb 1 ~6:35pm |
| Chrysler Re-extract | 🔄 RUNNING - Re-extracting corrupted vehicle | vehicles table | Feb 1 ~6:36pm |
| Ollama Fallback | ✅ COMPLETE - Built local Ollama extractor for quota fallback | extract-vehicle-data-ollama, ollama-extraction-worker.ts | Feb 1 ~7:07pm |

## How to Claim
1. Pick an unclaimed task from priority queue
2. Add yourself to Session Log table
3. Check the task box when done
