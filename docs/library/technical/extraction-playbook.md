# The Extraction Handbook

> **Read this before starting any extraction session.**
> 14 months of extraction work. 16 eras. 823K vehicles. 3.78M observations. 12 mistake patterns, 7 still recurring. Every lesson paid for in wasted compute, corrupted data, and burned API credits. This is the complete record.

**Last updated:** 2026-03-26
**Canonical location:** `docs/library/technical/extraction-playbook.md`

---

## Table of Contents

**Part I — Context**
0. [Key Concepts](#0-key-concepts) — glossary, execution model, metrics
1. [History](#1-history) — 16 eras of extraction, Feb 2025 to present
2. [Repeated Mistakes](#2-repeated-mistakes) — the 12 patterns we keep making

**Part II — Methods**
3. [Method Catalog](#3-method-catalog) — 16 extraction methods ranked
4. [LLM Configuration Guide](#4-llm-configuration-guide) — models, prompts, costs
5. [Architecture Patterns](#5-architecture-patterns) — 5 rules that matter

**Part III — Operations**
6. [Failure Playbook](#6-failure-playbook) — every known failure + fix
7. [Quick Reference](#7-quick-reference) — copy-paste runbooks
8. [Current State](#8-current-state) — live numbers and blockers

**Part IV — Sources**
9. [Source-Specific Notes](#9-source-specific-notes) — per-platform gotchas
10. [Facebook Marketplace](#10-facebook-marketplace) — complete status + the SLC use case
11. [Stalled Initiatives](#11-stalled-initiatives) — what was started, abandoned, and what it would take to finish

**Appendices**
- [A: File Index](#appendix-a-file-index)
- [B: Anti-Patterns](#appendix-b-anti-patterns-do-not-repeat)
- [C: Confidence & Trust Scoring](#appendix-c-confidence--trust-scoring)
- [D: Known Architectural Limitations](#appendix-d-known-architectural-limitations)

---

## 0. Key Concepts

Read this section first if you are new to the Nuke extraction system.

### Execution Model: Edge Functions vs Local Scripts

Extraction code runs in two environments with different capabilities:

| Environment | Examples | Can reach LLM APIs? | Can reach localhost/Ollama? | DB access | Timeout |
|-------------|----------|---------------------|---------------------------|-----------|---------|
| **Supabase Edge Functions** | `extract-bat-core`, `discover-description-data`, `ingest-observation` | YES (Kimi, Grok, Gemini, Claude) | NO (runs in Deno Deploy cloud) | Via Supabase client | 300s max |
| **Local Node.js scripts** | `bat-drain-queue.mjs`, `enrich-fb-rules.mjs` | YES (all providers) | YES (Ollama at localhost:11434) | Direct psql / pg Pool | No limit |

**This distinction matters for LLM routing.** When the playbook says "use Ollama as fallback," that only works in local scripts. Edge functions cannot reach Ollama. The LLM fallback chains differ by environment:

- **Edge function chain:** Kimi k2-turbo → Grok-3-mini → Gemini Flash Lite → Claude Haiku
- **Local script chain:** Ollama (free) → Kimi → Grok → Gemini → Claude

### Core Tables (Schema Reference)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `vehicles` | Canonical vehicle records (745K) | `id`, `year`, `make`, `model`, `vin`, `sale_price`, `source`, `status` |
| `vehicle_observations` | Unified observation store (3.78M) | `id`, `vehicle_id`, `kind` (listing/comment/condition/...), `source_slug`, `structured_data` (JSONB), `content_hash` (SHA256 dedup) |
| `listing_page_snapshots` | Archived HTML/markdown of fetched pages | `id`, `url`, `html`, `markdown`, `platform`, `fetched_at`, `content_hash` |
| `import_queue` | Intake queue for URLs to process | `id`, `url`, `source_slug`, `status` (pending/processing/complete/failed/skipped), `locked_at`, `locked_by`, `error_message`, `vehicle_id` |
| `bat_extraction_queue` | BaT-specific extraction queue | `id`, `url`, `status` (pending/processing/complete/failed), `locked_at`, `locked_by` |
| `observation_sources` | Registry of data sources with trust scores | `id`, `slug`, `display_name`, `category`, `base_trust_score`, `is_active` |
| `scrape_sources` | Source registry (FK required by import_queue) | `id`, `name`, `slug`, `base_url`, `is_active` |
| `field_evidence` | Per-field provenance tracking (3.2M+) | `id`, `vehicle_id`, `field_name`, `value`, `source_type`, `confidence` |
| `description_discoveries` | AI-extracted fields from descriptions | `id`, `vehicle_id`, `total_fields`, `raw_extraction` (JSONB) |
| `extraction_metadata` | Per-field extraction provenance | `vehicle_id`, `field_name`, `extractor`, `source_url`, `confidence`, `extracted_at` |

**Why both `observation_sources` and `scrape_sources`?** Legacy reasons. `scrape_sources` is the older table (FK for `import_queue`). `observation_sources` is the newer, richer registry with trust scores and supported observation kinds. Both must be populated when adding a new source.

### How Accuracy Is Measured

When this playbook says "91.3% accuracy" for an extractor, it means:

> **% of extracted records that pass the quality gate** — i.e., have ≥ 3 non-null fields, pass all validation checks (VIN format, year range, no HTML in text fields), and receive a quality score ≥ 0.6.

This is NOT field-level accuracy. Individual field accuracies are lower (see per-field tables in each method card). The headline number is the **record pass rate** through quality gates.

**Verification query** (run against `extraction_metadata` or test harness):
```sql
SELECT extractor_version,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE quality_score >= 0.6) as passed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_score >= 0.6) / COUNT(*), 1) as pass_rate_pct
FROM extraction_runs
GROUP BY extractor_version
ORDER BY extractor_version DESC;
```

### Batch Size Rules (Clarified)

The batch_size constraint depends on what the function does per item:

| What the function does per item | Max batch_size | Why |
|-------------------------------|----------------|-----|
| External HTTP fetch (scraping) | 3 | Each fetch = 15-30s. 3 × 30s = 90s, safe within 300s timeout. |
| LLM API call | 10–50 | LLM calls = 2-10s each, run in parallel (5 concurrent). |
| Parse archived HTML (no network) | 50–200 | Pure CPU/DB. Fast. |
| Database-only operations | 200+ | Milliseconds per item. |

The rule "max batch_size = 3" (FAILURE 14) applies specifically to functions making external scraping calls. LLM API calls are faster and can be parallelized.

### Key Terminology

| Term | Meaning |
|------|---------|
| **archiveFetch** | Universal fetch wrapper (`_shared/archiveFetch.ts`). Checks snapshot cache before making network calls. Auto-archives responses. Use instead of raw `fetch()`. |
| **ingest-observation** | Edge function (`ingest-observation/index.ts`). Single entry point for ALL new data. Handles dedup, entity resolution, provenance. |
| **quality gate** | Pre-insert validation (`_shared/extractionQualityGate.ts`). Rejects records with < 3 fields, invalid VINs, impossible years, HTML in text. See PATTERN 3. |
| **field_evidence** | Table storing per-field values with source attribution. Tracks WHO set WHAT and WHEN. |
| **essentials block** | BaT-specific: the first 50KB of a listing page, containing vehicle specs. Beyond 50KB is comments — which mention OTHER vehicles and pollute field extraction. |
| **Gutenberg blocks** | WordPress block editor format used by Mecum for descriptions. The `post.content` field is always empty — actual text is in the blocks array. |
| **RSC payload** | React Server Components data — a serialized JSON stream in Barrett-Jackson pages. More reliable than HTML parsing. |
| **`continue: true`** | Parameter for `discover-description-data`. When set, the function auto-invokes itself after completing a batch if more eligible items remain. Creates a self-chaining loop until the queue is drained or the time budget expires. |

---

## 1. History

16 eras of extraction work, from zero to 823K vehicles. Read this to understand why things are the way they are.

---

### ERA 0: Genesis (Feb 1, 2025)

Project created. Vite + React + Supabase. Within hours: "Add VIN extraction features" — the first extraction code. No vehicles. An inventory management app with ambitions.

### ERA 1: First Crawling Attempts (Feb 4, 2025)

First Firecrawl integration. "Fix crawling error for auctions" (2 commits same day). Rate limiting not handled. Import paths wrong. Multiple fix commits suggest significant debugging. Also: "Extract Paint Points Concept" — early conceptual work on condition extraction.

**Result:** Crawling attempted but buggy. Abandoned/iterated.

### ERA 2: Dormant Period (Feb – Oct 2025)

8 months of UI/UX work. "Enhance vehicle data processing" was the last extraction commit for months. Vehicles entered manually or from minimal imports. Extraction was not a priority.

**Vehicle count:** Hundreds at most.

### ERA 3: First BaT Scraper (Mar 14, 2025)

"Complete the BAT scraper for Viva Las Vegas Autos profiles with enhanced pagination handling to capture all 43 listings." A targeted scraper for one BaT seller, not a general system.

**Result:** 43 listings from one seller. Proof of concept. Not scaled.

### ERA 4: URL Import & Craigslist (Oct 2025)

"Add URL import functionality to Quick Add Vehicle form." First functional URL-based import pipeline. Craigslist parser could extract structured data. LMC catalog (parts) scraped. `extract-title-data` edge function born. Also: first parts marketplace schema.

**Result:** Working but limited. Single-URL import, not batch.

### ERA 5: Edge Function Proliferation (Late 2025 – Jan 2026)

Edge functions started accumulating rapidly. `bat-simple-extract`, `extract-bat-core`, `extract-cars-and-bids-core`, `extract-craigslist`, KSL scraper (later found 100% blocked). BaT scraper matured from 43 to 61 listings. Comment extraction began.

**Vehicle count:** Grew to ~10,000–18,000.
**The seed of future problems:** Each source got its own extractor with inconsistent quality, no shared utilities, no quality gates.

### ERA 6: Ralph Wiggum — The Extraction Factory (Jan 22–25, 2026)

The `.ralph/` system. Autonomous extraction with quality benchmarks. BaT defined as gold standard. Phase 0 quality fixes: PCarMarket images (was saving 0), Mecum title parsing, validation via 5-vehicle test batches.

**Starting state:** 97,390 vehicles. 63,519 active. 15,620 C&B pending (Cloudflare blocked).
**Result:** Quality framework established. BaT accuracy baselined at 90%+.
**What went wrong:** Never reached Phase 1 at scale in this session. Quality was measured but throughput stayed low.

### ERA 7: The 500-Loop Agent (Feb 3–16, 2026)

An autonomous extraction agent ran 500 iterations against the pipeline. Key findings:

- **Loop 1:** BaT success rate only 26.2%. Root cause: Supabase schema cache errors. ~30,000 extractions failed in 12 hours.
- **Loop 2:** BaT quality 86.4% (when working), Mecum 17.0%, C&B 20.4%. 55K failed in queue.
- **Loop 3:** Pipeline DOWN. Schema cache error under connection pool load. 886 items stuck in "processing."
- **Loop 5:** Half of BaT extractions failing — VIN uniqueness collision. Same car re-auctioned under new URL = duplicate key error. Fix identified but not applied.
- **Loops 15–500:** Mostly failures. The agent couldn't write to its own state files. The shell loop continued running for hours after the Claude session crashed.

**Final state:** 1,086,245 vehicles (including massive duplication). 87K pending. 468 vehicles actually added during 500 loops.
**The lesson:** Autonomous agents without write permissions discover bugs but can't fix them. The agent documented the VIN dedup issue that caused ~50% failure rates, but it persisted for weeks.

### ERA 8: Agent Tier System (Feb 27, 2026)

Three-tier AI extraction: Haiku ($1/MTok) for routine, Sonnet ($3/MTok) for review, Opus ($5/MTok) for strategy. Also: Facebook Marketplace GraphQL discovery. Also: first PGRST002 outage (44 per-minute crons saturated 32 max_running_jobs).

**Result:** 18 items processed in test. Cost: $0.0017. Architecture validated.
**Vehicle count:** ~1,256,000 (inflated by duplication).

### ERA 9: Facebook Marketplace (Feb 27 – Mar 1, 2026)

Local GraphQL scraper via `doc_id=33269364996041474`. No tokens, no cookies. 43 metros via launchd. First batch: 38 vehicles from 50 listings. Datacenter IPs permanently blocked — residential IP required. This is when we learned Facebook must be scraped locally, not from cloud functions.

**Result:** Scraper working via Mac launchd. Eventually grew to 33K+ FB vehicles.

### ERA 10: Mass Snapshot Extraction (Mar 1, 2026)

The archiveFetch principle crystallized: "Fetch once, extract forever." 326K items queued for re-extraction from stored HTML. Cars & Bids: 1,728 vehicles filled with 17K fields. COMPLETE. Bonhams: 855 vehicles. COMPLETE. BaT: 15K+ of 284K processed.

**The paradigm shift:** Re-extraction from archived HTML is free and faster than live crawling. This changed everything.

### ERA 11: The Great Triage (Mar 7, 2026)

The platform had bloated to **464 edge functions**, 171 GB database, $5,600/month burn. The purge:
- 18 dead-feature functions deleted (betting, trading, vault, concierge)
- 259 archived functions deleted
- 9 deprecated duplicate extractors deleted (including `bat-extract`, `bat-simple-extract`, 7 others)
- 131 crons reduced to 112
- 502,587 duplicate vehicles purged (BaT had 3.9x bloat — 620K rows, 160K distinct)
- ConceptCarz: 265K fabricated prices reclassified

**Vehicle count after purge:** ~750,000 (was 1.25M with dupes).
**The lesson:** Uncontrolled growth of extractors, crons, and tables is as dangerous as no extraction at all. Every new extractor is a liability unless it replaces an existing one.

### ERA 12: Testimony-Grade Extraction (Mar 16–18, 2026)

New philosophy: "Descriptions are TESTIMONY with HALF-LIVES." Field extraction got provenance tracking, confidence scores, temporal decay. Local Ollama extraction (qwen2.5:7b) at ~15s/vehicle. Cross-platform validation: C&B scored 106.3, BaT 92.5, Barrett-Jackson 66.9.

**Result:** 92K field_evidence rows from 8K vehicles. Quality scores jumped from avg 3.3 to 80.1.
**The paradigm shift:** From "fill database fields" to "gather testimony with confidence." This is the current extraction philosophy.

### ERA 13: Autonomous Overnight Ops (Mar 20–21, 2026)

4 parallel extraction streams running overnight: snapshots (regex), mining (Ollama), extraction (Ollama), enrichment (DB). 28K failed extractions reset. 597 stale locks released. 607 unused indexes dropped.

**Then Anthropic credits hit zero.** $399.12 burned with no alert. All AI-powered extraction halted. 141K pending in bat_extraction_queue at ~5/hr throughput. This is the event that forced the shift to Kimi/Ollama as primary LLMs.

### ERA 14: Auth Redirect Discovery (Mar 23, 2026)

The worst bug class discovered: 36 of 40 extractors silently followed HTTP 302 redirects to login pages. Login pages returned 200 OK, passed `response.ok`, and the garbage HTML was cached as "extracted successfully" for 24 hours. Unknown quantity of login pages stored as vehicle data.

Only 2 of 36 vulnerable extractors have been patched. The shared fetcher infrastructure is still unfixed.

### ERA 15: Dead Source Revival (Mar 25, 2026)

The breakthrough session. API discovery at scale:
- **Mecum:** Algolia search index found → 303K lots
- **Barrett-Jackson:** Public Strapi API found → 63K lots
- **Gooding:** Sitemap → 9K lots
- **RM Sotheby's:** 14 auctions processed
- BaT /models/ discovery: 10K new URLs
- BaT 42K URL bulk ingest: 28K vehicles from URL slug parsing at 10K/hr
- 20 niche sites onboarded, 98K URLs queued

**The lesson:** Probing for hidden APIs yields 10-100x more data than scraping HTML. Mecum's Algolia index alone has 303K lots — more than our entire BaT corpus.

### ERA 16: Non-AI Drain + Current State (Mar 26, 2026)

102K vehicles extracted at $0 LLM cost via URL parsing + snapshot reuse. Queue drained from 140K → 10K. Enrichment quality report: 387K vehicles at 64.1% avg completeness. This handbook written.

**Vehicle count:** 823,000.
**Where we are:** The pipeline works. The architecture is sound. The knowledge is being documented. The recurring mistakes are the remaining enemy.

---

### Timeline Summary

```
Feb 2025     0 vehicles    Genesis — first VIN extraction feature
Mar 2025     43            First BaT scraper (one seller)
Oct 2025     hundreds      URL import + Craigslist parser
Jan 2026     97,000        Ralph extraction factory + quality framework
Feb 2026     1,086,000     500-loop agent (massive duplication)
Mar 7        750,000       Great Triage (purged 500K dupes, cut 414 functions)
Mar 16       293,000       Testimony-grade extraction begins
Mar 25       350,000+      Dead source revival (Mecum 303K, BJ 63K discovered)
Mar 26       823,000       Non-AI drain complete, this handbook written
```

---

## 2. Repeated Mistakes

These 12 patterns have cost weeks of engineering time, hundreds of dollars in burned API credits, and multiple production outages. 7 of 12 are still recurring.

Each entry shows: the pattern, how many times it happened, whether it's fixed, and the cost.

---

### REPEAT 01: BaT Extractor Rewritten Instead of Fixed

```
TIMES:       7+ distinct extractors built
FIXED:       Partially — canonical exists, new scripts still spawn
COST:        Weeks of engineering. Each duplicate = fragmented data paths.
```

The BaT extraction function has been written at least 7 times:

1. `bat-extract` — original (deleted 2026-03-07)
2. `bat-simple-extract` — simplified (deleted 2026-03-07)
3. `comprehensive-bat-extraction` — comprehensive (deprecated)
4. `import-bat-listing` — import variant (deprecated)
5. `bat-extract-complete-v*` — versioned (deprecated)
6. `extract-premium-auction` — premium routing layer (was routing to deleted function)
7. `extract-bat-core` — the canonical survivor, now at v3.0.0

Plus 6 local scripts: `bat-drain-queue.mjs`, `bat-extract-direct.mjs`, `bat-fast-fetch.mjs`, `bat-fetch-and-extract.mjs`, `backfill-shallow-bat.mjs`, `backfill-bat-prices.sh`

**As recently as 2026-03-25**, 4 new BaT scripts were created in a single session.

**The rule:** `extract-bat-core` is canonical. Before creating a new BaT extraction script, check if the existing one can be modified. It almost always can.

---

### REPEAT 02: LLM/API Credits Exhausted

```
TIMES:       6+ incidents across 4 providers
FIXED:       NO — keeps recurring
COST:        Days of pipeline downtime per incident. $399 burned in one session.
```

| Date | Provider | Impact |
|------|----------|--------|
| 2026-02 | OpenAI | 2,362 failures, all FB + generic extraction dead |
| 2026-03-20 | Anthropic | 141K queue items blocked, $399.12 burned |
| 2026-03-20 | Gemini | Key expired, Stream E skipped entirely |
| 2026-03-22 | Anthropic | Condition extraction blocked |
| 2026-03-22 | Anthropic + Google | Both quotas exhausted simultaneously |
| 2026-03-25 | Anthropic | Condition extraction blocked again |
| Multiple | Firecrawl | 5+ documented credit exhaustion events |

**No automated alerting exists.** No budget caps. No credit balance monitoring. The fallback chain (Ollama → Kimi → Grok → Gemini → Claude) was built reactively after each incident.

**The rule:** Never use a paid LLM as primary for batch operations without credit monitoring. Ollama is the zero-cost floor. Use it first.

---

### REPEAT 03: Batch Size Too Large → Timeout/Outage

```
TIMES:       12+ incidents across different subsystems
FIXED:       Partially — new functions keep rediscovering the limit
COST:        Multiple API outages, $1.5-3K/mo wasted crons before triage
```

Examples:
- `vehicle_valuation_feed` MV: 16 cron runs all failed with 120s timeout (830MB MV needs 3-5 min)
- `bat-snapshot-parser`: scanned 367K rows (59GB) to find 291 unprocessed. No index. Killed by 120s timeout.
- `process-bat-extraction-queue`: forced batchSize=1, causing 104-day backlog for 30K items
- `yono-batch-process`: query timeout on 34M rows
- PGRST002 outage: 44 per-minute crons saturated all 32 max_running_jobs

**The rule:** See Section 0 "Batch Size Rules" table. Scraping = max 3. LLM calls = max 50. DB-only = max 200. Every new function must account for statement_timeout=120s.

---

### REPEAT 04: Duplicate Extractors Built

```
TIMES:       9 deleted in triage + ongoing pattern
FIXED:       Hard Rule exists, pattern continues
COST:        464 functions → $5,600/mo burn, data forks, routing confusion
```

Deleted duplicates (2026-03-07): `bat-extract`, `bat-simple-extract`, `extract-collecting-cars-simple`, `extract-vehicle-data-ollama`, `extract-and-route-data`, `smart-extraction-router`, `extract-using-catalog`, `extract-with-proof-and-backfill`, `analyze-image`.

The `_archived/` directory contained 259 dead functions.

**The rule:** Check TOOLS.md before building ANYTHING. If a function covers 80% of your need, modify it. Don't create a new one.

---

### REPEAT 05: Raw fetch() Instead of archiveFetch()

```
TIMES:       95% non-compliant at triage (only 5% used archiveFetch)
FIXED:       NO — 36/40 extractors still vulnerable to auth redirect
COST:        Hundreds of thousands of unarchived pages. Login pages cached as data.
```

At the 2026-03-07 triage, only 5% of extractors used `archiveFetch()`. By 2026-03-20, compliance was 58.6%. That means 41.4% still use raw fetch — and every one of them is vulnerable to the auth redirect bug (REPEAT 12) and fails to archive pages for future re-extraction.

**The rule:** Use `archiveFetch()` for ALL external page fetches. The only exception is JSON API endpoints.

---

### REPEAT 06: Triggers Break Inserts Silently

```
TIMES:       7+ incidents
FIXED:       NO — no systematic trigger audit
COST:        Blocked signups, blocked photo uploads, silent data corruption
```

Examples:
- `refresh_tier_on_image_upload`: referenced dropped table → blocked ALL photo intake
- `create_user_rating_on_signup`: missing search_path → blocked ALL auth user creation
- `trg_auto_work_detection`: empty search_path → ALL vehicle_images inserts fail silently
- 47 triggers on vehicles table so heavy that batch ops require bypassing them

**The rule:** After any DDL change, run: `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgenabled = 'O' AND NOT tgisinternal;` and verify triggers still reference existing objects.

---

### REPEAT 07: PostgREST/Schema Cache Crash

```
TIMES:       3+ major PGRST002 outages
FIXED:       Partially — rules exist, still happens
COST:        Full API outages. 30K failed extractions in one incident.
```

1. **Feb 27:** 44 per-minute crons saturated 32 max_running_jobs. Full API blackout.
2. **Feb 27:** Unbounded UPDATE ran 30+ minutes, blocked schema cache reload. Another agent's DROP/CREATE INDEX caused lock cascade.
3. **Mar 1+:** 30K BaT extractions failed in 12 hours from schema cache errors.

**The rule:** Never run unbounded UPDATE/DELETE. Batch in 1K chunks with pg_sleep(0.1). Never run DDL while queries are active. If PGRST002 appears: `NOTIFY pgrst, 'reload schema';`

---

### REPEAT 08: Stale Processing Locks

```
TIMES:       6+ mass-release events
FIXED:       Partially — auto-release exists but items re-stick
COST:        Tens of thousands of items stuck for days/weeks
```

The same 28K vehicle_images batch appears stuck in DONE.md on three separate dates — released, re-stuck, released again. The `release_stale_locks()` function exists but the re-sticking suggests the root cause (function crashes without cleanup) isn't fully addressed.

**The rule:** All queue workers must use lock TTL. The cleanup cron must run hourly. After any mass release, verify items don't re-lock within 24 hours.

---

### REPEAT 09: ConceptCarz Fabricated Data Imported as Real

```
TIMES:       1 massive incident, multiple cleanup sessions
FIXED:       YES — prices quarantined, confidence column added
COST:        Months of cleanup. 265K records reclassified. Every valuation contaminated.
```

348K ConceptCarz shells imported Feb 6 with zero provenance. 90.7% of sale_price values were fabricated averages, not real prices. Polluted the entire pricing dataset for weeks before discovery.

**The rule:** Never bulk-import a new source without sampling 50+ records for quality. `base_trust_score` exists for a reason — reference catalogs get 0.70, not 0.90.

---

### REPEAT 10: primary_image_url Not Set

```
TIMES:       4 discovery+fix cycles, 320K+ records backfilled
FIXED:       YES — extractors now set the field
COST:        Every vehicle showed as a blank card until backfilled
```

**The rule:** Every extractor that writes to `vehicle_images` must also set `vehicles.primary_image_url`.

---

### REPEAT 11: KSL Scraping (Always 403)

```
TIMES:       3,037 wasted attempts
FIXED:       YES — permanently skipped
COST:        ~$30 compute + queue opportunity cost
```

KSL returns 403 for every scraping method. Despite being documented, items kept being queued and retried.

**The rule:** KSL requires Playwright + residential proxy. Do not queue KSL URLs through the standard pipeline.

---

### REPEAT 12: Auth Redirect → Login Page Cached as Vehicle Data

```
TIMES:       36/40 extractors affected
FIXED:       NO — only 2 of 36 patched
COST:        Unknown quantity of garbage data cached as success
```

The worst active bug. `fetch()` follows 302 to login page. Login page returns 200 OK. `response.ok` passes. Garbage HTML is processed and cached for 24 hours. The shared infrastructure (`batFetcher.ts`, `hybridFetcher.ts`, `archiveFetch.ts`) is unfixed.

**The rule:** Every fetch must use `redirect: "manual"`. Every response must be checked for login page patterns. This is the #1 priority fix in the extraction system.

---

### Scoreboard

```
STILL RECURRING (7):
  ❌ LLM credit exhaustion (6+ times)
  ❌ Batch size timeouts (12+ times)
  ❌ Duplicate extractors (ongoing)
  ❌ Raw fetch() usage (41% non-compliant)
  ❌ Trigger breakage (no audit)
  ❌ Schema cache crashes (rules exist, still happens)
  ❌ Auth redirect caching (36/40 vulnerable)

FIXED (5):
  ✅ ConceptCarz fabricated data
  ✅ primary_image_url propagation
  ✅ KSL scraping (permanently skipped)
  ✅ Stale lock cleanup (auto-release exists)
  ✅ BaT extractor canonical (extract-bat-core v3)
```

---

## 3. Method Catalog

Each card documents a proven extraction method. Cards are ordered by reliability.

---

### METHOD 01: Snapshot Re-Extraction (batch-extract-snapshots)

```
STATUS:      BEST — free, offline, highest throughput
FUNCTION:    supabase/functions/batch-extract-snapshots/index.ts
SUCCESS:     85%+ (depends on snapshot quality)
THROUGHPUT:  1,200–2,400 vehicles/hour
COST:        $0 (uses archived HTML only)
BEST FOR:    Backfilling fields from already-fetched pages
LLM:         None — pure regex + JSON parsing
VERSION:     batch-extract-snapshots:2.0.0
```

**How it works:**
Parses stored HTML from `listing_page_snapshots` using platform-specific regex patterns. No network calls, no LLM calls, no API costs. Supports BaT, Barrett-Jackson, Mecum, Cars & Bids, Bonhams.

**Modes:**
- `skeleton` — VIN, year, make, model only
- `sparse` — Add mileage, transmission, engine, color, price
- `deep` — Extract images, seller, description, auction metadata
- `force` — Re-extract even if previously processed

**Input:**
```json
{
  "batch_size": 50,
  "platform": "bat",
  "mode": "sparse",
  "dry_run": false,
  "offset": 0
}
```

**Failure modes:**
- Empty snapshots (JS-rendered galleries not captured in HTML)
- Stale HTML structure (platform redesign)
- Missing snapshots (never fetched)

**When to use:** Always try this first. If a snapshot exists, re-extract from it before making any network call.

---

### METHOD 02: API Discovery (Algolia / Strapi / REST)

```
STATUS:      BEST — structured data, zero rate limits
FUNCTION:    Various scripts (mecum-algolia-discovery.mjs, bj-api-discovery.mjs)
SUCCESS:     90%+ (structured JSON, no parsing ambiguity)
THROUGHPUT:  10,000+/hour
COST:        $0 (public APIs)
BEST FOR:    Bulk listing discovery and structured field extraction
LLM:         None
```

**Discovered APIs:**

| Platform | API Type | Endpoint | Notes |
|----------|----------|----------|-------|
| Mecum | Algolia | App ID `U6CFCQ7V52` | 303K lots, search index |
| Barrett-Jackson | Strapi | `/api/docket` | 63K+ lots, public, no auth |
| BaT | REST | `/wp-json/bringatrailer/1.0/data/listings-filter` | 277-page limit without session token |
| Hagerty | Next.js | `__NEXT_DATA__` JSON blob | Complete listing state |
| Mecum | Next.js | `__NEXT_DATA__` JSON blob | Taxonomy, VIN, content blocks |
| ClassicCars.com | Azure Blob | `ccpublic.blob.core.windows.net/sitemap*` | 71 sitemaps, 35K URLs |

**How to discover new APIs:**
1. Open browser DevTools → Network tab → filter XHR/Fetch
2. Search page source for `algolia`, `strapi`, `__NEXT_DATA__`, `graphql`, `api/v`
3. Check `/robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`
4. Try common API paths: `/api/`, `/wp-json/`, `/graphql`
5. Check for Algolia fingerprints: `algoliaAgent`, `x-algolia-api-key` in HTML

**Failure modes:**
- API pagination limits (BaT caps at 277 pages)
- API keys rotated (Algolia keys embedded in page source)
- Rate limits on search APIs (Mecum Algolia has quotas)

**When to use:** Before building any HTML scraper, spend 15 minutes probing for APIs. The payoff is enormous.

---

### METHOD 03: Direct HTML + Regex (extract-bat-core v3)

```
STATUS:      ACTIVE — gold standard for BaT
FUNCTION:    supabase/functions/extract-bat-core/index.ts
SUCCESS:     91.3% accuracy (best of all extractors)
THROUGHPUT:  12–30 vehicles/hour (single listing, full extraction)
COST:        ~$0 (amortized via archiveFetch caching)
BEST FOR:    BaT listings with full field extraction
LLM:         None — pure regex + DOM parsing
VERSION:     extract-bat-core:3.0.0
```

**Architecture:**
```
1. archiveFetch(url) → HTML (cached or fresh)
2. Parse identity from <h1 class="post-title"> or og:title or <title>
3. Window essentials block to first 50KB (prevents comment pollution)
4. Extract: VIN, mileage, colors, transmission, engine, body_style, drivetrain
5. Parse Listing Stats table (id="listing-bid") for price/reserve
6. Extract images from gallery JSON data attribute
7. normalizeVehicleFields() → qualityGate()
8. Upsert: vehicles → vehicle_events → vehicle_images → auction_events
9. Record extraction_metadata per-field provenance
```

**Critical implementation details:**
- **Essentials windowing:** Only search first 50KB for price/specs. Full page text includes comments that mention other vehicles' prices — causes false matches.
- **Price hierarchy:** Auction result table > title text > essentials text. Never search full page.
- **URL slug identity:** BaT URL slugs carry Y/M/M (e.g., `/listing/1967-porsche-911s`). Trust slug over title for identity.
- **Multi-word makes:** `alfa-romeo` → "Alfa Romeo", `aston-martin` → "Aston Martin", `rolls-royce` → "Rolls-Royce" (mapped in parser)
- **Rate limit detection:** Response < 500 bytes = rate limit page. Skip and retry.

**Field accuracy (v3.0.0 with quality gates):**

| Field | Accuracy | Notes |
|-------|----------|-------|
| VIN | 90.7–92.8% | 17-char validation + MOD-11 checksum |
| Mileage | 87.2–87.8% | Handles "56k miles", "56,000", "TMU" |
| Transmission | 67.9% | Was 5.6% before v3 fix |
| Price | 75.4–80.6% | Hardest field — complex signals |

**Failure modes:**
- Auth redirect to login page (fixed in v3 with `redirect: "manual"`)
- Redesigned HTML structure (rare, BaT is stable)
- Gallery data attribute missing (old listings)

---

### METHOD 04: Kimi k2-turbo Text Extraction

```
STATUS:      ACTIVE — primary LLM for text extraction
FUNCTION:    supabase/functions/discover-description-data/index.ts
SUCCESS:     ~80% (depends on description quality)
THROUGHPUT:  1,200–3,600 vehicles/hour (5 parallel calls)
COST:        ~$0.001/vehicle (cheapest paid LLM)
BEST FOR:    Condition extraction from descriptions
LLM:         Kimi k2-turbo-preview (OpenAI-compatible API)
```

**Why Kimi wins:**
- ~2 second response time (vs 10–40s for Grok-3-mini)
- OpenAI-compatible API (drop-in replacement)
- Reliable JSON output without reasoning token overhead
- Cheapest paid option that produces quality extraction

**Configuration:**
```
Temperature:  0.1
Max tokens:   2048
Parallelism:  5 concurrent calls per batch
Time budget:  50s per invocation (10s cleanup buffer)
Batch size:   10–50 vehicles
```

**Fallback chain:** Kimi k2-turbo → Grok-3-mini → Gemini 2.5 Flash Lite → Claude Haiku

**Failure modes:**
- Descriptions < 500 chars yield near-zero condition observations
- JSON parsing failures (strip markdown code blocks from response)
- API key rotation (check env var `KIMI_API_KEY`)

---

### METHOD 05: Grok-3-mini Text Extraction

```
STATUS:      ACTIVE — slow fallback
FUNCTION:    discover-description-data (fallback chain position 2)
SUCCESS:     ~80%
THROUGHPUT:  180–360 vehicles/hour (reasoning tokens burn time)
COST:        $0.30/MTok input, $0.50/MTok output
BEST FOR:    Fallback when Kimi is down
LLM:         xAI Grok-3-mini
```

**The reasoning token problem:**
Grok-3-mini uses chain-of-thought reasoning by default. A simple extraction that takes Kimi 2 seconds takes Grok 10–48 seconds because it "thinks" about the answer. The quality is comparable but throughput is 5–10x worse.

**When to use:** Only as fallback. Never as primary for batch operations.

---

### METHOD 06: Gemini Flash Lite Text Extraction

```
STATUS:      ACTIVE — rate limited but free
FUNCTION:    discover-description-data (fallback chain position 3)
SUCCESS:     ~75%
THROUGHPUT:  600–1,200 vehicles/hour
COST:        $0 (free tier)
BEST FOR:    High-volume batch when budget is zero
LLM:         gemini-2.0-flash-lite (model ID used in code)
```

**Rate limiting:**
Google imposes per-minute and per-day quotas on free tier. Expect throttling at scale.

**JSON output quirk:**
Gemini sometimes wraps JSON in markdown code blocks (` ```json ... ``` `). All callers must strip these before parsing.

**When to use:** Budget-constrained batch operations. Acceptable quality for bulk enrichment.

---

### METHOD 07: Ollama Local Extraction (qwen2.5:7b)

```
STATUS:      ACTIVE — free, unlimited, always available
FUNCTION:    Local scripts (enrich-fb-batch.mjs, enrich-fb-rules.mjs)
SUCCESS:     75–80%
THROUGHPUT:  720 vehicles/hour
COST:        $0 (runs on local hardware)
BEST FOR:    Baseline extraction, fallback when all cloud LLMs are down
LLM:         qwen2.5:7b via Ollama
```

**Setup:**
```bash
ollama pull qwen2.5:7b
# Available at http://localhost:11434/api/generate
```

**Task routing defaults (from llmRouter.ts):**

| Task | Primary Model | Fallback |
|------|--------------|----------|
| title_parsing | nuke-agent (local) | claude-haiku-4-5 |
| extraction | nuke-agent (local) | claude-haiku-4-5 |
| batch_enrichment | qwen3-30b | nuke-agent |
| comment_mining | nuke-agent | qwen2.5-7b |
| description_discovery | nuke-agent | qwen2.5-7b |

**When to use:** Always have Ollama running as the zero-cost floor. Cloud LLMs are for quality-critical work.

---

### METHOD 08: Claude Haiku Text/Vision

```
STATUS:      BLOCKED (credits exhausted as of 2026-03-22)
FUNCTION:    haiku-extraction-worker, batch-comment-discovery
SUCCESS:     80%+ (when funded)
THROUGHPUT:  600–1,200 vehicles/hour
COST:        $1/MTok input, $5/MTok output
BEST FOR:    Quality-critical extraction, comment analysis, title OCR
LLM:         claude-haiku-4-5-20251001
```

**Credit exhaustion history:**
- $399.12 burned in a single period (high-volume comment mining + description extraction)
- No rate limiting or budget caps were configured
- 5,910 queue items blocked when credits hit zero

**Lesson:** Never use Claude as primary for batch operations without credit monitoring. Reserve for quality review and escalation.

**Escalation thresholds (from agent tier system):**
- Quality score < 0.6 → escalate from Haiku to Sonnet
- Missing Y/M/M → escalate
- Confidence < 0.6 → escalate
- Auto-approve threshold: 0.9

---

### METHOD 09: extract-vehicle-data-ai (Generic AI)

```
STATUS:      DEPRECATED — do not use as primary
FUNCTION:    supabase/functions/extract-vehicle-data-ai/index.ts
SUCCESS:     12.6% accuracy (worst of all extractors)
THROUGHPUT:  30–120 vehicles/hour
COST:        $0–$0.50/vehicle (multiple retries)
BEST FOR:    Nothing — use platform-specific extractors instead
LLM:         Gemini → Claude → OpenAI (all broken at various times)
```

**Why 12.6% accuracy:**
- Generic prompt with no domain specialization
- No field validation or confidence scoring
- LLM hallucination unconstrained (invents makes like "Hemi Veney")
- All three LLM providers have failed simultaneously (OpenAI quota, Anthropic key issue, Google key mis-mapped as `GEMINI_API_KEY` instead of `GOOGLE_AI_API_KEY`)
- ~14% error rate per batch from hallucinations
- Non-vehicles pass through as valid

**What to use instead:**
1. Platform-specific extractor (BaT, C&B, Mecum, etc.)
2. batch-extract-snapshots for archived HTML
3. Ollama local extraction for unknown sources
4. Kimi k2-turbo with domain-specific prompt

---

### METHOD 10: Firecrawl JS Rendering

```
STATUS:      EXPENSIVE — use only for JS-rendered sites
FUNCTION:    _shared/firecrawl.ts
SUCCESS:     10% (Facebook), 85%+ (C&B, Hagerty)
THROUGHPUT:  120–360 pages/hour
COST:        ~$0.01/page
BEST FOR:    React/Next.js SPAs that require JS rendering
LLM:         None (rendering only)
```

**Configuration:**
```typescript
{
  timeout: 45000,        // 45s
  waitFor: 3000,         // 3s JS render wait
  formats: ["html", "markdown"],
  actions: [],           // optional page interactions
  proxy: "stealth",      // stealth | auto | basic
  retries: 3,            // exponential backoff (800ms base, 8s max)
}
```

**Block detection:** Returns `blockedSignals` array for Cloudflare, CAPTCHA, PerimeterX, KSL.

**Credit exhaustion risk:** Firecrawl has its own quota. When exhausted, returns HTTP 402. Multiple incidents of Firecrawl credits running out during batch operations.

**When to use:** Only when direct fetch returns empty/shell HTML. Check snapshot cache first.

---

### METHOD 11: Kimi Vision (moonshot-v1-128k)

```
STATUS:      BROKEN — rejects external image URLs
FUNCTION:    N/A (attempted, failed)
SUCCESS:     N/A
THROUGHPUT:  N/A
COST:        N/A
BEST FOR:    Nothing (broken)
LLM:         moonshot-v1-128k (Kimi vision model)
```

**The problem:** Kimi's vision model rejects URLs that don't point to Kimi's own CDN. Cannot pass external image URLs for analysis. Would need to download images and re-upload via Kimi's file API.

**Alternative:** Use Gemini 2.5 Flash with base64-encoded images, or Claude Haiku vision (when funded).

---

### METHOD 12: Gemini Vision (base64)

```
STATUS:      FRAGILE — JSON output unreliable
FUNCTION:    score-vehicle-condition, yono-analyze
SUCCESS:     20% (JSON parsing failures)
THROUGHPUT:  60–120 images/hour
COST:        Free tier (with quotas)
BEST FOR:    Condition scoring when other vision models unavailable
LLM:         Gemini 2.5 Flash
```

**The JSON problem:** Gemini vision frequently returns malformed JSON or wraps output in markdown code blocks. Requires aggressive post-processing and retry logic.

**When to use:** Only when Claude vision credits are exhausted. Prefer Claude Haiku vision for image analysis.

---

### METHOD 13: BaT Queue Drain (bat-drain-queue.mjs)

```
STATUS:      PRODUCTION — the throughput champion
FUNCTION:    scripts/bat-drain-queue.mjs (local Node.js script, NOT edge function)
SUCCESS:     95%+ (URL parsing + bulk insert)
THROUGHPUT:  10,000 vehicles/hour (URL slug parsing, no network fetch per vehicle)
COST:        $0 (URL parsing + direct DB writes)
BEST FOR:    Bulk BaT vehicle creation from URL slugs
LLM:         None — pure URL string parsing
```

**Architecture:**
- Single persistent DB connection (NOT per-request connections)
- 20 concurrent fetches, 300ms delay between batches
- 100 URLs per claim from queue
- Batch inserts: 1,000 rows with triggers disabled during bulk ops
- Parse year/make/model directly from BaT URL slugs

**Critical discovery:** Multiple connections per request achieved 25K/hr fetch rate but the queue never drained (connection pool exhaustion + lock contention). Single persistent connection at 10K/hr actually drains the queue.

---

### METHOD 14: Rule-Based Enrichment (Deterministic)

```
STATUS:      ACTIVE — zero false positives
FUNCTION:    scripts/enrich-fb-rules.mjs (local Node.js script)
SUCCESS:     100% (human-verified patterns)
THROUGHPUT:  10,000+ vehicles/hour
COST:        $0
BEST FOR:    Body style, drivetrain, trim inference from known patterns
LLM:         None — pure regex/lookup rules
```

**Pattern examples:**
- "Crew Cab" in title → body_style = "Crew Cab Pickup"
- "4x4" or "4WD" in title → drivetrain = "4WD"
- "Convertible" in title → body_style = "Convertible"
- Make + Model lookup → default drivetrain (Porsche 911 → RWD)

**When to use:** Always run deterministic rules before LLM enrichment. The rules layer catches 60%+ of missing fields at zero cost.

---

### METHOD 15: Comment Claim Extraction (commentRefinery)

```
STATUS:      ACTIVE — high-value provenance mining
FUNCTION:    supabase/functions/_shared/commentRefinery.ts (shared library)
SUCCESS:     Density-dependent (pre-filtered by regex scoring)
THROUGHPUT:  30 comments per 5–10 seconds
COST:        LLM cost per batch (~$0.01/batch)
BEST FOR:    Extracting factual claims from auction comments
LLM:         Via llmProvider fallback chain (temperature 0.1)
```

**Pre-filter pipeline:**
```
1. Density scoring via 20 regex patterns (weight 0.5–2.0)
2. Seller comments: 1.5x boost
3. Expert author: +50% density
4. Pass threshold: density ≥ 0.3 AND ≥ 15 words
   OR: density ≥ 0.1 AND ≥ 30 words AND seller
5. Only passed comments go to LLM
```

**Claim categories:**
- **A:** Specifications (engine, transmission, VIN, option codes, production facts)
- **B:** Condition (rust, paint, body, mechanical, restoration state)
- **C:** Provenance (sightings, ownership, work records, previous sales)
- **D:** Market signals (prices, comparables)
- **E:** Library knowledge (general specs, common issues)

**Temporal decay (condition claims only):**

| Claim Type | Half-Life |
|------------|-----------|
| paint_condition | 2 years |
| mechanical_condition | 3 years |
| interior_condition | 3 years |
| body_condition | 4 years |
| rust_condition | 5 years |

**Quote validation:** Every extracted quote must be an exact substring of the source comment. LLM fabricated quotes are rejected.

---

### METHOD 16: Document OCR (extract-title-data)

```
STATUS:      ACTIVE — for title documents, build sheets
FUNCTION:    supabase/functions/extract-title-data/index.ts
SUCCESS:     85%+ (depends on document quality)
THROUGHPUT:  60–120 documents/hour
COST:        $0.01–0.05/document (GPT-4o vision)
BEST FOR:    VIN, odometer, owner names from title documents
LLM:         GPT-4o (primary, detail: high) → Claude Sonnet (fallback)
```

**Fields extracted:** VIN, year, make, model, title_number, state, issue_date, owner_names, owner_address, odometer, odometer_status. Each field gets a 0–100 confidence score.

---

## 4. LLM Configuration Guide

### Model Selection Matrix

| Task | Primary Model | Fallback | Temperature | Max Tokens | Cost |
|------|--------------|----------|-------------|-----------|------|
| Title parsing | nuke-agent (Ollama) | claude-haiku-4-5 | 0.1 | 256 | $0 |
| Listing extraction | nuke-agent (Ollama) | claude-haiku-4-5 | 0.1 | 2048 | $0 |
| Description discovery | nuke-agent (Ollama) | qwen2.5-7b | 0.1 | 2048 | $0 |
| Condition extraction | Kimi k2-turbo | Grok-3-mini | 0.1 | 2048 | ~$0.001 |
| Comment mining | nuke-agent (Ollama) | qwen2.5-7b | 0.1 | 2048–4096 | $0 |
| Quality review | claude-sonnet-4-6 | kimi-k2.5 | 0.1 | 2048 | $3/MTok |
| Image analysis | claude-haiku-4-5 | gpt-4o | 0.1 | 1500 | $1/MTok |
| Document OCR | gpt-4o | claude-sonnet | 0.1 | 1500 | $2.50/MTok |
| Batch enrichment | qwen3-30b | nuke-agent | 0.1 | 2048 | $0 |

### Provider Cost Table

| Provider | Model | Input Cost | Output Cost | Context | Speed | Notes |
|----------|-------|-----------|-------------|---------|-------|-------|
| Ollama | qwen2.5:7b | $0 | $0 | 8K | Fast | Local, unlimited |
| Ollama | DeepSeek R1 | $0 | $0 | 32K | Medium | Local, unlimited |
| Kimi | k2-turbo-preview | ~$0.001/MTok | ~$0.002/MTok | 128K | Fast (~2s) | OpenAI-compatible |
| Google | gemini-2.0-flash-lite | $0 | $0 | 1M | Fast | Free tier, rate limited |
| xAI | grok-3-mini | $0.30/MTok | $0.50/MTok | 128K | Slow (10–48s) | Reasoning tokens overhead |
| Anthropic | claude-haiku-4-5 | $1/MTok | $5/MTok | 200K | Fast | Credits often exhausted |
| Anthropic | claude-sonnet-4-6 | $3/MTok | $15/MTok | 200K | Medium | Quality review only |
| OpenAI | gpt-4o | $2.50/MTok | $10/MTok | 128K | Medium | Quota often exhausted |
| OpenAI | gpt-4o-mini | $0.15/MTok | $0.60/MTok | 128K | Fast | Budget option |

### API Endpoints

```bash
# Kimi (OpenAI-compatible)
KIMI_API_KEY=...
KIMI_BASE_URL=https://api.moonshot.cn/v1

# xAI Grok (OpenAI-compatible)
XAI_API_KEY=...
XAI_BASE_URL=https://api.x.ai/v1

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434

# All env vars live in /Users/skylar/nuke/.env (encrypted with dotenvx)
# AND in Supabase project secrets (for edge functions)
# Always use `dotenvx run --` to inject them — never source .env directly

# Google Gemini
GEMINI_API_KEY=...
# Note: Some functions expect GOOGLE_AI_API_KEY — check before deploying

# Anthropic
ANTHROPIC_API_KEY=...

# OpenAI
OPENAI_API_KEY=...
```

### JSON Output Quirks

**Problem:** LLMs frequently return invalid JSON. Common issues:

| Issue | Models Affected | Fix |
|-------|----------------|-----|
| Markdown code blocks (` ```json ... ``` `) | Gemini, Grok | Strip with regex before parsing |
| Trailing commas | All models | Use lenient JSON parser |
| Reasoning preamble before JSON | Grok-3-mini | Extract JSON from response with regex |
| Incomplete JSON (token limit) | All models | Increase max_tokens, reduce prompt |
| HTML entities in strings | Gemini | Decode HTML entities post-parse |

**Standard JSON extraction pattern:**
```typescript
function extractJSON(text: string): any {
  // Strip markdown code blocks
  let cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  // Find JSON boundaries
  const start = cleaned.indexOf('{') !== -1 ? cleaned.indexOf('{') :
                cleaned.indexOf('[') !== -1 ? cleaned.indexOf('[') : -1;
  if (start === -1) throw new Error('No JSON found');
  const end = cleaned.lastIndexOf('}') !== -1 ? cleaned.lastIndexOf('}') + 1 :
              cleaned.lastIndexOf(']') + 1;
  cleaned = cleaned.slice(start, end);
  return JSON.parse(cleaned);
}
```

### Prompt Inventory

All extraction prompts use **temperature 0.1** (deterministic). Key prompts:

**1. Open-ended description discovery** (`discover-description-data`):
- Input: year, make, model, sale_price, description text
- Output: Free-form JSON with dynamic keys (acquisition, ownership_history, service_history, modifications, condition, etc.)
- Instruction: "Extract EVERYTHING factual... Be exhaustive. Capture everything. Return ONLY valid JSON."

**2. Condition extraction** (`discover-description-data`, condition_backfill mode):
- Input: year, make, model, description text
- Output: JSON array of `{category, severity, component, is_positive, summary, quote}`
- Categories: imperfection, modification, paint, rust, mechanical, interior, missing_part, documentation, structural, electrical, glass, trim, wheels_tires, general
- Severity: info, minor, moderate, major, positive
- Quote validation: must be exact substring of source description

**3. Comment claim extraction** (`commentRefinery`):
- Input: vehicle context, numbered comment batch
- Output: JSON array per comment with `{claim_type, category, field_name, proposed_value, confidence, temporal_anchor, reasoning, quote, contradicts_existing, observation_kind}`
- Rules: Only factual claims (not opinions, greetings). Quote must be exact substring. Confidence 0.5–0.95. Seller bonus +0.10.

**4. Generic listing extraction** (`extract-vehicle-data-ai`):
- Input: URL, source, first 30K chars of content
- Output: Normalized JSON with 17+ fields + confidence score
- Critical rules: "Do NOT fabricate ANY data", "NEVER guess prices", "NORMALIZE make names"
- Confidence: 0.9+ = all key fields, 0.5–0.9 = partial, <0.5 = minimal

**5. Haiku tier extraction** (`haiku-extraction-worker`):
- Input: URL, content type, truncated HTML/markdown (12K chars)
- Output: Structured JSON with year, make, model, trim, VIN, mileage, colors, engine, transmission, drivetrain, body_style, prices, status, seller, description, images, confidence, notes
- Escalation: quality < 0.4 or missing Y/M/M → Sonnet review

**6. Title parsing** (`haiku-extraction-worker`):
- Input: title string
- Output: `{year, make, model, trim, confidence}`
- Rules: Normalize makes, ignore platform suffixes ("for sale on BaT Auctions")

**7. Document OCR** (`extract-title-data`):
- Input: vehicle title document image
- Output: VIN, year, make, model, title_number, state, issue_date, owner_names, odometer + per-field confidence 0–100
- Model: GPT-4o with detail: high (vision)

---

### Method Selection Decision Tree

```
START: What extraction task do you have?
  │
  ├─ "Extract from a KNOWN source (BaT, Mecum, C&B, etc.)"
  │    │
  │    ├─ Does a snapshot exist in listing_page_snapshots?
  │    │    YES → METHOD 01: batch-extract-snapshots ($0, 1,200/hr)
  │    │    NO  ↓
  │    │
  │    ├─ Does a platform-specific extractor exist? (check TOOLS.md)
  │    │    YES → Use it (METHOD 03 for BaT, etc.)
  │    │    NO  ↓
  │    │
  │    └─ Does the source have an API? (probe first — METHOD 02)
  │         YES → Use API discovery (10K+/hr, $0)
  │         NO  → Firecrawl (METHOD 10) → parse with Kimi (METHOD 04)
  │
  ├─ "Extract CONDITIONS from descriptions"
  │    → METHOD 04: Kimi k2-turbo via discover-description-data
  │    → See Runbook: Condition Extraction (Section 5)
  │
  ├─ "Extract CLAIMS from auction comments"
  │    → METHOD 15: commentRefinery pipeline
  │    → Pre-filters by density score, then LLM extraction
  │
  ├─ "Bulk discover listings from a new source"
  │    → METHOD 02: API Discovery first (Algolia/Strapi/sitemap)
  │    → If no API: Firecrawl sitemap crawl → import_queue
  │
  ├─ "Enrich existing vehicles with missing fields"
  │    → METHOD 14: Rule-based enrichment first ($0, 100% precision)
  │    → Then METHOD 07: Ollama local ($0, 720/hr)
  │    → Then METHOD 04: Kimi k2-turbo (~$0.001/vehicle)
  │
  └─ "Extract from a completely UNKNOWN source"
       → DO NOT use extract-vehicle-data-ai (12.6% accuracy)
       → Firecrawl (METHOD 10) → Kimi/Ollama extraction
       → Register source in observation_sources first
```

---

## 5. Architecture Patterns

### PATTERN 1: Snapshot First (archiveFetch)

```
RULE: Never use raw fetch(). Always use archiveFetch().
FILE: supabase/functions/_shared/archiveFetch.ts
```

Every page fetch goes through `archiveFetch()` which:
1. Checks `listing_page_snapshots` cache (default TTL by platform)
2. If miss: fetches via batFetcher (BaT), Firecrawl (JS sites), or direct fetch
3. Auto-archives HTML + markdown to `listing_page_snapshots`
4. Returns `{ html, markdown, source: "cache"|"direct"|"firecrawl", snapshotId }`

**Cache TTL by platform:**
- Completed auctions: 10 years (315M seconds) — content never changes
- Active listings/marketplaces: 24 hours
- Default: 7 days

**Compliance:** Was 5% before March 2026 triage. Now enforced as hard rule.

> "Fetch once, extract forever."

---

### PATTERN 2: API Discovery Beats Scraping

```
RULE: Before writing any HTML scraper, spend 15 minutes probing for APIs.
```

**Discovery checklist:**
1. View page source → search for `algolia`, `strapi`, `graphql`, `__NEXT_DATA__`, `api/v`
2. Browser DevTools → Network tab → filter XHR → look at API calls during page load
3. Check `/robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`
4. Try: `/api/`, `/wp-json/`, `/graphql`, `/_next/data/`
5. Check for Algolia: search for `algoliaAgent`, `x-algolia-api-key`, `x-algolia-application-id`
6. Check for Strapi: search for `/api/` endpoints, Strapi headers

**Proven discovery results:**

| Platform | Discovery | Yield |
|----------|-----------|-------|
| Mecum | Algolia search index | 303K lots |
| Barrett-Jackson | Strapi `/api/docket` | 63K lots |
| BaT | WP REST API | 50K+ URLs |
| Facebook | GraphQL `doc_id=33269364996041474` | National sweep |
| ClassicCars.com | Azure Blob sitemaps | 35K URLs |
| Classic Driver | XML sitemap | 54K URLs |

---

### PATTERN 3: Validate Before Insert

```
RULE: Every extraction passes quality gates before touching the database.
FILE: supabase/functions/_shared/extractionQualityGate.ts
```

**Quality gate checks:**
- Year in range 1885 to current+2
- Make not polluted (no HTML, no auction metadata in field)
- Model not a full listing title
- VIN passes 17-char validation + MOD-11 checksum
- Price sanity: not $0, not > $100M
- No HTML tags in text fields
- Minimum 3 non-null fields (MIN_FIELDS threshold)

**Quality scoring:**
```
score = (non_null_fields / total_fields) - (validation_issues * 0.1)
       + (has_YMM ? 0.15 : 0) + (has_price ? 0.05 : 0)
```

**Thresholds:**
- `AUTO_APPROVE_THRESHOLD: 0.9` — Insert directly
- `ESCALATION_THRESHOLD: 0.6` — Send to Sonnet for review
- Below 0.4 — Reject, log failure

---

### PATTERN 4: Persistent Connections for Batch

```
RULE: Batch operations use a single persistent DB connection.
```

**Evidence:**
- bat-extract-direct.mjs: 25K/hr fetch, queue never drained (per-request connections)
- bat-drain-queue.mjs: 10K/hr extract, queue drained successfully (single persistent connection)

**Configuration for batch scripts:**
```javascript
// RIGHT: single persistent connection
const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
const client = await pool.connect();

// Process all items through this one connection
for (const batch of batches) {
  await client.query('INSERT INTO vehicles ...');
}

// WRONG: per-request connection
for (const item of items) {
  const client = createClient(); // New connection per item
  await client.from('vehicles').insert(item);
}
```

---

### PATTERN 5: Source-Agnostic Pipeline (ingest-observation)

```
RULE: All new data flows through ingest-observation with entity resolution.
FILE: supabase/functions/ingest-observation/index.ts
```

**Unified intake contract:**
```json
{
  "source_slug": "bat|facebook|hagerty|...",
  "kind": "comment|listing|condition|sighting|work_record|...",
  "observed_at": "ISO datetime",
  "source_url": "optional",
  "source_identifier": "unique-within-source",
  "content_text": "plain text",
  "structured_data": { "...arbitrary JSON..." },
  "vehicle_id": "uuid (optional — resolved automatically)",
  "vehicle_hints": { "vin": "...", "year": 1967, "make": "Porsche" },
  "agent_model": "kimi-k2-turbo|ollama-qwen|...",
  "extraction_method": "regex|llm|manual"
}
```

**Entity resolution:** VIN match → 0.99 confidence. URL match → 0.95. Y/M/M + state → soft link.

**Deduplication:** SHA256 content_hash prevents duplicate observations.

**Observation flow:**
```
[Any Source] → ingest-observation → vehicle_observations
                                  → discover-from-observations → observation_discoveries
```

---

## 6. Failure Playbook

Every documented failure, its root cause, fix, and prevention rule.

---

### FAILURE 01: Auth Redirect — Silent Data Corruption

```
SEVERITY:    CRITICAL
DISCOVERED:  2026-03-23
IMPACT:      36/40 extractors vulnerable
STATUS:      PARTIALLY FIXED (2 functions patched, 34 remain)
```

**What happens:**
`fetch()` without `redirect: "manual"` silently follows HTTP 302 to login page. Login page returns 200 OK, so `response.ok` passes. Garbage HTML (login form) is processed as vehicle data and cached as success for 24 hours.

**Root cause:** Default fetch behavior follows redirects. No login page detection in shared infrastructure.

**Functions fixed:** `extract-bat-core`, `extract-auction-comments`

**Functions still vulnerable (HIGH RISK):**
- `_shared/batFetcher.ts` — No `redirect: "manual"`
- `_shared/hybridFetcher.ts` — Explicitly uses `redirect: "follow"`
- `_shared/archiveFetch.ts` — Has `isGarbageHtml()` but zero login form detection
- `sync-live-auction` — 5 platform handlers, zero protection
- 20+ other extractors (see `.claude/EXTRACTOR_REDIRECT_AUDIT.md`)

**Prevention rule:** Every fetch call must use `redirect: "manual"` and check for login page patterns:
```typescript
function isLoginPage(html: string): boolean {
  const lower = html.toLowerCase();
  if (lower.includes('id="login-form"')) return true;
  if (lower.includes('action="/login"') || lower.includes('action="/account/login"')) return true;
  if (lower.includes('action="/wp-login.php"')) return true;
  if (lower.includes('name="log"') && lower.includes('name="pwd"')) return true;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].toLowerCase();
    if (title.includes('log in') || title.includes('login') || title.includes('sign in')) return true;
  }
  return false;
}
```

---

### FAILURE 02: Anthropic Credit Exhaustion — Pipeline Halt

```
SEVERITY:    CRITICAL
DISCOVERED:  2026-03-20 (recurred 2026-03-22)
IMPACT:      5,910+ queue items blocked, all LLM extraction halted
STATUS:      WORKAROUND (switched to Ollama/Kimi/Grok)
```

**What happens:**
Anthropic API returns 400 "credit balance is too low". All Claude-based extraction stops. $399.12 burned in a single period with no alerts.

**Root cause:** High-volume extraction (comment mining + description extraction) with no rate limiting, no budget caps, no credit monitoring.

**Fix applied:** Switched primary LLM to Kimi k2-turbo (cheap) with Ollama (free) as fallback.

**Prevention rule:**
1. Never use Claude as primary for batch operations
2. Always have Ollama running as zero-cost floor
3. Fallback chain: Ollama → Kimi k2-turbo → Grok-3-mini → Gemini Flash → Claude Haiku (last resort)
4. Monitor credit balances (TODO: implement hourly check)

---

### FAILURE 03: Supabase Schema Cache Collapse

```
SEVERITY:    CRITICAL
DISCOVERED:  2026-02 (multiple incidents)
IMPACT:      Near-zero extraction success for 6+ hours, ~30K BaT extractions failed
STATUS:      FIXED (reduced concurrency)
```

**What happens:**
Error: `Could not query the database for the schema cache. Retrying.` Connection pool (84 connections, 39 active) approaches pooler limits under aggressive extraction concurrency.

**Root cause:** Too many parallel extraction workers creating individual DB connections.

**Fix:** Reduce concurrency. Use single persistent connections for batch operations. Lower batch sizes. Add retry with exponential backoff on schema cache errors.

**Prevention rule:** Maximum 20 concurrent DB connections across all extraction workers combined.

---

### FAILURE 04: PostgREST Outage from Unbounded UPDATE

```
SEVERITY:    CRITICAL
DISCOVERED:  2026-02-27
IMPACT:      Full API outage (PGRST002 errors on all endpoints)
STATUS:      FIXED (batched migration principle enforced)
```

**What happens:**
A single `UPDATE vehicles SET auction_source = ...` runs 30+ minutes, blocks PostgREST schema cache reload, cascading to full API outage.

**Prevention rule:**
```sql
-- WRONG: locks entire table
UPDATE vehicles SET auction_source = 'barrett-jackson'
WHERE auction_source = 'Barrett-Jackson';

-- RIGHT: batch in 1,000-row chunks
DO $$
DECLARE batch_size INT := 1000; affected INT;
BEGIN
  LOOP
    UPDATE vehicles SET auction_source = 'barrett-jackson'
    WHERE id IN (
      SELECT id FROM vehicles WHERE auction_source = 'Barrett-Jackson' LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
```

---

### FAILURE 05: VIN Deduplication Gap

```
SEVERITY:    HIGH
DISCOVERED:  2026-02
IMPACT:      ~33,600 failures/day, BaT success rate dropped to 29.8–50.6%
STATUS:      FIXED (VIN lookup added to extract-bat-core)
```

**What happens:**
`duplicate key value violates unique constraint "vehicles_vin_unique_index"`. extract-bat-core checked URL-based dedup but NOT VIN. When the same vehicle re-auctioned under a new URL, insert failed.

**Fix:** 3-tier deduplication: external_listings (platform + URL) → VIN exact match → Y/M/M fuzzy → only then INSERT.

**Prevention rule:** Every extractor must check VIN before creating a new vehicle record.

---

### FAILURE 06: Connection Pool Exhaustion (Multiple Connections vs Persistent)

```
SEVERITY:    HIGH
DISCOVERED:  2026-03-24
IMPACT:      Queue not draining despite 25K/hr fetch rate
STATUS:      FIXED (switched to single persistent connection)
```

**What happens:**
`bat-extract-direct.mjs` achieved 25K/hr fetch throughput but the BaT extraction queue never drained. Each request created a new DB connection, causing pool exhaustion and lock contention.

**Fix:** `bat-drain-queue.mjs` uses a single persistent DB connection. Throughput dropped to 10K/hr but the queue actually drains.

**Prevention rule:** Batch operations MUST use a single persistent connection. Never create per-request connections for high-throughput work.

---

### FAILURE 07: Description Length Threshold

```
SEVERITY:    HIGH
DISCOVERED:  2026-03-25
IMPACT:      Wasted LLM budget on zero-value extractions
STATUS:      FIXED (500 char minimum, ORDER BY length DESC)
```

**What happens:**
Descriptions under 500 characters yield zero condition observations. LLM still charges for the attempt. With 30K+ short descriptions in the queue, this burns significant budget.

**Fix:** `discover-description-data` now enforces 500 char minimum and processes longest descriptions first.

**Prevention rule:** Always filter by `LENGTH(description) >= 500` before sending to LLM. Sort longest-first to maximize value per LLM call.

---

### FAILURE 08: Transmission Accuracy Collapse (5.6%)

```
SEVERITY:    HIGH
DISCOVERED:  2026-03-25
IMPACT:      Transmission field nearly useless
STATUS:      FIXED (regex patterns improved in bat-core v3)
```

**What happens:**
BaT transmission extraction regex was too aggressive — stripping valid transmission values. Only 5.6% accuracy on BaT vehicles.

**Fix:** Improved regex patterns in `_shared/batParser.ts`. Accuracy rose to 67.9%.

**Prevention rule:** Always test extraction changes against a sample of 100+ vehicles using `bat-extraction-test-harness` before deploying.

---

### FAILURE 09: Stuck Processing Locks

```
SEVERITY:    MEDIUM
DISCOVERED:  2026-02 (persistent issue)
IMPACT:      751–886 items permanently stuck in "processing"
STATUS:      FIXED (auto-unlock infrastructure)
```

**What happens:**
Edge function crashes without releasing its queue lock. Items stuck in "processing" for 20+ hours, never retried.

**Fix:**
- `release_stale_locks()` SQL function — releases locks older than 30 minutes
- `queue_lock_health` view — monitoring dashboard
- Hourly cron job runs cleanup automatically

**Prevention rule:** All queue workers must have lock TTL. Lock cleanup must run on a cron.

---

### FAILURE 10: KSL.com — 74% of All Failures

```
SEVERITY:    MEDIUM
DISCOVERED:  2026-02
IMPACT:      3,037 permanently failed queue items
STATUS:      ACCEPTED (skip KSL)
```

**What happens:**
KSL returns 403 for all direct fetch and Firecrawl attempts. No public API discovered. Only 3,000 vehicles from KSL in the database.

**Prevention rule:** Skip all KSL items. Mark as `skipped` immediately, not `failed`. Do not retry. Only approach with Playwright + residential proxy if needed.

---

### FAILURE 11: Cars & Bids Cloudflare Block

```
SEVERITY:    MEDIUM
DISCOVERED:  2026-01 (ongoing)
IMPACT:      100% extraction failure rate on direct fetch
STATUS:      WORKAROUND (Firecrawl required)
```

**What happens:**
Cloudflare blocks all direct fetch to carsandbids.com. React SPA requires JS rendering. Only Firecrawl or Playwright can extract.

**C&B-specific gotcha:** Auction IDs are case-sensitive. Do not lowercase URLs.

**Prevention rule:** Always use Firecrawl for C&B. Check snapshot cache first (zero cost re-extraction).

---

### FAILURE 12: extract-vehicle-data-ai Multi-Provider Collapse

```
SEVERITY:    MEDIUM
DISCOVERED:  2026-03 (early)
IMPACT:      12.6% accuracy — all generic extraction compromised
STATUS:      DEPRECATED (use platform-specific extractors)
```

**What happens:**
All three LLM providers fail simultaneously:
- OpenAI: quota exhausted
- Anthropic: key configuration issue (multiple keys conflicting)
- Google: key stored as `GEMINI_API_KEY` but code expects `GOOGLE_AI_API_KEY`

Even when working, generic prompt produces 12.6% accuracy. Hallucinated makes ("Hemi Veney"), junk models ("3"), non-vehicles passed as valid.

**Prevention rule:** Never use generic AI extraction as primary. Build platform-specific extractors with regex + quality gates. Use LLM only for enrichment, not identity.

---

### FAILURE 13: Non-Vehicle Pollution

```
SEVERITY:    LOW
DISCOVERED:  2026-02 (ongoing)
IMPACT:      ~12K non-vehicles in queue (motorcycles, boats, memorabilia)
STATUS:      FIXED (filter applied)
```

**What happens:**
BaT URLs include motorcycles, boats, trailers, memorabilia, parts, model cars. These get extracted as vehicles.

**Filter keywords:** "wheels for", "seat for", "engine for", "memorabilia", "parts", "model car", "poster", "motorcycle", "boat", "trailer"

**Prevention rule:** Filter non-vehicle listings before extraction. BaT URL slugs and titles contain enough signal to filter programmatically.

---

### FAILURE 14: Batch Size Too Large → 504 Gateway Timeout

```
SEVERITY:    MEDIUM
DISCOVERED:  2026-02
IMPACT:      Entire batches lost on timeout
STATUS:      FIXED (max batch_size = 3 for edge functions)
```

**What happens:**
Edge function batch of 10–20 items, each taking 15–30s = 504 Gateway Timeout. Supabase edge functions have a hard 300s limit.

**Prevention rule:** Maximum batch_size = 3 for edge functions that make external calls. For pure DB operations, batch_size up to 200 is fine.

---

## 7. Quick Reference

### Runbook: Condition Extraction from Descriptions

```bash
cd /Users/skylar/nuke

# 1. Check how many descriptions are eligible (≥500 chars, not yet processed)
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/discover-description-data" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"batch_size\": 0, \"mode\": \"condition_backfill\"}"' | jq

# 2. Run a small batch to verify
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/discover-description-data" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"batch_size\": 5, \"mode\": \"condition_backfill\"}"' | jq

# 3. Run at scale with auto-continuation
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/discover-description-data" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"batch_size\": 25, \"mode\": \"condition_backfill\", \"continue\": true}"' | jq

# 4. Verify results
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicle_observations?kind=eq.condition&select=id,vehicle_id,structured_data&limit=5" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"' | jq
```

**Expected response (step 2 — success):**
```json
{
  "discovered": 5,
  "errors": 0,
  "conditions_ingested": 23,
  "condition_errors": 0,
  "remaining": 4821,
  "llm_provider": "kimi",
  "elapsed_ms": 8432
}
```

**Expected response (step 2 — LLM failure):**
```json
{
  "discovered": 0,
  "errors": 5,
  "error_details": "All LLM providers failed: Kimi timeout, Grok 429, Gemini quota",
  "remaining": 4826
}
```
If all providers fail, check credit balances and Ollama availability.

**Expected response (step 4 — verify):**
```json
[
  {
    "id": "a1b2c3d4-...",
    "vehicle_id": "5678efgh-...",
    "structured_data": {
      "category": "rust",
      "severity": "minor",
      "component": "rear wheel wells",
      "is_positive": false,
      "summary": "Minor surface rust on rear wheel wells",
      "quote": "some surface rust on the rear wheel wells"
    }
  }
]
```
If this returns an empty array after running step 2 successfully, check that the cron `apply-description-discoveries` is active (see Runbook: Check Cron Status below).

**Related failures:** FAILURE 02 (credit exhaustion — LLM calls fail silently), FAILURE 07 (descriptions < 500 chars yield zero conditions).

---

### Runbook: New Source Setup

```bash
cd /Users/skylar/nuke

# 1. Register the observation source
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/observation_sources" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"slug\": \"new-source-slug\",
    \"display_name\": \"New Source Name\",
    \"category\": \"auction\",
    \"base_trust_score\": 0.75,
    \"is_active\": true,
    \"supported_observations\": [\"listing\", \"comment\"]
  }"' | jq

# 2. Also register in scrape_sources (required FK for import_queue)
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/scrape_sources" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"name\": \"New Source Name\",
    \"slug\": \"new-source-slug\",
    \"base_url\": \"https://newsource.com\",
    \"is_active\": true
  }"' | jq

# 3. Queue URLs into import_queue
# (Use a script to bulk-insert discovered URLs)

# 4. Verify the queue
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?source_slug=eq.new-source-slug&select=status,count" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"' | jq
```

### Runbook: Backfill from Snapshots

```bash
cd /Users/skylar/nuke

# 1. Check available snapshots for a platform
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/batch-extract-snapshots" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"platform\": \"bat\", \"mode\": \"sparse\", \"batch_size\": 0, \"dry_run\": true}"' | jq

# 2. Run sparse extraction (VIN, mileage, price, specs)
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/batch-extract-snapshots" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"platform\": \"bat\", \"mode\": \"sparse\", \"batch_size\": 50}"' | jq

# 3. Run deep extraction (images, description, seller)
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/batch-extract-snapshots" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"platform\": \"bat\", \"mode\": \"deep\", \"batch_size\": 50}"' | jq
```

### Runbook: Health Check

```bash
cd /Users/skylar/nuke

# 1. Quick database stats
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/db-stats" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq

# 2. Coordination brief (queue health, errors, recommendations)
dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"brief\"}"' | jq

# 3. Check for lock waiters (uses DB credentials from .env via dotenvx)
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "SELECT count(*) as lock_waiters FROM pg_stat_activity WHERE wait_event_type='\''Lock'\'';"'

# 4. Import queue status
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "SELECT status, count(*) FROM import_queue GROUP BY status ORDER BY count DESC;"'

# 5. QA checks
npm run ops:health
npm run ops:smoke
npm run ops:regression
```

### Runbook: Deploy an Extraction Function

```bash
cd /Users/skylar/nuke

# 1. Verify the function exists in TOOLS.md
grep "my-new-extractor" TOOLS.md

# 2. Type-check
deno check supabase/functions/my-new-extractor/index.ts

# 3. Deploy (use --no-verify-jwt ONLY if the function implements its own auth)
# Default: JWT required — callers must pass Authorization: Bearer <jwt>
supabase functions deploy my-new-extractor
# If this function is called by crons/internal only and checks service_role_key:
# supabase functions deploy my-new-extractor --no-verify-jwt

# 4. Test
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/my-new-extractor" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"https://example.com/test-listing\"}"' | jq

# 5. Check logs
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/get-logs?service=edge-function" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

### Runbook: Diagnose Queue Failures

```bash
cd /Users/skylar/nuke

# 1. See queue status by source
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  SELECT source_slug, status, count(*)
  FROM import_queue
  GROUP BY source_slug, status
  ORDER BY source_slug, count DESC;"'

# 2. See most common error messages for failed items
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  SELECT LEFT(error_message, 80) as error, count(*)
  FROM import_queue
  WHERE status = '\''failed'\''
  GROUP BY LEFT(error_message, 80)
  ORDER BY count DESC
  LIMIT 20;"'

# 3. BaT extraction queue failures specifically
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  SELECT status, count(*)
  FROM bat_extraction_queue
  GROUP BY status
  ORDER BY count DESC;"'

# 4. Retry failed items (after fixing root cause)
# CAUTION: Only retry items whose failure cause has been fixed
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  UPDATE import_queue
  SET status = '\''pending'\'', error_message = NULL, locked_at = NULL, locked_by = NULL
  WHERE status = '\''failed'\''
    AND source_slug = '\''bat'\''
    AND error_message ILIKE '\''%timeout%'\''
  RETURNING count(*);"'

# 5. Release stale locks (items stuck in processing > 30 min)
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  SELECT release_stale_locks();"'
```

### Runbook: Check Cron Status

```bash
cd /Users/skylar/nuke

# List all extraction-related crons with active status
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  SELECT jobname, schedule, active
  FROM cron.job
  WHERE jobname ILIKE '\''%extract%'\''
     OR jobname ILIKE '\''%discover%'\''
     OR jobname ILIKE '\''%batch%'\''
     OR jobname ILIKE '\''%queue%'\''
  ORDER BY jobname;"'

# Check recent cron execution results
dotenvx run -- bash -c 'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p 6543 -U "$DB_USER" -d postgres -c "
  SELECT jobname, status, return_message, start_time
  FROM cron.job_run_details
  WHERE start_time > now() - interval '\''1 hour'\''
  ORDER BY start_time DESC
  LIMIT 20;"'
```

---

## 8. Current State

*As of 2026-03-26.*

### Key Numbers

| Metric | Value |
|--------|-------|
| Total vehicles | 745,659 |
| Total vehicle_observations | 3,781,388 |
| Total field_evidence | 3,237,780+ |
| Description discoveries | 31,394 (100% with extracted fields) |
| Import queue pending | 82,608 (38.4%) |
| BaT extraction queue pending | 37,856 |
| BaT extraction queue failed | 43,990 (19% — investigate) |
| Active extraction crons | 25 of 26 |
| Registered observation sources | 50+ across 9 categories |

### Vehicles by Source (Top 15)

| Source | Count | Quality |
|--------|-------|---------|
| BaT | 163,265 | HIGH (91.3% extractor accuracy) |
| Mecum | 148,914 | MEDIUM (20% VIN, 23% mileage) |
| Barrett-Jackson | 75,593 | MEDIUM (improving with Strapi API) |
| ConceptCarz | 35,460 | LOW (reference data, no auction) |
| Cars & Bids | 34,824 | HIGH when extracted (Cloudflare blocks) |
| (null source) | 33,776 | UNKNOWN (needs source tagging) |
| Facebook | 33,752 | LOW (10% field completion) |
| Unknown | 27,463 | UNKNOWN |
| Bonhams | 22,832 | MEDIUM |
| RM Sotheby's | 16,652 | LOW (0.3% VIN, 93.8% price) |
| Leake | 15,261 | LOW |
| Silver Auctions | 14,821 | LOW |
| Kruse | 12,627 | LOW |
| Gooding | 11,820 | MEDIUM |
| Auctions America | 9,959 | LOW |

### Observation Distribution

| Kind | Count | Notes |
|------|-------|-------|
| media | 2,314,191 | Images/photos |
| listing | 585,628 | Listing events |
| comment | 425,987 | Auction comments |
| bid | 179,983 | Bid records |
| sale_result | 130,379 | Final sale data |
| condition | 53,710 | Condition observations |
| work_record | 43,046 | Service/repair records |
| specification | 37,357 | Factory/claimed specs |
| provenance | 11,051 | Ownership chain |

### Active Extraction Crons

| Cron | Schedule | What It Does |
|------|----------|-------------|
| batch_extract_snapshots_bat_sparse | Every 5 min | BaT snapshot parsing (free) |
| bat-snapshot-parser-batch | Every 5 min | BaT snapshot parsing (variant) |
| bat-extraction-queue-slow | Every 5 min | Drain BaT queue |
| batch-extract-barrett-jackson | Every 5 min | BJ extraction |
| bj-batch-from-queue | Every 5 min | BJ queue drain |
| mecum-batch-from-queue | Every 5 min | Mecum queue drain |
| process-import-queue-batch | Every 5 min | Generic import queue |
| process-import-queue-batch-2 | Every 10 min | Generic import queue (parallel) |
| discover-description-data | Every 5 min | LLM description extraction |
| document-ocr-worker-batch | Every 5 min | Title/document OCR |
| extraction-watchdog | Every 5 min | Health monitoring |
| apply-description-discoveries | Every 10 min | Apply extracted fields to vehicles |
| batch-vin-decode-backfill | Every 15 min | NHTSA VIN decode |
| observation-discovery | Every hour | AI insight generation |
| mecum-http-extraction | Every 2 hours | Mecum deep extraction |
| gooding-batch-from-queue | Every 2 hours | Gooding queue drain |
| jamesedition-discover | Every 2 hours | JamesEdition discovery |
| bat-daily-discovery | Daily 6 AM | BaT new listings |
| collecting-cars-discovery | Every 4 hours | Collecting Cars |
| broad-arrow-batch-queue | Every 4 hours | Broad Arrow |
| bonhams-typesense-ingest | Every 6 hours | Bonhams |
| rmsothebys-discovery | Every 6 hours | RM Sotheby's |
| batch-ymm-propagate-hourly | Every 4 hours | Y/M/M fill from evidence |
| run_valuation_batch_consolidated | Every 10 min | Market valuations |
| retention-field-extraction-log | Daily 3:30 AM | Cleanup |

### Known Blockers

1. **Anthropic credits exhausted** — Claude Haiku/Sonnet extraction blocked
2. **BaT queue 43K failed items** — need investigation and retry
3. **Auth redirect vulnerability** — 34+ extractors still vulnerable
4. **Mecum field quality** — 20% VIN despite 149K vehicles
5. **33K null-source vehicles** — need source identification

---

## 9. Source-Specific Notes

### BaT (Bring a Trailer)

```
VEHICLES:    163,265
EXTRACTOR:   extract-bat-core v3.0.0 (91.3% accuracy)
API:         /wp-json/bringatrailer/1.0/data/listings-filter (277-page limit)
RATE LIMIT:  ~30 req/min; no hard block observed at 10K/hr with persistent conn
RENDERING:   Server-side (no JS needed)
```

**URL patterns:**
- Listing: `bringatrailer.com/listing/{slug}/` — slug contains Y/M/M
- Auction: `bringatrailer.com/auction/{slug}/` (same format)
- Model page: `bringatrailer.com/model/{make}/{model}/`

**Key gotchas:**
- URL slug is the most reliable identity source (trust over title)
- Multi-word makes in slugs: `alfa-romeo`, `aston-martin`, `rolls-royce`, `austin-healey`, `de-tomaso`
- Essentials block must be windowed to first 50KB — comments below contain other vehicles' specs
- Gallery images: JSON data attribute on gallery div, decode HTML entities, strip resolution suffixes
- Listing Stats table (`id="listing-bid"`) is highest-signal price source
- Rate limit page: < 500 bytes response. Skip and retry with delay.
- Comment count in `vehicle_events.metadata->>'comment_count'` = expected, not extracted

**Best extraction approach:**
1. `batch-extract-snapshots` (free, offline, 1,200/hr)
2. `extract-bat-core` (full extraction, 12-30/hr)
3. `bat-drain-queue.mjs` (bulk URL-based creation, 10K/hr)

---

### Barrett-Jackson

```
VEHICLES:    75,593
EXTRACTOR:   extract-barrett-jackson
API:         Strapi /api/docket (public, no auth, 63K+ lots)
RATE LIMIT:  None observed on API
RENDERING:   Mixed (some pages need JS)
```

**API discovery:**
```
GET https://www.barrett-jackson.com/api/docket?page=1&per_page=100
```
Returns structured JSON with lot details, images, auction results.

**URL patterns:**
- Lot page: `barrett-jackson.com/Events/Event/Details/{lot_id}`
- Images from `BarrettJacksonCDN.azureedge.net`

**Key gotchas:**
- RSC (React Server Components) payload is primary extraction target > JSON-LD > embedded JSON > HTML fallback
- Title case preservation rules: BMW, AMG, SLR, M3-M6, Z3-Z4 stay uppercase
- Labeled field patterns in markdown: "1966Year", "CHEVROLETMake" — regex required to split
- Price sometimes in separate auction results page
- Some lots are memorabilia/non-vehicles — filter by category

---

### Mecum

```
VEHICLES:    148,914
EXTRACTOR:   extract-mecum + mecum-batch-from-queue
API:         Algolia (App ID: U6CFCQ7V52, 303K lots)
RATE LIMIT:  Algolia quota-based
RENDERING:   Next.js (__NEXT_DATA__ JSON blob)
```

**Algolia discovery:**
```javascript
const client = algoliasearch('U6CFCQ7V52', '<key-from-page-source>');
const index = client.initIndex('mecum_lots');
```

**Key gotchas:**
- `__NEXT_DATA__` JSON blob contains ALL structured data (preferred over HTML)
- Description lives in **Gutenberg blocks**, NOT `post.content` (always empty)
- Prices are in **cents** (hammer_price) — divide by 100 for dollars
- Lot numbers can be large, include commas
- VIN field: `vinSerial` in taxonomy data
- Collection info in `collectionsTax` — useful for provenance
- Gallery uses JS-rendered lightbox — images NOT in HTML snapshots
- Field quality: only 20.4% VIN, 23% mileage despite 149K vehicles — needs deep extraction pass

---

### Cars & Bids

```
VEHICLES:    34,824
EXTRACTOR:   extract-cars-and-bids-core
API:         None (React SPA, Cloudflare-protected)
RATE LIMIT:  Cloudflare blocks all direct fetch
RENDERING:   React SPA — Firecrawl REQUIRED
```

**Key gotchas:**
- **Auction IDs are case-sensitive** — do not lowercase URLs (unique bug vector)
- Cloudflare blocks 100% of direct fetch attempts
- `__NEXT_DATA__` available after JS render — contains complete listing state
- DOM parsing: JSON-LD + `dl > dt/dd` pairs for structured fields (no LLM needed once rendered)
- Images from `media.carsandbids.com` — use `width=2080` for full resolution
- Doug's Take, highlights, equipment in separate DOM sections
- Current field quality: 6.5% VIN, 4.0% mileage — massive backfill opportunity

**Best approach:**
1. Check snapshot cache first ($0)
2. Firecrawl for cache misses ($0.01/page)
3. Parse DOM structure (no LLM)

---

### Facebook Marketplace

```
VEHICLES:    33,752
EXTRACTOR:   extract-facebook-marketplace + fb-marketplace-orchestrator
API:         GraphQL (doc_id=33269364996041474, residential IP required)
RATE LIMIT:  Login redirect on non-residential IP
RENDERING:   Varies (direct mode preferred)
```

**Key gotchas:**
- **Cloud IPs are blocked** — Supabase Edge Functions get redirected to login page
- **Residential IP required** for any Facebook scraping
- Bingbot/Googlebot user agent bypasses authentication for HTML fetch
- GraphQL endpoint works logged-out with residential IP
- Direct mode (pre-extracted data) is preferred — no fetch cost
- VIN coverage: 1.6% (terrible), mileage: 96.7% (great)
- Price field: `asking_price` not `sale_price` (FB doesn't have sale results)
- Facebook IDs are unique per listing
- Vehicle linking: VIN exact match (strong) or YMM + state (soft)

**Browser-based extraction (best approach):**
```bash
# Use Chrome MCP or Playwright with residential IP
# scripts/fb-marketplace-local-scraper.mjs — 58 US metros
```

---

### Hagerty Marketplace

```
VEHICLES:    ~5,000
EXTRACTOR:   extract-hagerty-listing
API:         __NEXT_DATA__ JSON blob (complete extraction)
RATE LIMIT:  None observed
RENDERING:   Next.js (server-rendered)
```

**Key gotchas:**
- `__NEXT_DATA__` contains EVERYTHING — complete auction state
- **ALL prices are in CENTS** — divide by 100 (common mistake)
- Condition rating + valuation estimate = Hagerty-specific fields
- Reserve status: `has_reserve` boolean + `reserve_met` boolean (can be null)
- VIN extraction: 17 regex patterns tested (handles all manufacturers)
- WebSocket channel info in data (for live auction tracking)
- Comments are embedded in `__NEXT_DATA__` — extract without additional fetch

---

### Bonhams

```
VEHICLES:    22,832
EXTRACTOR:   extract-bonhams
API:         JSON-LD @type:Product (always SSR'd)
RENDERING:   Server-side
```

**Key gotchas:**
- Both `cars.bonhams.com` AND `bonhams.com` are valid domains
- JSON-LD `@type:Product` is most reliable extraction source
- VIN/Chassis patterns flexible: accepts hyphens, slashes in chassis numbers
- 60+ known multi-word makes mapped for title parsing
- Currencies: CHF, GBP, EUR, USD — must normalize
- Model name pollution: Some models include lot metadata in string — needs cleaning
- 1,079 model names cleaned, 960 VINs extracted, 38 body styles in 2026-03-25 fix

---

### RM Sotheby's

```
VEHICLES:    16,652
EXTRACTOR:   extract-rmsothebys
API:         POST /api/search/SearchLots (sparse data)
RATE LIMIT:  None observed
RENDERING:   Server-side
```

**Key gotchas:**
- API exists but returns sparse data — must fetch each lot page for full details
- Currency varies (USD, GBP, EUR) — check per lot
- Estimate format: "$100K–$150K" or "POA" (price on application)
- Field quality: 0.3% VIN (terrible), 93.8% price (great)
- Event-code-based discovery: scrape auction event pages for lot lists

---

### PCarMarket

```
VEHICLES:    6,101
EXTRACTOR:   import-pcarmarket-listing
API:         None (direct HTML parsing)
RATE LIMIT:  None observed
RENDERING:   Server-side
```

**Key gotchas:**
- Compound makes: "Mercedes-Benz", "Aston Martin", "Alfa Romeo", "Land Rover", "Rolls-Royce"
- Bid field format is concatenated: "SOLD$39,00026 BidsEnded Apr 16, 201917,241 Views" — needs regex parsing
- VIN validation aggressive: rejects "000000", "111111", "test", "none", all-same-digit, sequential patterns
- Trailing slash URL variation — must normalize
- Field quality: 97.4% VIN (excellent), 6.7% mileage (poor)

---

### ClassicCars.com

```
VEHICLES:    ~35,000 (queued)
EXTRACTOR:   import-classiccars-listing
API:         Azure Blob sitemaps (public, unprotected)
RATE LIMIT:  Cloudflare on site, but sitemaps bypass
RENDERING:   Server-side with JSON-LD
```

**Sitemap discovery:**
```
https://ccpublic.blob.core.windows.net/sitemaps/sitemap_index.xml
→ 71 listing sitemaps
→ 35,070 unique listing URLs
→ 1,421,309 embedded images
```

**URL format:** `/listings/view/{id}/{year}-{make}-{model}-for-sale-in-{city}-{state}-{zip}`
**Data format:** JSON-LD schema.org `@type: car` with VIN, price, mileage, colors, description

---

### Classic Driver

```
VEHICLES:    ~54,000 (queued)
EXTRACTOR:   (generic pipeline via import_queue)
API:         XML sitemap (31 pages)
RATE LIMIT:  Unknown
RENDERING:   Unknown
```

**Sitemap:** `classicdriver.com/sitemap.xml` → 31 pages, 54,890 URLs
**URL pattern:** `/en/car/{make}/{model}/{year}/{id}` — Y/M/M parsed from URL
**Top makes:** Porsche (5,288), Mercedes-Benz (5,211), Ferrari (4,213)
**Year range:** 1886–2025, heaviest in 1960s
**Trust score:** 0.80 (marketplace)

---

### James Edition

```
VEHICLES:    ~2,000
EXTRACTOR:   extract-jamesedition
API:         None (Cloudflare-protected)
RATE LIMIT:  Cloudflare blocks direct fetch
RENDERING:   Firecrawl REQUIRED
```

**Key gotchas:**
- Cloudflare protection → Firecrawl is only option
- Markdown parsing from "Car Details" section
- Image resolution: replace `/je/1100xxs.jpg` with full-size variant
- Luxury-focused: service history, provenance, valuation data present
- Discovery cron runs every 2 hours

---

### Gooding & Company

```
VEHICLES:    11,820
EXTRACTOR:   extract-gooding + gooding-batch-from-queue
API:         Sitemap-based discovery (9,278 lots found)
RATE LIMIT:  Unknown (batch cron runs every 2 hours)
RENDERING:   Server-side
```

**Key gotchas:**
- Sitemap discovery found 9,278 lots — primary intake method
- Pre-war and ultra-rare vehicles common (different field patterns than mass market)
- xAI/Grok parse failures reported on some complex listings (1 of 10 in deep extraction test)
- 7/10 had price data, all had descriptions
- Scrape quality: "Good" tier — descriptions and specs extract well

---

### Collecting Cars

```
VEHICLES:    ~2,000
EXTRACTOR:   extract-collecting-cars-core
API:         None discovered
RATE LIMIT:  Unknown
RENDERING:   JS rendering likely needed
CRON:        collecting-cars-discovery (every 4 hours)
```

**Key gotchas:**
- xAI had trouble with Collecting Cars HTML format in deep extraction test (4/10 success)
- Some prices found but inconsistent extraction
- Active discovery cron running — adding new listings automatically
- Quality: "Low" tier — needs extractor improvements

---

### Broad Arrow (RM Sotheby's subsidiary)

```
VEHICLES:    1,920
EXTRACTOR:   broad-arrow-batch-queue
API:         None discovered
RATE LIMIT:  Unknown
RENDERING:   Server-side
CRON:        broad-arrow-batch-queue (every 4 hours)
```

**Key gotchas:**
- Subsidiary of RM Sotheby's — may share some HTML patterns
- 11,085 field_evidence rows (good data density for 1,920 vehicles)
- Active batch queue cron running
- Trust score: 0.75

---

### Leake Auctions

```
VEHICLES:    15,261
EXTRACTOR:   (generic pipeline via import_queue)
API:         None discovered
RATE LIMIT:  Unknown
RENDERING:   Unknown
```

**Key gotchas:**
- Large vehicle count but no dedicated extractor
- Data likely came from bulk import or sitemap discovery
- No active extraction cron — stale data
- Candidate for API probing (Algolia, Strapi patterns)

---

### Silver Auctions

```
VEHICLES:    14,821
EXTRACTOR:   (generic pipeline via import_queue)
API:         None discovered
RATE LIMIT:  Unknown
RENDERING:   Unknown
```

**Key gotchas:**
- Similar to Leake — large count, no dedicated extractor
- No active extraction cron
- Low field quality likely — needs audit

---

### Kruse International

```
VEHICLES:    12,627
EXTRACTOR:   (generic pipeline via import_queue)
API:         None discovered
RATE LIMIT:  N/A (historical data)
RENDERING:   N/A
```

**Key gotchas:**
- Historical auction house (no longer active as independent entity)
- Data is archival — no new listings expected
- Field quality audit needed

---

### Auctions America

```
VEHICLES:    9,959
EXTRACTOR:   (generic pipeline via import_queue)
API:         None discovered
RATE LIMIT:  N/A (merged with Broad Arrow)
RENDERING:   N/A
```

**Key gotchas:**
- Merged with Broad Arrow Group in 2018
- Historical data only — no new listings
- May have URL overlap with Broad Arrow

---

## 10. Facebook Marketplace

Facebook Marketplace is the CEO's daily-driver source. The use case: "Show me the best square body trucks within 250 miles of Salt Lake City." This chapter documents the complete state of FB extraction — what works, what doesn't, and how to get there.

### What Exists Today

**33,353 marketplace_listings.** 33,828 FB-sourced vehicles. 1,934 new vehicles created in the last 24 hours. The scraper is actively running.

| Metric | Value | Grade |
|--------|-------|-------|
| Total FB vehicles | 33,828 | — |
| With price | 33,651 (99.5%) | A |
| With description | 4,636 (13.7%) | D |
| With VIN | 47 (0.1%) | F |
| With location text | ~31,000 (in marketplace_listings) | — |
| With GPS coordinates | ~212 (in vehicles table) | F |
| Completeness (enrichment report) | 10.0% | F |

### How The Scraper Works

**Three layers:**

**Layer 1 — Local GraphQL Scraper** (the one that works):
- Script: `scripts/fb-marketplace-local-scraper.mjs` v3.1
- Runs on Skylar's Mac via 4 launchd jobs (03:00, 09:00, 15:00, 21:00)
- Uses logged-out GraphQL: `doc_id=33269364996041474`
- Residential IP required (datacenter IPs get blocked)
- 58 US metros hardcoded (SLC is included as `salt-lake-city`)
- Year range: 1920–2006
- Creates marketplace_listings + vehicles + downloads images

**Layer 2 — Edge Function Orchestrator** (dead):
- `fb-marketplace-orchestrator` — uses Bingbot UA from Supabase
- 582 US metro locations in `fb_marketplace_locations` table
- Last run: 2026-02-05 (7 weeks ago). Cannot work from datacenter IPs.

**Layer 3 — Refinement Pipeline** (active crons):
- `refine-fb-listing` (every 5 min) — scrapes individual listing pages for detail
- `import-fb-marketplace` (every 5 min) — imports to vehicles table
- `enrich-bulk` with `derive_fields` (every 5 min) — Y/M/M from titles
- `monitor-fb-marketplace` (every 6 hours) — health check

### The SLC Use Case — Why It Fails Today

**"Show me the best square bodies within 250 miles of SLC"**

Query result today: **1 vehicle** (a 1984 G30 motorhome — not a square body).

Why:
1. **Location doesn't propagate.** `marketplace_listings` has city/state text. But `import-fb-marketplace` doesn't copy location to `vehicles.location` or geocode it. 99% of FB vehicles have NULL location in the vehicles table.
2. **No proximity search.** No "within X miles" query exists. No PostGIS. `gps_latitude`/`gps_longitude` columns exist but are 99% NULL for FB.
3. **No "square body" classification.** Must rely on year 1973-1987 + Chevy/GMC + model pattern matching. Model data is messy.
4. **SLC coverage is thin.** 89 SLC listings out of 33K total. The scraper hits SLC once per day.
5. **Error rate increasing.** The most recent sweep (22:00 tonight) was 100% errors — 14/14 locations failed. FB may be tightening blocks.

### What Would Make It Work

| Fix | Effort | Impact |
|-----|--------|--------|
| Copy location from marketplace_listings to vehicles in `import-fb-marketplace` | 1 hour | Enables text-based filtering |
| Add Haversine proximity RPC: `find_vehicles_near(lat, lng, radius_miles)` | 2 hours | Enables "within 250 miles" |
| Add SLC surrounding metros to scraper (Ogden, Provo already in DB) | 30 min | 3x SLC coverage |
| Tag "square body" via rule-based enrichment (year 1973-1987 + Chevy/GMC C/K series) | 1 hour | Enables body style filtering |
| Wire FB results to `universal-search` | 2 hours | Visible in UI |
| Investigate 100% error rate on latest sweep | 1 hour | May need new doc_id |

**Total to minimum viable SLC use case: ~8 hours.**

### Key Files

| File | Purpose |
|------|---------|
| `scripts/fb-marketplace-local-scraper.mjs` | The working scraper (v3.1) |
| `supabase/functions/import-fb-marketplace/index.ts` | Cron: creates vehicle records |
| `supabase/functions/refine-fb-listing/index.ts` | Cron: enriches individual listings |
| `supabase/functions/fb-marketplace-orchestrator/index.ts` | DEAD: 582-city server-side orchestrator |
| `supabase/functions/monitor-fb-marketplace/index.ts` | Health monitoring |
| `~/Library/LaunchAgents/com.nuke.fb-sweep-g{1,2,3,4}.plist` | launchd schedules |
| `fb_marketplace_locations` table | 582 US metros with lat/lon |
| `fb_sweep_jobs` table | Sweep run tracking |
| `marketplace_listings` table | 33K raw listings |

---

## 11. Stalled Initiatives

Extraction efforts that were started, produced some results, and then stopped. Each entry documents what exists, why it stalled, and what it would take to finish.

---

### ConceptCarz Spec Catalog

```
STATUS:      STALLED — ingested but thin
DATA:        35,460 vehicles at 10.1% completeness
CRONS:       None
LAST ACTIVE: 2026-03-07 (cleanup session)
```

A bulk import on 2026-02-06 created 35K vehicles from ConceptCarz, a reference catalog site. 100% have year/make/model. But: 0.5% have images, 1.4% have descriptions, 8.9% have VINs. The 2026-03-04 investigation found that 90.7% of "sale prices" were fabricated averages — 265K records had to be reclassified.

**Why stalled:** The initial import grabbed Y/M/M but never deep-extracted specs, descriptions, or images. No automated enrichment pipeline was built.

**To finish:** Build a ConceptCarz spec-page extractor using archiveFetch. 29K URLs already in the database point to pages with engine, transmission, dimensions, and factory spec data. Straightforward Firecrawl + regex pass. Estimated: 1 day.

---

### Forum Extraction

```
STATUS:      STALLED — infrastructure built, pipeline inactive
DATA:        8,448 observations from 8 forums; 58,864 build posts discovered from 42 forums
CRONS:       None active
LAST ACTIVE: 2026-01-24 (source registration)
```

12 forum observation_sources registered: Rennlist, Pelican Parts, BroncoZone, NastyZ28, 355nation, Camaros.com, ThetruckStop, Camaros-net, Mazdas247, GMFullsize, and 2 others. Edge functions `extract-thesamba` and `structure-build-thread` were built but **deleted during the March 7 triage**.

**Data in DB:** thetruckstop (2,909), nastyz28 (1,897), 355nation (1,801), camaros (1,611), gmfullsize (91), mazdas247 (62), camaros-net (53), broncozone (24). Rennlist and Pelican Parts: 0 observations despite being registered.

**Why stalled:** The edge functions were pruned during triage. No replacement pipeline was built. The one-time extraction burst from January was never followed up.

**To finish:** Re-scrape the 42 forums using the `scrape-motec-forum.mjs` script as template (phpBB/vBulletin pattern). Rennlist/Pelican Parts need Firecrawl due to anti-bot. TheSamba is public HTML. Estimated: 3 days for core forums, ongoing for build threads.

---

### Tool/Product Inventories

```
STATUS:      ABANDONED — schema exists, minimal data
DATA:        126 tools, 9,649 catalog parts, 3,092 dealer inventory items
CRONS:       None
LAST ACTIVE: Oct 2025
```

Tables exist: `tool_catalog`, `tool_inventory`, `parts_catalog`, `catalog_parts`, `ebay_parts_catalog`, `dealer_inventory`. Plus 20+ empty supporting tables. Frontend services exist (`toolImageService.ts`, `toolInventoryService.ts`).

**Why abandoned:** Feature-branch experiment for restoration shop tool tracking. Never connected to a data source. The tables were scaffolded but never populated at scale.

**Recommendation:** Candidate for deletion in the next table cleanup (part of the "388 empty tables" backlog from PROJECT_STATE.md). If tools/parts are ever needed, eBay Motors parts API or RockAuto would be the data source.

---

### Document Extraction (OCR)

```
STATUS:      STALLED — pipeline works, no inflow
DATA:        916 OCR queue items (259 complete, 657 skipped), 139 vehicle_documents
CRONS:       document-ocr-worker-batch (every 5 min) — running but starved
LAST ACTIVE: Cron is active but processing nothing new
```

Edge functions exist: `document-ocr-worker`, `extract-title-data`, `parse-reference-document`, `detect-sensitive-document`. GPT-4o vision for OCR with Claude Sonnet fallback. The pipeline works — it just has no documents to process.

**Why stalled:** No automated system discovers or queues documents. The 916 items were manual/test submissions. BaT listings often include build sheet photos in their galleries, but no classifier identifies document-type photos.

**To finish:** Build an image classifier that scans `vehicle_images` for document-type photos (build sheets, window stickers, titles, service records). The 34M image corpus almost certainly contains thousands. Estimated: 2 days for classifier + queue wiring.

---

### Photo Library (iPhoto Intake)

```
STATUS:      STALLED — K10 complete, broader library partial
DATA:        9,830 iPhoto images, 72 albums mapped, 249 K10 images
CRONS:       None active
LAST ACTIVE: Multiple sessions (GPS backfill, placeholder cleanup)
```

Scripts: `iphoto-intake.mjs` (full pipeline), `iphoto-album-mapper.sh` (72 albums → vehicles), `photo-sync.mjs` (Camera Roll scanning). The K10 truck has 249 images with GPS metadata. 72 albums have been mapped to vehicles.

**Why stalled:** No recurring sync. Some albums may be partially uploaded. iCloud-only photos need `--download-missing` flag.

**To finish:** (1) Run `iphoto-intake.mjs --list` to verify album status. (2) Set up `iphoto-overnight.sh` as recurring launchd job. (3) Process remaining albums with `--download-missing` for iCloud photos. Estimated: half day.

---

### Comment Extraction

```
STATUS:      ACTIVE — deep coverage, actively backfilling
DATA:        ~12M comments, 126K AI-analyzed, 343K buyer profiles
CRONS:       observation-backfill (10 min), discover-description-data (5 min), apply-description-discoveries (10 min)
```

This is one of the deepest datasets in the platform. 12M auction comments across platforms. 126K vehicles have AI sentiment analysis. 343K buyer profiles segmented from comment behavior. $4.4B in tracked transaction volume.

**Remaining gap:** 809 BaT vehicles missing 52K expected comments. Condition extraction from comments blocked by Anthropic credit exhaustion. Hagerty comment extraction added but volume is low.

**Not stalled — actively running and improving.**

---

### Valuation/Market Data

```
STATUS:      ACTIVE — broad coverage
DATA:        583K vehicles with nuke_estimate (70.8%), 323K with sale_price (39.2%)
CRONS:       5 valuation shards (every 10 min each)
```

Comp-based valuation running continuously across 5 parallel shards. Barrett-Jackson: 99.74% price coverage. Facebook: 44%+ coverage (up from 28%).

**Missing:** No Hagerty valuation API integration. No insurance-grade market values. The comp-based system is the only valuation mechanism.

**Not stalled — actively running.**

---

### RSS/Feed Polling

```
STATUS:      ACTIVE — healthy
DATA:        744 feeds (729 enabled), 113K items discovered
CRONS:       poll-listing-feeds (every 15 min), 2 queue processors
```

9 RSS feeds (BarnFinds, Silodrome, TheDrive, Hagerty Media, etc.) + 735 HTML listing feeds (Craigslist, KSL, ClassicDriver, Car and Classic). Queue healthy: 178K complete, 350 pending.

**Not stalled — actively running and processing.**

---

### Initiative Scoreboard

```
ACTIVE (4):
  ✅ Comment extraction (12M comments, 126K analyzed)
  ✅ Valuation/market data (583K estimates)
  ✅ RSS/feed polling (744 feeds, 113K items)
  ✅ Facebook Marketplace (33K vehicles, scraper running)

STALLED (4):
  ⏸️ ConceptCarz catalog (35K vehicles at 10% — needs spec extractor)
  ⏸️ Forum extraction (8K observations — edge functions deleted in triage)
  ⏸️ Document OCR (pipeline works, no inflow — needs image classifier)
  ⏸️ iPhoto intake (K10 done, 72 albums mapped — needs recurring sync)

ABANDONED (1):
  ❌ Tool/product inventories (cleanup candidate)
```

---

## Appendix A: File Index

| File | Purpose |
|------|---------|
| `TOOLS.md` | Canonical tool registry (check before building) |
| `supabase/functions/_shared/archiveFetch.ts` | Snapshot-first fetch + cache |
| `supabase/functions/_shared/commentRefinery.ts` | Claim extraction pipeline |
| `supabase/functions/_shared/llmProvider.ts` | Legacy LLM routing |
| `supabase/functions/_shared/llmRouter.ts` | Current LLM routing + model registry |
| `supabase/functions/_shared/agentTiers.ts` | Haiku/Sonnet/Opus tier system |
| `supabase/functions/_shared/normalizeVehicle.ts` | 107 make aliases, VIN validation |
| `supabase/functions/_shared/extractionQualityGate.ts` | Pre-insert quality validation |
| `supabase/functions/_shared/firecrawl.ts` | Firecrawl v1 wrapper with retry |
| `supabase/functions/_shared/batFetcher.ts` | BaT-specific fetcher |
| `supabase/functions/_shared/batParser.ts` | BaT HTML parsing logic |
| `supabase/functions/ingest-observation/index.ts` | Unified observation intake |
| `supabase/functions/extract-bat-core/index.ts` | Gold standard extractor (91.3%) |
| `supabase/functions/batch-extract-snapshots/index.ts` | Free offline re-extraction |
| `supabase/functions/discover-description-data/index.ts` | LLM description mining |
| `supabase/functions/extract-vehicle-data-ai/index.ts` | Generic AI (12.6% — DEPRECATED) |
| `supabase/functions/haiku-extraction-worker/index.ts` | Tier-1 LLM extraction worker |
| `supabase/functions/extract-cars-and-bids-core/index.ts` | C&B DOM parser |
| `supabase/functions/extract-hagerty-listing/index.ts` | Hagerty __NEXT_DATA__ parser |
| `supabase/functions/import-pcarmarket-listing/index.ts` | PCarMarket importer |
| `supabase/functions/extract-title-data/index.ts` | Document OCR (GPT-4o vision) |
| `scripts/bat-drain-queue.mjs` | Throughput champion (10K/hr) |
| `scripts/enrich-fb-rules.mjs` | Deterministic rule-based enrichment |
| `scripts/enrich-fb-batch.mjs` | FB enrichment orchestrator |
| `scripts/mecum-algolia-discovery.mjs` | Mecum Algolia API discovery |
| `scripts/bj-api-discovery.mjs` | Barrett-Jackson Strapi API discovery |
| `.claude/EXTRACTOR_REDIRECT_AUDIT.md` | Full redirect vulnerability audit |
| `.claude/ISSUES.md` | Active issue tracker |
| `docs/library/technical/engineering-manual/02-extraction.md` | Engineering manual chapter |

## Appendix B: Anti-Patterns (Do NOT Repeat)

1. **Building new extractors instead of fixing existing ones** — duplicates data forks, wastes budget. See FAILURE 12.
2. **Running incomplete extractors at scale** — creates backfill debt (PCarMarket: 0 images stored)
3. **Using extract-vehicle-data-ai as primary** — 12.6% accuracy, worse than random. See FAILURE 12, METHOD 09.
4. **Large batch sizes in edge functions** — 504 timeouts. Max 3 for external calls. See FAILURE 14.
5. **Per-request DB connections for batch work** — pool exhaustion. Use persistent connection. See FAILURE 06.
6. **Generic error messages** — 29K items failed with just "Extraction failed". Log specific errors.
7. **Retrying dead links forever** — 404/410 should be `skipped` immediately
8. **Using raw fetch()** — compliance was 5%. Use `archiveFetch()` always. See FAILURE 01.
9. **No credit monitoring** — $399 burned with no alert. Monitor balances. See FAILURE 02.
10. **Ignoring TOOLS.md** — 464 functions grew from duplication. Check registry first.
11. **Creating scripts without package.json entry** — 1,343 of 1,395 scripts were unreferenced
12. **Deploying without testing** — `bat-extraction-test-harness` exists for BaT. Use it.

## Appendix C: Confidence & Trust Scoring

### Source Trust Scores (from observation_sources)

| Category | Examples | Trust Range |
|----------|----------|-------------|
| Registry | BMW Classic, Aston Works | 0.90–0.95 |
| Auction (premium) | Bonhams, BaT, Cars & Bids | 0.80–0.90 |
| Auction (standard) | Barrett-Jackson, Mecum | 0.70–0.80 |
| Owner/desktop | Desktop archive, Claude extension | 0.80–0.95 |
| Marketplace (curated) | Classic Driver, Hagerty | 0.75–0.80 |
| Shop | Arkonik, restoration shops | 0.60–0.85 |
| AI extraction | ai-description-extraction | 0.65 |
| Forum | 355Nation, BroncoZone | 0.50 |
| Marketplace (open) | Craigslist, Autotrader | 0.40–0.50 |

### Entity Resolution Confidence

| Match Type | Confidence | Action |
|------------|-----------|--------|
| VIN exact match | 0.99 | Auto-link to existing vehicle |
| URL exact match | 0.95 | Auto-link |
| Y/M/M + state match | 0.70 | Soft link (suggested_vehicle_id) |
| Y/M/M only | 0.50 | Propose merge, human review |

### Claim Confidence Computation

```
final_confidence = raw_confidence
  × author_trust_multiplier     (0.7 to 1.3)
  × temporal_decay               (half-life based, condition claims only)
  + seller_bonus                 (+0.10 if comment from seller)
```

Clamped to [0, 1].

## Appendix D: Known Architectural Limitations

These are systemic issues that the playbook documents but does not fully solve. Be aware of them when operating at scale.

### 1. No Idempotency Guarantees Across Write Paths

Five write paths exist to the `vehicles` table: batch-extract-snapshots, extract-bat-core, bat-drain-queue.mjs, ingest-observation, and import_queue processing. If a function crashes after the DB write but before returning success, the cron retries and may produce duplicates. VIN dedup catches most cases, but non-VIN vehicles (pre-1981) have no strong dedup key.

**Mitigation:** Always check for existing vehicle by VIN AND URL before INSERT. Use `ON CONFLICT DO UPDATE` for upserts.

### 2. No Backpressure or Flow Control

25 crons fire every 5 minutes with no mechanism to slow down when the DB connection pool approaches saturation. Past incidents (FAILURE 03, FAILURE 06) were resolved by manual concurrency reduction, not architectural backpressure. If extraction volume increases 10x, expect connection pool exhaustion again.

**Mitigation:** Monitor `pg_stat_activity` connection count. If approaching 60 active connections, pause discovery crons (they add to the queue) and let extraction crons drain.

### 3. No Automated Monitoring or Alerting

The $399 credit burn (FAILURE 02) happened because there were no balance alerts. The extraction-watchdog cron exists but its alerting capabilities are undocumented. There is no dashboard for extraction throughput, error rates, or queue depths over time.

**Mitigation:** Check `npm run ops:health` manually at session start. TODO: implement credit balance monitoring and queue depth alerts.

### 4. No Rollback for Bad Extraction Batches

If an extraction batch writes bad data (e.g., auth redirect cached garbage as valid HTML for 24 hours), there is no documented way to identify and revert affected records. The `extraction_metadata` table tracks which extractor set which field, but no point-in-time rollback mechanism exists.

**Mitigation:** When a bad batch is discovered, use `extraction_metadata` to identify affected vehicle_ids by extractor + timestamp range, then re-extract from snapshots.

### 5. Connection Pool vs Edge Function Architecture

PATTERN 4 recommends persistent DB connections for throughput, but Supabase edge functions are stateless — they cannot maintain persistent connections across invocations. This pattern only works in local scripts. Edge functions create a new connection per invocation via the Supabase client.

**Mitigation:** For high-throughput batch work, use local scripts (not edge functions). Edge functions are best for single-item or small-batch processing triggered by crons.

---

*This playbook is a living document. When you discover a new failure mode or fix, add it here. When accuracy numbers change, update them. The next agent reading this should never have to learn the same lesson twice.*
