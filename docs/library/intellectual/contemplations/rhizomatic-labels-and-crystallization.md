# Rhizomatic Labels and Crystallization

## How a Drawer of Sticky Notes Becomes a Citable Empirical Fact

---

> "The labels are kind of rhizomatic. The label function is essentially a drawer with sticky notes and a pen in it. Infinite stickies and endless pen ink. Then patterns begin to emerge and similar working coalesces within domains."
> — Skylar, 2026-05-24

> "The only ground truth would be an x,y,z volumetric observation and a 0-100 scale condition rating per volumetric measurement. Labels are just that, they are opinions."
> — Skylar, 2026-05-24

---

## Abstract

Every existing knowledge graph treats labels as a pre-declared schema — columns in a table, classes in an ontology, types in a taxonomy. This essay argues for the inverse: labels are projections of a vector neighborhood, computed at query time over a substrate of free-text testimony and provenance. The substrate is rhizomatic — every sticky note can connect to every other through embedding proximity, with no privileged trunk. Above this substrate, when a cluster of stickies gets dense enough AND acquires geometric measurement evidence (`(x,y,z)` + 0-100 condition), a *crystallization* occurs: a citable empirical fact emerges that sits on top of the substrate without consuming it. The stickies do not disappear. The labels do not become real. The fact is what is cited; the substrate is what backs the citation. This is structurally identical to how transformer embedding spaces organize meaning — orbits around centroids that drift over time — and it names the missing piece between Nuke's rhetorical layer ([testimony](testimony-and-half-lives.md)) and its geometric layer ([spatial condition ontology](../papers/novel-ontological-contributions.md) §I).

---

## I. The Failure Mode of Pre-Declared Labels

Pre-declared labels — `condition: 'excellent' | 'good' | 'fair' | 'poor'` — fail in three ways that the asset domain makes unavoidable.

**They cannot tolerate vocabulary drift.** What "concours quality" meant in 1995 is not what it means in 2026. The Hagerty 1-4 scale was calibrated against a population of vehicles that no longer dominates the collector market. Hamilton, Leskovec & Jurafsky (ACL 2016) showed that word meanings drift in embedding space at measurable rates — adverbs faster than nouns, slang faster than terms of art, but everything moves. A pre-declared label is a snapshot of a vocabulary that the corpus is already outgrowing.

**They cannot tolerate observer disagreement.** Two qualified inspectors give the same paint job a 7 and an 8.5 out of 10. The pre-declared schema forces a resolution; the substrate should preserve the disagreement. This is the [`accepted_discrepancy`](../papers/novel-ontological-contributions.md) §IV insight extended: not only contradiction-as-data for binary disputes, but a continuous distribution-as-data for graded judgments.

**They cannot tolerate domain expansion.** When Nuke moves from vehicles to art to magazines to real estate, the pre-declared label set must be re-declared. A label vocabulary that works for paint condition does not work for canvas condition does not work for paper aging does not work for roof condition. A pre-declared schema demands schema migration; a rhizomatic substrate demands only more substrate.

The Snorkel framework (Ratner et al., VLDB 2017) and the Dawid-Skene model (1979) were both proposed for aggregating noisy labels into a true label. Both assume the label set is given. Both assume the goal is to recover the "right" label. In the substrate Skylar describes, neither assumption holds: there is no fixed label set, and there is no single right label to recover. The label is a projection, not a target.

---

## II. The Substrate: Free Text + Embedding + Provenance

The substrate consists of three columns on every observation:

- **`free_text`** — what the observer actually wrote, in their own words, with their own register and emphasis. "Rust through on the rear wheel arch, looks fresh maybe from this winter." Not stripped, not normalized, not tagged. The voice survives.
- **`embedding`** — a dense vector (current generation: 1024 to 3072 dimensions) over the free-text, indexed for cosine similarity. The embedding is the substrate's connective tissue. Two stickies are "near" each other not because someone tagged them with the same label, but because their vector representations land in the same neighborhood.
- **`provenance`** — who observed it, when, from what source, with what attribution. Every claim in Nuke is already required to carry this ([CLAUDE.md "Numbers carry source DNA"](../../../CLAUDE.md)); the substrate makes provenance non-optional at the most granular level.

A label like `worn` does not exist as a column. It exists as a vector — a centroid that the system has computed (or that an editor has anchored) — and at query time, an observation's membership in `worn` is its cosine similarity to that centroid. The centroid drifts as the corpus grows. The membership is a number, not a Boolean. The same observation can be 0.82-similar to `worn`, 0.71-similar to `weathered`, 0.43-similar to `ssd_blast` simultaneously, and the system reports all three rather than picking one.

This is structurally identical to how LLM embedding spaces organize meaning. Words orbit centroids; concepts emerge as regions; meaning is a distance, not a category. Skylar's "drawer of sticky notes" framing is the human-readable form of the same architecture transformer models internalize during pre-training. The contribution is not the architecture — it is the *insistence that the production substrate match it*, rather than collapsing back to a discrete-column schema that the embedding model has to fight.

