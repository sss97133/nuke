# NUKE INDEX

Maps concepts to their locations in the codebase, database, and documentation.

Updated: 2026-03-27

---

## By Concept

### Intake / Ingestion
- **Function**: `supabase/functions/process-import-queue/index.ts` (legacy router)
- **Function**: `supabase/functions/ingest-observation/index.ts` (unified -- target state)
- **Table**: `import_queue` (legacy)
- **Table**: `vehicle_observations` (unified)
- **Principle**: ENCYCLOPEDIA Section 19 (One Intake, One Gesture)
- **Principle**: CLAUDE.md -> ARCHIVE FETCH PRINCIPLE
- **Shared util**: `supabase/functions/_shared/archiveFetch.ts`

### Extraction (Source-Specific)
- **BaT**: `supabase/functions/extract-bat-core/index.ts`
- **BaT comments**: `supabase/functions/extract-auction-comments/index.ts`
- **BaT complete import**: `supabase/functions/complete-bat-import/index.ts` (entry point: extract-bat-core + comments)
- **BaT snapshot parser**: `supabase/functions/bat-snapshot-parser/index.ts` (parses archived BaT HTML)
- **BaT URL discovery**: `supabase/functions/bat-url-discovery/index.ts` (finds new BaT listings)
- **BaT extraction queue**: `supabase/functions/process-bat-extraction-queue/index.ts`
- **BaT price propagation**: `supabase/functions/bat-price-propagation/index.ts`
- **Cars & Bids**: `supabase/functions/extract-cars-and-bids-core/index.ts`
- **PCarMarket**: `supabase/functions/import-pcarmarket-listing/index.ts`
- **Hagerty**: `supabase/functions/extract-hagerty-listing/index.ts`
- **Craigslist**: `supabase/functions/extract-craigslist/index.ts`
- **eBay Motors**: `supabase/functions/extract-ebay-motors/index.ts`
- **Facebook Marketplace**: `supabase/functions/extract-facebook-marketplace/index.ts`
- **Facebook orchestrator**: `supabase/functions/fb-marketplace-orchestrator/index.ts`
- **Facebook import**: `supabase/functions/import-fb-marketplace/index.ts`
- **Facebook refine**: `supabase/functions/refine-fb-listing/index.ts`
- **Facebook monitor**: `supabase/functions/monitor-fb-marketplace/index.ts`
- **Bonhams**: `supabase/functions/extract-bonhams/index.ts`
- **Bonhams Typesense**: `supabase/functions/extract-bonhams-typesense/index.ts`
- **RM Sotheby's**: `supabase/functions/extract-rmsothebys/index.ts`
- **Mecum**: `supabase/functions/extract-mecum/index.ts`
- **Gooding & Co**: `supabase/functions/extract-gooding/index.ts`
- **Barrett-Jackson**: `supabase/functions/extract-barrett-jackson/index.ts`
- **Broad Arrow**: `supabase/functions/extract-broad-arrow/index.ts`
- **ClassicCars.com**: `supabase/functions/import-classiccars-listing/index.ts`
- **JamesEdition**: `supabase/functions/extract-jamesedition/index.ts`
- **Collecting Cars**: `supabase/functions/collecting-cars-discovery/index.ts`
- **Premium auction (generic)**: `supabase/functions/extract-premium-auction/index.ts` (C&B + Mecum via cron)
- **Generic AI**: `supabase/functions/extract-vehicle-data-ai/index.ts`
- **Snapshot batch**: `supabase/functions/batch-extract-snapshots/index.ts` (re-extracts from archived HTML)
- **Principle**: CLAUDE.md -> SCHEMA DISCOVERY PRINCIPLE
- **Policy**: `docs/EXTRACTION_POLICY.md`
- **Targets**: `docs/EXTRACTION_TARGETS.md`
- **Handbook**: `docs/library/technical/extraction-playbook.md` (2,998 lines, 14 chapters)

### Extraction (Agent Hierarchy)
- **Tier router**: `supabase/functions/agent-tier-router/index.ts` (dispatches Haiku/Sonnet/Opus)
- **Haiku worker**: `supabase/functions/haiku-extraction-worker/index.ts` ($1/$5 MTok, routine extraction)
- **Sonnet supervisor**: `supabase/functions/sonnet-supervisor/index.ts` (quality review, edge cases)
- **Agent tiers shared**: `supabase/functions/_shared/agentTiers.ts`
- **Review submissions**: `supabase/functions/review-agent-submissions/index.ts`
- **Queue flow**: `pending -> haiku -> complete/pending_review -> sonnet -> complete/pending_strategy`

