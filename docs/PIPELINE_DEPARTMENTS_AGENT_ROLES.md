## Pipeline departments: agent positions and roles

This document defines the starting lineup of agents (human, AI-assisted, or fully automated) required to get truthful data into the database at scale, while keeping provenance and quality verifiable.

### Core principle: contracts between departments

Each department owns a specific artifact with a stable interface:

- **Source identity**: a canonical record of a site/vendor/auction platform (maps well to `data_source_registry`).
- **Extraction plan**: how we obtain data from that source (rendering strategy, DOM map, pagination, rate limits, auth, legal constraints).
- **Pipeline execution**: scheduled jobs and monitors that keep ingestion flowing.
- **Per-field provenance**: when we write data, we attach where it came from and confidence (maps well to `vehicle_data_sources`).
- **Quality gates**: validation, dedupe, conflict detection, review queues.
- **UI surfaces**: the controls and transparency layers that make the pipeline operable.

---

## Department 1: Raw source sourcing (master list)

### Position: Source Sourcing Agent (Automotive Source Research)

### Mission
Build and maintain the master list of online sources for automotive suppliers, dealers, marketplaces, and auctions. This is the top-of-funnel inventory that the rest of the pipeline consumes.

### Owns
- `data/sources/master_sources.yaml` (canonical source inventory)
- `docs/SOURCES_MASTER_LIST.md` (human-readable version)

### Inputs
- Product priorities (what vehicle segments, geographies, and categories matter)
- Existing known sources in code/docs

### Outputs
- Source entries with: category, region, access constraints, expected data types, and priority
- “Source gaps” report (what we still do not cover)

### KPIs
- Coverage: number of high-value sources per category and region
- Readiness: % sources with a completed extraction plan (owned by Department 2)
- Freshness: last reviewed date per source

### Handoff
Creates “Source Onboarding Tickets” for Department 2 with target URLs and expected data fields.

---

## Department 2: Extraction planning and site preparation (DOM mapping, indexing, plan)

### Position: Extraction Planning Agent (Source Onboarding)

### Mission
For each new source, prepare it for extraction at scale: identify where the data lives, map DOM paths/selectors, define pagination and limits, and write a concrete plan that can be implemented and monitored. Goal: enable tens of thousands of records per day across many sources.

### Owns
- `docs/extraction_plans/<source_id>.md` (one plan per source; add as we onboard)
- DOM mapping artifacts (selectors, JSON paths, fallbacks) referenced by scrapers

### Inputs
- Source inventory items from Department 1
- Current tooling constraints (Firecrawl, direct fetch, headless, etc.)
- Compliance requirements (Department 4 for Meta/Facebook; general constraints for others)

### Outputs
- Extraction plan (minimum):
  - Listing discovery strategy (search pages, feeds, sitemaps, category pages)
  - Listing URL patterns and canonicalization rules
  - Field map (where each field comes from; preferred selectors; fallbacks)
  - Rate limits and crawl budget (requests/minute, concurrency)
  - Failure modes and detection signals
  - Confidence rules (what is considered valid vs “needs review”)

### KPIs
- Time-to-first-extraction per source
- Yield: listings/day with acceptable confidence
- Breakage rate after source changes (tracked by Department 3)

### Handoff
Hands implemented-ready spec to Department 3 and Department 5 (if Firecrawl schema work is needed).

---

## Department 3: Pipeline maintenance, monitoring, and scheduling (auction monitoring is priority)

### Position: Pipeline Reliability Agent (Scrapers and Schedulers)

### Mission
Keep extraction tools working continuously: deploy, schedule, monitor, alert, and recover. Auctions require high-frequency monitoring (active bids, end times, comments) and must not silently stall.

### Owns
- Schedules and runbooks (cron/queues)
- Health metrics and alert thresholds per source
- On-call style response for degraded pipelines

### Inputs
- Extraction plans (Department 2)
- Tooling configurations (Department 5)
- Database constraints and cost budgets (Department 7)

### Outputs
- Monitoring rules per source (success rate, latency, parse quality)
- Backoff policies and safe retries
- Incident reports when sources break and patches needed

### KPIs
- Uptime: time ingestion is healthy per source
- MTTR: mean time to recovery after breakage
- Auction freshness: time since last successful poll for active auctions

### Handoff
Creates “Source Breakage Tickets” to Department 2 (plan update) and Department 5 (tool/schema tuning).

---

## Department 4: Facebook Marketplace (safe extraction or app acceptance)

### Position: Facebook Marketplace Agent (Compliance and Access)

### Mission
Either (a) identify a compliant way to obtain marketplace-like inventory data, or (b) build the full set of requirements needed to get a Meta app approved for the relevant permissions and use cases.

### Owns
- A compliance dossier: what is allowed, what is not, and what we will implement
- App-review readiness checklist and required endpoints/policies

### Inputs
- Business goal and product scope (what data we need and why)
- Meta platform requirements and constraints

