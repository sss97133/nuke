# THE NUKE LIBRARY

> A person should be able to come around in the future and rebuild everything from these books alone.

Organized like a physical library. Each book grows continuously. Every agent session, every extraction, every schema change, every decision generates pages. The library is the proof the system exists.

---

## THE STACKS

### Reference Shelf — Ground Truth

These books ARE the system in written form. If the code disappeared tomorrow, the reference shelf rebuilds it.

| Book | What It Is | Target Scale |
|------|-----------|-------------|
| **DICTIONARY** | Every term, every field, every column, every status value, every enum, every role. Not 60 entries — every noun the system knows. | 500+ pages |
| **ENCYCLOPEDIA** | Deep reference on every system, domain, concept, and subsystem. One chapter per major entity, 30-50 pages each. | 1,000+ pages |
| **THESAURUS** | Complete vocabulary mapping. Every synonym, every alias, every colloquial term mapped to its canonical system term. | 200+ pages |
| **INDEX** | Every concept mapped to every file, function, table, column, migration, edge function, MCP tool, and doc. The card catalog. | 300+ pages |
| **ALMANAC** | Every number. Every stat. Every trust score. Every threshold. Every cost. Every count. Historical time series. | 500+ pages |
| **ATLAS** | Every geographic entity. Every institution. Every API endpoint. Every scrape target. Every market calendar. Contact methods. Access notes. | 300+ pages |

### Technical Shelf — How Things Work

| Book | What It Is | Target Scale |
|------|-----------|-------------|
| **SCHEMATICS** | Database diagrams, data flow charts, pipeline architecture, entity relationships. Visual and written. Every table, every FK, every constraint. | 500+ pages |
| **DESIGN BOOK** | UI specifications, component library, interaction patterns, layout grids, color values, typography rules, animation specs. Every screen, every state. | 300+ pages |
| **ENGINEERING MANUAL** | How to build every subsystem from scratch. Step-by-step construction guides. The instructions that come with the machine. | 500+ pages |

### Intellectual Shelf — Why Things Are

| Book | What It Is | Target Scale |
|------|-----------|-------------|
| **PAPERS** | Formal write-ups of solved problems. How entity resolution works and why. How trust scoring was designed. How the observation model was chosen. Peer-reviewable depth. | 200+ pages |
| **DISCOURSES** | Strategic discussions captured in full. Like today's conversation. The reasoning behind architectural decisions. Design philosophy. Domain analysis. | 500+ pages |
| **THEORETICALS** | Unsolved problems, proposed approaches, mathematical models, algorithmic designs. Signal calculation theory. Valuation methodology. Half-life decay functions. | 200+ pages |
| **STUDIES** | Empirical analysis of data. "We scraped 141K vehicles and here's what the data shows about condition-price correlation." Data-driven findings. | 300+ pages |
| **CONTEMPLATIONS** | The philosophical underpinning. Deleuze and the rhizome. Why observations are testimony. Why assets accumulate rather than change. The ontological basis. | 100+ pages |

### Working Shelf — Truth in Formation