---

## III. The Crystallization Phase

Most stickies stay stickies. They sit in the drawer, embedded but unprojected, contributing to centroids without becoming citable facts on their own.

A cluster of stickies **crystallizes** when two conditions are met simultaneously:

1. **Density.** The cluster contains enough independent observations (typically: distinct observers, distinct timestamps, distinct sources) that the centroid is stable under leave-one-out perturbation. "Many people, working independently, wrote things that land in this neighborhood."

2. **Geometric anchor.** At least one of the observations in the cluster carries an `(x,y,z)` volumetric coordinate and a 0-100 condition reading. The cluster is now anchored to a specific region of the physical asset's body.

When both conditions are met, a **crystallized fact** is produced. It carries:

- The `(x,y,z)` envelope it measures
- The 0-100 condition value (or distribution, when multiple measurements exist)
- A citation set: pointers to every sticky in the cluster
- A citation to the centroid label, with the timestamp at which the centroid was computed
- The provenance chain: which observers, which sources, which dates

The crystallized fact is **citable**. It is what the marketplace UI quotes, what the insurance adjudicator queries, what the worth-engine multiplies against. The stickies remain. The crystal sits on top.

This matches the [palimpsest lifecycle state](../papers/novel-ontological-contributions.md) §II structurally: simultaneous evidence from multiple eras coexists in the material record. Here the layers are temporal AND epistemic — the stickies are the rhetorical layer that drifts, the crystal is the geometric layer that persists. Both are true. Both are present. Neither erases the other.

The Wikidata model of claim/reference/qualifier/rank (Vrandečić & Krötzsch, CACM 2014) is the closest formal precedent. Wikidata claims carry references and ranks; the rank determines which claim is "preferred" at any moment. Nuke's crystallization extends this: the crystal is the "preferred" claim, but it is a *derived* claim — computed from the underlying substrate — not an asserted one. And the substrate persists with full citation density, so re-crystallization is possible when new evidence lands.

---

## IV. Why the Sticky Notes Must Stay

A natural response: once the cluster crystallizes, why keep the underlying stickies? They are noisy, redundant, and the crystal is the answer.

Three reasons they must stay.

**The crystal can decrystallize.** New evidence may contradict the cluster. A re-measurement may move the geometric anchor. A previously-trusted observer may lose trust as their other testimony is contradicted ([testimony-and-half-lives](testimony-and-half-lives.md) §IV: "Trust Is Earned, Not Assigned"). If the substrate is destroyed, the crystal cannot be re-computed under the new conditions. The substrate is the audit trail.

**The crystal does not capture the rhetoric.** A 67/100 paint condition rating does not capture "looks fresh maybe from this winter" — the observer's tentativeness, the temporal hypothesis, the implicit knowledge that this region of the country has road salt. That rhetoric matters for downstream queries — "find me trucks where the rust pattern suggests recent regional exposure" — that the crystallized scalar cannot answer.

**The vocabulary drift is itself the data.** If the cluster's center moves from "worn" toward "patina" over five years, that movement is informative. It tells us about market vocabulary, about generational shifts in collector aesthetics, about what dealers are signalling. Hamilton et al. (2016) made this an explicit methodology: diachronic embeddings let you measure meaning change as a first-class phenomenon. In Nuke's substrate, vocabulary drift is testimony about the *observers*, not noise to denoise.

---

## V. Geometry as Ground, Rhetoric as Sky

The two-layer structure is asymmetric. The geometric layer is the ground; the rhetorical layer is the sky.

The geometric layer (`(x,y,z)` + 0-100) is what gets cited in adjudication. When the marketplace UI says "this fender has a 67/100 paint condition in the front-passenger-quarter envelope," that is what the buyer reads, what the seller defends, what the insurance dispute resolves to. It is bounded, measurable, re-measurable, comparable across vehicles and across time. It supports the killer queries Skylar named: "show me the best painter in Las Vegas" is a query over geometric crystals attributed to painters.

The rhetorical layer (free text + embedding) is what gets cited in discovery. When the agent surfaces "vehicles with rust patterns suggesting recent regional exposure," it queries the embedding space. When the journal/:date view renders a coherent narrative, it pulls free-text observations from the substrate. The rhetoric is where new questions get asked, before they have crystallized into measurable forms.

The metaphor "ground and sky" is load-bearing. You cannot build a building on the sky. You also cannot watch the weather on the ground. The crystallized layer is what supports load — pricing, adjudication, regulatory claims. The rhetorical layer is what surfaces phenomena — emerging patterns, observer disagreement, vocabulary drift, weak signals. A system that has only the ground is a property-tax assessor; a system that has only the sky is social media. Nuke needs both.

---

## VI. Connection to the Existing Library

This contemplation extends three load-bearing essays.

**[The Rhizome](the-rhizome.md)** named the architecture: every machine connects to every other, no trunk, no privileged path, observation-as-Body-without-Organs. This contemplation names *what flows through the rhizome*: not records, not documents, not labels — embedded testimony. The vector space is the medium in which the rhizome's connections become computable.