### Entity Resolution / Matching
- **Current**: Per-extractor matching (in each extract-* function)
- **Target**: Universal matcher (ENCYCLOPEDIA Section 18)
- **Dedup function**: `supabase/functions/dedup-vehicles/index.ts`
- **Merge migration**: `supabase/migrations/20260227040642_merge_duplicate_vehicles.sql`
- **Rules doc**: `docs/architecture/ENTITY_RESOLUTION_RULES.md`
- **Known issue**: Y/M/M fuzzy match at 60% confidence causes data corruption

### Observation System
- **Ingest function**: `supabase/functions/ingest-observation/index.ts`
- **Discovery function**: `supabase/functions/discover-from-observations/index.ts`
- **Migration function**: `supabase/functions/migrate-to-observations/index.ts`
- **Tables**: `observation_sources`, `vehicle_observations`, `observation_extractors`, `observation_discoveries`
- **Description discovery**: `supabase/functions/discover-description-data/index.ts`
- **Schematic**: `docs/library/technical/schematics/observation-system.md`
- **Analysis**: RHIZOME.md ("Observation is the Body without Organs")
- **Status**: Built but not fully adopted. Extractors partially bypass it.

### Provenance
- **Current state**: Vehicle provenance is implicit (in descriptions, comments, auction records)
- **Target state**: Explicit `provenance_entries` table (ENCYCLOPEDIA Section 4)
- **Evidence table**: `field_evidence` (107,887 rows linking data to sources)
- **Related**: `certificates_of_authenticity`, `conservation_history` (ENCYCLOPEDIA Section 4)

### Valuation / Nuke Estimate
- **Column**: `vehicles.nuke_estimate`
- **Compute**: `supabase/functions/compute-vehicle-valuation/index.ts`
- **Hammer price**: `supabase/functions/predict-hammer-price/index.ts` (active cron)
- **Score live**: `supabase/functions/score-live-auctions/index.ts` (active cron)
- **Comps API**: `supabase/functions/api-v1-comps/index.ts`
- **Market trends**: `supabase/functions/api-v1-market-trends/index.ts`
- **Analysis**: JEWELS.md entry 5 (45 mentions, 5 months, never dropped)

### Analysis Engine
- **Coordinator**: `supabase/functions/analysis-engine-coordinator/index.ts` (active cron, 15 min sweep)
- **Widgets** (10):
  - `supabase/functions/widget-sell-through-cliff/index.ts`
  - `supabase/functions/widget-rerun-decay/index.ts`
  - `supabase/functions/widget-time-kills-deals/index.ts`
  - `supabase/functions/widget-completion-discount/index.ts`
  - `supabase/functions/widget-presentation-roi/index.ts`
  - `supabase/functions/widget-broker-exposure/index.ts`
  - `supabase/functions/widget-buyer-qualification/index.ts`
  - `supabase/functions/widget-commission-optimizer/index.ts`
  - `supabase/functions/widget-deal-readiness/index.ts`
  - `supabase/functions/widget-geographic-arbitrage/index.ts`
- **Tables**: `analysis_widgets`, `analysis_signals`, `analysis_signal_history`, `analysis_queue`
- **API**: `supabase/functions/api-v1-analysis/index.ts`

### Enrichment
- **Bulk enrichment**: `supabase/functions/enrich-bulk/index.ts` (active cron)
- **Vehicle enrichment cron**: `supabase/functions/enrich-vehicles-cron/index.ts` (active cron)
- **Factory specs**: `supabase/functions/enrich-factory-specs/index.ts`
- **MSRP**: `supabase/functions/enrich-msrp/index.ts`
- **Profile AI**: `supabase/functions/enrich-vehicle-profile-ai/index.ts`
- **Auto fix**: `supabase/functions/auto-fix-vehicle-profile/index.ts`
- **YMM propagate**: `supabase/functions/batch-ymm-propagate/index.ts` (active cron)
- **VIN decode**: `supabase/functions/batch-vin-decode/index.ts` (active cron)
- **VIN from snapshots**: `supabase/functions/backfill-vin-from-snapshots/index.ts` (active cron)
- **Profile queue**: `supabase/functions/process-profile-queue/index.ts` (active cron)