| Section | What It Is |
|---------|-----------|
| **journals/** | Session logs, handoffs, chronological records. Raw. Every session appends. |
| **working-papers/** | Analysis in progress. The drafts that become reference when stable. |
| **field-notes/** | Observations from the field. Things noticed while using the system, scraping sources, or talking to domain experts. |
| **post-mortems/** | What went wrong and why. Every outage, every data corruption, every failed migration documented. |

---

## THE GROWTH MECHANISM

The library doesn't grow by someone sitting down to write documentation. It grows as a byproduct of work.

### Auto-Generation Rules

Every agent session MUST append to at least one book:

1. **Schema change?** → DICTIONARY gets new entries (every new column defined), SCHEMATICS gets updated diagrams, ENGINEERING MANUAL gets build instructions.

2. **New extraction source?** → ATLAS gets the source profile, ALMANAC gets trust scores and stats, ENGINEERING MANUAL gets the extraction guide, DICTIONARY gets new terms.

3. **Bug fix / outage?** → Post-mortem in working shelf. If systemic, ENGINEERING MANUAL gets a "how to avoid this" section.

4. **Strategic discussion?** → DISCOURSES gets the full conversation. Key decisions extracted into ENCYCLOPEDIA. New terms into DICTIONARY.

5. **Data analysis?** → STUDIES gets the findings. Numbers into ALMANAC. Methodology into PAPERS if novel.

6. **Design decision?** → DESIGN BOOK gets the specification. CONTEMPLATIONS if philosophical. PAPERS if the reasoning is formal.

7. **New feature built?** → ENCYCLOPEDIA gets the chapter. SCHEMATICS gets the architecture. INDEX gets the file mapping. DICTIONARY gets every new term.

### The Promotion Cycle

```
Raw logs (journals/)
  → Working papers (analysis, drafts, explorations)
    → Reference books (rewritten, authoritative, complete)
      → Code (the implementation of what the books describe)
```

Working papers get promoted to reference when they've been validated by implementation. Reference books get rewritten (not appended) when ground truth shifts. Old versions live in git history.

### The Completeness Test

**Can someone rebuild the entire system from the library alone, with no access to the codebase?**

If yes → the library is sufficient.
If no → whatever's missing needs to be written.

The code is an implementation of the library. The library is the source of truth. Code can be regenerated from sufficiently detailed documentation. Documentation cannot be regenerated from code alone — the reasoning, the decisions, the philosophy, the domain knowledge are lost.

---

## CURRENT STATE

### What Exists (2026-03-20)

| Book | Status | Lines | Gap |
|------|--------|-------|-----|
| DICTIONARY | Tables reference complete | 20,749 | Needs semantic definitions beyond column listings |
| ENCYCLOPEDIA | Complete first draft (23 sections) | 1,250 | Needs 30-50 page chapters per entity type |
| THESAURUS | Seed (6 category tables) | 90 | Needs complete vocabulary mapping |
| INDEX | Frontend + backend indexed | 142+ | Growing. Needs every function, every table |
| ALMANAC | Seed (key metrics) | 152 | Needs historical time series, all stats |
| ATLAS | Seed (geography + institutions) | 153 | Needs every scrape target profiled |
| SCHEMATICS | 4 chapters complete | 4,342 | Data flow, entities, observations, pipeline |
| DESIGN BOOK | 3 chapters (README, components, interactions) | 500+ | Needs foundations + screens chapters |
| ENGINEERING MANUAL | 8 chapters complete | 4,279 | Intake through scraping sources |
| PAPERS | Does not exist | 0 | Entity resolution, trust scoring needed |
| DISCOURSES | 1 captured (repositioning nuke) | 107 | Major discussions need capture |
| THEORETICALS | 5 papers | 3,205 | Valuation, entity res, signal, half-life, organic connection |
| STUDIES | 4 studies | 1,498 | 13K prompts, triage, vocabulary, dead features |
| CONTEMPLATIONS | 6 essays | 1,769 | Rhizome, testimony, assets, organic, validation, i-just-know |

### Total: ~40,000 lines across 50 files. Target: 100,000+ lines.

We are at ~40% of target scale for existing books. PAPERS is the critical gap.

---

## NAMING AND ORGANIZATION

Each book is a directory with chapters:

```
docs/library/
├── README.md
├── reference/
│   ├── dictionary/
│   │   ├── README.md (overview + letter index)
│   │   ├── A.md (Asset, Actor, Archive Fetch, ...)
│   │   ├── B.md (Badge, Black Zone, Body Without Organs, ...)
│   │   └── ... one file per letter
│   ├── encyclopedia/
│   │   ├── README.md (table of contents)
│   │   ├── 01-unified-asset-layer.md
│   │   ├── 02-art-ontology.md
│   │   ├── 03-actor-layer.md
│   │   └── ... one file per chapter
│   ├── thesaurus/
│   ├── index/
│   ├── almanac/
│   │   ├── README.md
│   │   ├── database-stats.md (auto-generated from db-stats)
│   │   ├── trust-scores.md
│   │   ├── cost-reference.md
│   │   ├── timeline.md
│   │   └── ...
│   └── atlas/
│       ├── README.md
│       ├── auction-houses.md
│       ├── museums.md
│       ├── galleries.md
│       ├── freeports.md
│       ├── magazines.md
│       └── ...
├── technical/
│   ├── schematics/
│   │   ├── README.md
│   │   ├── database-architecture.md
│   │   ├── data-flow.md
│   │   ├── entity-relationships.md
│   │   └── ...
│   ├── design-book/
│   │   ├── README.md
│   │   ├── foundations.md (typography, color, spacing, borders)
│   │   ├── components.md (badges, panels, treemaps, forms)
│   │   ├── interactions.md (click, expand, collapse, stack)
│   │   ├── screens.md (every screen spec'd)
│   │   └── ...
│   └── engineering-manual/
│       ├── README.md
│       ├── 01-intake-pipeline.md
│       ├── 02-extraction.md
│       ├── 03-entity-resolution.md
│       ├── 04-observation-system.md
│       ├── 05-image-pipeline.md
│       └── ...
├── intellectual/
│   ├── papers/
│   │   ├── entity-resolution-design.md
│   │   ├── trust-scoring-methodology.md
│   │   ├── observation-half-life-model.md
│   │   └── ...
│   ├── discourses/
│   │   ├── 2026-03-20-repositioning-nuke.md  ← TODAY
│   │   └── ...
│   ├── theoreticals/
│   │   ├── signal-calculation.md
│   │   ├── valuation-methodology.md
│   │   ├── organic-connection-theory.md
│   │   └── ...
│   ├── studies/
│   │   ├── condition-price-correlation.md
│   │   ├── bat-comment-sentiment-analysis.md
│   │   ├── fb-marketplace-vintage-rate.md
│   │   └── ...
│   └── contemplations/
│       ├── the-rhizome.md
│       ├── testimony-and-half-lives.md
│       ├── assets-accumulate-data.md
│       ├── organic-vs-algorithmic.md
│       └── ...
├── working/
│   ├── journals/
│   ├── working-papers/ → ../../writing (symlink)
│   ├── field-notes/
│   └── post-mortems/
```
