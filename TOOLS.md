# Nuke Tool Registry

**Read this before building anything.** Every common operation has an existing tool.
Building a duplicate wastes compute, creates data forks, and breaks pipeline tracking.

---

## How to Use This Document

1. Find your intent in the table below → use the listed function
2. If your intent isn't here → check `supabase/functions/` before writing new code
3. If you're writing to a DB field → query `pipeline_registry` to see who owns it:
   ```sql
   SELECT * FROM pipeline_registry WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';
   ```

---

## Vehicle Data Extraction

| Intent | Use This | Notes |
|--------|----------|-------|
| Extract any listing URL (unknown source) | `extract-vehicle-data-ai` | Handles generic AI extraction |
| Extract Bring a Trailer listing | `complete-bat-import` | Two-step: extract-bat-core + extract-auction-comments. |
| Extract Cars & Bids listing | `extract-cars-and-bids-core` | Handles C&B structure |
| Extract Hagerty Marketplace listing | `extract-hagerty-listing` | |
| Extract PCarMarket listing | `import-pcarmarket-listing` | |
| Extract Craigslist listing | `extract-craigslist` | |
| Extract eBay Motors listing | `extract-ebay-motors` | |
| Extract Facebook Marketplace listing | `extract-facebook-marketplace` or `fb-marketplace-orchestrator` | Use orchestrator for bulk. Supports `mode: "direct"` for agent-extracted data (skips Firecrawl). |
| Import Facebook Saved vehicles | MCP `import_facebook_saved` tool or `scripts/fb-saved-extractor.js` | Two-step: extract (returns browser JS) → submit (POSTs to ingest). Runs client-side in user's browser on facebook.com/saved. |
| Extract Bonhams auction | `extract-bonhams` | |
| Extract RM Sotheby's | `extract-rmsothebys` | |
| Extract Mecum | `extract-mecum` | |
| Extract Gooding & Co | `extract-gooding` | |
| Extract Barrett-Jackson | `extract-barrett-jackson` | |
| Extract Collecting Cars | `extract-collecting-cars-core` | |
| Extract Broad Arrow | `extract-broad-arrow` | |
| Extract ClassicCars.com listing | `import-classiccars-listing` | |
| Extract Hagerty bidding platform | `extract-hagerty-listing` | |
| Route a URL to the right extractor | `extract-vehicle-data-ai` | Use AI extractor directly; `smart-extraction-router` was deleted |
| Queue a URL for background extraction | `continuous-queue-processor` → `import_queue` | Insert to `import_queue`, worker picks it up |

---

## VIN Operations

| Intent | Use This | Notes |
|--------|----------|-------|
| Decode a VIN and update vehicle record | `decode-vin-and-update` | Calls NHTSA VPIC API, writes make/model/year/etc. |
| Decode VIN only (no DB write) | `api-v1-vin-lookup` | Returns decoded data |
| Batch decode VINs | `batch-vin-decode` | Processes multiple vehicles |
| Extract VIN from an image | `extract-vin-from-vehicle` | AI-powered OCR from photo |
| Find VIN conflicts | `vin-data-conflicts` table | Query directly |

---

## Vehicle Enrichment

| Intent | Use This | Notes |
|--------|----------|-------|
| Enrich a vehicle profile with AI | `enrich-vehicle-profile-ai` | General AI enrichment |
| Enrich factory specs (OEM data) | `enrich-factory-specs` | Writes OEM spec fields |
| Enrich MSRP | `enrich-msrp` | Writes `vehicles.msrp` |
| Batch enrich pending vehicles | `enrich-bulk` | Calls `enrich-vehicle-profile-ai` in bulk |
| Propagate YMM to related records | `batch-ymm-propagate` | Fixes missing year/make/model |
| Fix vehicle profile issues | `auto-fix-vehicle-profile` | Automated repair |

---

## Scoring & Valuation