### Outputs
- Decision memo: approved approach and risk profile
- Implementation requirements:
  - data use policy alignment
  - user-facing disclosure/consent flows if applicable
  - data deletion callbacks and privacy policy requirements
  - logging/audit requirements

### KPIs
- Time-to-approval (if pursuing app review)
- Risk: 0 high-risk collection methods in production

### Handoff
Provides constraints to Department 2 (planning) and Department 3 (monitoring), and UI requirements to the UI Agent for consent and transparency surfaces.

---

## Department 5: Firecrawl optimization (extraction efficiency and resilience)

### Position: Firecrawl Optimization Agent (Extractor Runtime and Cost)

### Mission
Make extraction cheap, fast, and stable across diverse sites by tuning Firecrawl usage, schemas, caching, and fallbacks.

### Owns
- Firecrawl schemas and structured extraction templates
- Guidance for when to use Firecrawl vs direct fetch vs source-specific adapter
- Cost controls (budgets, dedupe, caching)

### Inputs
- Extraction plans (Department 2)
- Reliability incidents (Department 3)

### Outputs
- Per-source extraction configuration (best strategy + fallback chain)
- Benchmarks: cost per successful listing and latency per listing

### KPIs
- Cost per extracted listing and cost per accepted field
- Parse success rate per source type
- Latency per listing (p50/p95)

### Handoff
Feeds improved configurations back to Department 3 for scheduling and to Department 6 for analysis gating (only analyze when extraction confidence warrants it).

---

## Department 6: Analysis agent (incremental, inexpensive, fact-based image analysis)

### Position: Analysis Standards Agent (Prompt and Validation Engineering)

### Mission
Maintain the highest standards of analysis: low cost, incremental development, and provable grounding. Build “boolean and essential” prompt combinations that produce fact-based fields from images with strict uncertainty handling.

### Owns
- Analysis prompt library (versioned)
- Evaluation harness (golden set, regression tests, cost tracking)
- Strict output schemas and confidence rules

### Inputs
- New image types and failure modes from production
- DB field definitions and constraints (Department 7)

### Outputs
- Prompt versions with test results and cost-per-image
- Incremental rollouts: start with the smallest set of high-signal fields and expand
- Rules for when analysis should not run (insufficient images, low confidence, duplicates)

### KPIs
- Cost per vehicle analyzed (and per useful field)
- Precision on a labeled benchmark set
- Regression rate (new prompts breaking old correctness)

### Handoff
Provides “analysis write contracts” (field names, types, confidence semantics) to Department 7 and UI requirements (review and provenance display) to the UI Agent.

---

## Department 7: Database optimizer (consistent growth, propagation, accuracy)

### Position: Database Optimizer Agent (Schema, Propagation, and Integrity)

### Mission
Ensure the database grows consistently and stays accurate: schema evolution, indexing, propagation rules, dedupe, and conflict handling across many sources.

### Owns
- Field definitions, normalization rules, and propagation logic
- Indexing and performance tuning
- Conflict strategy (when multiple sources disagree)
- Backfills and repair workflows

### Inputs
- Source extraction results (Departments 3/5)
- Analysis outputs (Department 6)

### Outputs
- Migrations and shims for safe resets
- Data quality dashboards: coverage, null rates, conflict rates, stale fields
- Canonicalization rules (VIN, URL, domains, vehicle identity)

### KPIs
- Query performance (p95)
- Data quality: % critical fields populated with provenance
- Conflict resolution throughput (how quickly conflicts become reviewable, then resolved)

### Handoff
Provides stable schemas and constraints to all departments. Feeds “needs UI” requirements to the UI Agent (review queues, provenance displays, admin dashboards).

---

## Department 8: UI agent (operations, transparency, and workflow)

### Position: UI Agent (Pipeline Operations and Trust UI)

### Mission
Turn the pipeline into an operable product: dashboards, review queues, provenance inspection, and tool surfaces so humans can steer the system.

### Owns
- Admin surfaces for:
  - source registry browsing and status
  - ingestion health and alerts
  - extraction plan status (coverage)
  - review queues (low confidence, conflicts, duplicates)
  - audit history for changes to critical fields

### Inputs
- Monitoring and alert outputs (Department 3)
- Provenance models (Department 7) and per-field sources
- Compliance flows (Department 4)

### Outputs
- “Truth UI”: per-field provenance popovers, confidence indicators, conflict diffs
- Operator workflows: approve/deny, retry, pause source, adjust schedules
- Cost and throughput dashboards

### KPIs
- Time to diagnose a broken source from the UI
- Review throughput (items/day)
- Operator error rate (bad approvals, accidental overwrites)

---

## Suggested cadence (lightweight, production-first)

- Daily:
  - Department 3 checks health, auctions freshness, and backlog levels
  - Department 6 monitors analysis spend and error rates
- Weekly:
  - Department 1 expands master list and refreshes priorities
  - Department 2 onboards top N sources with extraction plans
  - Department 5 reduces cost and improves parse stability on the worst offenders
  - Department 7 runs quality dashboards and plans propagation/indexing improvements
- Monthly:
  - Department 4 revisits compliance posture and app review readiness


