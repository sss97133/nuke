# nuke

A provenance engine that builds knowledge graphs from the traces physical assets leave as they move through networks of people and organizations.

Automotive is the first ontology loaded. It's not the machine.

---

```
input:  1 auction listing, 1 VIN, 247 photos, 32 comments
output: 10,000+ sourced observations — every claim traced to origin,
        confidence-scored, time-ordered. Nothing overwrites. Everything compounds.
```

| What | Scale |
|------|-------|
| Vehicles | 645,725 entities (292K active) |
| Images | 32.8M classified by 41-zone taxonomy |
| Auction comments | 11.6M sentiment-scored, 99.9% identity-linked |
| Sale events | 313,539 across 10+ platforms |
| Valuations | 503,337 nuke estimates |
| Organizations | 4,973 dealers, shops, auction houses |
| External identities | 510,086 seller/buyer/commenter profiles |
| Field evidence | 746,963 source-attributed citations |

## The library

The system's knowledge lives in [`docs/library/`](docs/library/README.md). If the code disappeared tomorrow, the library rebuilds it.

| Shelf | What | Scale |
|-------|------|-------|
| [**Dictionary**](docs/library/reference/dictionary/) | Every table, column, term, enum | 20,749 lines |
| [**Encyclopedia**](docs/library/reference/encyclopedia/) | 23 sections — what the system IS | 1,250 lines |
| [**Schematics**](docs/library/technical/schematics/) | Data flow, entity relationships, pipeline architecture | 4,342 lines |
| [**Engineering Manual**](docs/library/technical/engineering-manual/) | 8 chapters — how to build every subsystem from scratch | 4,279 lines |
| [**Theoreticals**](docs/library/intellectual/theoreticals/) | Valuation, entity resolution, signal calc, half-life model | 3,205 lines |
| [**Contemplations**](docs/library/intellectual/contemplations/) | The rhizome, testimony, assets accumulate data | 1,769 lines |
| [**Studies**](docs/library/intellectual/studies/) | 13K prompts analysis, platform triage, vocabulary evolution | 1,498 lines |
| [**Build Prompts**](docs/library/prompts/) | Phased implementation instructions (Phase 0-1) | 6 prompts |
| [**Librarian**](docs/library/LIBRARIAN.md) | Rules for how the library grows | 218 lines |

**40,000 lines. 50 files. 3% of target scale.** The library grows as a byproduct of work, not as a separate task. See [LIBRARIAN.md](docs/library/LIBRARIAN.md) for contribution rules.

## How it works

```
            ┌─────────────────────────────────────────────────┐
            │                   raw inputs                    │
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
            │              asset as knowledge graph           │
            │                                                 │
            │  factory spec ── component state ── provenance  │
            │  identity verification ── market position       │
            │  visual inspection ── actor chain ── timeline   │
            └─────────────────────────────────────────────────┘
```

**Vision → SQL**: A photo of an engine bay becomes queryable fields: `air_cleaner_type`, `valve_cover_finish`, `engine_stamp_visible`, `modification_detected`. YONO classifies make in 4ms at $0. Florence-2 maps 41 zones.

**Text → observations**: An auction comment saying "those aren't the right mirrors for a '70 SS" becomes a sourced observation on `component_state.mirrors` with `confidence: 0.50` and a citation back to the original comment.

**Nothing is trusted. Everything is evidence.** Three independent sources confirming the same fact compounds confidence. One contradicting triggers a flag. The system doesn't decide what's true — it shows you what the evidence supports.

## Data model

The database doesn't describe the vehicle. The database **is** the vehicle.

```
vehicle (identity)
  → factory_specification (what it left the factory as)
  → component_state (what it is NOW — per-component condition, mods, replacements)
  → observations (append-only evidence log — every claim traced to source)
  → field_evidence (multi-source provenance per field — agreement, conflict, citations)
  → component_events (who did what, when, where, with what parts)
  → actors (builders, shops, inspectors, owners — reputation through evidence)
  → images (classified by 41-zone taxonomy)
  → market_intelligence (auctions, valuations, comparables across platforms)
```

Sources carry trust: factory data (0.95), major auctions (0.85), forums (0.50), AI extraction (0.70). Confidence decays over time.

## Architecture

```
Vercel (React SPA) ──→ Supabase Edge Functions (Deno) ──→ PostgreSQL v15
                                    │
                          ┌─────────┼─────────┐
                          │         │         │
                        Modal    Firecrawl   External APIs
                       (YONO ML) (scraping)  (BaT, FB, NHTSA...)
```

## Start here

| Doc | What it is |
|-----|-----------|
| [**Library**](docs/library/README.md) | The system in written form — dictionary, schematics, engineering manual |
| [**VISION.md**](VISION.md) | Why Nuke exists, the $1T gap, product stack |
| [**TOOLS.md**](TOOLS.md) | Intent → function map. Read before building anything. |
| [**CLAUDE.md**](CLAUDE.md) | Hard rules — 15 laws that prevent the platform from bloating |
| [**PROJECT_STATE.md**](PROJECT_STATE.md) | Current sprint focus, what's active, what's paused |
| [**Design Bible**](docs/DESIGN_BIBLE.md) | Three design laws, visual identity, component patterns |
| [**Build Prompt**](docs/library/BUILD_PROMPT.md) | Phase 0-1 implementation guide for new agents |

## The three entities

```
USER (artist, collector, driver, dealer)
  └── never an asset, always an actor
  └── owns/creates/touches assets through organizations

ORG (magazine, gallery, auction house, shop, racing team)
  └── CAN become an asset (a magazine's archive, a gallery's reputation)
  └── accumulates value through the assets it touches

ASSET (vehicle, painting, magazine issue, photograph, garment)
  └── immutable in identity, accumulates data forever
  └── provenance = the chain of actors who touched it
  └── value is a function of the data accumulated on it
```

Networks are derived from collaborative traces, not declared intent. Two actors are connected because they both touched the same asset, money moved between them, or an organization links them. These traces are permanent.

---

[nuke.ag](https://nuke.ag)