### Description Backfill
- **CL asking price**: `supabase/functions/backfill-cl-asking-price/index.ts` (active cron)
- **CL descriptions**: `supabase/functions/backfill-cl-descriptions/index.ts` (active cron)
- **Gooding descriptions**: `supabase/functions/backfill-gooding-descriptions/index.ts` (active cron)
- **Mecum descriptions**: `supabase/functions/backfill-mecum-descriptions/index.ts` (active cron)
- **RM Sotheby's descriptions**: `supabase/functions/backfill-rmsothebys-descriptions/index.ts` (active cron)
- **Comments backfill**: `supabase/functions/backfill-comments/index.ts` (active cron)

### Scoring & Quality
- **Vehicle scores**: `supabase/functions/calculate-vehicle-scores/index.ts`
- **Profile completeness**: `supabase/functions/calculate-profile-completeness/index.ts`
- **Data quality snapshot**: `supabase/functions/compute-data-quality-snapshot/index.ts` (active cron)
- **Quality scores backfill**: `supabase/functions/backfill-quality-scores/index.ts`

### Design System
- **Design Bible**: `docs/DESIGN_BIBLE.md` (three laws, visual identity, voice)
- **Design Book**: `docs/library/technical/design-book/` (10 chapters, component specs, interaction model)
- **Canonical CSS**: `nuke_frontend/src/styles/unified-design-system.css`
- **Frozen CSS**: `nuke_frontend/src/styles/design-system.css` (do not modify)
- **Principles**: ENCYCLOPEDIA Sections 9-11

### Frontend Components (Badge Portal System)
- **BadgePortal**: `nuke_frontend/src/components/badges/BadgePortal.tsx` -- the atomic unit
- **BadgeClusterPanel**: `nuke_frontend/src/components/badges/BadgeClusterPanel.tsx` -- expand panel
- **useBadgeDepth**: `nuke_frontend/src/components/badges/useBadgeDepth.ts` -- lazy depth fetch
- **DetailPanel**: `nuke_frontend/src/components/panels/DetailPanel.tsx` -- slide-in overlay
- **CardShell**: `nuke_frontend/src/feed/components/card/CardShell.tsx` -- click-to-expand cards
- **VehicleCard**: `nuke_frontend/src/feed/components/VehicleCard.tsx` -- composable card
- **ResilientImage**: `nuke_frontend/src/components/images/ResilientImage.tsx` -- fallback chain
- **CardDealScore**: `nuke_frontend/src/feed/components/card/CardDealScore.tsx` -- deal/heat badges
- **CardSource**: `nuke_frontend/src/feed/components/card/CardSource.tsx` -- source favicon stamp
- **FeedLayout**: `nuke_frontend/src/feed/components/FeedLayout.tsx` -- virtualized grid/list/table
- **FeedStatsStrip**: `nuke_frontend/src/feed/components/FeedStatsStrip.tsx` -- stats bar
- **FeedEmptyState**: `nuke_frontend/src/feed/components/FeedEmptyState.tsx` -- zero-results
- **PopupStack**: `nuke_frontend/src/components/popups/PopupStack.tsx` -- layered popup system
- **PopupContainer**: `nuke_frontend/src/components/popups/PopupContainer.tsx` -- popup wrapper
- **Spec**: Design Book Chapter 2 (Components), Chapter 3 (Interactions)