| Intent | Use This | Writes To |
|--------|----------|-----------|
| Compute Nuke estimate (AI valuation) | `compute-vehicle-valuation` | `vehicles.nuke_estimate`, `vehicles.nuke_estimate_confidence` |
| Calculate performance/social scores | `calculate-vehicle-scores` | `vehicles.perf_*_score`, `vehicles.social_positioning_score`, `vehicles.investment_quality_score` |
| Assess market signals (deal/heat score) | `analyze-market-signals` | `vehicles.signal_score`, `vehicles.signal_reasons`, `vehicles.last_signal_assessed_at` |
| Calculate profile completeness | `calculate-profile-completeness` | `vehicles.completion_percentage`, `vehicles.data_quality_score` |
| Calculate quality scores | `calculate-vehicle-scores` or `calculate-profile-completeness` | `vehicles.quality_grade` |
| Get comps for a vehicle | `api-v1-comps` | Read-only — returns comparables |
| Get market trends | `api-v1-market-trends` | Read-only |
| Compute Auction Readiness Score | `compute_auction_readiness()` (SQL) | `auction_readiness.*` |
| Persist ARS + tier transitions | `persist_auction_readiness()` (SQL) | `auction_readiness`, `ars_tier_transitions` |
| Generate listing package | `generate-listing-package` | Read-only — returns submission bundle |
| MCP: Get ARS | `mcp-connector` → `get_auction_readiness` | Calls `persist_auction_readiness()` |
| MCP: Get coaching plan | `mcp-connector` → `get_coaching_plan` | Read-only from `auction_readiness` |
| MCP: Prepare listing | `mcp-connector` → `prepare_listing` | Read-only preview |

---

## Image Processing

| Intent | Use This | Notes |
|--------|----------|-------|
| Process pending vehicle images (AI analysis) | `photo-pipeline-orchestrator` | Sets `ai_processing_status` |
| Batch process all pending images | `process-all-images-cron` | Cron-driven, calls pipeline orchestrator |
| Classify image angle/perspective | `yono-classify` | YONO local model, writes `vehicle_images.angle` |
| Batch YONO classification | `yono-batch-process` | Bulk angle detection |
| Auto-sort photos into categories | `auto-sort-photos` | Uses `vehicle_images.organization_status` |
| Sync photos from iPhoto library | `scripts/iphoto-intake.mjs` | See MEMORY.md for usage |
| Sync photos from camera roll | `scripts/photo-sync.mjs` | Scans macOS Photos by date, filters vehicle photos via Apple ML labels, uploads and routes through image-intake |
| Upload image and trigger analysis | `image-intake` | Handles upload + queues processing |
| Backfill image angles | `backfill-image-angles` | Retroactively adds angle data |
| Identify vehicle from image | `identify-vehicle-from-image` | AI-powered vehicle recognition |
| Validate image is a vehicle | `validate-vehicle-image` | Screening step (GPT-4o, quota exhausted) |
| Check image matches assigned vehicle | `check-image-vehicle-match` | Claude Haiku vision — classifies as confirmed/mismatch/ambiguous/unrelated |
| Reprocess stale images | `trickle-backfill-images` | Slow drip backfill |

---

## Comments & Sentiment Analysis

| Intent | Use This | Notes |
|--------|----------|-------|
| Extract auction comments from BaT | `extract-auction-comments` | Scrapes BaT page, writes to `auction_comments` |
| Discover/analyze comment data with AI | `discover-comment-data` | Writes to `comment_discoveries` |
| Fast batch comment analysis | `analyze-comments-fast` | Batch version of discovery |
| Batch comment discovery | `batch-comment-discovery` | Parallel comment analysis |
| Update live sentiment | `update-live-sentiment` | Writes to `auction_sentiment_timeline` |

---

## Document Processing

