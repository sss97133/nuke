# Discourse: UI as Projection, Substrate as Rhizomatic Sticky-Note Layer, Labels as Opinions

**Date:** 2026-05-24
**Participants:** Skylar (founder), Claude Opus 4.7 (1M context)
**Duration:** Single long-form session
**Output:** Naming of the two-layer substrate (rhizomatic free-text labels above, `(x,y,z)` + 0-100 condition geometry below); explicit re-statement of UI's job as projection-and-coordination; positioning of Nuke against Palantir as the grassroots, boots-on-the-ground analog.
**Companions:** [the-rhizome.md](../contemplations/the-rhizome.md), [testimony-and-half-lives.md](../contemplations/testimony-and-half-lives.md), [rhizomatic-labels-and-crystallization.md](../contemplations/rhizomatic-labels-and-crystallization.md), [novel-ontological-contributions.md](../papers/novel-ontological-contributions.md) §I, §II, §IV.

---

## Thesis

The substrate is a two-layer rhizomatic system. **Above** is a drawer of infinite sticky notes — free-text observations, attached to images, video, text and email, embedded into a vector space where similar working coalesces into domains. **Below** is the only ground truth the founder will commit to: an `(x,y,z)` volumetric observation paired with a 0-100 condition rating per volumetric measurement. Labels are opinions; geometry is fact. Image analysis (and increasingly live-streamed video) is the empirical primitive that feeds both layers. The UI's job is **not to interpret** — it is to project the substrate honestly into a query response and then to coordinate the real-world action that the query implies. Infer, confirm, coordinate, deliver, cut.

This formalizes the move from a database that holds claims to a substrate that holds testimony in two structurally different shapes: a rhetorical layer that drifts and reorganizes, and a geometric layer that crystallizes and persists.

---

## Key Decisions Made

### 1. Labels are rhizomatic, not categorical

The label function is a drawer with sticky notes and an infinite pen. There is no pre-declared taxonomy. Patterns emerge by working similarity inside domains, not by imposing column headers in advance. This is consistent with the [SCHEMA DISCOVERY PRINCIPLE](../../../../CLAUDE.md) — "The data knows what it contains. Ask it before you assume" — but pushed further: labels are not a schema to discover, they are a continuously-projected view of a vector neighborhood.

### 2. `(x,y,z)` + 0-100 condition is the only ground truth

The founder will only commit to one irreducible fact-shape: a volumetric observation at a coordinate, with a scalar condition rating from 0 to 100. Everything else — "rust," "patina," "matching numbers," "concours quality" — is a projection over that geometry. This extends the [Spatial Condition Ontology](../papers/novel-ontological-contributions.md) §I from a per-zone scalar field to a per-volumetric-measurement field where the unit of analysis is sub-zone and the value is a number, not a word.

### 3. Free-text + vector embeddings is the substrate; discrete labels are projections at query time

The platform stores the unstructured testimony — the sticky note as written — alongside a dense vector embedding. Labels (`worn`, `weathered`, `palimpsest`, `ssd_blast`) are computed as cluster membership at query time, not as columns at write time. This is the right shape for a substrate that must tolerate vocabulary drift, observer disagreement, and the addition of new domains (art, magazines, real estate) without schema migration.

### 4. Crystallization is a phase transition, not a write

When a sticky cluster gets dense enough AND acquires `(x,y,z)` measurement evidence, a citable empirical fact emerges. The stickies do not disappear. The crystal sits on top of the substrate, citing it. This is the bridge between the rhetorical layer and the geometric layer — and it is structurally identical to how a [palimpsest lifecycle state](../papers/novel-ontological-contributions.md) §II carries simultaneous evidence from multiple eras.

### 5. The image pipeline needs photogrammetric stitching, not just classification

Current image analysis produces zone-tagged observations with bounding boxes in image space (§I.B). To realize the `(x,y,z)` ground truth, photographs must be reconstructed into 3D geometry. This is the path that 3D Gaussian Splatting (Kerbl et al., SIGGRAPH 2023) has made tractable in the last two years. The substrate needs a per-vehicle volumetric reconstruction that observations can be projected onto.

### 6. The frontend is a projection lens, not an entity profile page

The journal/:date page already demonstrates the pattern: it is a query — "what happened on this day, across this person's work" — projected as a coherent view, not a row from a `daily_summary` table. Every page in the new frontend is shaped this way: an angle of incidence onto the substrate, never a CRUD form over a table.

### 7. Marketplace UX is infer → confirm → coordinate → deliver → cut

The UI's job at the transaction layer is the same as at the read layer: surface what the substrate already knows, ask the human to confirm what the substrate cannot verify, then coordinate the real-world transaction (shipping, payment, title transfer) and take a cut. The founder is explicit: this defeats insurance because insurance is a coordinator that charges horrific fees in exchange for coordination — and Nuke can coordinate with substrate-backed truth.

### 8. `journal/:date` is the live proof of the projection pattern

The page exists. The pattern is not aspirational. The roadmap is to generalize the journal-per-date frame to journal-per-vehicle, journal-per-shop, journal-per-actor, journal-per-zone, journal-per-component — each a query over the substrate projected as a coherent narrative view.

---

## Key Quotes (Founder)

> "the key i see is the SQL postgres DB that the most important... the table structures the jsonb per field and column and row the intelligent expansion of jsonb and the db (under developed) the image analysis is the key"

