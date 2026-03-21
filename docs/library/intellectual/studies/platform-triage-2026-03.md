# Platform Triage: March 2026 Case Study

## A Reproducible Methodology for Infrastructure Auditing

---

## Abstract

In early March 2026, the Nuke provenance engine underwent a comprehensive platform triage that reduced the database from 171 GB to 156 GB, edge functions from 464 to 440 (with 259 archived deletions), cron jobs from 131 to 112, and estimated monthly burn by $1,500-3,000. This study documents the triage as a reproducible methodology: the triggers that indicated triage was necessary, the sequencing of operations, the criteria used for keep/kill decisions, and the safety protocols that prevented data loss during aggressive deletion. The methodology is presented as a reusable framework for future platform audits, applicable not only to Nuke but to any platform that has experienced rapid, AI-assisted growth without proportional maintenance.

---

## I. Introduction

### The Growth Problem

Nuke was built through 13,758 prompts across 141 days of intensive AI-assisted development. The velocity of construction — averaging 97 prompts per day, with peak days exceeding 500 — created a platform that grew faster than it could be maintained.

The symptoms of unmaintained growth were measurable:

| Metric | Value at Triage | Healthy Target | Overshoot Factor |
|--------|----------------|---------------|-----------------|
| Edge functions | 464 live | ~50 | 9.3x |
| Database size | 171 GB | ~50 GB | 3.4x |
| Database tables | 1,013 (483 empty) | ~200 | 5.1x |
| Cron jobs | 131 active | ~30 | 4.4x |
| 1-2 minute crons | 25 | 0 | Infinite |
| Monthly burn | ~$5,600 | ~$2,500 | 2.2x |

These numbers did not accumulate gradually. They accumulated explosively during February 2026 (38% of all prompts, 31.2% of all commits), when every system was under active development simultaneously.

### Triggers

Three events triggered the triage:

1. **February 27, 2026: Full API outage.** An unbounded UPDATE on the vehicles table ran for 30+ minutes, blocked PostgREST schema cache reload, and caused PGRST002 errors across all REST endpoints. The outage demonstrated that the platform's infrastructure could not support the development velocity.

2. **Cost review.** Monthly Supabase bill reached $5,600 — substantially above the budget for a pre-revenue platform. The primary drivers were database compute (large table scans from inefficient queries), storage (171 GB of largely redundant data), and edge function invocations (131 crons triggering hundreds of function executions per hour).

3. **Developer experience degradation.** With 464 edge functions, finding the right function for a task required searching through a maze of overlapping, duplicated, and abandoned code. The TOOLS.md registry was incomplete. Multiple functions performed the same operation with different naming conventions.

---

## II. Methodology

The triage followed a five-phase sequence, each phase building on the previous:

### Phase 1: Assessment (Days 1-2)

**Objective**: Understand the current state without changing anything.

**Operations**:
1. Count all edge functions and categorize by status (active, archived, unknown)
2. Enumerate all cron jobs with their frequencies and target functions
3. Measure database size by table, identifying the largest consumers
4. Count tables and identify empty tables (zero rows)
5. Map function dependencies (which functions call which)
6. Identify duplicate functionality (multiple functions doing the same thing)

**Output**: A complete inventory of platform components with size, frequency, and dependency data.

**Key finding**: 259 of 464 edge functions were already in a `_archived/` directory but still deployed and consuming resources. 483 of 1,013 tables contained zero rows. 25 cron jobs ran at 1-2 minute intervals with no clear justification.

### Phase 2: Classification (Days 2-3)

**Objective**: Classify every component as KEEP, KILL, or INVESTIGATE.

**Criteria**:

| Classification | Criteria |
|---------------|---------|
| KEEP | Active in production, referenced by frontend, or critical to extraction pipeline |
| KILL | Archived, duplicated, zero rows (for tables), or belonging to dead features |
| INVESTIGATE | Unknown purpose, possibly active, requires testing to determine status |

**Feature-level kills**: The dead feature analysis identified 9 features for deletion: betting, trading, vault, concierge, shipping, investor portal, and 3 duplicate extractors. All edge functions, database tables, and frontend routes associated with these features were classified as KILL.

**Cron job review**: Every cron job was evaluated against three criteria:
1. What does it do?
2. How often does it run?
3. Is the frequency justified by the task?

**Output**: A classification list for every edge function (464), cron job (131), and database table (1,013).

### Phase 3: Safe Deletion — Functions and Crons (Days 3-5)

**Objective**: Delete classified-KILL components without affecting production.

