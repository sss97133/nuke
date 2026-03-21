# NUKE INDEX

Maps concepts to their locations in the codebase, database, and documentation.

---

## By Concept

### Intake / Ingestion
- **Function**: `supabase/functions/process-import-queue/index.ts` (legacy router)
- **Function**: `supabase/functions/ingest-observation/index.ts` (unified — target state)
- **Table**: `import_queue` (legacy)
- **Table**: `vehicle_observations` (unified)
- **Principle**: ENCYCLOPEDIA Section 19 (One Intake, One Gesture)
- **Principle**: CLAUDE.md → ARCHIVE FETCH PRINCIPLE
- **Shared util**: `supabase/functions/_shared/archiveFetch.ts`

### Extraction
- **BaT**: `supabase/functions/extract-bat-core/index.ts`
- **Cars & Bids**: `supabase/functions/extract-cars-and-bids-core/index.ts`
- **PCarMarket**: `supabase/functions/import-pcarmarket-listing/index.ts`
- **Hagerty**: `supabase/functions/extract-hagerty-listing/index.ts`
- **Craigslist**: `supabase/functions/extract-craigslist/index.ts`
- **Generic AI**: `supabase/functions/extract-vehicle-data-ai/index.ts`
- **Haiku worker**: `supabase/functions/haiku-extraction-worker/index.ts`
- **Agent tiers**: `supabase/functions/_shared/agentTiers.ts`
- **Principle**: CLAUDE.md → SCHEMA DISCOVERY PRINCIPLE
- **Policy**: `docs/EXTRACTION_POLICY.md`
- **Targets**: `docs/EXTRACTION_TARGETS.md`

### Entity Resolution / Matching
- **Current**: Per-extractor matching (in each extract-* function)
- **Target**: Universal matcher (ENCYCLOPEDIA Section 18)
- **Dedup function**: `supabase/functions/dedup-vehicles/index.ts`
- **Merge migration**: `supabase/migrations/20260227040642_merge_duplicate_vehicles.sql`
- **Known issue**: Y/M/M fuzzy match at 60% confidence causes data corruption

### Observation System
- **Ingest function**: `supabase/functions/ingest-observation/index.ts`
- **Discovery function**: `supabase/functions/discover-from-observations/index.ts`
- **Migration function**: `supabase/functions/migrate-to-observations/index.ts`
- **Tables**: `observation_sources`, `vehicle_observations`, `observation_extractors`, `observation_discoveries`
- **Analysis**: RHIZOME.md ("Observation is the Body without Organs")
- **Status**: Built but not adopted. Extractors bypass it. See ENCYCLOPEDIA Section 17.

### Provenance
- **Current state**: Vehicle provenance is implicit (in descriptions, comments, auction records)
- **Target state**: Explicit `provenance_entries` table (ENCYCLOPEDIA Section 4)
- **Evidence table**: `field_evidence` (107,887 rows linking data to sources)
- **Related**: `certificates_of_authenticity`, `conservation_history` (ENCYCLOPEDIA Section 4)

### Valuation / Nuke Estimate
- **Column**: `vehicles.nuke_estimate`
- **Status**: Column exists, no algorithm producing trustworthy numbers
- **Analysis**: JEWELS.md entry 5 (45 mentions, 5 months, never dropped)

### Design System
- **Design Bible**: `docs/DESIGN_BIBLE.md` (three laws, visual identity, voice)
- **Design Book**: `docs/library/technical/design-book/` (component specs, interaction model)
- **Canonical CSS**: `nuke_frontend/src/styles/unified-design-system.css`
- **Frozen CSS**: `nuke_frontend/src/styles/design-system.css` (do not modify)
- **Memory file**: `~/.claude/projects/-Users-skylar/memory/design-system.md`
- **Principles**: ENCYCLOPEDIA Sections 9-11

### Frontend Components (Badge Portal System)
- **BadgePortal**: `nuke_frontend/src/components/badges/BadgePortal.tsx` — the atomic unit
- **BadgeClusterPanel**: `nuke_frontend/src/components/badges/BadgeClusterPanel.tsx` — expand panel
- **useBadgeDepth**: `nuke_frontend/src/components/badges/useBadgeDepth.ts` — lazy depth fetch
- **DetailPanel**: `nuke_frontend/src/components/panels/DetailPanel.tsx` — slide-in overlay
- **CardShell**: `nuke_frontend/src/feed/components/card/CardShell.tsx` — click-to-expand cards
- **VehicleCard**: `nuke_frontend/src/feed/components/VehicleCard.tsx` — composable card
- **ResilientImage**: `nuke_frontend/src/components/images/ResilientImage.tsx` — fallback chain
- **CardDealScore**: `nuke_frontend/src/feed/components/card/CardDealScore.tsx` — deal/heat badges (BadgePortal)
- **CardSource**: `nuke_frontend/src/feed/components/card/CardSource.tsx` — source favicon stamp
- **FeedLayout**: `nuke_frontend/src/feed/components/FeedLayout.tsx` — virtualized grid/list/table
- **FeedStatsStrip**: `nuke_frontend/src/feed/components/FeedStatsStrip.tsx` — stats bar
- **FeedEmptyState**: `nuke_frontend/src/feed/components/FeedEmptyState.tsx` — zero-results (no dead ends)
- **Spec**: Design Book Chapter 2 (Components), Chapter 3 (Interactions)

