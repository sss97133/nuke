## Extraction toolkit cleanup (docs + scripts)

**Date**: 2026-01-10  
**Goal**: eliminate “competing truths” so we stop running the wrong extractors and re-learning the same lessons.

### Canonical sources of truth (use these)

- `docs/EXTRACTION_TOOLKIT_INDEX.md`
- `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md`
- `docs/ops/EDGE_FUNCTION_GOVERNANCE.md`

### What was archived (moved out of active docs)

#### Legacy “how-to” / plans (moved to `docs/archive/extraction-legacy/`)

- `docs/IMPORT_BAT_LISTING.md` → `docs/archive/extraction-legacy/IMPORT_BAT_LISTING.md`
- `docs/BAT_AUTO_EXTRACTION_SYSTEM.md` → `docs/archive/extraction-legacy/BAT_AUTO_EXTRACTION_SYSTEM.md`
- `docs/COMPREHENSIVE_RE_EXTRACTION_PLAN.md` → `docs/archive/extraction-legacy/COMPREHENSIVE_RE_EXTRACTION_PLAN.md`
- `docs/BAT_EXTRACTION_FIX_2025-01-26.md` → `docs/archive/extraction-legacy/BAT_EXTRACTION_FIX_2025-01-26.md`
- `docs/systems/PARTIAL_SCRAPE_RETRY.md` (legacy version) → `docs/archive/extraction-legacy/PARTIAL_SCRAPE_RETRY.md`

#### Legacy analyses (moved to `docs/archive/extraction-analysis/`)

- `docs/BAT_DATA_QUALITY_ASSESSMENT.md` → `docs/archive/extraction-analysis/BAT_DATA_QUALITY_ASSESSMENT.md`
- `docs/BAT_DATA_QUALITY_DEEP_DIVE.md` → `docs/archive/extraction-analysis/BAT_DATA_QUALITY_DEEP_DIVE.md`
- `docs/BAT_DATA_SOURCES_VERIFICATION.md` → `docs/archive/extraction-analysis/BAT_DATA_SOURCES_VERIFICATION.md`

All of these paths keep a short “Archived” stub at the original location so internal links don’t break and readers get redirected immediately.

### Docs updated to remove deprecated entrypoints / stale claims

- `docs/BAT_LISTING_FIX_PLAN.md` (removed `import-bat-listing` suggestion)
- `docs/BAT_REPAIR_LOOP_EXECUTION_PLAN.md` (updated to approved two-step workflow; removed `import-bat-listing` dependency claims)
- `docs/BAT_REPAIR_MONITORING.md` (updated troubleshooting to approved extractors)
- `docs/systems/processing/AUTO_SOLD_TRIGGER.md` (updated BaT import flow to `complete-bat-import`)
- `docs/LLM_INSTRUCTIONS_SIMPLE.md` (fixed queue schema + removed “queue worker needs update” claim)
- `docs/systems/PARTIAL_SCRAPE_RETRY.md` (replaced with current evidence-first/queue-based guidance)
- `docs/architecture/integration/BAT_INTEGRATION_ROADMAP.md` (updated snippet to `complete-bat-import`)

### Scripts updated / archived to stop “wrong tool” runs

#### Updated (kept; referenced by `package.json`)

- `scripts/bat-import-live-auctions.ts` now calls `complete-bat-import`
- `scripts/bat-import-results.ts` now calls `complete-bat-import` (and marks `--image-batch-size` as legacy/no-op)
- `scripts/bat-import-local-partner-vehicles.ts` now calls `complete-bat-import` (and marks `--image-batch-size` as legacy/no-op)

#### Archived (moved out of active `scripts/` because they invoked deprecated functions)

- Moved to: `archive/old-scripts/deprecated-bat/`
- Rationale: these scripts invoked `import-bat-listing` or `comprehensive-bat-extraction` and were repeatedly resurfacing as “canonical” tools.

### Result verification

- `node scripts/audit-deprecated-edge-functions.cjs` → **OK (no deprecated invocations found)**