| Intent | Use This | Notes |
|--------|----------|-------|
| OCR a vehicle document | `document-ocr-worker` | Reads from `document_ocr_queue` |
| Queue a document for OCR | Insert to `document_ocr_queue` | Worker picks up automatically |
| Extract title/registration data | `extract-title-data` | Writes to `vehicle_title_documents` |
| Parse reference documentation | `parse-reference-document` | Service manuals, specs |
| Detect sensitive content in document | `detect-sensitive-document` | PII screening |

---

## Agent Hierarchy (Haiku/Sonnet/Opus)

| Intent | Use This | Notes |
|--------|----------|-------|
| Run full extraction pipeline (Haiku+Sonnet) | `agent-tier-router` with `{"action":"run_pipeline","pipeline_config":{"haiku_batch_size":10,"max_cycles":1}}` | Dispatches Haiku workers, Sonnet reviews |
| Route a task to the right tier | `agent-tier-router` with `{"action":"route_task","task_type":"...","task_data":{}}` | Auto-classifies complexity |
| Get agent system status | `agent-tier-router` with `{"action":"status"}` | Queue counts, tier health, cost estimates |
| Get cost report | `agent-tier-router` with `{"action":"cost_report"}` | Cost breakdown by tier, savings vs Sonnet-only |
| Run Opus strategy query | `agent-tier-router` with `{"action":"strategy","strategy_query":"..."}` | Source prioritization, market intel |
| Extract listing with Haiku (cheap) | `haiku-extraction-worker` with `{"action":"extract_listing","url":"...","html":"..."}` | 3x cheaper than Sonnet |
| Parse title with Haiku | `haiku-extraction-worker` with `{"action":"parse_title","title":"..."}` | Fast YMM extraction |
| Batch parse titles | `haiku-extraction-worker` with `{"action":"parse_titles","titles":["..."]}` | Single API call for many titles |
| Process queue batch with Haiku | `haiku-extraction-worker` with `{"action":"batch_extract","batch_size":10}` | Pulls from import_queue |
| Supervisor review batch | `sonnet-supervisor` with `{"action":"review_batch","batch_size":10}` | Reviews Haiku escalations |
| Supervisor dispatch + review | `sonnet-supervisor` with `{"action":"dispatch_haiku"}` | Full loop: dispatch Haiku then review |
| Resolve edge case | `sonnet-supervisor` with `{"action":"resolve_edge_case","content":"..."}` | Complex vehicles (replicas, restomods) |
| Quality report | `sonnet-supervisor` with `{"action":"quality_report"}` | Extraction quality metrics |

### Tier Routing Rules
- **Haiku** ($1/$5 per MTok): Routine extraction, title parsing, field extraction, simple classification
- **Sonnet** ($3/$15 per MTok): Quality review, edge cases, multi-field validation, escalation decisions
- **Opus** ($5/$25 per MTok): Source prioritization, market intelligence, pipeline optimization strategy

---

## Analysis Engine