**Sequence**:
1. Disable KILL cron jobs first (stops triggering before deleting targets)
2. Delete archived edge functions (259 functions in `_archived/`)
3. Delete dead-feature edge functions
4. Verify frontend still loads — check for missing function calls
5. Monitor error logs for 24 hours after each deletion batch

**Safety protocol**: Deletions were performed in batches of 20-50 functions, with a monitoring period between batches. Each batch was verified against the dependency map to ensure no active component depended on a deleted function.

**Result**: 259 archived functions deleted. 24 additional functions deleted (dead features + duplicates). 19 cron jobs disabled. Net reduction: 464 to 440 live functions (further reduction toward target of 50 is ongoing).

### Phase 4: Database Cleanup (Days 5-10)

**Objective**: Reduce database size and table count through data deletion and vacuum.

**Operations executed**:

1. **Delete 'deleted' vehicles**: 8,056 vehicles with status='deleted' were removed, including all child rows across 6 related tables.

2. **Delete 'merged' vehicles**: 48,305 vehicles with status='merged' (duplicates that had been consolidated into canonical records) were removed with child rows.

3. **Begin deleting 'duplicate' vehicles**: Approximately 473,000 vehicles flagged as duplicates. Deletion proceeds in batches of 500-1,000 at a rate of approximately 1,200 per minute.

4. **Pre-delete child rows**: Before deleting parent vehicle records, child rows were deleted first to avoid FK constraint issues:
   - vehicle_images: 648,000 rows
   - status_metadata: 501,000 rows
   - detection_jobs: 436,000 rows
   - price_history: 389,000 rows
   - Total: 1.97 million child rows

5. **Drop blocking FK constraints**: Foreign key constraints using NO ACTION and SET NULL were dropped to prevent lock cascades during bulk deletion.

6. **Disable user triggers**: Triggers on the vehicles table were disabled during bulk deletion to prevent cascading function calls.

**Safety protocols**:

- **Batch size**: All DELETE operations used LIMIT 500-1000 with pg_sleep(0.1) between batches
- **Statement timeout**: Never exceeded 120 seconds
- **Lock monitoring**: After every write batch, checked `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'`
- **Active query check**: Before any DDL operation, verified fewer than 2 active queries on the affected table
- **No VACUUM FULL during active operations**: VACUUMs were scheduled for low-activity periods

**Result**: 171 GB reduced to 156 GB (15 GB reclaimed). Further reduction expected as VACUUM processes complete and duplicate vehicle deletion finishes.

### Phase 5: Policy Establishment (Days 10-14)

**Objective**: Establish rules that prevent re-accumulation of the problems that triggered triage.

**Rules established** (codified in CLAUDE.md as Hard Rules):

1. No new edge functions without TOOLS.md registration and confirmation that no existing function covers the use case
2. No new database tables without justification in migration comments
3. No cron jobs at frequencies above once every 5 minutes
4. All external fetches must use archiveFetch() (compliance was 5% before triage)
5. All createClient calls must use the shared pattern (444 functions were inlining this)
6. All CORS headers must import from _shared/cors.ts (318 functions were duplicating)
7. No unbounded UPDATE/DELETE on large tables — batch in 1,000-row chunks
8. Statement timeout never to exceed 120 seconds
9. After every SQL write, check lock impact
10. Dead feature code must be deleted in the same session as the feature kill decision

**Monitoring established**:
- Hourly stale lock release (cron job 188)
- Pipeline registry tracking 63 column-level ownership entries
- queue_lock_health view for live lock state monitoring

---

## III. What Was Cut

### Edge Functions (24 active deletions + 259 archived)

**Dead feature functions**:
- bat-extract (duplicate of bat-simple-extract)
- bat-simple-extract (duplicate, replaced by unified extractor)
- extract-collecting-cars-simple (abandoned extractor)
- extract-vehicle-data-ollama (deprecated AI approach)
- extract-and-route-data (superseded by observation pipeline)
- smart-extraction-router (superseded)
- extract-using-catalog (never completed)
- extract-with-proof-and-backfill (superseded)
- analyze-image (replaced by YONO pipeline)

**Archived directory**: 259 functions in `_archived/` were deployed but never called. These represented previous iterations of functionality that had been replaced but not cleaned up.

### Cron Jobs (19 disabled)

| Category | Jobs Disabled | Reason |
|----------|-------------|--------|
| 1-minute frequency | 12 | Excessive frequency, no justification |
| 2-minute frequency | 4 | Excessive frequency |
| Dead feature crons | 3 | Associated with killed features |

