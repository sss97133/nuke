# Publications System — Status Report

**Date:** April 9, 2026
**Scope:** April 8-9 work session — email intelligence extraction, publication mapping, Supabase seeding, and frontend UI for the publishing module.

---

## What Was Built

### 1. Email Intelligence Pipeline (`~/tools/`)

Standalone Python scripts that process ~101GB of MBOX + .emlx email data into a local SQLite database (`~/email_intelligence.db`). These are the source-of-truth extraction tools that feed the publications system.

| Script | Purpose |
|--------|---------|
| `~/tools/universal_email_extraction.py` | One-pass extraction across all MBOX + macOS Mail .emlx archives into `email_observations` table (198,520 rows) |
| `~/tools/build_publication_map.py` | Identifies 8 distinct publications from email patterns, maps issues, production phases, bouclage dates. Outputs `~/publication_map/*.json` |
| `~/tools/rebuild_production_credits.py` | Scans email_observations for publication-matching emails, assigns person x publication credits by dominant production phase (4,643 credits) |
| `~/tools/compute_role_spectrum.py` | Multi-dimensional role profiling: observed (email keywords), cited (masthead), platform (Supabase). Stored in `person_profiles.role_spectrum` |
| `~/tools/compute_reliability.py` | Reliability scoring for contacts based on response patterns, ghost detection, cross-channel activity |
| `~/tools/build_relationship_matrix.py` | Builds org-to-org and person-to-org relationship edges from email co-occurrence |
| `~/tools/scan_archive.py` | Catalogs ~/Documents/Archives/ and ~/DUPLICATES_FOR_SSD/ — 101,365 production files with parsed metadata |
| `~/tools/index_images.py` | Indexes image files from production archives with dimensions, format, file size |
| `~/tools/analyze_magazine_pdf.py` | PDF page analysis for magazine archives |
| `~/tools/serve_data.py` | Local JSON API server (port 8888) serving email_intelligence.db data to the frontend viewer |
| `~/tools/submit_to_supabase.py` | **The seeding script** — reads `~/publication_map/INDEX.json`, submits publications + production credits to Supabase (platform: `email_archive`) |
| `~/assign_issue_credits.py` | Issue-level credit attribution — assigns per-person credits to specific magazine issues using production time windows |

### 2. Publication Map (`~/publication_map/`)

Generated April 8 by `build_publication_map.py`. Source data for the April 9 Supabase seeding.