| Intent | Use This | Notes |
|--------|----------|-------|
| Get analysis status | `analysis-engine-coordinator` with `{"action": "status"}` | Widget counts, signal counts, queue health |
| Evaluate all widgets for a vehicle | `analysis-engine-coordinator` with `{"action": "evaluate_vehicle", "vehicle_id": "..."}` | Runs all configured widgets, upserts signals |
| Run cron sweep (stale/new vehicles) | `analysis-engine-coordinator` with `{"action": "sweep", "batch_size": 20}` | Finds stale signals, queues recomputation |
| Process analysis queue | `analysis-engine-coordinator` with `{"action": "compute", "batch_size": 20}` | Claims and processes queue items |
| Trigger from observation | `analysis-engine-coordinator` with `{"action": "observation_trigger", "vehicle_id": "...", "observation_kind": "..."}` | Queues relevant widgets |
| Get analysis dashboard | `analysis-engine-coordinator` with `{"action": "dashboard", "vehicle_id": "..."}` | All signals by severity |
| Acknowledge signal | `analysis-engine-coordinator` with `{"action": "acknowledge", "signal_id": "..."}` | Mark as seen |
| Dismiss/snooze signal | `analysis-engine-coordinator` with `{"action": "dismiss", "signal_id": "...", "dismiss_hours": 72}` | Hide for N hours |
| Sell-through cliff analysis | `widget-sell-through-cliff` with `{"vehicle_id": "..."}` | DOM-based sell-through probability |
| Rerun decay analysis | `widget-rerun-decay` with `{"vehicle_id": "..."}` | Multi-listing price decay tracking |
| Deal health composite | `widget-time-kills-deals` with `{"vehicle_id": "..."}` | Master aggregator of 7 sub-signals |
| Completion discount | `widget-completion-discount` with `{"vehicle_id": "..."}` | Deficiency detection + buyer discount calc |
| Presentation ROI | `widget-presentation-roi` with `{"vehicle_id": "..."}` | Photo/description quality scoring |
| Broker exposure | `widget-broker-exposure` with `{"vehicle_id": "..."}` | Multi-platform exclusivity erosion |
| Buyer qualification | `widget-buyer-qualification` with `{"vehicle_id": "..."}` | Buyer readiness scoring via deal jacket |
| Commission optimizer | `widget-commission-optimizer` with `{"vehicle_id": "..."}` | Commission structure + margin analysis |
| Deal readiness | `widget-deal-readiness` with `{"vehicle_id": "..."}` | Checklist-based deal closing readiness |
| Geographic arbitrage | `widget-geographic-arbitrage` with `{"vehicle_id": "..."}` | Regional price differential analysis |
| **SDK/API: Get all signals** | `api-v1-analysis` GET `?vehicle_id=<uuid>` | Auth required. Returns health + all signals |
| **SDK/API: Get single signal** | `api-v1-analysis` GET `?vehicle_id=<uuid>&widget=<slug>` | Single widget signal |
| **SDK/API: Refresh signals** | `api-v1-analysis` POST `{"action":"refresh","vehicle_id":"..."}` | Triggers recompute |
| **SDK/API: Signal history** | `api-v1-analysis/history` GET `?vehicle_id=<uuid>&widget=<slug>` | Change history |

### Analysis Engine Tables
- `analysis_widgets` — Widget registry (14 widgets, 6 categories)
- `analysis_signals` — Per-vehicle widget outputs (UNIQUE vehicle_id + widget_slug)
- `analysis_signal_history` — Audit trail of changes
- `analysis_queue` — Processing queue (same lock pattern as import_queue)

### Cron: Job 368 — `analysis-engine-sweep` every 15 minutes

---

### import_queue Status Flow
```
pending → [haiku-extraction-worker] → complete (auto-approved, quality >= 0.9)
                                    → pending_review (needs supervisor, quality 0.6-0.9)
                                    → pending_review (escalated, no content or low confidence)
pending_review → [sonnet-supervisor] → complete (approved or corrected)
                                     → pending_strategy (escalated to Opus)
                                     → failed (rejected)
```

---

## Queue Management

| Intent | Use This | Notes |
|--------|----------|-------|
| Check overall pipeline health | `ralph-wiggum-rlm-extraction-coordinator` with `{"action":"brief"}` | Returns queue stats, errors, recommendations |
| Check queue status | `queue-status` | `import_queue` breakdown |
| View pipeline dashboard | `pipeline-dashboard` | Full system overview |
| Check database stats | `db-stats` | Vehicle/image/queue counts |
| Release stale locked records | `SELECT release_stale_locks()` | SQL function — releases locks older than 30 min |
| Check system health | `system-health-monitor` | |
| Monitor extraction health | `extraction-watchdog` | Alerts on failures |
| **Data quality report (all sources)** | `data-quality-monitor` with `{"action":"report"}` | Per-source YMM%, VIN%, price%, grade A-F |
| **Data quality alerts only** | `data-quality-monitor` with `{"action":"alerts"}` | Only sources with issues |
| **Snapshot quality metrics to DB** | `data-quality-monitor` with `{"action":"snapshot"}` | Writes to source_quality_snapshots (cron runs at 2am UTC) |
| **Query live quality view** | `SELECT * FROM source_quality_current` | Live per-source stats (slow on full table) |
| Process queued imports | `continuous-queue-processor` | **Don't call directly** — runs on cron |