> "do you understand the depth of real time jsonb reporting on every action sourced from image or video documentation along with real time access to adjacent data like text, email, etc"

> "the only truth that's irrefutable would be that vehicles are able to be live streamed and data is able to be checked in real time live investigation"

> "for us data is also things like quality. good paint job vs bad paint job and in order to know the difference we have to know the make up of the source, the user who did the work"

> "the labels are kind of rhizomatic. the label function is essentially a drawer with sticky notes and a pen in it. infinite stickies and endless pen ink. then patterns begin to emerge and similar working cooalests within domains"

> "the only ground truth would be an x,y,z volumetric observation and a 0-100 scale condition rating per volumetric measurement. labels are just that, they are opinions"

> "im the grassroots version of what they are [Palantir]... boots on the ground"

> "show me the shop that uses the most 3M tape. show me the tech whos literally the best screwdriver user in the usa... the data answers those questions the ui enables truthful response to the query"

> "ui the data to infer and then call to action confirm, coordinate and deliver"

> "this defeats insurance over night... insurance at its core is just a coordinator to get a car fixed or paid for and pays horrific fees in exhange... we become the defenders of the historically abused mfers"

---

## Implications

### For the schema

The `vehicle_observations` table already stores `bbox` in image space, zone in zone space, and partial physical envelope in `vehicle_surface_templates`. The work ahead is the third axis: a per-vehicle `vehicle_volumetric_reconstruction` (Gaussian splat / mesh / point cloud) that gives every observation a real `(x, y, z)` and lets every condition value be addressed by physical coordinate, not by name. The 0-100 condition scalar is already in `damage_scan` results — what's missing is the geometric anchor.

The free-text label layer wants a pgvector column on every observation that carries a dense embedding of the observer's written testimony. Discrete labels — `worn`, `restored`, `palimpsest`, `ssd_blast` — become VIEWs computed by cosine similarity against curated centroids, not stored values. Centroids drift over time as the corpus grows; that drift is logged as a first-class temporal phenomenon (Hamilton, Leskovec, Jurafsky 2016 — diachronic word embeddings).

### For the extraction pipeline

`extract-vehicle-data-ai` and the vision analysis chain should stop producing "labeled outputs" and start producing "embedded testimony." The label is not the unit. The free-text observation plus the embedding plus the source-anchored bbox plus the (eventually) `(x,y,z)` is the unit. Labels are downstream queries.

### For the frontend

Stop building entity-profile pages. Build projection lenses. The journal/:date pattern generalizes to journal/:vehicle, journal/:shop, journal/:actor, journal/:component, journal/:zone. Each page is a query, not a row.

### For positioning

The founder's framing is now load-bearing: **Nuke is the grassroots Palantir for physical assets.** Palantir's substrate is government data; Nuke's is the photograph stack of someone who has been documenting cars for fifteen years. Palantir charges enterprises; Nuke charges the marketplace coordination fee that insurance currently extracts without providing the underlying truth. The killer queries — best 3M-tape shop, best painter in Vegas, best screwdriver-user in the USA — are not marketing copy; they are concrete sketches of what queries the substrate-backed UI must answer.

### For insurance and marketplaces

A substrate that carries `(x,y,z)` + 0-100 condition + photographic provenance + observer attribution is an insurance claim adjudicator that does not need the insurance company. It is also a marketplace pricing engine that does not need a third-party appraiser. The "defeats insurance overnight" claim is hyperbolic in timing but structurally correct in direction: insurance prices opacity. Nuke prices the substrate. The substrate kills the opacity.

---

## Unresolved Questions

1. **What is the minimum volumetric reconstruction quality required to anchor `(x,y,z)`?** Gaussian splats from a phone-photo set produce usable geometry but with unknown absolute scale. Anchoring requires either known-dimension fiducials (door cards, body length) or a per-vehicle calibration step.

2. **How do we handle the long tail of free-text labels that never coalesce?** The rhizome predicts most stickies will sit alone forever. That is fine for substrate, but the UI must decide when a sticky cluster is dense enough to surface as a projected label vs. when it is still noise.

3. **What is the citation contract for crystallized facts?** A crystallized fact ("the front passenger fender has 67/100 paint condition") must cite (a) the stickies it summarizes, (b) the `(x,y,z)` envelope it measures, (c) the observer-attribution chain. A fact without these three citations is not crystallized — it is asserted, and assertion has no place in the geometry layer.

4. **How does the coordination layer's "cut" get priced?** The founder's vision of a marketplace UX implies a take-rate, but neither the rate nor the unit (per-transaction, per-confirmation, per-delivery) is specified yet. The substrate determines what is coordinable; the coordination determines what is priced.

5. **What is the half-life of an `(x,y,z)` measurement?** Geometry is more permanent than labels but not permanent. A rusted fender today is a different shape from the fender six months from now. The geometric layer needs its own decay model — slower than testimony, faster than identity.

---

## Documents Produced

1. This discourse capture
2. `contemplations/rhizomatic-labels-and-crystallization.md` — the philosophical companion that names how the rhetorical layer feeds into the geometric layer
3. `working/working-papers/2026-05-24_killer-query-substrate-roadmap.md` — the substrate-maturity map for the three killer queries the founder named