| File | Publication | Type | Emails | People | Issues |
|------|------------|------|--------|--------|--------|
| `lofficiel_stbarth.json` | L'Officiel St Barth | annual_magazine | 11,958 | 1,045 | 14 (#1-#11 + variants) |
| `lofficiel_riviera.json` | L'Officiel Riviera | annual_magazine | 3,560 | 417 | — |
| `lofficiel_art.json` | L'Officiel Art | magazine | 700 | 94 | 4 (#29-#32) |
| `lofficiel_voyage.json` | L'Officiel Voyage | magazine | 87 | 31 | 2 (#57-#58) |
| `each_other.json` | Each x Other | fashion_collection | 544 | 92 | 5 (SS_2014 thru SS_2024) |
| `art_saint_barth.json` | Art Saint Barth | gallery_operations | 880 | 96 | — |
| `utopia.json` | Utopia | art_project | 423 | 72 | — |
| `smart_map.json` | Smart Map St Barth | annual_guide | 15 | 3 | 1 (#2017) |
| `INDEX.json` | Combined index | — | 18,167 matched | — | 26 total |
| `REPORT.md` | Human-readable summary | — | — | — | — |

### 3. Local SQLite Database (`~/email_intelligence.db`)

| Table | Rows | Description |
|-------|------|-------------|
| `email_observations` | 198,520 | Every email across all archives (from, to, cc, date, subject, body preview) |
| `production_credits` | 4,643 | Person x publication x role credits with confidence scores |
| `person_profiles` | 17,980 | Contact profiles with role_spectrum, reliability, ghost_status |
| `production_files` | 101,365 | Cataloged files from production archives (InDesign, PDF, PSD, etc.) |
| `email_publication_match` | — | Join table: email_id -> publication_slug |
| `image_index` | — | Indexed images with dimensions/format |
| `magazine_pages` | — | Parsed magazine page data |
| `org_profiles` | — | Organization profiles |
| `org_relationships` | — | Org-to-org edges |
| `relationship_edges` | — | Person/org relationship graph |
| `person_aliases` | — | Email alias deduplication |
| `imessage_observations` | — | iMessage data cross-referenced with email contacts |
| `threads` | — | Email thread reconstruction |

### 4. Supabase Migrations (already committed in nuke repo)

| File | Purpose |
|------|---------|
| `supabase/migrations/20260302070000_publications_system.sql` | `publications` + `publication_pages` tables with indexes, triggers, RLS |
| `supabase/migrations/20260302080000_publications_pipeline_registry.sql` | Pipeline ownership registry for publications fields |
| `supabase/migrations/20260302100000_stale_locks_publication_pages.sql` | Stale lock detection for publication_pages queue |

### 5. Issuu Pipeline Scripts (already committed in nuke repo)

Located at `scripts/stbarth/`:

| Script | Purpose |
|--------|---------|
| `seed-publishers.mjs` | Populates organizations table from publisher data |
| `seed-publications.mjs` | Batch-upserts publications from `data/publications_with_hashes.json` |
| `extract-issuu-hashes.ts` | Playwright-based CDN hash extraction from Issuu URLs |
| `index-publication-pages.mjs` | Generates publication_pages rows (one per page) from CDN hashes |
| `analyze-publication-pages.mjs` | Claude vision analysis worker (Haiku + Sonnet escalation) |
| `analyze-publication-pages-local.mjs` | Ollama/Modal alternative for vision analysis |
| `compare-vision-models.mjs` | Model comparison harness |
| `analysis-progress.mjs` | Queue health monitoring |
| `vision-prompt.mjs` | Vision analysis prompt with 25+ entity type schema |
| `EXTRACTION_PIPELINE_SPEC.py` | Pipeline documentation |
| `modal_vision_server.py` | Modal serverless GPU endpoint |
| `data/publications_with_hashes.json` | 1,006 Issuu publications across 17 publishers |

### 6. Frontend Publishing Module (NEW — this commit)

**Types:** `nuke_frontend/src/types/publishing.ts`
- Publication, PublicationIssue, EditorialStory, AdPlacement, FlatplanPage, ProductionCredit, RoleSpectrum, PublishingPerson, BrandPartnership

**Pages:** `nuke_frontend/src/pages/publishing/`

| Page | Route | Description |
|------|-------|-------------|
| `PublishingDashboard.tsx` | `/publishing/` | Grid of all publications with stats cards |
| `PublicationProfile.tsx` | `/publishing/:slug` | Single publication series — timeline, issues list, contributors, brand partnerships |
| `IssueProfile.tsx` | `/publishing/:slug/issue/:issueNumber` | Single issue — flatplan, stories, ads, masthead, page thumbnails |
| `PeopleDirectory.tsx` | `/publishing/people` | Sortable directory of all publishing contacts |
| `PersonProfile.tsx` | `/publishing/people/:personId` | Individual professional — role spectrum, reliability, communication activity |

**Components:** `nuke_frontend/src/components/publishing/PublicationCard.tsx`

**Routes:** `nuke_frontend/src/routes/modules/publishing/routes.tsx`
- Lazy-loaded, integrated into `DomainRoutes.tsx` at `/publishing/*`

**Design specs:**
- `nuke_frontend/PUBLISHING_DESIGN.md` — Component designs, Windows 95 aesthetic
- `nuke_frontend/PUBLISHING_UX_SPEC.md` — UX patterns, entity relationships, interaction design

---

## The Reification Approach

Publications are elevated to first-class entities using the same structural pattern as vehicles:

| Vehicle System | Publications System |
|---------------|-------------------|
| `vehicles` table | `publications` table |
| `vehicle_images` table | `publication_pages` table |
| VIN as identifier | `publisher_slug` + `issue_number` |
| Image URL from storage | Page URL from Issuu CDN hash |
| AI vision on vehicle photos | AI vision on magazine pages |
| Pipeline: scrape -> extract -> analyze | Pipeline: seed -> hash -> index pages -> analyze |

**Schema pattern:** Both use UUID primary keys, `extraction_status` enum (pending -> processing -> complete), `ai_processing_status` for vision analysis, JSONB metadata fields, queue locking for concurrent workers, and RLS policies for public read access.

**How it generalizes:** The `platform` field on `publications` distinguishes data sources:
- `issuu` — Issuu-hosted digital publications (1,006 rows, CDN-extractable pages)
- `email_archive` — Publications reconstructed from email intelligence (29 rows, metadata-rich)

Any asset type that has a collection of pages/images with metadata can follow this pattern. The pipeline registry (`20260302080000_publications_pipeline_registry.sql`) documents which script owns which fields, making the system self-documenting.

---

## What's in the DB (April 9 Batch)

The `submit_to_supabase.py` script seeded the following with `platform: 'email_archive'`:

**L'Officiel St Barth:** Issues #1 through #11 (one row per issue) + variant keys (#01, #07, #27)
**L'Officiel Art:** Issues #29, #30, #31, #32
**L'Officiel Riviera:** Series-level row (no individually numbered issues in email data)
**L'Officiel Voyage:** Issues #57, #58
**Each x Other:** 5 seasons (SS_2014, RE_2017, SS_2018, SS_2023, SS_2024)
**Art Saint Barth:** Series-level row
**Utopia:** Series-level row
**Smart Map St Barth:** Issue #2017

Each row carries `metadata` JSONB with: email_count, orgs, financial_signals, span_days, production phases, territory, series_type. Source: `email_intelligence` via `~/publication_map/INDEX.json`.

**Combined DB state:**
- `publications`: 1,035 rows (1,006 from Issuu + 29 from email_archive)
- `publication_pages`: 41,592 pages (Issuu only, with AI vision analysis)
- `publication_issues`: 0 rows (schema exists)
- `editorial_stories`: 0 rows (schema exists)
- `nuke_production_credits`: Seeded from top 200 email-derived credits

---

## What's NOT Done Yet

### Empty Tables
- **`publication_issues`** — Schema exists in Supabase but 0 rows. The local `email_intelligence.db` has issue data in `production_credits` (asset_type = 'magazine_issue'). No migration script to populate the Supabase `publication_issues` table yet.
- **`editorial_stories`** — Schema exists, 0 rows. Would require either manual entry or PDF page analysis to extract story boundaries from magazine pages. `analyze-publication-pages.mjs` captures `page_type` and `subject_matter` per page but doesn't aggregate into stories.

### Not Yet Migrated to Supabase
- Issue-level credits from `assign_issue_credits.py` (written to local DB, not yet pushed to Supabase)
- Person profiles with role_spectrum and reliability scores (17,980 rows in local DB)
- Production files catalog (101,365 rows in local DB)
- Organization relationships and profiles

### Frontend Gaps
- Publishing pages query Supabase but `publication_issues` and `editorial_stories` tables are empty, so IssueProfile will show empty flatplan/stories
- PeopleDirectory and PersonProfile need a people API endpoint (currently designed but not wired)
- No cover images for email_archive publications (Issuu ones have CDN-generated covers)

---

## The Universal Data Platform Angle

Nuke started as a vehicle intelligence platform. The publications system proves the architecture generalizes:

**Pattern:** Any asset type (vehicle, publication, property, artwork) gets:
1. A primary table with `extraction_status` pipeline
2. A child table for visual assets (images/pages) with AI vision analysis
3. A credits/provenance table linking people to assets
4. A frontend module with the same UX patterns (dashboard -> profile -> detail)

**What makes it a platform:**
- The Issuu pipeline (seed -> hash -> index -> analyze) works for any digital publication publisher
- The email intelligence pipeline works for any email archive — it's not L'Officiel-specific
- The vision analysis (Claude Haiku/Sonnet) extracts structured data from any image type
- The queue/lock/retry infrastructure handles any batch processing workload

**The pitch:** Nuke is a universal data platform that turns unstructured sources (auction listings, email archives, digital publications, filesystem archives) into structured, searchable, AI-analyzed asset intelligence. Publications are the second proof point after vehicles. Properties (villas, real estate) could be third — the `scripts/concierge/` directory already has villa scrapers.

---

## File Inventory

### Already Committed (in nuke repo)
```
supabase/migrations/20260302070000_publications_system.sql
supabase/migrations/20260302080000_publications_pipeline_registry.sql
supabase/migrations/20260302100000_stale_locks_publication_pages.sql
scripts/stbarth/seed-publishers.mjs
scripts/stbarth/seed-publications.mjs
scripts/stbarth/extract-issuu-hashes.ts
scripts/stbarth/index-publication-pages.mjs
scripts/stbarth/analyze-publication-pages.mjs
scripts/stbarth/analyze-publication-pages-local.mjs
scripts/stbarth/compare-vision-models.mjs
scripts/stbarth/analysis-progress.mjs
scripts/stbarth/vision-prompt.mjs
scripts/stbarth/EXTRACTION_PIPELINE_SPEC.py
scripts/stbarth/modal_vision_server.py
scripts/stbarth/data/publications_with_hashes.json
```

### New in This Commit (frontend publishing module)
```
nuke_frontend/src/types/publishing.ts
nuke_frontend/src/pages/publishing/PublishingDashboard.tsx
nuke_frontend/src/pages/publishing/PublicationProfile.tsx
nuke_frontend/src/pages/publishing/IssueProfile.tsx
nuke_frontend/src/pages/publishing/PeopleDirectory.tsx
nuke_frontend/src/pages/publishing/PersonProfile.tsx
nuke_frontend/src/components/publishing/PublicationCard.tsx
nuke_frontend/src/routes/modules/publishing/routes.tsx
nuke_frontend/src/routes/DomainRoutes.tsx (modified — added /publishing/* route)
nuke_frontend/PUBLISHING_DESIGN.md
nuke_frontend/PUBLISHING_UX_SPEC.md
```

### On This Machine (not in nuke repo — local intelligence tools)
```
~/tools/universal_email_extraction.py
~/tools/build_publication_map.py
~/tools/rebuild_production_credits.py
~/tools/compute_role_spectrum.py
~/tools/compute_reliability.py
~/tools/build_relationship_matrix.py
~/tools/scan_archive.py
~/tools/index_images.py
~/tools/analyze_magazine_pdf.py
~/tools/serve_data.py
~/tools/submit_to_supabase.py
~/tools/build_issue_skeletons.py
~/assign_issue_credits.py
~/publication_map/*.json
~/publication_map/REPORT.md
~/email_intelligence.db (198K emails, 4.6K credits, 18K profiles, 101K files)
```
