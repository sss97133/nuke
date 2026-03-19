# nuke

Vehicle data intelligence.

---

Nuke turns minimal low signal data points lets say anywhere from 10-100 data points into 10,000+ sourced observations per vehicle —
every claim traced to origin, confidence-scored, time-ordered.
Nothing overwrites. Everything compounds.

```
input:  1 auction listing, 1 VIN, 47 photos, 312 comments
output: factory spec (every option code, every part number)
        component state (per-part condition, mods, replacements)
        identity verification (VIN decode ↔ stamps ↔ tags ↔ build sheet)
        market position (comps, valuations, price trajectory)
        provenance chain (who built it, who owned it, who worked on it)
        visual inspection (41-zone classification, damage, paint, gaps)
        source conflicts flagged, multi-model jury scored
```


---

## What this is

A **database**, a set of **analysis functions**, and **trained ML models** — built around vehicles people care about.

| What | Scale |
|------|-------|
| Vehicles | 645,725 entities with year, make, model, VIN, specs, provenance |
| Auction comments | 11.6M  — sentiment-scored |
| Images | 32.7M vehicle photos, classified by 41-zone taxonomy |
| Valuations | 609,433 nuke estimates (94.4% coverage) |
| Sale events | 192,539 extracted across 10+ auction platforms |
| Organizations | 4,973 dealers, shops, auction houses |
| External identities | 510,086 seller/buyer/commenter profiles |

## How it works

Raw data goes in. Structured knowledge comes out. That's the whole idea.

```
               ┌─────────────────────────────────────────────────┐
               │                   raw inputs                    │
               │                                                 │
               │  listing URL    VIN string    photo set    text │
               └────────┬───────────┬────────────┬──────────┬───┘
                        │           │            │          │
                        ▼           ▼            ▼          ▼
               ┌────────────┐ ┌──────────┐ ┌─────────┐ ┌───────┐
               │  scrape +  │ │ NHTSA +  │ │  YONO   │ │  LLM  │
               │  archive   │ │ decode + │ │  make   │ │ field │
               │  (never    │ │ build    │ │ zone    │ │ ext.  │
               │  refetch)  │ │ sheet    │ │ damage  │ │ w/    │
               │            │ │ lookup   │ │ cond.   │ │ cite  │
               └─────┬──────┘ └────┬─────┘ └────┬────┘ └───┬───┘
                     │             │             │          │
                     └──────┬──────┴─────────────┴──────┬───┘
                            │                           │
                            ▼                           ▼
               ┌─────────────────────┐  ┌──────────────────────┐
               │   observation log   │  │   conflict detection │
               │   (append-only,     │  │   (sources disagree? │
               │    source-tagged,   │  │    flag it, score it,│
               │    scored 0→1)      │  │    investigate)      │
               └─────────┬───────────┘  └──────────┬───────────┘
                         │                         │
                         └────────┬────────────────┘
                                  ▼
               ┌─────────────────────────────────────────────────┐
               │              vehicle as knowledge graph         │
               │                                                 │
               │  factory spec ── component state ── provenance  │
               │  identity verification ── market position       │
               │  visual inspection ── actor chain ── timeline   │
               └─────────────────────────────────────────────────┘
```

**Vision → SQL** is the core trick. A photo of an engine bay doesn't stay
a photo. It becomes queryable fields: `air_cleaner_type`, `valve_cover_finish`,
`exhaust_manifold_match`, `engine_stamp_visible`, `modification_detected`.
YONO (EfficientNet-B0) classifies make in 4ms at $0. Florence-2 maps 41 zones.
Google Vision reads stamps and tags. The image dissolves into structured data.

**Text → observations** works the same way. An auction comment saying
"those aren't the right mirrors for a '70 SS" becomes a sourced observation
on `component_state.mirrors` with `confidence: 0.50`, `source_type: forum`,
and a citation back to the original comment.

**Nothing is trusted. Everything is evidence.** Three independent sources
confirming the same fact compounds confidence. One source contradicting
the others triggers a flag. The system doesn't decide what's true —
it shows you what the evidence supports.

## Data model

The database doesn't describe the vehicle. The database **is** the vehicle.

Every component, every modification, every claim anyone's ever made —
sourced, scored, and stacked. Where three independent sources agree,
a fact emerges. Where they disagree, an investigation begins.

```
vehicle (identity)
  -> factory_specification (what it left the factory as — every bolt, every option, every part number)
  -> component_state (what it is NOW — per-component condition, modifications, replacements)
  -> observations (append-only evidence log — every claim traced to source with confidence)
  -> field_evidence (multi-source provenance per field — agreement, conflict, citations)
  -> component_events (work log — who did what, when, where, with what parts)
  -> actors (builders, shops, inspectors, owners — reputation through evidence chain)
  -> images (classified by 41-zone taxonomy: exterior, interior, engine bay, undercarriage, detail)
  -> market_intelligence (auctions, valuations, comparables, listings across platforms)
  -> validation_results (clone detection, VIN cross-check, code verification, known issues)
```

The schema is the spec. Hand the DDL to any LLM with source material —
photos, descriptions, build sheets, comments — and it fills in the record
with citations. Every cell knows where it came from.

Sources carry trust: factory data (0.95), major auctions (0.85),
forums (0.50), AI extraction (0.70). Confidence decays over time.
Nothing is certain. Everything is evidence.

## Architecture

```
Vercel (React SPA) ──> Supabase Edge Functions (Deno, REST) ──> PostgreSQL v15
                                    |
                          +---------+---------+
                          |         |         |
                        Modal    Firecrawl   External APIs
                       (YONO ML) (scraping)  (BaT, FB, NHTSA...)
```

**Full technical overview**: [docs/REPOSITORY_OVERVIEW.md](docs/REPOSITORY_OVERVIEW.md)

## The writing

This project generated a body of writing about how
systems get built, what data reveals about itself,
and what happens when one person talks to AI for
13,758 prompts across 141 days.

- [The conceptual foundation](VISION.md)
- [Rhizomatic analysis](docs/writing/RHIZOME.md) —
  11 machines mapped from the prompt corpus
- [Concept genealogy](docs/writing/CONCEPT_GENEALOGY.md) —
  biography of 8 load-bearing ideas
- [The narrative arc](docs/writing/NARRATIVE_ARC.md) —
  the 20-week story
- [Vocabulary evolution](docs/writing/VOCABULARY_EVOLUTION.md) —
  how the language changed
- [Dead features](docs/writing/DEAD_FEATURES.md) —
  archaeology of abandoned ideas
- [All 23 documents](docs/writing/)

---

[nuke.ag](https://nuke.ag)