### Image Pipeline / YONO
- **Vehicle images table**: `vehicle_images`
- **YONO classify**: `supabase/functions/yono-classify/index.ts` (make classification, $0/image)
- **YONO analyze**: `supabase/functions/yono-analyze/index.ts` (condition/zone/damage via Florence-2)
- **YONO batch**: `supabase/functions/yono-batch-process/index.ts` (bulk classification)
- **YONO vision worker**: `supabase/functions/yono-vision-worker/index.ts` (background cron worker)
- **YONO keepalive**: `supabase/functions/yono-keepalive/index.ts` (pings Modal sidecar every 5 min)
- **Vision API**: `supabase/functions/api-v1-vision/index.ts` (public API: classify + analyze)
- **Image intake**: `supabase/functions/image-intake/index.ts` (upload + queue processing)
- **Photo pipeline**: `supabase/functions/photo-pipeline-orchestrator/index.ts`
- **iPhoto intake**: `scripts/iphoto-intake.mjs`
- **Work photos**: `scripts/drop-folder-ingest.mjs`, `scripts/work-photos-intake.mjs`
- **Modal sidecar URL**: `YONO_SIDECAR_URL` env var
- **Spec**: `docs/YONO_SPEC.md`, `docs/YONO_TRAINING_DATA.md`
- **Status**: Sidecar live on Modal (2 warm containers). Pipeline globally PAUSED (`NUKE_ANALYSIS_PAUSED`).

### Comments & Sentiment
- **Extract comments**: `supabase/functions/extract-auction-comments/index.ts`
- **Comment discovery**: `supabase/functions/discover-comment-data/index.ts`
- **Fast analysis**: `supabase/functions/analyze-comments-fast/index.ts`
- **Batch discovery**: `supabase/functions/batch-comment-discovery/index.ts`
- **Live sentiment**: `supabase/functions/update-live-sentiment/index.ts`
- **Tables**: `auction_comments`, `comment_discoveries`, `auction_sentiment_timeline`

### Document Processing
- **OCR worker**: `supabase/functions/document-ocr-worker/index.ts` (active cron)
- **Title data**: `supabase/functions/extract-title-data/index.ts`
- **Reference docs**: `supabase/functions/parse-reference-document/index.ts`
- **Sensitive detection**: `supabase/functions/detect-sensitive-document/index.ts`
- **Queue table**: `document_ocr_queue`

### Discovery / Lead Generation
- **Observations discovery**: `supabase/functions/discover-from-observations/index.ts` (active cron)
- **Craigslist squarebodies**: `supabase/functions/discover-cl-squarebodies/index.ts`
- **Barn finds**: `supabase/functions/barn-finds-discovery/index.ts`
- **Build threads**: `supabase/functions/discover-build-threads/index.ts`
- **Snowball**: `supabase/functions/discovery-snowball/index.ts`
- **Listing feeds**: `supabase/functions/poll-listing-feeds/index.ts` (active cron)
- **Patient zero**: `supabase/functions/patient-zero/index.ts` (active cron)
- **Source onboarding**: `supabase/functions/onboard-source/index.ts` (active cron)

### Organizations
- **Create from URL**: `supabase/functions/create-org-from-url/index.ts`
- **Update from website**: `supabase/functions/update-org-from-website/index.ts`
- **Classify type**: `supabase/functions/classify-organization-type/index.ts`
- **Due diligence**: `supabase/functions/generate-org-due-diligence/index.ts`
- **Merge dupes**: `supabase/functions/auto-merge-duplicate-orgs/index.ts`
- **Seller stats**: `supabase/functions/compute-org-seller-stats/index.ts` (active cron)
- **Classic seller queue**: `supabase/functions/process-classic-seller-queue/index.ts` (active cron)
- **Table**: `organizations`

### Work Order Intelligence
- **RPC**: `resolve_work_order_status(p_query)` -- one call, full answer
- **Balance RPC**: `work_order_balance(p_work_order_id)`
- **View**: `work_order_receipt_unified` (bridges timeline_events and work_orders)
- **Zelle ingest**: `npm run wo:ingest-zelle -- --vehicle <id>`
- **Receipt seed**: `npm run wo:ingest-receipts -- --seed`
- **iMessage ingest**: `npm run wo:ingest-thread -- "+1XXXXXXXXXX" --vehicle <id>`
- **Labor estimate**: `estimate_labor_from_description(text, year)` (64 operations)
- **Rate resolve**: `resolve_labor_rate(org, user, vehicle, client)`
- **Doc**: `docs/library/technical/work-order-intelligence.md`

### Search & API
- **Universal search**: `supabase/functions/universal-search/index.ts`
- **API search**: `supabase/functions/api-v1-search/index.ts`
- **API vehicles**: `supabase/functions/api-v1-vehicles/index.ts`
- **API vehicle history**: `supabase/functions/api-v1-vehicle-history/index.ts`
- **API vehicle auction**: `supabase/functions/api-v1-vehicle-auction/index.ts`
- **API observations**: `supabase/functions/api-v1-observations/index.ts`
- **API VIN lookup**: `supabase/functions/api-v1-vin-lookup/index.ts`
- **Feed query**: `supabase/functions/feed-query/index.ts`
- **Treemap data**: `supabase/functions/treemap-data/index.ts`

