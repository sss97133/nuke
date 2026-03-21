# Discourse: Repositioning Nuke as a Universal Provenance Engine

**Date**: 2026-03-20
**Participants**: Skylar (founder), Claude Opus 4.6
**Duration**: ~3 hours
**Output**: NUKE ENCYCLOPEDIA (23 sections), Library structure established

---

## Thesis

Nuke is not a car database. It's a provenance engine that builds knowledge graphs from the traces physical assets leave as they move through networks of people and organizations. Automotive is the first vertical — a massive subset, but not the identity.

## Key Decisions Made

### 1. Three Entity Types (Universal)

- **User**: Never an asset. Always an actor. Artists, collectors, drivers, dealers, curators, handlers.
- **Organization**: CAN become an asset. Gallery, auction house, museum, foundation, magazine, shop. Connective tissue between users and assets.
- **Asset**: Immutable identity. Accumulates data forever. Vehicles, artworks, magazine issues.

### 2. Networks Derived from Collaborative Traces

Social media builds graphs from declared intent (follow/following). Nuke builds graphs from financial and collaborative evidence. Two actors connected because money moved between them, or they both touched the same asset through an organization. Permanent traces, not ephemeral declarations.

### 3. Magazines Are a Validation Layer, Not a Vertical

A magazine doesn't create value. It confirms it. Magazine issues are high-trust observation sources that feed into art, fashion, and automotive verticals. They're the physical receipt that something mattered. The most expensive possible way to store data that Nuke extracts for the cost of an LLM pass.

### 4. Art Maps Directly to Vehicles

```
VIN → catalogue raisonné number
year → date executed
make → artist
model → title
trim → medium and dimensions
build sheet → certificate of authenticity
restoration history → conservation history
```

Same five dimensional shadows, same provenance chain, same auction mechanics.

### 5. Expansion Sequence

Automotive (running) → Art (user's network, same architecture) → Magazines (observation source, not vertical) → Future verticals (configuration, not engineering)

### 6. The Foundation Must Be Fixed First

The current pipeline has:
- 8 functions per extraction (should be 5 MCP tools)
- 60% confidence fuzzy matching that corrupts data (must never auto-match below 80%)
- Two parallel data pipelines (observation system exists but extractors bypass it)
- No audit trail on field-level writes
- Schema-code mismatch on status values

Art can't be built on broken pipes. Phase 0 fixes the foundation. Art launches clean on the new platform. Vehicles migrate after (strangler fig pattern).

### 7. The Library Structure

Documentation organized like a physical library: reference shelf (dictionary, encyclopedia, thesaurus, index, almanac, atlas), technical shelf (schematics, design book, engineering manual), intellectual shelf (papers, discourses, theoreticals, studies, contemplations), working shelf (journals, field notes, post-mortems).

Target: 4,600+ pages. Current: ~134 pages (3%).

## Key Quotes (Founder)

On magazines: "they are a worthless asset that are extremely expensive to maintain at scale"

On data becoming AI: "a big enough database just turns into AI at one point it seems like"

On expertise: "the 'I just know' people... OK prove it. Show us your records. It will light the way."

On social media vs. Nuke: "assets don't change though they accumulate data"

On organic connection: "everyone wants to meet organically. I cannot state that enough. This is a fundamental goal to refocus on the natural and organic methods."

On the art world: "the dirty little secrets of the art world selling out to social media actually begin to experience hopefully a shift tectonic... the data is the shape."

On personal access: "art is a bit more accessible for me personally... I see my path to get in contact with artists or galleries I literally know them."

On signal: "perhaps [my painting] still would have meant nothing in our system had it been working in real time, however maybe a serious art person would have gotten a ping"

On the library: "these 'books' need to be growing at exponential rate... it should be that a person could come around in the future and rebuild, from those books, everything"

## Unresolved Questions

1. How to handle artist onboarding friction — artists are "crazy as fuck" and don't want to catalog anything. System must be as passive as phone photos → auto-everything.

2. Financial data sensitivity — users won't want to share money details. The accounting edge (QuickBooks integration) needs careful UX. "The best approach is we should establish that we help to get money into their hands."

3. Entity resolution for art — no universal identifier like VIN. Image perceptual hashing + metadata intersection + human confirmation for edge cases. The hardest technical problem.

4. OCR at magazine scale — "scary" volume. Prioritize by value: cool magazines, specific regions, gap analysis targets. Not everything at once.

5. How to surface signal without becoming algorithmic / feed-based — the organic connection problem. "We wouldn't wanna put them on blast." Context-based discovery through the graph, not recommendation engines.

## Documents Produced

1. `/docs/NUKE_ENCYCLOPEDIA.md` — 23-section system specification
2. `/docs/library/` — Complete library structure with reference, technical, intellectual, and working shelves
3. `/docs/library/reference/dictionary/README.md` — 60+ term definitions
4. `/docs/library/reference/encyclopedia/README.md` — Full encyclopedia
5. `/docs/library/reference/thesaurus/README.md` — Vocabulary mapping
6. `/docs/library/reference/index/README.md` — Concept-to-location mapping
7. `/docs/library/reference/almanac/README.md` — Facts, figures, stats
8. `/docs/library/reference/atlas/README.md` — Geographic and institutional reference
9. This discourse document