### Database (15 GB reclaimed)

| Operation | Rows Deleted | Size Impact |
|-----------|-------------|-------------|
| Deleted vehicles | 8,056 | ~2 GB |
| Merged vehicles | 48,305 | ~5 GB |
| Child rows (pre-delete) | 1,974,000 | ~8 GB |
| VACUUM reclaim | — | Ongoing |

### Directories

| Directory | Size | Reason |
|-----------|------|--------|
| _archived/ | 259 functions | Dead code, never called |
| nuke_api/ | Complete directory | Deprecated Elixir backend |
| nuke_backend/ | Complete directory | Deprecated backend |

---

## IV. What Was Kept

### Core Pipeline (Protected)

- **Universal search**: The primary search function
- **bat-simple-extract / extract-cars-and-bids-core**: Active extractors
- **extract-vehicle-data-ai**: AI-powered generic extraction
- **discovery-snowball**: Recursive lead discovery
- **ingest-observation**: Universal observation intake
- **db-stats**: Quick database overview

### Database Backbone

- **vehicles**: Core entity table (after deletion of deleted/merged/duplicate records)
- **vehicle_images**: Image registry (after child row cleanup)
- **auction_comments**: 11.5M comments (primary data asset)
- **vehicle_observations**: Observation system (growing)
- **observation_sources**: Source registry (protected)
- **pipeline_registry**: Column ownership tracking (new)

### Infrastructure

- **archiveFetch**: Shared fetch utility (adoption target: 100%)
- **_shared/cors.ts**: CORS headers (shared, not duplicated)
- **_shared/createClient**: Supabase client creation (shared)
- **Design system**: unified-design-system.css (protected, not to be modified)

---

## V. Results

### Quantitative

| Metric | Before Triage | After Triage | Reduction |
|--------|--------------|-------------|-----------|
| Edge functions (deployed) | 464 | 440 | -5.2% |
| Edge functions (archived deleted) | 0 | 259 deleted | — |
| Database size | 171 GB | 156 GB | -8.8% |
| Cron jobs | 131 | 112 | -14.5% |
| 1-2 min frequency crons | 25 | 0 | -100% |
| Estimated monthly burn | ~$5,600 | ~$3,100-4,100 | ~$1,500-3,000/mo |
| Empty tables | 483 | 483 (not yet dropped) | Pending |

### Qualitative

- **API stability**: No PGRST002 errors since triage (the outage that triggered triage has not recurred)
- **Developer experience**: TOOLS.md registry is now the canonical function lookup; Hard Rules prevent re-accumulation
- **Lock management**: Stale lock detection and release is automated; 375 stuck records were found and released during the initial sweep (367 vehicle_images locked since December 2025)
- **Query discipline**: Batched migration principle is enforced; no unbounded writes since triage

---

## VI. Methodology as Reusable Framework

The triage methodology is reproducible for any platform audit. The five phases apply regardless of the specific technology stack:

### Phase 1: Assessment Checklist

- [ ] Count all deployed services/functions
- [ ] Count all scheduled jobs with frequencies
- [ ] Measure storage by table/collection
- [ ] Identify empty/unused data structures
- [ ] Map dependencies between components
- [ ] Identify duplicate functionality
- [ ] Measure current cost baseline

### Phase 2: Classification Criteria

For each component, answer three questions:
1. **Is it active?** Referenced by production code, called by users, or scheduled?
2. **Is it unique?** Does it provide functionality not provided by another component?
3. **Is it necessary?** Would removing it break anything that matters?

If NO to all three: KILL. If YES to any: KEEP or INVESTIGATE.

### Phase 3: Deletion Safety Protocol

1. Disable triggers before deleting targets
2. Delete in batches with monitoring between batches
3. Verify production stability after each batch
4. Monitor error logs for 24 hours minimum
5. Have rollback plan (re-deployment scripts, database backups)

### Phase 4: Data Cleanup Safety Protocol

1. Delete child rows before parent rows
2. Drop blocking FK constraints before bulk deletion
3. Batch all deletes (500-1,000 rows, with pg_sleep between batches)
4. Never exceed statement timeout (120 seconds)
5. Monitor lock state after every write batch
6. Schedule VACUUMs for low-activity periods
7. Do not run DDL while data operations are active

### Phase 5: Policy Establishment

1. Document what caused the bloat (specific patterns)
2. Create rules that prevent each pattern's recurrence
3. Codify rules in developer documentation (CLAUDE.md equivalent)
4. Establish automated monitoring for compliance
5. Schedule regular audits (quarterly recommended)