### Operations / Monitoring
- **Coordinator brief**: `supabase/functions/ralph-wiggum-rlm-extraction-coordinator/index.ts`
- **DB stats**: `supabase/functions/db-stats/index.ts`
- **Queue status**: `supabase/functions/queue-status/index.ts`
- **Pipeline dashboard**: `supabase/functions/pipeline-dashboard/index.ts`
- **System health**: `supabase/functions/system-health-monitor/index.ts`
- **Extraction watchdog**: `supabase/functions/extraction-watchdog/index.ts` (active cron)
- **Daily report**: `supabase/functions/daily-report/index.ts` (active cron)
- **Deal jacket pipeline**: `supabase/functions/deal-jacket-pipeline/index.ts` (active cron)
- **Vendor balances**: `supabase/functions/check-vendor-balances/index.ts` (active cron)
- **Gmail alert poller**: `supabase/functions/gmail-alert-poller/index.ts` (active cron)

### Snapshot / Storage Management
- **Migrate to storage**: `supabase/functions/migrate-snapshots-to-storage/index.ts` (active cron)
- **Table**: `listing_page_snapshots` (79GB)
- **Shared util**: `supabase/functions/_shared/archiveFetch.ts`

### Auction System
- **Sync live auctions**: `supabase/functions/sync-live-auctions/index.ts` (active cron)
- **Score live auctions**: `supabase/functions/score-live-auctions/index.ts` (active cron)
- **Predict hammer price**: `supabase/functions/predict-hammer-price/index.ts` (active cron)
- **ARS SQL**: `compute_auction_readiness()`, `persist_auction_readiness()`
- **Tables**: `auction_readiness`, `ars_tier_transitions`
- **Strategy doc**: `auction-readiness-strategy.md`

### User / Persona Intelligence
- **Stylometric analyzer**: `scripts/user-stylometric-analyzer.mjs` (Layer 0, zero-cost)
- **Persona prompts**: `supabase/functions/_shared/personaPrompt.ts`
- **Tables**: `bat_user_profiles`, `author_personas`, `comment_persona_signals`
- **Methodology doc**: `docs/library/intellectual/papers/user-simulation-methodology.md`

### MCP Tools
- **Supabase**: `mcp__supabase__execute_sql`, `mcp__supabase__get_logs`, `mcp__supabase__apply_migration`
- **Firecrawl**: `mcp__firecrawl__scrape_url`, `mcp__firecrawl__crawl_url`
- **Playwright**: `mcp__playwright__navigate`, `mcp__playwright__click`
- **MCP connector**: `supabase/functions/mcp-connector/index.ts` (ARS, coaching, listing prep)

---

## By Edge Function (Active -- Cron-Driven)

These 50 functions run on automated cron schedules and constitute the system's autonomous processing backbone.

### Extraction Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `extract-premium-auction` | Every hour | C&B and Mecum listing discovery |
| `extract-barrett-jackson` | Every 2 hours | Barrett-Jackson listing extraction |
| `extract-bonhams-typesense` | Every 2 hours | Bonhams Typesense bypass extraction |
| `extract-broad-arrow` | Every 2 hours | Broad Arrow auction extraction |
| `extract-gooding` | Every 2 hours | Gooding & Co extraction |
| `extract-jamesedition` | Every 2 hours | JamesEdition luxury extraction |
| `extract-mecum` | Every 2 hours | Mecum auction extraction |
| `extract-rmsothebys` | Every 2 hours | RM Sotheby's extraction |
| `collecting-cars-discovery` | Every 2 hours | Collecting Cars discovery |
| `bat-url-discovery` | Every 2 hours | BaT new listing discovery |
| `bat-snapshot-parser` | Every 5 minutes | Parse archived BaT HTML |
| `process-bat-extraction-queue` | Every 5 minutes | Drain BaT extraction queue |
| `batch-extract-snapshots` | Every 5 minutes | Re-extract from stored snapshots |
| `process-import-queue` | Every 5 minutes | Route URLs to extractors |

