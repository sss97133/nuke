# BUILD PROMPTS

Engineered prompts for agent execution. Each prompt references the library as ground truth. Each prompt has a defined scope, verification criteria, and explicit anti-patterns.

These are not vague instructions. They are precise execution specs.

## Prompt Sequence

| # | Prompt | Scope | Prerequisites |
|---|--------|-------|---------------|
| 00 | Fix Schema-Code Mismatch | 1 migration | None |
| 01 | Add Audit Trail Fields | 1 migration + 1 function update | P00 |
| 02 | Universal Entity Resolver | 1 new shared function + update callers | P00 |
| 03 | Enforce Single Write Path | Modify existing extractors | P00, P01, P02 |
| 04 | Unified Asset Registry | 1 new table + 1 migration | P00-P03 verified |
| 05 | Art Schema | ~20 new tables | P04 |
| 06 | Art Observation Sources | Config inserts | P05 |
| 07 | Art MCP Tools | ~5 new MCP tools | P03-P06 |

### Organization & Valuation Track (P06-P12)

Built on the org profile overhaul (P1-P5 in the plan, completed 2026-03-29). These prompts expand seller wiring, fix valuation blind spots, and build organization reputation signals.

| # | Prompt | Scope | Prerequisites |
|---|--------|-------|---------------|
| 06 | Seller→Organization Auto-Discovery | 1 script, no new tables | Org profile P1-P5 complete |
| 07 | Valuation Comp Method Audit | 2 scripts + documentation | P1 (circularity fix) deployed |
| 08 | Org Profile as Provenance Container | Service + frontend extension | P06 (more orgs to show data for) |
| 09 | Ownership Classification — Beyond Regex | Expanded classifier + backfill | P06 (more sellers to classify) |
| 10 | Organization Reputation Signal | Service + 1 denorm column + frontend | P08, P09 (need data quality + ownership data) |
| 11 | Cross-Platform Seller Resolution | 1 resolution script | P06 (need seller→org wiring infrastructure) |
| 12 | Modified Vehicle Valuation | 2 columns + comp filter + backfill | P07 (need comp method audit first) |

**Dependency graph:**
```
P06 (discover sellers) ──> P08 (provenance container) ──> P10 (reputation signal)
                       ──> P09 (deep ownership)       ──/
                       ──> P11 (cross-platform)

P07 (comp audit) ──> P12 (modified vehicle handling)
```

P06 and P07 are independent — execute in parallel. P08/P09 need P06. P10 needs P08+P09. P11 needs P06. P12 needs P07.

Execute in order within each dependency chain. Verify each before starting the next.

### Vehicle Profile Computation Surface Track (P10-P15)

Built on the 5-phase profile polish (commit `7489c4d5e`, 2026-03-29). Each prompt deepens a foundation laid in that commit. Grounded in the computation surface philosophy: the profile computes intelligence from the knowledge graph in real time.

| # | Prompt | Scope | Prerequisites |
|---|--------|-------|---------------|
| 10 | Day Card Seven-Level Analysis | DayCard narrative section (~20 lines template logic) | Phase 1 `+` button exists |
| 11 | Gallery Filter Widget Wiring | Wire galleryFilter into ImageGallery + 3 emitters | Phase 5 foundation exists |
| 12 | Powerplant Field Deduplication | Token-overlap dedup in Dossier panel | Phase 3 grouping exists |
| 13 | Analysis Signals Compute Sweep | 1 backfill script + coordinator update | Phase 4 frontend exists |
| 14 | Timeline Filter Modes | Filter pill bar on BarcodeTimeline | Phase 2 year seps exist |
| 15 | Dossier Provenance Depth Indicators | Epistemological layer borders on FieldRow | Phase 3 grouping exists |

**P10-P15 are independent — execute in any order.** Each deepens a different axis:
- P10: **depth** (raw data → computed narrative)
- P11: **coupling** (left column controls right column)
- P12: **signal/noise** (reduce redundancy in specs)
- P13: **backend** (populate the signals the frontend reads)
- P14: **filtering** (timeline becomes multi-view, not monolithic)
- P15: **epistemology** (make truth depth visible at a glance)