**[Testimony and Half-Lives](testimony-and-half-lives.md)** named the epistemology: data is testimony, testimony decays, claims carry source DNA. This contemplation names *the structure* of testimony: free-text plus embedding plus provenance, with labels emerging as projections rather than being declared at write time. Half-lives apply to the labels too — a centroid is a temporally-positioned statistical artifact, and its drift is observable.

**[Novel Ontological Contributions](../papers/novel-ontological-contributions.md) §I (Spatial Condition Ontology) and §II (Palimpsest Lifecycle)** named the geometric layer: condition as a scalar field over a 3D envelope, layered material histories as a first-class ontological category. This contemplation names *how the rhetorical layer feeds into the geometric layer*: through crystallization, when density and geometric anchor coincide. §IV's `accepted_discrepancy` is the special case where the cluster has density but disagreement prevents a single crystallized value; the substrate handles this natively because distribution-as-output is the default, not the exception.

The new piece this contemplation contributes is the *phase-transition vocabulary*. The library had a rhetorical layer and a geometric layer but no name for the moment when one becomes the other. "Crystallization" is the name. It is testable (density + geometric anchor), reversible (decrystallization under new evidence), and citable (the crystal points back to the substrate).

---

## VII. The Practical Implications

For the schema, the immediate work is: add `embedding vector(N)` and `free_text` columns to every observation table that does not already have them; build the pgvector indices; treat existing tag/label columns as derived views, not source of truth.

For the extraction pipeline, the immediate work is: stop emitting labels as the primary output. Emit free-text testimony plus the embedding plus the bbox-anchored observation. The label, if produced, is a side effect for downstream convenience, not the unit of work.

For the frontend, the implication is harder: stop building label-filter UIs. Build embedding-neighborhood UIs. "Show me vehicles like this one" is a cosine similarity query, not a tag intersection. "Show me the best painter in Vegas" is a centroid-distance query over painter-attributed crystals, not a JOIN against a `painter_rating` table.

For agents writing into the substrate, the implication is: write your stickies. Write them in your own voice. Do not pre-label. Trust the embedding to find your work's neighbors. Trust the crystallization to surface the patterns when they are dense enough to surface.

---

## VIII. What This Is Not

This is not an argument against labels. Labels are useful — for UI affordances, for human-readable summaries, for query convenience. The argument is that labels are downstream, not upstream. They are computed projections of the substrate, not declared columns of the schema.

This is not an argument against schemas. The substrate IS a schema — a small, stable one (`free_text`, `embedding`, `bbox`, `(x,y,z)`, condition, provenance) that handles every domain. The argument is against the proliferation of *application-level* schemas — `condition_grade ENUM(...)`, `paint_status TEXT`, `interior_score INT` — that fight the substrate.

This is not the claim that AI replaces expert judgment. It is the opposite: the substrate makes expert judgment *legible and accumulable*. The dealer who "just knows" can keep just knowing — but now her stickies enter the substrate, her embedding patterns become centroids over time, her crystallized facts become the queryable record of her expertise. The system materializes expertise; it does not synthesize it.

---

## IX. Conclusion: The Substrate Is the Product

Nuke's product is not the vehicle database. It is not the extraction pipeline. It is not the marketplace UI. The product is the **substrate** — the two-layer rhizomatic-plus-geometric record of physical assets in the world. The database, pipeline, and UI are implementations of access to the substrate.

Pearl's belief networks and Hernán's causal inference frameworks both presuppose that the variables are given. The hard part of physical-asset epistemology is that the variables are *not* given — they emerge from the substrate as crystallized facts when conditions allow. Once they emerge, Pearl and Hernán apply. Until then, the substrate is the only thing the system can honestly cite.

Civil infrastructure inspection databases (the FHWA National Bridge Inventory; the AASHTO bridge management systems) carry `(x,y,z)` plus 0-100 condition ratings per element type, and have done so since the 1990s. They are the closest peer system in production. They lack the rhetorical layer; their inspectors enter forms, not stickies. DICOM, the medical imaging standard, carries volumetric scans plus structured findings, and provides longitudinal tracking. It also lacks the rhetorical layer; radiologists write reports in free text, but the reports are not embedded into a substrate that drifts and crystallizes.

Nuke's contribution is the integration: rhetorical substrate + geometric substrate, with crystallization as the phase transition between them. This is what makes the vehicle a *legible body* (cf. [the-legible-field.md](the-legible-field.md)) rather than a row in a table. And this is what makes the marketplace UI — infer, confirm, coordinate, deliver, cut — possible without insurance. The substrate is the truth. The crystal is the citation. The UI is the projection. The rhizome holds it all.

---

*This contemplation is the missing piece between the rhetorical and geometric layers of the Nuke substrate. It is the philosophical companion to the 2026-05-24 discourse capture, where the founder named the rhizomatic-sticky-note metaphor and the `(x,y,z)` + 0-100 ground truth in the same conversation for the first time.*