### Facebook Marketplace Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `import-fb-marketplace` | Every 2 hours | Import FB listings to import_queue |
| `monitor-fb-marketplace` | Every 6 hours | Check FB listing status changes |
| `refine-fb-listing` | Every 2 hours | Enrich FB listings via bingbot HTML |

### Enrichment Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `enrich-bulk` | Every 15 minutes | Batch AI enrichment |
| `enrich-vehicles-cron` | Every 10 minutes | Vehicle enrichment driver |
| `batch-vin-decode` | Every 10 minutes | NHTSA VIN decode batch |
| `batch-ymm-propagate` | Every 10 minutes | Fix missing year/make/model |
| `backfill-vin-from-snapshots` | Every 15 minutes | Extract VINs from archived HTML |
| `process-profile-queue` | Every 10 minutes | Profile enrichment queue |

### Description Backfill Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `backfill-cl-asking-price` | Every 30 minutes | Craigslist asking prices |
| `backfill-cl-descriptions` | Every 30 minutes | Craigslist descriptions |
| `backfill-gooding-descriptions` | Every hour | Gooding descriptions |
| `backfill-mecum-descriptions` | Every 30 minutes | Mecum descriptions |
| `backfill-rmsothebys-descriptions` | Every hour | RM Sotheby's descriptions |
| `backfill-comments` | Every 15 minutes | BaT comment extraction backfill |

### Analysis & Scoring Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `analysis-engine-coordinator` | Every 15 minutes | Widget sweep + compute |
| `compute-data-quality-snapshot` | Daily at 2am UTC | Source quality metrics |
| `predict-hammer-price` | Every hour | Price prediction refresh |
| `score-live-auctions` | Every 15 minutes | Live auction scoring |
| `bat-price-propagation` | Every 2 hours | Propagate BaT final prices |

### Discovery & Monitoring Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `discover-from-observations` | Every 15 minutes | Source-agnostic discovery |
| `discover-description-data` | Every 15 minutes | AI description analysis |
| `poll-listing-feeds` | Every 30 minutes | RSS/Atom feed polling |
| `patient-zero` | Every 6 hours | New source seeding |
| `onboard-source` | Every hour | Auto-onboard new sources |
| `extraction-watchdog` | Every 15 minutes | Alert on extraction failures |

### Operations Crons
| Function | Schedule | Purpose |
|----------|----------|---------|
| `daily-report` | Daily at 6am UTC | System health digest |
| `deal-jacket-pipeline` | Every 30 minutes | Deal jacket assembly |
| `check-vendor-balances` | Daily | Vendor balance monitoring |
| `gmail-alert-poller` | Every 5 minutes | Email alert processing |
| `compute-org-seller-stats` | Every 2 hours | Org seller statistics |
| `process-classic-seller-queue` | Every 10 minutes | Classic seller queue drain |
| `review-agent-submissions` | Every 15 minutes | Agent submission review |
| `migrate-snapshots-to-storage` | Every hour | Move snapshots to storage |
| `document-ocr-worker` | Every 10 minutes | OCR processing queue |
| `sync-live-auctions` | Every 5 minutes | Sync active auction data |

---

## By Edge Function (Active -- On-Demand)

These functions are called by users, agents, or other functions but do not run on crons.

| Function | Purpose | Called By |
|----------|---------|----------|
| `universal-search` | Multi-entity search with thumbnails | Frontend, agents |
| `db-stats` | Quick database overview | Agents, monitoring |
| `ralph-wiggum-rlm-extraction-coordinator` | System coordination brief | Agents |
| `queue-status` | Import queue breakdown | Agents |
| `pipeline-dashboard` | Full system overview | Agents |
| `extract-vehicle-data-ai` | Generic AI extraction | URL intake, agents |
| `extract-bat-core` | BaT listing extraction | complete-bat-import |
| `extract-cars-and-bids-core` | C&B listing extraction | URL intake |
| `haiku-extraction-worker` | Cheap batch extraction | agent-tier-router |
| `sonnet-supervisor` | Quality review | agent-tier-router |
| `agent-tier-router` | Task routing across LLM tiers | Cron, agents |
| `ingest-observation` | Unified data write path | All extractors (target) |
| `dedup-vehicles` | Duplicate detection/merge | Agents |
| `compute-vehicle-valuation` | Nuke estimate calculation | Agents, cron |
| `generate-listing-package` | BaT submission bundle | Agents |
| `mcp-connector` | ARS, coaching, listing prep | MCP tools |
| `api-v1-vision` | Vision API (classify + analyze) | SDK, agents |
| `yono-classify` | YONO make classification | Vision pipeline |
| `yono-analyze` | Condition/zone/damage analysis | Vision pipeline |
| `image-intake` | Image upload + processing | Frontend, agents |
| `decode-vin-and-update` | VIN decode + DB update | Agents |
| `extract-facebook-marketplace` | Single FB listing extraction | Agents |
| `fb-marketplace-orchestrator` | Bulk FB extraction | Agents |
| `create-org-from-url` | Create organization from URL | Agents |