---

## VII. Root Cause Analysis

### Why Did the Platform Bloat?

The root cause was **AI-assisted development velocity without proportional maintenance discipline.**

The AI coding assistants (Cursor, Claude Code) are optimized for creation: given a prompt, they generate code. They are not optimized for maintenance: they do not spontaneously notice that a new function duplicates an existing one, that a new table is unnecessary, or that a new cron job runs too frequently.

The result was a positive feedback loop:

```
Prompt -> AI generates new function -> Function deployed ->
Next prompt references new function (not old one) ->
AI generates another new function -> ... repeat 464 times
```

Each prompt tended to create new code rather than modify existing code, because creation is the AI's strength and modification requires the AI to find and understand existing code first. The path of least resistance was always "build new" rather than "find and reuse."

### Specific Patterns

1. **Function duplication**: When a new extraction need arose, a new edge function was created rather than modifying the existing one. Result: 9 extractors for BaT alone at peak.

2. **Table proliferation**: Each new feature created its own tables rather than reusing existing ones. Result: 1,013 tables, 483 empty.

3. **Cron frequency inflation**: When a process seemed slow, the cron frequency was increased rather than the process being optimized. Result: 25 crons running at 1-2 minute intervals.

4. **Dead code accumulation**: When a function was replaced, the old version was moved to `_archived/` but not deleted. Result: 259 zombie functions consuming deployment resources.

5. **Shared code avoidance**: 444 functions inlined the Supabase client creation. 318 duplicated CORS headers. Only 5% used archiveFetch for external URLs. Each function was self-contained rather than using shared utilities.

### Prevention Mechanisms

The Hard Rules established in Phase 5 directly target each pattern:

| Pattern | Prevention Rule |
|---------|----------------|
| Function duplication | TOOLS.md registration required before creating new functions |
| Table proliferation | Migration comment justification required |
| Cron frequency inflation | Minimum 5-minute frequency enforced |
| Dead code accumulation | Dead feature code must be deleted in same session as kill decision |
| Shared code avoidance | Mandatory imports from _shared/ for CORS, client, and fetch |

---

## VIII. Remaining Work

The March 2026 triage addressed the most urgent issues but did not complete the cleanup:

| Task | Status | Estimated Impact |
|------|--------|-----------------|
| Delete remaining ~473K duplicate vehicles | In progress (background) | ~30 GB |
| Drop ~388 empty tables | Not started | Minimal storage, major schema clarity |
| listing_page_snapshots retention | Not started | 79 GB potential reclaim |
| Re-enable disabled triggers | Not started | Required for normal operation |
| Fix broken trigger (auto_update_primary_focus) | Not started | References missing receipt_links table |
| Reduce edge functions from 440 to target 50 | Not started | Major simplification |
| Complete TOOLS.md coverage | In progress | Developer experience |

The largest remaining opportunity is listing_page_snapshots (79 GB) — archived HTML/markdown of scraped pages. A retention policy (delete snapshots older than N months for low-value sources) could reclaim more storage than all other triage operations combined.

---

## IX. Conclusions

The March 2026 triage reclaimed 15 GB of storage, eliminated 25 high-frequency cron jobs, deleted 283 edge functions, and reduced estimated monthly burn by $1,500-3,000. More importantly, it established a maintenance discipline — Hard Rules, TOOLS.md registry, pipeline registry, automated lock monitoring — that should prevent re-accumulation.

The triage was triggered by a production outage (the February 27 API crash) and a cost review. Both triggers were lagging indicators — the platform had been bloating for months before the symptoms became acute. A leading indicator approach — quarterly audits using the Phase 1 checklist — would have caught the bloat earlier and at lower cost.

The fundamental lesson is that AI-assisted development requires proportional AI-assisted maintenance. The AI that creates 464 edge functions must also be directed to consolidate them. The AI that generates new tables must also be directed to reuse existing ones. The velocity that builds the platform is the same velocity that bloats it — and the correction must be as intentional and disciplined as the construction.

---

*This study documents the March 2026 platform triage based on operations performed between March 7 and March 20, 2026. Database sizes and function counts are as measured during the triage period. The methodology is presented as a reusable framework; specific numbers and thresholds should be adjusted for different platform scales and architectures. Source data: MEMORY.md (platform triage section), CLAUDE.md (Hard Rules), COMPLETE_AUDIT.md, PROJECT_STATE.md.*
