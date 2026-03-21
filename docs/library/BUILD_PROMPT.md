# BUILD PROMPT

This is the master prompt for any agent session that touches Nuke architecture. It references the library as ground truth. It prevents duplication. It enforces fix-first energy.

---

## BEFORE YOU DO ANYTHING

```
Read these in order. Do not skip. Do not skim.

1. docs/library/reference/encyclopedia/README.md    — What the system IS
2. docs/library/reference/dictionary/README.md       — What every term means
3. docs/library/reference/index/README.md            — Where everything lives
4. docs/library/technical/schematics/                — How things connect
5. docs/library/technical/engineering-manual/         — How things were built
6. TOOLS.md                                          — What already exists
7. CLAUDE.md                                         — Hard rules
```

If you didn't read these, you will build something that already exists. You will create a duplicate. You will break something. Read them.

---

## THE RULE

**Do not build things that already exist. Fix what's there.**

Before writing any new function, table, or component:

```
1. Search TOOLS.md — does a tool already handle this intent?
2. Search the INDEX — is there already a file, function, or table for this?
3. Query pipeline_registry — who owns this column?
4. Check the edge functions directory — is there already an extractor for this source?
5. Read the engineering manual chapter for this subsystem — does it describe what you're about to build?
```

If something exists but is broken → fix it.
If something exists but is incomplete → complete it.
If something exists but is in the wrong architecture → migrate it (strangler fig, not rewrite).
If nothing exists → then and only then, build new.

---

## PHASE 0: FIX THE FOUNDATION

These are the four changes that must happen before any new vertical work. They improve vehicles immediately and are prerequisites for art. Reference: ENCYCLOPEDIA Section 17-21.

### 0.1 Enforce Single Write Path

**What exists**: `ingest-observation` function works. `vehicle_observations` table works. `observation_sources` registry works.

**What's broken**: Extractors bypass it. `extract-bat-core` writes directly to `auction_comments`, `vehicle_events`, `vehicle_images`. Two parallel data pipelines.

**The fix**: Modify existing extractors to write through `ingest-observation`. Do NOT create new extractors. Do NOT create new tables. Fix the write path in the functions that exist.

**How to verify**: After the fix, `vehicle_observations` should receive every new data point. Query: `SELECT count(*) FROM vehicle_observations WHERE created_at > now() - interval '1 hour'` should show activity matching extraction rate.

**Library reference**: ENCYCLOPEDIA Section 17, Engineering Manual Chapter 04

### 0.2 Deploy Universal Entity Resolver

**What exists**: Per-extractor matching logic in `extract-bat-core`, `ingest-observation`, `haiku-extraction-worker`. Each implements its own vehicle matching.

**What's broken**: Fuzzy Y/M/M matching at 60% confidence auto-merges wrong vehicles.

**The fix**: Extract matching logic into one shared function in `_shared/`. All extractors call this function instead of implementing their own. Auto-match threshold = 0.80. Below 0.80 = candidate only, never auto-match.

**How to verify**: No extraction should ever write to the wrong vehicle. Query: check `vehicle_observations.vehicle_match_confidence` — nothing below 0.80 should have `vehicle_id` set.

**Library reference**: ENCYCLOPEDIA Section 18, Theoreticals: entity-resolution-theory.md

### 0.3 Add Audit Trail

**What exists**: `vehicle_observations` has `source_id`, `confidence_score`, `vehicle_match_signals`.

**What's broken**: No `agent_tier` field (which model extracted this?). No `extraction_method` field. No `raw_source_ref` linking back to the specific archive page.

**The fix**: ALTER TABLE to add missing audit columns. Update `ingest-observation` to populate them. This is a schema migration + function update, not new infrastructure.

**How to verify**: Every new observation should have all audit fields populated. `SELECT count(*) FROM vehicle_observations WHERE agent_tier IS NULL AND created_at > now() - interval '1 day'` should return 0.

**Library reference**: ENCYCLOPEDIA Section 20

### 0.4 Fix Schema-Code Mismatch

**What exists**: `import_queue` CHECK constraint allows: `pending, processing, complete, failed, skipped, duplicate`.

**What's broken**: Code writes `pending_review` and `pending_strategy`. Records stuck in unvalidated states.

**The fix**: ALTER TABLE to add the missing status values to the CHECK constraint. One migration.

**How to verify**: `SELECT status, count(*) FROM import_queue GROUP BY status` — no records in states that don't match the CHECK constraint.

**Library reference**: Engineering Manual Chapter 01

---

## PHASE 1: UNIFIED ASSET LAYER

Only start this after Phase 0 is verified.

### 1.1 Create Assets Registry

**What exists**: `vehicles` table with ~18K records.

**What to build**: `assets` table — thin registry. `id`, `type` (vehicle/artwork), `display_title`, `created_at`, `status`. Every existing vehicle gets a row via migration. New `asset_id` FK on `vehicles`.

**What NOT to build**: Do not refactor vehicle queries. Do not change any existing vehicle table structure. Just add the registry on top.

**Library reference**: ENCYCLOPEDIA Section 1

### 1.2 Create Art Schema

**What exists**: Nothing.

**What to build**: Tables defined in ENCYCLOPEDIA Section 2-5:
- `artworks` (the shell — like vehicles)
- `artwork_components` (material resolution)
- `artwork_images` (same pattern as vehicle_images)
- `artist_profiles` (extension on users)
- `exhibitions`, `exhibition_history`
- `provenance_entries` (shared across domains)
- `literature_references`
- `conservation_history`
- `certificates_of_authenticity`
- `auction_results` (shared — already exists for vehicles, extend with asset_id)
- `private_sales`
- `appraisals`
- `org_staff`, `artist_representation`
- `edition_parents`

**Before building**: Read the ENCYCLOPEDIA section for each table. Read the DICTIONARY definition. Check the SCHEMATICS for entity relationships. Do not invent fields — use what the library defines.

**Library reference**: ENCYCLOPEDIA Sections 2-5, 12

### 1.3 Art Observation Sources

**What to build**: Register art sources in `observation_sources` with trust scores from the ALMANAC.

**What NOT to build**: New extraction functions. Art extraction uses MCP tools (ENCYCLOPEDIA Section 21). The agent IS the extractor.

**Library reference**: ENCYCLOPEDIA Section 6, ALMANAC trust scores

---

## AFTER BUILDING: CONTRIBUTE TO THE LIBRARY

Every build session that produces insight must contribute to the library. See `docs/library/LIBRARIAN.md` for the decision tree.

At minimum:
- Schema changes → DICTIONARY entries for new columns
- New subsystems → INDEX entries for new files
- Problems solved → ENGINEERING MANUAL updates
- Numbers changed → ALMANAC updates

The library is the system's memory. If you built something and didn't document it, it's as if it doesn't exist for the next agent.

---

## WHAT THIS PROMPT IS NOT

This is not "build the art vertical in one shot." This is "here's the library, here's the ground truth, here's what needs to happen in what order, and here's how to verify each step before moving to the next."

The library prevents the Frankenstein. The phased approach prevents building on broken foundations. The verification steps prevent silent failures.

Fix what's there. Extend what works. Build new only when the library says nothing exists.