---

## By Table (Core)

| Table | Purpose | Primary Writer | Row Estimate |
|-------|---------|---------------|-------------|
| `vehicles` | Core vehicle entities | Multiple extractors | ~1.25M |
| `vehicle_images` | Image records | Multiple extractors | ~33M |
| `vehicle_events` | Legacy event store | Multiple extractors | ~170K |
| `vehicle_observations` | Unified observation store | `ingest-observation` | ~3.78M |
| `auction_comments` | Comment store | `extract-auction-comments` | ~364K |
| `import_queue` | Intake queue | URL submission | Variable |
| `listing_page_snapshots` | Archived HTML | `archiveFetch` | 440K+ (79GB) |
| `observation_sources` | Source registry | Config | ~50 |
| `field_evidence` | Data-to-source links | Extraction pipeline | ~108K |
| `pipeline_registry` | Column ownership map | Config | ~86 |
| `bat_user_profiles` | BaT user data + stylometrics | Stylometric analyzer | ~520K |
| `author_personas` | Persona models | Persona pipeline | Growing |
| `comment_persona_signals` | Per-comment persona traits | Discovery | ~2,787 |
| `comment_discoveries` | AI comment analysis | `discover-comment-data` | Growing |
| `description_discoveries` | AI description analysis | `discover-description-data` | Growing |
| `organizations` | Business entities | Org extractors | Growing |
| `analysis_widgets` | Widget registry | Config | 14 |
| `analysis_signals` | Per-vehicle widget outputs | Analysis engine | Growing |
| `analysis_queue` | Analysis processing queue | Analysis engine | Variable |
| `auction_readiness` | ARS scores | `persist_auction_readiness()` | Growing |
| `document_ocr_queue` | OCR processing queue | Document pipeline | Variable |
| `work_orders` | Work order tracking | Work order system | Growing |
| `methodology_references` | Research paper citations | Library | 17 |
| `methodology_applications` | Paper applications to system | Library | 38 |

---

## By Document