### Signal Calculation
- **Status**: Not yet implemented
- **Spec**: ENCYCLOPEDIA Section 14
- **Dependency**: Requires observation system to be adopted first

### Image Pipeline
- **Vehicle images**: `vehicle_images` table
- **iPhoto intake**: `scripts/iphoto-intake.mjs`
- **YONO classifier**: Trained, ONNX exported, NOT integrated
- **Spec**: `docs/YONO_SPEC.md`, `docs/YONO_TRAINING_DATA.md`

### MCP Tools
- **Supabase**: `mcp__supabase__execute_sql`, `mcp__supabase__get_logs`, `mcp__supabase__apply_migration`
- **Firecrawl**: `mcp__firecrawl__scrape_url`, `mcp__firecrawl__crawl_url`
- **Playwright**: `mcp__playwright__navigate`, `mcp__playwright__click`
- **Target MCP tools**: `nuke_intake`, `nuke_extract`, `nuke_resolve`, `nuke_observe`, `nuke_query` (ENCYCLOPEDIA Section 21)

---

## By Table

| Table | Purpose | Owner | Index Entry |
|-------|---------|-------|-------------|
| `vehicles` | Core vehicle entities | Multiple extractors | Extraction |
| `artworks` | Core art entities (planned) | — | ENCYCLOPEDIA Section 2 |
| `assets` | Unified asset registry (planned) | — | ENCYCLOPEDIA Section 1 |
| `vehicle_observations` | Unified observation store | `ingest-observation` | Observation System |
| `observation_sources` | Source registry | Config | Observation System |
| `import_queue` | Legacy intake queue | `process-import-queue` | Intake |
| `vehicle_images` | Image records | Multiple | Image Pipeline |
| `auction_comments` | Legacy comment store | `extract-auction-comments` | Extraction (becoming view) |
| `vehicle_events` | Legacy event store | Multiple extractors | Extraction (becoming view) |
| `field_evidence` | Data-to-source links | Extraction pipeline | Provenance |
| `pipeline_registry` | Column ownership map | Config | CLAUDE.md |
| `listing_page_snapshots` | Archived HTML (79GB) | `archiveFetch` | Intake |

---

## By Document

| Document | Location | What It Covers |
|----------|----------|---------------|
| DICTIONARY | `docs/library/reference/DICTIONARY.md` | Term definitions |
| ENCYCLOPEDIA | `docs/library/reference/ENCYCLOPEDIA.md` | Complete system reference (23 sections) |
| THESAURUS | `docs/library/reference/THESAURUS.md` | Term relationships and synonyms |
| INDEX | This file | Concept-to-location mapping |
| ALMANAC | `docs/library/reference/ALMANAC.md` | Facts, figures, reference data |
| ATLAS | `docs/library/atlas/` | Geographic and institutional data |
| CLAUDE.md | `/Users/skylar/nuke/CLAUDE.md` | Agent instructions, hard rules, principles |
| TOOLS.md | `/Users/skylar/nuke/TOOLS.md` | Canonical intent→function map |
| PROJECT_STATE.md | `/Users/skylar/nuke/PROJECT_STATE.md` | Current sprint focus |
| DONE.md | `/Users/skylar/nuke/DONE.md` | Completed work log |
| RHIZOME.md | `docs/writing/RHIZOME.md` | 11 machines analysis, BwO concept |
| JEWELS.md | `docs/writing/JEWELS.md` | Low-frequency high-importance features |
| ENTITIES.md | `docs/writing/ENTITIES.md` | Platform/vehicle/tool/people entity map |
| NARRATIVE_ARC.md | `docs/writing/NARRATIVE_ARC.md` | Project story from Oct 2025 to present |
| Digital Twin Architecture | `digital-twin-architecture.md` | Schema-as-prompt, EAV at total resolution |
| Extraction Vision Strategy | `extraction-vision-strategy.md` | Pipeline: extract → vision → verify |
| Auction Readiness Strategy | `auction-readiness-strategy.md` | ARS score, coaching, listing packager |

---

## By Edge Function (Active, Key Functions)

| Function | Purpose | Status |
|----------|---------|--------|
| `process-import-queue` | Routes URLs to domain extractors | Active (legacy) |
| `ingest-observation` | Unified write path | Active (underused) |
| `extract-bat-core` | BaT extraction | Active |
| `extract-cars-and-bids-core` | C&B extraction | Active |
| `extract-vehicle-data-ai` | Generic AI extraction | Active |
| `haiku-extraction-worker` | Batch Haiku extraction | Active |
| `dedup-vehicles` | Duplicate detection/merge | Active |
| `discovery-snowball` | Recursive lead discovery | Active |
| `ralph-wiggum-rlm-extraction-coordinator` | System status/coordination | Active |
| `universal-search` | Multi-entity search with thumbnails | Active |
| `db-stats` | Quick database overview | Active |

Full function inventory in TOOLS.md.
