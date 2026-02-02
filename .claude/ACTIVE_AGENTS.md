# Active Agents Coordination

Last updated: 2026-02-01 ~5pm PST

## Priority Queue (Claim One)

### P0 - Unblock Extraction
- [ ] Fix OpenAI quota (blocking coordinator + AI extractors)
- [ ] Run `process-import-queue` batches (82k BaT pending)

### P1 - Dormant Extractors (have code, need discovery crawls)
- [ ] Cars & Bids discovery crawl
- [ ] PCarMarket discovery crawl  
- [ ] Classic.com - process 266 pending

### P2 - Build New Crawlers
- [ ] Mecum crawler
- [ ] Collecting Cars crawler
- [ ] Barrett-Jackson crawler
- [ ] Hemmings crawler

### P3 - Enrichment
- [ ] Hagerty valuation catalog sync + vehicle matching

### P4 - Resume Dealers
- [ ] Beverly Hills Car Club, L'Art de l'Automobile, etc (400 sources)

## Session Log
| Agent | Working On | Files Touched | Started |
|-------|------------|---------------|---------|
| Sonnet worker | Processing BaT import_queue (20 items) | import_queue table | Feb 1 ~6pm |
| Extraction Worker 2 | Processing BaT import_queue (20 items batch 2) | import_queue table | Feb 1 ~6:01pm |
| FB Marketplace Validator | Testing FB Marketplace extractors | extract-facebook-marketplace, report-marketplace-sale | Feb 1 ~6:05pm |
| Scanner Validator | ✅ COMPLETE - Scanner tested & validated | tools/nuke-scanner/* (VALIDATION_REPORT.md, test-data/*) | Feb 1 ~6:10pm |
| SDK Agent | ✅ COMPLETE - Nuke SDK review & fixes | tools/nuke-sdk/* (package.json, batch.ts, SDK_REVIEW.md) | Feb 1 ~6:10pm |
| API v1 Deployer | ✅ COMPLETE - API v1 deployed, schema issues documented | api-v1-*, api_keys table, API_V1_DEPLOYMENT_STATUS.md | Feb 1 ~6:12pm |
| Marketplace UI Reviewer | Reviewing marketplace components, build status OK | nuke_frontend/src/components/marketplace/* | Feb 1 ~6:15pm |

## How to Claim
1. Pick an unclaimed task from priority queue
2. Add yourself to Session Log table
3. Check the task box when done