| Document | Location | What It Covers |
|----------|----------|---------------|
| DICTIONARY | `docs/library/reference/dictionary/README.md` | Term definitions (A-Z) |
| INDEX | This file | Concept-to-location mapping |
| ALMANAC | `docs/library/reference/almanac/` | Facts, figures, platform metrics |
| ATLAS | `docs/library/reference/atlas/` | Scraping sources, geographic data |
| CLAUDE.md | `/Users/skylar/nuke/CLAUDE.md` | Agent instructions, hard rules, principles |
| TOOLS.md | `/Users/skylar/nuke/TOOLS.md` | Canonical intent-to-function map |
| PROJECT_STATE.md | `/Users/skylar/nuke/PROJECT_STATE.md` | Current sprint focus |
| DONE.md | `/Users/skylar/nuke/DONE.md` | Completed work log |
| ISSUES.md | `/Users/skylar/nuke/.claude/ISSUES.md` | Known bugs and regressions |
| Extraction Handbook | `docs/library/technical/extraction-playbook.md` | Complete extraction reference (2,998 lines) |
| Engineering Manual | `docs/library/technical/engineering-manual/` | 10 chapters, build guides |
| Design Book | `docs/library/technical/design-book/` | 10 chapters, UI specifications |
| Schematics | `docs/library/technical/schematics/` | Data flow, entity relationships, pipelines |
| Work Order Intelligence | `docs/library/technical/work-order-intelligence.md` | Work order system guide |
| Applied Ontology | `docs/library/intellectual/papers/applied-ontology-vehicle-domain.md` | Framework paper |
| User Simulation | `docs/library/intellectual/papers/user-simulation-methodology.md` | Stylometric methodology |
| Entity Resolution | `docs/library/intellectual/papers/entity-resolution-design.md` | ER design decisions |
| Trust Scoring | `docs/library/intellectual/papers/trust-scoring-methodology.md` | Trust weight methodology |
| Vision Strategy | `docs/library/intellectual/papers/vision-training-strategy.md` | YONO training strategy |
| Contemplations | `docs/library/intellectual/contemplations/` | 10 philosophical essays |
| Discourses | `docs/library/intellectual/discourses/` | 4 strategic conversations |
| Theoreticals | `docs/library/intellectual/theoreticals/` | 7 unsolved problem papers |
| Studies | `docs/library/intellectual/studies/` | 5 empirical analyses |
| Digital Twin Architecture | `~/.claude/projects/-Users-skylar/memory/digital-twin-architecture.md` | North star architecture doc |
| Extraction Vision Strategy | `~/.claude/projects/-Users-skylar/memory/extraction-vision-strategy.md` | Pipeline strategy |
| Auction Readiness Strategy | `~/.claude/projects/-Users-skylar/memory/auction-readiness-strategy.md` | ARS + coaching |
| Entity Resolution Rules | `docs/architecture/ENTITY_RESOLUTION_RULES.md` | ER hard rules |
| Popup Data Strategy | `docs/architecture/POPUP_DATA_STRATEGY.md` | Popup computation model |

---

## By Shared Utility (`supabase/functions/_shared/`)

| File | Purpose | Import Pattern |
|------|---------|---------------|
| `archiveFetch.ts` | Fetch URL + auto-archive to `listing_page_snapshots` | `import { archiveFetch } from "../_shared/archiveFetch.ts"` |
| `cors.ts` | CORS headers | `import { corsHeaders } from "../_shared/cors.ts"` |
| `supabaseClient.ts` | Supabase client factory | Standard import pattern |
| `agentTiers.ts` | Agent hierarchy configs + Anthropic API wrapper | Agent functions |
| `personaPrompt.ts` | Persona-to-bot prompt generation | Persona pipeline |
| `batFetcher.ts` | BaT-specific fetch with auth handling | BaT extractors (CRITICAL: needs redirect fix) |
| `hybridFetcher.ts` | Legacy fetch wrapper | DEPRECATED -- use `archiveFetch.ts` |

---

## By Script (`scripts/`)

| Script | Purpose | npm Command |
|--------|---------|-------------|
| `user-stylometric-analyzer.mjs` | Stylometric fingerprinting of BaT users | Direct: `node scripts/user-stylometric-analyzer.mjs` |
| `iphoto-intake.mjs` | Import photos from Apple Photos library | `dotenvx run -- node scripts/iphoto-intake.mjs` |
| `drop-folder-ingest.mjs` | Work photo drop folder watcher | launchd: `com.nuke.work-photos` |
| `work-photos-intake.mjs` | Work photo classification + upload | Called by drop-folder-ingest |
| `fb-marketplace-local-scraper.mjs` | Local FB scraper (residential IP) | Direct execution |
| `fb-saved-extractor.js` | Extract FB saved vehicles (browser-side) | Two-step: extract then submit |

---

## Key Architectural Principles

| Principle | Location | Summary |
|-----------|----------|---------|
| Archive Fetch | CLAUDE.md | Every URL fetched gets stored. Fetch once, extract forever. |
| Schema Discovery | CLAUDE.md | Never pre-define schema. Sample data first, then design. |
| Batched Migration | CLAUDE.md | Never unbounded UPDATE/DELETE. Batch in 1000-row chunks. |
| Entity Resolution | `docs/architecture/ENTITY_RESOLUTION_RULES.md` | Vehicle is the entity. URLs are testimony. Never auto-merge below 0.80. |
| Digital Twin | Memory file | Database IS the vehicle. 5 dimensional shadows. |
| Observation Mandate | CLAUDE.md | All data writes through `ingest-observation`. |
| Pipeline Registry | `pipeline_registry` table | Check ownership before writing to any computed field. |
| Hard Rules | CLAUDE.md | 15 enforced rules from March 2026 triage. |