---

## BaT-Specific Operations

| Intent | Use This | Notes |
|--------|----------|-------|
| Queue BaT listings for extraction | `crawl-bat-active` | Discovers active auctions |
| Process BaT extraction queue | `process-bat-extraction-queue` | Works `bat_extraction_queue` |
| Monitor a BaT seller | `bat-seller-monitors` table | Insert record to start monitoring |
| Monitor a BaT buyer | `bat-buyer-monitors` table | Insert record to start monitoring |
| Parse BaT snapshot HTML | `bat-snapshot-parser` | Parses archived BaT pages |
| Extract a BaT listing (entry point) | `complete-bat-import` | Calls extract-bat-core + extract-auction-comments in sequence |

---

## Organizations

| Intent | Use This | Notes |
|--------|----------|-------|
| Create org from URL | `create-org-from-url` | Scrapes site, creates `organizations` record |
| Update org from website | `update-org-from-website` | Refreshes org data |
| Classify organization type | `classify-organization-type` | Sets `organizations.type` |
| Get org due diligence | `generate-org-due-diligence` | AI analysis report |
| Merge duplicate orgs | `auto-merge-duplicate-orgs` | Deduplication |

---

## Discovery & Lead Generation

| Intent | Use This | Notes |
|--------|----------|-------|
| Discover vehicles from a source URL | `discover-from-observations` | Source-agnostic |
| Discover squarebody Craigslist listings | `discover-cl-squarebodies` | Regional CL scanner |
| Discover barn finds | `barn-finds-discovery` | Monitors barn find sources |
| Discover build threads | `discover-build-threads` | Forum build thread finder |
| Recursive lead discovery | `discovery-snowball` | Follows discovery chains |

---

## Search & Lookup

| Intent | Use This | Notes |
|--------|----------|-------|
| Search vehicles, orgs, users, tags | `universal-search` | Magic input handler with thumbnails |
| API vehicle search | `api-v1-search` | REST API endpoint |
| Get vehicle history | `api-v1-vehicle-history` | Historical data |
| Get auction data | `api-v1-vehicle-auction` | Auction-specific fields |
| Get observations for a vehicle | `api-v1-observations` | All source observations |

---

## YONO (Local Vision Model)

| Intent | Use This | Notes |
|--------|----------|-------|
| Full image intelligence (make + condition + zone + damage) | `api-v1-vision/analyze` | POST `{image_url}` → make, condition_score, vehicle_zone, damage_flags, $0/image |
| Classify make from image | `api-v1-vision/classify` or `yono-classify` | Hierarchical: tier1 family, tier2 make. $0/image |
| Analyze condition/zone/damage | `yono-analyze` | Florence-2 vision analysis. Writes to vehicle_images if image_id provided |
| Batch classify images | `api-v1-vision/batch` or `yono-batch-process` | Bulk version, max 100 images |
| Background vision processing | `yono-vision-worker` | Cron worker, claims batches, writes to vehicle_images |
| Keep sidecar warm | `yono-keepalive` | Pings Modal every 5 min (cron job 249) |
| Export training data | `export-training-batch` | Prepares training dataset |
| Sidecar URL | `YONO_SIDECAR_URL` env var | Default: `https://sss97133--yono-serve-fastapi-app.modal.run` |

### Modal GPU Jobs (yono/)

