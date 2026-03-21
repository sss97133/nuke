# SCHEMATICS

## The Nuke System Architecture Reference

This is the technical schematic book for the Nuke vehicle data platform. These documents describe the actual system as implemented in code and database, with enough detail that the entire architecture could be rebuilt from them.

Each document covers one architectural dimension of the system. Together they form a complete engineering blueprint.

---

## Table of Contents

### [1. Data Flow](./data-flow.md)
The complete path from URL entry to structured database record. Every step, every function, every table touched. Covers the current production flow, the domain-specific extractor routes, the generic AI fallback, the archive-first fetching strategy, and the quality gate pipeline. Includes ASCII flow diagrams for all major paths.

### [2. Entity Relationships](./entity-relationships.md)
Every entity type in the system and how they relate. vehicles, vehicle_images, vehicle_observations, observation_sources, import_queue, auction_comments, vehicle_events, auction_events, field_evidence, extraction_metadata, pipeline_registry, listing_page_snapshots, bat_quarantine. Full ER diagrams with foreign keys, cardinality, and column inventories.

### [3. Pipeline Architecture](./pipeline-architecture.md)
The extraction pipeline in detail: the three-tier AI agent hierarchy (Haiku/Sonnet/Opus), the routing logic that selects extractors per domain, the quality gate that validates data before writes, the Tetris provenance write layer, escalation paths, retry logic, and cost controls. How a URL becomes structured data through which models at which costs.

### [4. Observation System](./observation-system.md)
The observation architecture: how ingest-observation works, the trust scoring mechanism, content hashing for deduplication, vehicle resolution logic (VIN match, URL match, fuzzy match), the relationship between observation_sources and vehicle_observations, and the path toward a fully source-agnostic data model.

---

## How to Read These Documents

These schematics describe the system as it exists in code, not as an aspirational design. Where the current implementation diverges from the encyclopedia specification, both states are documented and the gap is called out.

ASCII diagrams use the following conventions:

```
[Entity]          -- A database table or named concept
(Function)        -- An edge function or RPC
{Decision}        -- A branching decision point
-->               -- Data flow direction
==>               -- Async/fire-and-forget flow
~~~>              -- Degraded/fallback path
|                 -- Vertical flow continuation
*                 -- Cardinality marker (many)
1                 -- Cardinality marker (one)
```

All file paths are relative to `/Users/skylar/nuke/` unless otherwise noted.

## Source Files

The code described in these schematics lives in:

| Area | Path |
|------|------|
| Edge functions | `supabase/functions/` |
| Shared utilities | `supabase/functions/_shared/` |
| Migrations | `supabase/migrations/` |
| Scripts | `scripts/` |
| Frontend | `src/` |

## Last Updated

2026-03-20. Based on codebase state as of this date.
