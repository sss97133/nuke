# NUKE ENGINEERING MANUAL

## Rebuild Instructions for Every Subsystem

This is the construction manual. A person reading only this book should be able to reconstruct the entire Nuke data platform from an empty Supabase project and a blank repository.

Each chapter covers one subsystem. Chapters are ordered by dependency: intake first (where data enters), extraction second (how data is structured), entity resolution third (how records merge), and so on through images, database operations, deployment, and scraping sources.

---

## Table of Contents

### Chapter 1: Intake Pipeline
`01-intake-pipeline.md`

How data enters the system. The `import_queue` table, the `process-import-queue` edge function, URL-based domain routing, the `archiveFetch` page preservation system, status transitions, retry logic with exponential backoff, and failure categorization. Includes the target architecture for a single unified intake endpoint.

### Chapter 2: Extraction
`02-extraction.md`

How to build an extractor. The shared utility patterns (`_shared/` modules), the three-tier agent hierarchy (Haiku, Sonnet, Opus), prompt construction, quality scoring, the escalation ladder, `extract-bat-core` as the reference implementation, and step-by-step instructions for adding a new source. The Schema Discovery Principle.

### Chapter 3: Entity Resolution
`03-entity-resolution.md`

How vehicle and entity matching works. The current three-pass implementation (URL match, VIN match, fuzzy year/make/model), the `dedup-vehicles` merge function, the `merge_into_primary` SQL procedure, known problems with the current approach, and the target architecture for a universal matcher with a 0.80 confidence threshold.

### Chapter 4: Observation System
`04-observation-system.md`

How `ingest-observation` works. The input schema, vehicle resolution within observations, content hashing for deduplication, confidence scoring from source trust weights, the fire-and-forget analysis trigger, how to register a new observation source, and how to migrate legacy tables into the observation model.

### Chapter 5: Image Pipeline
`05-image-pipeline.md`

How images flow from upload through AI analysis to structured metadata. The iPhoto intake script (`iphoto-intake.mjs`), vehicle image organization, the YONO classifier (what it is, how it was trained, why it is not yet fully integrated), zone classification, and the photo coverage map for auction readiness.

### Chapter 6: Database Operations
`06-database-operations.md`

How to safely operate the database. Batching rules, statement timeout configuration, lock checking procedures, migration application via Supabase MCP, PostgREST schema reload, vacuum procedures, the `pipeline_registry` ownership system, and every hard rule from CLAUDE.md explained with the reasoning behind it.

### Chapter 7: Deployment
`07-deployment.md`

How to deploy edge functions, run migrations, manage cron jobs. The Supabase CLI workflow, the `dotenvx` encrypted secrets pattern, how to check function logs, how to monitor system health, and the operational scripts infrastructure.

### Chapter 8: Scraping Sources
`08-scraping-sources.md`

How each data source is scraped. Bring a Trailer (direct fetch with HTML parsing), Facebook Marketplace (logged-out GraphQL with `doc_id`, no tokens, residential IP required), Craigslist, PCarMarket (API), Cars and Bids (Firecrawl for JS rendering), and generic sources (Firecrawl fallback). Access methods, rate limits, and data quality per source.

---

## How to Read This Manual

Each chapter follows the same structure:

1. **What This Subsystem Does** -- a one-paragraph summary
2. **Key Tables and Functions** -- the database schema and edge functions involved
3. **How It Works Today** -- the current implementation with code snippets
4. **Status Transitions and Data Flow** -- state machines and sequence diagrams in text
5. **How to Build It from Scratch** -- step-by-step reconstruction instructions
6. **Known Problems** -- current limitations and technical debt
7. **Target Architecture** -- where the system is heading

Code snippets are taken from the actual codebase. File paths are absolute from the repository root (`/Users/skylar/nuke/`). When a snippet is abbreviated, the full file is referenced.

---

## Prerequisites

To rebuild this system you need:

- A Supabase project (Postgres database + Edge Functions + Storage)
- An Anthropic API key (for Claude Haiku/Sonnet/Opus extraction)
- A Firecrawl API key (for JS-rendered page scraping)
- Node.js 18+ and Deno (for edge functions and local scripts)
- The `supabase` CLI
- The `dotenvx` CLI (for encrypted secrets management)
- A residential IP address (for Facebook Marketplace scraping)
- macOS with `osxphotos` CLI (for iPhoto intake, optional)

---

## Foundational Principles

These principles govern every subsystem. They are not suggestions. Violations of these principles caused the platform to bloat from 50 to 464 edge functions, a 171 GB database, and $5,600/month burn rate.

**1. Archive Fetch Principle.** Never use raw `fetch()` for external URLs. Always use `archiveFetch()` from `_shared/archiveFetch.ts`. Every page gets archived to `listing_page_snapshots`. Fetch once, extract forever.

**2. Schema Discovery Principle.** Never pre-define a schema before seeing the actual data. Sample documents first, enumerate all fields, then design the schema, then extract once.

**3. Batched Migration Principle.** Never run unbounded UPDATE/DELETE on large tables. Batch in 1,000-row chunks with `pg_sleep(0.1)` between batches.

**4. Pipeline Ownership Principle.** Every computed field in the database has exactly one owning function. Check `pipeline_registry` before writing to any field. Building a duplicate tool creates data forks.

**5. Tool Registry Principle.** Before building anything, read `TOOLS.md`. If a tool already exists for your intent, use it. The registry maps every common operation to its existing edge function.