| Intent | Tool | Notes |
|--------|------|-------|
| Batch extract descriptions (235K backlog) | `modal run yono/modal_description_discovery.py` | Qwen2.5-7B 4-bit on T4, 4 containers, writes `description_discoveries` with `model_used='qwen2.5:7b-modal'` |
| GLiNER NER extraction | `modal run yono/modal_extract.py` | GLiNER medium-v2.1, writes `vehicle_observations` |
| LLM inference server | `modal deploy yono/modal_vllm_serve.py` | Qwen2.5-7B HTTP API, used by `--provider modal` |
| YONO vision batch | `modal run yono/modal_batch.py` | Florence-2 + classifiers, writes `vehicle_images` |
| YONO classification API | `modal deploy yono/modal_serve.py` | REST API for image classification |

---

## DO NOT BUILD THESE — They Already Exist

These are the most common "agent reimplementation" antipatterns. If you find yourself writing any of these, stop and use the existing tool.

| What you're about to build | What to use instead |
|---------------------------|---------------------|
| A VIN decoder | `decode-vin-and-update` |
| A fetch wrapper that saves pages | `_shared/archiveFetch.ts` — use `archiveFetch()` |
| An image AI analyzer | `photo-pipeline-orchestrator` |
| A queue poller | `continuous-queue-processor` — insert to queue, don't poll |
| A "get vehicle data" endpoint | `api-v1-vehicles` |
| A duplicate detector | `duplicate-detection-jobs` table + `auto-merge-duplicate-orgs` |
| A vehicle valuation calculator | `compute-vehicle-valuation` |
| A comment sentiment analyzer | `discover-comment-data` |
| A search endpoint | `universal-search` |
| A BaT scraper | `complete-bat-import` |
| A Craigslist scraper | `extract-craigslist` or `discover-cl-squarebodies` |
| A Facebook scraper | `extract-facebook-marketplace` |
| A market trend calculator | `calculate-market-trends` |

---

## Key Shared Utilities (`supabase/functions/_shared/`)

Always import from these rather than reimplementing:

| File | Purpose |
|------|---------|
| `archiveFetch.ts` | Fetch any URL + auto-archive to `listing_page_snapshots` |
| `cors.ts` | CORS headers |
| `supabaseClient.ts` | Supabase client factory |
| `hybridFetcher.ts` | **Deprecated** — use `archiveFetch.ts` instead |

---

## Pipeline Ownership Quick Reference

Query the `pipeline_registry` table for authoritative field ownership:

```sql
-- Who owns a field?
SELECT owned_by, description, do_not_write_directly
FROM pipeline_registry
WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';

-- What does a function write?
SELECT table_name, column_name, description
FROM pipeline_registry
WHERE owned_by = 'compute-vehicle-valuation';

-- All fields agents should not write directly
SELECT table_name, column_name, owned_by
FROM pipeline_registry
WHERE do_not_write_directly = true
ORDER BY table_name, column_name;
```

---

## Queue Insert Patterns

### Add a URL to the extraction queue
```sql
INSERT INTO import_queue (listing_url, listing_title, status, priority)
VALUES ('https://bringatrailer.com/listing/...', 'Optional Title', 'pending', 100);
```

### Add a document for OCR
```sql
INSERT INTO document_ocr_queue (storage_path, status, priority, document_type)
VALUES ('vehicle-docs/abc123.pdf', 'pending', 50, 'title');
```

### Check queue depth
```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c \
  'curl -s "$VITE_SUPABASE_URL/functions/v1/queue-status" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

---

## Operational Notes

- **Never write `ai_processing_status`, `signal_score`, `nuke_estimate`, `deal_score`, or `heat_score` directly.** These are computed fields owned by specific pipeline functions.
- **Never change `locked_by` / `locked_at` on queue tables.** The lock mechanism is managed by queue workers; breaking it causes duplicate processing.
- **Check `ACTIVE_AGENTS.md`** before touching any edge function file — another agent may be mid-deployment.
- **Always use `archiveFetch()`** for fetching external URLs — never raw `fetch()`.
